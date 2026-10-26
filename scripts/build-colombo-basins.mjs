// Builds lib/geo/colombo-basins.json: the four canal basins as smooth, gap-free, non-overlapping areas.
//   node scripts/build-colombo-basins.mjs
// Method (approximate, documented in DOCS.md "Canal map"): every 100 m cell inside the hand-drawn envelope
// (lib/geo/colombo-basins-seed.json), on land (OpenStreetMap coastline, lib/geo/colombo-coast.json) and within 1 km of a canal or lake
// takes the basin of its NEAREST canal line (the OpenStreetMap canals in lib/geo/colombo-canals.json, each tagged with its
// basin). The divide between two basins therefore falls half way between their canals, which is where a drainage divide
// roughly lies. Edges are traced once and shared by both neighbours, simplified and smoothed (Chaikin), so neighbours never
// overlap or leave gaps. Not an official catchment boundary: the map labels it "approximate".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const canals = rd("lib/geo/colombo-canals.json");
const seed = rd("lib/geo/colombo-basins-seed.json").basins;
// Coast: the OSM coastline south of 6.9205 N; through the Colombo port (breakwaters and reclaimed land make the raw OSM line zig-zag)
// and up to the Kelani mouth a hand-simplified line along the shore, which is all the basin edge needs.
const coastRing = (() => {
  const l = rd("lib/geo/colombo-coast.json").line.filter((p) => p[0] < 6.9205);
  const north = [[7.0, 79.8555], [6.96, 79.8552], [6.9534, 79.8536], [6.9478, 79.8526], [6.9415, 79.8493], [6.9283, 79.8412], [6.9205, 79.8454]];
  return [...north, ...l, [l[l.length - 1][0], 79.99], [7.0, 79.99]];
})(); // land = east of the coast, closed to the east
const IDS = seed.map((b) => b.id);
const [S, W, N, E] = [6.84, 79.84, 6.99, 79.95];
const CELL = 0.0009, CUT_M = 1000, KX = 0.993;
const NX = Math.ceil((E - W) / CELL), NY = Math.ceil((N - S) / CELL);
const inRing = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j]; if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const dec = (a) => { const o = []; let x = 0, y = 0; for (let i = 0; i + 1 < a.length; i += 2) { x += a[i]; y += a[i + 1]; o.push([x / 1e5, y / 1e5]); } return o; };

// seeds: dense points along canals and lake edges, with their basin
const seeds = [];
const addLine = (pts, b) => { for (let i = 0; i < pts.length - 1; i++) { const n = Math.max(1, Math.ceil((Math.hypot(pts[i + 1][0] - pts[i][0], (pts[i + 1][1] - pts[i][1]) * KX) * 111200) / 60)); for (let k = 0; k < n; k++) seeds.push([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n, b]); } };
for (const l of canals.lines) if (l.b && l.k !== "r") addLine(dec(l.p), l.b);
for (const w of canals.waters) { const r = dec(w.r); const c = [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; const b = seed.find((s) => inRing(c, s.ring))?.id; if (b) addLine(r, b); }
console.log("seeds", seeds.length, seeds[0], seeds.filter(s=>s[2]).length);

const lab = new Uint8Array(NX * NY);
const cutDeg = CUT_M / 111200;
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const c = [S + (j + 0.5) * CELL, W + (i + 0.5) * CELL];
  if (!seed.some((b) => inRing(c, b.ring)) || !inRing(c, coastRing)) continue;
  let best = 1e9, bl = -1;
  for (const s of seeds) { const dy = s[0] - c[0]; if (dy > cutDeg || dy < -cutDeg) continue; const d = dy * dy + ((s[1] - c[1]) * KX) ** 2; if (d < best) { best = d; bl = s[2]; } }
  if (bl !== -1 && Math.sqrt(best) <= cutDeg) lab[j * NX + i] = IDS.indexOf(bl) + 1;
}
console.log("labelled", lab.reduce((s,v)=>s+(v>0),0), "of", lab.length);
const at = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NY ? 0 : lab[j * NX + i]);
// clean: majority filter, then drop small islands and fill small holes
for (let pass = 0; pass < 3; pass++) {
  const nxt = lab.slice();
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const cnt = {}; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) { const v = at(i + di, j + dj); cnt[v] = (cnt[v] || 0) + 1; }
    const [bv, bc] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    if (+bv !== lab[j * NX + i] && bc >= 5) nxt[j * NX + i] = +bv;
  }
  lab.set(nxt);
}
function comps(match) { const seen = new Uint8Array(NX * NY), out = []; for (let s = 0; s < lab.length; s++) { if (seen[s] || !match(lab[s])) continue; const v = lab[s], st = [s], cells = []; seen[s] = 1; while (st.length) { const c = st.pop(); cells.push(c); const ci = c % NX, cj = (c / NX) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue; const n = nj * NX + ni; if (!seen[n] && lab[n] === v) { seen[n] = 1; st.push(n); } } } out.push({ v, cells }); } return out; }
for (const c of comps((v) => v > 0)) if (c.cells.length < 60) for (const x of c.cells) lab[x] = 0;
for (const c of comps((v) => v === 0)) { const touches = c.cells.some((x) => { const i = x % NX, j = (x / NX) | 0; return i === 0 || j === 0 || i === NX - 1 || j === NY - 1; }); if (!touches && c.cells.length < 150) { const cnt = {}; for (const x of c.cells) { const i = x % NX, j = (x / NX) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = at(i + di, j + dj); if (v) cnt[v] = (cnt[v] || 0) + 1; } } const b = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; if (b) for (const x of c.cells) lab[x] = +b[0]; } }

// edges on the vertex lattice, with the label on each side
const key = (x, y) => y * (NX + 1) + x;
const adj = new Map(); const edges = new Map(); // "a-b" -> {L,R}
const add = (a, b, L, R) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; edges.set(k, { a, b, L, R }); for (const [p, q] of [[a, b], [b, a]]) { if (!adj.has(p)) adj.set(p, []); adj.get(p).push(q); } };
for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) { const l = at(i - 1, j), r = at(i, j); if (l !== r) add(key(i, j), key(i, j + 1), l, r); } // moving +y: left = west cell
for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) { const dn = at(i, j - 1), up = at(i, j); if (dn !== up) add(key(i, j), key(i + 1, j), up, dn); } // moving +x: left = north cell
const xy = (k) => [k % (NX + 1), (k / (NX + 1)) | 0];
const isNode = (k) => adj.get(k).length !== 2;
const used = new Set(); const chains = [];
const ek = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
function walk(start, first) {
  const pts = [start]; let prev = start, cur = first; used.add(ek(prev, cur));
  while (true) { pts.push(cur); if (isNode(cur) || cur === start) break; const nx = adj.get(cur).find((q) => q !== prev && !used.has(ek(cur, q))) ?? adj.get(cur).find((q) => q !== prev); if (nx === undefined || used.has(ek(cur, nx))) break; used.add(ek(cur, nx)); prev = cur; cur = nx; }
  return pts;
}
const nodes = [...adj.keys()].filter(isNode);
const sidesOf = (a, b) => { const e = edges.get(ek(a, b)); return e.a === a ? { L: e.L, R: e.R } : { L: e.R, R: e.L }; };
for (const n of nodes) for (const q of adj.get(n)) if (!used.has(ek(n, q))) { const p = walk(n, q); chains.push({ p, ...sidesOf(p[0], p[1]) }); }
for (const k of adj.keys()) for (const q of adj.get(k)) if (!used.has(ek(k, q))) { const p = walk(k, q); chains.push({ p, ...sidesOf(p[0], p[1]) }); }

function dp(pts, tol) { if (pts.length <= 2) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [a, b] = st.pop(); const dx = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1], l2 = dx * dx + dy * dy; let md = 0, mi = -1; for (let i = a + 1; i < b; i++) { const px = pts[i][0] - pts[a][0], py = pts[i][1] - pts[a][1]; const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0; const d = Math.hypot(px - t * dx, py - t * dy); if (d > md) { md = d; mi = i; } } if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } } return pts.filter((_, i) => keep[i]); }
function chaikin(pts, closed) { let p = pts; for (let it = 0; it < 3; it++) { const o = []; const n = p.length; if (!closed) o.push(p[0]); for (let i = 0; i < (closed ? n : n - 1); i++) { const a = p[i], b = p[(i + 1) % n]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } if (!closed) o.push(p[n - 1]); p = o; } return p; }
for (const c of chains) { const closed = c.p[0] === c.p[c.p.length - 1]; let pts = c.p.map(xy); if (closed && pts.length > 4) { pts = dp(pts.slice(0, -1), 0.8); c.pts = chaikin(pts, true); c.pts.push(c.pts[0]); } else { pts = dp(pts, 0.8); c.pts = chaikin(pts, false); } c.s = c.p[0]; c.e = c.p[c.p.length - 1]; }

const toLL = ([x, y]) => [Math.round((S + y * CELL) * 1e5) / 1e5, Math.round((W + x * CELL) * 1e5) / 1e5];
const out = [];
for (let li = 0; li < IDS.length; li++) {
  const l = li + 1; const segs = [];
  for (const c of chains) { if (c.L === l) segs.push({ pts: c.pts, s: c.s, e: c.e }); if (c.R === l) segs.push({ pts: [...c.pts].reverse(), s: c.e, e: c.s }); }
  const left = new Set(segs); const rings = [];
  while (left.size) { const first = left.values().next().value; left.delete(first); let ring = [...first.pts], end = first.e; while (end !== first.s) { const nx = [...left].find((s) => s.s === end); if (!nx) break; left.delete(nx); ring = ring.concat(nx.pts.slice(1)); end = nx.e; } rings.push(ring); }
  rings.sort((a, b) => b.length - a.length);
  out.push({ id: IDS[li], ring: rings[0].map(toLL) });
  console.log(IDS[li], "rings", rings.length, "pts", rings[0].length);
}
const f = path.join(ROOT, "lib/geo/colombo-basins.json");
fs.writeFileSync(f, JSON.stringify({ note: "Approximate basin areas: nearest-canal partition, smoothed (scripts/build-colombo-basins.mjs). Not official drainage boundaries.", basins: out }));
console.log(fs.statSync(f).size, "bytes");
