// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/learn-all.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reportStrength, neighbourFlags, floodStreetEvidence, toPublic, assertPublicSafe, whenBucket, gaugeAt, scoreMark, fitGroundRain,
  worseFeatureTest, mapRefitStatus, coverageGaps, whatWeLearnedLines, diffLearned, photoInfo, CURRENT_GROUND, REFIT_MIN_NEW,
} from "../lib/learnAll.mjs";
import { streetLevelFact } from "../lib/learnedParams.mjs";

const HOUR = 3_600_000;
const NAG = { lat: 6.9583, lon: 79.8786 };
const rep = (o) => ({ id: 1, created_ms: 1_793_000_000_000, day: "2026-10-27", kind: "water_now", depth: "knee", event: null, ...NAG, acc_m: 20, src: "gps", map_right: null, nag_ft: 4.2, han_ft: null, han_fast_ft: null, person_day: "a", status: "new", ...o });

// ---- trust: bare < gps+depth < photo+exif; bad evidence is excluded; capped below 2
{
  const bare = reportStrength(rep({ depth: null, acc_m: null, src: "pin" })).strength;
  const gps = reportStrength(rep({})).strength;
  const photo = reportStrength(rep({ photo_key: "x", exif_ok: 1 })).strength;
  assert.ok(bare < gps && gps < photo, `${bare} ${gps} ${photo}`);
  assert.ok(photo <= 1.5 && photo < 2);
  assert.equal(reportStrength(rep({ photo_key: "x", exif_ok: 0 })).strength, 0, "EXIF disagrees: excluded");
  assert.equal(reportStrength(rep({ acc_m: 900 })).strength, 0, "GPS worse than 500 m: excluded");
  assert.equal(reportStrength(rep({ status: "outlier" })).strength, 0);
  assert.equal(reportStrength(rep({}), { contradicted: true }).strength, 0);
  assert.deepEqual(photoInfo(rep({})), { photo: false, exif: null }, "no photo columns yet = no photo");
  assert.ok(reportStrength(rep({ kind: "past_wet", event: "ditwah_2025" })).strength < gps, "a recalled flood is worth less than water now");
}

// ---- neighbours: two others within 400 m saying the opposite, outnumbering agreement, contradict a report
{
  const a = rep({ id: 1, person_day: "a" });
  const dry1 = rep({ id: 2, person_day: "b", kind: "past_dry", event: "other", lat: NAG.lat + 0.001 }), dry2 = rep({ id: 3, person_day: "c", kind: "past_dry", event: "other", lat: NAG.lat + 0.001 });
  // past_dry vs water_now are different "when": not comparable, nothing flagged
  assert.equal(neighbourFlags([a, dry1, dry2]).size, 0);
  const w1 = rep({ id: 1, kind: "past_wet", event: "ditwah_2025", person_day: "a" });
  const d1 = rep({ id: 2, kind: "past_dry", event: "ditwah_2025", person_day: "b", lat: NAG.lat + 0.001 }), d2 = rep({ id: 3, kind: "past_dry", event: "ditwah_2025", person_day: "c", lat: NAG.lat + 0.002 });
  assert.deepEqual([...neighbourFlags([w1, d1, d2])].sort(), [1], "the lone wet report is contradicted by two dry neighbours");
  const d3 = rep({ id: 4, kind: "past_dry", event: "ditwah_2025", person_day: "d", lat: 7.5 });
  assert.equal(neighbourFlags([w1, d1, d3]).size, 0, "only one near opponent");
  const far = rep({ id: 5, kind: "past_dry", event: "ditwah_2025", person_day: "e", lat: NAG.lat + 0.1 });
  assert.equal(neighbourFlags([w1, d1, far]).size, 0, "a far neighbour does not count");
}

// ---- street evidence from map reports
{
  const items = floodStreetEvidence([rep({ id: 1 }), rep({ id: 2, kind: "past_wet", event: "ditwah_2025", person_day: "z" }), rep({ id: 3, kind: "past_dry", event: "ditwah_2025" }), rep({ id: 4, kind: "map_check", map_right: "yes" }), rep({ id: 5, nag_ft: null })]);
  assert.equal(items.length, 2, "water_now + past_wet only, level required");
  assert.equal(items[0].station, "Nagalagam Street");
  assert.equal(items[0].level, 4.2);
  assert.equal(items[1].level, 8.4, "named flood at its peak stage");
  const han = floodStreetEvidence([rep({ lat: 6.91, lon: 80.08, han_ft: 20.5, han_fast_ft: 21 })]);
  assert.equal(han[0].station, "Hanwella");
  assert.equal(han[0].level, 21, "the 10-minute sensor when present");
  assert.deepEqual(floodStreetEvidence([rep({}), rep({ id: 9 })], new Set([1, 9])), [], "contradicted reports give no evidence");
}
// ---- weighted street level: the estimator needs >= 2 reports however strong, and weak evidence needs more
{
  const it = (level, strength, day, key) => ({ level, wet: true, strength, day, key });
  const strong = [it(3, 1.5, "d1", "a"), it(3.4, 1.5, "d1", "b"), it(3.8, 1.5, "d2", "c")];
  assert.equal(streetLevelFact(strong, 5).fact.ft, 3.4, "1.5 + 1.5 reaches 2 at the second report");
  const solo = [it(1, 1.5, "d1", "a"), it(3.4, 1, "d1", "b"), it(3.8, 1, "d2", "c")];
  assert.equal(streetLevelFact(solo, 5).fact.ft, 3.4, "a strong early report alone cannot set the level (1.5 < 2)");
  const weak = [it(3, 0.5, "d1", "a"), it(3.4, 0.5, "d1", "b"), it(3.8, 0.5, "d2", "c")];
  assert.equal(streetLevelFact(weak, 5).pending.why, "weak evidence");
  // default weight 1 is the old second-lowest rule
  assert.equal(streetLevelFact([it(3, undefined, "d1", "a"), it(3.4, undefined, "d1", "b"), it(3.8, undefined, "d2", "c")], 5).fact.ft, 3.4);
}

// ---- public rows: allowlist, no coordinates / ids / text, 3 h bucket
{
  assert.equal(whenBucket(Date.UTC(2026, 9, 27, 4, 0)), "09-12", "04:00 UTC = 09:30 Sri Lanka");
  const pub = toPublic({ id: "f3-1", src: "flood3d", day: "2026-10-27", when: "09-12", area: "Kelaniya", wet: true, depth: "knee", lat: 6.9583, lon: 79.8786, person_day: "abc", ip_hash: "h", note: "my house is at 12 Temple Rd", gauge: { name: "Nagalagam Street", ft: 4.2, rise3hFt: 0.3, km: 1.1, lat: 6.9 }, flags: { pin: true, secret: 1 } });
  assertPublicSafe([pub]);
  const s = JSON.stringify(pub);
  for (const bad of ["lat", "lon", "person_day", "ip_hash", "note", "Temple", "secret", "6.9583"]) assert.ok(!s.includes(bad), `leaked ${bad}`);
  assert.throws(() => assertPublicSafe([{ ...pub, lat: 6.9 }]));
  assert.throws(() => assertPublicSafe([{ ...pub, area: "call 0771234567" }]));
  assert.throws(() => assertPublicSafe([{ ...pub, area: "a1b2c3d4e5f6a7b8c9d0" }]));
  assert.throws(() => assertPublicSafe([{ ...pub, gauge: { name: "x", lat: 1 } }]));
}

// ---- gauge join
{
  const ser = [{ ts: 0, v: 3 }, { ts: HOUR, v: 3.1 }, { ts: 3 * HOUR, v: 3.6 }];
  assert.deepEqual(gaugeAt(ser, 0), { ft: 3, rise3hFt: 0.6 });
  assert.equal(gaugeAt(ser, 10 * HOUR), null);
  assert.equal(gaugeAt(ser, 3 * HOUR).rise3hFt, null, "no reading 3 h later: unknown, not zero");
}

// ---- ground rain: scoring and the fit
{
  const steps = [];
  for (let i = 0; i < 96; i++) steps.push({ ms: i * 30 * 60_000, v: i >= 20 && i <= 24 ? 60 : i >= 70 && i <= 72 ? 35 : 2 });
  const events = [{ ms: 22 * 30 * 60_000 }, { ms: 71 * 30 * 60_000 }];
  assert.deepEqual(scoreMark(steps, events, 30), { events: 2, hits: 2, episodes: 2, unmatched: 0 });
  assert.deepEqual(scoreMark(steps, events, 50), { events: 2, hits: 1, episodes: 1, unmatched: 0 });
  assert.equal(scoreMark(steps, [{ ms: 22 * 30 * 60_000 }], 30).unmatched, 1, "the 35 mm episode has no report: unmatched");
  assert.equal(scoreMark(steps, [{ ms: 500 * 60_000 * 60 }], 30).events, 0, "no steps near the event: not scorable");
}
{
  // two days of shadow log with rain peaks; three independent reports on two days
  const D = 864e5, t0 = Date.UTC(2026, 9, 25, 0, 0);
  const log = [];
  for (let i = 0; i < 4 * 48; i++) {
    const ms = t0 + i * 30 * 60_000, peak = (i >= 40 && i <= 44) ? 46 : (i >= 100 && i <= 104) ? 38 : (i >= 150 && i <= 152) ? 55 : 1;
    log.push({ zone: "colombo-east", ms, mm1h: peak / 3, peak1h: peak / 3, mm3h: peak, mm24h: peak * 1.4 });
  }
  const ev = [{ zone: "colombo-east", ms: t0 + 42 * 30 * 60_000, day: "2026-10-25", key: "a" }, { zone: "colombo-east", ms: t0 + 102 * 30 * 60_000, day: "2026-10-27", key: "b" }, { zone: "colombo-east", ms: t0 + 151 * 30 * 60_000, day: "2026-10-28", key: "c" }];
  const fit = fitGroundRain(log, ev)["colombo-east"];
  assert.equal(fit.proposed, true); assert.equal(fit.wired, false);
  const m3 = fit.metrics.mm3h;
  assert.equal(m3.current.possible, CURRENT_GROUND.possible.mm3h);
  assert.equal(m3.proposed.possible, 35, "highest mark that still catches all three floods");
  assert.deepEqual(m3.backtest.atProposedPossible, { events: 3, hits: 3, episodes: 3, unmatched: 0 });
  assert.deepEqual(m3.backtest.atCurrentPossible, { events: 3, hits: 1, episodes: 1, unmatched: 0 }, "the current 50 mm mark misses two of the three");
  assert.ok(m3.proposed.possible >= m3.current.possible * 0.5 && m3.proposed.possible <= m3.current.possible * 1.5, "bounded");
  // gates: too few reports -> only says what it waits for
  const few = fitGroundRain(log, ev.slice(0, 2))["colombo-east"];
  assert.ok(few.pending && !few.metrics);
  // the same person twice a day is one event
  const dup = fitGroundRain(log, [ev[0], ev[0], ev[1]])["colombo-east"];
  assert.equal(dup.events, 2);
  // a lone wet report must not drag a proposal below the band
  const lowEv = [{ zone: "z", ms: t0 + 42 * 30 * 60_000, day: "d1", key: "a" }, { zone: "z", ms: t0 + 43 * 30 * 60_000, day: "d1", key: "b" }, { zone: "z", ms: t0 + 102 * 30 * 60_000, day: "d2", key: "c" }];
  const lowLog = log.map((l) => ({ ...l, zone: "z", mm3h: l.mm3h > 10 ? 22 : 1, mm24h: 1, mm1h: 0, peak1h: 0 }));
  const low = fitGroundRain(lowLog, lowEv).z.metrics.mm3h;
  assert.equal(low.proposed.possible, 25, "the best mark is 20 mm but a proposal never goes below half of the current 50 mm");
}

// ---- worse-while-rising feature: only useful when it helps held-out days
{
  const rows = [];
  const day0 = Date.UTC(2026, 9, 20, 6, 0);
  for (let d = 0; d < 5; d++) for (let k = 0; k < 4; k++) {
    const t = day0 + d * 864e5 + k * HOUR * 2;
    // forecast p is 0.4 ft too low whenever a report exists, accurate otherwise
    rows.push({ st: "G", t, h: 1, c: 5, p: 5.2, y: 5.2 + (k < 2 ? 0.4 : 0) });
  }
  const reports = [];
  for (let d = 0; d < 5; d++) for (let k = 0; k < 2; k++) reports.push({ station: "G", ms: day0 + d * 864e5 + k * HOUR * 2 - 30 * 60_000 });
  const t = worseFeatureTest(rows, reports);
  assert.equal(t.wired, false);
  assert.ok(t.horizons[1].testN >= 8 && t.useful, JSON.stringify(t.horizons[1]));
  assert.ok(t.horizons[1].gainPct > 20);
  // reports unrelated to the error: no gain, not useful
  const noise = rows.map((r) => ({ ...r, y: r.p }));
  assert.equal(worseFeatureTest(noise, reports).useful, false);
  // too few reports: not useful and no crash
  assert.equal(worseFeatureTest(rows, reports.slice(0, 1)).useful, false);
  assert.equal(worseFeatureTest([], []).useful, false);
}

// ---- map re-fit trigger
{
  const mk = (area, n, status = "new", strength = 1.2, people = n) => Array.from({ length: n }, (_, i) => ({ area, status, strength, person_day: `p${i % people}` }));
  const s = mapRefitStatus([...mk("Kelaniya", REFIT_MIN_NEW), ...mk("Hanwella", REFIT_MIN_NEW, "new", 1.2, 2), ...mk("Biyagama and Kaduwela", 12, "used"), ...mk("Kelaniya", 5, "new", 0)]);
  assert.equal(s.Kelaniya.due, true);
  assert.equal(s.Kelaniya.newTrusted, REFIT_MIN_NEW, "flagged (strength 0) reports are not counted");
  assert.equal(s.Hanwella.due, false, "10 reports from 2 people is not enough");
  assert.equal(s["Biyagama and Kaduwela"].newTrusted, 0, "reports already used by a fit are not new");
  const gaps = coverageGaps(s, [{ kind: "streetLevel", station: "Hanwella", n: 1, needN: 3 }]);
  assert.ok(gaps.some((g) => g.name === "Hanwella") && !gaps.some((g) => g.name === "Kelaniya"));
}

// ---- owner text
{
  const L = { counts: { total: 5, feedback: 2, street: 1, flood3d: 2, newTonight: 3, trusted: 2, flagged: 0 }, changes: ["x"], groundRain: { "colombo-east": { pending: "x", events: 1, eventDays: 1, stepDays: 1 } },
    forecast: { momentum: { horizons: { 1: { n: 30, maeBase: 0.16, maeFit: 0.16, gainPct: 0 } }, useful: false }, worseFeature: { reports: 2, useful: false, horizons: {} } }, mapRefit: { Kelaniya: { due: true, newTrusted: 11, newPeople: 4 } }, gaps: [{ name: "Hanwella", have: 1, need: 3 }] };
  const t = whatWeLearnedLines(L).join("\n");
  assert.match(t, /Observations: 5/); assert.match(t, /Changed: x/); assert.match(t, /waiting/); assert.match(t, /re-fit due: Kelaniya/); assert.match(t, /Hanwella 1\/3/); assert.match(t, /No gain yet/);
  assert.deepEqual(whatWeLearnedLines(null), []);
  assert.equal(diffLearned(null, { forecast: { momentum: { useful: false } } }).length, 0);
}

// ---- the mirror of the live ground marks must equal lib/groundRain.ts
{
  const src = readFileSync(new URL("../lib/groundRain.ts", import.meta.url), "utf8");
  const m = /possible: \{ mm1h: (\d+), mm3h: (\d+), mm24h: (\d+) \},\s*likely: \{ mm1h: (\d+), mm3h: (\d+), mm24h: (\d+) \}/.exec(src);
  assert.deepEqual(m.slice(1).map(Number), [CURRENT_GROUND.possible.mm1h, CURRENT_GROUND.possible.mm3h, CURRENT_GROUND.possible.mm24h, CURRENT_GROUND.likely.mm1h, CURRENT_GROUND.likely.mm3h, CURRENT_GROUND.likely.mm24h]);
}
console.log("learn-all tests passed");
