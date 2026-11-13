// Forecast KPIs: the ten targets the owner approved (29 Oct 2026), computed from the forecast archive. Pure: no network, no D1, no clock.
// Used by scripts/forecast-kpi.mjs (nightly, writes kpi/latest.json, kpi/days/*.json, kpi/history.csv on the `data` branch) and
// scripts/forecast-kpi.test.mts. MEASURES ONLY: nothing here touches the live forecast, a verdict, an alert or a push.
//
// Inputs: archive lines (forecasts/YYYY/YYYY-MM-DD.jsonl, lib/forecastScoreboard.mjs buildArchiveLines) and the day's clean-able readings
// (forecasts/YYYY/YYYY-MM-DD.readings.json, `buildReadings` there). Everything is scored in FEET. Readings go through lib/readingQc.mjs
// cleanSeries first (outcomes and crossings), and a run issued from a flagged reading (a spike or stuck repeat, or a latest reading that
// jumped like a glitch) is dropped from every KPI except the "inputs" one, which counts them.
//
// Definitions (the same text is on /forecast-accuracy and in DOCS.md "Forecast KPIs"):
//  1 Floods warned in time. An EVENT is one gauge-step crossing: the first clean reading at or above the step after one below it (a second
//    crossing of the same gauge and step within 6 h of the first is the same event). It is WARNED when, in every fitted-model run from the
//    last run before it back through the lead time, the SHOWN chance (forecastRules.shownChance) of that step was at least 20% (POSSIBLE_P).
//    Runs are hourly: a gap of more than 3 h between runs ends the unbroken stretch. Lead = crossing time minus the first run of the stretch.
//    Lead needed: 6 h for alert and 12 h for minor / major on the big rivers, 2 h on the fast rivers (isShortForecastGauge). Gauges with no
//    fitted-model run in the 3 h before the crossing are not scored (no calibrated chance existed).
//  2 False alarms. A gauge-step-day is "alarmed" when some fitted-model run that day showed >= 20% for a step the river was still below. It is
//    "likely" when the highest shown chance was >= 50%, otherwise "possible". It "did not happen" when the river stayed below the step for 24 h
//    after the first run that reached the wording's chance (>= 20% / >= 50%).
//  3 Honest chances. Per run and step still ahead: shown chance vs whether the river reached the step in the next 24 h, in bins.
//  4 Level skill = 1 - (forecast error) / (error of "no change"), per horizon and per phase of the last 3 h rate.
//  5 Bias (forecast minus actual) at 12 h per phase.  6 Coverage of the stated 80% range per horizon.
//  7 Fast rises called: the next reading (1 h on) is 10 cm or more higher, and the card's "Next hour" said Rising (nextHourRateM > STEADY_M_PER_H).
//  8 "Rising" right: of the Rising calls, the share followed by a rise of 1 cm or more.  (Tidal gauges are left out of 7 and 8.)
//  9 Inputs: hours with runs, median gauges per hour, share of runs flagged by the glitch filter.
// 10 People agree: yes / (yes + worse + better) among "Is this right?" answers.
//
// SCORING SPECS. Spec 1 (SPEC1, the default) is what the public /forecast-accuracy page reads and must not change. Spec 2 (SPEC2) is the corrected
// scoring recorded side by side (kpi/v2/latest.json, spec 2 rows of kpi/history-wide.csv) from the 11 Nov 2026 KPI audit (research notes 02-kpi-audit):
//  - reach (A1): a "did not reach" outcome is accepted when the readings bracket the 24 h window (a reading beyond 24 h exists and the last one
//    inside is at or after run + 22 h), not only when a reading sits in the last hour (run + 23 h);
//  - leadTolH (A2): KPI 1 caught = lead >= need - 0.25 h (the runs are issued from readings spaced 1 h +- minutes);
//  - lookAll (A3): KPI 1 looks back through ALL runs (across midnight, versions, scopes); the scope only picks which events are attributed;
//  - exact (A8): targets are compared with the unrounded value;
//  - dedupe (C9): one run per station-hour (the latest) before KPIs 7-9.
import { FT, HOUR, colomboDay, dayStart, median, nearestReading } from "./forecastScoreboard.mjs";
import { FAST_MAX_H, NEXT_HOUR_MEASURED_SINCE, NEXT_HOUR_MEASURED_WINS_SINCE, POSSIBLE_P, P_CAP, RISE_OVERRIDE_SINCE, STEADY_M_PER_H, hasNoForecast, isShortForecastGauge, nextHourRateM, shownChance } from "./forecastRules.mjs";
import { cleanSeries, latestLooksOdd } from "./readingQc.mjs";

export const SPEC1 = Object.freeze({ id: 1, reach: "strict", leadTolH: 0, lookAll: false, exact: false, dedupe: false });
export const SPEC2 = Object.freeze({ id: 2, reach: "bracket", leadTolH: 0.25, lookAll: true, exact: true, dedupe: true });
export const JITTER_TOL_H = 0.25;
export const FT_PER_M = 1 / FT;
export const THRESHOLDS = ["alert", "minor", "major"];
export const HORIZONS = [1, 3, 6, 12, 24];
export const LIKELY_P = 0.5;
export const GAP_MS = 3 * HOUR; // longest gap between runs that still counts as "every run"
export const SAME_EVENT_MS = 6 * HOUR;
export const MATCH_MS = 40 * 60_000;
export const PHASES = ["rising", "slow rise", "calm", "slow fall", "falling"];
export const RISE_BIG_FT = 0.1 * FT_PER_M; // 10 cm
export const RISE_ANY_FT = 0.01 * FT_PER_M; // 1 cm
/** Gauges the site judges rising from a tide-corrected comparison (lib/verdictLift.ts TIDAL_STATIONS); not judged here (see KPI 7 and 8). */
export const TIDAL_STATIONS = ["Nagalagam Street", "Peradeniya", "Putupaula", "Thalgahagoda"];
const PROB_BINS = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.0001]];

/** Targets, in one place. `min` = fewest cases before a result is judged (below it: met = null, "not enough cases yet"). */
export const TARGETS = {
  warned: { caught: 80, leadBigAlertH: 6, leadBigOtherH: 12, leadFastH: 2, min: 5 },
  falseAlarms: { possibleMaxPct: 60, likelyMaxPct: 25, min: 10 },
  honest: { withinPts: 10, minBin: 10 },
  skill: { 1: 30, 3: 30, 6: 30, 12: 20, 24: 10, phaseMin: 0, min: 30 },
  bias: { withinFt: 0.25, min: 10 },
  coverage: { lo: 75, hi: 85, min: 30 },
  fastRises: { pct: 95, min: 5 },
  risingRight: { pct: 75, min: 20 },
  inputs: { hours: 24 },
  people: { pct: 70, min: 10 },
};

const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pct = (n, d) => (d ? r1((100 * n) / d) : null);
const rawPct = (n, d) => (d ? (100 * n) / d : null);
const distinct = (a, f) => new Set(a.map(f)).size;
/** compared with the target: the rounded value (spec 1) or the exact one (spec 2) */
const cmp = (spec, rounded, exact) => (spec.exact ? exact : rounded);
const unitK = (unit) => (unit === "m" ? FT_PER_M : unit === "ft" ? 1 : null);

// ---------------------------------------------------------------- readings

/** Merges several readings files (each overlapping its neighbours; times are whole seconds) into { station: { unit, pts: [{ts, level}] sorted, native unit } }. */
export function mergeReadings(files) {
  const by = {};
  for (const f of files) {
    for (const [st, s] of Object.entries(f?.stations ?? {})) {
      const e = (by[st] ??= { unit: s.unit ?? null, map: new Map() });
      if (!e.unit && s.unit) e.unit = s.unit;
      for (let i = 0; i < s.s.length; i++) e.map.set(f.t0 + s.s[i] * 1000, s.v[i]);
    }
  }
  const out = {};
  for (const [st, e] of Object.entries(by)) out[st] = { unit: e.unit, pts: [...e.map].sort((a, b) => a[0] - b[0]).map(([ts, level]) => ({ ts, level })) };
  return out;
}

// ---------------------------------------------------------------- context (cleaned series, enriched runs, events)

/**
 * Builds everything the KPIs need.
 * @param {{ lines: any[], readings: Record<string, {unit: string|null, pts: {ts:number, level:number}[]}>, versions?: any[] }} input
 */
export function buildContext({ lines, readings = {}, versions = [] }) {
  const units = {};
  for (const l of lines) if (l.unit && !units[l.station]) units[l.station] = l.unit;
  // clean series per station, in feet
  const series = {}; // station -> { raw (native), clean [{ts, level ft}], bad:Set<ts>, unit }
  for (const [st, r] of Object.entries(readings)) {
    const unit = units[st] ?? r.unit;
    const k = unitK(unit);
    if (k == null || !r.pts.length) continue;
    const rawPts = r.pts.map((p) => ({ ts: p.ts, water_level: p.level }));
    const { points, flags } = cleanSeries(rawPts, { unit });
    series[st] = {
      unit, k, raw: rawPts, bad: new Set(flags.map((f) => f.ts)),
      clean: points.map((p) => ({ ts: p.ts, level: p.water_level * k })),
    };
  }
  const near = (st, ts) => {
    const s = series[st];
    if (!s || !s.clean.length || ts < s.clean[0].ts - MATCH_MS || ts > s.clean[s.clean.length - 1].ts + MATCH_MS) return undefined; // not covered
    return nearestReading(s.clean, ts); // number (ft) or null
  };
  // step levels per station (feet), from the crossings the runs carried
  const steps = {};
  for (const l of lines) {
    const k = unitK(l.unit);
    if (k == null) continue;
    for (const c of l.crossings ?? []) if (THRESHOLDS.includes(c.threshold) && c.level != null) (steps[l.station] ??= {})[c.threshold] ??= c.level * k;
  }

  const stormDays = new Set(lines.filter((l) => l.storm === 1 || l.rain_risk).map((l) => l.day ?? colomboDay(l.issued_at)));
  const runs = [];
  for (const l of lines) {
    const k = unitK(l.unit);
    const day = l.day ?? colomboDay(l.issued_at);
    const base = {
      station: l.station, ts: l.issued_at, day, method: l.method, model: l.method === "model", unit: l.unit, version: versionAt(versions, l), line: l,
      noForecast: hasNoForecast(l.station), short: isShortForecastGauge(l.station), tidal: TIDAL_STATIONS.includes(l.station),
      storm: l.storm === 1 || !!l.rain_risk, stormDay: stormDays.has(day),
    };
    if (k == null || l.current_level == null) { runs.push({ ...base, usable: false, flagged: false }); continue; }
    const s = series[l.station];
    // glitch flag at issue: the issue reading itself dropped as a spike / stuck repeat, or the newest reading jumped like a glitch
    let flagged = false;
    if (s) {
      // the stored reading times are whole seconds: find the raw reading within 5 s of the issue time (last one at or before it)
      let lo = 0, hi = s.raw.length - 1, i = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (s.raw[mid].ts <= l.issued_at + 5000) { i = mid; lo = mid + 1; } else hi = mid - 1; }
      if (i >= 0 && Math.abs(s.raw[i].ts - l.issued_at) <= 5000) {
        if (s.bad.has(s.raw[i].ts)) flagged = true;
        else if (i >= 2) flagged = latestLooksOdd(s.raw.slice(Math.max(0, i - 6), i + 1).filter((p) => !s.bad.has(p.ts)), { unit: s.unit });
      }
    }
    const cur = l.current_level * k;
    const prev = near(l.station, l.issued_at - 3 * HOUR);
    const rate3 = typeof prev === "number" ? (cur - prev) / 3 : null; // ft per hour
    const hx = {};
    for (const p of l.horizons ?? []) {
      let y = near(l.station, p.ts);
      if (y === undefined) y = p.y == null ? null : p.y * k; // no readings file for this window: the stored match
      hx[p.h] = { p: p.level * k, low: p.low == null ? null : p.low * k, high: p.high == null ? null : p.high * k, y };
    }
    const sh = {};
    for (const [v, pts] of Object.entries(l.shadows ?? {})) {
      sh[v] = {};
      for (const p of pts) sh[v][p.h] = { p: p.level * k, low: p.low == null ? null : p.low * k, high: p.high == null ? null : p.high * k };
    }
    const crossings = (l.crossings ?? [])
      .filter((c) => THRESHOLDS.includes(c.threshold) && c.level != null)
      .map((c) => ({ t: c.threshold, lvl: c.level * k, shown: shownChance(c.threshold, c.probability), raw: c.probability ?? null }));
    // warning-rule candidates (lib/warningCandidates.mjs): { variant: { threshold: shown chance } }; `logged` = the day was archived with the candidate log
    // readable (absent key = not logged), and then a variant with no entry for this run means "same as live"
    const cand = {};
    for (const [v, rows] of Object.entries(l.candidates ?? {})) for (const w of rows) (cand[v] ??= {})[w.threshold] = w.shown;
    // shadow_nh: a variant's own next-hour rate in metres per hour ({ variant: m/h }), when it has one (full-system variants)
    runs.push({ ...base, usable: true, flagged, cur, rate3, phase: phaseOf(rate3), hx, sh, crossings, series: s, cand, logged: l.candidates !== undefined, nh: l.shadow_nh ?? {} });
  }
  runs.sort((a, b) => a.ts - b.ts || a.station.localeCompare(b.station));

  // events: gauge-step crossings in the clean series
  const events = [];
  for (const [st, s] of Object.entries(series)) {
    for (const t of THRESHOLDS) {
      const L = steps[st]?.[t];
      if (L == null) continue;
      let lastEv = -Infinity;
      for (let i = 1; i < s.clean.length; i++) {
        if (s.clean[i - 1].level < L && s.clean[i].level >= L) {
          const ts = s.clean[i].ts;
          if (ts - lastEv < SAME_EVENT_MS) { lastEv = ts; continue; }
          lastEv = ts;
          events.push({ station: st, threshold: t, ts, day: colomboDay(ts), levelFt: L });
        }
      }
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  const ctx = { runs, events, series, near, steps, units, versions, _pools: {} };
  // the version live and the storm flag at the event (from the last fitted-model run before it): spec 2 attributes events to scopes with these
  const pool = poolOf(ctx, "live", () => true);
  for (const e of events) {
    const rs = pool.get(e.station);
    const i = rs ? lastBefore(rs, e.ts) : -1;
    e.version = i >= 0 ? rs[i].version : versionAt(versions, { issued_at: e.ts });
    e.stormAtEvent = i >= 0 ? !!rs[i].storm : false;
  }
  return ctx;
}

/** Index of the last element of a ts-sorted list with ts < t (-1 when none). */
function lastBefore(rs, t) {
  let lo = 0, hi = rs.length - 1, i = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rs[mid].ts < t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
  return i;
}

/** Fitted-model runs that can be scored, per station, in time order; `pred` narrows them further. Cached on the context by key. */
export function poolOf(ctx, key, pred) {
  if (ctx._pools[key]) return ctx._pools[key];
  const m = new Map();
  for (const r of ctx.runs) if (r.usable && !r.flagged && !r.noForecast && r.model && pred(r)) (m.get(r.station) ?? m.set(r.station, []).get(r.station)).push(r);
  return (ctx._pools[key] = m);
}

export function phaseOf(rate3Ft) {
  if (rate3Ft == null || !Number.isFinite(rate3Ft)) return null;
  if (rate3Ft > 0.1) return "rising";
  if (rate3Ft > 0.02) return "slow rise";
  if (rate3Ft >= -0.02) return "calm";
  if (rate3Ft >= -0.1) return "slow fall";
  return "falling";
}

/** The version live at a run's issue time: the latest entry whose `from` is not after it (and whose modelVersion matcher, if any, fits). */
export function versionAt(versions, line) {
  let best = null;
  for (const v of versions) {
    if (Date.parse(v.from) > line.issued_at) continue;
    if (v.modelVersion && !new RegExp(v.modelVersion).test(line.model_version ?? "")) continue;
    if (!best || Date.parse(v.from) >= Date.parse(best.from)) best = v;
  }
  return best?.id ?? null;
}

/**
 * The run's crossings as a warning-candidate variant would have shown them: the variant's shown chance replaces the live one (a step the live
 * run did not list is added from the gauge's known step level while the river is still below it). variant null or no entry = live as it was.
 */
export function crossingsFor(ctx, r, variant) {
  const cand = variant ? r.cand?.[variant] : null;
  if (!cand) return r.crossings;
  const out = r.crossings.map((c) => (cand[c.t] != null ? { ...c, shown: cand[c.t] } : c));
  for (const [t, shown] of Object.entries(cand)) {
    if (out.some((c) => c.t === t)) continue;
    const lvl = ctx.steps[r.station]?.[t];
    if (lvl != null && lvl > r.cur) out.push({ t, lvl, shown });
  }
  return out;
}

/**
 * True when the river reached `lvl` (ft) in the 24 h after the run; false when it did not and readings cover the window; null = cannot tell yet.
 * Spec 1 (reach "strict"): covered = a clean reading at or after run + 23 h. Spec 2 (reach "bracket"): also covered when the last reading inside the
 * window is at or after run + 22 h and the next reading is beyond 24 h (the readings bracket the window).
 */
export function reachedWithin24h(ctx, run, lvl, spec = SPEC1) {
  const s = ctx.series[run.station];
  if (!s) return run.line.max24 != null && run.line.cover24 ? run.line.max24 * unitK(run.unit) >= lvl : null; // no readings file: the stored max
  let last = -Infinity, beyond = false;
  const c = s.clean;
  let lo = 0, hi = c.length; // first index with ts > run.ts
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid].ts <= run.ts) lo = mid + 1; else hi = mid; }
  for (let k = lo; k < c.length; k++) {
    const p = c[k];
    if (p.ts > run.ts + 24 * HOUR) { beyond = true; break; }
    if (p.level >= lvl) return true;
    last = p.ts;
  }
  if (last >= run.ts + 23 * HOUR) return false;
  if (spec.reach === "bracket" && beyond && last >= run.ts + 22 * HOUR) return false;
  return null;
}

// ---------------------------------------------------------------- KPI helpers

const kpi = (id, key, o) => ({ id, key, value: null, unit: "%", target: null, met: null, n: 0, parts: [], detail: {}, ...o });
const judged = (n, min) => n >= min;

const scorable = (r) => r.usable && !r.flagged && !r.noForecast;

// 1 ------------------------------------------------------------
/**
 * One event against the fitted-model runs of its gauge (`rs`, time order). null = not scored (no fitted-model run in the 3 h before it).
 * Reads: lead = crossing time minus the start of the unbroken stretch of runs showing >= 20% that ends at the last run before it.
 * `reason` (why a strict miss missed): jitter (within 0.25 h of the need), never-warned (no run in the window showed 20%), dip (a run below 20%
 * inside the window after one at or above it), run-gap (the stretch ended at a gap of more than 3 h between runs), late-start (20% only from part
 * way into the window). `truncated` = the runs ran out before the stretch / window started, so the lead may be understated.
 */
export function analyseEvent(ctx, rs, e, variant, spec = SPEC1) {
  const T = TARGETS.warned;
  const i = lastBefore(rs, e.ts);
  if (i < 0 || e.ts - rs[i].ts > GAP_MS) return null; // no fitted-model run just before: not scored
  const shownAt = (r) => crossingsFor(ctx, r, variant).find((c) => c.t === e.threshold)?.shown ?? 0;
  let lead = 0, j = i, ended = null;
  if (shownAt(rs[i]) >= POSSIBLE_P) {
    for (;;) {
      if (j - 1 < 0) { ended = "start"; break; }
      if (rs[j].ts - rs[j - 1].ts > GAP_MS) { ended = "gap"; break; }
      if (shownAt(rs[j - 1]) < POSSIBLE_P) { ended = "low"; break; }
      j--;
    }
    lead = (e.ts - rs[j].ts) / HOUR;
  }
  const fast = isShortForecastGauge(e.station);
  const need = fast ? T.leadFastH : e.threshold === "alert" ? T.leadBigAlertH : T.leadBigOtherH;
  const caughtStrict = lead >= need, caughtTol = lead >= need - JITTER_TOL_H;
  // the window = the runs in the lead time before the event
  const ws = e.ts - need * HOUR, W = [];
  for (let k = i; k >= 0 && rs[k].ts >= ws; k--) W.unshift(shownAt(rs[k]));
  let reason = null;
  if (!caughtStrict) {
    if (caughtTol) reason = "jitter";
    else if (!W.some((x) => x >= POSSIBLE_P)) reason = "never-warned";
    else {
      let high = false, dip = false;
      for (const x of W) { if (x >= POSSIBLE_P) high = true; else if (high) dip = true; }
      reason = dip ? "dip" : ended === "gap" ? "run-gap" : "late-start";
    }
  }
  let firstShownAt = null;
  for (let k = i; k >= 0 && rs[k].ts >= e.ts - 48 * HOUR; k--) if (shownAt(rs[k]) >= POSSIBLE_P) firstShownAt = rs[k].ts; // earliest such run: keeps overwriting while walking back
  const last = rs[i];
  return {
    ...e, lead, leadH: r1(lead), needH: need, caught: spec.leadTolH ? lead >= need - spec.leadTolH : caughtStrict, caughtStrict, caughtTol, fast, storm: last.storm,
    reason, firstShownAt, minShown: W.length ? Math.min(...W) : null, runsInWindow: W.length, shownLast: shownAt(last),
    rawLast: last.line.crossings?.find((c) => c.threshold === e.threshold)?.probability ?? null, version: last.version,
    // the 48 h of firstShownAt count too: runs that begin after e.ts - 48 h mean the look-back is cut short (window edge or archive start)
    truncated: ended === "start" || rs[0].ts > Math.min(ws, e.ts - 48 * HOUR),
  };
}

function kpiWarned(ctx, runs, events, variant = null, spec = SPEC1, pool = null) {
  const T = TARGETS.warned;
  let byStation = pool;
  if (!byStation) {
    byStation = new Map(); // the scope's own runs only (spec 1): a stretch is cut at the scope's edge
    for (const r of runs) if (scorable(r) && r.model) (byStation.get(r.station) ?? byStation.set(r.station, []).get(r.station)).push(r);
  }
  const out = [];
  for (const e of events) {
    const rs = byStation.get(e.station);
    if (!rs) continue;
    const a = analyseEvent(ctx, rs, e, variant, spec);
    if (a) out.push(a);
  }
  const n = out.length, caught = out.filter((x) => x.caught).length;
  const byStep = {};
  for (const t of THRESHOLDS) {
    const x = out.filter((e) => e.threshold === t);
    byStep[t] = { n: x.length, caught: x.filter((e) => e.caught).length };
  }
  const v = pct(caught, n), vx = rawPct(caught, n);
  const met = judged(n, T.min) ? cmp(spec, v, vx) >= T.caught : null;
  return kpi(1, "warned", {
    value: v, target: T.caught, targetText: `at least ${T.caught}% warned in time`, n, met,
    parts: [{ key: "caught", value: v, target: T.caught, n, met, _clusters: n }],
    detail: {
      events: n, caught, medianLeadH: r1(median(out.map((x) => x.leadH))), medianLeadWhenCaughtH: r1(median(out.filter((x) => x.caught).map((x) => x.leadH))), byStep,
      leadNeeded: { bigAlertH: T.leadBigAlertH, bigOtherH: T.leadBigOtherH, fastH: T.leadFastH },
      list: out.slice(-40).map((x) => ({ station: x.station, step: x.threshold, at: new Date(x.ts).toISOString(), leadH: x.leadH, needH: x.needH, caught: x.caught })),
    },
  });
}

// 2 ------------------------------------------------------------
function kpiFalseAlarms(ctx, runs, variant = null, spec = SPEC1) {
  const T = TARGETS.falseAlarms;
  const groups = new Map();
  const gaugeDays = new Set();
  for (const r of runs) {
    if (!scorable(r) || !r.model) continue;
    gaugeDays.add(`${r.station}|${r.day}`);
    for (const c of crossingsFor(ctx, r, variant)) {
      if (c.lvl <= r.cur || c.shown < POSSIBLE_P) continue;
      const k = `${r.station}|${c.t}|${r.day}`;
      const g = groups.get(k) ?? groups.set(k, { station: r.station, step: c.t, day: r.day, runs: [] }).get(k);
      g.runs.push({ r, c });
    }
  }
  const cls = { possible: { n: 0, didNot: 0 }, likely: { n: 0, didNot: 0 } };
  for (const g of groups.values()) {
    const maxShown = Math.max(...g.runs.map((x) => x.c.shown));
    const kind = maxShown >= LIKELY_P ? "likely" : "possible";
    const first = g.runs.find((x) => x.c.shown >= (kind === "likely" ? LIKELY_P : POSSIBLE_P));
    const hit = reachedWithin24h(ctx, first.r, first.c.lvl, spec);
    if (hit == null) continue;
    cls[kind].n++;
    if (!hit) cls[kind].didNot++;
  }
  const pp = pct(cls.possible.didNot, cls.possible.n), pl = pct(cls.likely.didNot, cls.likely.n);
  const metP = judged(cls.possible.n, T.min) ? cmp(spec, pp, rawPct(cls.possible.didNot, cls.possible.n)) <= T.possibleMaxPct : null;
  const metL = judged(cls.likely.n, T.min) ? cmp(spec, pl, rawPct(cls.likely.didNot, cls.likely.n)) <= T.likelyMaxPct : null;
  const falseAlarms = cls.possible.didNot + cls.likely.didNot;
  return kpi(2, "falseAlarms", {
    value: pp, target: T.possibleMaxPct, targetText: `at most ${T.possibleMaxPct}% of "possible" and ${T.likelyMaxPct}% of "likely" warnings fail to happen`,
    n: cls.possible.n + cls.likely.n,
    met: metP == null && metL == null ? null : metP !== false && metL !== false,
    parts: [
      { key: "possible", value: pp, target: T.possibleMaxPct, n: cls.possible.n, met: metP, _clusters: cls.possible.n },
      { key: "likely", value: pl, target: T.likelyMaxPct, n: cls.likely.n, met: metL, _clusters: cls.likely.n },
    ],
    detail: { falseAlarms, gaugeDays: gaugeDays.size, falseAlarmsPerGaugeDay: gaugeDays.size ? r2(falseAlarms / gaugeDays.size) : null, possible: cls.possible, likely: cls.likely },
  });
}

// 3 ------------------------------------------------------------
function kpiHonest(ctx, runs, variant = null, spec = SPEC1) {
  const T = TARGETS.honest;
  const cases = [];
  for (const r of runs) {
    if (!scorable(r) || !r.model) continue;
    for (const c of crossingsFor(ctx, r, variant)) {
      if (c.lvl <= r.cur) continue;
      const hit = reachedWithin24h(ctx, r, c.lvl, spec);
      if (hit == null) continue;
      cases.push({ p: c.shown, hit, k: `${r.station}|${c.t}|${r.day}` });
    }
  }
  const bins = PROB_BINS.map(([a, b]) => {
    const x = cases.filter((c) => c.p >= a && c.p < b);
    const shown = x.length ? 100 * mean(x.map((c) => c.p)) : null, obs = x.length ? 100 * mean(x.map((c) => (c.hit ? 1 : 0))) : null;
    const ok = x.length >= T.minBin ? Math.abs(obs - shown) <= T.withinPts : null;
    return { from: a, to: Math.min(b, 1), n: x.length, shownPct: r1(shown), observedPct: r1(obs), met: ok, clusters: distinct(x, (c) => c.k) };
  });
  const evald = bins.filter((b) => b.met != null);
  const okN = evald.filter((b) => b.met).length;
  return kpi(3, "honest", {
    value: evald.length ? pct(okN, evald.length) : null, target: T.withinPts, targetText: `within ${T.withinPts} points in every group with ${T.minBin}+ cases`, n: cases.length,
    met: evald.length ? okN === evald.length : null,
    parts: bins.map((b) => ({ key: `${Math.round(b.from * 100)}-${Math.round(b.to * 100)}`, value: b.observedPct, shown: b.shownPct, target: T.withinPts, n: b.n, met: b.met, _clusters: b.clusters })),
    detail: { bins: bins.map(({ clusters, ...b }) => b), groupsJudged: evald.length, groupsOk: okN },
  });
}

// 4, 5, 6 -------------------------------------------------------
/** Scored rows (feet): fitted-model runs, horizons the site shows, with a matched reading. `variant` null = live. */
function scoredRows(runs, variant) {
  const rows = [];
  for (const r of runs) {
    if (!scorable(r) || !r.model) continue;
    for (const h of HORIZONS) {
      if (r.short && h > FAST_MAX_H) continue; // the site shows these gauges only up to 6 h
      const live = r.hx[h];
      if (!live || live.y == null) continue;
      const p = variant == null ? live : r.sh[variant]?.[h];
      if (!p) continue;
      rows.push({ h, phase: r.phase, p: p.p, low: p.low, high: p.high, y: live.y, c: r.cur, k: `${r.station}|${r.day}`, st: r.station, day: r.day });
    }
  }
  return rows;
}
const skillOf = (rows) => {
  if (!rows.length) return null;
  const mae = mean(rows.map((r) => Math.abs(r.y - r.p))), pers = mean(rows.map((r) => Math.abs(r.y - r.c)));
  return pers > 0 ? 100 * (1 - mae / pers) : null;
};

function kpiSkill(rows, spec = SPEC1) {
  const T = TARGETS.skill;
  const parts = [];
  for (const h of HORIZONS) {
    const R = rows.filter((r) => r.h === h), sx = skillOf(R), s = r1(sx);
    parts.push({ key: `h${h}`, value: s, target: T[h], n: R.length, met: R.length >= T.min && s != null ? cmp(spec, s, sx) >= T[h] : null, _clusters: distinct(R, (r) => r.k) });
  }
  const phases = {};
  for (const ph of PHASES) {
    // equal weight per horizon, so the long horizons' big errors do not swamp the short ones; a horizon counts with 10+ cases
    const per = HORIZONS.map((h) => rows.filter((r) => r.phase === ph && r.h === h)).filter((R) => R.length >= 10).map((R) => skillOf(R)).filter((s) => s != null);
    phases[ph] = { n: rows.filter((r) => r.phase === ph).length, skill: per.length ? r1(mean(per)) : null, horizons: per.length, _exact: per.length ? mean(per) : null };
  }
  const phaseVals = Object.values(phases).filter((p) => p.skill != null);
  const worst = phaseVals.length ? Math.min(...phaseVals.map((p) => p.skill)) : null;
  const worstX = phaseVals.length ? Math.min(...phaseVals.map((p) => p._exact)) : null;
  parts.push({ key: "worstPhase", value: worst, target: T.phaseMin, n: phaseVals.reduce((s, p) => s + p.n, 0), met: worst == null ? null : cmp(spec, worst, worstX) >= T.phaseMin, _clusters: distinct(rows, (r) => r.k) });
  const judgedParts = parts.filter((p) => p.met != null);
  const six = parts.find((p) => p.key === "h6");
  return kpi(4, "skill", {
    value: six.value, target: T[6], targetText: "beats \"no change\" by 30% at 1-6 h, 20% at 12 h, 10% at 24 h, and in every kind of river movement", n: rows.length,
    met: judgedParts.length ? judgedParts.every((p) => p.met) : null, parts, detail: { phases },
  });
}

function kpiBias(rows, spec = SPEC1) {
  const T = TARGETS.bias;
  const R12 = rows.filter((r) => r.h === 12);
  const parts = [];
  for (const ph of PHASES) {
    const R = R12.filter((r) => r.phase === ph);
    const bx = R.length ? mean(R.map((r) => r.p - r.y)) : null, b = r2(bx);
    parts.push({ key: ph, value: b, target: T.withinFt, n: R.length, met: R.length >= T.min && b != null ? Math.abs(cmp(spec, b, bx)) <= T.withinFt : null, _clusters: distinct(R, (r) => r.k) });
  }
  const evald = parts.filter((p) => p.met != null);
  const all = R12.length ? r2(mean(R12.map((r) => r.p - r.y))) : null;
  return kpi(5, "bias", {
    value: all, unit: "ft", target: T.withinFt, targetText: "12 h forecast within 0.25 ft of reality on average, in every kind of river movement", n: R12.length,
    met: evald.length ? evald.every((p) => p.met) : null, parts,
  });
}

function kpiCoverage(rows, spec = SPEC1) {
  const T = TARGETS.coverage;
  const parts = [];
  for (const h of HORIZONS) {
    const R = rows.filter((r) => r.h === h && r.low != null && r.high != null);
    const inside = R.filter((r) => r.y >= r.low && r.y <= r.high).length, c = R.length ? pct(inside, R.length) : null, cx = rawPct(inside, R.length), cv = cmp(spec, c, cx);
    parts.push({ key: `h${h}`, value: c, target: `${T.lo}-${T.hi}`, n: R.length, met: R.length >= T.min && c != null ? cv >= T.lo && cv <= T.hi : null, _clusters: distinct(R, (r) => r.k) });
  }
  const evald = parts.filter((p) => p.met != null);
  const all = rows.filter((r) => r.low != null && r.high != null);
  return kpi(6, "coverage", {
    value: all.length ? pct(all.filter((r) => r.y >= r.low && r.y <= r.high).length, all.length) : null, target: `${T.lo}-${T.hi}`,
    targetText: "the stated 80% range holds the real level 75-85% of the time at every horizon", n: all.length,
    met: evald.length ? evald.every((p) => p.met) : null, parts,
  });
}

// 7, 8 ----------------------------------------------------------
function nextHourCalls(ctx, runs, variant) {
  const out = [];
  for (const r of runs) {
    if (!scorable(r) || r.tidal) continue;
    const h1 = variant == null ? r.hx[1]?.p : r.sh[variant]?.[1]?.p;
    const h1ChangeM = h1 == null ? null : (h1 - r.cur) * FT;
    const prev = r.ts >= RISE_OVERRIDE_SINCE ? ctx.near(r.station, r.ts - HOUR) : null; // the card's last-hour override, from when it went live
    const rate1hM = typeof prev === "number" ? (r.cur - prev) * FT : null;
    // a full-system variant can carry its own next-hour rate (m/h): that is its call
    const own = variant == null ? null : r.nh?.[variant];
    const rateM = typeof own === "number" && Number.isFinite(own) ? own : nextHourRateM({ h1ChangeM, rate3hM: r.rate3 == null ? null : r.rate3 * FT, source: null, method: r.method, rate1hM, tidal: !!r.tidal, measuredForAll: r.ts >= NEXT_HOUR_MEASURED_SINCE, measuredWins: r.ts >= NEXT_HOUR_MEASURED_WINS_SINCE });
    if (rateM == null) continue;
    const next = ctx.near(r.station, r.ts + HOUR);
    if (typeof next !== "number") continue;
    out.push({ rising: rateM > STEADY_M_PER_H, rise: next - r.cur, k: `${r.station}|${r.day}` });
  }
  return out;
}
function kpiFastRises(calls, spec = SPEC1) {
  const T = TARGETS.fastRises;
  const fast = calls.filter((c) => c.rise >= RISE_BIG_FT);
  const called = fast.filter((c) => c.rising).length;
  const v = pct(called, fast.length);
  const met = judged(fast.length, T.min) ? cmp(spec, v, rawPct(called, fast.length)) >= T.pct : null;
  return kpi(7, "fastRises", { value: v, target: T.pct, targetText: `at least ${T.pct}% of rises of 10 cm or more in an hour were called Rising`, n: fast.length, met, parts: [{ key: "called", value: v, target: T.pct, n: fast.length, met, _clusters: distinct(fast, (c) => c.k), _runs: calls.length }] });
}
function kpiRisingRight(calls, spec = SPEC1) {
  const T = TARGETS.risingRight;
  const rc = calls.filter((c) => c.rising);
  const right = rc.filter((c) => c.rise >= RISE_ANY_FT).length;
  const v = pct(right, rc.length);
  const met = judged(rc.length, T.min) ? cmp(spec, v, rawPct(right, rc.length)) >= T.pct : null;
  return kpi(8, "risingRight", { value: v, target: T.pct, targetText: `at least ${T.pct}% of Rising calls were followed by a rise`, n: rc.length, met, parts: [{ key: "right", value: v, target: T.pct, n: rc.length, met, _clusters: distinct(rc, (c) => c.k), _runs: calls.length }] });
}

/** One run per station-hour (Colombo clock), the latest: gauges that were run twice in an hour count once (audit C9). */
export function dedupeRuns(runs) {
  const m = new Map();
  for (const r of runs) {
    const k = `${r.station}|${Math.floor((r.ts + 5.5 * HOUR) / HOUR)}`;
    const o = m.get(k);
    if (!o || r.ts >= o.ts) m.set(k, r);
  }
  return runs.filter((r) => m.get(`${r.station}|${Math.floor((r.ts + 5.5 * HOUR) / HOUR)}`) === r);
}

// 9 -------------------------------------------------------------
function kpiInputs(allRuns, today) {
  const T = TARGETS.inputs;
  const byDay = new Map();
  for (const r of allRuns) {
    const d = byDay.get(r.day) ?? byDay.set(r.day, { hours: new Map(), n: 0 }).get(r.day);
    const h = new Date(r.ts + 5.5 * HOUR).getUTCHours();
    (d.hours.get(h) ?? d.hours.set(h, new Set()).get(h)).add(r.station);
    d.n++;
  }
  const complete = [...byDay.entries()].filter(([d]) => today == null || d < today);
  const hoursPerDay = complete.map(([, d]) => d.hours.size);
  const perHour = complete.flatMap(([, d]) => [...d.hours.values()].map((s) => s.size));
  const flagged = allRuns.filter((r) => r.flagged).length;
  const medHours = median(hoursPerDay);
  const met = hoursPerDay.length ? medHours >= T.hours && Math.min(...hoursPerDay) >= T.hours : null;
  const share = allRuns.length ? pct(flagged, allRuns.length) : null;
  return kpi(9, "inputs", {
    value: medHours, unit: "hours", target: T.hours, targetText: "forecasts in all 24 hours of every day", n: hoursPerDay.length, met,
    parts: [
      { key: "hours", value: medHours, target: T.hours, n: hoursPerDay.length, met, worst: hoursPerDay.length ? Math.min(...hoursPerDay) : null, _clusters: hoursPerDay.length, _runs: allRuns.length },
      { key: "gaugesPerHour", value: median(perHour), target: null, n: perHour.length, met: null, _clusters: perHour.length, _runs: allRuns.length },
      { key: "flaggedShare", value: share, target: null, n: allRuns.length, met: null, _clusters: allRuns.length, _runs: allRuns.length },
    ],
    detail: { runs: allRuns.length, flaggedRuns: flagged },
  });
}

// 10 ------------------------------------------------------------
function kpiPeople(rows, fallback, spec = SPEC1) {
  const T = TARGETS.people;
  let yes = 0, worse = 0, better = 0, source = "answers";
  if (rows) {
    for (const r of rows) { if (r.answer === "yes") yes++; else if (r.answer === "worse") worse++; else if (r.answer === "better") better++; }
  } else if (fallback?.n) {
    // published aggregate only (accuracy/latest.json): no per-day or per-version split
    const n = fallback.n;
    yes = Math.round(((fallback.agreePct ?? 0) / 100) * n); worse = Math.round(((fallback.worsePct ?? 0) / 100) * n); better = Math.round(((fallback.betterPct ?? 0) / 100) * n);
    source = "published";
  }
  const j = yes + worse + better, v = pct(yes, j);
  const met = judged(j, T.min) && v != null ? cmp(spec, v, rawPct(yes, j)) >= T.pct : null;
  return kpi(10, "people", { value: v, target: T.pct, targetText: `at least ${T.pct}% of people say the forecast matches what they see`, n: j, met, parts: [{ key: "agree", value: v, target: T.pct, n: j, met, _clusters: j, _runs: null }], detail: { yes, worse, better, source } });
}

// ---------------------------------------------------------------- KPI sets

const modelRuns = (runs) => runs.filter((r) => scorable(r) && r.model);
/** Fills `_runs` (runs behind a number: the scope's scorable fitted-model runs unless the KPI says otherwise) on every part. */
function tagRuns(kpis, nRuns) {
  for (const k of kpis) for (const p of k.parts) if (p._runs === undefined) p._runs = nRuns;
  return kpis;
}
const withBaseline = (k, b, runsLogged) => ({
  ...k,
  baseline: { value: b.value, n: b.n, met: b.met, parts: b.parts.map((p) => ({ key: p.key, value: p.value, n: p.n, met: p.met })), detail: b.detail },
  ...(runsLogged == null ? {} : { runsLogged }),
});

/**
 * All ten KPIs for a set of runs.
 * @param ctx buildContext() result
 * @param opts { sel: (run) => boolean, events: event[], feedback?: {answer}[]|null, feedbackFallback?, today?: "YYYY-MM-DD", variant?: string|null, spec?: SPEC1|SPEC2 }
 */
export function kpiSet(ctx, { sel = () => true, events = ctx.events, feedback = null, feedbackFallback = null, today = null, variant = null, spec = SPEC1 } = {}) {
  const runs = ctx.runs.filter(sel);
  if (variant && ctx.runs.some((r) => r.cand?.[variant])) {
    // a warning-rule candidate (lib/warningCandidates.mjs): KPIs 1-3 with the run's shown chance replaced, over the runs whose day carried the
    // candidate log. `baseline` = live on exactly the same runs, so the two are comparable.
    const vr = runs.filter((r) => r.logged);
    const pool = spec.lookAll ? poolOf(ctx, "logged", (r) => r.logged) : null;
    const mk = (v) => tagRuns([kpiWarned(ctx, vr, events, v, spec, pool), kpiFalseAlarms(ctx, vr, v, spec), kpiHonest(ctx, vr, v, spec)], modelRuns(vr).length);
    const base = mk(null);
    return mk(variant).map((k, i) => withBaseline(k, base[i], vr.length));
  }
  if (variant) {
    const vr = runs.filter((r) => r.sh?.[variant]);
    const rows = scoredRows(vr, variant), calls = nextHourCalls(ctx, spec.dedupe ? dedupeRuns(vr) : vr, variant);
    return tagRuns([kpiSkill(rows, spec), kpiBias(rows, spec), kpiCoverage(rows, spec), kpiFastRises(calls, spec), kpiRisingRight(calls, spec)], modelRuns(vr).length);
  }
  const callRuns = spec.dedupe ? dedupeRuns(runs) : runs;
  const rows = scoredRows(runs, null), calls = nextHourCalls(ctx, callRuns, null);
  const pool = spec.lookAll ? poolOf(ctx, "live", () => true) : null;
  return tagRuns([
    kpiWarned(ctx, runs, events, null, spec, pool), kpiFalseAlarms(ctx, runs, null, spec), kpiHonest(ctx, runs, null, spec), kpiSkill(rows, spec), kpiBias(rows, spec), kpiCoverage(rows, spec),
    kpiFastRises(calls, spec), kpiRisingRight(calls, spec), kpiInputs(callRuns, today), kpiPeople(feedback, feedbackFallback, spec),
  ], modelRuns(runs).length);
}

/** Variant names that carry BOTH shadow levels and warning-candidate chances: scored as one system (KPIs 1-8) by systemSet. */
export const systemsOf = (lines) => {
  const sh = new Set(lines.flatMap((l) => Object.keys(l.shadows ?? {}))), cand = new Set(lines.flatMap((l) => Object.keys(l.candidates ?? {})));
  return [...sh].filter((v) => cand.has(v)).sort();
};

/**
 * A full-system variant scored as ONE system on KPIs 1-8: its warning chances (runs with no candidate row for a step show the live chance) for KPIs
 * 1-3, its shadow levels for 4-6, its own next-hour rate (`shadow_nh`, else the rate derived from its 1 h level) for 7-8. Over the runs that carry the
 * variant's shadow levels. Each KPI has `baseline` = live on exactly the same runs. A variant that copies live scores exactly like live.
 */
export function systemSet(ctx, { sel = () => true, events = ctx.events, variant, spec = SPEC1 } = {}) {
  const runs = ctx.runs.filter(sel).filter((r) => r.sh?.[variant]);
  const pool = spec.lookAll ? poolOf(ctx, `sys:${variant}`, (r) => r.sh?.[variant]) : null;
  const callRuns = spec.dedupe ? dedupeRuns(runs) : runs;
  const mk = (v) => {
    const rows = scoredRows(runs, v), calls = nextHourCalls(ctx, callRuns, v);
    return tagRuns([
      kpiWarned(ctx, runs, events, v, spec, pool), kpiFalseAlarms(ctx, runs, v, spec), kpiHonest(ctx, runs, v, spec),
      kpiSkill(rows, spec), kpiBias(rows, spec), kpiCoverage(rows, spec), kpiFastRises(calls, spec), kpiRisingRight(calls, spec),
    ], modelRuns(runs).length);
  };
  const base = mk(null);
  return mk(variant).map((k, i) => withBaseline(k, base[i], runs.length));
}

/** "met X of Y": Y counts the targets with enough cases to judge. */
export function summarise(kpis) {
  const assessable = kpis.filter((k) => k.met != null);
  return { met: assessable.filter((k) => k.met).length, assessable: assessable.length, total: kpis.length, notJudged: kpis.length - assessable.length };
}

/** Variant names that appear in these lines (shadow forecasts and warning-rule candidates). */
export const variantsOf = (lines) => [...new Set(lines.flatMap((l) => [...Object.keys(l.shadows ?? {}), ...Object.keys(l.candidates ?? {})]))].sort();

/** Rows for kpi/history.csv: one per part of each KPI, for one day and scope. */
export const HISTORY_HEADER = "day,scope,kpi,part,value,target,met,n";
export function historyRows(day, scope, kpis) {
  const cell = (v) => (v == null ? "" : String(v));
  return kpis.flatMap((k) => k.parts.map((p) => [day, scope, k.key, p.key, p.value, p.target, p.met == null ? "" : p.met ? "yes" : "no", p.n].map(cell).join(",")));
}
/** Replaces the rows of this day and scope prefix set, keeps days in order. */
export function upsertHistory(text, day, rows) {
  const old = (text ?? "").split("\n").filter((l) => l && l !== HISTORY_HEADER && l.split(",")[0] !== day);
  const all = [...old, ...rows];
  all.sort((a, b) => a.split(",")[0].localeCompare(b.split(",")[0]));
  return [HISTORY_HEADER, ...all].join("\n") + "\n";
}

// ---------------------------------------------------------------- logging helpers (kpi/history-wide.csv, event ledger, per-gauge table)

/** JSON.stringify replacer: keys starting with "_" are internal (runs / clusters behind a part, exact values) and are not written to the JSON files. */
export const dropInternal = (k, v) => (typeof k === "string" && k[0] === "_" ? undefined : v);

/**
 * kpi/history-wide.csv (long format, one row per part of each KPI for a day, scope and spec). Columns: n = cases, n_runs = fitted-model runs in the scope
 * (calls for KPI 7-8, all runs for KPI 9), clusters = distinct events (KPI 1), gauge-step-days (2, 3) or gauge-days (4-8) behind the number,
 * baseline_* = live on the same runs for a warning candidate or full-system variant. Parts with no cases and no value are left out.
 */
export const WIDE_HEADER = "day,scope,spec,kpi,part,value,target,met,n,n_runs,clusters,baseline_value,baseline_n";
export function wideRows(day, scope, spec, kpis) {
  const cell = (v) => (v == null ? "" : String(v));
  const out = [];
  for (const k of kpis) {
    for (const p of k.parts) {
      if (!p.n && p.value == null) continue;
      const b = k.baseline?.parts?.find((x) => x.key === p.key);
      out.push([day, scope, spec, k.key, p.key, p.value, p.target, p.met == null ? "" : p.met ? "yes" : "no", p.n, p._runs, p._clusters, b?.value, b?.n].map(cell).join(","));
    }
  }
  return out;
}
/** True when the text already holds rows for this day. */
export const hasDayRows = (text, day) => (text ?? "").split("\n").some((l) => l && l !== WIDE_HEADER && l.split(",")[0] === day);
/**
 * Days in the first two of the window have no runs before them to look back through (KPI 1 leads and the ledger reasons are cut short), so once a day's
 * rows exist they are kept: only a night where the day was not at the edge may write them. `edge` = the day is within the look-back reach of the window start.
 */
export function upsertWideEdge(text, day, rows, edge) {
  return edge && hasDayRows(text, day) ? text : upsertWide(text, day, rows);
}
/** Replaces this day's rows (both specs, every scope), keeps days in order and the order of rows within a day. */
export function upsertWide(text, day, rows) {
  const old = (text ?? "").split("\n").filter((l) => l && l !== WIDE_HEADER);
  const keep = old.filter((l) => l.split(",")[0] !== day);
  const idx = new Map(); // day -> rows, stable
  for (const l of [...keep, ...rows]) { const d = l.split(",")[0]; (idx.get(d) ?? idx.set(d, []).get(d)).push(l); }
  return [WIDE_HEADER, ...[...idx.keys()].sort().flatMap((d) => idx.get(d))].join("\n") + "\n";
}

/**
 * The permanent event ledger: one record per event (gauge-step crossing) in `events`, looked back through ALL runs (across midnight, versions and
 * scopes), so a day's events are free of per-day truncation. `caught` is the spec 1 rule (lead >= need), `caughtTol` the spec 2 rule (0.25 h),
 * `reason` says why a strict miss missed (see analyseEvent), `scored` false = no fitted-model run in the 3 h before.
 */
export function ledgerRecords(ctx, events = ctx.events) {
  const pool = poolOf(ctx, "live", () => true);
  return events.map((e) => {
    const base = { station: e.station, step: e.threshold, ts: e.ts, at: new Date(e.ts).toISOString(), day: e.day, fast: isShortForecastGauge(e.station), version: e.version ?? null };
    const rs = pool.get(e.station);
    const a = rs ? analyseEvent(ctx, rs, e, null, SPEC1) : null;
    if (!a) {
      const T = TARGETS.warned;
      // "unscored" can also mean the window ended before the runs that would have scored it: flag that so it never replaces a stored scored record
      const first = rs?.length ? rs[0].ts : ctx.runs.reduce((m, r) => Math.min(m, r.ts), Infinity);
      return { ...base, needH: base.fast ? T.leadFastH : e.threshold === "alert" ? T.leadBigAlertH : T.leadBigOtherH, scored: false, leadH: null, caught: null, caughtTol: null, reason: "unscored", truncated: first > e.ts - 48 * HOUR };
    }
    return {
      ...base, version: a.version ?? base.version, needH: a.needH, scored: true, leadH: a.leadH, caught: a.caughtStrict, caughtTol: a.caughtTol, reason: a.reason,
      firstShownAt: a.firstShownAt == null ? null : new Date(a.firstShownAt).toISOString(), minShown: a.minShown, runsInWindow: a.runsInWindow, shownLast: a.shownLast, rawLast: a.rawLast,
      storm: !!a.storm, truncated: a.truncated,
    };
  });
}
export const ledgerKey = (r) => `${r.station}|${r.step}|${r.ts}`;
export const ledgerMonth = (ts) => colomboDay(ts).slice(0, 7);
/**
 * Merges records into a month's JSONL text. Idempotent: the same key replaces its line; a record whose look-back ran out (`truncated`) never replaces one
 * already stored. Lines are kept in time order.
 */
export function parseLedger(text) {
  const map = new Map();
  for (const l of (text ?? "").split("\n")) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); map.set(ledgerKey(r), r); } catch { /* skip a damaged line rather than fail the night */ }
  }
  return map;
}
export function upsertLedger(text, records) {
  const map = parseLedger(text);
  for (const r of records) {
    const old = map.get(ledgerKey(r));
    // a record whose look-back ran out never replaces a stored one: the window only moves forward, so the stored one saw at least as much
    if (old && r.truncated) continue;
    map.set(ledgerKey(r), r);
  }
  const all = [...map.values()].sort((a, b) => a.ts - b.ts || a.station.localeCompare(b.station) || a.step.localeCompare(b.step));
  return all.length ? all.map((r) => JSON.stringify(r)).join("\n") + "\n" : "";
}

/** kpi/gauges/YYYY-MM-DD.csv: one row per gauge that ran that day (spec 1 populations: fitted-model runs, no de-duplication). */
export const GAUGE_HEADER = ["day", "station", "runs", "flagged_runs", "events", "caught", "caught_tol", ...HORIZONS.flatMap((h) => [`n_${h}`, `mae_${h}`, `nochange_mae_${h}`, `cov_${h}`]), "bias_12", "rises", "rises_called", "rising_calls", "rising_right"].join(",");
export function gaugeTable(ctx, day, ledger = []) {
  const runs = ctx.runs.filter((r) => r.day === day);
  const stations = [...new Set(runs.map((r) => r.station))].sort();
  const cell = (v) => (v == null || (typeof v === "number" && !Number.isFinite(v)) ? "" : String(v));
  const lines = [GAUGE_HEADER];
  for (const st of stations) {
    const mine = runs.filter((r) => r.station === st);
    const rows = scoredRows(mine, null), calls = nextHourCalls(ctx, mine, null);
    const ev = ledger.filter((e) => e.station === st && e.day === day);
    const fast = calls.filter((c) => c.rise >= RISE_BIG_FT), rc = calls.filter((c) => c.rising);
    const row = [day, st, mine.length, mine.filter((r) => r.flagged).length, ev.length, ev.filter((e) => e.caught === true).length, ev.filter((e) => e.caughtTol === true).length];
    for (const h of HORIZONS) {
      const R = rows.filter((r) => r.h === h), C = R.filter((r) => r.low != null && r.high != null);
      row.push(R.length, R.length ? r2(mean(R.map((r) => Math.abs(r.y - r.p)))) : null, R.length ? r2(mean(R.map((r) => Math.abs(r.y - r.c)))) : null, C.length ? pct(C.filter((r) => r.y >= r.low && r.y <= r.high).length, C.length) : null);
    }
    const R12 = rows.filter((r) => r.h === 12);
    row.push(R12.length ? r2(mean(R12.map((r) => r.p - r.y))) : null, fast.length, fast.filter((c) => c.rising).length, rc.length, rc.filter((c) => c.rise >= RISE_ANY_FT).length);
    lines.push(row.map((v, i) => (i === 1 ? (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v) : cell(v))).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Per-day coverage diagnostics: which gauges ran, had readings and steps, how much of the expected gauge-hours is present, duplicate station-hours. */
export function dayCoverage(ctx, day, expectedStations) {
  const runs = ctx.runs.filter((r) => r.day === day);
  const st = new Set(runs.map((r) => r.station));
  const a = dayStart(day), b = a + 24 * HOUR;
  const withReadings = [...st].filter((s) => ctx.series[s]?.raw.some((p) => p.ts >= a && p.ts < b)).length;
  const withSteps = [...st].filter((s) => ctx.steps[s] && Object.keys(ctx.steps[s]).length).length;
  const hourKeys = new Set(runs.map((r) => `${r.station}|${Math.floor((r.ts + 5.5 * HOUR) / HOUR)}`));
  const exp = expectedStations || st.size;
  return {
    stationsWithRuns: st.size, stationsWithReadings: withReadings, stationsWithSteps: withSteps, stationsExpected: exp,
    gaugeHoursPresent: hourKeys.size, gaugeHoursExpected: exp * 24, gaugeHourShare: exp ? r1((100 * hourKeys.size) / (exp * 24)) : null,
    duplicateStationHours: runs.length - hourKeys.size,
  };
}

/** Days of [from, to] with no file in a folder, counted from the first day the folder has anything (a folder that has not started yet is not "missing"). */
export function missingDays(present, from, to, allDays) {
  const first = [...present].sort()[0] ?? null;
  return { firstDay: first, missing: first ? allDays.filter((d) => d >= first && d >= from && d <= to && !present.has(d)) : [] };
}

// ================================================================================================================================
// SPEC 3 (owner-approved 13 Nov 2026): the warning rules a better forecast can actually meet, computed SIDE BY SIDE with spec 1 and spec 2
// (kpi/v3/latest.json, kpi/v3/days/*.json). Nothing above this line reads anything below it, and the page does not read it.
//
// Two layers, never mixed in one sentence:
//  LAB YARDSTICK "Notice": the share of floods that had a warning line on a fixed allowance of false-warning time. A comparison scale, not
//    "the share of rises we warned". Per gauge and step the bar is set so warnings may be on in false-alarm hours for at most X = 2% of the
//    window's calendar hours (cadence-weighted), a warning needs a chance of at least FLOOR = 5%, and the flood is judged on the run issued
//    12 h (big rivers) or 6 h (fast rivers) before it. Inflating or deflating the chances cannot raise it: the bar moves with them.
//  PUBLIC RECORDS (what the page showed, "about 2 in 10" or more = a shown chance of 20% or more):
//    P1 Notice at fixed leads, P2 warning hours that did not come true, P3 came true per printed tier (limit hours shown apart, not judged),
//    P4 surprises. The shown chance is the archived `p_shown` where the line has it (from 12 Nov 2026) and otherwise shownChance(probability),
//    marked "recomputed" (exact for big gauges, an upper bound for fast gauges, whose 12 / 24 h horizons are hidden on the page).
//  NEXT HOUR: one number, "rise catch at 10% of false hours" (chance 10, perfect 100), plus three records R1-R3 of what the tile said.
// Everything is computed from archive lines and readings only (no network, no clock). Day files hold sufficient statistics so a rolling
// 12-month window can be summed without re-reading the archive (the Notice bar then comes from 1% bins, within about half a point).
// ================================================================================================================================
export const SPEC3 = Object.freeze({ id: 3 });
export const V3 = Object.freeze({
  X: 0.02, // false-warning allowance: share of calendar hours per gauge and step
  FLOOR: 0.05, // a warning line needs at least this chance
  CAD_CAP_H: 3, // a run stands for the hours to the next run, at most this many
  LEAD_BIG_H: 12, LEAD_FAST_H: 6, // lead of the Notice run
  LEAD_SLACK_H: 0.25, LEAD_EXTRA_H: 1.5, // lead run: issued at or before T - L + 0.25 h, no more than L + 1.5 h before T
  PUBLIC_LEADS: { big: [12, 6, 3, 1], fast: [6, 3, 1], tidal: [6, 3, 1] },
  TIER_MIN_HOURS: 300, // a printed tier is judged from this many hours
  RISE_Q: 0.1, RISE_BIN_M: 0.001,
  TARGET: { noticeBig: 45, noticeFast: 37 },
  JUDGED: { minFloods: 30, minStorms: 8, minSpanDays: 365 }, // a number is judged only with this much evidence in a rolling 12 months
  STORM_SHARE: 0.15, STORM_GAP_H: 72, // a storm holding more than 15% of the floods is judged with and without it
  HIST_BIN: 0.01,
});
export const V3_TIDAL = ["Nagalagam Street", "Peradeniya", "Thalgahagoda"];
/** Public line of a gauge: tidal (3 gauges), fast (the other short-forecast gauges) or big. */
export const v3Type = (st) => (V3_TIDAL.includes(st) ? "tidal" : isShortForecastGauge(st) ? "fast" : "big");
/** Lab class of a gauge: fast = the short-forecast gauges (tidal ones included), otherwise big. */
export const v3Class = (st) => (isShortForecastGauge(st) ? "fast" : "big");
/** Printed tiers of the page's "about N in 10" wording: [name, from, to) on the SHOWN chance. */
export const V3_TIERS = Object.freeze([["<1in10", -0.01, 0.075], ["1in10", 0.075, 0.175], ["2-4in10", 0.175, 0.475], ["5+in10", 0.475, 1.01]]);
const V3_LEVELS = THRESHOLDS;
const EPS = 1e-9;

/** Per-context cache: model runs per gauge, cadence weights, 24 h outcomes. */
function v3Pool(ctx) {
  if (ctx._v3) return ctx._v3;
  const by = poolOf(ctx, "live", () => true);
  const cad = new Map();
  for (const rs of by.values()) for (let i = 0; i < rs.length; i++) cad.set(rs[i], i + 1 < rs.length ? Math.min(V3.CAD_CAP_H, Math.max(0, (rs[i + 1].ts - rs[i].ts) / HOUR)) : 1);
  return (ctx._v3 = { by, cad, reach: new Map() });
}
function v3Reach(ctx, r, t, L) {
  const memo = v3Pool(ctx).reach;
  let m = memo.get(r);
  if (!m) memo.set(r, (m = {}));
  if (!(t in m)) m[t] = reachedWithin24h(ctx, r, L, SPEC2);
  return m[t];
}

/**
 * The line a run carried for one step: `c` = the model's chance for the lab yardstick (archived unrounded `p_model`, else the 5%-rounded
 * `probability`), `shown` = the chance the page showed (archived `p_shown`, else shownChance(probability): `shownSrc` says which). null = no line.
 */
export function v3StepLine(r, t) {
  const x = (r.line.crossings ?? []).find((c) => c.threshold === t);
  if (!x) return null;
  const hasPm = typeof x.p_model === "number" && Number.isFinite(x.p_model);
  const hasP = typeof x.probability === "number" && Number.isFinite(x.probability);
  const archived = typeof x.p_shown === "number" && Number.isFinite(x.p_shown);
  return {
    c: hasPm ? x.p_model : hasP ? x.probability : null, cSrc: hasPm ? "p_model" : "probability",
    shown: archived ? x.p_shown : hasP ? shownChance(t, x.probability) : null, shownSrc: archived ? "archive" : "recomputed",
    wording: x.wording_shown ?? null,
  };
}

/** The floods (events) of the scored gauges on the given days. */
function v3Events(ctx, daySet) {
  return ctx.events.filter((e) => daySet.has(e.day) && !hasNoForecast(e.station) && v3Pool(ctx).by.has(e.station));
}

/**
 * One flood against the runs of its gauge for a lead (hours). Order: no run in the 3 h before it -> missed; no accepted lead run -> missed; the
 * lead run's river already at or above the step -> already (not scored, counted beside); else scored with the lead run's line.
 */
export function v3FloodStatus(ctx, e, leadH) {
  const rs = v3Pool(ctx).by.get(e.station);
  if (!rs) return { st: "missed", why: "no-run" };
  const i = lastBefore(rs, e.ts);
  if (i < 0 || e.ts - rs[i].ts > GAP_MS) return { st: "missed", why: "no-run-3h" };
  const j = lastBefore(rs, e.ts - leadH * HOUR + V3.LEAD_SLACK_H * HOUR + 1);
  if (j < 0 || rs[j].ts < e.ts - (leadH + V3.LEAD_EXTRA_H) * HOUR) return { st: "missed", why: "no-lead-run" };
  const run = rs[j];
  if (run.cur >= e.levelFt) return { st: "already", run };
  return { st: "scored", run, line: v3StepLine(run, e.threshold) };
}

// ---------------------------------------------------------------- lab yardstick: Notice
/** Flood records of the Notice yardstick: { s, k, cls, ts, day, st, z } (z = the lead run's chance, -1 = no line). */
export function v3NoticeFloods(ctx, daySet) {
  return v3Events(ctx, daySet).map((e) => {
    const cls = v3Class(e.station);
    const f = v3FloodStatus(ctx, e, cls === "fast" ? V3.LEAD_FAST_H : V3.LEAD_BIG_H);
    const z = f.st === "scored" ? (f.line?.c ?? -1) : -1;
    return { s: e.station, k: e.threshold, cls, ts: e.ts, day: e.day, st: f.st, z };
  });
}

/** False-alarm hours per gauge-step: below the step, a line of at least FLOOR, the river did not reach the step in 24 h (known), weighted by cadence. Map "station|step" -> [{c, w}]. */
export function v3FalseHours(ctx, daySet) {
  const { by, cad } = v3Pool(ctx);
  const out = new Map();
  for (const [st, rs] of by) {
    for (const r of rs) {
      if (!daySet.has(r.day)) continue;
      for (const t of V3_LEVELS) {
        const L = ctx.steps[st]?.[t];
        if (L == null || r.cur >= L) continue;
        const ln = v3StepLine(r, t);
        if (!ln || ln.c == null || ln.c < V3.FLOOR - EPS) continue;
        if (v3Reach(ctx, r, t, L) !== false) continue;
        const key = `${st}|${t}`;
        (out.get(key) ?? out.set(key, []).get(key)).push({ c: ln.c, w: cad.get(r) });
      }
    }
  }
  return out;
}

/** The bar of one gauge-step: hours with a chance above it warn, hours at it warn in proportion (`tie`). b = allowed weighted hours. */
export function v3Bar(hours, b) {
  const el = hours.filter((h) => h.c >= V3.FLOOR - EPS).sort((x, y) => y.c - x.c);
  const total = el.reduce((a, h) => a + h.w, 0);
  if (total <= b + 1e-12) return { bar: V3.FLOOR - EPS, tie: 0 };
  let cum = 0, bar = el[el.length - 1].c;
  for (const h of el) { cum += h.w; if (cum >= b - 1e-12) { bar = h.c; break; } }
  let above = 0, here = 0;
  for (const h of el) { if (h.c > bar) above += h.w; else if (h.c === bar) here += h.w; }
  return { bar, tie: here > 0 ? Math.min(1, Math.max(0, (b - above) / here)) : 1 };
}

/**
 * NOTICE per lab class from false-alarm hours and flood records. calDays = days of the window (calendar hours H = 24 x calDays).
 * `skip` = a Set of flood records left out (the single-storm test). Floods already at the step are not scored; missed floods count as not warned.
 */
export function v3Notice(hoursByKey, floods, calDays, skip = null) {
  const b = V3.X * 24 * calDays;
  const bars = new Map();
  const out = { big: { num: 0, den: 0, floods: 0, scored: 0, missed: 0, already: 0 }, fast: { num: 0, den: 0, floods: 0, scored: 0, missed: 0, already: 0 } };
  for (const f of floods) {
    if (skip?.has(f)) continue;
    const o = out[f.cls];
    o.floods++;
    if (f.st === "already") { o.already++; continue; }
    o.den++;
    if (f.st === "missed") { o.missed++; continue; }
    o.scored++;
    const key = `${f.s}|${f.k}`;
    if (!bars.has(key)) bars.set(key, v3Bar(hoursByKey.get(key) ?? [], b));
    const { bar, tie } = bars.get(key);
    if (f.z >= V3.FLOOR - EPS) o.num += f.z > bar ? 1 : f.z === bar ? tie : 0;
  }
  for (const o of Object.values(out)) o.notice = o.den ? (100 * o.num) / o.den : null;
  return out;
}

/** Day-file histogram of false-alarm hours (1% bins) back into hours for v3Notice (the bin's lower edge as the chance; flood chances are binned the same way). */
const binOf = (c) => Math.floor(c / V3.HIST_BIN + EPS);
const fromBin = (n) => Math.round(n * V3.HIST_BIN * 1e6) / 1e6;
const quant = (f) => ({ ...f, z: f.z >= 0 ? fromBin(binOf(f.z)) : f.z });

/** Storm clusters of floods: floods within STORM_GAP_H of the previous one (any gauge) are one storm. Returns Map flood -> cluster number. */
export function v3Storms(floods) {
  const sorted = [...floods].sort((a, b) => a.ts - b.ts);
  const m = new Map();
  let id = -1, last = -Infinity;
  for (const f of sorted) { if (f.ts - last > V3.STORM_GAP_H * HOUR) id++; m.set(f, id); last = f.ts; }
  return m;
}

/**
 * Judges one Notice target (section D). `met` is null (not judged) unless the window is a rolling 12 months with at least 30 scored floods from at
 * least 8 storms; then it is the point against the target, and when one storm holds more than 15% of the floods, with AND without that storm.
 * The paired interval against river height alone needs the lab's bootstrap and is not computed nightly (`labConfirmation`).
 */
export function v3JudgeNotice({ cls, hoursByKey, floods, calDays, spanDays, target }) {
  const inCls = floods.filter((f) => f.cls === cls);
  const base = v3Notice(hoursByKey, floods, calDays)[cls];
  const counted = inCls.filter((f) => f.st !== "already");
  const storms = v3Storms(floods);
  const stormIds = new Set(counted.map((f) => storms.get(f)));
  const tally = new Map();
  for (const f of counted) tally.set(storms.get(f), (tally.get(storms.get(f)) ?? 0) + 1);
  let top = null, topN = 0;
  for (const [id, n] of tally) if (n > topN) { top = id; topN = n; }
  const topShare = counted.length ? topN / counted.length : 0;
  let without = null;
  if (topShare > V3.STORM_SHARE) {
    const skip = new Set(inCls.filter((f) => storms.get(f) === top));
    without = v3Notice(hoursByKey, floods, calDays, skip)[cls].notice;
  }
  const J = V3.JUDGED;
  const enough = spanDays >= J.minSpanDays && base.scored + base.missed >= J.minFloods && stormIds.size >= J.minStorms;
  const point = base.notice;
  const pointOk = point != null && point >= target - 1e-9 && (without == null || without >= target - 1e-9);
  let status, met;
  if (!enough) {
    met = null;
    status = `not judged: needs a rolling 12 months with at least ${J.minFloods} scored floods from ${J.minStorms} storms (this window: ${spanDays} days, ${base.scored + base.missed} floods, ${stormIds.size} storms)`;
  } else if (pointOk) { met = true; status = "at or above the target; the lab confirms the paired interval against river height alone"; }
  else { met = false; status = without != null && point >= target ? "below the target without the largest storm" : "below the target"; }
  return {
    key: cls === "big" ? "noticeBig12h" : "noticeFast6h", cls, leadH: cls === "big" ? V3.LEAD_BIG_H : V3.LEAD_FAST_H, target, value: point == null ? null : r1(point),
    floods: base.floods, scored: base.scored, missed: base.missed, alreadyAtStep: base.already, storms: stormIds.size, largestStormShare: r2(topShare),
    valueWithoutLargestStorm: without == null ? null : r1(without), pointAtOrAboveTarget: point == null ? null : pointOk, met, status, labConfirmation: "paired interval against river height alone, lab",
  };
}

// ---------------------------------------------------------------- next hour
/** The hours of the next-hour numbers: one run per Colombo station-hour of a scored non-tidal gauge, with the rate the tile used and the rise that followed. */
export function v3NextHourRows(ctx, daySet) {
  const runs = dedupeRuns(ctx.runs.filter((r) => daySet.has(r.day) && scorable(r) && !r.tidal));
  const rows = [];
  for (const r of runs) {
    const next = ctx.near(r.station, r.ts + HOUR);
    if (typeof next !== "number") continue;
    let rateM, rising, src;
    const nh = r.line.nh_rate_m_h;
    if (typeof nh === "number" && Number.isFinite(nh)) {
      rateM = nh; rising = r.line.nh_word ? r.line.nh_word === "rising" : nh > STEADY_M_PER_H; src = "archive";
    } else {
      const h1 = r.hx[1]?.p;
      const h1ChangeM = h1 == null ? null : (h1 - r.cur) * FT;
      const prev = r.ts >= RISE_OVERRIDE_SINCE ? ctx.near(r.station, r.ts - HOUR) : null;
      const rate1hM = typeof prev === "number" ? (r.cur - prev) * FT : null;
      rateM = nextHourRateM({ h1ChangeM, rate3hM: r.rate3 == null ? null : r.rate3 * FT, source: null, method: r.method, rate1hM, tidal: !!r.tidal, measuredForAll: r.ts >= NEXT_HOUR_MEASURED_SINCE, measuredWins: r.ts >= NEXT_HOUR_MEASURED_WINS_SINCE });
      if (rateM == null) continue;
      rising = rateM > STEADY_M_PER_H; src = "rebuilt";
    }
    const rise = next - r.cur;
    rows.push({ g: r.station, rate: rateM, rising, rise, fast: rise >= RISE_BIG_FT, still: rise < RISE_ANY_FT, src });
  }
  return rows;
}

/**
 * RISE CATCH AT 10% OF FALSE HOURS. Entries { g, rate, still, fast } (counts, so binned day files work too). Per river the bar leaves a share q of
 * that river's false hours (rise under 1 cm) above it (ties split in proportion); the number = share of all fast rises (10 cm or more in an hour,
 * all rivers pooled) whose rate is above their river's bar. No skill = 10 by construction, perfect = 100. A river with no false hours catches nothing.
 */
export function v3RiseCatch(entries, q = V3.RISE_Q) {
  const by = new Map();
  for (const e of entries) {
    const m = by.get(e.g) ?? by.set(e.g, new Map()).get(e.g);
    const a = m.get(e.rate) ?? m.set(e.rate, [0, 0]).get(e.rate);
    a[0] += e.still; a[1] += e.fast;
  }
  let num = 0, den = 0;
  for (const m of by.values()) {
    const gs = [...m.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
    const P = gs.reduce((a, v) => a + v[1], 0), A = gs.reduce((a, v) => a + v[0], 0);
    den += P;
    if (A <= 0) continue;
    let cum = 0, k = 0, beforeP = 0;
    const lim = q * A;
    while (k < gs.length && cum + gs[k][0] <= lim) { cum += gs[k][0]; beforeP += gs[k][1]; k++; }
    if (k >= gs.length) num += P;
    else num += beforeP + (gs[k][0] > 0 ? (lim - cum) / gs[k][0] : 0) * gs[k][1];
  }
  return den ? (100 * num) / den : null;
}
const nhEntries = (rows) => rows.map((x) => ({ g: x.g, rate: x.rate, still: x.still ? 1 : 0, fast: x.fast ? 1 : 0 }));
const nhBin = (rate) => Math.round(rate / V3.RISE_BIN_M);

// ---------------------------------------------------------------- day statistics (sufficient statistics of one Colombo day) and their sum
const tierOf = (p) => V3_TIERS.find(([, a, b]) => p >= a && p < b)?.[0] ?? null;
const bump = (o, k, init) => (o[k] ??= init());

/**
 * Everything one day contributes to spec 3, as plain counts and small histograms (about 40 KB). `final` = the day's 24 h outcomes can no longer change
 * (only final days are summed). `edge` = the previous day is not in the loaded archive, so early floods may lack their lead runs (never summed).
 */
export function v3DayStats(ctx, day, { final = true, edge = false } = {}) {
  const ds = new Set([day]);
  const { by } = v3Pool(ctx);
  const out = { day, final, edge, sources: {}, notice: {}, p1: {}, p2: {}, p3: {}, nh: {} };

  // lab Notice: false-alarm hours in 1% bins per gauge-step, and the day's floods
  const hrs = {};
  if (final) for (const [key, hs] of v3FalseHours(ctx, ds)) { const h = (hrs[key] = {}); for (const x of hs) { const b = binOf(x.c); h[b] = Math.round(((h[b] ?? 0) + x.w) * 1000) / 1000; } }
  out.notice = { hours: hrs, floods: v3NoticeFloods(ctx, ds).map((f) => ({ s: f.s, k: f.k, cls: f.cls, ts: f.ts, st: f.st, z: f.z < 0 ? null : Math.round(f.z * 1e6) / 1e6 })) };

  // P1 / P4: Notice at fixed leads (shown chance of 20% or more at the lead run)
  for (const e of v3Events(ctx, ds)) {
    const type = v3Type(e.station);
    for (const lead of V3.PUBLIC_LEADS[type]) {
      const f = v3FloodStatus(ctx, e, lead);
      const a = bump(bump(bump(out.p1, type, () => ({})), lead, () => ({})), e.threshold, () => [0, 0, 0, 0, 0]); // rises, already, noRun, scored, warned
      a[0]++;
      if (f.st === "already") a[1]++;
      else if (f.st === "missed") a[2]++;
      else { a[3]++; if ((f.line?.shown ?? 0) >= POSSIBLE_P - EPS) a[4]++; }
    }
  }

  // P2 / P3: per station-hour (the latest run of the hour)
  const dayRuns = dedupeRuns([...by.values()].flat().filter((r) => r.day === day));
  const src = { runs: dayRuns.length, shownArchive: 0, shownRecomputed: 0, chancePModel: 0, chanceProbability: 0 };
  for (const t of V3_LEVELS) out.p3[t] = { tiers: {}, atLimit: [0, 0] };
  for (const type of ["big", "fast", "tidal"]) out.p2[type] = { warn: 0, wrong: 0, unknown: 0, gauges: [] };
  const gaugeSets = { big: new Set(), fast: new Set(), tidal: new Set() };
  for (const r of dayRuns) {
    const type = v3Type(r.station);
    gaugeSets[type].add(r.station);
    let showing = false, wrong = false, unknown = false;
    for (const t of V3_LEVELS) {
      const L = ctx.steps[r.station]?.[t];
      if (L == null || r.cur >= L) continue;
      const ln = v3StepLine(r, t);
      if (!ln || ln.shown == null) continue;
      if (ln.shownSrc === "archive") src.shownArchive++; else src.shownRecomputed++;
      if (ln.cSrc === "p_model") src.chancePModel++; else src.chanceProbability++;
      if (!final) continue;
      const reach = v3Reach(ctx, r, t, L);
      if (ln.shown >= POSSIBLE_P - EPS) { showing = true; if (reach === false) wrong = true; else if (reach == null) unknown = true; }
      if (reach == null) continue;
      const cap = P_CAP[t];
      if (cap != null && cap < 1 && ln.shown >= cap - EPS) { const a = out.p3[t].atLimit; a[0]++; a[1] += reach ? 1 : 0; continue; }
      const tier = tierOf(ln.shown);
      if (!tier) continue;
      const a = bump(out.p3[t].tiers, tier, () => [0, 0, 0]); // hours, sum of shown, came true
      a[0]++; a[1] = Math.round((a[1] + ln.shown) * 1e6) / 1e6; a[2] += reach ? 1 : 0;
    }
    if (final && showing) { const a = out.p2[type]; a.warn++; if (wrong) a.wrong++; else if (unknown) a.unknown++; }
  }
  for (const type of Object.keys(gaugeSets)) out.p2[type].gauges = [...gaugeSets[type]].sort();
  out.sources = src;

  // next hour
  const rows = v3NextHourRows(ctx, ds);
  const nh = { hours: rows.length, fast: 0, fastRising: 0, rising: 0, risingRight: 0, still: 0, stillRising: 0, archiveWords: 0, rebuiltWords: 0, catch: {} };
  for (const x of rows) {
    if (x.src === "archive") nh.archiveWords++; else nh.rebuiltWords++;
    if (x.fast) { nh.fast++; if (x.rising) nh.fastRising++; }
    if (x.rising) { nh.rising++; if (x.rise >= RISE_ANY_FT) nh.risingRight++; }
    if (x.still) { nh.still++; if (x.rising) nh.stillRising++; }
    if (x.fast || x.still) { const c = bump(nh.catch, x.g, () => ({})); const a = bump(c, nhBin(x.rate), () => [0, 0]); if (x.still) a[0]++; if (x.fast) a[1]++; }
  }
  out.nh = nh;
  return out;
}

/** Sums day statistics (final, non-edge days only) into one raw tally. */
export function v3Sum(stats) {
  const use = stats.filter((s) => s.final && !s.edge).sort((a, b) => (a.day < b.day ? -1 : 1));
  const sum = {
    days: use.map((s) => s.day), hoursByKey: new Map(), floods: [], p1: {}, p2: {}, p3: {}, nh: { hours: 0, fast: 0, fastRising: 0, rising: 0, risingRight: 0, still: 0, stillRising: 0, archiveWords: 0, rebuiltWords: 0, entries: [] },
    sources: { runs: 0, shownArchive: 0, shownRecomputed: 0, chancePModel: 0, chanceProbability: 0 },
  };
  const nhAcc = new Map();
  for (const s of use) {
    for (const [key, h] of Object.entries(s.notice.hours ?? {})) {
      const arr = sum.hoursByKey.get(key) ?? sum.hoursByKey.set(key, []).get(key);
      for (const [bin, w] of Object.entries(h)) arr.push({ c: fromBin(Number(bin)), w });
    }
    for (const f of s.notice.floods ?? []) sum.floods.push({ ...f, day: s.day, z: f.z == null ? -1 : f.z });
    for (const [type, leads] of Object.entries(s.p1)) for (const [lead, lv] of Object.entries(leads)) for (const [t, a] of Object.entries(lv)) {
      const d = bump(bump(bump(sum.p1, type, () => ({})), lead, () => ({})), t, () => [0, 0, 0, 0, 0]);
      for (let i = 0; i < 5; i++) d[i] += a[i];
    }
    for (const [type, a] of Object.entries(s.p2)) {
      const d = bump(sum.p2, type, () => ({ warn: 0, wrong: 0, unknown: 0, gauges: new Set() }));
      d.warn += a.warn; d.wrong += a.wrong; d.unknown += a.unknown; for (const g of a.gauges) d.gauges.add(g);
    }
    for (const [t, p] of Object.entries(s.p3)) {
      const d = bump(sum.p3, t, () => ({ tiers: {}, atLimit: [0, 0] }));
      d.atLimit[0] += p.atLimit[0]; d.atLimit[1] += p.atLimit[1];
      for (const [tier, a] of Object.entries(p.tiers)) { const x = bump(d.tiers, tier, () => [0, 0, 0]); for (let i = 0; i < 3; i++) x[i] += a[i]; }
    }
    for (const k of Object.keys(sum.sources)) sum.sources[k] += s.sources[k] ?? 0;
    for (const k of ["hours", "fast", "fastRising", "rising", "risingRight", "still", "stillRising", "archiveWords", "rebuiltWords"]) sum.nh[k] += s.nh[k] ?? 0;
    for (const [g, c] of Object.entries(s.nh.catch ?? {})) for (const [bin, a] of Object.entries(c)) {
      const key = `${g}|${bin}`;
      const x = nhAcc.get(key) ?? nhAcc.set(key, { g, rate: Number(bin) * V3.RISE_BIN_M, still: 0, fast: 0 }).get(key);
      x.still += a[0]; x.fast += a[1];
    }
  }
  sum.nh.entries = [...nhAcc.values()];
  return sum;
}

const share = (n, d) => (d ? r1((100 * n) / d) : null);

/**
 * The published spec 3 numbers from a tally. `exact` (optional) replaces the histogram-based Notice and rise catch with values computed from the runs
 * ({ hoursByKey, floods, nhEntries }). spanDays = calendar span of the days summed.
 */
export function v3Report(sum, { exact = null } = {}) {
  const calDays = sum.days.length;
  const spanDays = calDays ? Math.round((Date.parse(`${sum.days[calDays - 1]}T00:00:00Z`) - Date.parse(`${sum.days[0]}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  const hoursByKey = exact?.hoursByKey ?? sum.hoursByKey;
  const floods = exact?.floods ?? sum.floods.map(quant);
  const targets = [
    v3JudgeNotice({ cls: "big", hoursByKey, floods, calDays, spanDays, target: V3.TARGET.noticeBig }),
    v3JudgeNotice({ cls: "fast", hoursByKey, floods, calDays, spanDays, target: V3.TARGET.noticeFast }),
  ];
  const nb = v3Notice(hoursByKey, floods, calDays);
  const notice = {};
  for (const c of ["big", "fast"]) notice[c] = { leadH: c === "big" ? V3.LEAD_BIG_H : V3.LEAD_FAST_H, value: nb[c].notice == null ? null : r1(nb[c].notice), floods: nb[c].floods, scored: nb[c].scored, missed: nb[c].missed, alreadyAtStep: nb[c].already, source: exact ? "runs" : "day files, 1% bins" };

  // P1 / P4
  const p1 = {};
  const row = (a) => {
    const den = a[0] - a[1];
    return { rises: a[0], alreadyAtLevel: a[1], noLeadRun: a[2], scored: a[3], warned: a[4], pct: share(a[4], den), coverage: den ? r1((100 * (den - a[2])) / den) : null, judgeable: den > 0 && (den - a[2]) / den >= 0.9 };
  };
  for (const [type, leads] of Object.entries(sum.p1)) {
    p1[type] = {};
    for (const [lead, lv] of Object.entries(leads)) {
      const any = [0, 0, 0, 0, 0];
      for (const a of Object.values(lv)) for (let i = 0; i < 5; i++) any[i] += a[i];
      p1[type][lead] = { any: row(any), byLevel: Object.fromEntries(Object.entries(lv).map(([t, a]) => [t, row(a)])) };
    }
  }
  const p4 = {};
  for (const [type, leads] of Object.entries(p1)) {
    const a = leads["1"]?.any;
    p4[type] = a ? { rises: a.rises, alreadyAtLevel: a.alreadyAtLevel, surprises: a.rises - a.alreadyAtLevel - a.warned, pct: a.pct == null ? null : r1(100 - a.pct) } : null;
  }

  // P2: warning hours that did not come true, per gauge per 30 days
  const p2 = {};
  for (const [type, a] of Object.entries(sum.p2)) {
    const g = a.gauges.size;
    const known = a.warn - a.unknown;
    p2[type] = {
      gauges: g, days: calDays, warningHours: a.warn, notComeTrue: a.wrong, unknownOutcome: a.unknown,
      perGaugePer30Days: g && calDays ? r1((a.wrong / g / calDays) * 30) : null, shareNotComeTrue: share(a.wrong, known), coverage: a.warn ? r1((100 * known) / a.warn) : null,
    };
  }

  // P3: came true per printed tier; hours at a limit are a separate record
  const p3 = { levels: {}, verdict: "no claim" };
  let anyFail = false, anyPass = false;
  for (const t of V3_LEVELS) {
    const d = sum.p3[t] ?? { tiers: {}, atLimit: [0, 0] };
    const tiers = V3_TIERS.map(([name]) => {
      const a = d.tiers[name] ?? [0, 0, 0];
      if (!a[0]) return { tier: name, hours: 0 };
      const stated = (100 * a[1]) / a[0], seen = (100 * a[2]) / a[0], gap = seen - stated;
      const tol = name === "<1in10" || name === "1in10" ? 5 : 10;
      const verdict = a[0] < V3.TIER_MIN_HOURS ? "too few hours" : Math.abs(gap) > tol ? `fails: came true ${gap < 0 ? "LESS" : "MORE"}` : "passes";
      return { tier: name, hours: a[0], stated: r1(stated), cameTrue: r1(seen), gap: r1(gap), verdict };
    });
    const counted = tiers.filter((x) => x.hours >= V3.TIER_MIN_HOURS);
    const verdict = !counted.length ? "no claim" : counted.some((x) => x.verdict.startsWith("fails")) ? "FAILS" : "passes";
    if (verdict === "FAILS") anyFail = true; else if (verdict === "passes") anyPass = true;
    p3.levels[t] = { tiers, atLimit: { hours: d.atLimit[0], cameTrue: share(d.atLimit[1], d.atLimit[0]), note: "the page prints its limit, not the forecaster's chance: not judged" }, verdict };
  }
  p3.verdict = anyFail ? "FAILS" : anyPass ? "passes" : "no claim";
  p3.judgedAsPassFail = spanDays >= V3.JUDGED.minSpanDays;

  // next hour
  const n = sum.nh;
  const catchValue = v3RiseCatch(exact?.nhEntries ?? n.entries);
  const nextHour = {
    riseCatchAt10PctFalseHours: { value: catchValue == null ? null : r1(catchValue), chance: 10, perfect: 100, fastRises: n.fast, falseHours: n.still, hours: n.hours, source: exact ? "runs" : "day files, 1 mm/h bins", target: null },
    records: {
      R1_risingWhenRoseTenCm: { pct: share(n.fastRising, n.fast), n: n.fast },
      R2_risingFollowedByRise: { pct: share(n.risingRight, n.rising), n: n.rising },
      R3_hoursShowingRising: { pct: share(n.rising, n.hours), n: n.hours, pctOfHoursWithoutARise: share(n.stillRising, n.still) },
    },
    wordSource: { archived: n.archiveWords, rebuiltByRulesOfTheDay: n.rebuiltWords },
  };
  return { days: sum.days, spanDays, calendarDays: calDays, sources: sum.sources, lab: { notice }, targets, public: { p1, p2, p3, p4 }, nextHour };
}

/** Window numbers computed from the runs themselves (exact Notice and rise catch) for the given final days. */
export function v3WindowExact(ctx, days) {
  const ds = new Set(days);
  return { hoursByKey: v3FalseHours(ctx, ds), floods: v3NoticeFloods(ctx, ds), nhEntries: nhEntries(v3NextHourRows(ctx, ds)) };
}
