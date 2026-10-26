// Adds the tributaries that OpenStreetMap-by-name missed to lib/geo/rivers.json, so every river gauge
// sits on a drawn line. Run AFTER build-river-geo.mjs and BEFORE build-home-rivers.mjs:
//   node scripts/build-river-geo.mjs && node scripts/build-river-extras.mjs && node scripts/build-home-rivers.mjs
//   node scripts/gauge-lines.test.mjs                 checks every gauge is on a line
// Idempotent: lines it added earlier (x: 1) are dropped first.
//
// Sources, in order of preference:
//  1. The Irrigation Department's own rivers layer (ArcGIS FeatureServer "rivers", 3,379 unnamed
//     polylines). Fetched ONCE here, at build time, in 2 pages with a pause, and cached in
//     $TMPDIR/sl-arcgis-rivers; it stops on any error or 429. Never queried at request time: that
//     organisation's per-minute quota is shared by the public.
//  2. OpenStreetMap via Overpass (waterway=river|stream, no name needed) within 2.5 km of a gauge that
//     the ArcGIS layer places more than 300 m away: OSM positions are the better ones there.
// For each gauge farther than NEAR_M from a drawn line, the shortest path along these lines from the
// gauge down to the drawn network (or the coast, where the river has no drawn line at all) is added.
// ROUTES lists extra full-length reaches (closing the gaps of the Aththanagalu Oya).
// Data (c) OpenStreetMap contributors, ODbL; rivers (c) Irrigation Department, Sri Lanka. Both credited on the maps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "lib/geo/rivers.json");
const UA = "sl-water-levels-geo-build/1.0 (https://github.com/shakee93/sl-water-levels; shakee.zats@gmail.com)";
const ARC = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/rivers/FeatureServer/0/query";
const NEAR_M = 300; // a gauge closer than this to a drawn line needs nothing
const JOIN_DEFAULT = 60; // vertices of different ways closer than this count as joined
const TARGET_M = 120; // a path ends when it comes this close to the drawn network
const ARC_CACHE = path.join(os.tmpdir(), "sl-arcgis-rivers");
const OSM_CACHE = path.join(os.tmpdir(), "sl-osm-cache");
fs.mkdirSync(ARC_CACHE, { recursive: true });
fs.mkdirSync(OSM_CACHE, { recursive: true });

// Full-length reaches to add besides the gauge paths: from a gauge to a point (the river mouth).
const ROUTES = [
  // Aththanagalu Oya (Attanagalu Oya, then Dandugam Oya): headwaters east of Dunamale -> Dunamale -> Negombo lagoon,
  // drawn as ONE main-river line (it is its own basin, it does not join the Kelani). Replaces the OSM pieces.
  { basin: "Aththanagalu Oya", via: [[80.1859, 7.1033], "aththanagalu-oya/dunamale", [79.8952, 7.1618]], toSea: false, main: true, replace: true,
    osm: ['way["waterway"~"^(river|stream|canal)$"]["name"~"Attanagalu|Aththanagalu|Dandugam|Attanagalla",i](6.9,79.75,7.4,80.3);', 'way["waterway"~"^(river|stream|canal)$"](7.0,79.78,7.3,79.95);'] },
];

const KX = Math.cos((7.8 * Math.PI) / 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const m = (a, b) => Math.hypot((a[0] - b[0]) * KX, a[1] - b[1]) * 111200;
const decode = (d) => { const o = []; let x = 0, y = 0; for (let i = 0; i + 1 < d.length; i += 2) { x += d[i]; y += d[i + 1]; o.push([x / 1e4, y / 1e4]); } return o; };
const encode = (pts) => { const d = []; let px = 0, py = 0; for (const [x, y] of pts) { const ix = Math.round(x * 1e4), iy = Math.round(y * 1e4); d.push(ix - px, iy - py); px = ix; py = iy; } return d; };
function segM(p, a, b) {
  const dx = (b[0] - a[0]) * KX, dy = b[1] - a[1], px = (p[0] - a[0]) * KX, py = p[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
  return Math.hypot(px - t * dx, py - t * dy) * 111200;
}
const distToLines = (p, lines) => { let b = Infinity; for (const l of lines) for (let i = 1; i < l.length; i++) b = Math.min(b, segM(p, l[i - 1], l[i])); return b; };
function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = segM(pts[i], pts[a], pts[b]) / 111200; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ------------------------------------------------------------------ fetch
async function arcgisLines() {
  const feats = [];
  for (const offset of [0, 2000]) {
    const f = path.join(ARC_CACHE, `page-${offset}.json`);
    let j;
    if (fs.existsSync(f)) j = JSON.parse(fs.readFileSync(f, "utf8"));
    else {
      const url = `${ARC}?where=1%3D1&outFields=FID&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.0002&resultOffset=${offset}&resultRecordCount=2000&f=json`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) throw new Error("ArcGIS answered 429 (quota): stopping, try again later");
      const text = await res.text();
      j = JSON.parse(text);
      if (!res.ok || j.error) throw new Error("ArcGIS error, stopping: " + text.slice(0, 200));
      fs.writeFileSync(f, text);
      await sleep(4000);
    }
    feats.push(...j.features);
  }
  console.log("ArcGIS rivers layer:", feats.length, "polylines");
  return feats.flatMap((f) => f.geometry.paths.map((p) => p));
}
let last = 0;
async function overpass(key, query) {
  const f = path.join(OSM_CACHE, key + ".json");
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  let wait = 8000;
  for (let i = 0; i < 6; i++) {
    const gap = Date.now() - last;
    if (gap < 2500) await sleep(2500 - gap);
    last = Date.now();
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) });
      const text = await res.text();
      if (res.ok && text.trim().startsWith("{")) { fs.writeFileSync(f, text); return JSON.parse(text); }
      console.error(`  ${key}: HTTP ${res.status}, retry in ${wait / 1000}s`);
    } catch (e) { console.error(`  ${key}: ${e.message}, retry in ${wait / 1000}s`); }
    await sleep(wait);
    wait *= 2;
  }
  throw new Error("Overpass gave up on " + key);
}
async function osmNear(g) {
  let j;
  try { j = await overpass(`extras-${g.id.replace(/\W/g, "_")}`, `[out:json][timeout:60];way["waterway"~"^(river|stream)$"](around:2500,${g.lat},${g.lon});out geom;`); }
  catch (e) { console.error(`  OSM unavailable for ${g.station} (${e.message}); using ArcGIS only`); return []; }
  return j.elements.filter((e) => e.geometry).map((e) => e.geometry.map((p) => [p.lon, p.lat]));
}

// ------------------------------------------------------------------ graph + shortest path
function makeGraph(ways, JOIN_M = JOIN_DEFAULT) {
  const V = [], adj = [];
  for (const w of ways) {
    let prev = -1;
    w.forEach((c, k) => {
      V.push({ c, w });
      adj.push([]);
      const id = V.length - 1;
      if (k) { const d = m(V[prev].c, c); adj[prev].push([id, d]); adj[id].push([prev, d]); }
      prev = id;
    });
  }
  const cell = (c) => [Math.floor(c[0] / 0.001), Math.floor(c[1] / 0.001)];
  const grid = new Map();
  V.forEach((v, i) => { const k = cell(v.c).join(); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); });
  V.forEach((v, i) => {
    const [cx, cy] = cell(v.c);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (j <= i || V[j].w === v.w) continue;
      const d = m(v.c, V[j].c);
      if (d < JOIN_M) { adj[i].push([j, d]); adj[j].push([i, d]); }
    }
  });
  return { V, adj };
}
function shortest({ V, adj }, from, isTarget) {
  const dist = new Float64Array(V.length).fill(Infinity), prev = new Int32Array(V.length).fill(-1);
  dist[from] = 0;
  const heap = [[0, from]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { let s = i; const a = 2 * i + 1, b = a + 1; if (a < heap.length && heap[a][0] < heap[s][0]) s = a; if (b < heap.length && heap[b][0] < heap[s][0]) s = b; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return t; };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (isTarget(u)) { const p = []; for (let x = u; x >= 0; x = prev[x]) p.push(x); return { path: p.reverse().map((i) => V[i].c), km: d / 1000 }; }
    for (const [v, w] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; push([d + w, v]); }
  }
  return null;
}
const nearestVertex = (G, p) => { let b = Infinity, bi = -1; G.V.forEach((v, i) => { const d = m(v.c, p); if (d < b) { b = d; bi = i; } }); return bi; };

// ------------------------------------------------------------------ main
const gauges = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/gauges.json"), "utf8"));
const src = JSON.parse(fs.readFileSync(OUT, "utf8"));
const REPLACED = ROUTES.filter((r) => r.replace).map((r) => r.basin);
const base = src.rivers.filter((r) => !r.x && !REPLACED.includes(r.b));
const drawn = base.filter((r) => r.b).map((r) => decode(r.d));
const allDrawn = base.map((r) => decode(r.d));
const coastPts = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/geo/coast.json"), "utf8")).rings.flatMap(decode);

const arc = await arcgisLines();
const added = [];
const near = (c, pts, r) => pts.some((p) => m(p, c) < r);
const addPath = (basin, pts, why, main = 0) => {
  // keep only the stretches that are not already drawn (so no double lines), plus one point either side
  const far = pts.map((p) => distToLines(p, allDrawn) > 60);
  let i = 0;
  while (i < pts.length) {
    if (!far[i]) { i++; continue; }
    let j = i;
    while (j + 1 < pts.length && far[j + 1]) j++;
    const piece = pts.slice(Math.max(0, i - 1), Math.min(pts.length, j + 2));
    const g = dp(piece, 0.0005).filter((p, k, a) => k === 0 || Math.round(p[0] * 1e4) !== Math.round(a[k - 1][0] * 1e4) || Math.round(p[1] * 1e4) !== Math.round(a[k - 1][1] * 1e4));
    if (g.length >= 2) added.push({ n: "", b: basin, m: main, x: 1, d: encode(g), why });
    i = j + 1;
  }
};

const replaced = new Set(ROUTES.filter((r) => r.replace).map((r) => r.basin));
for (const g of gauges) {
  if (replaced.has(g.river)) continue; // drawn by its route below
  const d0 = distToLines([g.lon, g.lat], drawn);
  if (d0 <= NEAR_M) continue;
  const arcNear = Math.min(...arc.map((p) => distToLines([g.lon, g.lat], [p])));
  const ways = [...arc];
  if (arcNear > NEAR_M) ways.push(...(await osmNear(g)));
  const G = makeGraph(ways);
  const s = nearestVertex(G, [g.lon, g.lat]);
  // the drawn network first; if no path reaches it (a river with no drawn line), the coast
  const drawnPts = drawn.flat();
  let r = shortest(G, s, (u) => near(G.V[u].c, drawnPts, TARGET_M));
  let end = "network";
  if (!r) { r = shortest(G, s, (u) => near(G.V[u].c, coastPts, 400)); end = "coast"; }
  if (!r) {
    // a river with no drawn line and no coast in reach (Mee Oya): follow the connected ArcGIS lines to
    // their westmost point, the mouth side (every basin without a drawn line drains west here)
    const seen = new Set([s]), st = [s];
    while (st.length) { const u = st.pop(); for (const [v] of G.adj[u]) if (!seen.has(v)) { seen.add(v); st.push(v); } }
    const mouth = [...seen].reduce((a, b) => (G.V[b].c[0] < G.V[a].c[0] ? b : a));
    r = shortest(G, s, (u) => u === mouth);
    end = "mouth (westmost connected point)";
  }
  if (!r) { console.log(`${g.station}: no path found`); continue; }
  console.log(`${g.station}: ${(d0 / 1000).toFixed(1)} km off -> path ${r.km.toFixed(1)} km to ${end} (ArcGIS nearest ${Math.round(arcNear)} m${arcNear > NEAR_M ? ", OSM added" : ""})`);
  // a basin with no drawn line at all gets this stem as its main river (the river page needs one)
  addPath(g.river, r.path, g.station, end.startsWith("mouth") && !base.some((x) => x.b === g.river) ? 1 : 0);
}
for (const rt of ROUTES) {
  const wps = rt.via.map((v) => (typeof v === "string" ? (({ lon, lat }) => [lon, lat])(gauges.find((x) => x.id === v)) : v));
  const g0 = gauges.find((x) => x.id === rt.via.find((v) => typeof v === "string"));
  const osm = [];
  for (const body of rt.osm ?? []) {
    try { const j = await overpass(`extras-route-${rt.basin.replace(/\W/g, "_")}-${osm.length}`, `[out:json][timeout:90];${body}out geom;`); osm.push(...j.elements.filter((e) => e.geometry).map((e) => e.geometry.map((p) => [p.lon, p.lat]))); }
    catch (e) { console.error(`  OSM unavailable for route ${rt.basin}: ${e.message}`); }
  }
  const G = makeGraph([...arc, ...osm, ...(await osmNear(g0))], 150);
  let line = [];
  for (let k = 0; k + 1 < wps.length; k++) {
    const r = shortest(G, nearestVertex(G, wps[k]), (u) => m(G.V[u].c, wps[k + 1]) < 150);
    if (!r) { console.log(`route ${rt.basin} leg ${k}: no path, bridged with a straight line`); line.push(wps[k], wps[k + 1]); continue; }
    console.log(`route ${rt.basin} leg ${k}: ${r.km.toFixed(1)} km`);
    line.push(...r.path);
  }
  if (rt.toSea) {
    const r = shortest(G, nearestVertex(G, wps.at(-1)), (u) => near(G.V[u].c, coastPts, 400));
    console.log(r ? `route ${rt.basin} to sea: ${r.km.toFixed(1)} km` : `route ${rt.basin}: no path from the lagoon to the sea (line ends at the lagoon)`);
    if (r) line.push(...r.path);
  }
  const g = dp(line.filter((p, k, a) => k === 0 || m(p, a[k - 1]) > 1), 0.0005);
  added.push({ n: "", b: rt.basin, m: rt.main ? 1 : 0, x: 1, d: encode(g) });
}
src.rivers = [...base, ...added.map(({ why, ...r }) => r)];
fs.writeFileSync(OUT, JSON.stringify(src));
console.log(`added ${added.length} lines, ${added.reduce((s, r) => s + r.d.length / 2, 0)} points; rivers.json ${fs.statSync(OUT).size} bytes`);
