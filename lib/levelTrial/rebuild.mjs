// Rebuild the inputs of the level model for ONE gauge at ONE issue time t from what the site stored: the logged rain record of the run, the stored reading rows of the gauge and of its
// upstream partners (as the D1 `observations` table holds them: station, ts, level, in the gauge's native unit) and the site's own unit table. Then call predict() and hand its verdict back
// untouched. Pure: no clock, no I/O, never throws. Contract: DOCS.md "Level-model hidden trial".
import { cleanSeries as qcCleanSeries } from "../readingQc.mjs";
import { predict } from "./predict.mjs";
import { HOUR, ZPAST, CPAST, tryDecode } from "./record.mjs";

export const FT_PER_M = 1 / 0.3048;
/** readings kept per series: every reading newer than t - 72 h, plus the newest 6 older ones (the predictor's lookback) */
export const HIST_H = 72;
export const HIST_EXTRA_OLDER = 6;
/** the minimal rain grid: hour ends floor_hour(t) - 71 h ... floor_hour(t) + 24 h = 96 values (predict reads exactly these; a grid shifted by an hour shows as a missing edge window) */
export const GRID_PAST = 71;
export const GRID_FUTURE = 24;
export const GRID_LEN = GRID_PAST + 1 + GRID_FUTURE;
/** a history is "complete" for the nightly report when it holds at least this many readings in (t-72 h, t] and no gap longer than COMPLETE_MAX_GAP_H */
export const COMPLETE_MIN_READINGS = 60;
export const COMPLETE_MAX_GAP_H = 3;

/** THE one conversion of a level from its native unit to feet ("m" or "ft"); null for any other unit. */
export function toFeet(level, unit) {
  if (unit === "m") return level * FT_PER_M;
  if (unit === "ft") return level;
  return null;
}

const skip = (reason, detail, extra) => ({ verdict: "skipped", reason, detail: String(detail).slice(0, 200), result: null, inputs: null, nHist: null, gapH: null, lagH: null, historyComplete: null, flags: null, ...extra });

/** rows -> clean sorted series [{ts, level}] with ts <= t: finite numbers only, one reading per timestamp (the first), ascending. */
function cleanRows(rows, t) {
  const out = [];
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!r || typeof r.ts !== "number" || !Number.isFinite(r.ts) || typeof r.level !== "number" || !Number.isFinite(r.level) || r.ts > t) continue;
    out.push({ ts: r.ts, level: r.level });
  }
  out.sort((a, b) => a.ts - b.ts);
  const dedup = [];
  for (const r of out) if (!dedup.length || dedup[dedup.length - 1].ts !== r.ts) dedup.push(r);
  return dedup;
}

/**
 * The glitch flags AS KNOWN AT t: lib/readingQc.mjs (the filter the live forecast uses: spikes of 1-2 readings, stuck sensors) run on the readings up to t. Returns the flagged timestamps.
 * The newest reading is never flagged (the filter never removes it). `unit` is the gauge's native unit ("m" | "ft").
 */
export function glitchFlags(series, unit) {
  const { flags } = qcCleanSeries(series.map((r) => ({ ts: r.ts, water_level: r.level })), { unit });
  return flags.map((f) => f.ts);
}

/** series -> the predictor's {ts, v, bad} over the lookback window; `bad[i] = t` for a reading the filter had flagged by t, else null (predict ignores a flag with bad[i] > t). */
function toSeries(series, flagged, t) {
  const first = series.findIndex((r) => r.ts > t - HIST_H * HOUR);
  const lo = Math.max(0, (first < 0 ? series.length : first) - HIST_EXTRA_OLDER);
  const win = series.slice(lo);
  const fl = new Set(flagged);
  return { ts: win.map((r) => r.ts), v: win.map((r) => r.level), bad: win.map((r) => (fl.has(r.ts) ? t : null)) };
}

/** number of readings in (t - 72 h, t] and the longest gap (hours) over that window, the edges included. */
function histStats(series, t) {
  const from = t - HIST_H * HOUR;
  const inWin = series.filter((r) => r.ts > from);
  let gap = 0;
  let prev = from;
  for (const r of inWin) {
    gap = Math.max(gap, r.ts - prev);
    prev = r.ts;
  }
  gap = Math.max(gap, t - prev);
  return { n: inWin.length, gapH: gap / HOUR };
}

/**
 * The minimal rain grid for floor_hour(t) = F from a decoded record (grid N, F in [N - 4 h, N]): 96 values, hour ends F - 71 h ... F + 24 h.
 *   obs.mean / obs.up : hours F-71 ... F (indices 0..71), the rest null;  obs.cells : hours F-23 ... F, the rest null
 *   fc.mean           : hours F+1 ... F+24 (indices 72..95), the rest null;  fc.cells: the same
 * obs.mean = fc.mean source = the full zone; up = the up zone when the gauge has one (else null). Means are the zone sums / (10 x zone cells), cells are tenths / 10.
 */
export function minimalGrid(rec, F) {
  const d = (F - rec.grid) / HOUR; // -4 .. 0
  const zoneAt = (arr, n, k) => {
    const s = arr[k];
    return s === null || s === undefined ? null : s / (10 * n);
  };
  const mean = (zone, i) => (rec.zones[zone] ? zoneAt(rec.zones[zone], rec.nz[zone === "full" ? 0 : 2], d + (ZPAST - GRID_PAST) + i) : null);
  const obsMean = Array.from({ length: GRID_LEN }, (_, i) => (i <= GRID_PAST ? mean("full", i) : null));
  const obsUp = rec.nz[2] > 0 ? Array.from({ length: GRID_LEN }, (_, i) => (i <= GRID_PAST ? mean("up", i) : null)) : null;
  const fcMean = Array.from({ length: GRID_LEN }, (_, i) => (i > GRID_PAST ? mean("full", i) : null));
  const cellAt = (c, i) => {
    const v = rec.cells[c][d + (CPAST - GRID_PAST) + i];
    return v === null || v === undefined ? null : v / 10;
  };
  const obsCells = rec.cells.map((_, c) => Array.from({ length: GRID_LEN }, (__, i) => (i >= GRID_PAST - 23 && i <= GRID_PAST ? cellAt(c, i) : null)));
  const fcCells = rec.cells.map((_, c) => Array.from({ length: GRID_LEN }, (__, i) => (i > GRID_PAST ? cellAt(c, i) : null)));
  return { origin: F - GRID_PAST * HOUR, obs: { mean: obsMean, up: obsUp, cells: obsCells }, fc: { mean: fcMean, cells: fcCells } };
}

/**
 * @param model    the parsed lib/model/lvl-lin-d4.json
 * @param a.gauge  station name (a gauge of the model)
 * @param a.t      issue time, epoch ms = the gauge's newest reading (the run's issued_at)
 * @param a.record the run's logged inputs: the base64 text, or the decoded record; null / undefined = none logged
 * @param a.rows   { [station]: [{ts, level}] } stored readings (native unit, as in D1 observations) of the gauge AND each of its partners; at least 96 h before t is advised
 *                 (the glitch filter judges a stuck sensor over 12-36 h; the predictor reads 72 h plus 6 older readings)
 * @param a.unitTable { [station]: "m" | "ft" } the site's own unit table (lib/units.ts UNIT_BY_STATION)
 * @returns { verdict: "ok" | "degraded" | "refused" | "skipped", reason, detail, result, inputs, nHist, gapH, lagH, historyComplete, flags }
 *   verdict ok / degraded / refused come from predict() UNCHANGED (result = its whole return value). "skipped" = the rebuild itself could not make the inputs; reason is one of
 *   no_record | decode_error | bad_record | grid_misaligned | unknown_gauge | unit_table_mismatch | no_obs | history_incomplete | t_not_newest | bad_input.
 *   nHist, gapH: readings in (t-72 h, t] and the longest gap there (hours); lagH = (N - floor_hour(t)) / 1 h; historyComplete = nHist >= 60 and gapH <= 3.
 *   flags = { own: [flagged ts], partners: { name: [flagged ts] } } (glitch filter, as known at t).
 */
export function rebuild(model, a) {
  try {
    return rebuildInner(model, a);
  } catch (e) {
    return skip("bad_input", String(e && e.message ? e.message : e));
  }
}

function rebuildInner(model, a) {
  if (!a || typeof a !== "object") return skip("bad_input", "arguments must be an object");
  const { gauge, t } = a;
  if (!model || typeof model !== "object" || !model.g || typeof gauge !== "string" || !Object.prototype.hasOwnProperty.call(model.g, gauge)) return skip("unknown_gauge", "gauge " + String(gauge) + " is not in the model");
  if (typeof t !== "number" || !Number.isInteger(t)) return skip("bad_input", "t must be an integer number of epoch ms");
  const gm = model.g[gauge];
  const table = a.unitTable;
  if (!table || typeof table !== "object") return skip("bad_input", "unitTable is required");

  // 1. the record
  let rec = a.record;
  if (rec === null || rec === undefined) return skip("no_record", "no inputs record logged for this run");
  if (typeof rec === "string") {
    const d = tryDecode(rec);
    if (!d.ok) return skip("decode_error", d.detail);
    rec = d.rec;
  }
  if (typeof rec !== "object" || rec.fmt !== 1 || !Number.isInteger(rec.grid) || !rec.zones || !rec.zones.full || !Array.isArray(rec.cells) || !Array.isArray(rec.nz)) return skip("bad_record", "not a format-1 record");
  const F = Math.floor(t / HOUR) * HOUR;
  const lagH = (rec.grid - F) / HOUR;
  if (!Number.isInteger(lagH) || lagH < 0 || lagH > 4) return skip("grid_misaligned", "record grid is " + lagH + " h after floor_hour(t); it must be 0 to 4 h", { lagH });

  // 2. units: the model's unit of the gauge and of every partner must be the site's own unit for that station (R1: a wrong unit is refused here, not guessed)
  const need = [[gauge, gm.unit], ...gm.ups.map((p) => [p.u, p.unit])];
  for (const [name, mu] of need) {
    const su = Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
    if (su !== mu) return skip("unit_table_mismatch", name + ": model unit " + mu + ", site unit table " + su, { lagH });
  }

  // 3. readings
  const rows = a.rows && typeof a.rows === "object" ? a.rows : {};
  const ownAll = cleanRows(rows[gauge], t);
  if (ownAll.length === 0) return skip("no_obs", "no stored reading of " + gauge + " at or before t", { lagH });
  if (ownAll[ownAll.length - 1].ts !== t) return skip("t_not_newest", "newest stored reading is " + (t - ownAll[ownAll.length - 1].ts) / 60000 + " min before t", { lagH });
  if (ownAll.length < 2) return skip("history_incomplete", "only one stored reading of " + gauge, { lagH });
  const stats = histStats(ownAll, t);
  const flags = { own: glitchFlags(ownAll, gm.unit), partners: {} };
  const inputs = { gauge, t, own: toSeries(ownAll, flags.own, t), partners: {}, rain: minimalGrid(rec, F), unitRefFt: null };
  for (const p of gm.ups) {
    const all = cleanRows(rows[p.u], t);
    if (all.length === 0) continue; // absent partner: predict degrades (partner_missing)
    flags.partners[p.u] = glitchFlags(all, p.unit);
    inputs.partners[p.u] = toSeries(all, flags.partners[p.u], t);
  }
  // the reference level in feet: the newest reading converted with the SITE's unit table (what the site would display); predict compares it with the reading converted with the MODEL's unit
  inputs.unitRefFt = toFeet(ownAll[ownAll.length - 1].level, table[gauge]);

  const result = predict(model, inputs);
  return {
    verdict: result.verdict,
    reason: result.reason,
    detail: result.detail,
    result,
    inputs,
    nHist: stats.n,
    gapH: stats.gapH,
    lagH,
    historyComplete: stats.n >= COMPLETE_MIN_READINGS && stats.gapH <= COMPLETE_MAX_GAP_H,
    flags,
  };
}
