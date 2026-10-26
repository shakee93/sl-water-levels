// River centrelines for the home page map (Leaflet). Built from OpenStreetMap plus the Irrigation
// Department's rivers layer (tributaries OSM lacks) by scripts/build-river-extras.mjs and
// scripts/build-home-rivers.mjs, ~29 KB; imported only by the lazily loaded map module.
// (c) OpenStreetMap contributors, ODbL.

import json from "./home-rivers.json";
import coastJson from "./coast.json";

export type HomeRiver = { basin: string; main: boolean; pts: [lat: number, lon: number][] };

function decode(d: number[]): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < d.length; i += 2) {
    x += d[i];
    y += d[i + 1];
    out.push([y / 1e4, x / 1e4]);
  }
  return out;
}

export const HOME_RIVERS: HomeRiver[] = (json as { rivers: { b: string; m: number; d: number[] }[] }).rivers.map((r) => ({
  basin: r.b,
  main: r.m === 1,
  pts: decode(r.d),
}));

/** The rivers drawn a little thicker and named on the map. */
export const MAJOR_BASINS = ["Kelani Ganga", "Mahaweli Ganga", "Kalu Ganga", "Walawe Ganga", "Nilwala Ganga", "Deduru Oya"];

/** One line per river (the longest main line of its basin) to hang its name on, longest first. */
export const RIVER_NAME_LINES: { basin: string; pts: [number, number][] }[] = [...new Set(HOME_RIVERS.map((r) => r.basin))]
  .flatMap((basin) => {
    const best = HOME_RIVERS.filter((r) => r.basin === basin && r.main).sort((a, b) => b.pts.length - a.pts.length)[0];
    return best ? [{ basin, pts: best.pts }] : [];
  })
  .sort((a, b) => b.pts.length - a.pts.length);

/** Land polygons (Sri Lanka and its bigger islands) for the home map's own base layer. */
export const HOME_COAST: [number, number][][] = (coastJson as { rings: number[][] }).rings.map(decode);
