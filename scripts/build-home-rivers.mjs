// Builds lib/geo/home-rivers.json for the home page Leaflet map (app/MapLeaflet.tsx) from
// lib/geo/rivers.json (OpenStreetMap, built by build-river-geo.mjs). Same delta-encoded 1e-4 degree
// format, simplified further for zoom 7-10 (about 130 m), basin rivers only, tiny stubs dropped.
//   node scripts/build-home-rivers.mjs [toleranceDegrees]
// Data (c) OpenStreetMap contributors, ODbL: credited on the map.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOL = Number(process.argv[2] ?? 0.0012);
const src = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/geo/rivers.json"), "utf8"));

const decode = (d) => {
  const out = [];
  let x = 0, y = 0;
  for (let i = 0; i + 1 < d.length; i += 2) { x += d[i]; y += d[i + 1]; out.push([x / 1e4, y / 1e4]); }
  return out;
};
const KX = Math.cos((7.8 * Math.PI) / 180);
function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const dx = (pts[b][0] - pts[a][0]) * KX, dy = pts[b][1] - pts[a][1], l2 = dx * dx + dy * dy;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = (pts[i][0] - pts[a][0]) * KX, py = pts[i][1] - pts[a][1];
      const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const lenKm = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot((p[0] - pts[i][0]) * KX, p[1] - pts[i][1]) * 111.2, 0);
const encode = (pts) => {
  const d = [];
  let px = 0, py = 0;
  for (const [x, y] of pts) {
    const ix = Math.round(x * 1e4), iy = Math.round(y * 1e4);
    d.push(ix - px, iy - py);
    px = ix; py = iy;
  }
  return d;
};

const rivers = [];
for (const r of src.rivers) {
  if (!r.b) continue; // rivers of no gauged basin are only context on the river-page maps
  const pts = dp(decode(r.d), TOL);
  if (pts.length < 2 || lenKm(pts) < 0.4) continue;
  rivers.push({ b: r.b, m: r.m, d: encode(pts) });
}
const out = path.join(ROOT, "lib/geo/home-rivers.json");
fs.writeFileSync(out, JSON.stringify({ rivers }));
console.log(`${rivers.length} lines, ${rivers.reduce((s, r) => s + r.d.length / 2, 0)} points, ${fs.statSync(out).size} bytes`);
