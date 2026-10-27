// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/level-notes.test.mts
import assert from "node:assert/strict";
import { fallSummary, heavyRainAround, nearRain24hClipped, riseSummary, townsNear } from "../lib/levelNotes.ts";

const H = 3_600_000;
const T0 = 1_000 * H;
const FT = 0.3048;
const hourly = (levels: number[]) => levels.map((v, i) => ({ ts: T0 + i * H, water_level: v }));

// Hanwella 26 Oct 2026: 14 -> 22 ft in 9 h (feet gauge: mpu 0.3048)
const hanwella = hourly([14, 14.2, 14.6, 15.4, 16.5, 17.8, 19, 20.2, 21.2, 22]);
const r = riseSummary(hanwella, FT);
assert.ok(r && r.hours === 9 && Math.abs(r.riseM / FT - 8) < 1e-9, "Hanwella rose 8 ft in 9 h");

// Deraniyagala 7.6 -> 13.2 ft in 2 h: a short, large climb still counts
assert.equal(riseSummary(hourly([7.6, 7.7, 7.6, 10.2, 13.2]), FT)?.hours, 2);

// small rise (1.0 ft) is not worth a line; 1.5 ft is
assert.equal(riseSummary(hourly([10, 10.3, 10.6, 11.0]), FT), null);
assert.ok(riseSummary(hourly([10, 10.5, 11, 11.5]), FT));
// a metre gauge: 0.5 m is enough, 0.3 m is not
assert.ok(riseSummary(hourly([2, 2.2, 2.4, 2.5]), 1));
assert.equal(riseSummary(hourly([2, 2.1, 2.2, 2.3]), 1), null);
// already turned back down from the top: no "rose" line
assert.equal(riseSummary(hourly([10, 12, 14, 12.5, 11.8]), FT), null);
// window is the last 12 h only: a low 20 h ago does not count
const old = hourly([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14.1, 14.1, 14.2]);
assert.equal(riseSummary(old, FT), null);
// climbed 2 ft but has been flat for the last 5 h (Moragaswewa at Alert, 27 Oct): not a current rise
assert.equal(riseSummary(hourly([10, 11, 12, 12, 12, 12, 12, 12]), FT), null);
// too few readings
assert.equal(riseSummary(hourly([1, 5]), FT), null);

// Falling since the peak: Alert gauge, peak 22.2 then down 1.5 ft with the last 2 h falling
const f = fallSummary(hourly([18, 20, 22, 22.2, 21.9, 21.2, 20.7]), FT);
assert.ok(f && f.peakTs === T0 + 3 * H && Math.abs(f.dropM / FT - 1.5) < 1e-9);
// tiny drop (0.1 ft from the peak) is not "clearly falling"
assert.equal(fallSummary(hourly([21, 22, 22.2, 22.15, 22.1]), FT), null);
// dropped earlier but ticking up again in the last 2 h
assert.equal(fallSummary(hourly([20, 22.2, 21, 20.4, 20.6]), FT), null);
// flat for the last 2 h after dropping: not falling now
assert.equal(fallSummary(hourly([20, 22.2, 21, 20.4, 20.4, 20.4]), FT), null);
// peak is the newest reading: nothing to report
assert.equal(fallSummary(hourly([18, 19, 20, 21]), FT), null);

// satellite rain beside the gauge: 24 h clipped at 15 mm/h
assert.equal(nearRain24hClipped(Array(24).fill(5)), 120);
assert.equal(nearRain24hClipped(Array(24).fill(40)), 360); // each hour clipped at 15
assert.equal(nearRain24hClipped(Array(24).fill(null)), null);
assert.equal(nearRain24hClipped(null), null);
assert.equal(nearRain24hClipped(Array(10).fill(5)), null);

// heavy rain around: the town pages' marks (50 mm / 6 h, 100 mm / 24 h), the street-likely mark, or the gauge's own trigger
const none = { catch6h: null, catch24h: null, near24hClipped: null, measuredHeavy: false };
assert.equal(heavyRainAround(none), false);
assert.equal(heavyRainAround({ ...none, catch6h: 49 }), false);
assert.equal(heavyRainAround({ ...none, catch6h: 50 }), true);
assert.equal(heavyRainAround({ ...none, catch24h: 100 }), true);
assert.equal(heavyRainAround({ ...none, near24hClipped: 99 }), false);
assert.equal(heavyRainAround({ ...none, near24hClipped: 100 }), true);
assert.equal(heavyRainAround({ ...none, measuredHeavy: true }), true);

// nearest towns, within range, at most 2
const towns = [{ n: "far", lat: 7.5, lon: 80 }, { n: "b", lat: 7.22, lon: 79.85 }, { n: "a", lat: 7.21, lon: 79.84 }, { n: "c", lat: 7.3, lon: 79.9 }];
assert.deepEqual(townsNear({ lat: 7.2, lon: 79.84 }, towns, 15, 2).map((x) => x.n), ["a", "b"]);
assert.deepEqual(townsNear({ lat: 9, lon: 81 }, towns, 15, 2), []);

console.log("level-notes: ok");
