// @ts-nocheck (node strip-types test: explicit extensions)
// node --experimental-strip-types --no-warnings scripts/reading-qc.test.mts
// The live sensor-glitch filter for forecast inputs (lib/readingQc.mjs), cases from the scoring of 28 Oct 2026.
import assert from "node:assert/strict";
import { cleanSeries, latestLooksOdd, cleanReadings, SPIKE_FT, STUCK_H, JUMP_FT, FT_PER_M, STUCK_MOVING_FT, STUCK_LONG_H, STUCK_BEFORE_H } from "../lib/readingQc.mjs";

const H = 3_600_000;
const T0 = 1_792_000_000_000;
const mk = (vals, step = 1) => vals.map((v, i) => ({ ts: T0 + i * step * H, water_level: v }));
const levels = (r) => r.points.map((p) => p.water_level);

assert.equal(SPIKE_FT, 2); assert.equal(STUCK_H, 12); assert.equal(JUMP_FT, 3);

// Ellagawa: one hour at 21.78 between ~34.3 (a fake 12.5 ft dip)
let r = cleanSeries(mk([34.2, 34.3, 21.78, 34.3, 34.4, 34.5]), { unit: "ft" });
assert.deepEqual(levels(r), [34.2, 34.3, 34.3, 34.4, 34.5]);
assert.equal(r.flags.length, 1); assert.equal(r.flags[0].kind, "spike"); assert.equal(r.flags[0].level, 21.78);
// upward single spike (Hanwella 18.86 between ~15.7)
r = cleanSeries(mk([15.6, 15.7, 18.86, 15.7, 15.8]), { unit: "ft" });
assert.deepEqual(levels(r), [15.6, 15.7, 15.7, 15.8]);
// drop to zero (Wellawaya)
r = cleanSeries(mk([4.1, 4.17, 0, 4.17, 4.2]), { unit: "ft" });
assert.equal(r.flags.length, 1);
// two-reading spike (Pitabeddara 2.95, 2.95 between ~9.7)
r = cleanSeries(mk([9.6, 9.7, 2.95, 2.95, 9.7, 9.8]), { unit: "ft" });
assert.deepEqual(levels(r), [9.6, 9.7, 9.7, 9.8]);
assert.equal(r.flags.length, 2);
// three readings are not a spike (could be real)
r = cleanSeries(mk([9.6, 9.7, 2.95, 2.9, 2.95, 9.7, 9.8]), { unit: "ft" });
assert.equal(r.flags.length, 0);
// spike but neighbours disagree: nothing removed (a step with an odd reading in the middle)
r = cleanSeries(mk([5, 5.1, 9, 12, 12.1]), { unit: "ft" });
assert.equal(r.flags.length, 0);
// opposite sides (monotone climb through a big jump)
r = cleanSeries(mk([5, 5.1, 8.5, 5.4, 5.5]), { unit: "ft" });
assert.equal(r.flags.length, 1, "8.5 is above both neighbours, which agree: spike");
r = cleanSeries(mk([5, 8, 12, 15, 15.2]), { unit: "ft" });
assert.equal(r.flags.length, 0, "a steady climb is real");

// stuck run after the gauge was moving (Baddegama): 13 h of one value keeps the first, drops the rest
const stuck = mk([13.0, 13.5, ...Array(14).fill(13.88), 13.9]);
r = cleanSeries(stuck, { unit: "ft" });
assert.equal(r.flags.filter((f) => f.kind === "stuck").length, 13, "13 repeats after the first of the run");
assert.equal(levels(r).filter((v) => v === 13.88).length, 1);
assert.ok(r.flags[0].hours >= 13 && r.flags[0].rangeBeforeFt >= STUCK_MOVING_FT);
// 11 h is not yet stuck even after movement
r = cleanSeries(mk([5, 5.5, ...Array(12).fill(6), 7]), { unit: "ft" });
assert.equal(r.flags.length, 0);
// Baddegama-like creep: 0.2 ft up over the 12 h before, then frozen 13 h: flagged
r = cleanSeries(mk([13.5, 13.55, 13.6, 13.65, 13.7, 13.75, 13.8, 13.85, 13.88, ...Array(14).fill(13.88)]), { unit: "ft" });
assert.equal(r.flags.filter((f) => f.kind === "stuck").length, 14, "creep of 0.38 ft then frozen 14 h");
r = cleanSeries(mk([4.14, 4.16, 4.18, 4.2, 4.21, 4.22, 4.23, 4.24, ...Array(14).fill(4.24)].map((v) => v / 0.3048 * 0.3048)), { unit: "m" });
assert.equal(r.flags.filter((f) => f.kind === "stuck").length, 14, "Baddegama-like: 0.10 m (0.33 ft) creep, then frozen");
r = cleanSeries(mk([4.17, 4.19, 4.2, 4.2, 4.21, 4.22, 4.22, 4.23, ...Array(14).fill(4.23)]), { unit: "m" });
assert.equal(r.flags.filter((f) => f.kind === "stuck").length, 14, "Baddegama as measured: 0.06 m (0.2 ft) creep is enough");
// a spike just before a run does not count as movement
r = cleanSeries(mk([5, 5.02, 5.01, 9, 5.02, ...Array(14).fill(5.03)]), { unit: "ft" });
assert.equal(r.flags.filter((f) => f.kind === "stuck").length, 0, "calm apart from a spike: not stuck");
assert.equal(r.flags.filter((f) => f.kind === "spike").length, 1);
// calm low-flow river: 23 h at one value after a calm night (range before < 0.3 ft) is real still water: NOT stuck
r = cleanSeries(mk([0.52, 0.54, 0.53, ...Array(24).fill(0.56), 0.6]), { unit: "ft" });
assert.equal(r.flags.length, 0, "calm before, under 36 h: kept");
// ...unless it lasts 36 h or more (Ampara, Mapitigama)
r = cleanSeries(mk([0.52, 0.54, ...Array(40).fill(0.56), 0.6]), { unit: "ft" });
assert.equal(r.flags.filter((f) => f.kind === "stuck").length, 39);
assert.equal(STUCK_LONG_H, 36); assert.equal(STUCK_MOVING_FT, 0.15);
// metres: 0.12 m = 0.39 ft of movement before the run counts
r = cleanSeries(mk([4.0, 4.12, ...Array(14).fill(4.23)]), { unit: "m" });
assert.equal(r.flags.length, 13);
r = cleanSeries(mk([4.2, 4.22, ...Array(14).fill(4.23)]), { unit: "m" });
assert.equal(r.flags.length, 0, "0.03 m (0.1 ft) before: calm");
// a run at the very start of the series has no 'before': not stuck under 36 h
r = cleanSeries(mk(Array(14).fill(3)), { unit: "ft" });
assert.equal(r.flags.length, 0);

// real step rise that stays up: never removed
r = cleanSeries(mk([10, 10.1, 14, 14.2, 14.1, 14.3]), { unit: "ft" });
assert.equal(r.flags.length, 0);
r = cleanSeries(mk([10, 10.1, 16, 22, 22.1, 22.2]), { unit: "ft" });
assert.equal(r.flags.length, 0);

// real flash rise at the LATEST reading: kept, flagged odd only by the rule
let s = mk([10, 10.1, 10.0, 15]);
r = cleanSeries(s, { unit: "ft" });
assert.equal(r.flags.length, 0); assert.equal(r.points.length, 4);
assert.equal(latestLooksOdd(s, { unit: "ft" }), true, "5 ft jump from a settled river");
assert.equal(latestLooksOdd(mk([10, 10.1, 10.0, 12.5]), { unit: "ft" }), false, "2.5 ft is under JUMP_FT");
assert.equal(latestLooksOdd(mk([10, 12, 14, 18]), { unit: "ft" }), false, "the river was already moving");
assert.equal(latestLooksOdd(mk([10, 10.1, 6]), { unit: "ft" }), true, "a drop counts too");
assert.equal(latestLooksOdd(mk([10, 15]), { unit: "ft" }), false, "needs two earlier readings");

// metres gauges: thresholds are in feet internally
const M = 0.3048;
r = cleanSeries(mk([10.4 * M, 10.5 * M, 8 * M, 10.5 * M, 10.6 * M]), { unit: "m" });
assert.equal(r.flags.length, 1, "2.5 ft = 0.76 m dip is a spike");
r = cleanSeries(mk([10.4 * M, 10.5 * M, 9 * M, 10.5 * M, 10.6 * M]), { unit: "m" });
assert.equal(r.flags.length, 0, "1.5 ft = 0.46 m is under SPIKE_FT");
assert.equal(latestLooksOdd(mk([3, 3.01, 3.0, 4.2]), { unit: "m" }), true, "1.2 m = 3.9 ft");
assert.equal(latestLooksOdd(mk([3, 3.01, 3.0, 3.9]), { unit: "m" }), false, "0.9 m = 3.0 ft, not over");
assert.ok(Math.abs(FT_PER_M - 3.28084) < 1e-4);

// gaps: a spike across a long gap is not judged; neighbours far apart in time are not 'within a step'
r = cleanSeries([{ ts: T0, water_level: 34.3 }, { ts: T0 + 5 * H, water_level: 21 }, { ts: T0 + 10 * H, water_level: 34.3 }], { unit: "ft" });
assert.equal(r.flags.length, 0);
// nulls pass through; an hourly gap of 1.5 h still counts
r = cleanSeries([{ ts: T0, water_level: 5 }, { ts: T0 + 1.5 * H, water_level: 5.1 }, { ts: T0 + 3 * H, water_level: 0 }, { ts: T0 + 4.5 * H, water_level: 5.1 }, { ts: T0 + 6 * H, water_level: null }], { unit: null });
assert.equal(r.flags.length, 1); assert.equal(r.points.length, 4);
assert.deepEqual(cleanSeries([], {}).flags, []);

// cleanReadings: levels nulled, rain kept, the object unchanged when clean
const rd = mk([34.2, 34.3, 21.78, 34.3, 34.4]).map((p, i) => ({ ...p, rain_fall: i }));
const c = cleanReadings(rd, { unit: "ft" });
assert.equal(c.readings[2].water_level, null); assert.equal(c.readings[2].rain_fall, 2); assert.equal(c.readings.length, 5);
assert.equal(c.odd, false);
const clean = mk([1, 1.1, 1.2]);
assert.equal(cleanReadings(clean, { unit: "ft" }).readings, clean);
// the latest after a removed spike is judged against the cleaned series
const c2 = cleanReadings(mk([10, 10.1, 2, 10.1, 10.0, 15]).map((p) => ({ ...p, rain_fall: null })), { unit: "ft" });
assert.equal(c2.odd, true);

// An odd latest reading must never weaken a warning (owner, 29 Oct): lib/forecast.ts uses it for a note and a wider range only.
// (makeForecast cannot be imported under node strip-types, so this guards the source.) The reading itself stays in the series.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../lib/forecast.ts", import.meta.url), "utf8");
assert.ok(!/const degraded = [^\n]*ownOdd\s*[;|]/.test(src.replace(/\/\/.*$/gm, "")), "ownOdd must not feed `degraded` (it caps 'likely')");
assert.ok(/if \(ownOdd\) infl \*= 1\.2;/.test(src), "ownOdd widens the range 20%");
assert.ok(!/ownOdd[^\n]*(wording|degraded)/.test(src.replace(/\/\/.*$/gm, "")), "no ownOdd path touches wording or status");
const keep = cleanSeries(mk([10, 10.1, 10.0, 15]), { unit: "ft" });
assert.equal(keep.points[3].water_level, 15, "the odd latest reading stays in the series");

console.log("reading-qc.test.mts: all passed");
