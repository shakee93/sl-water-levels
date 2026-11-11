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
import { FAST_MAX_H, NEXT_HOUR_MEASURED_SINCE, NEXT_HOUR_MEASURED_WINS_SINCE, POSSIBLE_P, RISE_OVERRIDE_SINCE, STEADY_M_PER_H, hasNoForecast, isShortForecastGauge, nextHourRateM, shownChance } from "./forecastRules.mjs";
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
