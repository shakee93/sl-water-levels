// The rain map (/rain, /api/rain-map): satellite rain that FELL (JAXA GSMaP, hour by hour for the last 24 h on a 0.1 degree grid),
// the weather model's FORECAST for the next 24 h (Open-Meteo, a coarser 0.25 degree grid), and the river gauges on top with their
// own measured rain and level. Kept apart by source, as everywhere on the site (lib/stationRain.ts): the page never mixes them.
//
// Satellite grid: gsmap/grid.json on the `data` branch, written by scripts/gsmap-snapshot.mjs from the files it already downloads.
// Each step's value is the rain RATE (mm/h) over the hour starting at that step, so the map only uses whole-hour (:00) steps: one
// per clock hour, and summing them never double counts. Forecast: one Open-Meteo request for every grid point on or near land,
// cached 1 h. River basins: the Irrigation Department's own outlines (lib/geo/rainBasins.ts); "rain on this river" is the mean
// over the 0.1 degree pixels whose centre lies in the basin (the 18 basins with a rain model, scripts/build-rain-basins.mjs).
//
// Fails soft: a missing source leaves its layer empty (null) and the rest of the map still works.

import { unstable_cache } from "next/cache";
import { COAST } from "./geo/geo";
import { RAIN_BASINS, inBasin } from "./geo/rainBasins";
import { getNational } from "./arcgis";
import { getStationVerdicts, type StationVerdict } from "./stationVerdict";
import { soft } from "./soft";
import { getGsmap } from "./gsmap";
import { getJson } from "./weather";
import { orderStations } from "./basinOrder";
import { measuredAtGauge } from "./stationRain";
import { noRainSensor } from "./rainSensors";
import { stationDisplayName } from "./displayName";
import { formatLevel } from "./units";
import { isDryZoneBasin } from "./rainWords";
import { GRID, FC_GRID, type RainMapBasin, type RainMapData, type RainMapGauge } from "./rainMapCalc";

const HOUR = 3_600_000;
export const RAIN_GRID_URL = process.env.GSMAP_GRID_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/gsmap/grid.json";
/** Older satellite data than this is not shown at all (the workflow has stopped). */
const SAT_MAX_AGE_MS = 6 * HOUR;

const cellCentre = (i: number): [lat: number, lon: number] => [GRID.lat0 - Math.floor(i / GRID.nx) * GRID.step, GRID.lon0 + (i % GRID.nx) * GRID.step];

export const MAP_BASINS = Object.keys(RAIN_BASINS).sort();

/** Basin index (into MAP_BASINS) for every grid pixel, -1 = none: the official basin outline its centre falls in. */
const BASIN_OF: number[] = Array.from({ length: GRID.nx * GRID.ny }, (_, i) => {
  const [lat, lon] = cellCentre(i);
  return MAP_BASINS.findIndex((b) => !!RAIN_BASINS[b] && inBasin(RAIN_BASINS[b], lon, lat));
});

// ---- forecast points: a 0.25 degree grid, only on or within ~15 km of land --------------------------------------------------
const inRing = (lon: number, lat: number, ring: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const nearLand = (lat: number, lon: number) =>
  COAST.some((ring) => inRing(lon, lat, ring)) || COAST.some((ring) => ring.some(([x, y]) => (x - lon) ** 2 + (y - lat) ** 2 < 0.15 * 0.15));
/** [row, col] of each forecast point kept, in request order. */
const FC_POINTS: [number, number][] = [];
for (let r = 0; r < FC_GRID.ny; r++)
  for (let c = 0; c < FC_GRID.nx; c++)
    if (nearLand(FC_GRID.lat0 - r * FC_GRID.step, FC_GRID.lon0 + c * FC_GRID.step)) FC_POINTS.push([r, c]);

// ---- sources ----------------------------------------------------------------------------------------------------------------
type GridFile = { lat0: number; lon0: number; step: number; nx: number; ny: number; times: string[]; frames: number[][] };

const loadGrid = unstable_cache(
  async (): Promise<GridFile> => {
    const res = await fetch(RAIN_GRID_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // not cached
    const j = (await res.json()) as GridFile;
    if (!Array.isArray(j?.times) || !Array.isArray(j.frames) || j.nx !== GRID.nx || j.ny !== GRID.ny) throw new Error("unexpected shape");
    return j;
  },
  ["rain-map-grid-v1"],
  { revalidate: 600 },
);

/** Satellite hours (clock hours, newest last) of the last 24 h: start ms and tenths of mm per pixel (-1 = missing). */
async function satelliteHours(now: number): Promise<{ start: number; v: number[] }[] | null> {
  try {
    const g = await loadGrid();
    const hours = g.times
      .map((iso, i) => ({ start: Date.parse(iso), v: g.frames[i] }))
      .filter((h) => Number.isFinite(h.start) && h.start % HOUR === 0 && Array.isArray(h.v) && h.v.length === GRID.nx * GRID.ny);
    const newest = hours.at(-1);
    if (!newest || now - (newest.start + HOUR) > SAT_MAX_AGE_MS) return null;
    return hours.filter((h) => h.start > newest.start - 24 * HOUR);
  } catch {
    return null;
  }
}

/** Forecast hours (end of hour, ms) from the current hour on, tenths of mm per forecast point; null = model unavailable. */
async function forecastHours(now: number): Promise<{ end: number; v: number[] }[] | null> {
  const lat = FC_POINTS.map(([r]) => (FC_GRID.lat0 - r * FC_GRID.step).toFixed(2)).join(",");
  const lon = FC_POINTS.map(([, c]) => (FC_GRID.lon0 + c * FC_GRID.step).toFixed(2)).join(",");
  const r = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation&past_days=0&forecast_days=3&timezone=UTC`, 3600);
  if (!r.ok) return null;
  const list = (Array.isArray(r.data) ? r.data : [r.data]) as { hourly?: { time?: string[]; precipitation?: (number | null)[] } }[];
  if (list.length !== FC_POINTS.length) return null;
  const times = list[0]?.hourly?.time ?? [];
  const nowHour = Math.floor(now / HOUR) * HOUR;
  const out: { end: number; v: number[] }[] = [];
  times.forEach((t, i) => {
    const end = Date.parse(`${t}Z`); // the sum over the hour ENDING at t
    if (end <= nowHour || end > nowHour + 24 * HOUR) return;
    out.push({ end, v: list.map((p) => { const x = p.hourly?.precipitation?.[i]; return x == null || !Number.isFinite(x) ? -1 : Math.round(x * 10); }) });
  });
  return out.length ? out : null;
}

// ---- payload ----------------------------------------------------------------------------------------------------------------
const enc = (v: number[]) => v.map((x) => (x < 0 ? "x" : x === 0 ? "" : String(x))).join(",");
const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);

async function build(): Promise<RainMapData> {
  const now = Date.now();
  const [sat, fc, national, gsmap, verdicts] = await Promise.all([
    satelliteHours(now),
    forecastHours(now),
    getNational().catch(() => []),
    getGsmap(now),
    // same verdict as the gauge pages, so a gauge listed here never reads calmer than its page; 4 s cap, else none
    soft(getStationVerdicts().catch(() => ({}) as Record<string, StationVerdict>), 4000, {} as Record<string, StationVerdict>),
  ]);
  const gauges: RainMapGauge[] = national
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
    .map((s) => {
      const m = measuredAtGauge(s.station, s.trend24h, now);
      const g = gsmap?.stations[`${s.basin.trim()}/${s.station}`];
      return {
        station: s.station,
        name: stationDisplayName(s.station),
        basin: s.basin.trim(),
        lat: s.latitude,
        lon: s.longitude,
        href: s.href,
        tier: s.tier,
        getReady: (s.tier === "normal" || s.tier === "watch") && verdicts[s.station]?.v === "alert",
        level: s.latest && s.tier !== "stale" ? formatLevel(s.latest.water_level, s.unit, 1) : null,
        measured: m ? { mm1h: r1(m.mm1h), mm3h: r1(m.mm3h), mm24h: r1(m.mm24h), at: m.endTs } : null,
        noSensor: noRainSensor(s.station),
        above24h: r1(g?.mm24h),
      };
    });
  const basins: RainMapBasin[] = MAP_BASINS.map((b) => ({
    basin: b,
    gauges: orderStations(b, gauges.filter((g) => g.basin === b).map((g) => ({ station: g.station, longitude: g.lon }))).map((g) => g.station),
    dryZone: isDryZoneBasin(b),
  }));
  return {
    generatedAt: now,
    grid: GRID,
    basinOf: BASIN_OF,
    basins,
    satellite: sat ? { credit: "GSMaP data by Japan Aerospace Exploration Agency (JAXA)", hours: sat.map((h) => ({ start: h.start, v: enc(h.v) })) } : null,
    forecast: fc ? { grid: FC_GRID, points: FC_POINTS, hours: fc.map((h) => ({ end: h.end, v: enc(h.v) })) } : null,
    gauges,
  };
}

/** The whole map payload, cached 5 minutes (the sources underneath have their own caches). */
export const getRainMap = unstable_cache(build, ["rain-map-v3"], { revalidate: 300 });
