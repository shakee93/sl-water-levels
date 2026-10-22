// Single home for reading-level maths: sanitising, freshness, rates, rain and
// threshold gaps. Everything here is pure (no I/O) so server components, the MCP
// route and the forecast/anomaly/attention heuristics all agree.
//
// Two rules that matter more than they look:
//   1. Windows are anchored to the LATEST READING, never Date.now(). Some gauges
//      lag by ~5h; anchoring to the wall clock would make their window empty and
//      silently report "no trend" for a river that is in fact rising.
//   2. null means "unknown", never zero. Rain in particular: a gauge without a
//      rain sensor reports null, and that must not read as "it was dry".

import type { Unit } from "./units";

export type Reading = {
  ts: number;
  water_level: number | null;
  rain_fall: number | null;
};

export type Thresholds = {
  alert: number | null;
  minor: number | null;
  major: number | null;
};

export const HOUR_MS = 3_600_000;
export const FT_IN_M = 0.3048;

/** Plausible gauge range. Anything outside is a sentinel (-9999 etc.), not data. */
export const LEVEL_MIN = -100;
export const LEVEL_MAX = 1000;

/** A reading older than this is "stale": the gauge is not reporting live. */
export const STALE_MINUTES = 180;

/** Negative levels (e.g. -0.24) are valid; only sentinels are rejected. */
export function sanitizeLevel(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= LEVEL_MIN || v >= LEVEL_MAX) return null;
  return v;
}

/** Rain can't be negative; null stays null. */
export function sanitizeRain(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v < 0 || v > 2000) return null;
  return v;
}

/** Thresholds <= 0 mean "not set" in this dataset. */
export function sanitizeThreshold(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

export function sanitizeThresholds(t: Thresholds): Thresholds {
  return {
    alert: sanitizeThreshold(t.alert),
    minor: sanitizeThreshold(t.minor),
    major: sanitizeThreshold(t.major),
  };
}

export function hasThresholds(t: Thresholds): boolean {
  return sanitizeThreshold(t.alert) != null || sanitizeThreshold(t.minor) != null || sanitizeThreshold(t.major) != null;
}

export function ageMinutes(reading: { ts: number } | null | undefined, now = Date.now()): number | null {
  if (!reading) return null;
  return Math.max(0, Math.round((now - reading.ts) / 60_000));
}

export function isStale(reading: { ts: number } | null | undefined, now = Date.now()): boolean {
  const a = ageMinutes(reading, now);
  return a == null || a > STALE_MINUTES;
}

/** Metres per station unit. Unknown unit (ambiguous alert 1.5-4): see below. */
export function metresPerUnit(unit: Unit, thresholds?: Thresholds): number {
  if (unit === "ft") return FT_IN_M;
  if (unit === "m") return 1;
  // Ambiguous unit. Only used to scale rate heuristics (never shown): an alert
  // mark under 3 reads more like metres than a 3-ft shallow river.
  const alert = thresholds?.alert;
  return alert != null && alert >= 3 ? FT_IN_M : 1;
}

type LevelPoint = { ts: number; water_level: number };

function levelPoints(series: Reading[]): LevelPoint[] {
  const pts: LevelPoint[] = [];
  for (const r of series) {
    const v = sanitizeLevel(r.water_level);
    if (v != null) pts.push({ ts: r.ts, water_level: v });
  }
  return pts.sort((a, b) => a.ts - b.ts);
}

export function latestTs(series: Reading[]): number | null {
  let m: number | null = null;
  for (const r of series) if (r.water_level != null && (m == null || r.ts > m)) m = r.ts;
  return m;
}

/**
 * Rate of change in station units per hour over the `hours` ending at `anchor`
 * (default: the latest valid reading in the series).
 *
 * method "endpoints" (default): first->last point of the window. Responsive,
 * what the anomaly detector and attention use.
 * method "slope": least-squares slope. Smoother; the forecast blends both.
 *
 * Needs >= 2 points spanning at least 20 minutes, else null.
 */
export function rate(
  series: Reading[],
  opts: { hours: number; anchor?: number | null; method?: "endpoints" | "slope" },
): number | null {
  const pts = levelPoints(series);
  if (pts.length < 2) return null;
  const anchor = opts.anchor ?? pts[pts.length - 1].ts;
  const from = anchor - opts.hours * HOUR_MS;
  const w = pts.filter((p) => p.ts >= from && p.ts <= anchor);
  if (w.length < 2) return null;
  const span = (w[w.length - 1].ts - w[0].ts) / HOUR_MS;
  if (span < 1 / 3) return null;

  if (opts.method === "slope") {
    const t0 = w[0].ts;
    const x = w.map((p) => (p.ts - t0) / HOUR_MS);
    const y = w.map((p) => p.water_level);
    const n = w.length;
    const sx = x.reduce((a, b) => a + b, 0);
    const sy = y.reduce((a, b) => a + b, 0);
    const sxy = x.reduce((a, b, i) => a + b * y[i], 0);
    const sxx = x.reduce((a, b) => a + b * b, 0);
    const denom = n * sxx - sx * sx;
    if (denom === 0) return null;
    return (n * sxy - sx * sy) / denom;
  }
  return (w[w.length - 1].water_level - w[0].water_level) / span;
}

/**
 * Rain over the `hours` ending at `anchor` (default: latest reading in series).
 * Returns null when the series has no rain values at all in the window (no
 * sensor / not reported) and a number (possibly 0) when it does.
 */
export function rainTotal(series: Reading[], hours: number, anchor?: number | null): number | null {
  const a = anchor ?? (series.length ? Math.max(...series.map((r) => r.ts)) : null);
  if (a == null) return null;
  const from = a - hours * HOUR_MS;
  let sum = 0;
  let saw = false;
  for (const r of series) {
    if (r.ts < from || r.ts > a) continue;
    const v = sanitizeRain(r.rain_fall);
    if (v == null) continue;
    sum += v;
    saw = true;
  }
  return saw ? sum : null;
}

export type ThresholdGap = { label: "major flood" | "minor flood" | "alert"; amount: number; crossed: boolean };

/**
 * Signed distance to the most relevant official threshold: the highest one
 * crossed, otherwise how far below alert (falling back to the lowest set mark).
 * Thresholds <= 0 are ignored. null when none are set.
 */
export function thresholdGap(level: number | null, t: Thresholds): ThresholdGap | null {
  if (level == null) return null;
  const { alert, minor, major } = sanitizeThresholds(t);
  if (major != null && level >= major) return { label: "major flood", amount: level - major, crossed: true };
  if (minor != null && level >= minor) return { label: "minor flood", amount: level - minor, crossed: true };
  if (alert != null && level >= alert) return { label: "alert", amount: level - alert, crossed: true };
  if (alert != null) return { label: "alert", amount: alert - level, crossed: false };
  if (minor != null) return { label: "minor flood", amount: minor - level, crossed: false };
  if (major != null) return { label: "major flood", amount: major - level, crossed: false };
  return null;
}
