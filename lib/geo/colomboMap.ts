// Data for the /colombo-canals map, decoded once. Pure (no I/O); imported only by the lazy map chunk.
//  - canals / lakes: OpenStreetMap (c) contributors, ODbL, fetched once by scripts/build-colombo-map.mjs (colombo-canals.json)
//  - basins: APPROXIMATE outlines drawn by hand on that canal network (colombo-basins.json); not official boundaries
//  - gauges: APPROXIMATE positions of the CUrW gauges (colombo-gauges.json), read off CUrW's public gauge-location map and snapped to OSM canals
//  - works: static design figures of the flood-control works (colombo-works.json); positions checked against Google Maps place records and the CUrW gauge map
//  - floods: village divisions inside the mapped May 2016 Kelani flood (colombo-floods.json)
import canalsJson from "./colombo-canals.json";
import basinsJson from "./colombo-basins.json";
import gaugesJson from "./colombo-gauges.json";
import worksJson from "./colombo-works.json";
import floodsJson from "./colombo-floods.json";
import { BASINS, type BasinId } from "../colombo";

export type LL = [number, number];
export type Line = { n?: string; k: "c" | "d" | "r" | "s" | "t"; b: BasinId | null; pts: LL[]; /** towards the outfall when the direction is known */ flow: boolean; mid: LL };
export type Water = { n?: string; w: 0 | 1; ring: LL[] };
export type BasinShape = { id: BasinId; ring: LL[]; centre: LL };
export type GaugePos = { n: string; lat: number; lon: number; basin: BasinId | null };
export type Work = { id: "ambathale" | "stsebS" | "torrington" | "mutwal" | "northlock" | "kalupalama" | "gothatuwa"; kind: "pump" | "tunnel" | "gate"; cap: number; lat: number; lon: number };

export const NAGALAGAM: LL = [6.958265, 79.878642];
/** Where each basin's water leaves (approximate): flow arrows point this way. Parliament has several outlets, so no arrows.
 *  Kolonnawa: the Kittampahuwa canal meets the Kelani at the Kalu Palama gates (SLLDC works description, Kolonnawa Canal Diversion Stage IV).
 *  North: the North Lock at Nagalagam Street (Kelani) and the New Mutwal tunnel inlet (sea). Wellawatta: the Wellawatta and Dehiwala canal mouths. */
const OUTFALLS: Partial<Record<BasinId, LL[]>> = {
  kolonnawa: [[6.9532, 79.89]],
  north: [[6.9558, 79.8777], [6.9574, 79.8639]],
  wellawatta: [[6.8786, 79.8559], [6.8666, 79.8609]],
};

const dec = (a: number[]): LL[] => {
  const o: LL[] = [];
  let x = 0, y = 0;
  for (let i = 0; i + 1 < a.length; i += 2) { x += a[i]; y += a[i + 1]; o.push([x / 1e5, y / 1e5]); }
  return o;
};
const d2 = (a: LL, b: LL) => (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * 0.993) ** 2;

export function inRing(pt: LL, ring: LL[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const centroid = (ring: LL[]): LL => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

export const BASIN_SHAPES: BasinShape[] = (basinsJson.basins as { id: BasinId; ring: LL[] }[]).map((b) => ({ id: b.id, ring: b.ring, centre: centroid(b.ring) }));
export const basinAt = (pt: LL): BasinId | null => BASIN_SHAPES.find((b) => inRing(pt, b.ring))?.id ?? null;

const lenKm = (p: LL[]) => p.reduce((s, q, i) => (i ? s + Math.sqrt(d2(q, p[i - 1])) * 111.2 : 0), 0);

export const LINES: Line[] = (canalsJson.lines as { n?: string; k: Line["k"]; b?: BasinId; p: number[] }[])
  .map((l) => {
    let pts = dec(l.p);
    // the basin of the line's middle point in the final (smoothed) areas; the build-time tag is the fallback
    const b = basinAt(pts[Math.floor(pts.length / 2)]) ?? l.b ?? null;
    let flow = false;
    const outs = b ? OUTFALLS[b] : undefined;
    // Direction: turn the line so its end is the end nearer the basin's outfall, and animate only long canals
    // where the two ends differ clearly. Where the outfall is unknown, no arrows are drawn.
    if (outs && (l.k === "c" || l.k === "d") && lenKm(pts) >= 0.7) {
      const near = (p: LL) => Math.min(...outs.map((o) => d2(p, o)));
      const a = near(pts[0]), z = near(pts[pts.length - 1]);
      if (Math.abs(Math.sqrt(a) - Math.sqrt(z)) * 111.2 > 0.25) {
        flow = true;
        if (a < z) pts = [...pts].reverse();
      }
    }
    return { n: l.n, k: l.k, b, pts, flow, mid: pts[Math.floor(pts.length / 2)] };
  })
  .filter((l) => l.pts.length >= 2);

export const WATERS: Water[] = (canalsJson.waters as { n?: string; w: 0 | 1; r: number[] }[]).map((w) => ({ n: w.n, w: w.w, ring: dec(w.r) }));

export const GAUGE_POS: GaugePos[] = gaugesJson.gauges.map((g) => ({ n: g.n, lat: g.lat, lon: g.lon, basin: BASINS.find((b) => b.gauges.includes(g.n))?.id ?? basinAt([g.lat, g.lon]) }));
/** The whole canal system (all four basins and every drawn gauge) with a little margin: the view the map opens on. */
export const MAP_BOUNDS: [LL, LL] = (() => {
  const all = [...BASIN_SHAPES.flatMap((b) => b.ring), ...GAUGE_POS.map((g): LL => [g.lat, g.lon])];
  const la = all.map((p) => p[0]), lo = all.map((p) => p[1]);
  return [[Math.min(...la) - 0.004, Math.min(...lo) - 0.004], [Math.max(...la) + 0.004, Math.max(...lo) + 0.004]];
})();
export const WORKS = worksJson.works as Work[];
export const FLOOD_CIRCLES = floodsJson.circles as [number, number, number][];
export const FLOOD_EVENT = floodsJson.event;
export const OSM_FETCHED: string = canalsJson.fetched;

export { toFt } from "../curwStatus";
