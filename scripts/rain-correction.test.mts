// @ts-nocheck (node strip-types test)
// node --experimental-strip-types scripts/rain-correction.test.mts
import assert from "node:assert/strict";
import { regionOf, classOf, median, shrink, fitFactors, factorFor, idwResidual, residualsOf, correct24, correctShort, looValidate, FACTOR_MIN, FACTOR_MAX, SHRINK_K, haversineKm } from "../lib/rainCorrection.ts";

// regions and classes
assert.equal(regionOf(6.93, 79.9), "colombo");
assert.equal(regionOf(6.2, 80.17), "wet"); // Baddegama
assert.equal(regionOf(7.3, 80.63), "intermediate"); // Kandy side
assert.equal(regionOf(6.28, 81.1), "dry"); // Yala side
assert.equal(regionOf(8.6, 80.5), "dry");
assert.equal(classOf(9.9), "light"); assert.equal(classOf(10), "moderate"); assert.equal(classOf(49.9), "moderate"); assert.equal(classOf(50), "heavy");

// median, shrinkage, caps
assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(shrink(0.5, 2, 1), 1); // under MIN_PAIRS: parent as is
assert.equal(shrink(null, 50, 0.8), 0.8);
assert.ok(Math.abs(shrink(0.5, SHRINK_K, 1) - 0.75) < 1e-9); // 8 pairs: half way to the median
assert.ok(shrink(0.5, 1000, 1) < 0.51); // many pairs: nearly the median
assert.equal(shrink(0.001, 1000, 1), FACTOR_MIN); assert.equal(shrink(50, 1000, 1), FACTOR_MAX);
assert.ok(shrink(2, 5, 1) > 1 && shrink(2, 5, 1) < 2);

// fit: satellite reads 2x the gauge in the dry zone only
const P = (id, lat, lon, sat, gauge) => ({ id, lat, lon, sat, gauge });
const pairs = [];
for (let i = 0; i < 30; i++) pairs.push(P(`d${i}`, 8.5 + i * 0.01, 81.2, 40, 20)); // dry, moderate: ratio 0.5
for (let i = 0; i < 30; i++) pairs.push(P(`w${i}`, 6.2 + i * 0.01, 80.0, 40, 40)); // wet, moderate: ratio 1
const fx = fitFactors(pairs);
assert.equal(fx.national.moderate.n, 60);
assert.ok(Math.abs(fx.national.moderate.med - 0.75) < 1e-9);
assert.ok(factorFor(fx, 8.5, 81.2, 40) < 0.6 && factorFor(fx, 8.5, 81.2, 40) > 0.45); // dry ~0.5 pulled slightly toward national
assert.ok(factorFor(fx, 6.2, 80.0, 40) > 0.9);
assert.equal(factorFor(fx, 7.0, 80.9, 40), fx.region.intermediate.moderate.f); // no intermediate pairs: falls to the national factor
assert.equal(fx.region.intermediate.moderate.f, fx.national.moderate.f);
// satellite under 1 mm tells nothing about a ratio
assert.equal(fitFactors([P("a", 7, 80, 0.5, 5), P("b", 7, 80, 0, 0)]).national.light.n, 0);

// IDW residual: fades with distance, nothing past 10 km, near gauge dominates
const at = (lat, lon) => ({ lat, lon });
const R = [{ lat: 7.0, lon: 80.0, r: 10 }];
assert.equal(idwResidual(R, 7.2, 80.0).r, 0); assert.equal(idwResidual(R, 7.2, 80.0).near, 0); // 22 km away
const r2 = idwResidual(R, 7.0 + 2 / 111.2, 80.0).r, r5 = idwResidual(R, 7.0 + 5 / 111.2, 80.0).r, r8 = idwResidual(R, 7.0 + 8 / 111.2, 80.0).r;
assert.ok(r2 > 9.4 && r2 < 10 && r5 > 6 && r5 < 7.2 && r8 < 1.5 && r2 > r5 && r5 > r8, `${r2} ${r5} ${r8}`);
const two = [{ lat: 7.0, lon: 80.0, r: 10 }, { lat: 7.0, lon: 80.08, r: -10 }];
assert.ok(idwResidual(two, 7.0, 80.005).r > 0 && idwResidual(two, 7.0, 80.075).r < 0);
assert.equal(idwResidual([], 7, 80).near, 0);
assert.ok(Math.abs(haversineKm(7, 80, 7, 80.1) - 11.04) < 0.1);

// corrected value: never negative, factor-only far from gauges, gauge-pulled near one
const res = residualsOf(pairs, fx);
const far = correct24(fx, res, 7.0, 79.0, 40);
assert.equal(far.near, 0); assert.ok(Math.abs(far.corr - far.factor * 40) < 1e-9);
const near = correct24(fx, [{ lat: 7, lon: 80, r: -500 }], 7, 80, 10);
assert.equal(near.corr, 0);
assert.ok(correctShort(fx, 8.5, 81.2, 40, 8) < 8 * 0.6);

// leave-one-out: with a consistent 2x bias the correction beats the raw satellite and a hidden gauge is never in its own fit
const loo = looValidate(pairs);
assert.equal(loo.all.n, 60);
assert.ok(loo.all.maeCorrected < loo.all.maeRaw, JSON.stringify(loo.all));
assert.ok(loo.byRegion.dry.maeCorrected < loo.byRegion.dry.maeRaw / 2);
assert.ok(Math.abs(loo.byRegion.wet.maeCorrected - 0) < 6);
// a lone outlier gauge cannot be predicted from itself: LOO error for it stays large (no leak)
const outlier = [...pairs, P("o", 7.0, 80.9, 40, 400)];
const lo = looValidate(outlier);
assert.ok(lo.all.n === 61 && lo.byRegion.intermediate.maeCorrected > 100, JSON.stringify(lo.byRegion.intermediate));
// pairs where both read under 1 mm are not scored
assert.equal(looValidate([P("z", 7, 80, 0.2, 0)]).all, null);
console.log("rain-correction: ok");
