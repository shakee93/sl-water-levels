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
import { FT, HOUR, colomboDay, median, nearestReading } from "./forecastScoreboard.mjs";
import { FAST_MAX_H, POSSIBLE_P, STEADY_M_PER_H, hasNoForecast, isShortForecastGauge, nextHourRateM, shownChance } from "./forecastRules.mjs";
import { cleanSeries, latestLooksOdd } from "./readingQc.mjs";

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
      .map((c) => ({ t: c.threshold, lvl: c.level * k, shown: shownChance(c.threshold, c.probability) }));
    runs.push({ ...base, usable: true, flagged, cur, rate3, phase: phaseOf(rate3), hx, sh, crossings, series: s });
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
  return { runs, events, series, near, steps, units };
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

/** True when the river reached `lvl` (ft) in the 24 h after the run; false when it did not and readings cover 23 h; null = cannot tell yet. */
export function reachedWithin24h(ctx, run, lvl) {
  const s = ctx.series[run.station];
  if (!s) return run.line.max24 != null && run.line.cover24 ? run.line.max24 * unitK(run.unit) >= lvl : null; // no readings file: the stored max
  let last = -Infinity;
  for (const p of s.clean) {
    if (p.ts <= run.ts) continue;
    if (p.ts > run.ts + 24 * HOUR) break;
    if (p.level >= lvl) return true;
    last = p.ts;
  }
  return last >= run.ts + 23 * HOUR ? false : null;
}

// ---------------------------------------------------------------- KPI helpers

const kpi = (id, key, o) => ({ id, key, value: null, unit: "%", target: null, met: null, n: 0, parts: [], detail: {}, ...o });
const judged = (n, min) => n >= min;

const scorable = (r) => r.usable && !r.flagged && !r.noForecast;

// 1 ------------------------------------------------------------
function kpiWarned(ctx, runs, events) {
  const T = TARGETS.warned;
  const byStation = new Map();
  for (const r of runs) if (scorable(r) && r.model) (byStation.get(r.station) ?? byStation.set(r.station, []).get(r.station)).push(r);
  const out = [];
  for (const e of events) {
    const rs = byStation.get(e.station);
    if (!rs) continue;
    let i = rs.length - 1;
    while (i >= 0 && rs[i].ts >= e.ts) i--;
    if (i < 0 || e.ts - rs[i].ts > GAP_MS) continue; // no fitted-model run just before: not scored
    const shownAt = (r) => r.crossings.find((c) => c.t === e.threshold)?.shown ?? 0;
    let lead = 0;
    if (shownAt(rs[i]) >= POSSIBLE_P) {
      let j = i;
      while (j - 1 >= 0 && rs[j].ts - rs[j - 1].ts <= GAP_MS && shownAt(rs[j - 1]) >= POSSIBLE_P) j--;
      lead = (e.ts - rs[j].ts) / HOUR;
    }
    const fast = isShortForecastGauge(e.station);
    const need = fast ? T.leadFastH : e.threshold === "alert" ? T.leadBigAlertH : T.leadBigOtherH;
    out.push({ ...e, leadH: r1(lead), needH: need, caught: lead >= need, fast, storm: rs[i].storm });
  }
  const n = out.length, caught = out.filter((x) => x.caught).length;
  const byStep = {};
  for (const t of THRESHOLDS) {
    const x = out.filter((e) => e.threshold === t);
    byStep[t] = { n: x.length, caught: x.filter((e) => e.caught).length };
  }
  const v = pct(caught, n);
  return kpi(1, "warned", {
    value: v, target: T.caught, targetText: `at least ${T.caught}% warned in time`, n,
    met: judged(n, T.min) ? v >= T.caught : null,
    parts: [{ key: "caught", value: v, target: T.caught, n, met: judged(n, T.min) ? v >= T.caught : null }],
    detail: {
      events: n, caught, medianLeadH: r1(median(out.map((x) => x.leadH))), medianLeadWhenCaughtH: r1(median(out.filter((x) => x.caught).map((x) => x.leadH))), byStep,
      leadNeeded: { bigAlertH: T.leadBigAlertH, bigOtherH: T.leadBigOtherH, fastH: T.leadFastH },
      list: out.slice(-40).map((x) => ({ station: x.station, step: x.threshold, at: new Date(x.ts).toISOString(), leadH: x.leadH, needH: x.needH, caught: x.caught })),
    },
  });
}

// 2 ------------------------------------------------------------
function kpiFalseAlarms(ctx, runs) {
  const T = TARGETS.falseAlarms;
  const groups = new Map();
  const gaugeDays = new Set();
  for (const r of runs) {
    if (!scorable(r) || !r.model) continue;
    gaugeDays.add(`${r.station}|${r.day}`);
    for (const c of r.crossings) {
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
    const hit = reachedWithin24h(ctx, first.r, first.c.lvl);
    if (hit == null) continue;
    cls[kind].n++;
    if (!hit) cls[kind].didNot++;
  }
  const pp = pct(cls.possible.didNot, cls.possible.n), pl = pct(cls.likely.didNot, cls.likely.n);
  const metP = judged(cls.possible.n, T.min) ? pp <= T.possibleMaxPct : null;
  const metL = judged(cls.likely.n, T.min) ? pl <= T.likelyMaxPct : null;
  const falseAlarms = cls.possible.didNot + cls.likely.didNot;
  return kpi(2, "falseAlarms", {
    value: pp, target: T.possibleMaxPct, targetText: `at most ${T.possibleMaxPct}% of "possible" and ${T.likelyMaxPct}% of "likely" warnings fail to happen`,
    n: cls.possible.n + cls.likely.n,
    met: metP == null && metL == null ? null : metP !== false && metL !== false,
    parts: [
      { key: "possible", value: pp, target: T.possibleMaxPct, n: cls.possible.n, met: metP },
      { key: "likely", value: pl, target: T.likelyMaxPct, n: cls.likely.n, met: metL },
    ],
    detail: { falseAlarms, gaugeDays: gaugeDays.size, falseAlarmsPerGaugeDay: gaugeDays.size ? r2(falseAlarms / gaugeDays.size) : null, possible: cls.possible, likely: cls.likely },
  });
}

// 3 ------------------------------------------------------------
function kpiHonest(ctx, runs) {
  const T = TARGETS.honest;
  const cases = [];
  for (const r of runs) {
    if (!scorable(r) || !r.model) continue;
    for (const c of r.crossings) {
      if (c.lvl <= r.cur) continue;
      const hit = reachedWithin24h(ctx, r, c.lvl);
      if (hit == null) continue;
      cases.push({ p: c.shown, hit });
    }
  }
  const bins = PROB_BINS.map(([a, b]) => {
    const x = cases.filter((c) => c.p >= a && c.p < b);
    const shown = x.length ? 100 * mean(x.map((c) => c.p)) : null, obs = x.length ? 100 * mean(x.map((c) => (c.hit ? 1 : 0))) : null;
    const ok = x.length >= T.minBin ? Math.abs(obs - shown) <= T.withinPts : null;
    return { from: a, to: Math.min(b, 1), n: x.length, shownPct: r1(shown), observedPct: r1(obs), met: ok };
  });
  const evald = bins.filter((b) => b.met != null);
  const okN = evald.filter((b) => b.met).length;
  return kpi(3, "honest", {
    value: evald.length ? pct(okN, evald.length) : null, target: T.withinPts, targetText: `within ${T.withinPts} points in every group with ${T.minBin}+ cases`, n: cases.length,
    met: evald.length ? okN === evald.length : null,
    parts: bins.map((b) => ({ key: `${Math.round(b.from * 100)}-${Math.round(b.to * 100)}`, value: b.observedPct, shown: b.shownPct, target: T.withinPts, n: b.n, met: b.met })),
    detail: { bins, groupsJudged: evald.length, groupsOk: okN },
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
      rows.push({ h, phase: r.phase, p: p.p, low: p.low, high: p.high, y: live.y, c: r.cur });
    }
  }
  return rows;
}
const skillOf = (rows) => {
  if (!rows.length) return null;
  const mae = mean(rows.map((r) => Math.abs(r.y - r.p))), pers = mean(rows.map((r) => Math.abs(r.y - r.c)));
  return pers > 0 ? 100 * (1 - mae / pers) : null;
};

function kpiSkill(rows) {
  const T = TARGETS.skill;
  const parts = [];
  for (const h of HORIZONS) {
    const R = rows.filter((r) => r.h === h), s = r1(skillOf(R));
    parts.push({ key: `h${h}`, value: s, target: T[h], n: R.length, met: R.length >= T.min && s != null ? s >= T[h] : null });
  }
  const phases = {};
  for (const ph of PHASES) {
    // equal weight per horizon, so the long horizons' big errors do not swamp the short ones; a horizon counts with 10+ cases
    const per = HORIZONS.map((h) => rows.filter((r) => r.phase === ph && r.h === h)).filter((R) => R.length >= 10).map((R) => skillOf(R)).filter((s) => s != null);
    phases[ph] = { n: rows.filter((r) => r.phase === ph).length, skill: per.length ? r1(mean(per)) : null, horizons: per.length };
  }
  const phaseVals = Object.values(phases).filter((p) => p.skill != null);
  const worst = phaseVals.length ? Math.min(...phaseVals.map((p) => p.skill)) : null;
  parts.push({ key: "worstPhase", value: worst, target: T.phaseMin, n: phaseVals.reduce((s, p) => s + p.n, 0), met: worst == null ? null : worst >= T.phaseMin });
  const judgedParts = parts.filter((p) => p.met != null);
  const six = parts.find((p) => p.key === "h6");
  return kpi(4, "skill", {
    value: six.value, target: T[6], targetText: "beats \"no change\" by 30% at 1-6 h, 20% at 12 h, 10% at 24 h, and in every kind of river movement", n: rows.length,
    met: judgedParts.length ? judgedParts.every((p) => p.met) : null, parts, detail: { phases },
  });
}

function kpiBias(rows) {
  const T = TARGETS.bias;
  const R12 = rows.filter((r) => r.h === 12);
  const parts = [];
  for (const ph of PHASES) {
    const R = R12.filter((r) => r.phase === ph);
    const b = R.length ? r2(mean(R.map((r) => r.p - r.y))) : null;
    parts.push({ key: ph, value: b, target: T.withinFt, n: R.length, met: R.length >= T.min && b != null ? Math.abs(b) <= T.withinFt : null });
  }
  const evald = parts.filter((p) => p.met != null);
  const all = R12.length ? r2(mean(R12.map((r) => r.p - r.y))) : null;
  return kpi(5, "bias", {
    value: all, unit: "ft", target: T.withinFt, targetText: "12 h forecast within 0.25 ft of reality on average, in every kind of river movement", n: R12.length,
    met: evald.length ? evald.every((p) => p.met) : null, parts,
  });
}

function kpiCoverage(rows) {
  const T = TARGETS.coverage;
  const parts = [];
  for (const h of HORIZONS) {
    const R = rows.filter((r) => r.h === h && r.low != null && r.high != null);
    const c = R.length ? pct(R.filter((r) => r.y >= r.low && r.y <= r.high).length, R.length) : null;
    parts.push({ key: `h${h}`, value: c, target: `${T.lo}-${T.hi}`, n: R.length, met: R.length >= T.min && c != null ? c >= T.lo && c <= T.hi : null });
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
    const rateM = nextHourRateM({ h1ChangeM, rate3hM: r.rate3 == null ? null : r.rate3 * FT, source: null, method: r.method });
    if (rateM == null) continue;
    const next = ctx.near(r.station, r.ts + HOUR);
    if (typeof next !== "number") continue;
    out.push({ rising: rateM > STEADY_M_PER_H, rise: next - r.cur });
  }
  return out;
}
function kpiFastRises(calls) {
  const T = TARGETS.fastRises;
  const fast = calls.filter((c) => c.rise >= RISE_BIG_FT);
  const v = pct(fast.filter((c) => c.rising).length, fast.length);
  const met = judged(fast.length, T.min) ? v >= T.pct : null;
  return kpi(7, "fastRises", { value: v, target: T.pct, targetText: `at least ${T.pct}% of rises of 10 cm or more in an hour were called Rising`, n: fast.length, met, parts: [{ key: "called", value: v, target: T.pct, n: fast.length, met }] });
}
function kpiRisingRight(calls) {
  const T = TARGETS.risingRight;
  const rc = calls.filter((c) => c.rising);
  const v = pct(rc.filter((c) => c.rise >= RISE_ANY_FT).length, rc.length);
  const met = judged(rc.length, T.min) ? v >= T.pct : null;
  return kpi(8, "risingRight", { value: v, target: T.pct, targetText: `at least ${T.pct}% of Rising calls were followed by a rise`, n: rc.length, met, parts: [{ key: "right", value: v, target: T.pct, n: rc.length, met }] });
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
      { key: "hours", value: medHours, target: T.hours, n: hoursPerDay.length, met, worst: hoursPerDay.length ? Math.min(...hoursPerDay) : null },
      { key: "gaugesPerHour", value: median(perHour), target: null, n: perHour.length, met: null },
      { key: "flaggedShare", value: share, target: null, n: allRuns.length, met: null },
    ],
    detail: { runs: allRuns.length, flaggedRuns: flagged },
  });
}

// 10 ------------------------------------------------------------
function kpiPeople(rows, fallback) {
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
  const met = judged(j, T.min) && v != null ? v >= T.pct : null;
  return kpi(10, "people", { value: v, target: T.pct, targetText: `at least ${T.pct}% of people say the forecast matches what they see`, n: j, met, parts: [{ key: "agree", value: v, target: T.pct, n: j, met }], detail: { yes, worse, better, source } });
}

// ---------------------------------------------------------------- KPI sets

/**
 * All ten KPIs for a set of runs.
 * @param ctx buildContext() result
 * @param opts { sel: (run) => boolean, events: event[], feedback?: {answer}[]|null, feedbackFallback?, today?: "YYYY-MM-DD", variant?: string|null }
 */
export function kpiSet(ctx, { sel = () => true, events = ctx.events, feedback = null, feedbackFallback = null, today = null, variant = null } = {}) {
  const runs = ctx.runs.filter(sel);
  if (variant) {
    const vr = runs.filter((r) => r.sh?.[variant]);
    const rows = scoredRows(vr, variant), calls = nextHourCalls(ctx, vr, variant);
    return [kpiSkill(rows), kpiBias(rows), kpiCoverage(rows), kpiFastRises(calls), kpiRisingRight(calls)];
  }
  const rows = scoredRows(runs, null), calls = nextHourCalls(ctx, runs, null);
  return [
    kpiWarned(ctx, runs, events), kpiFalseAlarms(ctx, runs), kpiHonest(ctx, runs), kpiSkill(rows), kpiBias(rows), kpiCoverage(rows),
    kpiFastRises(calls), kpiRisingRight(calls), kpiInputs(runs, today), kpiPeople(feedback, feedbackFallback),
  ];
}

/** "met X of Y": Y counts the targets with enough cases to judge. */
export function summarise(kpis) {
  const assessable = kpis.filter((k) => k.met != null);
  return { met: assessable.filter((k) => k.met).length, assessable: assessable.length, total: kpis.length, notJudged: kpis.length - assessable.length };
}

/** Variant names that appear in these lines (shadow forecasts). */
export const variantsOf = (lines) => [...new Set(lines.flatMap((l) => Object.keys(l.shadows ?? {})))].sort();

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
