// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/units.test.mts
import assert from "node:assert/strict";
import { formatLevel, formatDelta, toShown, fromShown, plainShown, publishedAs, shownUnit } from "../lib/units.ts";
import { buildYScale } from "../lib/chartAxis.ts";

assert.equal(toShown(0.3048, "m"), 1);
assert.equal(toShown(7.5, "m").toFixed(3), "24.606");
assert.equal(toShown(4, "ft"), 4);
assert.equal(toShown(3.3, null), 3.3);
assert.ok(Math.abs(fromShown(toShown(6.5, "m"), "m") - 6.5) < 1e-12);

assert.equal(formatLevel(7.5, "m"), "24.6 ft");
assert.equal(formatLevel(6.5, "m"), "21.3 ft");
assert.equal(formatLevel(4.23, "ft"), "4.2 ft");
assert.equal(formatLevel(2.345, null), "2.35");      // unknown unit: untouched, unitless
assert.equal(formatLevel(2.3, null, 1), "2.3");
assert.equal(formatLevel(null, "m"), "—");
assert.equal(shownUnit(null), null);
assert.equal(shownUnit("m"), "ft");

assert.equal(formatDelta(0.1, "m", { sign: true }), "+0.3 ft");
assert.equal(formatDelta(0.01, "m", { sign: true }), "+0.03 ft");
assert.equal(formatDelta(-0.3, "ft", { sign: true }), "-0.3 ft");
assert.equal(formatDelta(0, "m", { sign: true }), "0.0 ft");
assert.equal(formatDelta(0.05, null, { sign: true }), "+0.05");

assert.equal(plainShown(toShown(6.5, "m"), "m"), "21.3");
assert.equal(plainShown(15, "ft"), "15");

assert.equal(publishedAs(7.5, "m"), "7.50 m");
assert.equal(publishedAs(4, "ft"), null);
assert.equal(publishedAs(4, null), null);

// Chart ticks in feet: round numbers, and the flood marks (converted) are present as ticks.
const k = (v: number) => toShown(v, "m");
const y = buildYScale({ dataLo: k(5.2), dataHi: k(6.1), marks: { alert: k(6.5), minor: k(7.5), major: k(9.5) }, targetTicks: 6 });
assert.ok(y.ticks.includes(k(6.5)), "alert mark is a tick");
const round = y.ticks.filter((t) => !y.markTicks.has(t));
for (const t of round) assert.equal(Math.abs(t * 2 - Math.round(t * 2)) < 1e-9, true, `round tick ${t}`);
assert.ok(y.domain[0] <= k(5.2) && y.domain[1] >= k(6.5));
console.log("units tests ok");
