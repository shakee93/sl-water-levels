// Builds lib/geo/*.json for the river map (app/RiverMap.tsx) from OpenStreetMap, once, at dev time.
//   node scripts/build-river-geo.mjs            fetch (cached), simplify, write lib/geo/
//   node scripts/build-river-geo.mjs --refetch  ignore the cache
// Overpass etiquette: one request at a time, >= 1.5 s apart, a User-Agent, small tiles, retry with
// back-off. Raw answers are cached in $TMPDIR/sl-osm-cache so re-running does not hit the API.
// Data (c) OpenStreetMap contributors, ODbL: shown on the map.
//
// Output (all coordinates in 1e-4 degrees, delta-encoded, see lib/geo/decode.ts):
//   rivers.json     { rivers: [{ n: "Name", b: "basin key", d: [x0,y0,dx,dy,...] }] }
//   coast.json      { rings: [[x0,y0,dx,dy,...]] }  land polygons (Sri Lanka and its larger islands)
//   reservoirs.json { slug: { d: [...] } }           lake outlines, only where OSM has a matching one
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "lib", "geo");
const CACHE = path.join(os.tmpdir(), "sl-osm-cache");
const REFETCH = process.argv.includes("--refetch");
const UA = "sl-water-levels-geo-build/1.0 (https://github.com/shakee93/sl-water-levels; shakee.zats@gmail.com)";
const ENDPOINT = "https://overpass-api.de/api/interpreter";
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function overpass(key, query) {
  const f = path.join(CACHE, key + ".json");
  if (!REFETCH && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  let wait = 5000;
  for (let i = 0; i < 6; i++) {
    const gap = Date.now() - last;
    if (gap < 1500) await sleep(1500 - gap);
    last = Date.now();
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) });
      const text = await res.text();
      if (res.ok && text.trim().startsWith("{")) {
        fs.writeFileSync(f, text);
        return JSON.parse(text);
      }
      console.error(`  ${key}: HTTP ${res.status}, retry in ${wait / 1000}s`);
    } catch (e) {
      console.error(`  ${key}: ${e.message}, retry in ${wait / 1000}s`);
    }
    await sleep(wait);
    wait *= 2;
  }
  throw new Error("Overpass gave up on " + key);
}

// ------------------------------------------------------------------ geometry helpers
const KX = Math.cos((7.8 * Math.PI) / 180);
function dpSimplify(pts, tol, keep = new Set()) {
  // Douglas-Peucker on [lon,lat]; indexes in `keep` always survive. Distances in degrees (lat scale).
  if (pts.length <= 2) return pts;
  const flag = new Uint8Array(pts.length);
  flag[0] = flag[pts.length - 1] = 1;
  keep.forEach((i) => (flag[i] = 1));
  const stack = [];
  let s = 0;
  for (let i = 1; i < pts.length; i++) if (flag[i]) { stack.push([s, i]); s = i; }
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = (bx - ax) * KX, dy = by - ay, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = (pts[i][0] - ax) * KX, py = pts[i][1] - ay;
      let t = l2 ? (px * dx + py * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { flag[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => flag[i]);
}
const q = (v) => Math.round(v * 1e4);
function encode(pts) {
  const out = [];
  let px = 0, py = 0;
  pts.forEach(([lon, lat], i) => {
    const x = q(lon), y = q(lat);
    out.push(i === 0 ? x : x - px, i === 0 ? y : y - py);
    px = x; py = y;
  });
  return out;
}
const lenKm = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot((p[0] - pts[i - 1][0]) * KX, p[1] - pts[i - 1][1]) * 111.2 : 0), 0);
const area = (ring) => ring.reduce((s, p, i) => { const n = ring[(i + 1) % ring.length]; return s + (p[0] * n[1] - n[0] * p[1]); }, 0) / 2;
const areaKm2 = (ring) => Math.abs(area(ring)) * KX * 111.2 * 111.2;

/** Join ways (each {nodes:[ids], geom:[[lon,lat]]}) end to end into closed or open chains. */
function joinWays(ways) {
  const used = new Set();
  const byEnd = new Map();
  ways.forEach((w, i) => {
    for (const id of [w.nodes[0], w.nodes[w.nodes.length - 1]]) {
      if (!byEnd.has(id)) byEnd.set(id, []);
      byEnd.get(id).push(i);
    }
  });
  const chains = [];
  for (let i = 0; i < ways.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let nodes = [...ways[i].nodes], geom = [...ways[i].geom];
    for (let guard = 0; guard < 5000; guard++) {
      const end = nodes[nodes.length - 1];
      if (end === nodes[0] && nodes.length > 2) break;
      const nxt = (byEnd.get(end) ?? []).find((j) => !used.has(j));
      if (nxt === undefined) break;
      used.add(nxt);
      let w = ways[nxt];
      if (w.nodes[0] !== end) w = { nodes: [...w.nodes].reverse(), geom: [...w.geom].reverse() };
      nodes = nodes.concat(w.nodes.slice(1));
      geom = geom.concat(w.geom.slice(1));
    }
    chains.push({ nodes, geom });
  }
  return chains;
}
const wayOf = (e) => ({ id: e.id, nodes: e.nodes ?? e.geometry.map((g) => `${g.lat},${g.lon}`), geom: e.geometry.map((g) => [g.lon, g.lat]), tags: e.tags ?? {} });

// ------------------------------------------------------------------ what we want
// OSM river names (matched lower-case on name / name:en, a substring test) per basin, limited to a
// box [south, west, north, east] because OSM names repeat across the island (Kuda Oya, Maguru...).
// The first entry is the main stem; the rest are tributaries. Only rivers we are sure belong to the
// basin are listed: a gauge whose river OSM does not have (Deraniyagala, Holombuwa) is simply drawn
// where the feed puts it, off any line, and the map says nothing more about it.
const BASINS = {
  "Kelani Ganga": { box: [6.7, 79.8, 7.4, 80.75], names: ["kelani ganga", "kelani river", "seethawaka"] },
  "Mahaweli Ganga": { box: [6.7, 80.4, 8.6, 81.5], names: ["mahaweli", "kotmale oya", "nanu oya", "hassalaka", "amban ganga", "amban gaga", "uma oya", "badulu oya", "heen ganga"] },
  "Kalu Ganga": { box: [6.4, 80.0, 6.9, 80.7], names: ["kaluganga", "kuda gaga", "wey ganga", "kukule"] },
  "Nilwala Ganga": { box: [5.9, 80.3, 6.4, 80.7], names: ["nilwala ganga"] },
  "Kirindi Oya": { box: [6.2, 80.9, 6.9, 81.4], names: ["krindi oya", "kirindi oya", "kuda oya"] },
  "Gin Ganga": { box: [6.0, 80.1, 6.5, 80.6], names: ["gin ganga"] },
  "Maha Oya": { box: [7.1, 79.8, 7.6, 80.7], names: ["maha oya"] },
  "Deduru Oya": { box: [7.4, 79.7, 7.9, 80.6], names: ["deduru oya", "maguru oya"] },
  "Walawe Ganga": { box: [6.0, 80.5, 6.9, 81.2], names: ["walawe ganga", "walawe river", "belihul oya"] },
  "Gal Oya": { box: [7.0, 81.3, 7.6, 81.9], names: ["gal oya"] },
  "Malwathu Oya": { box: [8.2, 79.9, 8.9, 80.6], names: ["malwathu oya"] },
  "Kala Oya": { box: [7.9, 79.8, 8.6, 80.7], names: ["kala oya"] },
  "Yan Oya": { box: [8.4, 80.5, 9.0, 81.1], names: ["yan oya"] },
  "Ma Oya": { box: [8.5, 80.5, 9.1, 81.0], names: ["ma oya"] },
  "Mee Oya": { box: [7.8, 80.0, 8.2, 80.7], names: ["mee oya"] },
  "Maduru Oya": { box: [7.2, 80.9, 7.9, 81.5], names: ["maduru oya"] },
  "Heda Oya": { box: [6.6, 81.4, 7.0, 82.0], names: ["heda oya"] },
  "Kumbukkan Oya": { box: [6.6, 81.0, 7.2, 81.8], names: ["kumbukkan oya"] },
  "Menik Ganga": { box: [6.3, 81.0, 7.0, 81.5], names: ["menik ganga"] },
  "Aththanagalu Oya": { box: [6.9, 79.8, 7.3, 80.3], names: ["attanagalu"] },
};
const CONTEXT_MIN_KM = 28; // other named rivers at least this long (summed) are drawn faint

const inBox = (b, [lon, lat]) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];

async function fetchAll() {
  const TILES = [];
  for (let la = 5.8; la < 9.95; la += 1.04) for (let lo = 79.4; lo < 82.05; lo += 1.3) TILES.push([la, lo, la + 1.04, lo + 1.3]);
  const rivers = new Map();
  let t = 0;
  for (const [s, w, n, e] of TILES) {
    console.log("rivers tile", ++t, "/", TILES.length);
    const j = await overpass(`rivers-${s.toFixed(2)}-${w.toFixed(2)}`, `[out:json][timeout:120];way["waterway"="river"](${s},${w},${n},${e});out geom tags;`);
    for (const el of j.elements) if (el.type === "way" && el.geometry) rivers.set(el.id, wayOf(el));
  }
  const coast = new Map();
  t = 0;
  for (const [s, w, n, e] of [[5.7, 79.4, 7.0, 82.1], [7.0, 79.4, 8.4, 82.1], [8.4, 79.4, 10.0, 82.1]]) {
    console.log("coast tile", ++t);
    const j = await overpass(`coast-${s}`, `[out:json][timeout:180];way["natural"="coastline"](${s},${w},${n},${e});out geom;`);
    for (const el of j.elements) if (el.type === "way" && el.geometry) coast.set(el.id, wayOf(el));
  }
  return { rivers, coast };
}

function buildRivers(rivers) {
  const nameOf = (w) => `${w.tags.name ?? ""} ${w.tags["name:en"] ?? ""}`.toLowerCase();
  const picked = [];
  const ctxNames = new Map();
  for (const w of rivers.values()) {
    const nm = nameOf(w);
    let basin = null, main = false;
    for (const [b, c] of Object.entries(BASINS)) {
      const k = c.names.findIndex((x) => nm.includes(x));
      if (k >= 0 && w.geom.some((p) => inBox(c.box, p))) { basin = b; main = k === 0; break; }
    }
    if (basin) picked.push({ w, b: basin, m: main, n: w.tags["name:en"] ?? w.tags.name });
    else if (nm.trim()) ctxNames.set(nm.trim(), [...(ctxNames.get(nm.trim()) ?? []), w]);
  }
  for (const ws of ctxNames.values()) {
    if (ws.reduce((s, w) => s + lenKm(w.geom), 0) >= CONTEXT_MIN_KM) for (const w of ws) picked.push({ w, b: "", m: false, n: w.tags["name:en"] ?? w.tags.name });
  }
  // junction nodes (shared by two ways) must survive simplification so the network stays connected
  const count = new Map();
  for (const { w } of picked) for (const id of new Set(w.nodes)) count.set(id, (count.get(id) ?? 0) + 1);
  const out = [];
  let pts = 0;
  for (const { w, b, m, n } of picked) {
    const keep = new Set();
    w.nodes.forEach((id, i) => { if ((count.get(id) ?? 0) > 1) keep.add(i); });
    const tol = b ? 0.0005 : 0.0018;
    let g = dpSimplify(w.geom, tol, keep);
    // drop consecutive points that quantise to the same 1e-4 cell
    g = g.filter((p, i) => i === 0 || q(p[0]) !== q(g[i - 1][0]) || q(p[1]) !== q(g[i - 1][1]));
    if (g.length < 2) continue;
    pts += g.length;
    out.push({ n: String(n).replace(/[^\x20-\x7e]/g, "").trim() || "", b, m: m ? 1 : 0, d: encode(g) });
  }
  const basinCount = {};
  out.forEach((r) => r.b && (basinCount[r.b] = (basinCount[r.b] ?? 0) + 1));
  console.log("river ways kept:", out.length, "points:", pts, basinCount);
  return out;
}

function buildCoast(coast) {
  const chains = joinWays([...coast.values()]);
  const rings = [];
  for (const c of chains) {
    if (c.nodes.length < 4 || c.nodes[0] !== c.nodes[c.nodes.length - 1]) continue;
    const a = areaKm2(c.geom);
    if (a < 4) continue;
    let g = dpSimplify(c.geom.slice(0, -1), 0.0009);
    g = g.filter((p, i) => i === 0 || q(p[0]) !== q(g[i - 1][0]) || q(p[1]) !== q(g[i - 1][1]));
    rings.push({ a, d: encode(g), n: g.length });
  }
  rings.sort((x, y) => y.a - x.a);
  console.log("coast rings:", rings.map((r) => `${r.a.toFixed(0)}km2/${r.n}pts`).join(", "));
  return rings.map((r) => r.d);
}

function parseReservoirCoords() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "reservoirCoords.ts"), "utf8");
  const out = {};
  for (const m of src.matchAll(/^\s*"?([a-z0-9-]+)"?: \{ lat: ([\d.]+), lon: ([\d.]+)/gm)) out[m[1]] = { lat: +m[2], lon: +m[3] };
  return out;
}
const hav = (a, b) => Math.hypot((a[0] - b[0]) * KX, a[1] - b[1]) * 111.2;
function inRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

async function buildLakes() {
  const coords = parseReservoirCoords();
  const out = {};
  // maussakele: the only tagged polygon is 7.5 km2, several times the reservoir, so it is not trusted.
  const SKIP = new Set(["maussakele"]);
  for (const [slug, c] of Object.entries(coords)) {
    if (SKIP.has(slug)) continue;
    const j = await overpass(`lake-${slug}`, `[out:json][timeout:60];(way["natural"="water"](around:5000,${c.lat},${c.lon});relation["natural"="water"](around:5000,${c.lat},${c.lon}););out geom;`);
    const words = slug.split("-").filter((x) => !["wewa", "tank", "oya", "samudraya", "dam", "reservoir"].includes(x));
    const cands = [];
    for (const el of j.elements) {
      let rings = [];
      if (el.type === "way" && el.geometry) rings = [el.geometry.map((g) => [g.lon, g.lat])];
      else if (el.type === "relation") {
        const ws = (el.members ?? []).filter((m) => m.role === "outer" && m.geometry && m.ref).map((m) => ({ nodes: m.geometry.map((g) => `${g.lat},${g.lon}`), geom: m.geometry.map((g) => [g.lon, g.lat]) }));
        rings = joinWays(ws).filter((r) => r.nodes.length > 3 && r.nodes[0] === r.nodes[r.nodes.length - 1]).map((r) => r.geom);
      }
      for (const ring of rings) {
        if (ring.length < 4) continue;
        const a = areaKm2(ring);
        const nm = `${el.tags?.name ?? ""} ${el.tags?.["name:en"] ?? ""}`.toLowerCase();
        const pt = [c.lon, c.lat];
        const dmin = Math.min(...ring.map((p) => hav(p, pt)));
        const contains = inRing(pt, ring);
        const named = words.length > 0 && words.every((w) => nm.includes(w.slice(0, 5)));
        if (a < 0.15) continue;
        const reservoirTag = el.tags?.water === "reservoir" || el.tags?.landuse === "reservoir";
        // a lake counts when OSM names it like the reservoir, or tags it as a reservoir right at the point
        if ((named && dmin < 6) || (reservoirTag && (contains || dmin < 0.5) && a > 0.8)) cands.push({ ring, a, named, dmin, nm: nm.trim() });
      }
    }
    cands.sort((x, y) => Number(y.named) - Number(x.named) || y.a - x.a);
    const best = cands[0];
    if (!best) { console.log("lake", slug, "- none"); continue; }
    let g = dpSimplify(best.ring.slice(0, -1), 0.0007);
    g = g.filter((p, i) => i === 0 || q(p[0]) !== q(g[i - 1][0]) || q(p[1]) !== q(g[i - 1][1]));
    out[slug] = { d: encode(g) };
    console.log("lake", slug, `${best.a.toFixed(1)}km2`, best.named ? `named "${best.nm}"` : "unnamed/contains", `${best.dmin.toFixed(1)}km`, g.length + "pts");
  }
  return out;
}

async function main() {
  const { rivers, coast } = await fetchAll();
  console.log("river ways:", rivers.size, "coast ways:", coast.size);
  const r = buildRivers(rivers);
  const c = buildCoast(coast);
  const l = await buildLakes();
  const w = (f, o) => { const s = JSON.stringify(o); fs.writeFileSync(path.join(OUT, f), s); console.log(f, (s.length / 1024).toFixed(1), "KB"); return s.length; };
  const total = w("rivers.json", { rivers: r }) + w("coast.json", { rings: c }) + w("reservoirs.json", l);
  console.log("total", (total / 1024).toFixed(1), "KB");
}
await main();
