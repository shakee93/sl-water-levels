// @ts-nocheck (node strip-types test)
// node --experimental-strip-types scripts/gauge-model.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { H, GM_HORIZONS, bandFor, fitL1, gaugeFeatures, predictGauge, predictLinear, tideCols } from "../lib/model/gaugeModel.mjs";

const gm = JSON.parse(readFileSync(new URL("../lib/model/gauge-model.json", import.meta.url), "utf8"));
assert.ok(Object.keys(gm.stations).length >= 36);
for (const [name, st] of Object.entries(gm.stations)) {
  for (const h of GM_HORIZONS) {
    const m = st.horizons[h];
    assert.ok(m, `${name} ${h}h`);
    assert.equal(m.edges.length + 1, m.q10.length);
    assert.equal(m.q10.length, m.q90.length);
    for (let b = 0; b < m.q10.length; b++) assert.ok(m.q10[b] <= m.q90[b], `${name} band order`);
    if (m.skilled) {
      const cols = 6 + st.up.length * 3 + (m.tide ? 10 : 0);
      assert.equal(m.w.length, cols, `${name} ${h}h weights`);
      // only ships when it beat "level stays put" in the CV and in the 60-day holdout
      assert.ok(m.backtest.holdMae <= 0.97 * m.backtest.holdPersMae, `${name} ${h}h holdout skill`);
      assert.ok(m.backtest.cvMae <= 0.97 * m.backtest.cvPersMae, `${name} ${h}h cv skill`);
    } else assert.equal(predictGauge(m, []), 0);
  }
}

// features: a steadily rising gauge with a rising upstream gauge
const lev = (g, t) => (g === "A" ? 1 + (t / H) * 0.1 : g === "U" ? 2 + (t / H) * 0.2 : null);
const f = gaugeFeatures("A", ["U", "Z"], false, { level: lev }, 100 * H, 1);
assert.equal(f.x.length, 6 + 6);
assert.ok(Math.abs(f.x[0] - 0.1) < 1e-9 && Math.abs(f.x[3] - 0.6) < 1e-9);
assert.deepEqual(f.missing, ["Z"]);
assert.equal(f.x.slice(9).every((v) => v === 0), true); // a missing upstream gauge is "no change"
assert.equal(gaugeFeatures("A", [], false, { level: (g, t) => (t > 95 * H ? lev(g, t) : null) }, 100 * H, 1), null);
assert.equal(gaugeFeatures("A", [], true, { level: lev }, 100 * H, 3).x.length, 6 + 10);
assert.equal(tideCols(0).length, 10);

// band picks the volatility bin
const hm = { skilled: true, edges: [0.01, 0.03], q10: [-1, -2, -3], q90: [1, 2, 3] };
assert.deepEqual(bandFor(hm, 0.005), { q10: -1, q90: 1 });
assert.deepEqual(bandFor(hm, 0.02), { q10: -2, q90: 2 });
assert.deepEqual(bandFor(hm, 0.5), { q10: -3, q90: 3 });

// L1 fit recovers a line through gross outliers (a least-squares fit would not)
const X = [], y = [];
for (let i = 0; i < 400; i++) { const x = Math.sin(i) * 2; X.push([x]); y.push(0.5 * x + 0.1 + (i % 20 === 0 ? 50 : 0)); }
const m = fitL1(X, y, 0.001, 12);
assert.ok(Math.abs(m.w[0] - 0.5) < 0.05 && Math.abs(predictLinear(m, [0]) - 0.1) < 0.1, `${m.w[0]} ${m.b0}`);
console.log("gauge-model tests passed");
