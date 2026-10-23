// Layout for the river map: pure geometry, no React. Takes real coordinates and returns pixel
// positions inside a fixed-width viewBox (so 10.5 px labels are 10.5 px on a 360 px phone), the
// river polylines, the dashed reservoir links, the release-flow paths and collision-free labels.
//
// Schematic and geographic at once: points sit where they are on the ground (equirectangular,
// scaled by cos latitude), but the river is straight segments between its points in flow order
// (lib/riverTopology.ts), not the surveyed course.

import type { Tier } from "./status";

export const MAP_W = 360;
const PAD_X = 20;
const PAD_Y = 24;
const MIN_H = 190;
const MAX_H = 400;
const CHAR_W = 5.7; // average glyph width at FONT, generous so Sinhala/Tamil do not overrun
const LINE_H = 12;

export type PointIn = { id: string; lat: number; lon: number };

export type GaugeIn = PointIn & {
  station: string;
  label: string;
  /** Second line (the level), or null. */
  sub: string | null;
  tier: Tier;
  href: string;
  /** Full sentence for the screen-reader list and the sheet. */
  detail: string;
};

export type ReservoirIn = PointIn & {
  slug: string;
  label: string;
  status: "spilling" | "releasing" | "holding" | "nodata";
  /** Releasing into the river now. */
  active: boolean;
  /** One of the hand-catalogued reservoirs, or a dam the river runs through (always gets a label; gets a link to the river when `linked` is not empty). */
  onRiver: boolean;
  /** Stations downstream of it (exact feed names). */
  linked: string[];
  href: string;
  detail: string;
  highlight: boolean;
};

export type TownIn = PointIn & { label: string };

export type RiverShapeIn = {
  main: string[];
  tribs?: { path: string[]; joins: [string | null, string] }[];
  sea?: { lat: number; lon: number };
};

export type MapNode = {
  id: string;
  kind: "gauge" | "reservoir" | "town" | "sea";
  x: number;
  y: number;
  /** Where the label starts; null = icon only. */
  label: { text: string; sub: string | null; x: number; y: number; anchor: "start" | "middle" | "end" } | null;
  tier?: Tier;
  /** A hand-catalogued reservoir or a dam on the river line (labelled first). */
  onRiver?: boolean;
  status?: ReservoirIn["status"];
  active?: boolean;
  highlight?: boolean;
  /** The station or reservoir this page is about: its label is placed first. */
  focus?: boolean;
  href?: string;
  /** Plain text for the tooltip, sheet and list. */
  name: string;
  detail: string;
};

export type MapModel = {
  w: number;
  h: number;
  /** River polylines as SVG path data. */
  lines: { id: string; d: string; trib: boolean }[];
  /** Dashed reservoir-to-river links. */
  links: { id: string; d: string; active: boolean }[];
  /** Flow pulses along the river from an active reservoir to its gauges. */
  flows: { id: string; d: string }[];
  nodes: MapNode[];
  /** Real geometry (lib/riverMapGeo.ts); absent on the schematic fallback. */
  geo?: {
    land: string[];
    context: string[];
    lakes: { id: string; d: string; status: NonNullable<MapNode["status"]>; active: boolean }[];
    scale: { x: number; y: number; px: number; label: string } | null;
    northX: number;
  };
};

type V = { x: number; y: number; ref?: string };
type Line = { id: string; v: V[]; trib: boolean; join?: { line: string; seg: number } };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function nearestOnSegment(p: { x: number; y: number }, a: V, b: V): { x: number; y: number; t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { x, y, t, d: Math.hypot(p.x - x, p.y - y) };
}

function nearestOnLines(p: { x: number; y: number }, lines: Line[], only?: Line[]) {
  let best: { line: Line; seg: number; x: number; y: number; d: number } | null = null;
  for (const l of only ?? lines) {
    for (let i = 0; i < l.v.length - 1; i++) {
      const n = nearestOnSegment(p, l.v[i], l.v[i + 1]);
      if (!best || n.d < best.d) best = { line: l, seg: i, x: n.x, y: n.y, d: n.d };
    }
  }
  return best;
}

const pathOf = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");

export type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export function buildMap(input: {
  gauges: GaugeIn[];
  reservoirs: ReservoirIn[];
  towns: TownIn[];
  shape: RiverShapeIn;
  seaLabel: string;
}): MapModel {
  const { gauges, reservoirs, towns, shape } = input;

  // ---- project
  const pts: PointIn[] = [...gauges, ...reservoirs, ...towns];
  if (shape.sea) pts.push({ id: "sea", lat: shape.sea.lat, lon: shape.sea.lon });
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const bw = Math.max((maxLon - minLon) * kx, 0.04);
  const bh = Math.max(maxLat - minLat, 0.04);
  const availW = MAP_W - 2 * PAD_X;
  const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, availW * (bh / bw) + 2 * PAD_Y)));
  const s = Math.min(availW / bw, (h - 2 * PAD_Y) / bh);
  const offX = (MAP_W - bw * s) / 2;
  const offY = (h - bh * s) / 2;
  const at = (p: { lat: number; lon: number }) => ({ x: offX + (p.lon - minLon) * kx * s, y: offY + (maxLat - p.lat) * s });

  const gPos = new Map(gauges.map((g) => [g.station, at(g)]));
  const rPos = new Map(reservoirs.map((r) => [r.slug, at(r)]));
  const sea = shape.sea ? at(shape.sea) : null;

  // Dam icons that land on top of a gauge or each other (a few km apart is a few pixels here) are
  // nudged apart, at most ~14 px, so each stays tappable. Dams the river line runs through stay put.
  const fixed = new Set([...shape.main, ...(shape.tribs ?? []).flatMap((x) => x.path)].filter((x) => x.startsWith("@")).map((x) => x.slice(1)));
  const MIN_GAP = 17;
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (const r of reservoirs) {
      if (fixed.has(r.slug)) continue;
      const me = rPos.get(r.slug)!;
      const others = [...gPos.values(), ...(sea ? [sea] : []), ...reservoirs.filter((o) => o !== r).map((o) => rPos.get(o.slug)!)];
      for (const o of others) {
        const d = dist(me, o);
        if (d >= MIN_GAP) continue;
        const ux = d < 0.01 ? 1 : (me.x - o.x) / d;
        const uy = d < 0.01 ? 0 : (me.y - o.y) / d;
        me.x += ux * (MIN_GAP - d) * 0.5;
        me.y += uy * (MIN_GAP - d) * 0.5;
        moved = true;
      }
    }
    if (!moved) break;
  }

  // ---- river lines
  const resolve = (name: string): V | null => {
    if (name.startsWith("@")) {
      const p = rPos.get(name.slice(1));
      return p ? { ...p, ref: name } : null;
    }
    const p = gPos.get(name);
    return p ? { ...p, ref: name } : null;
  };
  const mainV = shape.main.map(resolve).filter((v): v is V => !!v);
  if (sea && mainV.length) mainV.push({ ...sea, ref: "sea" });
  const lines: Line[] = [];
  if (mainV.length >= 2) lines.push({ id: "main", v: mainV, trib: false });
  const main = lines[0];

  (shape.tribs ?? []).forEach((t, i) => {
    const v = t.path.map(resolve).filter((x): x is V => !!x);
    if (v.length === 0) return;
    if (!main) return;
    const end = v[v.length - 1];
    const idx = (ref: string | null) => (ref == null ? -1 : main.v.findIndex((m) => m.ref === ref));
    const a = idx(t.joins[0]);
    const b = idx(t.joins[1]);
    let j: { x: number; y: number; seg: number } | null = null;
    if (a >= 0 && b >= 0 && b === a + 1) {
      const n = nearestOnSegment(end, main.v[a], main.v[b]);
      j = { x: n.x, y: n.y, seg: a };
    } else if (t.joins[0] == null && b >= 0) {
      j = { x: main.v[b].x, y: main.v[b].y, seg: Math.max(b - 1, 0) };
    } else {
      const n = nearestOnLines(end, lines, [main]);
      if (n) j = { x: n.x, y: n.y, seg: n.seg };
    }
    if (!j) return;
    lines.push({ id: `trib${i}`, v: [...v, { x: j.x, y: j.y }], trib: true, join: { line: "main", seg: j.seg } });
  });

  // Gauges that sit on no line (a river with one gauge, or a table without the station) still get
  // a short stub to the nearest line so nothing floats free of the river.
  const onLine = new Set(lines.flatMap((l) => l.v.map((v) => v.ref)));
  const stubs: { id: string; d: string }[] = [];
  if (lines.length) {
    for (const g of gauges) {
      if (onLine.has(g.station)) continue;
      const p = gPos.get(g.station)!;
      const n = nearestOnLines(p, lines);
      if (n && n.d > 3) stubs.push({ id: `stub-${g.station}`, d: pathOf([p, n]) });
    }
  }

  // ---- reservoir links and flows
  const links: MapModel["links"] = [];
  const flows: MapModel["flows"] = [];
  const lineById = new Map(lines.map((l) => [l.id, l]));
  for (const r of reservoirs) {
    const p = rPos.get(r.slug)!;
    const wayPoint = lines.some((l) => l.v.some((v) => v.ref === `@${r.slug}`));
    let attach: { line: Line; seg: number; x: number; y: number } | null = null;
    if (wayPoint) {
      for (const l of lines) {
        const i = l.v.findIndex((v) => v.ref === `@${r.slug}`);
        if (i >= 0) {
          attach = { line: l, seg: i, x: p.x, y: p.y };
          break;
        }
      }
    } else if (r.onRiver && r.linked.length && lines.length) {
      attach = nearestOnLines(p, lines);
    }

    if (r.onRiver && r.linked.length && !wayPoint) {
      if (attach) {
        if (dist(p, attach) > 4) links.push({ id: r.slug, d: pathOf([p, attach]), active: r.active });
      } else {
        // No river line in this basin: link the reservoir straight to its gauges.
        for (const st of r.linked) {
          const g = gPos.get(st);
          if (g) links.push({ id: `${r.slug}-${st}`, d: pathOf([p, g]), active: r.active });
        }
      }
    }

    if (!r.active) continue;
    if (!attach) {
      // already drawn as straight links above: pulse along them
      for (const st of r.linked) {
        const g = gPos.get(st);
        if (g) flows.push({ id: `flow-${r.slug}-${st}`, d: pathOf([p, g]) });
      }
      continue;
    }
    for (const st of r.linked) {
      const route = routeTo(attach, st, lineById);
      if (route) flows.push({ id: `flow-${r.slug}-${st}`, d: pathOf(route) });
    }
  }

  // ---- nodes and labels
  const nodes: MapNode[] = [];
  for (const g of gauges) {
    const p = gPos.get(g.station)!;
    nodes.push({ id: `g:${g.station}`, kind: "gauge", ...p, label: { text: g.label, sub: g.sub, x: 0, y: 0, anchor: "start" }, tier: g.tier, href: g.href, name: g.label, detail: g.detail });
  }
  for (const r of reservoirs) {
    const p = rPos.get(r.slug)!;
    nodes.push({ id: `r:${r.slug}`, kind: "reservoir", ...p, label: { text: r.label, sub: null, x: 0, y: 0, anchor: "start" }, onRiver: r.onRiver, status: r.status, active: r.active, highlight: r.highlight, href: r.href, name: r.label, detail: r.detail });
  }
  if (sea) nodes.push({ id: "sea", kind: "sea", ...sea, label: { text: input.seaLabel, sub: null, x: 0, y: 0, anchor: "start" }, name: input.seaLabel, detail: "" });
  for (const t of towns) {
    const p = at(t);
    if (nodes.some((n) => n.kind !== "town" && dist(n, p) < 16)) continue; // a town on top of a gauge or dam says nothing new
    nodes.push({ id: `t:${t.id}`, kind: "town", ...p, label: { text: t.label, sub: null, x: 0, y: 0, anchor: "start" }, name: t.label, detail: "" });
  }

  placeLabels(nodes, h);

  return {
    w: MAP_W,
    h,
    lines: lines.map((l) => ({ id: l.id, d: pathOf(l.v), trib: l.trib })),
    links: [...links, ...stubs.map((x) => ({ id: x.id, d: x.d, active: false }))],
    flows,
    nodes,
  };
}

/** Points from the attach point downstream along the river to the vertex for `target`, or null if that gauge is not downstream. */
function routeTo(attach: { line: Line; seg: number; x: number; y: number }, target: string, lineById: Map<string, Line>): { x: number; y: number }[] | null {
  const out: { x: number; y: number }[] = [{ x: attach.x, y: attach.y }];
  let line: Line | undefined = attach.line;
  let from = attach.seg + 1;
  while (line) {
    for (let i = from; i < line.v.length; i++) {
      out.push(line.v[i]);
      if (line.v[i].ref === target) return out;
    }
    if (!line.join) return null;
    const next: Line | undefined = lineById.get(line.join.line);
    from = line.join.seg + 1;
    line = next;
  }
  return null;
}

export function placeLabels(nodes: MapNode[], h: number, obstacles: Box[] = []) {
  const R: Record<MapNode["kind"], number> = { gauge: 6, reservoir: 8, town: 3, sea: 6 };
  const placed: Box[] = [...obstacles, ...nodes.map((n) => ({ x0: n.x - R[n.kind] - 1, y0: n.y - R[n.kind] - 1, x1: n.x + R[n.kind] + 1, y1: n.y + R[n.kind] + 1 }))];
  // Priority: gauges, then highlighted/active reservoirs, other labelled reservoirs, sea, towns.
  const prio = (n: MapNode) => (n.focus ? -1 : n.kind === "gauge" ? 0 : n.kind === "reservoir" ? (n.highlight || n.active ? 1 : n.onRiver ? 2 : 5) : n.kind === "sea" ? 3 : 4);
  const order = nodes.map((n, i) => ({ n, i })).sort((a, b) => prio(a.n) - prio(b.n) || a.i - b.i);
  for (const { n } of order) {
    if (!n.label) continue;
    const lines = n.label.sub ? 2 : 1;
    const w = Math.max(n.label.text.length, n.label.sub?.length ?? 0) * CHAR_W;
    const ht = lines * LINE_H;
    const cands: { box: Box; x: number; y: number; anchor: "start" | "middle" | "end" }[] = [];
    for (const r of [R[n.kind] + 3, R[n.kind] + 12]) {
      const top = n.y - r - ht;
      const mid = n.y - ht / 2;
      const bot = n.y + r;
      const base = (y0: number) => y0 + LINE_H - 3;
      cands.push(
        { anchor: "start", x: n.x + r, y: base(mid), box: { x0: n.x + r, y0: mid, x1: n.x + r + w, y1: mid + ht } },
        { anchor: "end", x: n.x - r, y: base(mid), box: { x0: n.x - r - w, y0: mid, x1: n.x - r, y1: mid + ht } },
        { anchor: "middle", x: n.x, y: base(top), box: { x0: n.x - w / 2, y0: top, x1: n.x + w / 2, y1: top + ht } },
        { anchor: "middle", x: n.x, y: base(bot), box: { x0: n.x - w / 2, y0: bot, x1: n.x + w / 2, y1: bot + ht } },
        { anchor: "start", x: n.x + r, y: base(top), box: { x0: n.x + r, y0: top, x1: n.x + r + w, y1: top + ht } },
        { anchor: "end", x: n.x - r, y: base(top), box: { x0: n.x - r - w, y0: top, x1: n.x - r, y1: top + ht } },
        { anchor: "start", x: n.x + r, y: base(bot), box: { x0: n.x + r, y0: bot, x1: n.x + r + w, y1: bot + ht } },
        { anchor: "end", x: n.x - r, y: base(bot), box: { x0: n.x - r - w, y0: bot, x1: n.x - r, y1: bot + ht } },
      );
    }
    const inside = (b: Box) => b.x0 >= 2 && b.x1 <= MAP_W - 2 && b.y0 >= 2 && b.y1 <= h - 2;
    let pick = cands.find((c) => inside(c.box) && !placed.some((p) => hit(p, c.box)));
    if (!pick && n.kind === "gauge") {
      // a gauge name must show: take the in-bounds spot with the least overlap, or clamp
      const ok = cands.filter((c) => inside(c.box));
      pick = ok.sort((a, b) => placed.filter((p) => hit(p, a.box)).length - placed.filter((p) => hit(p, b.box)).length)[0];
      if (!pick) {
        const c = cands[0];
        const shift = Math.max(0, c.box.x1 - (MAP_W - 2));
        pick = { ...c, x: c.x - shift, box: { ...c.box, x0: c.box.x0 - shift, x1: c.box.x1 - shift } };
      }
    }
    if (!pick) {
      n.label = null; // no room: icon only, the name is in the tooltip and sheet
      continue;
    }
    n.label = { ...n.label, x: pick.x, y: pick.y, anchor: pick.anchor };
    placed.push(pick.box);
  }
}
