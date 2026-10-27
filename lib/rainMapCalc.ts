// Pure helpers and types for the rain map, shared by the server (lib/rainMap.ts) and the map component in the browser.
// No imports beyond types, so the client bundle stays small.
import type { Tier } from "./status";

/** National 0.1 degree grid, the same as scripts/gsmap-snapshot.mjs GRID: pixel centres, row 0 = north. */
export const GRID = { lat0: 9.95, lon0: 79.55, step: 0.1, nx: 25, ny: 42 } as const;
/** Forecast points: a 0.25 degree grid, only the points on or near land are requested. */
export const FC_GRID = { lat0: 9.9, lon0: 79.65, step: 0.25, nx: 10, ny: 17 } as const;

export type RainMapGauge = {
  station: string;
  name: string;
  basin: string;
  lat: number;
  lon: number;
  href: string;
  tier: Tier;
  /** True when the gauge page says "Get ready" from its forecast while the level is still below alert (lib/stationVerdict.ts). */
  getReady?: boolean;
  /** Latest level as shown on the site (feet), null when there is no fresh reading. */
  level: string | null;
  /** Rain the gauge's own sensor measured (mm); null = no sensor or no fresh reading. */
  measured: { mm1h: number | null; mm3h: number | null; mm24h: number | null; at: number } | null;
  noSensor: boolean;
  /** Satellite rain over the catchment above this gauge (mm), from gsmap/latest.json. */
  above24h: number | null;
};

export type RainMapBasin = {
  basin: string;
  /** Gauges upstream to downstream (station names, keys into `gauges`). */
  gauges: string[];
  dryZone: boolean;
};

export type RainMapData = {
  generatedAt: number;
  grid: typeof GRID;
  /** Basin index per pixel (into `basins`), -1 = outside every mapped river area. */
  basinOf: number[];
  basins: RainMapBasin[];
  /** Satellite rain per clock hour, oldest first; `v` = tenths of mm per pixel, comma separated, "" = 0, "x" = missing. */
  satellite: { credit: string; hours: { start: number; v: string }[] } | null;
  /** Forecast per hour, `end` = end of the hour; values per forecast point in `points` order (same encoding). */
  forecast: { grid: typeof FC_GRID; points: [number, number][]; hours: { end: number; v: string }[] } | null;
  gauges: RainMapGauge[];
  /** Live ground rain gauges from HMIS (record under 3 h old) with 5 mm or more in 24 h: [name, institute, lat, lon, mm in 24 h]. Absent when HMIS is slow. */
  ground?: [string, string, number, number, number][];
};

export const decodeFrame = (s: string): number[] => s.split(",").map((x) => (x === "" ? 0 : x === "x" ? -1 : Number(x) / 10));

/** Per pixel: mm over the newest `hours` satellite hours (scaled up for missing hours like the snapshot; null under 75% of them). */
export function satelliteTotal(d: RainMapData, hours: number): (number | null)[] | null {
  const frames = (d.satellite?.hours.slice(-hours) ?? []).map((h) => decodeFrame(h.v));
  const need = Math.ceil(hours * 0.75);
  if (frames.length < need) return null;
  return Array.from({ length: d.grid.nx * d.grid.ny }, (_, i) => {
    let s = 0, have = 0;
    for (const f of frames) if (f[i] >= 0) { s += f[i]; have++; }
    return have >= need ? (s * hours) / have : null;
  });
}

/** Per forecast point: mm over the next `hours` (null when any hour is missing). */
export function forecastTotal(d: RainMapData, hours: number): (number | null)[] | null {
  if (!d.forecast || d.forecast.hours.length < hours) return null;
  const frames = d.forecast.hours.slice(0, hours).map((h) => decodeFrame(h.v));
  return d.forecast.points.map((_, pi) => {
    let s = 0;
    for (const f of frames) { if (f[pi] < 0) return null; s += f[pi]; }
    return s;
  });
}

/** Forecast point index nearest to each grid pixel (-1 = none kept there). */
export function forecastIndexPerPixel(d: RainMapData): number[] {
  if (!d.forecast) return [];
  const { grid, points } = d.forecast;
  const at = new Map(points.map(([r, c], i) => [r * grid.nx + c, i]));
  return Array.from({ length: d.grid.nx * d.grid.ny }, (_, i) => {
    const lat = d.grid.lat0 - Math.floor(i / d.grid.nx) * d.grid.step, lon = d.grid.lon0 + (i % d.grid.nx) * d.grid.step;
    const r = Math.round((grid.lat0 - lat) / grid.step), c = Math.round((lon - grid.lon0) / grid.step);
    return r >= 0 && r < grid.ny && c >= 0 && c < grid.nx ? at.get(r * grid.nx + c) ?? -1 : -1;
  });
}

/** Mean of per-pixel values over each river area (rounded to 0.1 mm); null when the area has no value. */
export function perBasin(d: RainMapData, pixel: (i: number) => number | null): (number | null)[] {
  const sums = d.basins.map(() => ({ s: 0, n: 0 }));
  d.basinOf.forEach((b, i) => {
    if (b < 0) return;
    const v = pixel(i);
    if (v == null) return;
    sums[b].s += v;
    sums[b].n++;
  });
  return sums.map((x) => (x.n ? Math.round((x.s / x.n) * 10) / 10 : null));
}

/** Rain on each river area: satellite over the past `hours`, forecast over the next `hours`. */
export const basinSatellite = (d: RainMapData, hours: number) => {
  const t = satelliteTotal(d, hours);
  return t ? perBasin(d, (i) => t[i]) : d.basins.map(() => null);
};
export const basinForecast = (d: RainMapData, hours: number) => {
  const t = forecastTotal(d, hours);
  if (!t) return d.basins.map(() => null);
  const idx = forecastIndexPerPixel(d);
  return perBasin(d, (i) => (idx[i] >= 0 ? t[idx[i]] : null));
};
