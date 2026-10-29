// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/uptime.test.mts
import assert from "node:assert/strict";
import { windowUptime, fmtPct, percentile, outagesFrom, minutesOf, INTERVAL_MS, WINDOWS } from "../lib/uptimeCalc.mjs";

const M = 60_000, H = 3_600_000, D = 86_400_000;
const now = Date.UTC(2026, 9, 29, 12, 0);

// --- no rows = not measured, never 0% or down
assert.equal(windowUptime({ checks: 0, up: 0, firstTs: null }, now, WINDOWS["30d"]), null);
assert.equal(windowUptime(null, now, WINDOWS["30d"]), null);
// --- full window of data: no "since"
let u = windowUptime({ checks: 8640, up: 8631, firstTs: now - 30 * D + 5 * M }, now, WINDOWS["30d"]);
assert.ok(Math.abs(u.pct - 99.8958) < 0.001); assert.equal(u.since, null);
// --- probe started 2 days ago: "since" is its first check, and the % is over the checks that exist
u = windowUptime({ checks: 576, up: 576, firstTs: now - 2 * D }, now, WINDOWS["30d"]);
assert.equal(u.pct, 100); assert.equal(u.since, now - 2 * D);
// --- up can never exceed checks
assert.equal(windowUptime({ checks: 10, up: 12, firstTs: now }, now, D).pct, 100);

// --- percent display floors, never rounds up to a claim we did not earn
assert.equal(fmtPct(99.996, 2), "99.99"); assert.equal(fmtPct(99.96), "99.9"); assert.equal(fmtPct(100), "100");
assert.equal(fmtPct(99.95, 2), "99.95"); assert.equal(fmtPct(99.9, 2), "99.9"); assert.equal(fmtPct(99, 1), "99"); assert.equal(fmtPct(null), null);

// --- percentiles (nearest rank)
assert.equal(percentile([], 50), null);
assert.equal(percentile([5], 95), 5);
const xs = Array.from({ length: 100 }, (_, i) => 100 - i); // unsorted 100..1
assert.equal(percentile(xs, 50), 50); assert.equal(percentile(xs, 95), 95);
assert.equal(percentile([3, NaN, 1, 2], 50), 2);

// --- outages
assert.deepEqual(outagesFrom([], null, now), []);
// one failed check = 5 minutes
let o = outagesFrom([now - H], { ts: now - 5 * M, ok: 1 }, now);
assert.equal(o.length, 1); assert.equal(o[0].durationMs, INTERVAL_MS); assert.equal(o[0].end, now - H + INTERVAL_MS); assert.equal(o[0].ongoing, false);
// three consecutive failures = one 15-minute outage
const t0 = now - 3 * H;
o = outagesFrom([t0 + 10 * M, t0, t0 + 5 * M], { ts: now - 5 * M, ok: 1 }, now);
assert.equal(o.length, 1); assert.equal(o[0].checks, 3); assert.equal(o[0].durationMs, 15 * M); assert.equal(minutesOf(o[0].durationMs), 15);
// failures separated by a hole in the probe (30 min of no rows) are two outages, and the hole is not counted as down time
o = outagesFrom([t0, t0 + 5 * M, t0 + 40 * M], { ts: now - 5 * M, ok: 1 }, now);
assert.equal(o.length, 2); assert.equal(o[0].durationMs, 10 * M); assert.equal(o[1].durationMs, 5 * M);
// still going: latest row is the last failure, and recent
o = outagesFrom([now - 15 * M, now - 10 * M, now - 5 * M], { ts: now - 5 * M, ok: 0 }, now);
assert.equal(o[0].ongoing, true); assert.equal(o[0].end, null); assert.equal(o[0].durationMs, 15 * M);
// last failure long ago, probe silent since: NOT ongoing (not measured != down)
o = outagesFrom([now - 5 * H], { ts: now - 5 * H, ok: 0 }, now);
assert.equal(o[0].ongoing, false);
// target recovered: latest ok
o = outagesFrom([now - 10 * M], { ts: now - 5 * M, ok: 1 }, now);
assert.equal(o[0].ongoing, false);
assert.equal(minutesOf(10), 1);
console.log("uptime tests passed");
