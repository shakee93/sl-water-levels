// Builds lib/geo/colombo-canals.json (canal lines, lakes and marshes) for the /colombo-canals map from OpenStreetMap.
//   node scripts/build-colombo-map.mjs            fetch once from Overpass, then simplify and write the file
//   node scripts/build-colombo-map.mjs --from raw.json   reuse a saved Overpass answer
// Run by hand when the map should be refreshed. NEVER called per request or from the browser.
// Box 6.84-6.99 N, 79.84-79.95 E. Data (c) OpenStreetMap contributors (ODbL), credited on the map.
// Each canal line is tagged with the basin it mostly lies in, using the approximate basin outlines in
// lib/geo/colombo-basins-seed.json (hand-drawn, see DOCS.md "Colombo canal map").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOX = "6.84,79.84,6.99,79.95";
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const UA = "sl-water-levels-build (+https://waterlevels.lk; shakee.zats@gmail.com)";
const QUERY = `[out:json][timeout:120];(
 way["waterway"~"^(canal|drain|river|stream|ditch)$"](${BOX});
 way["natural"="water"](${BOX});
 way["natural"="wetland"](${BOX});
 relation["natural"~"^(water|wetland)$"](${BOX});
);out geom tags;`;

const fromIdx = process.argv.indexOf("--from");
let raw;
if (fromIdx > 0) raw = JSON.parse(fs.readFileSync(process.argv[fromIdx + 1], "utf8"));
else {
  for (const u of MIRRORS) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(QUERY), signal: AbortSignal.timeout(150000) });
      if (r.ok) { raw = await r.json(); break; }
    } catch {}
  }
  if (!raw) throw new Error("Overpass unavailable");
}

const KX = Math.cos((6.93 * Math.PI) / 180);
function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const dx = (pts[b][1] - pts[a][1]) * KX, dy = pts[b][0] - pts[a][0], l2 = dx * dx + dy * dy;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = (pts[i][1] - pts[a][1]) * KX, py = pts[i][0] - pts[a][0];
      const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const geom = (g) => g.map((p) => [p.lat, p.lon]);
const lenKm = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot((p[0] - pts[i - 1][0]), (p[1] - pts[i - 1][1]) * KX) * 111.2 : 0), 0);
const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p[1] * q[0] - q[1] * p[0]) * KX; }, 0) / 2) * 111.2 * 111.2; // km2

const basins = fs.existsSync(path.join(ROOT, "lib/geo/colombo-basins-seed.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "lib/geo/colombo-basins-seed.json"), "utf8")).basins : [];
const inside = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j]; if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const basinOf = (pts) => { const m = pts[Math.floor(pts.length / 2)]; return basins.find((b) => inside(m, b.ring))?.id ?? null; };

const KIND = { canal: "c", drain: "d", river: "r", stream: "s", ditch: "t" };
const NAMED_BEST = (t) => t["name:en"] || t.name || null;
const lines = [], waters = [];
for (const e of raw.elements) {
  const t = e.tags ?? {};
  if (t.waterway && e.type === "way" && e.geometry) {
    const k = KIND[t.waterway];
    if (!k) continue;
    let pts = geom(e.geometry);
    const name = NAMED_BEST(t);
    const km = lenKm(pts);
    // tiny unnamed ditches and streams are noise at this scale
    if (!name && (k === "t" || k === "s") && km < 0.35) continue;
    if (!name && k === "t") continue;
    pts = dp(pts, 0.00006).map((p) => [r5(p[0]), r5(p[1])]);
    if (pts.length < 2) continue;
    lines.push({ n: name, k, b: basinOf(pts), pts, id: e.id, km });
  } else if ((t.natural === "water" || t.natural === "wetland") && (e.geometry || e.members)) {
    const rings = e.type === "way" ? [e.geometry] : (e.members ?? []).filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry);
    for (const g of rings) {
      let ring = geom(g);
      const a = area(ring);
      const name = NAMED_BEST(t);
      if (a < (name ? 0.01 : 0.06)) continue; // keep named ponds >1 ha and unnamed >6 ha
      ring = dp(ring, 0.00008).map((p) => [r5(p[0]), r5(p[1])]);
      if (ring.length < 4) continue;
      waters.push({ n: name, w: t.natural === "wetland" ? 1 : 0, ring, a });
    }
  }
}
// Several OSM ways make up one named canal: keep them as separate polylines but share the name.
lines.sort((a, b) => b.km - a.km);
const out = {
  source: "OpenStreetMap contributors (ODbL), Overpass API",
  fetched: raw.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
  box: BOX.split(",").map(Number),
  /** k: c canal, d drain, r river, s stream. b: basin id (approximate). pts: [lat, lon] */
  lines: lines.map(({ n, k, b, pts }) => ({ ...(n ? { n } : {}), k, ...(b ? { b } : {}), p: pts.map(([a, o]) => [a, o]) })),
  /** w: 1 marsh, 0 open water; r: ring [lat, lon] */
  waters: waters.map(({ n, w, ring }) => ({ ...(n ? { n } : {}), w, r: ring })),
};
// compact: delta-encode each polyline in 1e-5 deg integers
const enc = (pts) => { const o = []; let x = 0, y = 0; for (const [a, b] of pts) { const X = Math.round(a * 1e5), Y = Math.round(b * 1e5); o.push(X - x, Y - y); x = X; y = Y; } return o; };
out.lines = out.lines.map((l) => ({ ...l, p: enc(l.p) }));
out.waters = out.waters.map((l) => ({ ...l, r: enc(l.r) }));
const file = path.join(ROOT, "lib/geo/colombo-canals.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log("lines", out.lines.length, "waters", out.waters.length, "bytes", fs.statSync(file).size);

// Past-flood layer: the Irrigation Department's mapped May 2016 Kelani flood (lib/model/flood-map.json, built by
// build-flood-map.mjs) as one circle per village division it touched: [lat, lon, radius m]. No names, no polygons:
// the circles show how big each division is, not where the water stopped.
{
  const fm = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/model/flood-map.json"), "utf8"));
  const i = fm.events.findIndex((e) => e.id === "kelani-ganga-2016");
  const [s, w, n, e] = [6.84, 79.84, 6.99, 79.96];
  const circles = fm.gn.filter((g) => g[6].includes(i) && g[3] > s && g[3] < n && g[4] > w && g[4] < e).map((g) => [g[3], g[4], Math.round(g[5] * 1000)]);
  const f = path.join(ROOT, "lib/geo/colombo-floods.json");
  fs.writeFileSync(f, JSON.stringify({ event: "Kelani Ganga, May 2016", source: "Irrigation Department flood maps (Flood_Map service, edited " + fm.edited + ")", circles }));
  console.log("flood circles", circles.length, fs.statSync(f).size);
}
