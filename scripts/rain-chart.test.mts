// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/rain-chart.test.mts
import assert from "node:assert/strict";
import { rainClass, yScale, localHour, whenKey, leadLine } from "../lib/rainChart.ts";
import { zoneHours } from "../lib/streetRainWindow.mjs";

// standard hourly rates
assert.equal(rainClass(0.05), null);
assert.equal(rainClass(2.4), "light");
assert.equal(rainClass(2.5), "moderate");
assert.equal(rainClass(7.59), "moderate");
assert.equal(rainClass(7.6), "heavy");
assert.equal(rainClass(50), "heavy");
assert.equal(rainClass(50.1), "violent");

// y-axis: round steps, 2-4 gridlines, never below 2.5 mm
assert.ok(yScale(0).max >= 2.5);
for (const p of [0.3, 3.7, 9, 22, 47, 130]) {
  const { max, ticks } = yScale(p);
  assert.ok(max >= p && ticks.length >= 1 && ticks.length <= 4, `${p}: ${max} ${ticks}`);
  assert.equal(ticks[ticks.length - 1], max);
}

// Sri Lanka clock: 2026-10-24 18:30 UTC = 00:00 on the 25th
const t = Date.UTC(2026, 9, 24, 18, 30);
assert.deepEqual(localHour(t), { hour: 0, day: localHour(t).day });
const noon = Date.UTC(2026, 9, 24, 6, 30); // 12:00 LK on the 24th
assert.equal(whenKey(noon + 6 * 3_600_000, noon), "eve0");
assert.equal(whenKey(noon + 20 * 3_600_000, noon), "morn1");
assert.equal(whenKey(noon + 4 * 3_600_000, noon), "aft0");
assert.equal(whenKey(noon + 11 * 3_600_000, noon), "night0");
assert.equal(whenKey(noon + 13 * 3_600_000, noon), "late");

// lead line
const H = 3_600_000;
const bars = (xs, from) => xs.map((mm, i) => ({ end: from + (i + 1) * H, mm }));
const dry = bars(Array(24).fill(0), noon - 24 * H);
const wet = bars(Array(24).fill(0).map((_, i) => (i === 8 ? 12 : 1)), noon);
let l = leadLine(dry, 0, wet, noon);
assert.equal(l.past.key, "rain.lead.pastNone");
assert.equal(l.next.key, "rain.lead.next");
assert.equal(l.next.cls, "heavy");
assert.equal(l.next.mm, 35);
assert.equal(leadLine(dry, null, dry, noon).past.key, "rain.lead.pastNA");
assert.equal(leadLine(dry, 0, dry, noon).next.key, "rain.lead.nextNone");

// satellite hours: oldest first, mean of the :00 and :30 files, null when both are missing
const base = Date.UTC(2026, 9, 24, 10, 0);
const rate = (ms) => (ms === base ? 4 : ms === base + H / 2 ? 2 : ms === base - H ? null : undefined);
const hrs = zoneHours(rate, base + H / 2, 3);
assert.equal(hrs.length, 3);
assert.deepEqual(hrs[2], { end: base + H, mm: 3 });
assert.deepEqual(hrs[1], { end: base, mm: null });
console.log("rain-chart ok");
