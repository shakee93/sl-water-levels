// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/warning-candidates.test.mts
// Warning-rule candidates (lib/warningCandidates.mjs): each rule fires / does not fire, dry-hold never raises, the add rules never lower,
// heavy rain blocks dry-hold, and lib/forecastKpi.mjs scores KPI 1-3 per variant from the archive `candidates` field.
import assert from "node:assert/strict";
import { DRY_HOLD, POSSIBLE_P, shownChance } from "../lib/forecastRules.mjs";
import { PARAMS, dryHold, dryHoldApplies, rainOnset, upstreamTrigger, warningCandidates } from "../lib/warningCandidates.mjs";
import { HOUR, buildArchiveLines, buildReadings, dayStart } from "../lib/forecastScoreboard.mjs";
import { buildContext, kpiSet, mergeReadings, variantsOf } from "../lib/forecastKpi.mjs";

const FT = 0.3048, T0 = Date.parse("2026-10-27T12:00:00Z");

// ---- constants (the evidence is in lib/forecastRules.mjs)
assert.equal(DRY_HOLD.PAST6H_MM, 1);
assert.ok(DRY_HOLD.CAP < POSSIBLE_P, "a held chance reads below the possible mark");
assert.equal(DRY_HOLD.NEXT24H_MM, 25);
assert.equal(DRY_HOLD.P90_MM, 50);

// ---- 1. dry-hold
const DRY = { rainPast6hMm: 0.2, rate3hM: 0, rainNext24hMm: 4, rainNext24hP90Mm: 12, storm: false, rainRisk: false };
const CR = [{ threshold: "alert", level: 10, probability: 0.55 }, { threshold: "minor", level: 14, probability: 0.9 }, { threshold: "major", level: 18, probability: 0.05 }];
{
  assert.equal(dryHoldApplies(DRY), true);
  const rows = dryHold(DRY, CR, 8);
  assert.deepEqual(rows.map((r) => [r.threshold, r.shown]), [["alert", DRY_HOLD.CAP], ["minor", DRY_HOLD.CAP]], "alert 55% and minor 30% (capped) are held; major 5% is already under");
  // a step the gauge is already above is not touched
  assert.deepEqual(dryHold(DRY, CR, 11).map((r) => r.threshold), ["minor"]);
  // the limits are strict: 1 mm of rain is not dry, a steady rate is, a rising one is not
  assert.equal(dryHoldApplies({ ...DRY, rainPast6hMm: 1 }), false);
  assert.equal(dryHoldApplies({ ...DRY, rainPast6hMm: 0.99 }), true);
  assert.equal(dryHoldApplies({ ...DRY, rate3hM: 0.0061 }), false, "rising");
  assert.equal(dryHoldApplies({ ...DRY, rate3hM: 0.006 }), true, "steady band");
  assert.equal(dryHoldApplies({ ...DRY, rate3hM: -0.2 }), true, "falling");
  // safety: heavy rain coming, a rain-risk warning or a storm flag blocks the hold; unknown inputs block it too
  assert.equal(dryHoldApplies({ ...DRY, rainNext24hMm: 25 }), false, "25 mm forecast");
  assert.equal(dryHoldApplies({ ...DRY, rainNext24hMm: 40 }), false);
  assert.equal(dryHoldApplies({ ...DRY, rainNext24hP90Mm: 50 }), false, "p90 50 mm");
  assert.equal(dryHoldApplies({ ...DRY, rainNext24hP90Mm: null }), true, "a missing p90 is not heavy");
  assert.equal(dryHoldApplies({ ...DRY, storm: true }), false);
  assert.equal(dryHoldApplies({ ...DRY, rainRisk: true }), false);
  assert.equal(dryHoldApplies({ ...DRY, storm: null }), false, "storm flag unknown");
  assert.equal(dryHoldApplies({ ...DRY, rainPast6hMm: null }), false, "unknown rain: no hold");
  assert.equal(dryHoldApplies({ ...DRY, rate3hM: null }), false, "unknown rate: no hold");
  assert.equal(dryHoldApplies({ ...DRY, rainNext24hMm: null }), false);
  assert.deepEqual(dryHold({ ...DRY, rainNext24hMm: 60, rainNext24hP90Mm: 120, storm: true }, CR, 8), [], "heavy rain forecast: the chance is left alone");
  // never raises: sweep the input space; every row is at or below live and below the possible mark
  for (const p of [0, 0.05, 0.2, 0.5, 0.9, 1]) for (const past of [0, 0.5, 1, 3]) for (const rate of [-0.1, 0, 0.01]) for (const n24 of [0, 10, 30]) for (const storm of [false, true]) {
    const crs = ["alert", "minor", "major"].map((t, i) => ({ threshold: t, level: 10 + 4 * i, probability: p }));
    for (const r of dryHold({ rainPast6hMm: past, rate3hM: rate, rainNext24hMm: n24, rainNext24hP90Mm: n24 * 2, storm, rainRisk: false }, crs, 9)) {
      const live = shownChance(r.threshold, p);
      assert.ok(r.shown <= live && r.shown < POSSIBLE_P, `dry-hold only lowers (${r.threshold} ${p})`);
    }
  }
}

// ---- 2. rain-onset
/** readings in the gauge's own unit from feet, hourly for 8 h ending at T0 */
const series = (unit, ftNow, ftThen3h, n = 9) => {
  const k = unit === "m" ? FT : 1;
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i; // hours before now
    const ft = back >= 3 ? ftThen3h + (back - 3) * 0.01 : ftThen3h + ((ftNow - ftThen3h) * (3 - back)) / 3;
    return { ts: T0 - back * HOUR, level: ft * k };
  });
};
const snap = (st, unit, ftNow, ftThen) => ({ [st]: { unit, readings: series(unit, ftNow, ftThen) } });
const RAIN = (n6, n12 = null) => ({ ts: T0, next: { 6: n6, 12: n12 } });
{
  const fast = PARAMS.rainOnset.rules.find((r) => r.name === "fast-rain-onset"), slow = PARAMS.rainOnset.rules.find((r) => r.name === "slow-rain-onset");
  assert.ok(fast.gauges.includes("Panadugama") && !fast.gauges.includes("Norwood"), "Norwood is not in the fast rule (0 of 9)");
  assert.equal(fast.R, 15); assert.equal(fast.G, 0.75); assert.equal(fast.chance, 0.45);
  // Holombuwa: alert 9.843, usual 1.476 -> distance 8.367; within 75% = above 3.57 ft; rising = 3 h rise >= 0.42 ft
  const ok = rainOnset(snap("Holombuwa", "m", 6, 4), T0, { Holombuwa: [RAIN(20)] });
  assert.equal(ok.Holombuwa.chance, 0.45); assert.equal(ok.Holombuwa.threshold, "alert"); assert.equal(ok.Holombuwa.etaHours, 2);
  assert.deepEqual(Object.keys(rainOnset(snap("Holombuwa", "m", 6, 4), T0, { Holombuwa: [RAIN(14.9)] })), [], "14.9 mm is under the 15 mm bar");
  assert.deepEqual(Object.keys(rainOnset(snap("Holombuwa", "m", 6, 6), T0, { Holombuwa: [RAIN(30)] })), [], "not rising");
  assert.deepEqual(Object.keys(rainOnset(snap("Holombuwa", "m", 2.5, 1.5), T0, { Holombuwa: [RAIN(30)] })), [], "too far from the step");
  assert.deepEqual(Object.keys(rainOnset(snap("Holombuwa", "m", 10.5, 8), T0, { Holombuwa: [RAIN(30)] })), [], "already at the step");
  assert.deepEqual(Object.keys(rainOnset(snap("Norwood", "m", 4, 2), T0, { Norwood: [RAIN(30)] })), [], "no rule for Norwood");
  assert.deepEqual(Object.keys(rainOnset(snap("Holombuwa", "m", 6, 4), T0, { Holombuwa: [RAIN(null)] })), [], "unknown rain: nothing");
  assert.deepEqual(Object.keys(rainOnset(snap("Holombuwa", "m", 6, 4), T0, {})), [], "no rain answer: nothing");
  // 3 h hold: the rain bar was met 2 h ago (rain since fell short of 15 mm as it came down), the river still below the step and rising
  const held = rainOnset(snap("Holombuwa", "m", 8, 4), T0, { Holombuwa: [RAIN(9), { ts: T0 - 2 * HOUR, next: { 6: 20, 12: 25 } }] });
  assert.equal(held.Holombuwa?.etaHours, 1, "held: arrival p50 2 h minus 2 h since, at least 1 h");
  assert.deepEqual(Object.keys(rainOnset(snap("Holombuwa", "m", 8, 4), T0, { Holombuwa: [RAIN(9), { ts: T0 - 4 * HOUR, next: { 6: 20, 12: 25 } }] })), [], "the hold lasts 3 h");
  // slow rule: Hanwella alert 21.325, usual 3.303 -> within 25% = above 16.82 ft; >= 25 mm in 12 h; no rise needed
  const sl = rainOnset(snap("Hanwella", "ft", 18, 18), T0, { Hanwella: [RAIN(5, 30)] });
  assert.equal(sl.Hanwella.chance, slow.chance); assert.equal(sl.Hanwella.etaHours, 8);
  assert.deepEqual(Object.keys(rainOnset(snap("Hanwella", "ft", 15, 15), T0, { Hanwella: [RAIN(5, 30)] })), [], "slow rule: not close enough");
  assert.deepEqual(Object.keys(rainOnset(snap("Hanwella", "ft", 18, 18), T0, { Hanwella: [RAIN(5, 20)] })), [], "slow rule: 20 mm in 12 h is under 25");
  // glitch in the readings does not fire it: one 12 ft spike at Holombuwa
  const spiky = snap("Holombuwa", "m", 2, 2);
  spiky.Holombuwa.readings[8] = { ts: T0, level: 12 * FT };
  assert.deepEqual(Object.keys(rainOnset(spiky, T0, { Holombuwa: [RAIN(30)] })), [], "a one-reading spike is cleaned first");
}

// ---- 3. upstream
{
  const rule = PARAMS.upstream.rules[0];
  assert.equal(rule.up, "Nawalapitiya"); assert.equal(rule.down, "Peradeniya"); assert.equal(rule.chance, 0.45);
  // Nawalapitiya alert 11.483 ft: crosses 2 h ago; Peradeniya (alert 16.404) at 8 ft
  const mk = (crossAgo, perad = 8, naw0 = 9.5, naw1 = 12.5) => ({
    Nawalapitiya: { unit: "ft", readings: Array.from({ length: 25 }, (_, i) => { const back = 24 - i; return { ts: T0 - back * HOUR, level: back <= crossAgo ? naw1 : naw0 + (back % 2) * 0.01 }; }) },
    Peradeniya: { unit: "ft", readings: Array.from({ length: 25 }, (_, i) => ({ ts: T0 - (24 - i) * HOUR, level: perad + (i % 2) * 0.01 })) },
  });
  const u = upstreamTrigger(mk(2), T0);
  assert.equal(u.Peradeniya.chance, 0.45); assert.equal(u.Peradeniya.firedHoursAgo, 2); assert.equal(u.Peradeniya.etaHours, 3); assert.equal(u.Peradeniya.upstream, "Nawalapitiya");
  assert.deepEqual(Object.keys(upstreamTrigger(mk(-1), T0)), [], "upstream has not crossed");
  assert.deepEqual(Object.keys(upstreamTrigger(mk(9), T0)), [], "crossed 9 h ago: past the window");
  assert.deepEqual(Object.keys(upstreamTrigger(mk(2, 17), T0)), [], "downstream is already above its step");
  assert.deepEqual(Object.keys(upstreamTrigger({ Peradeniya: mk(2).Peradeniya }, T0)), [], "no upstream readings");
  assert.deepEqual(Object.keys(upstreamTrigger(mk(2), T0, { rules: [{ ...rule, status: "watch" }] })), [], "only shipped rules run by default");
}

// ---- warningCandidates(): output shape, "only where it differs", add rules never lower, dry-hold never raises
{
  const base = {
    station: "Holombuwa", method: "model", currentLevel: 6 * FT, asOfTs: T0,
    crossings: [{ threshold: "alert", level: 9.843 * FT, probability: 0.1 }, { threshold: "minor", level: 13.123 * FT, probability: 0.02 }, { threshold: "major", level: 20 * FT, probability: 0 }],
    rate3hM: 0.6, rain: { past6hMm: 6, next24hMm: 50, next24hP90Mm: 90, storm: true, rainRisk: true },
    rainBy: [RAIN(20)], snapshot: snap("Holombuwa", "m", 6, 4),
  };
  const out = warningCandidates(base);
  assert.deepEqual(Object.keys(out), ["rain-onset"], "heavy rain: only the add rule fires, dry-hold is blocked");
  assert.deepEqual(out["rain-onset"], [{ threshold: "alert", shown: 0.45, etaHours: 2 }]);
  // live already shows more: no row (add rules never lower, and a candidate equal to live is not logged)
  assert.deepEqual(warningCandidates({ ...base, crossings: [{ ...base.crossings[0], probability: 0.6 }] }), {});
  assert.deepEqual(warningCandidates({ ...base, crossings: [{ ...base.crossings[0], probability: 0.45 }] }), {});
  // a step missing from the live crossings counts as 0 shown
  assert.deepEqual(warningCandidates({ ...base, crossings: [] })["rain-onset"].length, 1);
  // not a fitted-model run, or a gauge with no forecast: nothing
  assert.deepEqual(warningCandidates({ ...base, method: "persistence" }), {});
  assert.deepEqual(warningCandidates({ ...base, station: "Ampara" }), {});
  // a dry calm day with a leftover 55% alert: dry-hold lowers it; the add rules stay quiet
  const dry = warningCandidates({ ...base, crossings: [{ threshold: "alert", level: 9.843 * FT, probability: 0.55 }], rate3hM: 0, rain: { past6hMm: 0, next24hMm: 3, next24hP90Mm: 9, storm: false, rainRisk: false }, rainBy: [RAIN(1)], snapshot: snap("Holombuwa", "m", 6, 6) });
  assert.deepEqual(dry, { "dry-hold": [{ threshold: "alert", shown: DRY_HOLD.CAP, etaHours: null }] });
  // every add-rule row beats live; every dry-hold row is below live
  for (const p of [0, 0.1, 0.3, 0.44, 0.5, 0.9]) {
    const o = warningCandidates({ ...base, crossings: [{ ...base.crossings[0], probability: p }] });
    for (const row of o["rain-onset"] ?? []) assert.ok(row.shown > shownChance("alert", p));
  }
}

// ---- KPI 1-3 per variant from the archive `candidates`
{
  const DAY = "2026-10-27", D0 = dayStart(DAY) + 2 * HOUR;
  const hrs = (n, f) => Array.from({ length: n }, (_, i) => ({ ts: D0 + i * HOUR, level: f(i) }));
  const line = (station, ts, cur, over = {}) => ({ day: DAY, station, basin: "B", issued_at: ts, method: "model", status: "ok", model_version: "v", unit: "ft", current_level: cur, tier: "normal", verdict: "normal", storm: 0, rain_risk: null, horizons: [], crossings: [], shadows: {}, max24: null, cover24: false, ...over });
  const lines = [], obs = {};
  // Holombuwa (fast river): alert 5 ft crossed at hour 12. Live shows 10% until the last hour; the rain-onset candidate shows 45% from hour 6 (lead 6 h)
  obs.Holombuwa = hrs(40, (i) => (i < 12 ? 3 + (i % 2) * 0.01 : 6));
  for (let i = 0; i < 12; i++) lines.push(line("Holombuwa", D0 + i * HOUR, 3, { crossings: [{ threshold: "alert", level: 5, probability: i === 11 ? 0.3 : 0.1 }], candidates: i >= 6 ? { "rain-onset": [{ threshold: "alert", shown: 0.45, eta: 2 }] } : {} }));
  // Deduru: flat, live shows 70% alert all day (false alarm, likely); dry-hold holds it to 15%
  obs.Deduru = hrs(40, (i) => 2 + (i % 2) * 0.01);
  for (let i = 0; i < 6; i++) lines.push(line("Deduru", D0 + i * HOUR, 2, { crossings: [{ threshold: "alert", level: 4, probability: 0.7 }], candidates: { "dry-hold": [{ threshold: "alert", shown: 0.15, eta: null }] } }));
  // Peradeniya: step 8 ft, flat, live shows nothing; the upstream candidate adds 45% in 2 runs (an added step the live run did not list): a false alarm
  obs.Peradeniya = hrs(40, (i) => 4 + (i % 2) * 0.01);
  for (let i = 0; i < 4; i++) lines.push(line("Peradeniya", D0 + i * HOUR, 4, { crossings: i === 0 ? [{ threshold: "alert", level: 8, probability: 0.01 }] : [{ threshold: "alert", level: 8, probability: 0.01 }], candidates: i < 2 ? { upstream: [{ threshold: "alert", shown: 0.45, eta: 3 }] } : {} }));
  const runs = ["Holombuwa", "Deduru", "Peradeniya"].map((s) => ({ station: s, unit: "ft" }));
  const ctx = buildContext({ lines, readings: mergeReadings([buildReadings({ day: DAY, runs, obs })]) });
  assert.deepEqual(variantsOf(lines), ["dry-hold", "rain-onset", "upstream"]);
  const K = (v) => kpiSet(ctx, { variant: v, today: "2026-11-05" });
  const key = (ks, k) => ks.find((x) => x.key === k);
  // rain-onset: the one crossing goes from late (live: 30% only in the last run) to warned 6 h ahead; the 45% on Holombuwa before it happens is not a false alarm
  const ro = K("rain-onset");
  assert.deepEqual(ro.map((k) => k.key), ["warned", "falseAlarms", "honest"]);
  assert.equal(key(ro, "warned").baseline.detail.caught, 0); assert.equal(key(ro, "warned").detail.caught, 1);
  assert.equal(key(ro, "warned").detail.medianLeadH, 6);
  // dry-hold: removes the false alarm group at Deduru (likely) from KPI 2; live (baseline) has it
  const dh = K("dry-hold");
  assert.equal(key(dh, "falseAlarms").baseline.detail.likely.didNot, 1); assert.equal(key(dh, "falseAlarms").detail.likely.n, 0);
  assert.equal(key(dh, "falseAlarms").runsLogged, 22);
  // upstream: an added step is scored; live (1% shown) had no alarm, the candidate has one group that did not happen
  const up = K("upstream");
  assert.equal(key(up, "falseAlarms").baseline.detail.possible.didNot, 0); assert.equal(key(up, "falseAlarms").detail.possible.didNot, 1);
  // honest: the candidate's shown chance replaces live in the bins (Deduru's six 70% runs move to the 10-20% bin)
  const hb = (ks) => key(ks, "honest").detail.bins;
  assert.equal(hb(dh).find((b) => b.from === 0.5).n + 0, hb(dh).find((b) => b.from === 0.5).n);
  assert.equal(hb(dh).find((b) => b.from === 0.1).n - key(dh, "honest").baseline.detail.bins.find((b) => b.from === 0.1).n, 6);
  // live KPIs are untouched by candidates
  const live = kpiSet(ctx, { today: "2026-11-05" });
  assert.equal(live.length, 10);
  // lines without the `candidates` key (days before the log) are "not logged": excluded from a variant, never counted as "same as live"
  const old = lines.map((l) => { const { candidates, ...rest } = l; return rest; });
  const ctx2 = buildContext({ lines: old, readings: mergeReadings([buildReadings({ day: DAY, runs, obs })]) });
  assert.deepEqual(variantsOf(old), []);
  assert.equal(kpiSet(ctx2, { variant: "rain-onset", today: "2026-11-05" }).length, 5, "no candidate rows: falls through to the shadow-level path, which has no points");
  assert.equal(kpiSet(ctx2, { variant: "rain-onset", today: "2026-11-05" }).every((k) => k.n === 0), true);
}

// ---- archive lines carry `candidates` (empty object = logged, nothing differed; key absent = not logged)
{
  const runs = [{ id: 1, station: "A", basin: "B", issued_at: T0, method: "model", status: "ok", unit: "ft", current_level: 3 }, { id: 2, station: "C", basin: "B", issued_at: T0, method: "model", status: "ok", unit: "ft", current_level: 3 }];
  const w = [{ station: "A", issued_at: T0, variant: "rain-onset", threshold: "alert", shown: 0.45, eta_h: 2 }];
  const withLog = buildArchiveLines({ runs, points: [], warnings: w, obs: {} });
  assert.deepEqual(withLog.find((l) => l.station === "A").candidates, { "rain-onset": [{ threshold: "alert", shown: 0.45, eta: 2 }] });
  assert.deepEqual(withLog.find((l) => l.station === "C").candidates, {});
  assert.equal("candidates" in buildArchiveLines({ runs, points: [], obs: {} })[0], false, "table unreadable: not logged");
}
console.log("warning-candidates: ok");
