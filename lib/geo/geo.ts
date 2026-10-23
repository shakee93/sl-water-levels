// Decoded OpenStreetMap geometry for the river map (built by scripts/build-river-geo.mjs).
// (c) OpenStreetMap contributors, ODbL. Server-side only: the map component turns what it needs
// into SVG path strings, so none of this ships to the browser.

import riversJson from "./rivers.json";
import coastJson from "./coast.json";
import lakesJson from "./reservoirs.json";

export type LL = [lon: number, lat: number];

/** Delta-encoded 1e-4 degree integers -> [lon, lat][]. */
function decode(d: number[]): LL[] {
  const out: LL[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < d.length; i += 2) {
    x += d[i];
    y += d[i + 1];
    out.push([x / 1e4, y / 1e4]);
  }
  return out;
}

export type RiverWay = { name: string; basin: string; main: boolean; pts: LL[] };

export const RIVER_WAYS: RiverWay[] = (riversJson as { rivers: { n: string; b: string; m: number; d: number[] }[] }).rivers.map((r) => ({
  name: r.n,
  basin: r.b,
  main: r.m === 1,
  pts: decode(r.d),
}));

/** Land polygons (Sri Lanka and its bigger islands). */
export const COAST: LL[][] = (coastJson as { rings: number[][] }).rings.map(decode);

/** Lake outlines by reservoir slug, only where OpenStreetMap has a matching water body. */
export const LAKES: Record<string, LL[]> = Object.fromEntries(
  Object.entries(lakesJson as Record<string, { d: number[] }>).map(([k, v]) => [k, decode(v.d)]),
);
