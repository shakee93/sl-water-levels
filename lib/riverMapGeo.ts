// The river map on real geometry: OpenStreetMap river lines and coast (lib/geo, built by
// scripts/build-river-geo.mjs), gauges and dams snapped onto the river, the release path walked
// along the actual river course. Pure functions, no React. Returns null when OpenStreetMap has no
// verified line for this basin (or none near its gauges): the caller then draws the old schematic.

import { COAST, LAKES, RIVER_WAYS, type LL, type RiverWay } from "./geo/geo";
import { MAP_W, placeLabels, type Box, type GaugeIn, type MapModel, type MapNode, type ReservoirIn, type TownIn } from "./riverMap";

const PAD_X = 30;
const PAD_Y = 30;
const MIN_H0 = 300;
const MAX_H0 = 470;
const SNAP_GAUGE_KM = 5;
const SNAP_DAM_KM = 2.5;
const KM = 111.2; // km per degree of latitude

type P = { x: number; y: number };
const num = (n: number) => (Math.round(n * 10) / 10).toString();
const pathOf = (pts: P[], close = false) => pts.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`).join("") + (close ? "Z" : "");

// ---------------------------------------------------------------- the river network of a basin
type Graph = { nodes: LL[]; adj: { to: number; w: number }[][]; index: Map<string, number> };
const graphCache = new Map<string, Graph>();
const key = (p: LL) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;

function buildGraph(basin: string, ways: RiverWay[], kx: number): Graph {
  const hit = graphCache.get(basin);
  if (hit) return hit;
  const nodes: LL[] = [];
  const index = new Map<string, number>();
  const adj: { to: number; w: number }[][] = [];
  const id = (p: LL) => {
    const k = key(p);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      index.set(k, i);
      nodes.push(p);
      adj.push([]);
    }
    return i;
  };
  const km = (a: LL, b: LL) => Math.hypot((a[0] - b[0]) * kx, a[1] - b[1]) * KM;
  const link = (a: number, b: number) => {
    if (a === b) return;
    const w = km(nodes[a], nodes[b]);
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
  };
  const ends: number[] = [];
  for (const w of ways) {
    let prev = id(w.pts[0]);
    ends.push(prev);
    for (let i = 1; i < w.pts.length; i++) {
      const cur = id(w.pts[i]);
      link(prev, cur);
      prev = cur;
    }
    ends.push(prev);
  }
  // OpenStreetMap rivers have gaps; join pieces whose ends are under 2.5 km apart so a release can
  // be followed through them (the gap itself is not drawn as river).
  const comp = nodes.map((_, i) => i);
  const find = (i: number): number => (comp[i] === i ? i : (comp[i] = find(comp[i])));
  adj.forEach((l, i) => l.forEach((e) => (comp[find(i)] = find(e.to))));
  for (let guard = 0; guard < 60; guard++) {
    let best: { a: number; b: number; d: number } | null = null;
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        if (find(ends[i]) === find(ends[j])) continue;
        const d = km(nodes[ends[i]], nodes[ends[j]]);
        if (d < 2.5 && (!best || d < best.d)) best = { a: ends[i], b: ends[j], d };
      }
    }
    if (!best) break;
    link(best.a, best.b);
    comp[find(best.a)] = find(best.b);
  }
  const g = { nodes, adj, index };
  graphCache.set(basin, g);
  return g;
}

function nearestNode(g: Graph, p: LL, kx: number): number {
  let best = 0;
  let bd = Infinity;
  g.nodes.forEach((n, i) => {
    const d = (n[0] - p[0]) ** 2 * kx * kx + (n[1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function dijkstra(g: Graph, from: number, to: number): number[] | null {
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  const prev = new Int32Array(g.nodes.length).fill(-1);
  const heap: [number, number][] = [[0, from]];
  dist[from] = 0;
  const push = (it: [number, number]) => {
    heap.push(it);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === to) break;
    for (const e of g.adj[u]) {
      const nd = d + e.w;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; push([nd, e.to]); }
    }
  }
  if (!isFinite(dist[to])) return null;
  const out: number[] = [];
  for (let u = to; u !== -1; u = prev[u]) out.push(u);
  return out.reverse();
}

/** Nearest point on any river line, in km. */
function snap(ways: RiverWay[], p: LL, kx: number): { pt: LL; d: number } | null {
  let best: { pt: LL; d: number } | null = null;
  for (const w of ways) {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], b = w.pts[i + 1];
      const dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      let t = l2 ? (((p[0] - a[0]) * kx) * dx + (p[1] - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const d = Math.hypot((p[0] - x) * kx, p[1] - y) * KM;
      if (!best || d < best.d) best = { pt: [x, y], d };
    }
  }
  return best;
}

// ---------------------------------------------------------------- pixel-space clipping and thinning
type Rect = { x0: number; y0: number; x1: number; y1: number };

function dp(pts: P[], tol: number): P[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st: [number, number][] = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!;
    const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y, l2 = dx * dx + dy * dy;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      let t = l2 ? ((pts[i].x - pts[a].x) * dx + (pts[i].y - pts[a].y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pts[i].x - pts[a].x - t * dx, pts[i].y - pts[a].y - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Split a polyline into the runs that fall inside the rectangle (cheap: whole segments, by endpoint). */
function runsInside(pts: P[], r: Rect): P[][] {
  const inside = (p: P) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
  const out: P[][] = [];
  let cur: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const segIn = inside(a) || (i > 0 && inside(pts[i - 1])) || (i + 1 < pts.length && inside(pts[i + 1]));
    if (segIn) cur.push(a);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.filter((c) => c.length >= 2);
}

/** Sutherland-Hodgman against a rectangle (fine for fills). */
function clipPoly(pts: P[], r: Rect): P[] {
  const edges: [(p: P) => boolean, (a: P, b: P) => P][] = [
    [(p) => p.x >= r.x0, (a, b) => ({ x: r.x0, y: a.y + ((b.y - a.y) * (r.x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= r.x1, (a, b) => ({ x: r.x1, y: a.y + ((b.y - a.y) * (r.x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= r.y0, (a, b) => ({ y: r.y0, x: a.x + ((b.x - a.x) * (r.y0 - a.y)) / (b.y - a.y) })],
    [(p) => p.y <= r.y1, (a, b) => ({ y: r.y1, x: a.x + ((b.x - a.x) * (r.y1 - a.y)) / (b.y - a.y) })],
  ];
  let out = pts;
  for (const [ins, cut] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      if (ins(a)) { out.push(a); if (!ins(b)) out.push(cut(a, b)); } else if (ins(b)) out.push(cut(a, b));
    }
    if (!out.length) return [];
  }
  return out;
}

const inRing = (p: P, ring: P[]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (ring[i].y > p.y !== ring[j].y > p.y && p.x < ((ring[j].x - ring[i].x) * (p.y - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) c = !c;
  }
  return c;
};

// ---------------------------------------------------------------- the map
export type GeoInput = {
  basin: string;
  gauges: GaugeIn[];
  reservoirs: ReservoirIn[];
  /** Candidate towns; the builder keeps a few near the river. */
  towns: TownIn[];
  seaLabel: string;
  /** The station this page is about, if any. */
  focusStation?: string;
  /** The reservoir (slug) this page is about: the map frames it, its gauges below and the river to the sea. */
  focusReservoir?: string;
  /** Drawing width in map units (default 360, the phone map; the wide map uses more). */
  width?: number;
};

export function buildGeoMap(input: GeoInput): MapModel | null {
  const W = input.width ?? MAP_W;
  const MIN_H = W > MAP_W ? 200 : MIN_H0;
  const MAX_H = W > MAP_W ? 330 : MAX_H0;
  const { gauges, reservoirs } = input;
  const ways = RIVER_WAYS.filter((w) => w.basin === input.basin.trim());
  if (ways.length === 0) return null;

  const all = ways.flatMap((w) => w.pts);
  const midLat = all.reduce((s, p) => s + p[1], 0) / all.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const graph = buildGraph(input.basin.trim(), ways, kx);

  // gauges: snapped onto the river when it is within 5 km, otherwise left where the feed puts them
  const gAt = new Map<string, { ll: LL; snapped: boolean }>();
  for (const g of gauges) {
    const s = snap(ways, [g.lon, g.lat], kx);
    gAt.set(g.station, s && s.d <= SNAP_GAUGE_KM ? { ll: s.pt, snapped: true } : { ll: [g.lon, g.lat], snapped: false });
  }
  // reservoirs: lake outline if OSM has one, else snapped onto the river when it is close
  const rAt = new Map<string, { ll: LL; attach: LL | null }>();
  for (const r of reservoirs) {
    const s = snap(ways, [r.lon, r.lat], kx);
    const hasLake = !!LAKES[r.slug];
    const onRiver = s && s.d <= SNAP_DAM_KM;
    rAt.set(r.slug, { ll: onRiver && !hasLake ? s.pt : [r.lon, r.lat], attach: s && s.d <= 8 ? s.pt : null });
  }
  // Nothing of this basin's river anywhere near its points: not a map we can stand behind.
  const near = gauges.filter((g) => gAt.get(g.station)!.snapped).length + reservoirs.filter((r) => rAt.get(r.slug)!.attach).length;
  if (near === 0) return null;

  // the mouth: the end of the main river that is closest to the coast
  const coastPts = COAST.flat();
  let mouth: LL | null = null;
  let mouthCoast: LL | null = null;
  let md = Infinity;
  for (const w of ways.filter((x) => x.main)) {
    for (const e of [w.pts[0], w.pts[w.pts.length - 1]]) {
      let d = Infinity;
      let nc: LL | null = null;
      for (const c of coastPts) {
        const dd = Math.hypot((c[0] - e[0]) * kx, c[1] - e[1]) * KM;
        if (dd < d) { d = dd; nc = c; }
      }
      if (d < md) { md = d; mouth = e; mouthCoast = nc; }
    }
  }
  if (md > 6) { mouth = null; mouthCoast = null; }

  // towns: a few that sit near the river, spread out
  const towns: TownIn[] = [];
  const anchors = [...gAt.values()].map((g) => g.ll);
  const cand = input.towns
    .map((t) => ({ t, rd: snap(ways, [t.lon, t.lat], kx)?.d ?? 99, gd: Math.min(...anchors.map((a) => Math.hypot((a[0] - t.lon) * kx, a[1] - t.lat) * KM)) }))
    .filter((c) => c.rd <= 10)
    .sort((a, b) => a.gd - b.gd);
  for (const c of cand) {
    if (towns.length >= 6) break;
    if (towns.some((o) => Math.hypot((o.lon - c.t.lon) * kx, o.lat - c.t.lat) * KM < 5)) continue;
    towns.push(c.t);
  }

  // ---- fit: gauges, dams, the mouth and the nearest town (so a one-gauge river is still a place)
  // On a reservoir page: that reservoir, the gauges below it and the river down to the sea.
  const fr = input.focusReservoir ? reservoirs.find((r) => r.slug === input.focusReservoir) : undefined;
  if (input.focusReservoir && (!fr || !rAt.get(fr.slug)!.attach)) return null;
  const fit: LL[] = [];
  if (fr) {
    fit.push(rAt.get(fr.slug)!.ll);
    for (const st of fr.linked) if (gAt.get(st)?.snapped) fit.push(gAt.get(st)!.ll);
  }
  if (!fr || fit.length < 2) {
    fit.push(...[...gAt.values()].map((g) => g.ll));
    for (const r of reservoirs) fit.push(rAt.get(r.slug)!.ll);
  }
  if (mouth) {
    fit.push(mouth);
    // leave room for open water beyond the mouth (for the sea label): continue away from the river
    const cx = fit.reduce((t, q) => t + q[0], 0) / fit.length, cy = fit.reduce((t, q) => t + q[1], 0) / fit.length;
    const dx = (mouth[0] - cx) * kx, dy = mouth[1] - cy, dl = Math.hypot(dx, dy);
    if (dl > 0.01) fit.push([mouth[0] + (dx / dl / kx) * 0.13, mouth[1] + (dy / dl) * 0.13]);
  }
  if (towns[0] && !fit.some((p) => Math.hypot((p[0] - towns[0].lon) * kx, p[1] - towns[0].lat) * KM < 1)) fit.push([towns[0].lon, towns[0].lat]);
  const lons = fit.map((p) => p[0]), lats = fit.map((p) => p[1]);
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2, cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kxm = Math.cos((cLat * Math.PI) / 180);
  const bw = Math.max((Math.max(...lons) - Math.min(...lons)) * kxm, 0.06);
  const bh = Math.max(Math.max(...lats) - Math.min(...lats), 0.06);
  const availW = W - 2 * PAD_X;
  const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, availW * (bh / bw) + 2 * PAD_Y)));
  const s = Math.min(availW / bw, (h - 2 * PAD_Y) / bh);
  const proj = (p: LL): P => ({ x: W / 2 + (p[0] - cLon) * kxm * s, y: h / 2 - (p[1] - cLat) * s });
  const view: Rect = { x0: -24, y0: -24, x1: W + 24, y1: h + 24 };
  const kmPx = s / KM;

  // ---- land, other rivers, this basin's rivers
  const land: P[][] = [];
  for (const ring of COAST) {
    const c = clipPoly(ring.map(proj), view);
    if (c.length >= 3) land.push(dp(c, 0.4));
  }
  const strokeRuns = (list: RiverWay[], tol: number) =>
    list.flatMap((w) => runsInside(w.pts.map(proj), view).map((run) => dp(run, tol)));
  const strokes = (list: RiverWay[], tol: number) => strokeRuns(list, tol).map((r) => pathOf(r));
  const context = strokes(RIVER_WAYS.filter((w) => w.basin !== input.basin.trim()), 0.6);
  const mainRuns = strokeRuns(ways.filter((w) => w.main), 0.35);
  const tribRuns = strokeRuns(ways.filter((w) => !w.main), 0.35);
  const mainPaths = mainRuns.map((r) => pathOf(r));
  const tribPaths = tribRuns.map((r) => pathOf(r));
  // every drawn river line (and the context rivers) is an obstacle for labels
  const linePx: P[][] = [...mainRuns, ...tribRuns];
  // OSM often stops the river a few km short of the sea (the estuary is mapped as a water polygon):
  // close the last stretch with a straight line so the river visibly reaches the sea.
  if (mouth && mouthCoast) {
    const a = proj(mouth), b = proj(mouthCoast);
    if (Math.hypot(a.x - b.x, a.y - b.y) > 2) { mainPaths.push(pathOf([a, b])); linePx.push([a, b]); }
  }

  // ---- nodes
  const nodes: MapNode[] = [];
  const gPx = new Map<string, P>();
  for (const g of gauges) {
    const p = proj(gAt.get(g.station)!.ll);
    gPx.set(g.station, p);
    nodes.push({ id: `g:${g.station}`, kind: "gauge", ...p, label: { text: g.label, sub: g.sub, x: 0, y: 0, anchor: "start" }, tier: g.tier, href: g.href, name: g.label, detail: g.detail, focus: g.station === input.focusStation });
  }
  const rPx = new Map<string, P>();
  for (const r of reservoirs) {
    const p = proj(rAt.get(r.slug)!.ll);
    rPx.set(r.slug, p);
    nodes.push({ id: `r:${r.slug}`, kind: "reservoir", ...p, label: { text: r.label, sub: null, x: 0, y: 0, anchor: "start" }, onRiver: r.onRiver, status: r.status, active: r.active, highlight: r.highlight, focus: r.highlight, href: r.href, name: r.label, detail: r.detail });
  }
  // keep two icons from sitting on each other (dams a few km apart): nudge the non-focus one
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (const a of nodes) {
      if (a.kind !== "reservoir" || a.focus) continue;
      for (const b of nodes) {
        if (a === b || b.kind === "town") continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d >= 15) continue;
        const ux = d < 0.01 ? 1 : (a.x - b.x) / d, uy = d < 0.01 ? 0 : (a.y - b.y) / d;
        a.x += ux * (15 - d) * 0.6;
        a.y += uy * (15 - d) * 0.6;
        moved = true;
      }
    }
    if (!moved) break;
  }

  // ---- dashed link from a dam that is not on the river to its nearest river point; flows
  const links: MapModel["links"] = [];
  const flows: MapModel["flows"] = [];
  for (const r of reservoirs) {
    const at = rAt.get(r.slug)!;
    const node = nodes.find((n) => n.id === `r:${r.slug}`)!;
    if (r.onRiver && r.linked.length && at.attach) {
      const ap = proj(at.attach);
      if (Math.hypot(node.x - ap.x, node.y - ap.y) > 5) links.push({ id: r.slug, d: pathOf([node, ap]), active: r.active });
    }
    if (!r.active || !at.attach) continue;
    const from = nearestNode(graph, at.attach, kx);
    for (const st of r.linked) {
      const gg = gAt.get(st);
      if (!gg?.snapped) continue;
      const route = dijkstra(graph, from, nearestNode(graph, gg.ll, kx));
      if (!route) continue;
      const pts = [proj(at.attach), ...route.map((i) => proj(graph.nodes[i])), proj(gg.ll)];
      // the pulse runs on the river below the dam, not through the channels inside its lake
      const lake = LAKES[r.slug]?.map(proj);
      const dryRuns: P[][] = [];
      let cur: P[] = [];
      for (const q of pts) {
        if (lake && inRing(q, lake)) { if (cur.length) dryRuns.push(cur); cur = []; } else cur.push(q);
      }
      if (cur.length) dryRuns.push(cur);
      for (const run of dryRuns.filter((x) => x.length >= 2).flatMap((x) => runsInside(x, view))) flows.push({ id: `flow-${r.slug}-${st}-${flows.length}`, d: pathOf(dp(run, 0.35)) });
    }
  }

  // ---- lakes (outline from OSM where there is one)
  const lakes: NonNullable<MapModel["geo"]>["lakes"] = [];
  for (const r of reservoirs) {
    const ring = LAKES[r.slug];
    if (!ring) continue;
    const c = clipPoly(ring.map(proj), view);
    if (c.length < 3) continue;
    lakes.push({ id: r.slug, d: pathOf(dp(c, 0.3), true), status: r.status, active: r.active });
  }

  // ---- sea label: open water off the mouth. The icon and the whole label box must lie in the sea.
  const boxInWater = (b: { x0: number; y0: number; x1: number; y1: number }) => {
    for (let x = b.x0; x <= b.x1 + 0.1; x += 3) {
      for (let y = b.y0; y <= b.y1 + 0.1; y += 3) {
        if (land.some((r) => inRing({ x, y }, r))) return false;
      }
    }
    return true;
  };
  const seaW = input.seaLabel.length * 5.7 + 4;
  if (mouth) {
    const m = proj(mouth);
    // the outward normal: the mean direction of the water around the mouth
    let nx = 0, ny = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI) / 12;
      const q = { x: m.x + Math.cos(a) * 14, y: m.y + Math.sin(a) * 14 };
      if (!land.some((r) => inRing(q, r))) { nx += Math.cos(a); ny += Math.sin(a); }
    }
    const base = Math.atan2(ny, nx);
    const angles = Array.from({ length: 24 }, (_, k) => base + (Math.ceil(k / 2) * (k % 2 ? 1 : -1) * Math.PI) / 12);
    spot: for (const dist of [24, 36, 50, 66]) {
      for (const a of angles) {
        const p = { x: m.x + Math.cos(a) * dist, y: m.y + Math.sin(a) * dist };
        if (p.x < 22 || p.x > W - 22 || p.y < 14 || p.y > h - 14) continue;
        if (nodes.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < 22)) continue;
        const icon = { x0: p.x - 9, y0: p.y - 8, x1: p.x + 9, y1: p.y + 8 };
        const right = { x0: p.x - 9, y0: p.y - 8, x1: p.x + 12 + seaW, y1: p.y + 8 };
        const left = { x0: p.x - 12 - seaW, y0: p.y - 8, x1: p.x + 9, y1: p.y + 8 };
        if (!boxInWater(icon) || !(boxInWater(right) && p.x + 12 + seaW < W - 2 || boxInWater(left) && p.x - 12 - seaW > 2)) continue;
        nodes.push({ id: "sea", kind: "sea", ...p, label: { text: input.seaLabel, sub: null, x: 0, y: 0, anchor: "start" }, name: input.seaLabel, detail: "" });
        break spot;
      }
    }
  }

  // ---- towns: small labels, only where they say something new
  for (const t of towns) {
    const p = proj([t.lon, t.lat]);
    if (p.x < 10 || p.x > W - 10 || p.y < 10 || p.y > h - 10) continue;
    if (nodes.some((n) => n.kind !== "town" && Math.hypot(n.x - p.x, n.y - p.y) < 14)) continue;
    nodes.push({ id: `t:${t.id}`, kind: "town", ...p, label: { text: t.label, sub: null, x: 0, y: 0, anchor: "start" }, name: t.label, detail: "" });
  }

  // ---- scale bar and compass keep clear of labels
  const nice = [1, 2, 5, 10, 20, 25, 50, 100].find((k) => k * kmPx >= 38) ?? 100;
  const scale = { x: 10, y: h - 12, px: nice * kmPx, label: `${nice} km` };
  const obstacles: Box[] = [
    { x0: 4, y0: h - 30, x1: 10 + scale.px + 34, y1: h - 2 },
    { x0: W - 36, y0: 2, x1: W - 2, y1: 40 },
    { x0: W - 150, y0: h - 16, x1: W - 2, y1: h - 2 },
  ];
  // a focused map frames only part of the basin: drop what falls outside the frame
  if (fr) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.x < 6 || n.x > W - 6 || n.y < 6 || n.y > h - 6) nodes.splice(i, 1);
    }
  }
  placeLabels(nodes, h, obstacles, linePx, boxInWater, W);

  return {
    w: W,
    h,
    lines: [...mainPaths.map((d, i) => ({ id: `m${i}`, d, trib: false })), ...tribPaths.map((d, i) => ({ id: `t${i}`, d, trib: true }))],
    links,
    flows,
    nodes,
    geo: { land: land.map((r) => pathOf(r, true)), context, lakes, scale, northX: W - 18 },
  };
}
