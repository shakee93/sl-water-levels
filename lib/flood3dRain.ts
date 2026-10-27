// "Rain now" for the unlisted 3D flood test map: a small intensity field (mm/h) over the corridor, from data we already have, no new
// external request: the newest hourly satellite frame (JAXA GSMaP via the rain map cache) times the gauge-correction gain
// (rain-correction on the data branch), pulled toward live HMIS ground gauges that reported within the last hour (hmis/rain-live.json
// plus the site's own HMIS cache). An estimate: the satellite frame is 1-2 h old and ground gauges only say what fell at their spot.
// Gauge-reported rain is a LOWER bound (lib/groundRain.ts), so a gauge never invents rain, it can miss some. Nothing here is an official step.
import { unstable_cache } from "next/cache";
import { getRainMap } from "./rainMap";
import { getGroundGauges } from "./groundRainLive";
import { gaugeTotals, haversineKm } from "./groundRain";

export const RAIN_BOX = { south: 6.85, north: 7.05, west: 79.79, east: 80.15, step: 0.01 };
const NX = Math.round((RAIN_BOX.east - RAIN_BOX.west) / RAIN_BOX.step);
const NY = Math.round((RAIN_BOX.north - RAIN_BOX.south) / RAIN_BOX.step);
/** Ground gauge counts for a cell within this distance; the weight fades to the satellite by then. */
const NEAR_KM = 8;
const FRESH_MIN = 60;

export type RainGauge = { n: string; i: string; lat: number; lon: number; mm1h: number | null; mm24h: number; ageMin: number };
export type RainNow = {
  generatedAt: string;
  /** Grid: row 0 is the NORTH edge. v = tenths of mm/h, comma separated, rows top to bottom. */
  grid: { west: number; north: number; south: number; east: number; step: number; nx: number; ny: number };
  v: string;
  satelliteHourStart: number | null;
  /** Age of the satellite hour (minutes since the hour ENDED); the satellite part fades out between 2 h and 4 h old. */
  satelliteAgeMin: number | null;
  groundGauges: number;
  gauges: RainGauge[];
  credit: string;
};

const num = (s: string) => (s === "x" ? null : Number(s));

async function build(): Promise<RainNow | null> {
  const now = Date.now();
  const [map, ground] = await Promise.all([getRainMap().catch(() => null), getGroundGauges(now)]);
  // satellite: newest hour, corrected by the per-pixel gain where there is one
  let sat: { at: number; field: (lat: number, lon: number) => number | null } | null = null;
  const hour = map?.satellite?.hours.at(-1);
  if (map && hour) {
    const raw = hour.v.split(",").map((x) => (x === "x" ? -1 : x === "" ? 0 : Number(x)));
    const gain = map.corrected?.gain ? map.corrected.gain.split(",").map(num) : null;
    const g = map.grid;
    // the satellite frame is 1-2 h old by the time it is published: full weight up to 2 h after its hour ended, then fading to nothing at 4 h
    const ageMin = (now - (hour.start + 3_600_000)) / 60_000;
    const fade = ageMin <= 120 ? 1 : Math.max(0, 1 - (ageMin - 120) / 120);
    const at = (r: number, c: number) => {
      if (r < 0 || c < 0 || r >= g.ny || c >= g.nx) return null;
      const i = r * g.nx + c;
      if (raw[i] < 0) return null;
      const f = gain && gain[i] != null ? Math.min(3, Math.max(0.1, (gain[i] as number) / 100)) : 1;
      return (raw[i] / 10) * f * fade; // mm/h
    };
    sat = {
      at: hour.start,
      field: (lat, lon) => {
        const fr = (g.lat0 - lat) / g.step, fc = (lon - g.lon0) / g.step;
        const r0 = Math.floor(fr), c0 = Math.floor(fc), dr = fr - r0, dc = fc - c0;
        let sum = 0, wsum = 0;
        for (const [r, c, w] of [[r0, c0, (1 - dr) * (1 - dc)], [r0, c0 + 1, (1 - dr) * dc], [r0 + 1, c0, dr * (1 - dc)], [r0 + 1, c0 + 1, dr * dc]] as const) {
          const v = at(r, c);
          if (v != null && w > 0) { sum += v * w; wsum += w; }
        }
        return wsum > 0.4 ? sum / wsum : null;
      },
    };
  }
  // ground gauges that reported within the hour, in or near the box
  const near = ground
    .map((gg) => ({ gg, t: gaugeTotals(gg.pts, now) }))
    .filter((x): x is { gg: (typeof ground)[number]; t: NonNullable<ReturnType<typeof gaugeTotals>> } => !!x.t && x.gg.lat > RAIN_BOX.south - 0.1 && x.gg.lat < RAIN_BOX.north + 0.1 && x.gg.lon > RAIN_BOX.west - 0.1 && x.gg.lon < RAIN_BOX.east + 0.1);
  const live = near.filter((x) => x.t.ageMin <= FRESH_MIN && x.t.mm1h != null);
  if (!sat && !live.length) return null;
  const out: number[] = [];
  for (let r = 0; r < NY; r++) {
    for (let c = 0; c < NX; c++) {
      const lat = RAIN_BOX.north - (r + 0.5) * RAIN_BOX.step, lon = RAIN_BOX.west + (c + 0.5) * RAIN_BOX.step;
      const s = sat?.field(lat, lon) ?? null;
      let num_ = 0, den = 0, dmin = Infinity;
      for (const { gg, t } of live) {
        const d = haversineKm({ lat, lon }, gg);
        if (d > NEAR_KM) continue;
        const w = 1 / Math.max(1, d) ** 2;
        num_ += w * (t.mm1h as number); den += w; dmin = Math.min(dmin, d);
      }
      let v: number;
      if (den > 0) {
        const wg = Math.max(0, 1 - dmin / NEAR_KM);
        const gv = num_ / den;
        v = s == null ? gv : wg * gv + (1 - wg) * s;
      } else v = s ?? 0;
      out.push(v < 0.3 ? 0 : Math.round(v * 10));
    }
  }
  return {
    generatedAt: new Date(now).toISOString(),
    grid: { west: RAIN_BOX.west, north: RAIN_BOX.north, south: RAIN_BOX.south, east: RAIN_BOX.east, step: RAIN_BOX.step, nx: NX, ny: NY },
    v: out.map((x) => (x === 0 ? "" : String(x))).join(","),
    satelliteHourStart: sat?.at ?? null,
    satelliteAgeMin: sat ? Math.round((now - (sat.at + 3_600_000)) / 60_000) : null,
    groundGauges: live.length,
    gauges: near.map(({ gg, t }) => ({ n: gg.n, i: gg.i, lat: Math.round(gg.lat * 1e4) / 1e4, lon: Math.round(gg.lon * 1e4) / 1e4, mm1h: t.mm1h, mm24h: t.mm24h, ageMin: t.ageMin })),
    credit: "Satellite: GSMaP (JAXA). Ground gauges: HMIS, Irrigation Department, Meteorology Department and NBRO.",
  };
}

export const getFlood3dRain = unstable_cache(async () => build(), ["flood3d-rain-v2"], { revalidate: 180 });
