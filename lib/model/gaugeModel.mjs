// Gauge-only next-hours model ("v2"): zero dependencies, plain ESM, shared by
// lib/forecast.ts (serving), scripts/fit-gauge-model.mjs (fitting + backtest) and the tests.
//
// What it is: for each gauge and horizon h in {1, 3, 6} hours, a robust (L1 / least absolute
// deviation, via iteratively reweighted ridge) linear regression of the CHANGE in level over the
// next h hours on
//   - the gauge's own recent changes (1, 2, 3, 6, 12 h) and its level against the last-12-hour mean,
//   - the 1 / 3 / 6 h changes at the other gauges on the same river,
//   - for tidal gauges, the change in a harmonic tide term (M2 S2 N2 K1 O1 at fixed periods).
// It is fitted on ~11 months of hourly gauge history (2025-11 to 2026-10) and scored out of sample
// (blocked cross-validation + a final untouched 60-day holdout) against "level stays put".
// Where it does not beat "level stays put" by a clear margin the horizon ships as persistence with
// an honest empirical range. Catchment rain was tried as a feature and added < 1% at 1-6 h (DOCS.md).
//
// Units: every gauge keeps its native unit (m or ft), exactly like lib/model/core.mjs.

export const H = 3_600_000;
export const GM_HORIZONS = [1, 3, 6];
export const OWN_DELTAS = [1, 2, 3, 6, 12];
export const UP_DELTAS = [1, 3, 6];
export const TIDE_PERIODS_H = [12.4206, 12, 12.6583, 23.9345, 25.8193]; // M2 S2 N2 K1 O1

/** sin/cos of every tide constituent at absolute time t (ms). */
export function tideCols(t) {
  const th = t / H, o = [];
  for (const p of TIDE_PERIODS_H) {
    const a = (2 * Math.PI * th) / p;
    o.push(Math.sin(a), Math.cos(a));
  }
  return o;
}

/**
 * Feature vector at time t for horizon h. ctx.level(gauge, t) -> level or null.
 * Returns null when the gauge's own history is missing (the caller then ships persistence).
 * An upstream change that cannot be computed is 0 ("no change", also what training used) and the
 * gauge is named in `missing` so the caller can widen the range.
 */
export function gaugeFeatures(target, up, tide, ctx, t, h) {
  const l0 = ctx.level(target, t);
  if (l0 == null) return null;
  const x = [];
  const lv = [l0];
  for (let j = 1; j <= 12; j++) {
    const v = ctx.level(target, t - j * H);
    if (v == null && (j <= 3 || OWN_DELTAS.includes(j))) return null;
    lv.push(v);
  }
  for (const k of OWN_DELTAS) x.push(l0 - lv[k]);
  let s = 0, n = 0;
  for (const v of lv) if (v != null) { s += v; n++; }
  x.push(l0 - s / n);
  const vol = (Math.abs(lv[0] - lv[1]) + Math.abs(lv[1] - lv[2]) + Math.abs(lv[2] - lv[3])) / 3;
  const missing = [];
  for (const u of up) {
    const a0 = ctx.level(u, t);
    for (const k of UP_DELTAS) {
      const b = a0 == null ? null : ctx.level(u, t - k * H);
      if (a0 == null || b == null) { x.push(0); if (!missing.includes(u)) missing.push(u); } else x.push(a0 - b);
    }
  }
  if (tide) {
    const a = tideCols(t + h * H), b = tideCols(t);
    for (let j = 0; j < a.length; j++) x.push(a[j] - b[j]);
  }
  return { x, vol, missing };
}

/** Prediction of the CHANGE in level over h hours (0 for a persistence horizon). */
export function predictGauge(hm, x) {
  if (!hm || !hm.skilled) return 0;
  let s = hm.b0;
  for (let j = 0; j < hm.w.length; j++) s += hm.w[j] * x[j];
  return s;
}

/** Signed residual quantiles (actual change minus predicted change) for the current volatility. */
export function bandFor(hm, vol) {
  const e = hm.edges;
  let b = 0;
  while (b < e.length && vol >= e[b]) b++;
  return { q10: hm.q10[b], q90: hm.q90[b] };
}

// ---- fitting helpers (also used by the tests) -------------------------------------------------

/** Ridge on standardised features with an unpenalised intercept and sample weights. Raw-unit result. */
export function fitWeightedRidge(X, y, wt, lam = 0.15) {
  const n = X.length, p = X[0].length, q = p + 1;
  let sw = 0;
  for (let i = 0; i < n; i++) sw += wt[i];
  const mean = new Float64Array(p), sd = new Float64Array(p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mean[j] += (wt[i] * X[i][j]) / sw;
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) sd[j] += (wt[i] * (X[i][j] - mean[j]) ** 2) / sw;
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const A = Array.from({ length: q }, () => new Float64Array(q + 1));
  const z = new Float64Array(q);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) z[j] = (X[i][j] - mean[j]) / sd[j];
    z[p] = 1;
    const w = wt[i];
    for (let a = 0; a < q; a++) {
      const wa = w * z[a], row = A[a];
      for (let b = a; b < q; b++) row[b] += wa * z[b];
      row[q] += wa * y[i];
    }
  }
  for (let a = 0; a < q; a++) {
    for (let b = 0; b < a; b++) A[a][b] = A[b][a];
    if (a < p) A[a][a] += lam * sw;
  }
  for (let c = 0; c < q; c++) {
    let m = c;
    for (let r = c + 1; r < q; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]];
    for (let r = 0; r < q; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f) for (let k = c; k <= q; k++) A[r][k] -= f * A[c][k];
    }
  }
  const w = [];
  let b0 = A[p][q] / A[p][p];
  for (let j = 0; j < p; j++) {
    const wj = A[j][q] / A[j][j] / sd[j];
    w.push(wj);
    b0 -= wj * mean[j];
  }
  return { b0, w };
}

export const predictLinear = (m, x) => {
  let s = m.b0;
  for (let j = 0; j < m.w.length; j++) s += m.w[j] * x[j];
  return s;
};

/** Least-absolute-deviation fit (iteratively reweighted ridge): minimises MAE, robust to gauge glitches. */
export function fitL1(X, y, lam = 0.15, iters = 6) {
  const n = X.length;
  let m = fitWeightedRidge(X, y, new Float64Array(n).fill(1), lam);
  const a = Array.from(y, Math.abs).sort((p, q) => p - q);
  const floor = 0.05 * Math.max(a[Math.floor(n / 2)], 1e-3);
  for (let it = 0; it < iters; it++) {
    const wt = new Float64Array(n);
    for (let i = 0; i < n; i++) wt[i] = 1 / Math.max(Math.abs(y[i] - predictLinear(m, X[i])), floor);
    m = fitWeightedRidge(X, y, wt, lam);
  }
  return m;
}
