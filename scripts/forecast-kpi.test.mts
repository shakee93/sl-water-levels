// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/forecast-kpi.test.mts
import assert from "node:assert/strict";
import { HOUR, FT, buildReadings, dayStart } from "../lib/forecastScoreboard.mjs";
import {
  buildContext, historyRows, kpiSet, mergeReadings, phaseOf, summarise, upsertHistory, variantsOf, versionAt, HISTORY_HEADER,
  SPEC1, SPEC2, WIDE_HEADER, dedupeRuns, dropInternal, gaugeTable, ledgerRecords, missingDays, reachedWithin24h, systemSet, systemsOf, upsertLedger, upsertWide, upsertWideEdge, wideRows,
} from "../lib/forecastKpi.mjs";

const DAY = "2026-10-27";
const T0 = dayStart(DAY) + 2 * HOUR;
/** a calm level with a 0.01 ft wobble: a real gauge never repeats one value for days (the glitch filter would call it stuck) */
const flat = (v) => (i) => v + (i % 2) * 0.01;
const kpiOf = (ks, key) => ks.find((k) => k.key === key);

/** hourly readings [{ts, level}] from a function of the hour index; run lines at the same instants */
const hours = (n, f) => Array.from({ length: n }, (_, i) => ({ ts: T0 + i * HOUR, level: f(i) }));
function mkLine(station, ts, cur, over = {}) {
  return {
    day: DAY, station, basin: "B", issued_at: ts, method: "model", status: "ok", model_version: "v", unit: "ft", current_level: cur, tier: "normal", verdict: "normal",
    storm: 0, rain_risk: null, horizons: [], crossings: [], shadows: {}, max24: null, cover24: false, ...over,
  };
}
const h = (ts, hh, level, low, high) => ({ h: hh, ts: ts + hh * HOUR, level, low, high, y: null });
const build = (lines, obs, versions = []) => {
  const runs = [...new Set(lines.map((l) => l.station))].map((s) => ({ station: s, unit: "ft" }));
  const file = buildReadings({ day: DAY, runs, obs });
  return buildContext({ lines, readings: mergeReadings([file]), versions });
};
const all = (ctx, o = {}) => kpiSet(ctx, { events: ctx.events, today: "2026-11-05", ...o });

// ---- reading files round trip (whole seconds, native unit)
{
  const f = buildReadings({ day: DAY, runs: [{ station: "A", unit: "m" }], obs: { A: [{ ts: dayStart(DAY) + 1500, level: 1.23456 }, { ts: dayStart(DAY) - 100 * HOUR, level: 9 }] } });
  const m = mergeReadings([f, f]);
  assert.equal(m.A.unit, "m");
  assert.equal(m.A.pts.length, 1, "readings far outside the window are not stored; overlapping files merge");
  assert.equal(m.A.pts[0].ts % 1000, 0); // whole seconds
  assert.equal(m.A.pts[0].level, 1.235);
}

// ---- phases
assert.equal(phaseOf(0.2), "rising");
assert.equal(phaseOf(0.05), "slow rise");
assert.equal(phaseOf(0), "calm");
assert.equal(phaseOf(-0.05), "slow fall");
assert.equal(phaseOf(-0.2), "falling");
assert.equal(phaseOf(null), null);

// ---- KPI 1: a caught crossing with its lead, a late one, and a miss; KPI 2: a false alarm
{
  const lines = [], obs = {};
  // Hanwella (big river): alert at 10 ft, crosses at hour 20 (first reading >= 10 after 9.5). Chance >= 20% in every run from hour 5.
  obs.Hanwella = hours(30, (i) => (i < 20 ? 8 + i * 0.075 : 10.5));
  for (let i = 0; i < 20; i++) {
    const ts = T0 + i * HOUR;
    lines.push(mkLine("Hanwella", ts, obs.Hanwella[i].level, { crossings: [{ threshold: "alert", level: 10, probability: i >= 5 ? 0.6 : 0.1 }] }));
  }
  // Dunamale (big river): same crossing, but the warning only appears in the last 3 runs: lead 3 h, needs 6
  obs.Dunamale = hours(30, (i) => (i < 20 ? 5 : 8));
  for (let i = 0; i < 20; i++) lines.push(mkLine("Dunamale", T0 + i * HOUR, 5, { crossings: [{ threshold: "alert", level: 7.5, probability: i >= 17 ? 0.5 : 0 }] }));
  // Kithulgala (fast river): crossing at hour 12, shown only in the last two runs: 2 h lead, enough for a fast river
  obs.Kithulgala = hours(30, (i) => (i < 12 ? 3 : 6));
  for (let i = 0; i < 12; i++) lines.push(mkLine("Kithulgala", T0 + i * HOUR, 3, { crossings: [{ threshold: "alert", level: 5, probability: i >= 10 ? 0.4 : 0 }] }));
  // Deduru: a likely alert (70%) shown all day, the river stays flat for 30 h: a false alarm (likely)
  obs.Deduru = hours(30, flat(2));
  for (let i = 0; i < 5; i++) lines.push(mkLine("Deduru", T0 + i * HOUR, 2, { crossings: [{ threshold: "alert", level: 4, probability: 0.7 }] }));
  // Wilgamuwa: a possible minor shown (raw 90% is capped to 30% on minor), flat river: false alarm (possible)
  obs.Wilgamuwa = hours(30, flat(2));
  for (let i = 0; i < 5; i++) lines.push(mkLine("Wilgamuwa", T0 + i * HOUR, 2, { crossings: [{ threshold: "minor", level: 4, probability: 0.9 }] }));
  const ctx = build(lines, obs);
  assert.equal(ctx.events.filter((e) => e.station === "Hanwella").length, 1);
  const ks = all(ctx);
  const w = kpiOf(ks, "warned");
  assert.equal(w.n, 3, "three scored crossings");
  assert.equal(w.detail.caught, 2, "Hanwella (lead 15 h) and Kithulgala (2 h on a fast river)");
  const lead = Object.fromEntries(w.detail.list.map((e) => [e.station, e]));
  assert.equal(lead.Hanwella.leadH, 15);
  assert.equal(lead.Hanwella.caught, true);
  assert.equal(lead.Dunamale.leadH, 3);
  assert.equal(lead.Dunamale.caught, false, "3 h is a late warning for a big river");
  assert.equal(lead.Kithulgala.leadH, 2);
  assert.equal(lead.Kithulgala.caught, true);
  assert.equal(w.value, 66.7);
  assert.equal(w.met, null, "3 events is too few to judge");
  assert.equal(w.detail.medianLeadH, 3);
  const fa = kpiOf(ks, "falseAlarms");
  const dd = fa.detail;
  assert.equal(dd.likely.n, 3, "Hanwella, Dunamale and Deduru showed 50%+");
  assert.equal(dd.likely.didNot, 1, "only Deduru's 70% day came to nothing");
  assert.equal(dd.possible.n, 2, "Kithulgala (40%) and Wilgamuwa (minor capped to 30%)");
  assert.equal(dd.possible.didNot, 1, "Wilgamuwa stayed flat");
  // Hanwella / Dunamale / Kithulgala did reach their step: not false alarms
  assert.equal(dd.falseAlarms, 2);
  // trend-only runs never count as warnings
  const trend = lines.map((l) => (l.station === "Hanwella" ? { ...l, method: "trend" } : l));
  assert.equal(kpiOf(all(build(trend, obs)), "warned").n, 2, "a gauge with no fitted-model run just before the crossing is not scored");
}

// ---- KPI 3: honest chances (bins of shown chance vs what happened)
{
  const lines = [], obs = {};
  // 20 runs showing 50%: ten at A, where the river reaches the step, ten at B, where it does not
  obs.A = hours(40, (i) => (i >= 12 ? 3.5 : 1));
  obs.B = hours(40, flat(1));
  for (const st of ["A", "B"]) for (let i = 0; i < 10; i++) lines.push(mkLine(st, T0 + i * HOUR, 1, { crossings: [{ threshold: "alert", level: 3, probability: 0.5 }] }));
  const honest = kpiOf(all(build(lines, obs)), "honest");
  const bin = honest.detail.bins.find((b) => b.from === 0.5);
  assert.equal(bin.n, 20);
  assert.equal(bin.observedPct, 50);
  assert.equal(bin.shownPct, 50);
  assert.equal(bin.met, true, "50% shown, 50% observed");
  // the same runs saying 90% would be dishonest
  const high = lines.map((l) => ({ ...l, crossings: [{ threshold: "alert", level: 3, probability: 0.95 }] }));
  assert.equal(kpiOf(all(build(high, obs)), "honest").detail.bins.find((b) => b.from === 0.9).met, false);
}

// ---- KPI 4, 5, 6: skill, bias, coverage by horizon and phase
{
  const lines = [], obs = { A: [] };
  // a calm river at 10 ft; forecasts 0.5 ft too high at 12 h, band 9.9-10.6 around the 10.5 forecast
  const rd = [];
  for (let i = 0; i < 80; i++) rd.push({ ts: T0 - 6 * HOUR + i * HOUR, level: 10 + (i % 2) * 0.01 });
  obs.A = rd;
  for (let i = 0; i < 30; i++) {
    const ts = T0 + i * HOUR;
    lines.push(mkLine("A", ts, 10, { horizons: [h(ts, 1, 10, 9.8, 10.2), h(ts, 12, 10.5, 9.9, 10.6)] }));
  }
  const ks = all(build(lines, obs));
  const bias = kpiOf(ks, "bias");
  assert.equal(bias.value, 0.5);
  assert.equal(bias.parts.find((p) => p.key === "calm").value, 0.5);
  assert.equal(bias.met, false, "0.5 ft is outside +-0.25 ft");
  const cov = kpiOf(ks, "coverage");
  assert.equal(cov.parts.find((p) => p.key === "h1").value, 100);
  assert.equal(cov.parts.find((p) => p.key === "h12").value, 100);
  assert.equal(cov.met, false, "100% is above 85%: the range is too wide");
  const skill = kpiOf(ks, "skill");
  assert.ok(skill.parts.find((p) => p.key === "h12").value < 0, "a forecast 0.5 ft too high is worse than no change on a calm river");
  assert.equal(skill.detail.phases.calm.n, 60);
}
{
  // skill against "no change": a rising river, forecast exact at 3 h; no change is 1 ft off
  const lines = [], rd = [];
  for (let i = 0; i < 80; i++) rd.push({ ts: T0 - 6 * HOUR + i * HOUR, level: 10 + (i - 6) * 0.333 }); // 1 ft per 3 h = 0.33 ft/h: rising
  for (let i = 0; i < 40; i++) {
    const ts = T0 + i * HOUR, cur = 10 + i * 0.333;
    lines.push(mkLine("A", ts, Math.round(cur * 1000) / 1000, { horizons: [h(ts, 3, cur + 1, cur + 0.5, cur + 1.5)] }));
  }
  const s = kpiOf(all(build(lines, { A: rd })), "skill");
  const h3 = s.parts.find((p) => p.key === "h3");
  assert.ok(h3.value >= 99, `exact forecast beats no-change fully (${h3.value})`);
  assert.equal(h3.met, true);
  assert.ok(s.detail.phases.rising.n >= 30);
}

// ---- KPI 7 and 8: Next hour direction against the next reading
{
  const lines = [], rd = [];
  // rises of 0.5 ft in the next hour at every run; half the runs forecast the rise (Rising), half forecast "stays" (Steady)
  for (let i = 0; i < 40; i++) rd.push({ ts: T0 + i * HOUR, level: 5 + i * 0.5 });
  for (let i = 3; i < 23; i++) {
    const ts = T0 + i * HOUR, cur = 5 + i * 0.5;
    lines.push(mkLine("A", ts, cur, { horizons: [h(ts, 1, i % 2 ? cur + 0.5 : cur, cur - 1, cur + 1)] }));
  }
  const ks = all(build(lines, { A: rd }));
  const fast = kpiOf(ks, "fastRises"), right = kpiOf(ks, "risingRight");
  assert.equal(fast.n, 20);
  assert.equal(fast.value, 50, "half of the 10 cm rises were called Rising");
  assert.equal(right.n, 10, "the ten Rising calls");
  assert.equal(right.value, 100, "each was followed by a rise");
  // a Rising call followed by a fall is wrong
  const rd2 = rd.map((p, i) => ({ ...p, level: i % 2 ? p.level : p.level - 2 })); // the reading after each Rising call (even index) is 1.5 ft lower
  const r2 = kpiOf(all(build(lines, { A: rd2 })), "risingRight");
  assert.ok(r2.value != null && r2.value < 100);
  // tidal gauges are not judged
  const tidal = lines.map((l) => ({ ...l, station: "Nagalagam Street" }));
  assert.equal(kpiOf(all(build(tidal, { "Nagalagam Street": rd })), "fastRises").n, 0);
}

// ---- a run issued from a glitch is dropped from the scoring and counted in the inputs
{
  const lines = [], rd = hours(30, flat(5));
  rd[10] = { ts: rd[10].ts, level: 12 }; // one-reading spike between 5 and 5
  for (let i = 3; i < 20; i++) {
    const ts = T0 + i * HOUR;
    lines.push(mkLine("A", ts, rd[i].level, { horizons: [h(ts, 1, rd[i].level, 0, 20)] }));
  }
  const ctx = build(lines, { A: rd });
  assert.equal(ctx.runs.filter((r) => r.flagged).length, 1);
  assert.equal(ctx.runs.find((r) => r.flagged).ts, T0 + 10 * HOUR);
  const ks = all(ctx);
  assert.equal(kpiOf(ks, "coverage").n, 15, "17 runs: the glitch run is dropped, and the run before it has no clean reading at its target time");
  const inputs = kpiOf(ks, "inputs");
  assert.equal(inputs.parts.find((p) => p.key === "flaggedShare").value, 5.9); // 1 of 17
  // the spike is not a crossing even though it is above the step
  const withStep = lines.map((l) => ({ ...l, crossings: [{ threshold: "alert", level: 9, probability: 0.9 }] }));
  assert.equal(build(withStep, { A: rd }).events.length, 0);
}

// ---- storm days and hours of runs
{
  const lines = [], rd = hours(10, flat(1));
  for (let i = 0; i < 6; i++) lines.push(mkLine("A", T0 + i * HOUR, 1, { storm: i === 2 ? 1 : 0 }));
  lines.push(mkLine("B", T0, 1, { rain_risk: "forecast" }));
  const ctx = build(lines, { A: rd, B: rd });
  assert.ok(ctx.runs.every((r) => r.stormDay), "one storm run makes the whole day a storm day");
  const ks = all(ctx);
  const inputs = kpiOf(ks, "inputs");
  assert.equal(inputs.parts.find((p) => p.key === "hours").value, 6);
  assert.equal(inputs.met, false, "6 of 24 hours");
}

// ---- versions: the run belongs to the version live at its issue time
{
  const versions = [
    { id: "a", from: "2026-10-22T00:00:00Z" },
    { id: "b", from: "2026-10-26T05:13:20Z" },
    { id: "c", from: "2026-10-29T06:37:17Z" },
  ];
  const at = (iso, mv) => ({ issued_at: Date.parse(iso), model_version: mv ?? "x" });
  assert.equal(versionAt(versions, at("2026-10-21T00:00:00Z")), null, "before the first version");
  assert.equal(versionAt(versions, at("2026-10-25T00:00:00Z")), "a");
  assert.equal(versionAt(versions, at("2026-10-26T05:13:20Z")), "b", "exactly at the deploy");
  assert.equal(versionAt(versions, at("2026-10-29T07:00:00Z")), "c");
  assert.equal(versionAt([{ id: "m", from: "2026-10-22T00:00:00Z", modelVersion: "^2026" }], at("2026-10-25T00:00:00Z", "2025-01")), null, "a matcher that does not fit");
  // per-version KPIs come from the runs of that version only
  const lines = [], rd = hours(60, flat(5));
  for (let i = 0; i < 40; i++) {
    const ts = T0 + i * HOUR;
    lines.push(mkLine("A", ts, 5, { horizons: [h(ts, 1, 5, 4, 6)] }));
  }
  const cut = new Date(T0 + 20 * HOUR).toISOString();
  const ctx = build(lines, { A: rd }, [{ id: "old", from: "2026-10-22T00:00:00Z" }, { id: "new", from: cut }]);
  assert.equal(ctx.runs.filter((r) => r.version === "old").length, 20);
  const oldCov = kpiOf(kpiSet(ctx, { sel: (r) => r.version === "old", today: "2026-11-05" }), "coverage");
  assert.equal(oldCov.n, 20);
}

// ---- shadow variants: scored with the same maths on their own points
{
  const rd = hours(40, flat(5)), lines = [];
  for (let i = 0; i < 30; i++) {
    const ts = T0 + i * HOUR;
    lines.push(mkLine("A", ts, 5, { horizons: [h(ts, 6, 5, 4, 6)], shadows: { cand: [{ h: 6, ts: ts + 6 * HOUR, level: 5.4, low: 4.5, high: 5.5 }] } }));
  }
  const ctx = build(lines, { A: rd });
  assert.deepEqual(variantsOf(lines), ["cand"]);
  const ks = kpiSet(ctx, { variant: "cand", today: "2026-11-05" });
  assert.equal(ks.length, 5);
  assert.equal(kpiOf(ks, "bias").n, 0, "bias is judged at 12 h only");
  assert.equal(kpiOf(ks, "coverage").parts.find((p) => p.key === "h6").value, 100, "5 ft is inside the candidate's 4.5-5.5 range");
  assert.equal(kpiOf(ks, "bias").n, 0);
}

// ---- summary and history.csv
{
  const ks = [{ met: true }, { met: false }, { met: null }];
  assert.deepEqual(summarise(ks), { met: 1, assessable: 2, total: 3, notJudged: 1 });
  const k = [{ key: "warned", parts: [{ key: "caught", value: 50, target: 80, met: false, n: 6 }] }];
  const rows = historyRows("2026-10-27", "live", k);
  assert.deepEqual(rows, ["2026-10-27,live,warned,caught,50,80,no,6"]);
  const t1 = upsertHistory("", "2026-10-27", rows);
  assert.ok(t1.startsWith(HISTORY_HEADER + "\n"));
  assert.equal(upsertHistory(t1, "2026-10-27", rows), t1, "idempotent");
  const t2 = upsertHistory(t1, "2026-10-26", rows.map((r) => r.replace("2026-10-27", "2026-10-26")));
  assert.equal(t2.split("\n")[1].slice(0, 10), "2026-10-26", "days stay in order");
}

// =====================================================================================================================
// Logging and spec 2 (11 Nov 2026 audit): provenance-free pure parts. Spec 1 is the default and must not change.
// =====================================================================================================================
const NEXT = "2026-10-28"; // the day after DAY
const ev1 = (ctx, st) => ctx.events.filter((e) => e.station === st);

// ---- A2: reading jitter. A fast gauge needs 2 h; the warning starts 1.9 h before the crossing: strict = missed (jitter), spec 2 = caught
{
  const rd = [];
  for (let i = 0; i < 12; i++) rd.push({ ts: T0 + i * HOUR, level: 3 + (i % 2) * 0.01 });
  rd.push({ ts: T0 + 12 * HOUR, level: 6 });
  rd.push({ ts: T0 + 13 * HOUR, level: 6.01 });
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(mkLine("Kithulgala", T0 + i * HOUR, 3, { crossings: [{ threshold: "alert", level: 5, probability: 0 }] }));
  const j = T0 + 10 * HOUR + 6 * 60_000; // 10:06 -> 1.9 h before the crossing reading at 12:00
  lines.push(mkLine("Kithulgala", j, 3, { crossings: [{ threshold: "alert", level: 5, probability: 0.4 }] }));
  lines.push(mkLine("Kithulgala", T0 + 11 * HOUR, 3, { crossings: [{ threshold: "alert", level: 5, probability: 0.4 }] }));
  const ctx = build(lines, { Kithulgala: rd });
  const w1 = kpiOf(all(ctx), "warned"), w2 = kpiOf(all(ctx, { spec: SPEC2 }), "warned");
  assert.equal(w1.n, 1);
  assert.equal(w1.detail.list[0].leadH, 1.9);
  assert.equal(w1.detail.caught, 0, "spec 1: 1.9 h < 2 h is a miss");
  assert.equal(w2.detail.caught, 1, "spec 2: within 0.25 h of the need counts");
  const [rec] = ledgerRecords(ctx);
  assert.equal(rec.reason, "jitter");
  assert.equal(rec.caught, false);
  assert.equal(rec.caughtTol, true);
  assert.equal(rec.needH, 2);
  assert.equal(rec.runsInWindow, 2,"the window is the runs in the 2 h before the crossing");
  assert.equal(rec.minShown, 0.4);
  assert.equal(rec.shownLast, 0.4);
  assert.equal(rec.rawLast, 0.4);
  assert.equal(rec.firstShownAt, new Date(j).toISOString());
}

// ---- A1: a negative is accepted when the readings bracket the 24 h window (last in-window reading at or after 22 h, next one beyond 24 h)
{
  const rd = [];
  for (let i = 0; i <= 22; i++) rd.push({ ts: T0 + i * HOUR, level: 2 + (i % 2) * 0.01 });
  rd.push({ ts: T0 + 25 * HOUR, level: 2 });
  const lines = [mkLine("Deduru", T0, 2, { crossings: [{ threshold: "alert", level: 4, probability: 0.7 }] })];
  const ctx = build(lines, { Deduru: rd });
  const run = ctx.runs[0];
  assert.equal(reachedWithin24h(ctx, run, 4), null, "spec 1: no reading at 23 h or later inside the window: cannot tell");
  assert.equal(reachedWithin24h(ctx, run, 4, SPEC2), false, "spec 2: bracketed by 22 h and 25 h");
  assert.equal(kpiOf(all(ctx), "falseAlarms").detail.likely.n, 0);
  const fa2 = kpiOf(all(ctx, { spec: SPEC2 }), "falseAlarms").detail.likely;
  assert.equal(fa2.n, 1);
  assert.equal(fa2.didNot, 1);
  // a reading that reached the step still wins, and a gap that is too long is not bracketed
  const rdGap = rd.filter((p) => p.ts <= T0 + 10 * HOUR).concat([{ ts: T0 + 25 * HOUR, level: 2 }]);
  assert.equal(reachedWithin24h(build(lines, { Deduru: rdGap }), build(lines, { Deduru: rdGap }).runs[0], 4, SPEC2), null, "a 15 h hole in the readings is not bracketing");
  const rdHit = rd.map((p, i) => (i >= 5 && i <= 9 ? { ts: p.ts, level: 4.5 + i * 0.01 } : p)); // a real rise, not a one-reading spike
  assert.equal(reachedWithin24h(build(lines, { Deduru: rdHit }), build(lines, { Deduru: rdHit }).runs[0], 4, SPEC2), true);
}

// ---- A3: an event that straddles midnight. Spec 1 per-day scope cuts the stretch at midnight, spec 2 looks back through all runs.
{
  const lines = [], rd = [];
  for (let i = 0; i < 26; i++) rd.push({ ts: T0 + i * HOUR, level: 8 + (i % 2) * 0.01 });
  for (let i = 26; i < 34; i++) rd.push({ ts: T0 + i * HOUR, level: 11 }); // crosses the 10 ft alert at hour 26 = 04:00 on the next day
  for (let i = 8; i < 26; i++) {
    const ts = T0 + i * HOUR;
    lines.push(mkLine("Hanwella", ts, rd[i].level, { day: ts < dayStart(NEXT) ? DAY : NEXT, crossings: [{ threshold: "alert", level: 10, probability: i >= 10 ? 0.6 : 0 }] }));
  }
  const ctx = build(lines, { Hanwella: rd });
  assert.equal(ctx.events.length, 1);
  assert.equal(ctx.events[0].day, NEXT);
  const d1 = kpiSet(ctx, { sel: (r) => r.day === NEXT, events: ctx.events.filter((e) => e.day === NEXT), today: "2026-11-05" });
  const d2 = kpiSet(ctx, { sel: (r) => r.day === NEXT, events: ctx.events.filter((e) => e.day === NEXT), today: "2026-11-05", spec: SPEC2 });
  assert.equal(kpiOf(d1, "warned").detail.list[0].leadH, 4, "spec 1: the day's own runs only (22:00-02:00 are the previous day)");
  assert.equal(kpiOf(d1, "warned").detail.caught, 0);
  assert.equal(kpiOf(d2, "warned").detail.list[0].leadH, 16, "spec 2: all runs back to hour 10");
  assert.equal(kpiOf(d2, "warned").detail.caught, 1);
  const [rec] = ledgerRecords(ctx);
  assert.equal(rec.leadH, 16, "the ledger is not truncated at midnight");
  assert.equal(rec.caught, true);
  assert.equal(rec.truncated, true, "the runs begin only 18 h before the event: less than the 48 h look-back, so the record is flagged cut short");
  assert.equal(ctx.events[0].version, null);
}

// ---- ledger reasons: never-warned, dip, run-gap, late-start, unscored
{
  const lines = [], obs = {};
  const mk = (st, f, skip = []) => {
    obs[st] = hours(30, (i) => (i < 20 ? 5 + (i % 2) * 0.01 : 8)); // alert at 7.5 ft crossed at hour 20
    for (let i = 0; i < 20; i++) if (!skip.includes(i)) lines.push(mkLine(st, T0 + i * HOUR, 5, { crossings: [{ threshold: "alert", level: 7.5, probability: f(i) }] }));
  };
  mk("Hanwella", () => 0);                                              // never shown
  mk("Dunamale", (i) => (i === 17 ? 0.1 : i >= 10 ? 0.5 : 0));          // 50%, a dip at hour 17, 50% again: lead 2 h of 6
  mk("Wilgamuwa", () => 0.5, [15, 16, 17]);                              // 50% but no runs 15-17: a 4 h gap ends the stretch
  mk("Glencourse", (i) => (i >= 17 ? 0.5 : 0));                          // 50% only in the last 3 runs: late start
  mk("Dambulla", (i) => (i >= 5 ? 0.5 : 0));                             // 15 h of warning: caught
  obs.Thalgahagoda = hours(30, (i) => (i < 20 ? 5 + (i % 2) * 0.01 : 8)); // runs stop 5 h before the crossing: unscored
  for (let i = 0; i < 15; i++) lines.push(mkLine("Thalgahagoda", T0 + i * HOUR, 5, { crossings: [{ threshold: "alert", level: 7.5, probability: 0.5 }] }));
  const ctx = build(lines, obs);
  const recs = Object.fromEntries(ledgerRecords(ctx).map((r) => [r.station, r]));
  assert.equal(recs.Hanwella.reason, "never-warned");
  assert.equal(recs.Dunamale.reason, "dip");
  assert.equal(recs.Dunamale.leadH, 2);
  assert.equal(recs.Wilgamuwa.reason, "run-gap");
  assert.equal(recs.Glencourse.reason, "late-start");
  assert.equal(recs.Dambulla.reason, null);
  assert.equal(recs.Dambulla.caught, true);
  assert.equal(recs.Thalgahagoda.reason, "unscored");
  assert.equal(recs.Thalgahagoda.scored, false);
  assert.equal(recs.Thalgahagoda.caught, null);
  assert.equal(recs.Hanwella.minShown, 0);
  assert.equal(recs.Dunamale.minShown, 0.1);
  assert.equal(recs.Dunamale.runsInWindow, 6);
  assert.ok(recs.Dunamale.firstShownAt, "first shown >= 20% in the 48 h before");
  assert.equal(recs.Hanwella.firstShownAt, null);
  // KPI 1 keeps scoring exactly the scored ones
  assert.equal(kpiOf(all(ctx), "warned").n, 5);
}

// ---- window edge (verifier finding, 11 Nov): the oldest days of a window have no runs before them, so a rewrite from a window that starts later must not
// replace what a longer window stored (ledger records, history-wide rows, the caught columns of the gauge table)
{
  const mkCtx = (fromHour, toHour) => {
    const rd = [];
    for (let i = -40; i < 34; i++) rd.push({ ts: T0 + i * HOUR, level: i < 26 ? 8 + (i % 2) * 0.01 : 11 }); // crosses the 10 ft alert at hour 26 = 04:00 next day
    const lines = [];
    for (let i = fromHour; i < toHour; i++) {
      const ts = T0 + i * HOUR;
      lines.push(mkLine("Hanwella", ts, rd[i + 40].level, { day: ts < dayStart(NEXT) ? DAY : NEXT, crossings: [{ threshold: "alert", level: 10, probability: i >= 10 ? 0.6 : 0 }] }));
    }
    return build(lines, { Hanwella: rd });
  };
  const full = mkCtx(-30, 26), cut = mkCtx(22, 26), noRuns = mkCtx(26, 27);
  const [rFull] = ledgerRecords(full), [rCut] = ledgerRecords(cut), [rNone] = ledgerRecords(noRuns);
  assert.equal(rFull.truncated, false);
  assert.equal(rFull.leadH, 16); assert.equal(rFull.caught, true);
  assert.equal(rCut.truncated, true, "runs begin less than 48 h before the event");
  assert.equal(rCut.caught, false, "4 h of look-back is not the 16 h the full window saw");
  assert.equal(rNone.reason, "unscored"); assert.equal(rNone.truncated, true, "no run before the event because the window starts after it, not because the gauge was silent");
  const stored = upsertLedger("", [rFull]);
  assert.equal(upsertLedger(stored, [rCut]), stored, "a cut-short window does not replace the full record");
  assert.equal(upsertLedger(stored, [rNone]), stored, "nor does an unscored one from a window that starts after the runs");
  assert.equal(upsertLedger(upsertLedger("", [rCut]), [rFull]), stored, "the full record replaces a cut-short one");
  // the gauge table's caught columns come from the stored record: the same output whichever window computed the day
  const g = (ctx, led) => gaugeTable(ctx, NEXT, led);
  assert.equal(g(cut, [JSON.parse(stored)]), g(full, [rFull]), "gauge table of the last night in the window equals the night it was a full day");
  assert.notEqual(g(cut, [rCut]), g(full, [rFull]), "(with this run's own cut-short record the caught columns would differ)");
  // history-wide: rows of a day at the window edge are kept once written, a non-edge night rewrites them
  const r1 = ["2026-10-27,all,2,warned,caught,83.3,80,yes,6,681,6,,"], r2 = ["2026-10-27,all,2,warned,caught,40,80,no,5,681,5,,"];
  const t1 = upsertWideEdge("", "2026-10-27", r1, false);
  assert.equal(upsertWideEdge(t1, "2026-10-27", r2, true), t1, "edge night: existing rows kept");
  assert.ok(upsertWideEdge("", "2026-10-27", r2, true).includes(r2[0]), "edge day with no rows yet (first night of a window) is written");
  assert.ok(upsertWideEdge(t1, "2026-10-27", r2, false).includes(r2[0]), "a non-edge night rewrites");
}

// ---- event ledger: idempotent upsert keyed by station|step|ts, a truncated record never replaces a full one
{
  const a = { station: "A", step: "alert", ts: 1000, leadH: 5, truncated: false };
  const b = { station: "B", step: "minor", ts: 500, leadH: 3, truncated: false };
  const t1 = upsertLedger("", [a, b]);
  assert.equal(t1.split("\n").filter(Boolean).length, 2);
  assert.equal(JSON.parse(t1.split("\n")[0]).station, "B", "time order");
  assert.equal(upsertLedger(t1, [a, b]), t1, "idempotent");
  assert.equal(upsertLedger(t1, [{ ...a, leadH: 7, truncated: true }]), t1, "a truncated look-back does not overwrite a full record");
  const t2 = upsertLedger(t1, [{ ...a, leadH: 9 }]);
  assert.equal(JSON.parse(t2.split("\n")[1]).leadH, 9, "a newer full record replaces");
  assert.equal(upsertLedger(t1 + "not json\n", []).split("\n").filter(Boolean).length, 2, "a damaged line is skipped");
  assert.equal(upsertLedger(null, []), "");
}

// ---- C9: one run per station-hour before KPIs 7-9
{
  const rd = [];
  for (let i = 0; i < 40; i++) rd.push({ ts: T0 + i * HOUR, level: 5 + i * 0.5 });
  const lines = [];
  for (let i = 3; i < 13; i++) {
    const ts = T0 + i * HOUR, cur = 5 + i * 0.5;
    const hz = { horizons: [h(ts, 1, cur + 0.5, cur - 1, cur + 1)] };
    lines.push(mkLine("A", ts, cur, hz), mkLine("A", ts + 600_000, cur, hz)); // run twice in the hour
  }
  const ctx = build(lines, { A: rd });
  assert.equal(dedupeRuns(ctx.runs).length, 10);
  assert.equal(dedupeRuns(ctx.runs).every((r, i, a) => i === 0 || a[i - 1].ts < r.ts), true);
  assert.equal(dedupeRuns(ctx.runs).find((r) => r.ts % HOUR !== 0 || true).ts >= T0, true);
  const k1 = all(ctx), k2 = all(ctx, { spec: SPEC2 });
  assert.equal(kpiOf(k1, "fastRises").n, 20, "spec 1 counts the duplicates");
  assert.equal(kpiOf(k2, "fastRises").n, 10, "spec 2 counts each station-hour once");
  assert.equal(kpiOf(k1, "inputs").parts.find((p) => p.key === "flaggedShare").n, 20);
  assert.equal(kpiOf(k2, "inputs").parts.find((p) => p.key === "flaggedShare").n, 10);
}

// ---- spec 1 values do not depend on the new logging: internal keys are dropped from the JSON, parts carry runs and clusters
{
  const lines = [], rd = hours(40, flat(2));
  for (let i = 0; i < 5; i++) lines.push(mkLine("Deduru", T0 + i * HOUR, 2, { crossings: [{ threshold: "alert", level: 4, probability: 0.7 }] }));
  const ks = all(build(lines, { Deduru: rd }));
  const fa = kpiOf(ks, "falseAlarms");
  assert.equal(fa.parts[1]._clusters, 1, "one gauge-step-day behind the likely share");
  assert.equal(fa.parts[1]._runs, 5);
  const txt = JSON.stringify(ks, dropInternal);
  assert.ok(!txt.includes("_clusters") && !txt.includes("_runs") && !txt.includes("_exact"));
  assert.deepEqual(kpiOf(all(build(lines, { Deduru: rd }), { spec: SPEC1 }), "falseAlarms").parts.map((p) => p.value), fa.parts.map((p) => p.value));
}

// ---- full-system variants: a variant that copies live scores exactly like live on the same runs
{
  const lines = [], rd = [];
  for (let i = 0; i < 80; i++) rd.push({ ts: T0 - 6 * HOUR + i * HOUR, level: 5 + Math.max(0, i - 20) * 0.4 + (i % 2) * 0.01 });
  for (let i = 0; i < 40; i++) {
    const ts = T0 + i * HOUR, cur = rd[i + 6].level;
    const hz = [h(ts, 1, cur + (i % 3 ? 0.4 : 0), cur - 0.5, cur + 0.9), h(ts, 6, cur + 1.5, cur, cur + 3), h(ts, 12, cur + 2, cur, cur + 4)];
    lines.push(mkLine("Hanwella", ts, Math.round(cur * 1000) / 1000, {
      horizons: hz, crossings: [{ threshold: "alert", level: 9, probability: i >= 10 ? 0.6 : 0.1 }, { threshold: "minor", level: 14, probability: 0.1 }],
      shadows: { copy: hz.map((p) => ({ h: p.h, ts: p.ts, level: p.level, low: p.low, high: p.high })) },
    }));
  }
  const ctx = build(lines, { Hanwella: rd });
  assert.deepEqual(systemsOf(lines), [], "shadow levels only: not a system");
  const sel = (r) => !!r.sh?.copy;
  for (const spec of [SPEC1, SPEC2]) {
    const sys = systemSet(ctx, { variant: "copy", spec }), live = kpiSet(ctx, { sel, today: "2026-11-05", spec }).slice(0, 8);
    assert.equal(sys.length, 8);
    for (let i = 0; i < 8; i++) {
      const strip = (k) => JSON.parse(JSON.stringify({ value: k.value, n: k.n, met: k.met, parts: k.parts, detail: k.detail }, dropInternal));
      assert.deepEqual(strip(sys[i]), strip(live[i]), `spec ${spec.id}: system copy = live on KPI ${i + 1}`);
      const vnm = (k) => ({ value: k.value, n: k.n, met: k.met, parts: k.parts.map((p) => [p.key, p.value, p.n, p.met]) });
      assert.deepEqual(vnm(sys[i].baseline), vnm(live[i]), `spec ${spec.id}: baseline = live on KPI ${i + 1}`);
    }
  }
  assert.ok(kpiOf(systemSet(ctx, { variant: "copy" }), "warned").n >= 1, "the fixture does have a scored event");
  // candidate chances + its own next-hour rate make it differ: KPIs 1-3 take the candidate's chances, 7-8 its shadow_nh
  const sysLines = lines.map((l) => ({ ...l, candidates: { copy: [{ threshold: "alert", shown: 0.9 }] }, shadow_nh: { copy: 0.5 } }));
  assert.deepEqual(systemsOf(sysLines), ["copy"]);
  const ctx2 = build(sysLines, { Hanwella: rd });
  const s2 = systemSet(ctx2, { variant: "copy" });
  assert.equal(kpiOf(s2, "fastRises").value, 100, "shadow_nh 0.5 m/h = Rising on every run");
  assert.ok(kpiOf(s2, "fastRises").baseline.value < 100, "live on the same runs did not call them all");
  assert.ok(kpiOf(s2, "warned").value >= kpiOf(s2, "warned").baseline.value, "90% chances can only warn earlier");
  assert.equal(kpiOf(s2, "warned").baseline.n, kpiOf(s2, "warned").n, "same events on both sides");
}

// ---- history-wide.csv rows
{
  const k = [
    { id: 1, key: "warned", parts: [{ key: "caught", value: 66.7, target: 80, met: false, n: 60, _runs: 900, _clusters: 60 }], baseline: { parts: [{ key: "caught", value: 56.7, n: 60 }] } },
    { id: 2, key: "falseAlarms", parts: [{ key: "possible", value: null, target: 60, met: null, n: 0, _runs: 900, _clusters: 0 }, { key: "likely", value: 10, target: 25, met: true, n: 12, _runs: 900, _clusters: 12 }] },
    { id: 6, key: "coverage", parts: [{ key: "h1", value: 74.6, target: "75-85", met: false, n: 5, _runs: 5, _clusters: 2 }] },
  ];
  const rows = wideRows("2026-11-10", "variant:x", 2, k);
  assert.deepEqual(rows, [
    "2026-11-10,variant:x,2,warned,caught,66.7,80,no,60,900,60,56.7,60",
    "2026-11-10,variant:x,2,falseAlarms,likely,10,25,yes,12,900,12,,",
    "2026-11-10,variant:x,2,coverage,h1,74.6,75-85,no,5,5,2,,",
  ], "an empty part is left out; baseline columns come from the baseline on the same runs");
  assert.equal(rows.every((r) => r.split(",").length === WIDE_HEADER.split(",").length), true);
  const t1 = upsertWide("", "2026-11-10", rows);
  assert.ok(t1.startsWith(WIDE_HEADER + "\n"));
  assert.equal(upsertWide(t1, "2026-11-10", rows), t1, "idempotent");
  const t2 = upsertWide(t1, "2026-11-09", rows.map((r) => r.replace("2026-11-10", "2026-11-09")));
  assert.equal(t2.split("\n")[1].slice(0, 10), "2026-11-09", "days in order");
  assert.equal(upsertWide(t2, "2026-11-10", rows.slice(0, 1)).split("\n").filter((l) => l.startsWith("2026-11-10")).length, 1, "a day's rows are replaced as a set");
}

// ---- per-gauge daily table and missing-day helper
{
  const lines = [], rd = hours(40, flat(5));
  for (let i = 0; i < 24; i++) {
    const ts = T0 + i * HOUR;
    lines.push(mkLine("A, Bridge", ts, 5, { horizons: [h(ts, 1, 5, 4, 6)] }));
  }
  const csv = gaugeTable(build(lines, { "A, Bridge": rd }), DAY, []);
  const [head, row] = csv.trim().split("\n");
  assert.ok(head.startsWith("day,station,runs,flagged_runs,events,caught,caught_tol,n_1,mae_1"));
  assert.ok(row.startsWith(`${DAY},"A, Bridge",24,0,0,0,0,`), row);
  const m = missingDays(new Set(["2026-11-07", "2026-11-09"]), "2026-10-12", "2026-11-10", ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]);
  assert.deepEqual(m, { firstDay: "2026-11-07", missing: ["2026-11-08", "2026-11-10"] });
  assert.deepEqual(missingDays(new Set(), "a", "b", ["a"]), { firstDay: null, missing: [] }, "a folder that has not started is not missing days");
}

console.log("forecast-kpi: ok");
