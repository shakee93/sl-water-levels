// The nightly report of the level-model hidden trial (variant "lvl-lin-d4"): MEASURES ONLY. Pure: archive lines in, plain objects out (no clock, no I/O).
//   - pooled and per-gauge skill of the trial and of the LIVE forecast on exactly the same runs and horizons (rows where both have a point and a reading followed)
//   - the 80% range the trial states (low / high) and what the online range layer (adaptive conformal, lib/levelTrial/conformal.mjs) would have covered, replayed
//     over the same lines with an as-of rule (an outcome enters the state only when a run issued at or after target time + 40 min is processed)
//   - how many live runs have a trial forecast (ok / degraded), the skip reasons and history completeness (from forecast_trial_log rows), rain days
// Archive lines: scripts/forecast-archive.mjs / lib/forecastScoreboard.mjs buildArchiveLines (levels in the gauge's own unit; `y` = the reading near the target).
import { interval, newState, update } from "./conformal.mjs";
import { tryDecode, zoneMean } from "./record.mjs";

export const SCHEMA = "slwl-level-trial/report@1";
export const VARIANT = "lvl-lin-d4";
export const DEG_VARIANT = "lvl-lin-d4-deg";
export const HORIZONS = [1, 3, 6, 12, 24];
export const HOUR = 3_600_000;
export const MATCH_MS = 40 * 60_000; // an outcome is the reading nearest the target within this; it is known this long after the target
export const FT_PER_M = 1 / 0.3048;
export const COMPLETE_MIN_READINGS = 60;
export const COMPLETE_MAX_GAP_H = 3;
/** the range layer the replay stands for: pooled per horizon, target 80%, additive on both ends (cal-d4-r of the lab: gamma 0.02, window 200, 20 scores before it learns) */
export const CAL = Object.freeze({ target: 0.8, gamma: 0.02, window: 200, minScores: 20 });
export const BELOW_PTS = 5; // a gauge-horizon this many points below live is listed ...
export const BELOW_MIN_N = 100; // ... once it has this many rows
export const RAIN_DAY_MM = 10; // a gauge "had rain" on a day when a run's 24 h observed catchment rain was at least this ...
export const RAIN_DAY_GAUGES = 5; // ... on at least this many gauges

const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const kOf = (unit) => (unit === "m" ? FT_PER_M : unit === "ft" ? 1 : null);
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** A live run the trial could be compared with: a fitted-model run with a known unit and a current level. */
export function scorable(l) {
  return !!l && l.method === "model" && kOf(l.unit) != null && fin(l.current_level);
}

/**
 * Paired rows in feet: one per (live run x horizon) where the live point has a matched reading AND the trial has a point. `cal` is filled by replayRange.
 * @param lines    archive lines
 * @param variant  "lvl-lin-d4" (or any shadow variant, for a dry run of the tooling)
 * @param gauges   optional Set / array of station names; others are ignored
 */
export function pairedRows(lines, { variant = VARIANT, gauges = null } = {}) {
  const only = gauges ? new Set(gauges) : null;
  const rows = [];
  for (const l of lines) {
    if (!scorable(l) || (only && !only.has(l.station))) continue;
    const sp = l.shadows?.[variant];
    if (!sp || !sp.length) continue;
    const k = kOf(l.unit);
    for (const p of l.horizons ?? []) {
      if (!HORIZONS.includes(p.h) || !fin(p.y) || !fin(p.level)) continue;
      const t = sp.find((x) => x.h === p.h);
      if (!t || !fin(t.level)) continue;
      rows.push({
        station: l.station, day: l.day, h: p.h, issued_at: l.issued_at, key: `${l.station}|${l.day}`,
        c: l.current_level * k, y: p.y * k,
        live: { p: p.level * k, low: fin(p.low) ? p.low * k : null, high: fin(p.high) ? p.high * k : null },
        trial: { p: t.level * k, low: fin(t.low) ? t.low * k : null, high: fin(t.high) ? t.high * k : null },
        cal: null,
      });
    }
  }
  return rows;
}

/** Skill in percent over rows: 100 x (1 - MAE of `which` / MAE of "no change") with `which` = "live" | "trial"; null without rows or when "no change" is perfect. */
export function skillPct(rows, which) {
  const v = skillRaw(rows, which);
  return v == null ? null : r1(v);
}
function skillRaw(rows, which) {
  if (!rows.length) return null;
  const mae = mean(rows.map((r) => Math.abs(r.y - r[which].p)));
  const pers = mean(rows.map((r) => Math.abs(r.y - r.c)));
  return pers > 0 ? 100 * (1 - mae / pers) : null;
}

const covOf = (rows, get) => {
  const R = rows.map((r) => ({ r, b: get(r) })).filter((x) => x.b && fin(x.b.low) && fin(x.b.high));
  if (!R.length) return { n: 0, coveragePct: null, widthFt: null };
  return { n: R.length, coveragePct: r1(100 * mean(R.map((x) => (x.r.y >= x.b.low && x.r.y <= x.b.high ? 1 : 0)))), widthFt: r2(mean(R.map((x) => x.b.high - x.b.low))) };
};

/**
 * What the online range layer would have covered, replayed over `lines` that carry the trial. Fills `row.cal = {low, high}` on the matching rows of `rows`.
 * As-of rule: lines are taken in (issued_at, station) order; the outcome of (run, h) enters the state of horizon h only when a line issued at or after
 * issued_at + h hours + 40 min is processed; a case with no reading is never an outcome. One state per horizon pooled over the gauges (feet, scale 1);
 * until a horizon has 20 outcomes its q is 0 (the trial's own range). Deterministic, nothing persisted.
 */
export function replayRange(lines, rows, { variant = VARIANT, gauges = null } = {}) {
  const only = gauges ? new Set(gauges) : null;
  const byKey = new Map(rows.map((r) => [`${r.station}|${r.issued_at}|${r.h}`, r]));
  const state = newState({ target: CAL.target, gamma: CAL.gamma, window: CAL.window, minScores: CAL.minScores });
  state.keys["*"] = { q: 0 };
  const pending = Object.fromEntries(HORIZONS.map((h) => [h, []])); // per horizon in issue order, so available-at is non-decreasing
  const ordered = lines.filter((l) => scorable(l) && (!only || only.has(l.station)) && l.shadows?.[variant]?.length).sort((a, b) => a.issued_at - b.issued_at || a.station.localeCompare(b.station));
  for (const l of ordered) {
    const k = kOf(l.unit);
    for (const h of HORIZONS) {
      const q = pending[h];
      while (q.length && q[0].avail <= l.issued_at) { const o = q.shift(); update(state, String(h), o.lo, o.hi, o.y); }
    }
    const sp = l.shadows[variant];
    for (const t of sp) {
      if (!HORIZONS.includes(t.h) || !fin(t.low) || !fin(t.high)) continue;
      const lo0 = t.low * k, hi0 = t.high * k;
      const live = (l.horizons ?? []).find((p) => p.h === t.h);
      const y = live && fin(live.y) ? live.y * k : null;
      if (y == null) continue; // no reading: not scored, never an outcome
      const iv = interval(state, String(t.h), lo0, hi0);
      const row = byKey.get(`${l.station}|${l.issued_at}|${t.h}`);
      if (row && iv) row.cal = { low: iv[0], high: iv[1] };
      pending[t.h].push({ avail: l.issued_at + t.h * HOUR + MATCH_MS, lo: lo0, hi: hi0, y });
    }
  }
  return rows;
}

function cell(rows) {
  if (!rows.length) return null;
  const trial = skillRaw(rows, "trial"), live = skillRaw(rows, "live");
  return {
    n: rows.length, clusters: new Set(rows.map((r) => r.key)).size,
    trialSkillPct: r1(trial), liveSkillPct: r1(live), diffPts: trial != null && live != null ? r1(trial - live) : null, // the difference of the unrounded skills
    trialBiasFt: r2(mean(rows.map((r) => r.trial.p - r.y))), liveBiasFt: r2(mean(rows.map((r) => r.live.p - r.y))),
  };
}

const pctOf = (n, d) => (d ? r1((100 * n) / d) : null);

/** Coverage of the trial: live scorable runs of the model's gauges, how many carry the trial's ok / degraded forecast. */
export function coverageOf(lines, { gauges = null, variant = VARIANT, degVariant = DEG_VARIANT } = {}) {
  const only = gauges ? new Set(gauges) : null;
  const per = {};
  let live = 0, withTrial = 0, withDeg = 0;
  for (const l of lines) {
    if (!scorable(l) || (only && !only.has(l.station))) continue;
    const g = (per[l.station] ??= { liveRuns: 0, withTrial: 0, withDegraded: 0 });
    const t = (l.shadows?.[variant]?.length ?? 0) > 0, d = (l.shadows?.[degVariant]?.length ?? 0) > 0;
    live++; g.liveRuns++;
    if (t) { withTrial++; g.withTrial++; } else if (d) { withDeg++; g.withDegraded++; }
  }
  for (const g of Object.values(per)) g.sharePct = pctOf(g.withTrial, g.liveRuns);
  return { liveRuns: live, withTrial, withDegraded: withDeg, sharePct: pctOf(withTrial, live), degradedSharePct: pctOf(withDeg, live), perGauge: per };
}

/** The pooled / per-gauge tables of one report from the archive lines. */
export function buildReport({ lines, gauges = null, variant = VARIANT, degVariant = DEG_VARIANT, dayInfo = null, window = null }) {
  const rows = replayRange(lines, pairedRows(lines, { variant, gauges }), { variant, gauges });
  const pooled = {}, perGauge = {}, below = [];
  for (const h of HORIZONS) {
    const R = rows.filter((r) => r.h === h);
    const c = cell(R);
    if (!c) continue;
    pooled[`h${h}`] = {
      ...c,
      trialRange: covOf(R, (r) => r.trial), liveRange: covOf(R, (r) => r.live),
      // what the online layer would have covered (its range keeps the trial's centre, so the skill is the trial's)
      calRange: covOf(R.filter((r) => r.cal), (r) => r.cal),
      trialRangeSameRows: covOf(R.filter((r) => r.cal), (r) => r.trial),
    };
  }
  const stations = [...new Set(rows.map((r) => r.station))].sort();
  for (const st of stations) {
    for (const h of HORIZONS) {
      const c = cell(rows.filter((r) => r.station === st && r.h === h));
      if (!c) continue;
      (perGauge[st] ??= {})[`h${h}`] = c;
      if (c.n >= BELOW_MIN_N && c.diffPts != null && c.diffPts < -BELOW_PTS) below.push({ gauge: st, h, n: c.n, trialSkillPct: c.trialSkillPct, liveSkillPct: c.liveSkillPct, diffPts: c.diffPts });
    }
  }
  below.sort((a, b) => a.diffPts - b.diffPts);
  const days = [...new Set(lines.map((l) => l.day))].sort();
  const perDay = days.map((day) => {
    const L = lines.filter((l) => l.day === day);
    const cv = coverageOf(L, { gauges, variant, degVariant });
    const info = dayInfo?.[day] ?? null;
    return {
      day, liveRuns: cv.liveRuns, withTrial: cv.withTrial, withDegraded: cv.withDegraded,
      stormDay: L.some((l) => scorable(l) && (l.storm || l.rain_risk)),
      rainDay: info?.rain ? !!info.rain.rainDay : null, rainGauges: info?.rain ? info.rain.gauges : null,
    };
  });
  return {
    schema: SCHEMA, variant, window: window ?? { from: days[0] ?? null, to: days[days.length - 1] ?? null, days: days.length },
    lines: lines.length, pairedRows: rows.length,
    coverage: coverageOf(lines, { gauges, variant, degVariant }),
    pooled, perGauge, belowLive: { rule: `n >= ${BELOW_MIN_N} and the trial more than ${BELOW_PTS} points below live`, cells: below },
    days: { withRuns: days.length, rainDays: perDay.filter((d) => d.rainDay).map((d) => d.day), stormDays: perDay.filter((d) => d.stormDay).map((d) => d.day), rainUnknown: perDay.filter((d) => d.rainDay == null).length, perDay },
  };
}

// ---------------------------------------------------------------- the runner's log and the inputs (D1 rows of one day)
const AGE_BUCKETS = [["<=15", 15], ["<=30", 30], ["<=60", 60], ["<=120", 120]];
const ageBucket = (m) => (m == null ? "unknown" : (AGE_BUCKETS.find(([, hi]) => m <= hi) ?? [">120"])[0]);

/** forecast_trial_log rows of one day -> counts that can be added up over days. */
export function summariseLog(rows) {
  const out = { runs: 0, byVerdict: {}, reasons: {}, degradedFlags: {}, history: { checked: 0, complete: 0, incomplete: 0 }, lagHours: {}, ageMin: {} };
  const bump = (m, k) => (m[k] = (m[k] ?? 0) + 1);
  for (const r of rows ?? []) {
    out.runs++;
    bump(out.byVerdict, r.verdict);
    if (r.verdict !== "ok" && r.reason) bump(out.reasons, `${r.verdict}:${r.reason}`);
    if (r.flags) for (const f of String(r.flags).split(",")) if (f) bump(out.degradedFlags, f);
    if (r.n_hist != null && r.gap_h != null) {
      out.history.checked++;
      if (r.n_hist >= COMPLETE_MIN_READINGS && r.gap_h <= COMPLETE_MAX_GAP_H) out.history.complete++; else out.history.incomplete++;
    }
    if (r.lag_h != null) bump(out.lagHours, String(r.lag_h));
    bump(out.ageMin, ageBucket(r.weather_age_min));
  }
  return out;
}

/** Adds up summariseLog results (one per day). */
export function mergeLogs(list) {
  const out = summariseLog([]);
  const add = (a, b) => { for (const [k, v] of Object.entries(b ?? {})) a[k] = (a[k] ?? 0) + v; };
  for (const s of list) {
    if (!s) continue;
    out.runs += s.runs ?? 0;
    for (const f of ["byVerdict", "reasons", "degradedFlags", "lagHours", "ageMin"]) add(out[f], s[f]);
    for (const f of ["checked", "complete", "incomplete"]) out.history[f] += s.history?.[f] ?? 0;
  }
  out.history.completePct = pctOf(out.history.complete, out.history.checked);
  return out;
}

/**
 * Which gauges had rain on a day: from the day's forecast_inputs rows {station, issued_at, blob}: a gauge counts when ANY run's observed full-zone rain
 * over the 24 hour ends up to floor_hour(issued_at) summed to RAIN_DAY_MM or more (at least 20 of the 24 hours present). rainDay = at least RAIN_DAY_GAUGES gauges.
 */
export function rainOfDay(inputRows) {
  const hit = new Set();
  for (const r of inputRows ?? []) {
    if (!r || !r.blob) continue;
    const d = tryDecode(r.blob);
    if (!d.ok) continue;
    const F = Math.floor(r.issued_at / HOUR) * HOUR;
    let sum = 0, got = 0;
    for (let i = 0; i < 24; i++) {
      const m = zoneMean(d.rec, "full", F - i * HOUR);
      if (m != null) { sum += m; got++; }
    }
    if (got >= 20 && sum >= RAIN_DAY_MM) hit.add(r.station);
  }
  return { gauges: hit.size, thresholdMm: RAIN_DAY_MM, thresholdGauges: RAIN_DAY_GAUGES, rainDay: hit.size >= RAIN_DAY_GAUGES, names: [...hit].sort() };
}
