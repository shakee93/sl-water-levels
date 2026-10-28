// Display rules for the forecast (owner decisions, 28 Oct 2026, from the forecast-vs-reality audit of 22-28 Oct 2026:
// research/forecast-audit-workflow-2026-10-28.md, kept private). Pure and dependency-free: lib/forecast.ts, the town notes, the
// scoreboard and the node tests all import this one file, so a list or a number is changed in one place.
//
// Official steps (Normal / Alert / Minor / Major) alone drive verdicts and push alerts. Everything here changes only the forecast
// NUMBERS and WORDS that are shown. The raw model output is kept for the log (forecast store) so calibration can be refitted.

// ---- 1. probability caps ------------------------------------------------------------------------------------------------
// Audit (9,384 scored runs, 26-27 Oct flood): the stated chance of reaching MINOR was badly overstated: p >= 0.2 was stated ~0.49 on
// average and came true 0.18 of the time (0.04 without the small coastal catchments Baddegama / Dunamale / Panadugama; Kelani 3%,
// Kalu 6%, Deduru 0%, Maha 0%). MAJOR: 0 hits in 1,180+ runs, 119 runs stated 20% or more (max 60%). The ALERT chance was well
// calibrated (p >= 0.5 hit 79-83%, p >= 0.8 about 96%) and stays as it is. Backtest of the cap: Brier 0.068 -> about 0.049.
// Provisional: 8 station-days for minor, none for major (the 10% is a judgement). Refit when more floods are logged.
export const MINOR_P_CAP = 0.3;
export const MAJOR_P_CAP = 0.1;
/** The most chance a forecast may show for reaching each mark. Alert is not capped. */
export const P_CAP = { alert: 1, minor: MINOR_P_CAP, major: MAJOR_P_CAP };
/** Below this a crossing is "unlikely" and never headlined (same 0.2 as lib/forecast.ts POSSIBLE). */
export const POSSIBLE_P = 0.2;

/** The chance to show (0..1) for a mark: the model's probability, capped. The raw figure goes to the log, never to a page. */
export function shownChance(threshold, p) {
  return Math.min(p, P_CAP[threshold] ?? 1);
}

/**
 * The wording to show for a mark. Minor and major are never "likely" (the audit: it came true about 1 in 6, and never for major):
 * "likely" becomes "possible", and a major crossing whose capped chance is under 20% is "unlikely" (not headlined). Alert unchanged.
 * `wording` is "likely" | "possible" | "unlikely" | "already".
 */
export function shownWording(threshold, wording, shownP) {
  if (threshold === "alert" || wording === "already") return wording;
  const w = wording === "likely" ? "possible" : wording;
  return w === "possible" && shownP < POSSIBLE_P ? "unlikely" : w;
}

// ---- 2. gauges that get no forecast -------------------------------------------------------------------------------------
/**
 * Gauges with unusable data (audit finding 9): Ampara reads a stuck 0.00, Katharagama and Weraganthota report negative datum
 * values. They show the level and the official step only, with "No forecast for this gauge". Remove a name when the readings are
 * trustworthy again.
 */
export const NO_FORECAST_GAUGES = ["Ampara", "Katharagama", "Weraganthota"];
export const hasNoForecast = (station) => NO_FORECAST_GAUGES.includes(station);

// ---- 3. fast tributaries: short forecasts only --------------------------------------------------------------------------
/**
 * The nine fast tributaries the scoreboard scores as the "fast" group (lib/forecastScoreboard.mjs): they rise and fall within hours,
 * so real alert crossings got only 1-2 hours of notice and the 12 h forecast was worse than "level stays put" (skill -6%; calm era
 * negative at every horizon; storm-era range covered 56-57% at 12-24 h).
 */
export const FAST_TRIBUTARIES = ["Holombuwa", "Deraniyagala", "Kithulgala", "Norwood", "Thawalama", "Pitabeddara", "Urawa", "Peradeniya", "Nawalapitiya"];
/** Gauges whose forecast is shown only up to FAST_MAX_H hours: the nine above plus Panadugama (named in the audit with the fast ones: real crossings got 1-2 h notice). */
export const SHORT_FORECAST_GAUGES = [...FAST_TRIBUTARIES, "Panadugama"];
export const FAST_MAX_H = 6;
export const isShortForecastGauge = (station) => SHORT_FORECAST_GAUGES.includes(station);
/** The longest horizon (hours) a gauge's forecast may show, or null for no limit. */
export const maxForecastHours = (station) => (isShortForecastGauge(station) ? FAST_MAX_H : null);

// ---- 4. one threshold for "steady" --------------------------------------------------------------------------------------
/**
 * One rate (metres per hour, from the 3 h change) below which a river is "steady", for every sentence, card, tile, note and embed.
 * Before this, lib/answers.ts, app/verdict.ts, app/tierUi.ts, lib/nextHour.ts, lib/townRisk.ts and others each held a private copy of
 * 0.006, and RiverNet pages said "falling" in the top sentence (3 h rate) while the card said "Steady" (1 h forecast change).
 */
export const STEADY_M_PER_H = 0.006;
/** Falling = the last 3 h rate is below minus the steady band. null = unknown = not falling. */
export const isFalling3h = (rate3hM) => rate3hM != null && Number.isFinite(rate3hM) && rate3hM < -STEADY_M_PER_H;

/**
 * Falling river and the "next 24 hours" words (item 4). The audit: after a peak the model keeps the river high for a day, so "Little change
 * expected" / "Risk stays high" was shown while the river fell several feet ("Little change expected" was wrong in 71 of 71 checkable
 * runs, 93% fell 1 ft or more). When the last 3 h are falling the day line says so instead:
 *   "keeps" = falling now and the forecast is lower too ("Falling; expected to keep dropping"), "now" = falling now ("Falling now").
 * `level` and the horizon levels are in the gauge's unit, `mpu` = metres per unit. null = not falling (or unknown): the usual wording applies.
 */
export const FALL_KEEPS_M = 0.03;
export function fallingOutlook({ rate3hM, level, horizons, mpu }) {
  if (!isFalling3h(rate3hM) || level == null || !Number.isFinite(level)) return null;
  const lower = (horizons ?? []).some((x) => x.h >= 3 && Number.isFinite(x.level) && (level - x.level) * (mpu ?? 1) >= FALL_KEEPS_M);
  return lower ? "keeps" : "now";
}

/**
 * The rate behind the "Next hour" tile, metres per hour. Normally the forecast's 1 h change. A gauge with no fitted model and no extra
 * skill (RiverNet 1-minute sensors, HMIS-only gauges) forecasts "level stays": the tile then said "Steady" while the sentence above it,
 * built from the 3 h change, said "falling". Those gauges use the measured 3 h rate for the tile, so both agree.
 */
export function nextHourRateM({ h1ChangeM, rate3hM, source, method }) {
  const extra = source === "rivernet" || source === "hmis";
  if (extra && method !== "model" && rate3hM != null) return rate3hM;
  return h1ChangeM ?? rate3hM ?? null;
}
