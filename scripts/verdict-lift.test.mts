// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/verdict-lift.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liftVerdict, riverRising, isTidalStation, TIDAL_STATIONS, chanceWords } from "../lib/verdictLift.ts";

const H = 3_600_000;
const NOW = 1_000 * H;

// the tidal list is the model's tide term (any horizon): fails when a refit changes it
const gm = JSON.parse(readFileSync(new URL("../lib/model/gauge-model.json", import.meta.url), "utf8"));
const fromModel = Object.entries(gm.stations).filter(([, v]) => Object.values(v.horizons).some((h) => h.tide)).map(([k]) => k).sort();
assert.deepEqual([...TIDAL_STATIONS].sort(), fromModel);

// ---- 26 Oct 2026, Nagalagam Street: 2.6 ft, alert 4.0, crossing "possible" 45%, ETA ~9 h, central forecast max 3.19 ft
const nagalagam = {
  tier: "normal",
  currentLevel: 2.6,
  now: NOW,
  crossings: [
    { threshold: "alert", level: 4, wording: "possible", probability: 0.45, etaTs: NOW + 9 * H },
    { threshold: "minor", level: 5, wording: "unlikely", probability: 0.15, etaTs: null },
  ],
  horizons: [{ h: 1, level: 2.8 }, { h: 3, level: 2.87 }, { h: 6, level: 2.35 }, { h: 12, level: 3.0 }, { h: 24, level: 3.19 }],
};
// even if the tide made it "rising" the central forecast is nowhere near the mark: calm watch, small-chance line
let r = liftVerdict({ ...nagalagam, rising: true });
assert.equal(r.verdict, "watch");
assert.equal(r.why, "small");
assert.equal(r.etaHours, 9);
assert.equal(liftVerdict({ ...nagalagam, rising: false }).verdict, "watch");

// tide-only rise: the 3 h rate is positive but one tide cycle (12.4 h) ago the level was the same
const series = [];
for (let k = 0; k <= 24; k++) {
  const ts = NOW - (24 - k) * H;
  series.push({ ts, water_level: 2.6 + 0.7 * Math.sin((2 * Math.PI * (ts - NOW)) / (12.42 * H)) });
}
const MPU = 0.3048;
assert.equal(riverRising("Nagalagam Street", series, MPU, 0.05), false); // tide: not rising
// a real 0.5 ft rise on top of the same tide is rising
const real = series.map((p, i) => ({ ...p, water_level: p.water_level + (i >= 12 ? (i - 12) * 0.05 : 0) }));
assert.equal(riverRising("Nagalagam Street", real, MPU, 0.05), true);
assert.equal(riverRising("Nagalagam Street", [], MPU, 0.05), false); // no comparable reading: never guess
// non-tidal gauge: the 3 h rate decides
assert.equal(isTidalStation("Hanwella"), false);
assert.equal(riverRising("Hanwella", [], MPU, 0.02), true);
assert.equal(riverRising("Hanwella", [], MPU, 0.001), false);

// ---- a real, rising, non-tidal gauge with p 0.65: Get ready
const hanwella = {
  tier: "normal",
  currentLevel: 3,
  now: NOW,
  rising: true,
  crossings: [{ threshold: "alert", level: 4, wording: "likely", probability: 0.65, etaTs: NOW + 5 * H }],
  horizons: [{ h: 6, level: 3.4 }],
};
r = liftVerdict(hanwella);
assert.equal(r.verdict, "alert");
assert.equal(r.why, "likely");
// 0.55 "likely" alone is no longer enough, and needs a central forecast within 15% of the 1.0 gap AND rising
const mid = { ...hanwella, crossings: [{ ...hanwella.crossings[0], probability: 0.55 }] };
assert.equal(liftVerdict(mid).verdict, "watch");
assert.equal(liftVerdict({ ...mid, horizons: [{ h: 6, level: 3.86 }] }).verdict, "alert");
assert.equal(liftVerdict({ ...mid, horizons: [{ h: 6, level: 3.86 }], rising: false }).verdict, "watch");
assert.equal(liftVerdict({ ...mid, horizons: [{ h: 24, level: 3.95 }] }).verdict, "watch"); // beyond 12 h does not count
assert.equal(liftVerdict({ ...mid, horizons: [{ h: 6, level: 3.86 }], crossings: [{ ...mid.crossings[0], probability: 0.35 }] }).verdict, "watch");

// ---- real readings win: a gauge already at alert or above is untouched (the lift never sees it, whatever the forecast says)
for (const tier of ["alert", "minor", "major", "stale", "none"]) assert.equal(liftVerdict({ ...hanwella, tier }).verdict, "none");
// a watch gauge can be lifted; no crossing = nothing
assert.equal(liftVerdict({ ...hanwella, tier: "watch" }).verdict, "alert");
assert.equal(liftVerdict({ ...hanwella, crossings: [] }).verdict, "none");
assert.equal(liftVerdict({ ...hanwella, crossings: [{ threshold: "alert", wording: "unlikely", probability: 0.15, etaTs: null }] }).verdict, "none");

// ---- words, never a percentage
assert.equal(chanceWords(0.45).en, "about 4 in 10");
assert.equal(chanceWords(0.4).en, "about 4 in 10");
assert.equal(chanceWords(0.2).en, "about 2 in 10");
console.log("verdict-lift tests passed");
