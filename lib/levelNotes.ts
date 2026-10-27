// Three small NOTES under a gauge's verdict (owner approved, 27 Oct 2026, after the 26 Oct "Does this match what you see?" answers).
// They are notes only: they never change the step (Normal -> Alert -> Minor flood -> Major flood), the pill colour, the sticky bar,
// push notifications or the tone. Pure and dependency-free (node tests import it); all data is the 24 h readings the page already has.
//
//   1. riseSummary  "Rose 7.9 ft in the last 9 hours"   Hanwella went 14 -> 22 ft in ~9 h while the card only said "Rising".
//   2. fallSummary  "Down 1.2 ft since the peak at 3:40 pm"   gauges still at Alert or above but already falling (the "better than shown" answers).
//   3. streetRainNote  "River normal, but street water is possible here"   Katuneriya: ~139 mm satellite rain, river gauge below alert.
//
// Levels are in the gauge's own unit; `mpu` (metres per unit) turns them into metres so one threshold serves feet and metre gauges.

// @ts-ignore node strip-types needs explicit extensions
import { HEAVY_MM_6H, HEAVY_MM_24H, STREET_LIKELY_MM_24H } from "./townRisk.ts";

type Pt = { ts: number; water_level: number | null };
const HOUR = 3_600_000;

/** A rise is worth a line from this much (metres): 0.45 m = 1.5 ft. Smaller moves are what "Rising" already says. */
export const RISE_MIN_M = 0.45;
/** The rise is measured from the lowest reading of the last 12 h ... */
export const RISE_WINDOW_H = 12;
/** ... and is worded "in the last N hours" only when that low is at least this old (a 2 h-old low still counts if the rise is large: Deraniyagala 8 -> 13 ft in 2 h). */
export const RISE_MIN_HOURS = 1;
/** Still near the top: the newest reading is within this fraction of the rise below the window's highest reading, else the river has already turned. */
export const RISE_NEAR_TOP = 0.15;

/** The climb is still going: at least this fraction of the rise happened in the last 3 h (a rise that levelled off hours ago is not "current"). */
export const RISE_RECENT_FRAC = 0.2;

/** "Clearly falling": down at least this much (metres, 0.1 m ~ 0.33 ft) from the 24 h peak ... */
export const FALL_MIN_M = 0.1;
/** ... and the last 2 h are falling: no reading in them above the one before, and the newest this much (metres, ~0.1 ft) under the reading 2 h earlier. */
export const FALL_LAST2H_M = 0.03;
/** Readings closer than this to each other count as the same level (gauge jitter, metres). */
const JITTER_M = 0.01;

const pts = (series: readonly Pt[] | null | undefined): { ts: number; v: number }[] =>
  (series ?? []).filter((r): r is { ts: number; water_level: number } => r.water_level != null && Number.isFinite(r.water_level)).map((r) => ({ ts: r.ts, v: r.water_level })).sort((a, b) => a.ts - b.ts);

export type Rise = { /** metres */ riseM: number; /** whole hours since the low */ hours: number };

/**
 * How far the river has climbed from its lowest reading of the last 12 h, when that is a lot (>= RISE_MIN_M) and the river is still
 * near the top of it. null = nothing worth saying (small rise, already falling back, not enough readings). `mpu` = metres per gauge unit.
 */
export function riseSummary(series: readonly Pt[] | null | undefined, mpu: number): Rise | null {
  const p = pts(series);
  if (p.length < 3 || !(mpu > 0)) return null;
  const last = p[p.length - 1];
  const win = p.filter((x) => x.ts >= last.ts - RISE_WINDOW_H * HOUR);
  let low = win[0];
  for (const x of win) if (x.v <= low.v) low = x; // the latest of equal lows: the start of the current climb
  const riseM = (last.v - low.v) * mpu;
  const hoursSince = (last.ts - low.ts) / HOUR;
  if (riseM < RISE_MIN_M || hoursSince < RISE_MIN_HOURS) return null;
  const topM = (Math.max(...win.map((x) => x.v)) - last.v) * mpu;
  if (topM > riseM * RISE_NEAR_TOP) return null;
  const back = win.filter((x) => x.ts <= last.ts - 3 * HOUR).pop() ?? win[0];
  if ((last.v - back.v) * mpu < riseM * RISE_RECENT_FRAC) return null;
  return { riseM, hours: Math.max(1, Math.round(hoursSince)) };
}

export type Fall = { /** metres below the peak */ dropM: number; peakTs: number };

/**
 * A gauge that is still at Alert or above (the caller checks) and clearly falling: down >= FALL_MIN_M from the highest reading of the
 * last 24 h and falling through the last 2 h. null otherwise. A note: it does not change the step.
 */
export function fallSummary(series: readonly Pt[] | null | undefined, mpu: number): Fall | null {
  const p = pts(series);
  if (p.length < 4 || !(mpu > 0)) return null;
  const last = p[p.length - 1];
  const day = p.filter((x) => x.ts >= last.ts - 24 * HOUR);
  let peak = day[0];
  for (const x of day) if (x.v > peak.v) peak = x; // the first of equal peaks
  const dropM = (peak.v - last.v) * mpu;
  if (dropM < FALL_MIN_M || last.ts - peak.ts < HOUR) return null;
  // the last 2 h: never going back up, and lower than 2 h ago
  const recent = p.filter((x) => x.ts >= last.ts - 2 * HOUR);
  for (let i = 1; i < recent.length; i++) if ((recent[i].v - recent[i - 1].v) * mpu > JITTER_M) return null;
  const earlier = p.filter((x) => x.ts <= last.ts - 1.5 * HOUR).pop(); // nearest reading about 2 h back
  if (!earlier || (earlier.v - last.v) * mpu < FALL_LAST2H_M) return null;
  return { dropM, peakTs: peak.ts };
}

/**
 * The hourly satellite rain beside the gauge (oldest first, mm in each hour, null = file missing), summed over the last 24 h with each
 * hour clipped at capMm: the same clip and 75% coverage rule as the street-rain zones (lib/streetRainWindow.mjs). null = too many gaps.
 */
export function nearRain24hClipped(hourlyNear: readonly (number | null)[] | null | undefined, capMm = 15): number | null {
  if (!hourlyNear || hourlyNear.length < 18) return null;
  const last24 = hourlyNear.slice(-24);
  const have = last24.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (have.length < Math.ceil(last24.length * 0.75)) return null;
  const sum = have.reduce((a, v) => a + Math.min(Math.max(v, 0), capMm), 0);
  return Math.round(((sum * last24.length) / have.length) * 10) / 10;
}

/** Great-circle distance in km (same formula as lib/nearby.ts distanceKm, repeated so this file stays dependency-free). */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** The towns within maxKm of the gauge, nearest first, at most `max`. */
export function townsNear<T extends { lat: number; lon: number }>(gauge: { lat: number; lon: number }, towns: readonly T[], maxKm = 15, max = 2): T[] {
  return towns
    .map((t) => ({ t, d: km(gauge, t) }))
    .filter((x) => x.d <= maxKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.t);
}

/**
 * Heavy rain around the gauge, from the machinery the town pages already use (no new thresholds):
 *   - satellite catchment rain at the town "heavy rain" marks (lib/townRisk.ts HEAVY_MM_6H 50 / HEAVY_MM_24H 100, isHeavyRain), or
 *   - satellite rain in the cells beside the gauge, hourly-clipped 24 h sum at the "street water likely" mark (STREET_LIKELY_MM_24H 100), or
 *   - the gauge's own rain sensor at the river's flood trigger (lib/rainTriggers.ts, passed in as `measuredHeavy`).
 * The caller shows it only when the gauge and the verdict are below Alert.
 */
export function heavyRainAround(o: { catch6h: number | null; catch24h: number | null; near24hClipped: number | null; measuredHeavy: boolean }): boolean {
  return (
    o.measuredHeavy ||
    (o.catch6h ?? 0) >= HEAVY_MM_6H ||
    (o.catch24h ?? 0) >= HEAVY_MM_24H ||
    (o.near24hClipped ?? 0) >= STREET_LIKELY_MM_24H
  );
}
