// Shadow forecasts: candidate versions of the live forecast, computed beside it and LOGGED ONLY.
//
// Nothing in here is shown to visitors or read by a verdict, alert, push or the forecast panel. /api/forecasts returns the shadows
// only when asked (?shadow=1, which the hourly store job does), store-forecasts writes them to the D1 table forecast_shadow_points
// (d1/0016_forecast_shadow.sql), and scripts/forecast-scoreboard.mjs scores them next to the live forecast. A candidate is only a
// pure function of the live forecast and the gauge's own recent readings, so it can be wrong without hurting anyone.
//
// Variants:
//   copy          the live forecast, unchanged. A control: it must score exactly like live, which proves the logging and scoring work.
//   recession-v1  recession bias correction at 12 h / 24 h. The 28 Oct 2026 review found that on a falling river the forecast holds
//                 the level too high (bias +0.96 ft at 12 h, +1.83 ft at 24 h on 27 Oct; +1.4 / +3.9 ft on the main stem), because the
//                 storm flag switches off after the rain stops while the river keeps falling. Rule: when the gauge fell at least
//                 RECESSION_MIN_FALL_FT_PER_H over the last 3 h, lower the 12 h / 24 h level (and its band) by
//                 RECESSION_FRACTION x fall rate x horizon, capped at RECESSION_RANGE_SHARE of the gauge's own last-24 h range and at
//                 RECESSION_MAX_FT. Rising or steady gauges and the 1-6 h steps are copied unchanged.
//   recession-v2  per-gauge recession LAW (lib/recessionV2.mjs, lib/model/recession-params.json) at 3 / 6 / 12 / 24 h when the 3 h rate is <= -0.1 ft/h,
//                 with a rain gate (storm flag off, rain forecast known and light; unknown rain = no correction), glitch-filtered readings and
//                 a guard list of gauges where the law lost to "no change". Levels and the 80% range move; crossing chances are NOT recomputed:
//                 the nightly KPIs 4-8 (lib/forecastKpi.mjs) score shadows on levels and bands only.
//   recession-v2-slow  the same law from a gentle fall (-0.03 ft/h): tests the slow-fall bias (+0.34 ft at 12 h, +0.58 ft at 24 h in the live week).

import type { Forecast } from "./forecast";
import { TRIGGER_FT_PER_H, TRIGGER_SLOW_FT_PER_H, VARIANT as RECESSION_V2, VARIANT_SLOW as RECESSION_V2_SLOW, recessionV2, type RV2Params, type RV2Rain } from "./recessionV2.mjs";
import recessionParams from "./model/recession-params.json" with { type: "json" };

export type ShadowHorizon = { h: number; ts: number; level: number; low: number | null; high: number | null };
export type ShadowVariant = { variant: string; horizons: ShadowHorizon[] };

const FT = 0.3048;
const HOUR = 3_600_000;
export const RECESSION_VARIANT = "recession-v1";
export const RECESSION_HORIZONS = [12, 24];
export const RECESSION_MIN_FALL_FT_PER_H = 0.05;
export const RECESSION_FRACTION = 0.35;
export const RECESSION_RANGE_SHARE = 0.25;
export const RECESSION_MAX_FT = 2;

type Obs = { ts: number; level: number | null };

/** Recession correction in feet for each corrected horizon (0 when the gauge is not clearly falling). Pure. */
export function recessionCorrectionFt(unit: "ft" | "m" | null, currentLevel: number | null, asOfTs: number | null, observations: Obs[]): Record<number, number> {
  const none = Object.fromEntries(RECESSION_HORIZONS.map((h) => [h, 0]));
  if (unit == null || currentLevel == null || asOfTs == null) return none;
  const k = unit === "m" ? 1 / FT : 1;
  const valid = observations.filter((o) => o.level != null && Number.isFinite(o.level) && o.ts <= asOfTs);
  const back = valid.filter((o) => Math.abs(o.ts - (asOfTs - 3 * HOUR)) <= 40 * 60_000).sort((a, b) => Math.abs(a.ts - (asOfTs - 3 * HOUR)) - Math.abs(b.ts - (asOfTs - 3 * HOUR)))[0];
  if (!back) return none;
  const ratePerH = ((currentLevel - (back.level as number)) * k) / ((asOfTs - back.ts) / HOUR);
  if (!(ratePerH <= -RECESSION_MIN_FALL_FT_PER_H)) return none;
  const last24 = valid.filter((o) => o.ts >= asOfTs - 24 * HOUR).map((o) => (o.level as number) * k);
  const range = last24.length >= 2 ? Math.max(...last24) - Math.min(...last24) : 0;
  const cap = Math.min(RECESSION_MAX_FT, RECESSION_RANGE_SHARE * range);
  return Object.fromEntries(RECESSION_HORIZONS.map((h) => [h, Math.max(0, Math.min(cap, RECESSION_FRACTION * -ratePerH * h))]));
}

/** The candidates for one gauge: [] when the live forecast has no points. */
/**
 * `rain` = the run's rain inputs for the recession-v2 gate (storm flag, 6 h forecast rain, 24 h p90); omitted or null = unknown, and then the v2 variants are
 * plain copies. `station` is needed for the per-gauge law (omitted: v2 variants are copies).
 */
export function shadowVariants(f: Pick<Forecast, "unit" | "currentLevel" | "asOfTs" | "horizons" | "method"> & { station?: string }, observations: Obs[], rain?: RV2Rain | null): ShadowVariant[] {
  if (!f.horizons.length) return [];
  const copy = f.horizons.map((p) => ({ ...p }));
  const corr = f.method === "model" ? recessionCorrectionFt(f.unit, f.currentLevel, f.asOfTs, observations) : null;
  const back = f.unit === "m" ? FT : 1; // feet -> the gauge's unit
  const rec = f.horizons.map((p) => {
    const c = (corr?.[p.h] ?? 0) * back;
    return c > 0 ? { ...p, level: p.level - c, low: p.low == null ? null : p.low - c, high: p.high == null ? null : p.high - c } : { ...p };
  });
  const v2 = (trigger: number) => {
    const g = f.station ? { station: f.station, unit: f.unit, currentLevel: f.currentLevel, asOfTs: f.asOfTs, method: f.method, horizons: f.horizons } : null;
    return g ? recessionV2(g, observations, rain, recessionParams as unknown as RV2Params, { trigger }).horizons : f.horizons.map((p) => ({ ...p }));
  };
  return [
    { variant: "copy", horizons: copy },
    { variant: RECESSION_VARIANT, horizons: rec },
    { variant: RECESSION_V2, horizons: v2(TRIGGER_FT_PER_H) },
    { variant: RECESSION_V2_SLOW, horizons: v2(TRIGGER_SLOW_FT_PER_H) },
  ];
}
