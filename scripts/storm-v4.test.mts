// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/storm-v4.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STORM_HORIZONS, arrivalWindow, isStormHour4, stormFeatures4, tier4Bin, v4Rain } from "../lib/model/stormModel.mjs";
import { riverReactionLines } from "../lib/riverReaction.ts";

const H = 3_600_000;
const v4 = JSON.parse(readFileSync(new URL("../lib/model/storm-model-v4.json", import.meta.url), "utf8"));
const v3 = JSON.parse(readFileSync(new URL("../lib/model/storm-model.json", import.meta.url), "utf8"));
const sub = JSON.parse(readFileSync(new URL("../lib/model/subcatchments.json", import.meta.url), "utf8"));
const cat = JSON.parse(readFileSync(new URL("../lib/model/catchments.json", import.meta.url), "utf8")).basins;

// ---- arrival window: rain that falls `lag` hours before the horizon, +-3 h, never later than the horizon itself
assert.deepEqual(arrivalWindow(6, 3), { lo: 0, hi: 6 });
assert.deepEqual(arrivalWindow(24, 12), { lo: 9, hi: 15 });
assert.deepEqual(arrivalWindow(1, 0), { lo: -2, hi: 1 });

// ---- features
const flat = (v) => () => v;
const x = stormFeatures4(flat(1), flat(2), flat(3), 12, { near: 3, up: 9 });
assert.equal(x.length, 10);
assert.equal(x[0], 14); // near rain 2 mm x hours 6..12 (7 h)
assert.equal(x[1], 21); // up-channel 3 mm x hours 0..6 (7 h)
assert.equal(x[3], 12); // forecast rain 1 mm x hours 1..12
assert.deepEqual(x.slice(5), [1, 3, 6, 12, 24]); // measured last 1, 3, 6, 12, 24 h
assert.equal(stormFeatures4(flat(1), flat(2), null, 12, { near: 3, up: 0 })[1], 0); // a headwater gauge has no up-channel rain
assert.equal(stormFeatures4((k) => (k === -5 ? undefined : 1), flat(2), flat(3), 12, { near: 3, up: 9 }), null); // a missing hour is unknown, not zero
// wet ground raises the interactions only
const wet = stormFeatures4(flat(2), flat(2), flat(2), 6, { near: 3, up: 3 });
assert.ok(wet[2] > 0 && wet[4] > 0);

// ---- gate: 40 mm over the last or next 24 h, or a burst of 25 mm in 3 h
assert.equal(isStormHour4(flat(1.7), 40, 25), true); // 24 x 1.7 = 40.8
assert.equal(isStormHour4(flat(1.6), 40, 25), false);
assert.equal(isStormHour4((k) => (k >= -3 && k <= -1 ? 9 : 0), 40, 25), true); // 27 mm in 3 h
assert.equal(isStormHour4((k) => (k >= -3 && k <= -1 ? 8 : 0), 40, 25), false); // 24 mm
assert.equal(tier4Bin(flat(4.2)), 1);
assert.equal(tier4Bin(flat(2)), 0);

// ---- the satellite hours: hour ending origin+k is the entry hourlyEnd - (95 - i) h; raw mm/h x bias, capped per hour
const origin = Date.UTC(2026, 9, 26, 12);
const sat = { hourlyEnd: origin + H, hourly: Array.from({ length: 96 }, (_, i) => (i === 95 || i === 94 ? 30 : i === 93 ? 5 : 1)), hourlyNear: Array(96).fill(2), hourlyUp: Array(96).fill(0.5) };
const om = { full: { [origin]: 7, [origin + H]: 8 }, near: { [origin]: 9 }, up: { [origin]: 4 } };
const r = v4Rain(sat, 0.5, 15, origin, om);
assert.equal(r.rFull(-1), 2.5); // the hour ending at origin - 1 h is entry 93 (5 mm/h) x 0.5; the newer entries are not used
assert.equal(r.rFull(0), 7); // the weather model's own hour
assert.equal(r.rFull(1), 8);
assert.equal(r.rFull(-2), 0.5);
assert.equal(r.rNear(-1), 1);
assert.equal(r.rUp(-3), 0.25);
// cap: 30 mm/h x 1 = 30 -> 15
const r2 = v4Rain({ ...sat, hourlyEnd: origin }, 1, 15, origin, om);
assert.equal(r2.rFull(-1), 15);
// the hour ending at the forecast time must be there, else v3 (null)
assert.equal(v4Rain({ ...sat, hourlyEnd: origin - 2 * H }, 1, 15, origin, om), null);
assert.equal(v4Rain({ ...sat, hourly: sat.hourly.map((v, i) => (i === 94 ? null : v)), hourlyEnd: origin }, 1, 15, origin, om), null);
assert.equal(v4Rain(null, 1, 15, origin, om), null);
assert.equal(v4Rain(sat, 1, 15, origin, { full: null, near: null }), null);
// a missing hour inside the 24 h makes the sums null, which stormFeatures4 turns into "no correction"
const holey = v4Rain({ ...sat, hourly: sat.hourly.map((v, i) => (i === 80 ? null : v)) }, 1, 15, origin, om);
assert.equal(stormFeatures4(holey.rFull, holey.rNear, holey.rUp, 6, { near: 3, up: 6 }), null);

// ---- the sub-catchment split: every cell is in near or up, never both; children really are upstream
for (const [b, st] of Object.entries(sub)) {
  for (const [g, s] of Object.entries(st)) {
    const all = new Set(cat[b].stations[g].cells);
    assert.equal(s.near.length + s.up.length, all.size, `${b}/${g}`);
    for (const c of [...s.near, ...s.up]) assert.ok(all.has(c));
    assert.ok(!s.near.some((c) => s.up.includes(c)));
    for (const k of s.children) assert.ok(cat[b].stations[k].cells.length < all.size);
  }
}

// ---- the shipped v4 file
assert.ok(v4.gate >= 20 && v4.gate <= 80 && v4.burstMm3h >= 10 && v4.clipMmPerHour >= 5);
for (const h of STORM_HORIZONS) {
  assert.equal(v4.pooled[h].w.length, 10, `pooled ${h}`);
  assert.ok(v4.pooled[h].w.every((v) => v >= 0));
  assert.ok(v4.bandFactor[h] >= 1);
}
let shipped = 0;
for (const [name, st] of Object.entries(v4.stations)) {
  assert.ok(st.scale > 0 && st.bias.k >= 0.25 && st.bias.k <= 1.5, name);
  assert.ok(Number.isFinite(st.lags.near) && st.lags.near >= 0 && st.lags.near <= 36);
  for (const h of STORM_HORIZONS) {
    const hz = st.horizons[h];
    if (!hz?.use) continue;
    shipped++;
    // ships only where the hybrid beat v3 on storm hours (>= 3%) over >= 60 hours and >= 3 events
    assert.ok(hz.backtest.v4Ft <= 0.97 * hz.backtest.v3Ft + 1e-9, `${name} ${h}h beats v3`);
    assert.ok(hz.backtest.nV4Gate >= 60 && hz.backtest.events >= 3);
    assert.ok(hz.band.q10.every((v, b) => Number.isFinite(v) && v < hz.band.q90[b]), `${name} ${h}h band`);
    assert.ok(v3.stations[name], `${name} keeps a v3 model to fall back on`);
  }
}
assert.ok(shipped >= 1, "at least one gauge/horizon ships v4");

// ---- the station-page sentences: nothing where the history is thin, plain numbers where it is not
const base = { nearLagH: 2, upLagH: 12, upGauges: [{ gauge: "Kithulgala", hours: 12 }], windowH: 3, mmFor1ft: 38.4, ftPer10mm: 1.6, ftPer10mmWet: 2.4, ftPer10mmDry: 1.1, timeToPeakH: 4, confidence: "high", events: 5, tidal: false };
assert.equal(riverReactionLines("X", { ...base, confidence: "low" }), null);
assert.equal(riverReactionLines("X", { ...base, events: 2 }), null);
assert.equal(riverReactionLines("X", { ...base, mmFor1ft: null }), null);
assert.equal(riverReactionLines("X", undefined), null);
const en = riverReactionLines("Hanwella", base, "en");
assert.match(en[0], /^A fast river\. Rain close to Hanwella shows up in the river in about 2 hours\.$/);
assert.match(en[1], /Kithulgala.*about 12 hours/);
assert.match(en[2], /About 38 mm of rain over 3 hours/);
assert.match(en[3], /about 1\.6 ft within a day, and more when the ground is already wet/);
for (const lang of ["si", "ta"]) { const l = riverReactionLines("Hanwella", base, lang); assert.equal(l.length, 4); assert.ok(l.every((s) => s !== en[0])); }
console.log("storm-v4 tests passed");
