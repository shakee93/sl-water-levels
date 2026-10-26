// Storm correction ("v3"): zero dependencies, plain ESM, shared by lib/forecast.ts (serving),
// scripts/storm-backtest.mjs / scripts/fit-storm-model.mjs (fitting + backtest) and the tests.
//
// Why it exists: the gauge-only model (gaugeModel.mjs) is fitted to ~11 months in which most hours are calm, so the
// rain term added < 1% on average. In a storm the river does something it almost never does the rest of the time, and
// the gauge's own recent change cannot know more rain is coming. So rain is used ONLY on storm hours ("gate" below):
//   prediction = gauge-only change  +  correction(rain)         on storm hours
//   prediction = gauge-only change                               otherwise (identical to before, so calm hours cannot get worse)
// The correction is a small non-negative linear model per gauge and horizon, fitted on the gauge's storm hours only, on
// what the gauge-only model got wrong, with four rain features (mm, catchment-mean over the gauge's upstream area):
//   A  rain in the gauge's routing window (the lag the river takes to respond), observed + forecast
//   A*W  the same when the ground is already wet (W = rain over the last 72 h / 100 mm, capped at 2.5)
//   F  rain forecast to fall before the horizon
//   F*W  the same on wet ground
// Rain is read as r(k): mm in the hour ending k hours after the forecast time (k <= 0 observed, k > 0 forecast).

export const STORM_HORIZONS = [1, 3, 6, 12, 24];
export const STORM_FEATURES = ["routed rain", "routed rain x wet ground", "forecast rain before horizon", "forecast rain x wet ground"];
export const WET_CAP = 2.5;

const sum = (r, a, b) => {
  let s = 0;
  for (let k = a; k <= b; k++) { const v = r(k); if (v == null || !Number.isFinite(v)) return null; s += v; }
  return s;
};

/** Rain totals the gate and the warning use: past 24 h and the forecast next 24 h (mm), null when hours are missing. */
export function rainTotals(r) {
  return { past24: sum(r, -23, 0), next24: sum(r, 1, 24), past72: sum(r, -71, 0) };
}

/** Storm gate: the heavier of "rain that fell in the last 24 h" and "rain forecast for the next 24 h" reaches `gate` mm. */
export function isStormHour(r, gate) {
  const t = rainTotals(r);
  const m = Math.max(t.past24 ?? 0, t.next24 ?? 0);
  return m >= gate;
}

/**
 * Feature vector for horizon h and a routing window (from, to): rain in (h-from, h-to] hours after the forecast time.
 * Returns null if the routed window or the wetness cannot be computed (the caller then ships the gauge-only answer).
 */
export function stormFeatures(r, h, win) {
  const from = win?.from ?? 12, to = win?.to ?? 2;
  const lo = h - from + 1, hi = h - to;
  const A = hi >= lo ? sum(r, lo, hi) : 0;
  const F = sum(r, 1, h);
  const p72 = sum(r, -71, 0);
  if (A == null || F == null) return null;
  const W = Math.min((p72 ?? 0) / 100, WET_CAP);
  return [A, A * W, F, F * W];
}

/** Predicted EXTRA change (gauge units) on top of the gauge-only prediction; 0 when the gauge/horizon has no storm model. */
export function stormCorrection(sm, x) {
  if (!sm || !sm.use || !x) return 0;
  let s = sm.b0;
  for (let j = 0; j < sm.w.length; j++) s += sm.w[j] * x[j];
  return s;
}

/** Ridge, non-negative weights, free intercept, optional sample weights; projected coordinate descent. */
export function fitNonNeg(X, y, wt, lam = 0.5, sweeps = 300) {
  const n = X.length, p = X[0].length;
  const sc = new Float64Array(p);
  for (let j = 0; j < p; j++) { let s = 0; for (let i = 0; i < n; i++) s += X[i][j] ** 2; sc[j] = Math.sqrt(s / n) || 1; }
  const b = new Float64Array(p);
  let b0 = 0;
  const res = Float64Array.from(y);
  let sw = 0;
  for (let i = 0; i < n; i++) sw += wt[i];
  for (let it = 0; it < sweeps; it++) {
    let delta = 0;
    // intercept
    let m = 0;
    for (let i = 0; i < n; i++) m += wt[i] * res[i];
    m /= sw;
    b0 += m;
    for (let i = 0; i < n; i++) res[i] -= m;
    for (let j = 0; j < p; j++) {
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { const z = X[i][j] / sc[j]; num += wt[i] * z * (res[i] + b[j] * z); den += wt[i] * z * z; }
      const nb = Math.max(0, num / (den + lam * sw));
      const d = nb - b[j];
      if (d) { for (let i = 0; i < n; i++) res[i] -= d * (X[i][j] / sc[j]); b[j] = nb; delta = Math.max(delta, Math.abs(d)); }
    }
    if (delta < 1e-7) break;
  }
  return { b0, w: Array.from(b, (v, j) => v / sc[j]) };
}

/** Least-absolute-deviation version (iteratively reweighted), robust to the odd gauge glitch. */
export function fitNonNegL1(X, y, lam = 0.5, iters = 5) {
  const n = X.length;
  let m = fitNonNeg(X, y, new Float64Array(n).fill(1), lam);
  const a = Array.from(y, Math.abs).sort((p, q) => p - q);
  const floor = 0.05 * Math.max(a[Math.floor(n / 2)], 1e-3);
  for (let it = 0; it < iters; it++) {
    const wt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let p = m.b0;
      for (let j = 0; j < m.w.length; j++) p += m.w[j] * X[i][j];
      wt[i] = 1 / Math.max(Math.abs(y[i] - p), floor);
    }
    m = fitNonNeg(X, y, wt, lam);
  }
  return m;
}

// ===========================================================================================================================
// v4: the same storm-hour idea, but the rain it reads is MEASURED (satellite, GSMaP_NOW per catchment, bias-corrected per
// catchment) for the past, and the catchment is split into "near" (beside the gauge) and "up" (up-channels: the sub-catchments of
// the gauges upstream), each with its OWN travel time to the gauge. Fitted by scripts/fit-storm-model-v4.mjs.
//
// Rain series passed in are functions r(k): mm in the hour ending k hours after the forecast time (k <= -1 measured, k = 0 the
// weather model's own hour (the newest satellite hour is not out yet at the forecast time), k >= 1 forecast).
// ===========================================================================================================================

export const STORM4_FEATURES = [
  "rain beside the gauge, timed to arrive", "rain on up-channels, timed to arrive", "arriving rain x wet ground",
  "forecast rain before horizon", "forecast rain x wet ground",
  "measured last 1 h", "measured last 3 h", "measured last 6 h", "measured last 12 h", "measured last 24 h",
];
export const STORM4_PROD_DEFAULT = "now0";

/** Window of hours, relative to the forecast time, whose rain reaches the gauge by horizon h when the travel time is `lag` hours. */
export function arrivalWindow(h, lag) {
  return { lo: h - Math.round(lag) - 3, hi: Math.min(h - Math.round(lag) + 3, h) };
}

/**
 * Feature vector for horizon h. rFull / rNear / rUp are rain functions (see above); lags = { near, up } in hours.
 * Returns null if any needed hour is missing (the caller then ships the gauge-only answer).
 * @returns {number[] | null}
 */
export function stormFeatures4(rFull, rNear, rUp, h, lags) {
  const wn = arrivalWindow(h, lags?.near ?? 3), wu = arrivalWindow(h, lags?.up ?? 12);
  const An = wn.hi >= wn.lo ? sum(rNear, wn.lo, wn.hi) : 0;
  const Au = rUp ? (wu.hi >= wu.lo ? sum(rUp, wu.lo, wu.hi) : 0) : 0;
  const F = sum(rFull, 1, h);
  const p72 = sum(rFull, -71, -1);
  const M = [1, 3, 6, 12, 24].map((n) => sum(rFull, -n, -1));
  if (An == null || Au == null || F == null || M.some((v) => v == null)) return null;
  const W = Math.min((p72 ?? 0) / 100, WET_CAP);
  return [An, Au, (An + Au) * W, F, F * W, ...M];
}

/** The v4 storm hour: measured rain of the last 24 h or forecast rain of the next 24 h reaches `gate` mm, or a burst of `burst` mm in 3 h. */
export function isStormHour4(rFull, gate, burst) {
  const p24 = sum(rFull, -24, -1), n24 = sum(rFull, 1, 24), m3 = sum(rFull, -3, -1);
  return Math.max(p24 ?? 0, n24 ?? 0) >= gate || (m3 ?? 0) >= burst;
}

const H4 = 3_600_000;

/**
 * Rain functions for the v4 storm model at one forecast time, or null when the satellite hours it needs are not there.
 *   sat    one station of gsmap/latest.json: { hourlyEnd, hourly[96], hourlyNear[96] | null, hourlyUp[96] | null } (raw mm/h, oldest first; the
 *          last entry is the hour ending hourlyEnd; null = missing hour)
 *   om     Open-Meteo series keyed by hour-end ms: { full, near, up, fullHeavy? } (fullHeavy = same with the heavier scenario for the future)
 *   factor per-catchment bias factor, clip = mm/h cap on each hour (both from storm-model-v4.json)
 * k <= -1: satellite; k = 0: the weather model's hour; k >= 1: its forecast. The hour ending at k = -1 must be present, and the 24 h of
 * measured rain before it must be mostly there (a missing hour makes the sums null, which stormFeatures4 turns into "no correction").
 */
export function v4Rain(sat, factor, clip, origin, om) {
  if (!sat || !Array.isArray(sat.hourly) || !Number.isFinite(sat.hourlyEnd) || !om?.full || !om.near) return null;
  const at = (arr, k) => {
    if (!arr) return null;
    const i = 95 - Math.round((sat.hourlyEnd - (origin + k * H4)) / H4);
    const v = i >= 0 && i < arr.length ? arr[i] : null;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(v * factor, clip) : null;
  };
  if (at(sat.hourly, -1) == null) return null;
  const mk = (arr, o) => (k) => (k <= -1 ? at(arr, k) : o?.[origin + k * H4]);
  return {
    rFull: mk(sat.hourly, om.full),
    rFullHeavy: om.fullHeavy ? mk(sat.hourly, om.fullHeavy) : null,
    rNear: mk(sat.hourlyNear ?? sat.hourly, om.near),
    rUp: sat.hourlyUp && om.up ? mk(sat.hourlyUp, om.up) : null,
  };
}

/** Rain tier of the v4 rain functions for the band bin: 1 when the heavier of measured-24 h / forecast-24 h reaches 100 mm. */
export function tier4Bin(rFull) {
  let a = 0, b = 0;
  for (let k = -24; k <= -1; k++) a += rFull(k) ?? 0;
  for (let k = 1; k <= 24; k++) b += rFull(k) ?? 0;
  return Math.max(a, b) >= 100 ? 1 : 0;
}
