// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/forecast-kpi.test.mts
import assert from "node:assert/strict";
import { HOUR, FT, buildReadings, dayStart } from "../lib/forecastScoreboard.mjs";
import {
  buildContext, historyRows, kpiSet, mergeReadings, phaseOf, summarise, upsertHistory, variantsOf, versionAt, HISTORY_HEADER,
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
console.log("forecast-kpi: ok");
