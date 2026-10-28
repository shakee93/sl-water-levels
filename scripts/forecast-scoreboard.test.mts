// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/forecast-scoreboard.test.mts
import assert from "node:assert/strict";
import {
  HOUR, FT, buildArchiveLines, cellStats, colomboDay, dayStart, dayComplete, groupOf, nearestReading, scoreDay, scoredRows, summaryRows, upsertSummary,
  verdictVsTrailing, SUMMARY_HEADER, addDays, daysBetween,
} from "../lib/forecastScoreboard.mjs";
import { RECESSION_VARIANT, recessionCorrectionFt, shadowVariants } from "../lib/shadowForecast.ts";

// ---- days are Colombo days
assert.equal(colomboDay(Date.parse("2026-10-27T18:29:00Z")), "2026-10-27");
assert.equal(colomboDay(Date.parse("2026-10-27T18:30:00Z")), "2026-10-28");
assert.equal(addDays("2026-10-31", 1), "2026-11-01");
assert.deepEqual(daysBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
assert.equal(dayComplete("2026-10-27", Date.parse("2026-10-28T20:00:00+05:30")), false);
assert.equal(dayComplete("2026-10-27", Date.parse("2026-10-29T01:00:00+05:30")), true);

// ---- groups
assert.equal(groupOf("Hanwella"), "main");
assert.equal(groupOf("Kithulgala"), "fast");
assert.equal(groupOf("Dunamale"), "other");

// ---- nearest reading within 40 min
const o = [{ ts: 0, level: 1 }, { ts: HOUR, level: 2 }, { ts: 2 * HOUR, level: null }, { ts: 3 * HOUR, level: 4 }];
assert.equal(nearestReading(o, HOUR + 30 * 60_000), 2);
assert.equal(nearestReading(o, 2 * HOUR), null); // the null reading is skipped and the next one is 60 min away
assert.equal(nearestReading(o, 10 * HOUR), null);

// ---- cell stats: MAE, persistence, skill, bias (forecast minus actual), in-band
const cs = cellStats([
  { p: 11, y: 10, c: 12, low: 9, high: 12 },
  { p: 9, y: 10, c: 10, low: 9, high: 9.8 },
]);
assert.equal(cs.n, 2);
assert.equal(cs.mae, 1);
assert.equal(cs.persistenceMae, 1);
assert.equal(cs.skillPct, 0);
assert.equal(cs.bias, 0);
assert.equal(cs.inBandPct, 50);
assert.equal(cellStats([]), null);

// ---- archive lines + scoring on a tiny synthetic day (metres and feet gauges, one shadow variant)
const T0 = dayStart("2026-10-27") + 6 * HOUR; // 06:00 Colombo
const runs = [
  { id: 1, station: "Hanwella", basin: "Kelani Ganga", issued_at: T0, method: "model", status: "ok", model_version: "v", unit: "ft", current_level: 10, tier: "normal", verdict: "normal", storm: 0 },
  { id: 2, station: "Kithulgala", basin: "Kelani Ganga", issued_at: T0, method: "model", status: "ok", model_version: "v", unit: "m", current_level: 3, tier: "normal", verdict: "normal", storm: 0 },
  { id: 3, station: "Ampara", basin: "Gal Oya", issued_at: T0, method: "trend", status: "ok", model_version: "v", unit: "ft", current_level: 1, tier: "normal", verdict: "normal", storm: 0 },
];
const pt = (run_id, h, level, low, high) => ({ run_id, horizon_h: h, target_ts: T0 + h * HOUR, level, low, high });
const points = [pt(1, 1, 9.5, 9, 10), pt(1, 3, 9, 8, 10), pt(2, 1, 3 - 0.1 * FT, 2.8, 3), pt(3, 1, 1, null, null)];
const crossings = [
  { run_id: 1, threshold: "minor", level: 12, probability: 0.5 },
  { run_id: 1, threshold: "alert", level: 9, probability: 1 }, // already above: not scored
  { run_id: 2, threshold: "minor", level: 4, probability: 0.1 },
];
const mkObs = (f) => Array.from({ length: 26 }, (_, i) => ({ ts: T0 + i * HOUR, level: f(i) }));
const obs = { Hanwella: mkObs((i) => (i === 1 ? 9.4 : i === 3 ? 9.2 : i === 12 ? 12.5 : 9)), Kithulgala: mkObs(() => 3 - 0.2 * FT), Ampara: mkObs(() => 1) };
const shadows = [
  { station: "Hanwella", issued_at: T0, variant: "copy", horizon_h: 1, target_ts: T0 + HOUR, level: 9.5, low: 9, high: 10 },
  { station: "Hanwella", issued_at: T0, variant: "better", horizon_h: 1, target_ts: T0 + HOUR, level: 9.4, low: 9, high: 10 },
];
const lines = buildArchiveLines({ runs, points, crossings, shadows, obs });
assert.equal(lines.length, 3);
assert.equal(lines[0].day, "2026-10-27");
assert.equal(lines.find((l) => l.station === "Hanwella").horizons[0].y, 9.4);
assert.equal(lines.find((l) => l.station === "Hanwella").cover24, true);
assert.equal(lines.find((l) => l.station === "Hanwella").max24, 12.5);

const rows = scoredRows(lines);
assert.equal(rows.length, 3, "trend-only gauges are not scored"); // Hanwella 1 h + 3 h, Kithulgala 1 h
const kit = rows.find((r) => r.station === "Kithulgala");
assert.ok(Math.abs(kit.c - 3 / FT) < 1e-2 && Math.abs(kit.y - (3 - 0.2 * FT) / FT) < 1e-2, "metres are converted to feet");

const sb = scoreDay("2026-10-27", lines, { now: Date.parse("2026-10-30T00:00:00Z") });
assert.equal(sb.complete, true);
assert.equal(sb.groups.main.h1.n, 1);
assert.equal(sb.groups.main.h1.mae, 0.1); // |9.4 - 9.5|
assert.equal(sb.groups.main.h1.persistenceMae, 0.6); // |9.4 - 10|
assert.equal(sb.groups.all.h1.n, 2);
assert.equal(sb.groups.fast.h1.n, 1);
assert.equal(sb.groups.main.h1.shadow.copy.mae, 0.1, "the no-op copy scores exactly like live");
assert.equal(sb.groups.main.h1.shadow.copy.maeVsLivePct, 0);
assert.equal(sb.groups.main.h1.shadow.better.mae, 0);
assert.equal(sb.groups.main.h1.shadow.better.maeVsLivePct, -100);
assert.equal(sb.runHealth.runs, 3);
assert.equal(sb.runHealth.hoursWithRuns, 1);
assert.equal(sb.runHealth.missingHours.length, 23);
// calibration: Hanwella minor (stated 50%, level 12, reached 12.5) came true; Kithulgala minor (10%) did not; the already-crossed alert is skipped
assert.equal(sb.calibration.minor.n, 2);
assert.equal(sb.calibration.minor.occurred, 1);
assert.equal(sb.calibration.minor.statedAtLeast40.cameTrue, 1);
assert.equal(sb.calibration.alert.n, 0);
assert.equal(sb.calibration.minor.bins[3].n, 1); // 0.5 falls in the 0.5-0.7 bin
assert.equal(sb.calibration.minor.bins[3].observedPct, 100);

// ---- verdict against the trailing median
const prior = (day, skill, diff) => ({ day, headline: { liveSkillPct: skill }, difficulty: { persistenceMae6hFt: diff } });
const P = [prior("2026-10-20", 30, 0.5), prior("2026-10-21", 28, 0.6), prior("2026-10-22", 32, 0.55), prior("2026-10-23", 29, 0.5)];
const day = (skill, diff) => ({ day: "2026-10-27", headline: { liveSkillPct: skill }, difficulty: { persistenceMae6hFt: diff } });
assert.equal(verdictVsTrailing(day(40, 0.55), P).code, "better");
assert.equal(verdictVsTrailing(day(20, 0.55), P).code, "worse");
assert.equal(verdictVsTrailing(day(31, 0.55), P).code, "same");
assert.equal(verdictVsTrailing(day(40, 1.5), P).code, "not_comparable", "a much harder day is not compared");
assert.equal(verdictVsTrailing(day(40, 0.2), P).code, "not_comparable", "a much easier day is not compared");
assert.equal(verdictVsTrailing(day(40, 0.55), P.slice(0, 2)).code, "not_comparable", "needs 3 earlier days");
assert.equal(verdictVsTrailing(day(40, 0.55), [...P, prior("2026-10-28", 0, 0.5)]).code, "better", "later days are ignored");

// ---- summary.csv: rows per group x horizon x variant, re-running a day replaces its rows
const csv1 = upsertSummary("", sb);
assert.ok(csv1.startsWith(SUMMARY_HEADER + "\n"));
const n1 = csv1.trim().split("\n").length;
assert.equal(n1, 1 + summaryRows(sb).length);
const csv2 = upsertSummary(csv1, sb);
assert.equal(csv2, csv1, "idempotent");
const other = { ...sb, day: "2026-10-26" };
const csv3 = upsertSummary(csv1, other);
assert.equal(csv3.trim().split("\n").length, 1 + 2 * summaryRows(sb).length);
assert.ok(csv3.split("\n")[1].startsWith("2026-10-26"), "days stay in order");
assert.ok(csv1.trim().split("\n").every((l) => l.split(",").length === SUMMARY_HEADER.split(",").length));

// ---- shadow candidate: recession bias correction
const asOf = T0;
const falling = [{ ts: asOf - 3 * HOUR, level: 15 }, { ts: asOf - 24 * HOUR, level: 25 }, { ts: asOf, level: 12 }]; // 1 ft/h fall, 13 ft range (feet)
const c1 = recessionCorrectionFt("ft", 12, asOf, falling);
assert.equal(c1[12], 2, "capped at 2 ft"); // 0.35 x 1 x 12 = 4.2 -> max 2 (25% of range = 3.25)
assert.equal(c1[24], 2);
const gentle = [{ ts: asOf - 3 * HOUR, level: 12.3 }, { ts: asOf - 24 * HOUR, level: 14 }, { ts: asOf, level: 12 }]; // 0.1 ft/h, range 2 ft
const c2 = recessionCorrectionFt("ft", 12, asOf, gentle);
assert.ok(Math.abs(c2[12] - 0.42) < 1e-9, String(c2[12])); // 0.35 x 0.1 x 12 = 0.42, cap 0.5
assert.equal(c2[24], 0.5, "capped at 25% of the 24 h range");
assert.deepEqual(recessionCorrectionFt("ft", 12, asOf, [{ ts: asOf - 3 * HOUR, level: 11.5 }, { ts: asOf, level: 12 }]), { 12: 0, 24: 0 }, "rising: untouched");
assert.deepEqual(recessionCorrectionFt("ft", 12, asOf, [{ ts: asOf - 3 * HOUR, level: 12.1 }, { ts: asOf, level: 12 }]), { 12: 0, 24: 0 }, "steady: untouched");
assert.deepEqual(recessionCorrectionFt(null, 12, asOf, falling), { 12: 0, 24: 0 }, "unknown unit: untouched");
assert.deepEqual(recessionCorrectionFt("ft", 12, asOf, [{ ts: asOf, level: 12 }]), { 12: 0, 24: 0 }, "no reading 3 h back: untouched");
const live = { unit: "m", currentLevel: 3.6, asOfTs: asOf, method: "model", horizons: [1, 3, 6, 12, 24].map((h) => ({ h, ts: asOf + h * HOUR, level: 3.5, low: 3.2, high: 3.8 })) };
const mObs = [{ ts: asOf - 3 * HOUR, level: 3.6 + 0.3 * FT }, { ts: asOf - 24 * HOUR, level: 3.6 + 2 * FT }, { ts: asOf, level: 3.6 }]; // 0.1 ft/h
const sv = shadowVariants(live, mObs);
assert.deepEqual(sv.map((v) => v.variant), ["copy", RECESSION_VARIANT]);
assert.deepEqual(sv[0].horizons, live.horizons, "the no-op copy equals live");
const rec = sv[1].horizons;
assert.deepEqual(rec.slice(0, 3), live.horizons.slice(0, 3), "1-6 h untouched");
assert.ok(Math.abs(live.horizons[3].level - rec[3].level - 0.42 * FT) < 1e-9, "12 h lowered by 0.42 ft, in metres");
assert.ok(Math.abs(live.horizons[3].high - rec[3].high - 0.42 * FT) < 1e-9 && Math.abs(live.horizons[3].low - rec[3].low - 0.42 * FT) < 1e-9, "the band moves with it");
assert.equal(live.horizons[3].level, 3.5, "live is not mutated");
assert.deepEqual(shadowVariants({ ...live, method: "trend" }, mObs)[1].horizons, live.horizons, "trend-only gauges are copied unchanged");
assert.deepEqual(shadowVariants({ ...live, horizons: [] }, mObs), []);

console.log("forecast-scoreboard tests passed");
