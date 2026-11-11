// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/archive-freshness.test.mts
import assert from "node:assert/strict";
import { colomboDay, newestRainLive, newestDayPts, judgeArchive, fmt, LIMITS } from "../lib/archiveFreshness.mjs";

const H = 3_600_000, MIN = 60_000;
const now = Date.parse("2026-11-09T02:00:00Z");

// Colombo day: 18:29Z is still the same day, 18:30Z is the next (UTC+05:30)
assert.equal(colomboDay(Date.parse("2026-11-08T18:29:59Z")), "2026-11-08");
assert.equal(colomboDay(Date.parse("2026-11-08T18:30:00Z")), "2026-11-09");

// rain-live: pts are epoch MINUTES; the newest of all devices wins; junk is ignored
const live = { updatedAt: "x", devices: { a: { pts: [[100, 0], [Math.round((now - 10 * MIN) / MIN), 3]] }, b: { pts: [[Math.round((now - 50 * MIN) / MIN), 0]] }, c: {}, d: { pts: [["x", 1], null] } } };
assert.equal(newestRainLive(live), Math.round((now - 10 * MIN) / MIN) * MIN);
assert.equal(newestRainLive({ devices: {} }), null);
assert.equal(newestRainLive(null), null);
assert.equal(newestRainLive({}), null);

// daily files: pts are epoch ms; last point of each device
const day = { A: { pts: [[now - 5 * H, 1], [now - 4 * H, 1]] }, B: { pts: [[now - 40 * MIN, 2]] }, C: { pts: [] }, D: "junk" };
assert.equal(newestDayPts(day), now - 40 * MIN);
assert.equal(newestDayPts({}), null);
assert.equal(newestDayPts({ C: { pts: [] } }), null);

// verdicts: the 7-9 Nov 2026 outage (last HMIS rain record 14:01Z on 7 Nov) must fail by the first check 3 h later, long before 37 h
const lastBefore = Date.parse("2026-11-07T14:01:00Z");
assert.equal(judgeArchive("HMIS rain", lastBefore, lastBefore + 2.9 * H, LIMITS.hmisRain).ok, true);
const j = judgeArchive("HMIS rain", lastBefore, lastBefore + 3.1 * H, LIMITS.hmisRain);
assert.equal(j.ok, false);
assert.match(j.text, /HMIS rain: newest record 3.1 h old \(limit 3 h\)/);
assert.equal(judgeArchive("HMIS rain", lastBefore, lastBefore + 37 * H, LIMITS.hmisRain).ok, false);
// exactly at the limit passes; no records fails; a slightly-future record passes
assert.equal(judgeArchive("x", now - 3 * H, now, 3 * H).ok, true);
assert.equal(judgeArchive("x", null, now, 3 * H).ok, false);
assert.equal(judgeArchive("x", now + 5 * MIN, now, 3 * H).ok, true);
// RiverNet runs every 2 h: a healthy worst case (newest point = last full hour of a run that was 40 min late) stays under its limit
assert.equal(judgeArchive("RiverNet", now - (2 * H + 25 * MIN + 40 * MIN + 30 * MIN), now, LIMITS.rivernet).ok, true);
assert.equal(judgeArchive("RiverNet", now - 4.5 * H, now, LIMITS.rivernet).ok, false);

assert.equal(fmt(45 * MIN), "45 min"); assert.equal(fmt(3 * H), "3 h"); assert.equal(fmt(60 * H), "2.5 days");
console.log("archive-freshness ok");
