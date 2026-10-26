// Builds lib/geo/colombo-coast.json: the OpenStreetMap coastline near Colombo as one north-to-south polyline [lat, lon]
// (land on the east side). Used only by scripts/build-colombo-basins.mjs to keep basin areas off the sea.
//   node scripts/build-colombo-coast.mjs [--from coast.json]    (Overpass, one request, build time only)
// Data (c) OpenStreetMap contributors, ODbL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const Q = `[out:json][timeout:60];way["natural"="coastline"](6.80,79.80,7.02,79.99);out geom;`;
let raw;
const fi = process.argv.indexOf("--from");
if (fi > 0) raw = JSON.parse(fs.readFileSync(process.argv[fi + 1], "utf8"));
else for (const u of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
  try { const r = await fetch(u, { method: "POST", headers: { "User-Agent": "sl-water-levels-build (+https://sl-water-levels.vercel.app; shakee.zats@gmail.com)", "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(Q), signal: AbortSignal.timeout(90000) }); if (r.ok) { raw = await r.json(); break; } } catch {}
}
if (!raw) throw new Error("Overpass unavailable");
const k = (p) => p.join(",");
const pool = raw.elements.map((e) => e.geometry.map((g) => [g.lat, g.lon]));
const chains = [];
while (pool.length) { let c = pool.shift(), ch = true; while (ch) { ch = false; for (let i = 0; i < pool.length; i++) { const w = pool[i]; if (k(w[0]) === k(c[c.length - 1])) c = c.concat(w.slice(1)); else if (k(w[w.length - 1]) === k(c[0])) c = w.slice(0, -1).concat(c); else continue; pool.splice(i, 1); ch = true; break; } } chains.push(c); }
let line = chains.sort((a, b) => b.length - a.length)[0];
if (line[0][0] < line[line.length - 1][0]) line = line.reverse(); // north to south
const KX = 0.993;
function dp(pts, tol) { if (pts.length <= 2) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [a, b] = st.pop(); const dx = (pts[b][1] - pts[a][1]) * KX, dy = pts[b][0] - pts[a][0], l2 = dx * dx + dy * dy; let md = 0, mi = -1; for (let i = a + 1; i < b; i++) { const px = (pts[i][1] - pts[a][1]) * KX, py = pts[i][0] - pts[a][0]; const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0; const d = Math.hypot(px - t * dx, py - t * dy); if (d > md) { md = d; mi = i; } } if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } } return pts.filter((_, i) => keep[i]); }
line = dp(line.filter((p) => p[0] <= 7.02 && p[0] >= 6.8), 0.00008).map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
const f = path.join(ROOT, "lib/geo/colombo-coast.json");
fs.writeFileSync(f, JSON.stringify({ source: "OpenStreetMap contributors (ODbL)", line }));
console.log(line.length, "points", fs.statSync(f).size, "bytes");
