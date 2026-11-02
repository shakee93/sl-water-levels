// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/wet-core.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BETA, CORE_MIN_N, PEAK_H, RISE_CAP, VARIANT, applyWetCore, wetCore, wetCoreFloor, wetCoreRise, wetCoreScale } from "../lib/model/wetCore.mjs";
import { groundRainSeries, zonesFrom } from "../lib/model/gaugeRain.mjs";
import { shadowVariants } from "../lib/shadowForecast.ts";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const H = 3_600_000;
const v4 = JSON.parse(readFileSync(new URL("../lib/model/storm-model-v4.json", import.meta.url), "utf8"));
assert.equal(VARIANT, "wet-core");

// ---- the 1 Nov shape: 46 gauges, a mean of ~17 mm, the wettest tenth at 60-77 mm, the wet part still raining (mm3)
const hanwellaLike = [
  ...[77, 74, 70, 68, 64, 60, 52, 48, 45, 44].map((x) => ({ mm24: x, mm3: x * 0.6 })), // the core: 10 of 46 (ceil(0.2 x 46) = 10)
  ...Array.from({ length: 36 }, (_, i) => ({ mm24: i < 8 ? 8 : 1, mm3: 0 })),
];
const wc = wetCore(hanwellaLike);
assert.equal(wc.n, 46);
assert.equal(wc.k, 10);
assert.ok(wc.mean24 < 25 && wc.core24 > 55, `mean ${wc.mean24} core ${wc.core24}`);
assert.ok(wc.active, "core raining now: active");
near(wc.recent3, hanwellaLike.slice(0, 10).reduce((s, x) => s + x.mm3, 0) / 10);

// ---- what keeps it off
assert.equal(wetCore([]).active, false);
assert.equal(wetCore(undefined).active, false);
assert.equal(wetCore(hanwellaLike.slice(0, CORE_MIN_N - 1)).active, false, "too few gauges");
// the 28 Oct case: 24 h totals left over from yesterday, no rain in the last 4 h
assert.equal(wetCore(hanwellaLike.map((u) => ({ mm24: u.mm24, mm3: 2 }))).active, false, "not raining now");
assert.equal(wetCore(hanwellaLike.map((u) => ({ mm24: u.mm24 }))).active, false, "no mm3 = unknown = off");
// one glitching gauge (400 mm) among dry ones: the k-th wettest is dry -> off
const glitch = [{ mm24: 400, mm3: 100 }, ...Array.from({ length: 20 }, () => ({ mm24: 1, mm3: 0 }))];
assert.equal(wetCore(glitch).active, false, "one wet gauge cannot switch it on");
// a wide, moderate rain (everything 30 mm): the core is below 40 mm -> off
assert.equal(wetCore(Array.from({ length: 30 }, () => ({ mm24: 30, mm3: 30 }))).active, false, "core below 40 mm");
// the core must be ALL wet: 3 of 10 gauges wet, the 3rd of k=3 is fine, but k = 3 only for n < 15
assert.equal(wetCore([{ mm24: 90, mm3: 40 }, { mm24: 80, mm3: 40 }, { mm24: 70, mm3: 40 }, ...Array.from({ length: 7 }, () => ({ mm24: 0, mm3: 0 }))]).active, true, "n = 10: k = 3 (min), three wet gauges are a core");
assert.equal(wetCore([{ mm24: 90, mm3: 40 }, { mm24: 80, mm3: 40 }, ...Array.from({ length: 8 }, () => ({ mm24: 0, mm3: 0 }))]).active, false, "two wet gauges of ten: k = 3 includes a dry one");

// ---- eligibility and the rise
const hw = v4.stations.Hanwella, bd = v4.stations.Baddegama, gc = v4.stations.Glencourse;
assert.ok(wetCoreScale(hw) > 1, "Hanwella: skilled storm model");
assert.equal(wetCoreScale(bd), 0, "Baddegama: storm model never earned its keep -> not eligible");
assert.equal(wetCoreScale(gc), 0);
assert.equal(wetCoreScale(null), 0);
assert.equal(wetCoreScale({ scale: 1, horizons: { 12: { use: false } } }), 0);
const rise = wetCoreRise(wc, wetCoreScale(hw));
near(rise, BETA * (wc.core24 - 20) * hw.scale, 1e-9);
assert.ok(rise > 0.8 && rise < 1.6, `Hanwella 1 Nov: about a metre (${rise})`);
assert.equal(wetCoreRise({ ...wc, active: false }, 1), 0, "inactive: no rise");
assert.equal(wetCoreRise(wc, 0), 0, "scale 0 (not eligible): no rise");
near(wetCoreRise({ active: true, core24: 500 }, 1), RISE_CAP, 1e-9);
assert.ok(wetCoreRise({ ...wc, core24: 60 }, 1) > wetCoreRise({ ...wc, core24: 45 }, 1), "more core rain, more rise");
assert.equal(wetCoreRise({ active: true, core24: 10 }, 1), 0, "never negative");

// ---- the floor
near(wetCoreFloor(2.17, 1, PEAK_H), 3.17);
near(wetCoreFloor(2.17, 1, PEAK_H / 2), 2.67);
near(wetCoreFloor(2.17, 1, 24), 3.17, 1e-9); // capped at the full rise
near(wetCoreFloor(2.17, 1, 0), 2.17);
const live = [1, 3, 6, 12, 24].map((h) => ({ h, ts: 1000 * h, level: 2.2 + 0.05 * h, low: 2.0 + 0.04 * h, high: 2.4 + 0.07 * h }));
const frozen = JSON.stringify(live);
const out = applyWetCore(live, 2.17, 1.0);
assert.equal(JSON.stringify(live), frozen, "input not mutated");
assert.equal(out.length, live.length);
for (let i = 0; i < live.length; i++) {
  assert.ok(out[i].level >= live[i].level - 1e-12, "never lowered");
  assert.ok(out[i].low >= live[i].low - 1e-12 && out[i].high >= live[i].high - 1e-12);
  near(out[i].high - out[i].low, live[i].high - live[i].low); // the band moves with the level
  assert.equal(out[i].h, live[i].h);
  assert.equal(out[i].ts, live[i].ts);
}
near(out[3].level, 3.17); // 12 h: floor 2.17 + 1.0 beats the live 2.8
near(out[4].level, live[4].level); // 24 h: the live 3.4 is above the floor 3.17 and stays
assert.ok(out[0].level - live[0].level < 0.01, "1 h: the floor (2.17 + 1/12) is about the live 2.25");
near(out[3].high - live[3].high, out[3].level - live[3].level);
assert.deepEqual(applyWetCore(live, null, 1.0), live, "base level unknown: a copy");
assert.deepEqual(applyWetCore(live, 2.17, 0), live, "no rise: a copy");
assert.deepEqual(applyWetCore(live.map((p) => ({ ...p, low: null, high: null })), 2.17, 1)[3].low, null, "null range stays null");

// ---- shadowVariants: a variant `wet-core`, a copy unless the forecast carries an active wet core
const f = { station: "Hanwella", unit: "m", currentLevel: 2.22, asOfTs: 5 * H, method: "model", horizons: live };
const names = shadowVariants(f, []).map((v) => v.variant);
assert.ok(names.includes("wet-core"));
assert.deepEqual(shadowVariants(f, []).find((v) => v.variant === "wet-core").horizons, live, "no wetCore on the forecast: a copy");
const fw = { ...f, wetCore: { rise: 1.0, base0: 2.17, core24: 51, mean24: 17, recent3: 30, k: 10, n: 46 } };
assert.equal(JSON.stringify(shadowVariants(fw, []).find((v) => v.variant === "wet-core").horizons), JSON.stringify(out));
assert.deepEqual(shadowVariants({ ...fw, method: "trend" }, []).find((v) => v.variant === "wet-core").horizons, live, "trend-only gauges: a copy");
for (const v of shadowVariants(fw, []).filter((x) => x.variant !== "wet-core")) assert.ok(v.horizons.length, v.variant + " still present");
assert.deepEqual(shadowVariants(fw, []).find((v) => v.variant === "copy").horizons, live, "the control stays live");
assert.equal(JSON.stringify(live), frozen, "live not mutated by shadowVariants");

// ---- gaugeRain exposes the last 4 h per gauge (mm3), the input of "raining now"
const cat = JSON.parse(readFileSync(new URL("../lib/model/catchments.json", import.meta.url), "utf8"));
const sub = JSON.parse(readFileSync(new URL("../lib/model/subcatchments.json", import.meta.url), "utf8"));
const z = zonesFrom(cat, sub, "Hanwella");
const origin = Date.UTC(2026, 10, 1, 14);
const [lat, lon] = z.near[0];
const pts = [];
for (let t = origin - 4 * H; t <= origin + 30 * 60_000; t += 30 * 60_000) pts.push([Math.round(t / 60_000), 10 * Math.max(0, Math.min(t, origin) - (origin - 3 * H)) / H]); // 10 mm/h from 11:00 to 14:00
const gr = groundRainSeries({ gauges: [{ n: "G", lat, lon, pts }], origin, zones: z });
assert.ok(gr.used[0].mm3 >= 19.9 && gr.used[0].mm3 <= 20.1, `mm3 ${gr.used[0].mm3}`); // hours ending 12:00 and 13:00 (k = -2, -1) are covered; 14:00 is k = 0
const dry = groundRainSeries({ gauges: [{ n: "D", lat, lon, pts: pts.map((p) => [p[0], 5]) }], origin, zones: z });
assert.equal(dry.used[0].mm3, 0);

console.log("wet-core tests passed");
