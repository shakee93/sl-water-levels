// @ts-nocheck (node strip-types test)
// node --experimental-strip-types scripts/tide.test.mts
import assert from "node:assert/strict";
import { tideFt, tideEvents, tideNow, highTideWithin, colomboDay } from "../lib/tide.ts";

const H = 3_600_000;
const t0 = Date.parse("2026-10-26T06:00:00+05:30");
const ev = tideEvents(t0, 48);
// about 2 highs and 2 lows a day, alternating, 4 to 8 hours apart
assert.ok(ev.length >= 7 && ev.length <= 10, `events ${ev.length}`);
for (let i = 1; i < ev.length; i++) {
  assert.notEqual(ev[i].kind, ev[i - 1].kind);
  const gap = (ev[i].t - ev[i - 1].t) / H;
  assert.ok(gap > 3 && gap < 10, `gap ${gap}`);
  assert.ok(Math.abs(ev[i].ft - ev[i - 1].ft) >= 0.1);
}
// every reported high is a real local maximum
for (const e of ev.filter((x) => x.kind === "high")) {
  assert.ok(tideFt(e.t) >= tideFt(e.t - 10 * 60000) - 1e-3 && tideFt(e.t) >= tideFt(e.t + 10 * 60000) - 1e-3);
}
const hs = ev.filter((e) => e.kind === "high");
assert.ok(hs.length >= 3 && hs.length <= 5);
// the daily swing is of the size seen at the gauge (about 1 to 2 ft between a high and the next low)
const swing = Math.max(...ev.map((e) => e.ft)) - Math.min(...ev.map((e) => e.ft));
assert.ok(swing > 0.8 && swing < 3, `swing ${swing}`);
// now-state
const n = tideNow(hs[0].t);
assert.equal(n.nearHigh, true);
assert.equal(n.phase, "near-high");
const n2 = tideNow(hs[0].t + 3 * H);
assert.equal(n2.nearHigh, false);
assert.ok(n2.nextHigh && n2.nextHigh.t > hs[0].t + 3 * H);
assert.ok(highTideWithin(hs[0].t - 2 * H, 3));
assert.equal(colomboDay(Date.parse("2026-10-26T23:59:00+05:30")), colomboDay(Date.parse("2026-10-26T00:01:00+05:30")));
assert.equal(colomboDay(Date.parse("2026-10-27T00:01:00+05:30")), colomboDay(Date.parse("2026-10-26T00:01:00+05:30")) + 1);
console.log("tide ok", ev.map((e) => `${e.kind[0]}${new Date(e.t + 5.5 * H).toISOString().slice(11, 16)}`).join(" "));
