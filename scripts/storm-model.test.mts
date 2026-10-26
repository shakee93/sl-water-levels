// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/storm-model.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STORM_HORIZONS, fitNonNeg, fitNonNegL1, isStormHour, rainTotals, stormCorrection, stormFeatures } from "../lib/model/stormModel.mjs";
import { RAIN_RISK_MM, RAIN_RISK_P90_MM, rainRiskLine, rainRiskOf, rainRiskPush } from "../lib/rainRisk.ts";
import { pushText } from "../lib/i18n/return.ts";

const sm = JSON.parse(readFileSync(new URL("../lib/model/storm-model.json", import.meta.url), "utf8"));
const gm = JSON.parse(readFileSync(new URL("../lib/model/gauge-model.json", import.meta.url), "utf8"));

// ---- rain totals and the gate: r(k) = mm in the hour ending k hours after the forecast time
const flat = (v) => () => v;
assert.deepEqual(rainTotals(flat(1)), { past24: 24, next24: 24, past72: 72 });
assert.equal(isStormHour(flat(2.1), 50), true); // 24 x 2.1 = 50.4
assert.equal(isStormHour(flat(2), 50), false);
assert.equal(isStormHour((k) => (k > 0 ? 3 : 0), 50), true); // forecast alone is enough
assert.equal(isStormHour((k) => (k <= 0 ? 3 : 0), 50), true); // so is rain that already fell
assert.equal(rainTotals((k) => (k === 5 ? undefined : 1)).next24, null); // a missing hour is unknown, not zero

// ---- features: routed window (h - from, h - to], forecast before the horizon, wet-ground interaction
const r = (k) => (k >= 1 && k <= 3 ? 10 : k <= 0 && k > -72 ? 1 : 0);
// h = 6, window from 8 to 2: hours -1..4 => k = -1, 0 (1 mm each) + 1..3 (10 mm each) + 4 (0) = 32
const x = stormFeatures(r, 6, { from: 8, to: 2 });
assert.equal(x[0], 32);
assert.equal(x[2], 30); // forecast rain 1..6
const W = Math.min(72 / 100, 2.5);
assert.ok(Math.abs(x[1] - 32 * W) < 1e-9 && Math.abs(x[3] - 30 * W) < 1e-9);
assert.equal(stormFeatures((k) => (k === 2 ? NaN : 1), 6, { from: 8, to: 2 }), null);
assert.equal(stormFeatures(flat(1), 1, { from: 12, to: 2 }).length, 4);
assert.equal(stormCorrection(null, x), 0);
assert.equal(stormCorrection({ use: false, b0: 1, w: [1] }, x), 0);
assert.equal(stormCorrection({ use: true, b0: 0.5, w: [0.1, 0, 0.1, 0] }, x), 0.5 + 3.2 + 3);

// ---- non-negative fit recovers a positive effect and never returns a negative weight
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const X = [], y = [];
for (let i = 0; i < 400; i++) { const a = rnd() * 100, b = rnd() * 100; X.push([a, b]); y.push(0.05 * a - 0.02 * b + 1 + (rnd() - 0.5) * 0.2); }
const m = fitNonNeg(X, y, new Float64Array(400).fill(1), 0.001);
assert.ok(m.w.every((v) => v >= 0));
assert.ok(Math.abs(m.w[0] - 0.05) < 0.01, `weight ${m.w[0]}`);
assert.equal(m.w[1], 0); // a negative true effect is clamped, not fitted
const m1 = fitNonNegL1(X, y, 0.01);
assert.ok(m1.w.every((v) => v >= 0));

// ---- the shipped file
assert.ok(sm.gate >= 30 && sm.gate <= 100);
for (const h of STORM_HORIZONS) {
  const p = sm.pooled[h];
  assert.equal(p.w.length, 4, `pooled ${h}`);
  assert.ok(p.w.every((v) => v >= 0), `pooled ${h} non-negative`);
  assert.ok(sm.bandFactor[h] >= 1, `band factor ${h}`);
}
let shipped = 0;
for (const [name, st] of Object.entries(sm.stations)) {
  assert.ok(gm.stations[name], `${name} has a gauge-only model`);
  assert.ok(st.scale > 0 && st.win.from > st.win.to - 1);
  for (const h of STORM_HORIZONS) {
    const hz = st.horizons[h];
    assert.ok(hz, `${name} ${h}h`);
    if (h >= 12) {
      assert.ok(hz.base, `${name} ${h}h base`);
      const cols = 6 + st.up.length * 3 + (hz.base.tide ? 10 : 0);
      assert.equal(hz.base.w.length, cols, `${name} ${h}h base weights`);
      assert.equal(hz.base.edges.length + 1, hz.base.q10.length);
    }
    if (hz.use) {
      shipped++;
      // only ships when the leave-one-storm-out score beat the gauge-only model and "level stays put" in storm hours
      assert.ok(hz.backtest.storm <= 0.97 * hz.backtest.base, `${name} ${h}h storm skill`);
      assert.ok(hz.backtest.storm < hz.backtest.pers, `${name} ${h}h beats persistence`);
      assert.ok(hz.backtest.stormN >= 60 && hz.backtest.events >= 3);
      assert.ok(hz.band.q10.every((v, b) => Number.isFinite(v) && v < hz.band.q90[b]), `${name} ${h}h band`);
    }
  }
}
assert.ok(shipped >= 20, `${shipped} gauge/horizons ship the correction`);

// ---- warning thresholds (from the backtest: 65% of hours with 50 mm+ forecast saw a rise of 1 ft or more)
assert.equal(RAIN_RISK_MM, 50);
assert.equal(rainRiskOf(null), null);
assert.equal(rainRiskOf({ det: 49.9, p90: 99.9 }), null);
assert.deepEqual(rainRiskOf({ det: 50, p90: 80 }), { level: "heavy", mm: 50, detMm: 50, p90Mm: 80 });
assert.equal(rainRiskOf({ det: 83, p90: null }).mm, 85);
assert.equal(rainRiskOf({ det: 120, p90: 200 }).level, "very-heavy");
const poss = rainRiskOf({ det: 30, p90: RAIN_RISK_P90_MM });
assert.equal(poss.level, "possible");
assert.equal(poss.mm, 100);
assert.equal(rainRiskOf({ det: null, p90: null }), null);
assert.equal(rainRiskLine({ level: "heavy", mm: 80 }), "Heavy rain forecast upstream in the next 24 hours (about 80 mm). The river may rise faster than the line shows.");
assert.match(rainRiskLine({ level: "possible", mm: 110 }), /up to about 110 mm/);
for (const lang of ["si", "ta"]) {
  assert.ok(rainRiskLine({ level: "heavy", mm: 80 }, lang).includes("80"));
  assert.notEqual(rainRiskLine({ level: "heavy", mm: 80 }, lang), rainRiskLine({ level: "heavy", mm: 80 }));
  assert.ok(rainRiskPush(lang).length > 10);
}

// ---- push text: the river-alert message gets the extra sentence only when heavy rain is forecast upstream
for (const lang of ["en", "si", "ta"]) {
  const plain = pushText(lang, "rise", [{ name: "Hanwella", level: 2, street: null }]);
  const rain = pushText(lang, "rise", [{ name: "Hanwella", level: 2, street: null }], { rainRisk: true });
  assert.equal(rain.title, plain.title);
  assert.ok(rain.body.startsWith(plain.body) && rain.body.length > plain.body.length + 10, lang);
  assert.equal(pushText(lang, "rise", [{ name: "Hanwella", level: 2, street: null }], { rainRisk: false }).body, plain.body);
}
assert.match(pushText("en", "rise", [{ name: "Hanwella", level: 3, street: null }], { rainRisk: true }).body, /Heavy rain is forecast upstream/);
console.log("storm-model tests passed");
