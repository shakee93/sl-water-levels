// @ts-nocheck (node strip-types test: explicit .mjs extension)
// node --experimental-strip-types scripts/feedback-learn.test.mts
import assert from "node:assert/strict";
import {
  K_MIN, MIN_DAYS, dedupe, nearest, streetLevelFact, rainFact, directionFact, seenFact, fitK, momentumBacktest, buildParams,
  feedbackWetness, streetLevelOf, rainPossibleMm, streetRainLevel, streetLevelReached, learnedLines, colomboDay,
} from "../lib/learnedParams.mjs";

const wet = (level, day, key, w = true) => ({ level, wet: w, day, key });

// ---- dedupe / nearest
assert.deepEqual(dedupe([{ k: "a", v: 1 }, { k: "a", v: 2 }, { k: "b", v: 3 }], (x) => x.k).map((x) => x.v), [1, 3]);
assert.equal(nearest([{ ts: 0, v: 1 }, { ts: 100, v: 2 }], 90, 20).v, 2);
assert.equal(nearest([{ ts: 0, v: 1 }], 500, 20), null);

// ---- street level: the gates
{
  const base = [wet(21, "d1", "a"), wet(22, "d1", "b"), wet(22.5, "d2", "c")];
  assert.equal(streetLevelFact(base, 24.6).fact.ft, 22, "second-lowest wet level");
  assert.equal(streetLevelFact(base, 24.6).fact.n, 3);
  assert.equal(streetLevelFact(base, 24.6).fact.days, 2);
  // two reports only: pending with counts
  assert.deepEqual(streetLevelFact(base.slice(0, 2), 24.6).pending, { n: 2, days: 1, needN: K_MIN, needDays: MIN_DAYS });
  // enough reports but one day: pending
  assert.ok(streetLevelFact([wet(21, "d1", "a"), wet(22, "d1", "b"), wet(23, "d1", "c")], 24.6).pending);
  // the same person (same key) five times is one answer
  assert.ok(streetLevelFact([wet(21, "d1", "a"), wet(21.1, "d1", "a"), wet(21.2, "d2", "a"), wet(21.3, "d2", "a")], 24.6).pending);
  // no official mark: cannot bound, so no value
  assert.equal(streetLevelFact(base, null).pending.why, "no official minor mark");
}
// one early outlier cannot set the level: second-lowest ignores it
assert.equal(streetLevelFact([wet(5, "d1", "a"), wet(22, "d1", "b"), wet(22.5, "d2", "c"), wet(23, "d2", "d")], 24.6).fact.ft, 22);
// ... but never below 60% of the minor mark (bounded), and never above the mark
{
  const low = streetLevelFact([wet(2, "d1", "a"), wet(3, "d1", "b"), wet(3.5, "d2", "c")], 24.6);
  assert.equal(low.fact.ft, 14.8, "0.6 x 24.6 = 14.76 -> 14.8");
  assert.equal(low.fact.clamped, true);
  const high = streetLevelFact([wet(30, "d1", "a"), wet(31, "d1", "b"), wet(32, "d2", "c")], 24.6);
  assert.equal(high.fact.ft, 24.6);
}
// contested: most people at or above the level say "no water" -> no value
{
  const items = [wet(21, "d1", "a"), wet(22, "d1", "b"), wet(22.5, "d2", "c"), wet(23, "d1", "d", false), wet(23.5, "d2", "e", false), wet(24, "d2", "f", false), wet(24.2, "d2", "g", false)];
  assert.equal(streetLevelFact(items, 24.6).pending.why, "contested");
}

// ---- rain mark
{
  const items = [{ mm: 52, wet: true, day: "d1", key: "a" }, { mm: 58, wet: true, day: "d1", key: "b" }, { mm: 80, wet: true, day: "d2", key: "c" }, { mm: 20, wet: false, day: "d2", key: "d" }];
  const f = rainFact(items).fact;
  assert.equal(f.possibleMm, 60, "second-lowest 58 -> 60 (the default is the ceiling)");
  assert.equal(f.dryN, 1);
  const lower = rainFact([{ mm: 40, wet: true, day: "d1", key: "a" }, { mm: 46, wet: true, day: "d1", key: "b" }, { mm: 70, wet: true, day: "d2", key: "c" }]).fact;
  assert.equal(lower.possibleMm, 45, "second-lowest 46 -> 45 (clamped at the floor)");
  assert.ok(rainFact(items.slice(0, 2)).pending);
}

// ---- direction / seen
{
  const rows = [
    { answer: "worse", dir: "rising", day: "d1", key: "a", err1h: 0.5 }, { answer: "yes", dir: "rising", day: "d2", key: "b", err1h: 0.1 },
    { answer: "yes", dir: "falling", day: "d1", key: "c" }, { answer: "unsure", dir: "rising", day: "d1", key: "d" },
  ];
  const r = directionFact(rows, "rising");
  assert.deepEqual([r.n, r.days, r.worse, r.yes, r.meanErrFt], [2, 2, 1, 1, 0.3]);
  assert.equal(directionFact(rows, "steady"), null);
  const s = seenFact([
    { riverObs: "flooding", tier: "normal", tierOk: true, key: "a" }, { riverObs: "normal", tier: "alert", tierOk: true, key: "b" },
    { riverObs: "high", tier: "alert", tierOk: true, key: "c" }, { riverObs: "flooding", tier: "normal", tierOk: false, key: "d" },
  ]);
  assert.deepEqual(s, { n: 3, higher: 1, same: 1, lower: 1 }, "rows saved before 961440f (raw tier) are left out");
}

// ---- momentum factor
assert.equal(fitK([]), 1);
{
  // a forecast that always under-reacts by half: raw k = 2, shrunk by n/(n+30) and capped at 1.5
  const under = Array.from({ length: 300 }, (_, i) => ({ c: 10, p: 10 + 0.1 * (1 + (i % 5)), y: 10 + 0.2 * (1 + (i % 5)) }));
  assert.equal(fitK(under), 1.5);
  const few = under.slice(0, 3);
  assert.ok(fitK(few) > 1 && fitK(few) < 1.2, "three points barely move it");
  const over = Array.from({ length: 300 }, (_, i) => ({ c: 10, p: 10 + 1 + (i % 3), y: 10 + 0.2 * (1 + (i % 3)) }));
  assert.equal(fitK(over), 0.8, "floor");
}
// walk-forward backtest: a genuine, repeating under-reaction is found and scored on days it did not see ...
{
  const DAY = 864e5, t0 = Date.UTC(2026, 9, 20, 6);
  const rows = [];
  for (let d = 0; d < 5; d++) for (let i = 0; i < 40; i++) {
    const dp = 0.1 + 0.05 * (i % 7);
    for (const st of ["A", "B"]) rows.push({ st, t: t0 + d * DAY + i * 600_000, h: 1, c: 10, p: 10 + dp, y: 10 + 1.4 * dp });
  }
  const bt = momentumBacktest(rows);
  assert.ok(bt.horizons[1].gainPct >= 5, `gain ${bt.horizons[1].gainPct}`);
  assert.ok(bt.horizons[1].maeFit < bt.horizons[1].maeBase);
  assert.equal(bt.useful, true);
  assert.ok(bt.gauges.A[1].k > 1.2 && bt.gauges.A[1].k <= 1.5);
  const p = buildParams({ now: t0 + 6 * DAY, backtestRows: rows });
  assert.ok(p.stations.A.momentum[1], "emitted when the pooled test passes");
  // ... and a forecast that is already right (only noise on top) gets no factor
  const noise = rows.map((r, i) => ({ ...r, y: r.p + ((i * 7919) % 11 - 5) / 200 }));
  const bn = momentumBacktest(noise);
  assert.equal(bn.useful, false);
  const pn = buildParams({ now: t0 + 6 * DAY, backtestRows: noise });
  assert.equal(pn.stations.A?.momentum, undefined, "no momentum without a real gain");
  assert.equal(pn.forecast.wired, false);
}
// a single day of data has nothing to test on
assert.equal(momentumBacktest([{ st: "A", t: Date.UTC(2026, 9, 20, 6), h: 1, c: 1, p: 2, y: 3 }]).horizons[1].n, 0);

// ---- "where is the water now" is street-water evidence at the shown gauge level
{
  assert.deepEqual(feedbackWetness("road", null), { wet: true, strong: true });
  assert.deepEqual(feedbackWetness("yard", "normal"), { wet: true, strong: true }, "water_at beats the river observation");
  assert.deepEqual(feedbackWetness("inside", null), { wet: true, strong: true });
  assert.deepEqual(feedbackWetness("none", "flooding"), { wet: false, strong: true });
  assert.deepEqual(feedbackWetness(null, "flooding"), { wet: true, strong: false });
  assert.deepEqual(feedbackWetness(null, "high"), { wet: false, strong: false });
  assert.equal(feedbackWetness(null, null), null, "a bare worse says nothing about water");
  // a person's strong answer wins over their weaker one (same key), and counts as the one observation
  const items = [{ ...wet(23, "d1", "a"), strong: false }, { ...wet(21, "d1", "a"), strong: true }, wet(22, "d1", "b"), wet(22.5, "d2", "c")];
  const f = streetLevelFact(items, 24.6).fact;
  assert.equal(f.n, 3);
  assert.equal(f.ft, 22, "levels 21 (strong, person a), 22, 22.5: second lowest is 22");
  // a strong "no water" at a level counts as dry there
  const dry = [wet(21, "d1", "a"), wet(22, "d1", "b"), wet(22.5, "d2", "c"), { ...wet(23, "d2", "d", false), strong: true }];
  assert.equal(streetLevelFact(dry, 24.6).fact.dryBelowN, 0);
}
// ---- one person counts once across both forms: the shared per-day key is the dedupe key
{
  const rows = [wet(22, "d1", "p|X|G"), wet(22.1, "d1", "p|X|G"), wet(22.2, "d2", "p|Y|G"), wet(22.3, "d2", "p|Z|G")];
  assert.equal(streetLevelFact(rows, 24.6).fact.n, 3, "the person who answered both forms is one");
  // legacy rows (different hash per form) still count separately: documented fallback
  assert.equal(dedupe([{ k: "h1|d1" }, { k: "h2|d1" }], (x) => x.k).length, 2);
}

// ---- the whole file, and what it must never contain
{
  const now = Date.UTC(2026, 9, 27, 7);
  const answers = [
    { station: "Hanwella", town: null, answer: "worse", dir: "rising", riverObs: "flooding", tier: "alert", tierOk: true, err1h: 0.4, day: "2026-10-26", key: "SECRETHASH1|2026-10-26" },
    { station: "Hanwella", town: null, answer: "yes", dir: "rising", riverObs: null, tier: "alert", tierOk: true, err1h: null, day: "2026-10-27", key: "SECRETHASH2|2026-10-27" },
  ];
  const streetEvidence = [wet(22, "2026-10-26", "SECRETHASH1|x"), wet(22.4, "2026-10-26", "SECRETHASH3|x"), wet(22.5, "2026-10-27", "SECRETHASH2|x")].map((e) => ({ ...e, station: "Hanwella" }));
  const p = buildParams({ now, answers, streetEvidence, reports: [{ town: "wellampitiya", answer: "deep", day: "2026-10-26" }], marks: { Hanwella: { minorFt: 24.6, alertFt: 21.3 } } });
  assert.equal(p.version, 1);
  assert.equal(p.asOf, "2026-10-27");
  assert.deepEqual(p.stations.Hanwella.streetLevel, { ft: 22.4, n: 3, days: 2, defaultFt: 24.6, clamped: false, dryBelowN: 0 });
  assert.equal(p.stations.Hanwella.answers.worse, 1);
  assert.deepEqual(p.towns.wellampitiya, { reports: 1, days: 1, deep: 1, little: 0, dry: 0 });
  const json = JSON.stringify(p);
  assert.ok(!/SECRETHASH|note|ip_hash|token|lat|lon/i.test(json), "counts only: no hashes, notes, tokens or places");
  assert.match(learnedLines(p)[0], /^Learned: Hanwella: people report road water from ~22\.4 ft \(3 reports, 2 days; official minor 24\.6 ft\)/);
  // nothing learned -> says so and shows progress
  const empty = buildParams({ now, answers, streetEvidence: streetEvidence.slice(0, 1), marks: { Hanwella: { minorFt: 24.6 } } });
  assert.equal(empty.stations.Hanwella.streetLevel, undefined);
  assert.equal(empty.pending[0].n, 1);
  assert.match(learnedLines(empty)[0], /nothing yet/);
  assert.match(learnedLines(empty)[1], /Building up: Hanwella street level 1\/3 reports, 1\/2 days/);
}

// ---- reading the file defensively (public branch, may be old or edited)
{
  const good = { stations: { Hanwella: { streetLevel: { ft: 22, n: 3, days: 2, defaultFt: 24.6 } }, X: { streetLevel: { ft: 5, n: 9, days: 9, defaultFt: 24.6 } }, Y: { streetLevel: { ft: 22, n: 2, days: 2, defaultFt: 24.6 } }, Z: { streetLevel: { ft: 30, n: 5, days: 3, defaultFt: 24.6 } } }, zones: { z1: { streetRain: { possibleMm: 50, n: 3, days: 2 } }, z2: { streetRain: { possibleMm: 20, n: 9, days: 9 } }, z3: { streetRain: { possibleMm: 90, n: 9, days: 9 } }, z4: { streetRain: { possibleMm: 50, n: 1, days: 1 } } } };
  assert.deepEqual(streetLevelOf(good, "Hanwella"), { ft: 22, n: 3, days: 2 });
  assert.equal(streetLevelOf(good, "X"), null, "below 60% of the official mark");
  assert.equal(streetLevelOf(good, "Y"), null, "too few reports");
  assert.equal(streetLevelOf(good, "Z"), null, "above the official mark");
  assert.equal(streetLevelOf(null, "Hanwella"), null);
  assert.equal(streetLevelOf({}, "Hanwella"), null);
  assert.equal(rainPossibleMm(good, "z1"), 50);
  assert.equal(rainPossibleMm(good, "z2"), 45, "clamped to the floor");
  assert.equal(rainPossibleMm(good, "z3"), 60, "never above the default");
  assert.equal(rainPossibleMm(good, "z4"), 60, "not enough evidence: default");
  assert.equal(rainPossibleMm(null, "z1"), 60);
  // heads-up: learned values only ADD a "possible"; never remove, never "likely"
  assert.equal(streetRainLevel({ base: null, mm24h: 52, zone: "z1" }, good), "possible");
  assert.equal(streetRainLevel({ base: null, mm24h: 48, zone: "z1" }, good), null);
  assert.equal(streetRainLevel({ base: null, mm24h: 52, zone: "z4" }, good), null, "default 60 mm applies");
  assert.equal(streetRainLevel({ base: null, mm24h: 52, zone: "z1" }, null), null, "file unavailable: defaults");
  assert.equal(streetRainLevel({ base: "possible", mm24h: 10, zone: "z1" }, good), "possible");
  assert.equal(streetRainLevel({ base: "likely", mm24h: 130, zone: "z1" }, good), "likely");
  assert.equal(streetRainLevel({ base: null, mm24h: 500, zone: "z1" }, good), "possible", "never creates likely (the push level)");
  assert.equal(streetRainLevel({ base: null, mm24h: null, zone: "z1" }, good), null, "missing rain is not zero and not a claim");
  assert.equal(streetLevelReached(good, "Hanwella", 22), true);
  assert.equal(streetLevelReached(good, "Hanwella", 21.9), false);
  assert.equal(streetLevelReached(good, "Hanwella", null), false);
  assert.equal(streetLevelReached(good, "Nowhere", 99), false);
}
assert.equal(colomboDay(Date.UTC(2026, 9, 26, 19, 0)), "2026-10-27", "Sri Lanka is UTC+5:30");
console.log("feedback-learn tests passed");
