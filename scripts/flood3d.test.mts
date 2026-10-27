// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/flood3d.test.mts
import assert from "node:assert/strict";
import { validateReport, round3, AREAS } from "../lib/flood3dReports.ts";
import { phi, pWet, chanceClass, gaugeSpread, hanwellaMToNagFt, nagFtToHanwellaM } from "../app/[lang]/lab/flood-3d/chance.ts";

const ok = { kind: "water_now", depth: "knee", lat: 6.955, lon: 79.922, acc: 12, src: "gps", consent: true, hp: "", ms: 5000, lang: "si" };
assert.equal(validateReport(ok).ok, true);
assert.equal(validateReport(ok).report.lang, "si");
assert.equal(validateReport({ ...ok, consent: false }).reason, "invalid"); // no consent, nothing stored
assert.equal(validateReport({ ...ok, hp: "x" }).reason, "bot");
assert.equal(validateReport({ ...ok, ms: 100 }).reason, "bot");
assert.equal(validateReport({ ...ok, lat: 6.87, lon: 79.86 }).ok, true); // Wellawatte is inside the margin: stored, the map just does not cover it
assert.equal(validateReport({ ...ok, lat: 7.5 }).reason, "outside");
assert.equal(validateReport({ ...ok, depth: "chest" }).reason, "invalid");
assert.equal(validateReport({ ...ok, kind: "past_wet", event: "ditwah_2025" }).ok, true);
assert.equal(validateReport({ ...ok, kind: "past_dry", depth: undefined, event: "may_2016" }).ok, true);
assert.equal(validateReport({ ...ok, kind: "past_dry", depth: undefined, event: "flood" }).reason, "invalid");
assert.equal(validateReport({ ...ok, kind: "map_check", depth: undefined, mapRight: "no" }).ok, true);
assert.equal(validateReport({ ...ok, kind: "map_check", depth: undefined }).reason, "invalid");
assert.equal(validateReport({ ...ok, note: "my house at 12 Main St" }).report.note, undefined); // free text is never kept
assert.equal(round3(6.95549), 6.955);
assert.ok(AREAS.every((a) => a.south < a.north && a.west < a.east));

assert.ok(Math.abs(phi(0) - 0.5) < 1e-6 && phi(3) > 0.998 && phi(-3) < 0.002);
const g = gaugeSpread(6, 5, 7, 3);
assert.ok(Math.abs(g.sd - 2 / 2.5632) < 1e-3);
assert.ok(pWet(7, 0.6, g) < pWet(6, 0.6, g) && pWet(6, 0.6, g) < pWet(5, 0.6, g)); // lower flood level = likelier wet
assert.ok(pWet(4, 1, g) > pWet(8, 1, g));
const cal = { a: 0.1, b: 0.55, sd_ft: 1 };
assert.equal(chanceClass(0.02, cal).cls, "none");
assert.equal(chanceClass(0.1, cal).cls, "low");
assert.equal(chanceClass(0.5, cal).cls, "medium");
assert.equal(chanceClass(0.99, cal).cls, "high");
const T = [[3, 2.6], [6, 3.7], [10, 7.4]];
assert.equal(hanwellaMToNagFt(2, T), 2.6);
assert.equal(hanwellaMToNagFt(12, T), 7.4);
assert.ok(Math.abs(nagFtToHanwellaM(hanwellaMToNagFt(8, T), T) - 8) < 1e-6);
console.log("flood3d tests passed");
