// @ts-nocheck (node strip-types test)
// node --experimental-strip-types scripts/curw-status.test.mts
import assert from "node:assert/strict";
import { assessCanal, seaTrend, TIDAL } from "../lib/curwStatus.ts";
const H = 3_600_000, now = Date.parse("2026-10-26T12:00:00+05:30");
const mk = (f) => Array.from({ length: 96 }, (_, i) => ({ ms: now - (95 - i) * H, m: f(i) }));
assert.equal(assessCanal("Salalihini Mw", [], now).state, "offline");
assert.equal(assessCanal("Salalihini Mw", mk(() => 1), now, true).state, "offline");
assert.equal(assessCanal("Salalihini Mw", mk(() => 1).map((p) => ({ ...p, ms: p.ms - 5 * H })), now).state, "offline");
assert.equal(assessCanal("Salalihini Mw", mk(() => 1).slice(-20), now).state, "learning");
assert.equal(assessCanal("Salalihini Mw", mk(() => 1.2), now).state, "normal");
assert.equal(assessCanal("Salalihini Mw", mk((i) => (i < 90 ? 1.2 : 1.2 + (i - 90) * 0.1)), now).state, "rising");
assert.equal(assessCanal("Salalihini Mw", mk((i) => 1 + (i > 80 ? 0.7 : (i % 7) * 0.02)), now).state, "higher");
// tidal: tide swing alone is "normal"; a higher low-tide floor is "higher"
const tide = (i, floor) => floor + 0.3 + 0.3 * Math.sin((2 * Math.PI * i) / 12.4);
assert.ok(TIDAL.has("Kalupalama US"));
assert.equal(assessCanal("Kalupalama US", mk((i) => tide(i, 0.3)), now).state, "normal");
assert.equal(assessCanal("Kalupalama US", mk((i) => tide(i, i > 72 ? 0.6 : 0.3)), now).state, "higher");
assert.equal(assessCanal("Mutwal Inlet", mk((i) => tide(i, 0)), now).state, "normal");
assert.equal(seaTrend([{ ms: now - H, m: 0.1 }, { ms: now, m: 0.3 }]), "rising");
console.log("curw-status ok");
