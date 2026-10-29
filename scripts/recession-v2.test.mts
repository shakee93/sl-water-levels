// @ts-nocheck (node strip-types test: explicit extensions)
// node --experimental-strip-types --no-warnings scripts/recession-v2.test.mts
// recession-v2 (lib/recessionV2.mjs): a Glencourse-like falling limb is lowered; everything gated stays a copy; nothing is ever raised.
import assert from "node:assert/strict";
import params from "../lib/model/recession-params.json" with { type: "json" };
import { recessionV2, lawLevelFt, ratesFt, TRIGGER_FT_PER_H, TRIGGER_SLOW_FT_PER_H, RAIN6_MAX_MM, RAIN24P90_MAX_MM, HORIZONS, FT } from "../lib/recessionV2.mjs";
import { shadowVariants } from "../lib/shadowForecast.ts";

const H = 3_600_000, T0 = 1_792_000_000_000;
const OK_RAIN = { storm: false, next6hMm: 1, next24hP90Mm: 8 };
// Glencourse (metres): 36 ft = 10.97 m, falling 0.5 ft/h over the last 8 h, level 6 ft above its base of about 30.9 ft
const toM = (ft) => ft * FT;
const mkObs = (ratesFtPerH, nowFt = 36, n = 9) => Array.from({ length: n }, (_, i) => ({ ts: T0 - (n - 1 - i) * H, level: toM(nowFt + ratesFtPerH * (n - 1 - i)) })); // rate > 0 = falling
const mkF = (over = {}) => ({ station: "Glencourse", unit: "m", currentLevel: toM(36), asOfTs: T0, method: "model", horizons: [1, 3, 6, 12, 24].map((h) => ({ h, ts: T0 + h * H, level: toM(36), low: toM(35), high: toM(37) })), ...over });

assert.equal(TRIGGER_FT_PER_H, -0.1); assert.equal(TRIGGER_SLOW_FT_PER_H, -0.03); assert.deepEqual(HORIZONS, [3, 6, 12, 24]);
assert.ok(params.gauges.Glencourse && params.gauges.Glencourse.law !== "persist" && !params.gauges.Glencourse.disabledByGuard, "Glencourse has a law");

// 1. falling limb: lowered, never raised, 1 h untouched, band moves, input not mutated
const f = mkF(), obs = mkObs(0.5);
const r = recessionV2(f, obs, OK_RAIN, params);
assert.equal(r.applied, true, r.reason);
assert.deepEqual(r.horizons[0], f.horizons[0], "1 h untouched");
for (let i = 1; i < 5; i++) {
  assert.ok(r.horizons[i].level < f.horizons[i].level, `h${f.horizons[i].h} lowered`);
  assert.ok(r.horizons[i].high < f.horizons[i].high && r.horizons[i].low < r.horizons[i].high, "band moves with it");
  assert.ok(f.horizons[i].low - r.horizons[i].low >= f.horizons[i].high - r.horizons[i].high - 1e-12, "low edge widened at least as much");
}
assert.ok(r.horizons[4].level <= r.horizons[3].level && r.horizons[3].level <= r.horizons[2].level, "keeps falling with the horizon");
const g = params.gauges.Glencourse.params;
assert.ok(r.horizons[4].level / FT * 1 >= 0 && r.horizons[4].level / 1 > toM(g.B - 0.01), "never below the base level");
assert.equal(f.horizons[3].level, toM(36), "live is not mutated");
// the number: same as the law itself
const law12 = lawLevelFt(params.gauges.Glencourse, 36, -0.5, 12);
assert.ok(Math.abs(r.horizons[3].level - toM(law12)) < 1e-9, "12 h equals the law");

// 2. untouched cases
const same = (x, why) => { const y = recessionV2(x.f, x.obs, x.rain, params); assert.equal(y.applied, false, why + ": " + y.reason); assert.deepEqual(y.horizons, x.f.horizons, why); return y.reason; };
assert.equal(same({ f, obs: mkObs(-0.5), rain: OK_RAIN }, "rising"), "not-falling");
assert.equal(same({ f, obs: mkObs(0.02), rain: OK_RAIN }, "steady"), "not-falling");
assert.equal(same({ f, obs, rain: { ...OK_RAIN, storm: true } }, "storm flag"), "storm");
assert.equal(same({ f, obs, rain: { ...OK_RAIN, next6hMm: RAIN6_MAX_MM } }, "heavy 6 h rain"), "heavy-rain");
assert.equal(same({ f, obs, rain: { ...OK_RAIN, next24hP90Mm: RAIN24P90_MAX_MM } }, "heavy 24 h p90 rain"), "heavy-rain");
assert.equal(same({ f, obs, rain: null }, "rain unknown (null)"), "rain-unknown");
assert.equal(same({ f, obs, rain: undefined }, "rain unknown (undefined)"), "rain-unknown");
assert.equal(same({ f, obs, rain: { storm: false, next6hMm: null, next24hP90Mm: null } }, "rain inputs null"), "rain-unknown");
assert.equal(same({ f: mkF({ method: "trend" }), obs, rain: OK_RAIN }, "trend-only"), "not-model");
assert.equal(same({ f: mkF({ unit: null }), obs, rain: OK_RAIN }, "unknown unit"), "unit-unknown");
assert.equal(same({ f: mkF({ station: "Nowhere" }), obs, rain: OK_RAIN }, "no such gauge"), "no-law");
assert.equal(same({ f: mkF({ horizons: [] }), obs, rain: OK_RAIN }, "no horizons"), "no-horizons");
assert.equal(same({ f, obs: [{ ts: T0, level: toM(36) }], rain: OK_RAIN }, "no reading 3 h back"), "no-rate");
// the river turned in the last hour
const turning = mkObs(0.5); turning[turning.length - 1] = { ts: T0, level: toM(36) }; turning[turning.length - 2] = { ts: T0 - H, level: toM(35.9) };
assert.equal(same({ f, obs: turning, rain: OK_RAIN }, "turned up in the last hour"), "turning-up");
// guarded gauges and gauges with no law
const guarded = Object.entries(params.gauges).filter(([, x]) => x.disabledByGuard).map(([n]) => n);
assert.ok(guarded.length >= 1 && guarded.includes("Peradeniya"), "guard list present");
assert.equal(same({ f: mkF({ station: guarded[0] }), obs, rain: OK_RAIN }, "guarded gauge"), "guard-off");
assert.equal(same({ f: mkF({ station: "Nagalagam Street", unit: "ft", currentLevel: 36, horizons: f.horizons.map((p) => ({ ...p, level: 36, low: 35, high: 37 })) }), obs: mkObs(0.5).map((o) => ({ ...o, level: o.level / FT })), rain: OK_RAIN }, "tidal gauge without a law"), "no-law");
// a glitch as the latest reading is not trusted
const glitch = mkObs(0.5); glitch[glitch.length - 1] = { ts: T0, level: toM(36) - toM(8) };
assert.equal(recessionV2(mkF({ currentLevel: toM(28) }), glitch, OK_RAIN, params).applied, false, "latest reading jumped like a glitch");
// a spike inside the window is cleaned before the rate is read: a 3 h-back spike must not fake a fall
const spiked = mkObs(0, 36); spiked[spiked.length - 4] = { ts: T0 - 3 * H, level: toM(41) }; // flat river with a one-reading spike exactly 3 h back
assert.equal(recessionV2(f, spiked, OK_RAIN, params).applied, false, "spike 3 h back is dropped, river is flat");

// 3. a live forecast already below the law is left alone (never raised)
const low = mkF({ horizons: f.horizons.map((p) => ({ ...p, level: toM(31), low: toM(30), high: toM(32) })) });
const rl = recessionV2(low, obs, OK_RAIN, params);
for (let i = 0; i < 5; i++) assert.ok(rl.horizons[i].level <= low.horizons[i].level + 1e-12, "never raised");
// property: over many random falls and levels nothing is ever raised
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
for (let n = 0; n < 300; n++) {
  const names = Object.keys(params.gauges), st = names[Math.floor(rnd() * names.length)], unit = rnd() < 0.5 ? "m" : "ft";
  const lvFt = 5 + rnd() * 40, rate = rnd() * 1.5, k = unit === "m" ? FT : 1;
  const ff = { station: st, unit, currentLevel: lvFt * k, asOfTs: T0, method: "model", horizons: [1, 3, 6, 12, 24].map((h) => ({ h, ts: T0 + h * H, level: (lvFt + rnd() * 3 - 2) * k, low: (lvFt - 3) * k, high: (lvFt + 3) * k })) };
  const o = Array.from({ length: 9 }, (_, i) => ({ ts: T0 - (8 - i) * H, level: (lvFt + rate * (8 - i)) * k }));
  const y = recessionV2(ff, o, OK_RAIN, params);
  y.horizons.forEach((p, i) => { assert.ok(p.level <= ff.horizons[i].level + 1e-9, `${st} never raised`); assert.ok(p.h !== 1 || p.level === ff.horizons[i].level); });
}

// 4. the slow-fall variant: a gentle fall is copied by v2 and lowered by v2-slow; both are in shadowVariants and the rain gate applies
const gentle = mkObs(0.05);
const sv = shadowVariants(f, gentle, OK_RAIN);
assert.deepEqual(sv.map((v) => v.variant), ["copy", "recession-v1", "recession-v2", "recession-v2-slow"]);
assert.deepEqual(sv[2].horizons, f.horizons, "v2: 0.05 ft/h is not falling enough");
assert.ok(sv[3].horizons.some((p, i) => p.level < f.horizons[i].level), "v2-slow lowers a gentle fall");
const sv2 = shadowVariants(f, obs, OK_RAIN);
assert.ok(sv2[2].horizons[3].level < f.horizons[3].level && sv2[3].horizons[3].level <= f.horizons[3].level, "falling: v2 lowers");
const sv3 = shadowVariants(f, obs, null);
assert.deepEqual(sv3[2].horizons, f.horizons, "shadowVariants: unknown rain = v2 copy");
assert.deepEqual(sv3[3].horizons, f.horizons, "shadowVariants: unknown rain = v2-slow copy");
assert.deepEqual(shadowVariants(f, obs, { ...OK_RAIN, storm: true })[2].horizons, f.horizons, "shadowVariants: storm = copy");
assert.ok(ratesFt("m", toM(36), T0, obs).r3 < -0.49 && ratesFt("m", toM(36), T0, obs).r3 > -0.51, "rate in ft/h from a metre gauge");

console.log("recession-v2 tests passed");
