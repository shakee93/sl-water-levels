// Shared numerics for the river-level forecast. Plain ESM JavaScript with zero
// dependencies so the SAME code runs in the Next.js app (lib/forecast.ts), in the
// fitting script (scripts/fit-forecast.mjs) and in the backtest. Types live in
// core.d.mts.
//
// Model in one paragraph: for each station and horizon h in {1,3,6,12,24} hours,
// a ridge regression predicts the CHANGE in level over the next h hours
// (y = level(t+h) - level(t)) from lagged changes at upstream "leader" gauges,
// the station's own recent change, its level (mean reversion) and the catchment
// rain in a window that straddles the present: (t+h-from, t+h-to]. For long
// horizons that window lies in the future, so it is fed forecast rain.
//
// Everything is in each gauge's native unit (ft or m). The coefficients are
// unit-specific, which is fine: a gauge keeps its unit.

export const H = 3_600_000;
export const HORIZONS = [1, 3, 6, 12, 24];
export const LAMBDA = 0.15; // ridge strength on standardised features
const HOLD_MS = 2 * H; // hold the last reading flat for at most this long
const GAP_MS = 6 * H; // never interpolate across a gap longer than this
export const COLOMBO_MS = 5.5 * H;

export const dayOf = (t) => Math.floor((t + COLOMBO_MS) / (24 * H));

/** Linear interpolation of a sorted [{ts, wl}] series at time t; null if unsupported by data. */
export function interp(a, t) {
  let lo = 0, hi = a.length - 1, idx = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (a[m].ts <= t) { idx = m; lo = m + 1; } else hi = m - 1;
  }
  if (idx < 0) return null;
  const p = a[idx];
  if (p.ts === t) return p.wl;
  const q = a[idx + 1];
  if (!q) return t - p.ts <= HOLD_MS ? p.wl : null;
  if (q.ts - p.ts > GAP_MS) return null;
  return p.wl + ((q.wl - p.wl) * (t - p.ts)) / (q.ts - p.ts);
}

/**
 * Rain (mm) over the window (a, b], from hourly bins keyed by their END time T
 * (Open-Meteo convention: value at T is the sum over (T-1h, T]). Fractional
 * overlap is prorated. `rain(T)` returns mm or undefined; any missing bin => null.
 */
export function rainIn(rain, a, b) {
  let s = 0;
  for (let T = (Math.floor(a / H) + 1) * H; T - H < b; T += H) {
    const ov = Math.min(b, T) - Math.max(a, T - H);
    if (ov <= 0) continue;
    const v = rain(T);
    if (v == null || !Number.isFinite(v)) return null;
    s += (v * ov) / H;
  }
  return s;
}

/**
 * Feature vector for station config `cfg` at time t and horizon h. Entries are
 * null when the data behind them is missing. ctx = { level(gauge, t), rain(T), rainFor?(t) }
 * (rainFor lets the backtest hide rain that had not fallen yet at time t).
 * Term kinds:
 *   delta  mean over gauges g of level(t) - level(t - hrs)   (leaders and the station's own trend)
 *   rain   catchment rain in (t+h-from, t+h-to]
 *   level  the station's own level now (mean reversion)
 */
export function features(cfg, ctx, t, h) {
  return cfg.terms.map((term) => {
    if (term.k === "delta") {
      let s = 0;
      for (const g of term.g) {
        const a = ctx.level(g, t), b = ctx.level(g, t - term.hrs * H);
        if (a == null || b == null) return null;
        s += a - b;
      }
      return s / term.g.length;
    }
    if (term.k === "rain") return rainIn(ctx.rainFor ? ctx.rainFor(t) : ctx.rain, t + (h - term.from) * H, t + (h - term.to) * H);
    if (term.k === "level") return ctx.level(cfg.target, t);
    return null;
  });
}

export function buildSamples(cfg, ctx, times, h) {
  const out = [];
  for (const t of times) {
    const f = features(cfg, ctx, t, h);
    if (f.some((v) => v == null)) continue;
    const l0 = ctx.level(cfg.target, t), l1 = ctx.level(cfg.target, t + h * H);
    if (l0 == null || l1 == null) continue;
    out.push({ t, f, y: l1 - l0, day: dayOf(t) });
  }
  return out;
}

/** Ridge on standardised features with an unpenalised intercept. Returns raw-unit weights. */
export function fitRidge(X, y, lam = LAMBDA) {
  const n = X.length, p = X[0].length;
  const mean = Array(p).fill(0), sd = Array(p).fill(0);
  for (const x of X) x.forEach((v, j) => (mean[j] += v / n));
  for (const x of X) x.forEach((v, j) => (sd[j] += (v - mean[j]) ** 2 / n));
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const ym = y.reduce((a, b) => a + b, 0) / n;
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / sd[j]));
  const A = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p + 1 }, (_, j) =>
      j < p
        ? Z.reduce((s, z) => s + z[i] * z[j], 0) + (i === j ? lam * n : 0)
        : Z.reduce((s, z, k) => s + z[i] * (y[k] - ym), 0),
    ),
  );
  for (let c = 0; c < p; c++) {
    let m = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]];
    for (let r = 0; r < p; r++)
      if (r !== c) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
      }
  }
  const wStd = A.map((row, i) => row[p] / row[i]);
  const w = wStd.map((v, j) => v / sd[j]);
  const b0 = ym - w.reduce((s, v, j) => s + v * mean[j], 0);
  return { b0, w, mean };
}
export const predictRidge = (m, x) => m.b0 + m.w.reduce((s, v, j) => s + v * x[j], 0);

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function fitOne(cfg, S) {
  const X = S.map((s) => s.f), y = S.map((s) => s.y);
  const cols = cfg.terms.map((t, i) => (t.local ? i : -1)).filter((i) => i >= 0);
  return {
    full: fitRidge(X, y),
    local: { cols, ...fitRidge(X.map((x) => cols.map((c) => x[c])), y) },
  };
}
const predLocal = (m, x) => predictRidge(m, m.cols.map((c) => x[c]));

/**
 * Fit one station: per-horizon full model + a "local-only" model (own trend + level,
 * used as a disagreement signal), with leave-one-day-out out-of-sample residual stats.
 * Returns { horizons: {h: {...}}, oos: {h: [{t,y,pred,predLocal}]}, trainRange, trainDays }.
 */
export function fitStation(cfg, ctx, times, opts = {}) {
  const horizons = {}, oos = {};
  for (const h of HORIZONS) {
    const S = buildSamples(cfg, ctx, times, h);
    if (S.length < 60) continue;
    const days = [...new Set(S.map((s) => s.day))];
    const rows = [];
    for (const d of days) {
      const tr = S.filter((s) => s.day !== d), te = S.filter((s) => s.day === d);
      if (tr.length < 40) continue;
      const m = fitOne(cfg, tr);
      for (const s of te)
        rows.push({ t: s.t, y: s.y, pred: predictRidge(m.full, s.f), predLocal: predLocal(m.local, s.f) });
    }
    oos[h] = rows;
    const fit = fitOne(cfg, S);
    const inRes = S.map((s) => s.y - predictRidge(fit.full, s.f));
    const inRmse = Math.sqrt(mean(inRes.map((r) => r * r)));
    const useOos = rows.length >= 40;
    const maeOos = useOos ? mean(rows.map((r) => Math.abs(r.y - r.pred))) : null;
    const maePers = mean(S.map((s) => Math.abs(s.y)));
    // No out-of-sample skill over "level stays put" (seen at 24h): ship persistence for this horizon
    // rather than a model that is worse than doing nothing. Its residuals are then just the changes.
    const persistence = useOos && maeOos > 0.95 * maePers;
    const res = (persistence ? S.map((s) => s.y) : useOos ? rows.map((r) => r.y - r.pred) : inRes).sort((a, b) => a - b);
    const rmse = Math.sqrt(mean(res.map((r) => r * r)));
    horizons[h] = {
      n: S.length,
      b0: fit.full.b0, w: fit.full.w, mean: fit.full.mean,
      local: fit.local,
      // OOS (leave-one-day-out) residual stats; q10/q90 are signed (actual - predicted)
      resOos: useOos,
      persistence,
      rmse, inRmse,
      q10: quantile(res, 0.1), q50: quantile(res, 0.5), q90: quantile(res, 0.9),
      mae: maeOos,
      maePersistence: maePers,
      maeLocal: useOos ? mean(rows.map((r) => Math.abs(r.y - r.predLocal))) : null,
    };
  }
  const tAll = times.filter((t) => ctx.level(cfg.target, t) != null);
  const levels = tAll.map((t) => ctx.level(cfg.target, t));
  return {
    horizons, oos,
    trainDays: new Set(tAll.map(dayOf)).size,
    trainRange: [tAll[0], tAll[tAll.length - 1]],
    levelMin: Math.min(...levels), levelMax: Math.max(...levels),
  };
}

/**
 * Evaluate a fitted station at time t. ctx as in features(). Missing features are
 * replaced by their training mean (a neutral input) and reported in `missing` so the
 * caller can widen the band and say so. Returns [{h, delta, deltaLocal, missing[]}].
 */
export function evalStation(coef, cfg, ctx, t) {
  const out = [];
  for (const h of HORIZONS) {
    const m = coef.horizons[h];
    if (!m) continue;
    const f = features(cfg, ctx, t, h);
    const missing = [];
    const x = f.map((v, j) => {
      if (v != null) return v;
      missing.push(cfg.terms[j].label);
      return m.mean[j];
    });
    out.push({ h, delta: m.persistence ? 0 : predictRidge(m, x), deltaLocal: predLocal(m.local, x), missing, features: f, persistence: !!m.persistence });
  }
  return out;
}

// ---- distribution helpers (split-normal, mixture) -------------------------------

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 style rational approximation). */
export function Phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const p = 0.3989423 * Math.exp((-z * z) / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
/** CDF of a split normal: mode mu, scale sd on the low side, su on the high side. */
export function splitCdf(x, mu, sd, su) {
  const k = sd + su;
  return x <= mu ? ((2 * sd) / k) * Phi((x - mu) / sd) : 1 - ((2 * su) / k) * (1 - Phi((x - mu) / su));
}
/** components: [{w, mu, sd, su}] with weights summing to 1. */
export const mixCdf = (x, comps) => comps.reduce((s, c) => s + c.w * splitCdf(x, c.mu, c.sd, c.su), 0);
export function mixQuantile(q, comps) {
  let lo = Math.min(...comps.map((c) => c.mu - 8 * c.sd)), hi = Math.max(...comps.map((c) => c.mu + 8 * c.su));
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (mixCdf(m, comps) < q) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
/** Minimum 1-sigma spread in METRES at horizon h (grows with horizon). */
export const floorSigmaM = (h) => 0.05 + 0.02 * h;
