// predict.mjs: the lvl-lin-d4 river-level model in JavaScript (hidden trial, never shown to a visitor). Pure ES module: no imports, no file or network access, no
// Node-only API, no clock, no state between calls except a WeakMap of per-model lookup tables. Runs in Node 22 and in a serverless function. Line-for-line port of the
// lab's linmodel.py (raw_frame, base_columns, up_columns, regime_of, predict_arrays) and of the lab features it reads (features.py, store.py as-of rules).
// Inputs, checks, verdicts and reason codes: DOCS.md "Level-model hidden trial". Model file: lib/model/lvl-lin-d4.json.
//
//   import { predict } from "./predict.mjs";
//   const out = predict(model, { gauge: "Hanwella", t, own: {ts, v, bad}, partners: {Glencourse: {ts, v, bad}}, rain: {...}, unitRefFt });
//   out.verdict -> "ok" | "degraded" | "refused";  out.hz -> [[h, level, low, high], ...] in the gauge's NATIVE unit (null when refused);  out.diag -> what was missing.
//
// predict() NEVER throws and NEVER returns a number for a refused call. The arithmetic of a valid input is unchanged from v1 (same operations in the same order): the
// hardening is entirely in front of it (clean on entry, validate, guard) and behind it (diagnostics, verdict).

export const HOUR = 3600000;
export const VERSION = "lvl-lin-d4/predict@2.1";
export const MODEL_SCHEMA = "slwl-port/lvl-lin-d4@2";
export const MAX_AGE_MS = 10 * 60000; // t must be the newest reading's time, at most this much later (see DOCS.md)
export const UNIT_HEADROOM = 0.1; // unit guard: bounds = [min - 0.1 x range, max + 0.1 x range] of the training levels in feet (DOCS.md)
export const UNIT_REF_REL = 0.02; // optional cross-check against an independent level in feet: |diff| <= 2% + 0.03 ft (the same reading, converted and displayed rounded)
export const UNIT_REF_ABS_FT = 0.03;
export const RAIN_MAX_MM_H = 400; // a rain value outside [0, 400] mm in one hour is not a rain value: it is treated as missing
export const MEAN_CELLS_ABS_MM = 0.05; // obs.mean / fc.mean is the mean of the cells (lab: to 1.7e-6 mm over 661,128 hours); more than 0.05 mm + 2% apart = the arrays do not belong together
export const MEAN_CELLS_REL = 0.02;
const FT_PER_M = 1 / 0.3048;
const SL_OFFSET_MS = 19800000; // Sri Lanka = UTC + 5:30
const OWN_H = [1, 2, 3, 6, 12, 24];
const HZ = [1, 3, 6, 12, 24];
const FAST_HZ = [1, 3, 6];
const MAXLAG_ITER = 200; // the lab's store.py asof_index walks back over dropped readings at most 200 times
const WIN_CAP_MEAN = 400; // the lab's features.py _window_mean_clean: at most the newest 400 readings of the window
const WIN_CAP_EXT = 500; // linmodel.py _window_extreme: at most the newest 500
const EPS_FT = (0.006 * 3) / 0.3048; // the "Rising / Falling" 3 h threshold in feet (linmodel.EPS_FT)
const STORM_GATE_MM = 50.0;
const TIDES = { M2: 12.4206012, S2: 12.0, N2: 12.65834751, K1: 23.9344697, O1: 25.8193417 }; // periods in hours (the lab's features.py)
const T_MIN = 946684800000; // 2000-01-01: an issue time outside [2000, 2100) is not epoch milliseconds
const T_MAX = 4102444800000;

/**
 * Which missing rain windows matter, and how much (measured on 2,784 lab forecast times, one damage at a time: refuse when the 90th percentile of the change of the
 * 24 h level caused by the missing window is >= 0.5 ft = 0.8 x the median 80% half-width; rain damages judged on all cases and on the wet subset).
 *   cols  : the model columns the window feeds. A window is RELEVANT for a gauge when one of them is among the gauge's model columns (`model.g[gauge].cols`).
 *           A window no column of this gauge reads is not an input problem, it is by design (a gauge without up-zone cells has no ro_up_* columns).
 *   storm : the window also decides the storm flag (range cell), so it is relevant for every gauge.
 *   sev   : "refuse" = a missing window makes the forecast unusable; "degrade" = forecast returned, flagged.
 */
export const RAIN_WINDOWS = [
  { id: "obs1", part: "obs", cols: ["ro_f1", "ro_f2"], storm: false, sev: "refuse" },
  { id: "obs3", part: "obs", cols: ["ro_f2", "ro_f3"], storm: false, sev: "refuse" },
  { id: "obs6", part: "obs", cols: ["ro_f3", "ro_f4"], storm: false, sev: "refuse" },
  { id: "obs12", part: "obs", cols: ["ro_f4", "ro_f5"], storm: false, sev: "degrade" },
  { id: "obs24", part: "obs", cols: ["ro_f5", "ro_f6"], storm: true, sev: "degrade" },
  { id: "obs72", part: "obs", cols: ["ro_f6"], storm: false, sev: "degrade" },
  { id: "up6", part: "up", cols: ["ro_up_a", "ro_up_b"], storm: false, sev: "degrade" },
  { id: "up24", part: "up", cols: ["ro_up_b"], storm: false, sev: "degrade" },
  { id: "obsCells24", part: "obs", cols: ["ro_mx"], storm: false, sev: "degrade" },
  { id: "fc3", part: "fc", cols: ["rf_f1", "rf_f2"], storm: false, sev: "refuse" },
  { id: "fc6", part: "fc", cols: ["rf_f2", "rf_f3"], storm: false, sev: "refuse" },
  { id: "fc12", part: "fc", cols: ["rf_f3", "rf_f4"], storm: false, sev: "refuse" },
  { id: "fc24", part: "fc", cols: ["rf_f4"], storm: true, sev: "refuse" },
  { id: "fcCells24", part: "fc", cols: ["rf_mx"], storm: false, sev: "degrade" },
];
/** Own-reading lags (hours) the model reads. If none of these short lags can be read, the model has no trend information at all: refused. */
export const OWN_TREND_LAGS = [1, 2, 3, 6];

// ------------------------------------------------------------------------------------------------ refusals
class Refusal extends Error {
  constructor(code, detail, diag) {
    super(code + ": " + detail);
    this.code = code;
    this.detail = detail;
    this.diag = diag || null;
  }
}
const refuse = (code, detail, diag) => {
  throw new Refusal(code, detail, diag);
};
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isArr = (x) => Array.isArray(x) || ArrayBuffer.isView(x);

// ------------------------------------------------------------------------------------------------ small helpers (unchanged arithmetic)
const z = (x) => (Number.isFinite(x) ? x : 0); // linmodel._z: NaN, +-Infinity -> 0 ("no information")

/** index of the last element of ascending `ts` that is <= q, -1 if none (numpy searchsorted(ts, q, "right") - 1). */
function lastLE(ts, q) {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ts[mid] <= q) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** a reading is dropped for issue time t iff the glitch filter had flagged it by t (bad[i] <= t); the newest reading is never dropped. bad = null: nothing flagged. */
function isBad(ser, i, t) {
  const b = ser.bad;
  if (b === null || b === undefined) return false;
  const x = b[i];
  return x !== null && x !== undefined && x <= t;
}

/** the lab's store.py asof_index: last reading with ts <= q not dropped by the causal glitch filter as of issue time t. -1 = none. */
function asofIndex(ser, q, t) {
  if (!ser || !ser.ts || ser.ts.length === 0) return -1;
  let i = lastLE(ser.ts, q);
  const newest = lastLE(ser.ts, t);
  for (let it = 0; it < MAXLAG_ITER; it++) {
    if (i >= 0 && i !== newest && isBad(ser, i, t)) i -= 1;
    else break;
  }
  return i;
}

/** the lab's store.py level_asof: the clean reading at or before t - lagH, NaN when none or older than maxStaleH before that instant. */
function levelAsof(ser, t, lagH, maxStaleH) {
  const q = t - Math.round(lagH * HOUR);
  const i = asofIndex(ser, q, t);
  if (i < 0) return NaN;
  if (q - ser.ts[i] > Math.round(maxStaleH * HOUR)) return NaN;
  return ser.v[i];
}

/** the lab's features.py _window_mean_clean: mean of the clean readings in (t - w, t]; the newest reading is never dropped. */
function windowMeanClean(ser, t, wH) {
  if (!ser || !ser.ts) return NaN;
  const hi = lastLE(ser.ts, t);
  const lo = lastLE(ser.ts, t - Math.trunc(wH * HOUR)) + 1;
  const cnt = Math.max(hi - lo + 1, 0);
  const W = Math.min(cnt, WIN_CAP_MEAN);
  let s = 0.0;
  let c = 0;
  for (let j = 0; j < W; j++) {
    const idx = hi - j;
    if (idx !== hi && isBad(ser, idx, t)) continue;
    s += ser.v[idx];
    c += 1;
  }
  return c > 0 ? s / c : NaN;
}

/** linmodel._window_extreme: max or min of the clean readings in (t - w, t]. */
function windowExtreme(ser, t, wH, op) {
  if (!ser || !ser.ts) return NaN;
  const hi = lastLE(ser.ts, t);
  const lo = lastLE(ser.ts, t - Math.trunc(wH * HOUR)) + 1;
  const cnt = Math.max(hi - lo + 1, 0);
  const W = Math.min(cnt, WIN_CAP_EXT);
  let r = op === "max" ? -Infinity : Infinity;
  for (let j = 0; j < W; j++) {
    const idx = hi - j;
    if (idx !== hi && isBad(ser, idx, t)) continue;
    const v = ser.v[idx];
    if (op === "max") {
      if (v > r || v !== v) r = v;
    } else if (v < r || v !== v) r = v;
  }
  return Number.isFinite(r) ? r : NaN;
}

// rain windows: arrays on an hour-END grid, element i = hour ending origin + i h. NaN or out of range anywhere in a window -> NaN (the lab's util.py wsum).
function wsum(arr, lo, hi) {
  if (!arr || lo < 0 || hi >= arr.length || hi < lo) return NaN;
  let s = 0.0;
  for (let i = lo; i <= hi; i++) {
    const x = arr[i];
    if (!Number.isFinite(x)) return NaN;
    s += x;
  }
  return s;
}

/** the lab's features.py _wmax_cells: the largest window total over the zone's cells; NaN if any cell has a missing value in the window. */
function wmaxCells(cells, lo, hi) {
  if (!cells || cells.length === 0) return NaN;
  const n = cells[0].length;
  if (lo < 0 || hi >= n || hi < lo) return NaN;
  let mx = -Infinity;
  for (let c = 0; c < cells.length; c++) {
    const tot = wsum(cells[c], lo, hi);
    if (tot !== tot) return NaN;
    if (tot > mx) mx = tot;
  }
  return mx;
}

/** indices of the cells whose window has a missing hour (diagnostics only). */
function cellsMissingIdx(cells, lo, hi) {
  const out = [];
  if (!cells) return out;
  for (let c = 0; c < cells.length; c++) if (Number.isNaN(wsum(cells[c], lo, hi))) out.push(c);
  return out;
}

// ------------------------------------------------------------------------------------------------ cleaning the caller's input on entry
/**
 * One readings series -> a clean copy {ts, v, bad} plus counts. Rules:
 *  - ts, v (and bad when given) are arrays of equal length; a timestamp is a finite number;
 *  - a value that is null, undefined, NaN or +-Infinity is MISSING: the reading is left out (the lab store drops null-level rows the same way when it is built); a value that
 *    is anything else than a number (a string, boolean, object) REFUSES the call;
 *  - ts must be non-decreasing; a descending pair REFUSES the call;
 *  - equal timestamps: the FIRST reading is kept, later ones with the same timestamp are dropped (the lab store de-duplicates exact timestamps keeping the first);
 *  - bad[i] is null / undefined (never flagged) or a finite number (ms); anything else REFUSES the call.
 * Never mutates its input.
 */
function cleanSeries(raw, label) {
  if (!raw || typeof raw !== "object" || !isArr(raw.ts) || !isArr(raw.v)) refuse("series_shape", label + ": needs {ts: [], v: []} arrays");
  const n = raw.ts.length;
  if (raw.v.length !== n) refuse("series_length_mismatch", label + ": ts has " + n + " entries, v has " + raw.v.length);
  const hasBad = raw.bad !== null && raw.bad !== undefined;
  if (hasBad) {
    if (!isArr(raw.bad)) refuse("series_shape", label + ": bad must be an array or null");
    if (raw.bad.length !== n) refuse("series_length_mismatch", label + ": ts has " + n + " entries, bad has " + raw.bad.length);
  }
  const ts = [];
  const v = [];
  const bad = hasBad ? [] : null;
  let missing = 0;
  let dup = 0;
  let prev = -Infinity; // previous raw timestamp (rows with a missing value count for the order check)
  let lastKept = NaN;
  for (let i = 0; i < n; i++) {
    const a = raw.ts[i];
    if (!isNum(a)) refuse("bad_timestamp", label + ": ts[" + i + "] is not a finite number");
    if (a < prev) refuse("timestamps_not_sorted", label + ": ts[" + i + "] is earlier than ts[" + (i - 1) + "]");
    prev = a;
    const x = raw.v[i];
    if (x !== null && x !== undefined && typeof x !== "number") refuse("non_numeric_value", label + ": v[" + i + "] is a " + typeof x + ", not a number");
    let b = null;
    if (hasBad) {
      const y = raw.bad[i];
      if (y !== null && y !== undefined) {
        if (!isNum(y)) refuse("bad_flag_invalid", label + ": bad[" + i + "] is not null or a finite number");
        b = y;
      }
    }
    if (typeof x !== "number" || !Number.isFinite(x)) {
      missing++;
      continue;
    }
    if (a === lastKept) {
      dup++;
      continue;
    }
    ts.push(a);
    v.push(x);
    if (bad) bad.push(b);
    lastKept = a;
  }
  return { ser: { ts, v, bad }, info: { rows: n, kept: ts.length, valuesMissing: missing, dupDropped: dup } };
}

/** a rain array -> Float64Array with NaN for a missing value; null / undefined -> null (absent). A string refuses the call. */
function cleanRainArr(x, label, counters) {
  if (x === null || x === undefined) return null;
  if (!isArr(x)) refuse("rain_shape", label + " must be an array");
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = x[i];
    if (a === null || a === undefined) {
      out[i] = NaN;
      counters.missing++;
      continue;
    }
    if (typeof a !== "number") refuse("non_numeric_rain_value", label + "[" + i + "] is a " + typeof a + ", not a number");
    if (!Number.isFinite(a)) {
      out[i] = NaN;
      counters.missing++;
    } else if (a < 0 || a > RAIN_MAX_MM_H) {
      out[i] = NaN;
      counters.outOfRange++;
    } else out[i] = a;
  }
  return out;
}

function cleanRainCells(x, label, counters) {
  if (x === null || x === undefined) return [];
  if (!isArr(x)) refuse("rain_shape", label + " must be an array of arrays");
  const out = [];
  for (let c = 0; c < x.length; c++) out.push(cleanRainArr(x[c], label + "[" + c + "]", counters) || new Float64Array(0));
  return out;
}

/** the `rain` input -> clean copy or null (= not supplied). Checks the shape: origin a whole hour, equal lengths everywhere, cell counts as the model's gauge. */
function cleanRain(rain, gm) {
  const info = { provided: false, origin: null, hours: 0, valuesMissing: 0, valuesOutOfRange: 0, obsCells: 0, fcCells: 0 };
  if (rain === null || rain === undefined) return { R: null, info };
  if (typeof rain !== "object") refuse("rain_shape", "rain must be an object");
  info.provided = true;
  const counters = { missing: 0, outOfRange: 0 };
  const o = rain.obs;
  const f = rain.fc;
  if ((o !== null && o !== undefined && typeof o !== "object") || (f !== null && f !== undefined && typeof f !== "object")) refuse("rain_shape", "rain.obs and rain.fc must be objects");
  const R = {
    obsMean: cleanRainArr(o && o.mean, "rain.obs.mean", counters),
    obsUp: cleanRainArr(o && o.up, "rain.obs.up", counters),
    obsCells: cleanRainCells(o && o.cells, "rain.obs.cells", counters),
    fcMean: cleanRainArr(f && f.mean, "rain.fc.mean", counters),
    fcCells: cleanRainCells(f && f.cells, "rain.fc.cells", counters),
    origin: rain.origin,
    n: 0,
  };
  const lens = [];
  for (const a of [R.obsMean, R.obsUp, R.fcMean]) if (a) lens.push(a.length);
  for (const a of R.obsCells) lens.push(a.length);
  for (const a of R.fcCells) lens.push(a.length);
  if (lens.length > 0) {
    R.n = lens[0];
    if (lens.some((l) => l !== R.n)) refuse("rain_shape", "rain arrays (mean, up, cells, observed and forecast) must all have the same length");
    if (!isNum(R.origin) || !Number.isInteger(R.origin)) refuse("bad_rain_origin", "rain.origin must be an integer epoch ms");
    if (((R.origin % HOUR) + HOUR) % HOUR !== 0) refuse("rain_origin_not_whole_hour", "rain.origin must be a whole hour (epoch ms of the END of element 0)");
  }
  if (gm && gm.rain && Number.isInteger(gm.rain.cells)) {
    if (R.obsCells.length > 0 && R.obsCells.length !== gm.rain.cells) refuse("rain_cell_count", "observed rain has " + R.obsCells.length + " cells, this gauge's catchment has " + gm.rain.cells);
    if (R.fcCells.length > 0 && R.fcCells.length !== gm.rain.cells) refuse("rain_cell_count", "forecast rain has " + R.fcCells.length + " cells, this gauge's catchment has " + gm.rain.cells);
  }
  // the catchment mean is the mean of the zone's cells: an array that was zero-filled, scaled or taken from another hour range breaks that (hours with any missing value are skipped)
  for (const [mean, cells, nm] of [[R.obsMean, R.obsCells, "obs"], [R.fcMean, R.fcCells, "fc"]]) {
    if (!mean || cells.length === 0) continue;
    let bad = -1;
    let nbad = 0;
    for (let i = 0; i < mean.length; i++) {
      if (!Number.isFinite(mean[i])) continue;
      let s = 0;
      let ok = true;
      for (let c = 0; c < cells.length; c++) {
        const x = cells[c][i];
        if (!Number.isFinite(x)) {
          ok = false;
          break;
        }
        s += x;
      }
      if (!ok) continue;
      const avg = s / cells.length;
      if (Math.abs(mean[i] - avg) > MEAN_CELLS_ABS_MM + MEAN_CELLS_REL * Math.max(Math.abs(mean[i]), Math.abs(avg))) {
        nbad++;
        if (bad < 0) bad = i;
      }
    }
    if (nbad > 0) refuse("rain_inconsistent", nm + ".mean is not the mean of " + nm + ".cells in " + nbad + " hour(s), first at element " + bad);
  }
  info.origin = R.origin;
  info.hours = R.n;
  info.valuesMissing = counters.missing;
  info.valuesOutOfRange = counters.outOfRange;
  info.obsCells = R.obsCells.length;
  info.fcCells = R.fcCells.length;
  return { R, info };
}

// ------------------------------------------------------------------------------------------------ model preparation
const PREP = new WeakMap();

function deepFreeze(o) {
  const stack = [o];
  while (stack.length) {
    const x = stack.pop();
    if (x === null || typeof x !== "object" || Object.isFrozen(x)) continue;
    Object.freeze(x);
    for (const k of Object.keys(x)) stack.push(x[k]);
  }
  return o;
}

/** One-time lookup tables per model object (cached). Freezes the model (it is read-only from the first use: the tables are built from it once). Throws on a model this runtime does not understand. */
export function prepare(model) {
  let p = PREP.get(model);
  if (p) return p;
  if (!model || model.schema !== MODEL_SCHEMA) throw new Error("unknown model schema " + (model && model.schema) + " (this runtime reads " + MODEL_SCHEMA + ")");
  const cfg = model.cfg;
  if (!(cfg.asym && cfg.tide && cfg.time && cfg.rain && cfg.fc && cfg.up && cfg.up_stage && cfg.up_routed && cfg.fine && cfg.ext && cfg.rate_prev && cfg.regime_sets)) {
    throw new Error("model cfg is not the lvl-lin-d4 set this runtime implements");
  }
  p = { cfg, g: {} };
  for (const s of Object.keys(model.g)) {
    const gm = model.g[s];
    const r = gm.range_ft;
    if (!r || !["min", "max", "p50"].every((k) => Number.isFinite(r[k])) || !gm.rain || !Number.isInteger(gm.rain.cells)) throw new Error("model gauge " + s + " lacks range_ft / rain (re-export with export.py v2)");
    for (const u of gm.ups) if (!u.range_ft || !Number.isFinite(u.range_ft.min) || !Number.isFinite(u.range_ft.max)) throw new Error("model partner " + u.u + " of " + s + " lacks range_ft");
    const hs = {};
    for (const hk of Object.keys(gm.h)) {
      const m = gm.h[hk];
      const names = (idx) => idx.map((i) => gm.cols[i]);
      const set = (a) => ({ names: names(a.i), b: a.b, b0: a.b0 });
      hs[hk] = {
        main: set(m.main),
        regs: m.regs ? m.regs.map(set) : null,
        shift: m.shift || null,
        sc: { names: names(m.sc.i), b: m.sc.b, b0: m.sc.b0, floor: m.sc.floor, cap: m.sc.cap },
        rq: m.rq,
        clip: m.clip ? m.clip.map((c, i) => (c ? [gm.cols[i], c[0], c[1]] : null)).filter(Boolean) : null,
      };
    }
    // which rain windows matter for this gauge (a window is relevant when a model column it feeds exists, or it decides the storm flag)
    const colset = new Set(gm.cols);
    const rel = {};
    for (const w of RAIN_WINDOWS) rel[w.id] = w.storm || w.cols.some((c) => colset.has(c));
    p.g[s] = { hs, hList: gm.fast ? FAST_HZ : HZ, rel };
  }
  deepFreeze(model);
  PREP.set(model, p);
  return p;
}

// ------------------------------------------------------------------------------------------------ features
function tideTerms(t, c) {
  for (const nm of Object.keys(TIDES)) {
    const ph = (2 * Math.PI * (t / HOUR)) / TIDES[nm];
    c["tide_" + nm + "_sin"] = Math.sin(ph);
    c["tide_" + nm + "_cos"] = Math.cos(ph);
  }
}

/** every h-independent column of linmodel.base_columns, plus what regime_of and the storm cell need. Also returns the raw rain window values and the own lags (for diagnostics). */
function baseColumns(gm, t, own, R) {
  const k = gm.k;
  const c = {};
  const cur = (() => {
    const i = asofIndex(own, t, t);
    return i >= 0 ? own.v[i] : NaN;
  })();
  const lv = {};
  const d = {};
  for (const h of OWN_H) {
    lv[h] = levelAsof(own, t, h, Math.max(1.5, 0.25 * h));
    d[h] = z(cur - lv[h]) * k;
    c["d" + h] = d[h];
  }
  c.dev12 = z(cur - windowMeanClean(own, t, 12)) * k;
  c.accel3 = z(cur - 2.0 * lv[3] + lv[6]) * k;
  c.d1p = Math.max(d[1], 0.0);
  c.d1n = Math.min(d[1], 0.0);
  c.d3p = Math.max(d[3], 0.0);
  c.d3n = Math.min(d[3], 0.0);
  c.lvl = z(cur * k) - gm.med_ft;
  const zcur = z(cur);
  for (const w of [24, 72]) {
    c["pk" + w] = z(zcur - windowExtreme(own, t, w, "max")) * k;
    c["tr" + w] = z(zcur - windowExtreme(own, t, w, "min")) * k;
  }
  // rate over the last reporting gap: the clean reading before the newest one
  const ip = asofIndex(own, t - 1, t);
  const vprev = ip >= 0 ? own.v[ip] : NaN;
  const gap = ip >= 0 ? (t - own.ts[ip]) / HOUR : NaN;
  const gapc = Math.max(gap, 0.25); // NaN stays NaN (np.maximum)
  const rp = z((cur - vprev) / gapc) * k;
  c.rprev = Math.min(Math.max(rp, -3.0 * gm.scale), 3.0 * gm.scale);
  if (gm.tidal) tideTerms(t, c);
  const hod = ((t + SL_OFFSET_MS) % (24 * HOUR)) / HOUR;
  c.hod_sin = Math.sin((2 * Math.PI * hod) / 24.0);
  c.hod_cos = Math.cos((2 * Math.PI * hod) / 24.0);
  // rain
  let storm = 0;
  let i0 = NaN;
  const ro = {};
  const rf = {};
  let roMax24 = NaN;
  let rfMax24 = NaN;
  let rUp6 = NaN;
  let rUp24 = NaN;
  const rainMissing = {}; // window id -> true when it is NaN (or no rain input)
  if (R && R.obsMean && R.fcMean) {
    const fl = Math.floor(t / HOUR) * HOUR; // floor_hour(t)
    const origin = R.origin;
    i0 = (fl - origin) / HOUR;
    for (const w of [1, 3, 6, 12, 24, 72]) ro[w] = wsum(R.obsMean, i0 - w + 1, i0);
    rUp6 = wsum(R.obsUp, i0 - 6 + 1, i0);
    rUp24 = wsum(R.obsUp, i0 - 24 + 1, i0);
    roMax24 = wmaxCells(R.obsCells, i0 - 24 + 1, i0);
    for (const h of [3, 6, 12, 24]) rf[h] = wsum(R.fcMean, i0 + 1, i0 + h);
    rfMax24 = wmaxCells(R.fcCells, i0 + 1, i0 + 24);
    const past = wsum(R.obsMean, i0 - 23, i0);
    const nxt = wsum(R.fcMean, i0 + 1, i0 + 24);
    storm = (z(past) >= STORM_GATE_MM) || (z(nxt) >= STORM_GATE_MM) ? 1 : 0;
  }
  rainMissing.obs1 = !Number.isFinite(ro[1]);
  rainMissing.obs3 = !Number.isFinite(ro[3]);
  rainMissing.obs6 = !Number.isFinite(ro[6]);
  rainMissing.obs12 = !Number.isFinite(ro[12]);
  rainMissing.obs24 = !Number.isFinite(ro[24]);
  rainMissing.obs72 = !Number.isFinite(ro[72]);
  rainMissing.up6 = !Number.isFinite(rUp6);
  rainMissing.up24 = !Number.isFinite(rUp24);
  rainMissing.obsCells24 = !Number.isFinite(roMax24);
  rainMissing.fc3 = !Number.isFinite(rf[3]);
  rainMissing.fc6 = !Number.isFinite(rf[6]);
  rainMissing.fc12 = !Number.isFinite(rf[12]);
  rainMissing.fc24 = !Number.isFinite(rf[24]);
  rainMissing.fcCells24 = !Number.isFinite(rfMax24);
  const r1 = z(ro[1]);
  const r3 = z(ro[3]);
  const r6 = z(ro[6]);
  const r12 = z(ro[12]);
  const r24 = z(ro[24]);
  const r72 = z(ro[72]);
  c.ro_f1 = Math.max(r1, 0.0);
  c.ro_f2 = Math.max(r3 - r1, 0.0);
  c.ro_f3 = Math.max(r6 - r3, 0.0);
  c.ro_f4 = Math.max(r12 - r6, 0.0);
  c.ro_f5 = Math.max(r24 - r12, 0.0);
  c.ro_f6 = Math.max(r72 - r24, 0.0);
  c.ro_mx = z(roMax24);
  const u6 = z(rUp6);
  const u24 = z(rUp24);
  c.ro_up_a = u6;
  c.ro_up_b = Math.max(u24 - u6, 0.0);
  const f3 = z(rf[3]);
  const f6 = z(rf[6]);
  const f12 = z(rf[12]);
  const f24 = z(rf[24]);
  c.rf_f1 = Math.max(f3, 0.0);
  c.rf_f2 = Math.max(f6 - f3, 0.0);
  c.rf_f3 = Math.max(f12 - f6, 0.0);
  c.rf_f4 = Math.max(f24 - f12, 0.0);
  c.rf_mx = z(rfMax24);
  const d3 = d[3];
  const reg = d3 > EPS_FT ? 2 : d3 < -EPS_FT ? 0 : 1;
  return { c, cur, reg, cell: reg * 2 + storm, lv, i0, rainMissing };
}

/** linmodel.up_columns for horizon h. */
function upColumns(gm, partners, t, h, c, up) {
  for (let j = 0; j < gm.ups.length; j++) {
    const p = gm.ups[j];
    const U = up[j];
    const tau = p.tau;
    const Lh = Math.max(tau - h, 0);
    const a = U.get(Lh);
    const b = U.get(tau);
    const n = j + 1;
    c["u" + n + "_R"] = z(a - b);
    c["u" + n + "_S"] = z(a - p.med);
    const u0 = U.get(0);
    c["u" + n + "_d1"] = z(u0 - U.get(1));
    c["u" + n + "_d3"] = z(u0 - U.get(3));
    c["u" + n + "_d6"] = z(u0 - U.get(6));
  }
}

/** lag -> level in FEET of one partner at t - lag, memoised per call (linmodel.lag_levels: stale tolerance max(2 h, lag / 4)). Records the lags that came back NaN. */
function partnerLevels(ser, k, t) {
  const memo = new Map();
  const missing = new Set();
  return {
    missing,
    get(L) {
      let v = memo.get(L);
      if (v === undefined) {
        v = levelAsof(ser, t, L, Math.max(2.0, 0.25 * L)) * k;
        memo.set(L, v);
        if (Number.isNaN(v)) missing.add(L);
      }
      return v;
    },
  };
}

function lin(c, names, beta, b0) {
  let y = b0;
  for (let j = 0; j < names.length; j++) y = y + c[names[j]] * beta[j];
  return y;
}

function linAbs(c, names, beta, b0) {
  let y = b0;
  for (let j = 0; j < names.length; j++) y = y + Math.abs(c[names[j]]) * beta[j];
  return y;
}

// ------------------------------------------------------------------------------------------------ history range guard
/**
 * Drop every reading of a cleaned series whose level in feet is outside [min - UNIT_HEADROOM x span, max + UNIT_HEADROOM x span] of the gauge's training range. `ignoreAfter`: a
 * partner's readings later than t are never read, so they are neither dropped nor counted. Returns the series untouched (same object) when nothing is out of range.
 */
function dropOutOfRange(ser, k, r, t, ignoreAfter) {
  const span = r.max - r.min;
  const lo = r.min - UNIT_HEADROOM * span;
  const hi = r.max + UNIT_HEADROOM * span;
  const keep = [];
  const outTs = [];
  for (let i = 0; i < ser.ts.length; i++) {
    const ft = ser.v[i] * k;
    if ((ft < lo || ft > hi) && !(ignoreAfter && ser.ts[i] > t)) outTs.push(ser.ts[i]);
    else keep.push(i);
  }
  if (outTs.length === 0) return { ser, dropped: 0, ts: [] };
  return {
    ser: { ts: keep.map((i) => ser.ts[i]), v: keep.map((i) => ser.v[i]), bad: ser.bad ? keep.map((i) => ser.bad[i]) : null },
    dropped: outTs.length,
    ts: outTs.slice(0, 20),
  };
}

/** true when at least 6 readings lie in (t - wH, t] and they are all exactly equal: a stuck or dead sensor. Information only (it does not change the verdict): calm rivers repeat a value at the sensor's resolution. */
function flatSeries(ser, t, wH) {
  const hi = lastLE(ser.ts, t);
  const lo = lastLE(ser.ts, t - wH * HOUR) + 1;
  if (hi - lo + 1 < 6) return false;
  for (let i = lo + 1; i <= hi; i++) if (ser.v[i] !== ser.v[lo]) return false;
  return true;
}

// ------------------------------------------------------------------------------------------------ the unit guard
/** level in feet vs the training range of the gauge (min .. max of the level at every forecast time of B1-B8, in feet), widened by UNIT_HEADROOM x range on both sides. */
function unitCheck(curFt, r) {
  const span = r.max - r.min;
  const lo = r.min - UNIT_HEADROOM * span;
  const hi = r.max + UNIT_HEADROOM * span;
  const ratio = Math.abs(r.p50) > 0.05 ? curFt / r.p50 : null; // vs the typical level (hint for the likely mistake)
  let hint = null;
  if (ratio !== null) {
    if (Math.abs(ratio / FT_PER_M - 1) < 0.2) hint = "level is about 3.28 times the gauge's typical level: feet passed as metres?";
    else if (Math.abs(ratio * FT_PER_M - 1) < 0.2) hint = "level is about 0.30 times the gauge's typical level: metres passed as feet?";
  }
  return { curFt, minFt: r.min, maxFt: r.max, p50Ft: r.p50, boundLoFt: lo, boundHiFt: hi, ratioToMedian: ratio, ratioToMax: r.max !== 0 ? curFt / r.max : null, hint, inRange: curFt >= lo && curFt <= hi };
}

// ------------------------------------------------------------------------------------------------ predict
/**
 * One forecast. `model` = parsed model JSON (frozen on first use). `inp`:
 *   gauge      station name
 *   t          issue time, epoch ms (UTC), an integer number. = the time of the gauge's newest reading (at most MAX_AGE_MS later).
 *   own        {ts: [epoch ms ascending], v: [level in the gauge's NATIVE unit = model.g[gauge].unit], bad: [ms or null] (optional)}
 *   partners   {name: {ts, v, bad}} for the gauge's upstream partners (model.g[gauge].ups[].u); a missing partner = no readings (the forecast is then "degraded")
 *   rain       {origin, obs: {mean, up, cells}, fc: {mean, cells}} on one hour-END grid; origin = epoch ms of the END of element 0 (whole hour); null / NaN = missing.
 *              Not supplied -> refused ("rain_missing").
 *   unitRefFt  optional: the same gauge's current level in FEET from an independent source (the site's own displayed level). When given it must agree with the newest reading
 *              converted to feet (2% + 0.03 ft), else refused. Without it the forecast is "degraded" (unit_not_cross_checked): the range guard alone cannot see a wrong
 *              unit at a typical level.
 * There is no options argument: no test or audit switch exists in the shipped function (a refused call never carries a number).
 * A reading of the gauge's own history or of a partner that is outside that gauge's training range in feet (the same bounds as the unit guard) counts as MISSING and is flagged
 * (degraded `history_out_of_range`): the unit guard on the newest reading alone cannot see a sentinel or a feet-for-metres value in the middle of the history.
 *
 * Returns, always an object (never throws):
 *   { verdict: "ok" | "degraded" | "refused", reason: null | code, detail, degraded: [{code, items}], refusals: [{code, items}], gauge, t, unit, ageMs, ageH,
 *     c, complete, hz: [[h, level, low, high], ...] native unit | null, hzFt: [[h, change, lowChange, highChange]] feet from now | null, regime, cell, diag }
 * A refused result has hz = hzFt = c = null. Every code is listed in DOCS.md.
 */
export function predict(model, inp) {
  let partial = null;
  try {
    return run(model, inp, (d) => {
      partial = d;
    });
  } catch (e) {
    if (e instanceof Refusal) return refused(inp, e.code, e.detail, Object.assign({}, partial, e.diag || {}));
    return refused(inp, "internal_error", String(e && e.message ? e.message : e), partial || {});
  }
}

function refused(inp, code, detail, diag) {
  const safe = (x) => (typeof x === "string" ? x : null);
  return {
    verdict: "refused",
    reason: code,
    detail,
    degraded: [],
    refusals: [{ code, items: [detail] }],
    gauge: inp && safe(inp.gauge),
    t: inp && isNum(inp.t) ? inp.t : null,
    unit: null,
    ageMs: diag && diag.ageMs !== undefined ? diag.ageMs : null,
    ageH: diag && diag.ageMs !== undefined && diag.ageMs !== null ? diag.ageMs / HOUR : null,
    c: null,
    complete: false,
    hz: null,
    hzFt: null,
    regime: null,
    cell: null,
    diag: diag || {},
  };
}

function run(model, inp, setPartial) {
  if (!inp || typeof inp !== "object" || Array.isArray(inp)) refuse("bad_input", "inp must be an object");
  let P;
  try {
    P = prepare(model);
  } catch (e) {
    refuse("model_invalid", String(e && e.message ? e.message : e));
  }
  if (typeof inp.gauge !== "string") refuse("unknown_gauge", "gauge must be a station name (string)");
  const gm = Object.prototype.hasOwnProperty.call(model.g, inp.gauge) ? model.g[inp.gauge] : null;
  const pg = gm ? P.g[inp.gauge] : null;
  if (!gm || !pg) refuse("unknown_gauge", "gauge " + inp.gauge + " is not in the model");
  const t = inp.t;
  if (typeof t !== "number" || !Number.isFinite(t) || !Number.isInteger(t) || t < T_MIN || t >= T_MAX) refuse("bad_t", "t must be an integer number of epoch milliseconds (typeof " + typeof t + ")");
  const maxAge = MAX_AGE_MS;
  const diag = { version: VERSION, series: { own: null, partners: {} }, unit: null, rain: null, ownLagsMissing: [], partnersMissing: [], partnersStale: [], partnerLagsMissing: {}, missingInputs: 0 };
  setPartial(diag);

  // 1. own series: clean, validate, newest reading and its age
  const oc = cleanSeries(inp.own, "own");
  let own = oc.ser;
  diag.series.own = oc.info;
  if (own.ts.length === 0) refuse("no_reading", "own series has no usable reading");
  const newest = own.ts[own.ts.length - 1];
  const ageMs = t - newest;
  diag.ageMs = ageMs;
  diag.series.own.newestTs = newest;
  if (ageMs < 0) refuse("reading_after_issue_time", "own series holds a reading " + -ageMs + " ms after t");
  if (ageMs > maxAge) refuse("stale_newest_reading", "the newest reading is " + (ageMs / HOUR).toFixed(2) + " h older than t (limit " + (maxAge / 60000).toFixed(0) + " min)");

  // 2. partners: clean and validate each (absent = no readings); readings after t are ignored by the as-of rules
  const partners = {};
  for (const p of gm.ups) {
    const raw = inp.partners && typeof inp.partners === "object" && Object.prototype.hasOwnProperty.call(inp.partners, p.u) ? inp.partners[p.u] : null;
    if (raw === null || raw === undefined) {
      partners[p.u] = null;
      diag.series.partners[p.u] = { present: false };
      continue;
    }
    const pc = cleanSeries(raw, "partner " + p.u);
    partners[p.u] = pc.ser;
    diag.series.partners[p.u] = Object.assign({ present: true }, pc.info);
  }

  // 3. unit guard: newest own reading and each partner's newest reading in feet against the training range; optional independent reference
  const curFt = own.v[own.v.length - 1] * gm.k;
  const u = unitCheck(curFt, gm.range_ft);
  diag.unit = Object.assign({ gauge: inp.gauge, native: gm.unit, k: gm.k }, u, { cross: "not_provided", refFt: null });
  if (!u.inRange) refuse("unit_out_of_range", "newest level " + curFt.toFixed(3) + " ft is outside the training range [" + u.boundLoFt.toFixed(2) + ", " + u.boundHiFt.toFixed(2) + "] ft; ratio to typical " + (u.ratioToMedian === null ? "n/a" : u.ratioToMedian.toFixed(2)) + (u.hint ? " (" + u.hint + ")" : ""));
  if (inp.unitRefFt !== undefined && inp.unitRefFt !== null) {
    if (!isNum(inp.unitRefFt)) refuse("bad_unit_ref", "unitRefFt must be a finite number (feet)");
    diag.unit.refFt = inp.unitRefFt;
    const tol = UNIT_REF_REL * Math.max(Math.abs(curFt), Math.abs(inp.unitRefFt)) + UNIT_REF_ABS_FT;
    diag.unit.ratioToRef = inp.unitRefFt !== 0 ? curFt / inp.unitRefFt : null;
    if (Math.abs(curFt - inp.unitRefFt) > tol) {
      diag.unit.cross = "mismatch";
      refuse("unit_reference_mismatch", "newest level " + curFt.toFixed(3) + " ft (from native " + gm.unit + ") differs from the reference " + inp.unitRefFt.toFixed(3) + " ft; ratio " + (inp.unitRefFt !== 0 ? (curFt / inp.unitRefFt).toFixed(3) : "n/a"));
    }
    diag.unit.cross = "ok";
  }
  for (let j = 0; j < gm.ups.length; j++) {
    const p = gm.ups[j];
    const s = partners[p.u];
    if (!s || s.ts.length === 0) continue;
    const i = lastLE(s.ts, t);
    if (i < 0) continue;
    const pf = s.v[i] * p.k;
    const span = p.range_ft.max - p.range_ft.min;
    const lo = p.range_ft.min - UNIT_HEADROOM * span;
    const hi = p.range_ft.max + UNIT_HEADROOM * span;
    diag.series.partners[p.u].newestFt = pf;
    if (pf < lo || pf > hi) refuse("partner_unit_out_of_range", "partner " + p.u + " newest level " + pf.toFixed(3) + " ft is outside its training range [" + lo.toFixed(2) + ", " + hi.toFixed(2) + "] ft");
  }

  // 3b. every other reading of the own history and of each partner that is outside the gauge's feet range is missing (never a sentinel or a wrong-unit value in a lag or window)
  const oor = { own: 0 };
  {
    const f = dropOutOfRange(own, gm.k, gm.range_ft, t, false);
    if (f.dropped) {
      own = f.ser;
      oor.own = f.dropped;
      diag.series.own.outOfRange = f.dropped;
      diag.series.own.outOfRangeTs = f.ts;
    }
  }
  for (const p of gm.ups) {
    const s = partners[p.u];
    if (!s || s.ts.length === 0) continue;
    const f = dropOutOfRange(s, p.k, p.range_ft, t, true);
    if (f.dropped) {
      partners[p.u] = f.ser;
      oor[p.u] = f.dropped;
      diag.series.partners[p.u].outOfRange = f.dropped;
      diag.series.partners[p.u].outOfRangeTs = f.ts;
    }
  }
  diag.historyOutOfRange = oor;
  diag.ownFlat12h = flatSeries(own, t, 12);

  // 4. rain: clean and validate
  const rc = cleanRain(inp.rain, gm);
  diag.rain = rc.info;

  // 5. the model
  const base = baseColumns(gm, t, own, rc.R);
  if (!Number.isFinite(base.cur)) refuse("no_reading", "newest reading is not a number");
  const c0 = base.c;
  const up = gm.ups.map((p) => partnerLevels(partners[p.u], p.k, t));
  const hz = [];
  const hzFt = [];
  let complete = true;
  for (const h of pg.hList) {
    const m = pg.hs[String(h)];
    if (!m) {
      complete = false;
      continue;
    }
    const c = Object.assign({}, c0);
    upColumns(gm, partners, t, h, c, up);
    if (m.clip) {
      for (const [nm, a, b] of m.clip) if (nm in c) c[nm] = Math.min(Math.max(c[nm], a), b);
    }
    let yhat = lin(c, m.main.names, m.main.b, m.main.b0);
    if (m.regs) {
      const rr = m.regs[base.reg];
      yhat = lin(c, rr.names, rr.b, rr.b0);
    }
    if (m.shift) yhat = yhat + m.shift[base.cell];
    const sc = m.sc;
    const mm = Math.min(Math.max(linAbs(c, sc.names, sc.b, sc.b0), sc.floor), sc.cap);
    const q = m.rq[base.cell];
    const lo = yhat + mm * q[0];
    const hi = yhat + mm * q[1];
    const k = gm.k;
    hz.push([h, base.cur + yhat / k, base.cur + lo / k, base.cur + hi / k]);
    hzFt.push([h, yhat, lo, hi]);
  }

  // 6. diagnostics and the verdict
  const refusals = [];
  const degraded = [];
  const rainMissing = [];
  const rainRelevantMissing = { refuse: [], degrade: [] };
  const notUsed = [];
  for (const w of RAIN_WINDOWS) {
    if (!base.rainMissing[w.id]) continue;
    if (!pg.rel[w.id]) {
      notUsed.push(w.id);
      continue;
    }
    rainMissing.push(w.id);
    rainRelevantMissing[w.sev === "refuse" ? "refuse" : "degrade"].push(w.id);
  }
  const R = rc.R;
  const i0 = base.i0;
  diag.rain.i0 = Number.isFinite(i0) ? i0 : null;
  diag.rain.windowsMissing = rainMissing;
  diag.rain.windowsNotUsedByThisGauge = notUsed;
  diag.rain.obsCellsMissing = R && Number.isFinite(i0) ? cellsMissingIdx(R.obsCells, i0 - 23, i0) : [];
  diag.rain.fcCellsMissing = R && Number.isFinite(i0) ? cellsMissingIdx(R.fcCells, i0 + 1, i0 + 24) : [];
  if (!rc.info.provided) diag.rain.note = "rain not supplied";
  else if (R && !(R.obsMean && R.fcMean)) diag.rain.note = "rain.obs.mean or rain.fc.mean not supplied";
  diag.ownLagsMissing = OWN_H.filter((h) => !Number.isFinite(base.lv[h]));
  for (let j = 0; j < gm.ups.length; j++) {
    const p = gm.ups[j];
    const s = partners[p.u];
    if (!s || s.ts.length === 0) {
      diag.partnersMissing.push(p.u);
      continue;
    }
    const miss = Array.from(up[j].missing).sort((a, b) => a - b);
    if (miss.includes(0)) diag.partnersStale.push(p.u);
    if (miss.length) diag.partnerLagsMissing[p.u] = miss;
  }
  diag.missingInputs = rainMissing.length + diag.ownLagsMissing.length + diag.partnersMissing.length + diag.partnersStale.length + Object.values(diag.partnerLagsMissing).reduce((a, x) => a + x.length, 0);
  if (rainRelevantMissing.refuse.length) refusals.push({ code: "rain_missing", items: rainRelevantMissing.refuse });
  if (OWN_TREND_LAGS.every((h) => diag.ownLagsMissing.includes(h))) refusals.push({ code: "own_history_missing", items: OWN_TREND_LAGS.map((h) => "lag" + h + "h") });
  if (!complete) refusals.push({ code: "model_incomplete", items: ["a horizon the gauge should have is missing from the model"] });
  if (rainRelevantMissing.degrade.length) degraded.push({ code: "rain_window_missing", items: rainRelevantMissing.degrade });
  const ownLagsDeg = diag.ownLagsMissing;
  if (ownLagsDeg.length && !refusals.some((r) => r.code === "own_history_missing")) degraded.push({ code: "own_lags_missing", items: ownLagsDeg.map((h) => "lag" + h + "h") });
  if (diag.partnersMissing.length) degraded.push({ code: "partner_missing", items: diag.partnersMissing });
  if (diag.partnersStale.length) degraded.push({ code: "partner_stale", items: diag.partnersStale });
  const pl = Object.keys(diag.partnerLagsMissing).filter((n) => !diag.partnersStale.includes(n));
  if (pl.length) degraded.push({ code: "partner_lags_missing", items: pl.map((n) => n + ":" + diag.partnerLagsMissing[n].join("/") + "h") });
  const oorItems = Object.keys(oor).filter((n) => oor[n] > 0).map((n) => n + ":" + oor[n]);
  if (oorItems.length) degraded.push({ code: "history_out_of_range", items: oorItems });
  if (diag.unit.cross !== "ok") degraded.push({ code: "unit_not_cross_checked", items: ["no unitRefFt given: only the range guard ran"] });

  const verdict = refusals.length ? "refused" : degraded.length ? "degraded" : "ok";
  const res = {
    verdict,
    reason: refusals.length ? refusals[0].code : null,
    detail: refusals.length ? refusals.map((r) => r.code + ": " + r.items.join(", ")).join("; ") : degraded.length ? degraded.map((r) => r.code + ": " + r.items.join(", ")).join("; ") : "all inputs present",
    degraded,
    refusals,
    gauge: inp.gauge,
    t,
    unit: gm.unit,
    ageMs,
    ageH: ageMs / HOUR,
    c: base.cur,
    complete,
    hz,
    hzFt,
    regime: base.reg,
    cell: base.cell,
    diag,
  };
  if (verdict === "refused") {
    res.c = null;
    res.hz = null;
    res.hzFt = null;
    res.regime = null;
    res.cell = null;
    res.unit = null;
    res.complete = false;
  }
  return res;
}

/** The lab's contract rounding (4 decimals, -0 -> 0), for comparing with the lab's written lines. */
export function labRound(x) {
  return Math.round(x * 1e4) / 1e4 + 0;
}
