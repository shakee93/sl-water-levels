// @ts-nocheck (node strip-types test: explicit extensions)
// node --experimental-strip-types scripts/forecast-rules.test.mts
// The five forecast display decisions of 28 Oct 2026 (lib/forecastRules.mjs and the helpers built on it).
import assert from "node:assert/strict";
import {
  MINOR_P_CAP, MAJOR_P_CAP, shownChance, shownWording,
  NO_FORECAST_GAUGES, hasNoForecast,
  FAST_TRIBUTARIES, SHORT_FORECAST_GAUGES, FAST_MAX_H, maxForecastHours,
  STEADY_M_PER_H, isFalling3h,
} from "../lib/forecastRules.mjs";
import { liftVerdict, chanceWords } from "../lib/verdictLift.ts";
import { assessTown } from "../lib/townRisk.ts";
import { groupOf, FAST_TRIBUTARIES as SB_FAST } from "../lib/forecastScoreboard.mjs";

// ---- 1. caps
assert.equal(MINOR_P_CAP, 0.3);
assert.equal(MAJOR_P_CAP, 0.1);
assert.equal(shownChance("alert", 0.95), 0.95, "alert chance is untouched");
assert.equal(shownChance("minor", 0.6), 0.3);
assert.equal(shownChance("minor", 0.25), 0.25, "below the cap nothing changes");
assert.equal(shownChance("major", 0.6), 0.1);
assert.equal(shownChance("major", 0.05), 0.05);
// words: minor / major are never "likely"
assert.equal(shownWording("alert", "likely", 0.8), "likely");
assert.equal(shownWording("minor", "likely", 0.3), "possible");
assert.equal(shownWording("minor", "possible", 0.3), "possible");
assert.equal(shownWording("minor", "unlikely", 0.1), "unlikely");
assert.equal(shownWording("major", "likely", 0.1), "unlikely", "a major chance capped at 10% is below 'possible' (20%)");
assert.equal(shownWording("major", "possible", 0.1), "unlikely");
assert.equal(shownWording("minor", "already", 1), "already");
for (const w of ["likely", "possible", "unlikely"]) for (const th of ["minor", "major"]) assert.notEqual(shownWording(th, w, shownChance(th, 0.9)), "likely");
// chance words from a capped chance read "about 3 in 10" / "about 1 in 10", never "likely"
assert.equal(chanceWords(shownChance("minor", 0.6)).en, "about 3 in 10");
assert.equal(chanceWords(shownChance("major", 0.6)).en, "about 1 in 10");
// a capped minor crossing that used to be "likely" (p 0.6) lifts to a calm "watch" with the small-chance line, never a strong reason
const NOW = 1_000 * 3_600_000;
const lift = liftVerdict({
  tier: "normal", currentLevel: 10, now: NOW, rising: true,
  crossings: [{ threshold: "minor", level: 20, wording: shownWording("minor", "likely", 0.3), probability: shownChance("minor", 0.6), etaTs: NOW + 6 * 3_600_000 }],
  horizons: [{ h: 6, level: 12 }],
});
assert.equal(lift.verdict, "watch");
assert.equal(lift.why, "small");

// ---- 2. no forecast on broken gauges
assert.deepEqual(NO_FORECAST_GAUGES, ["Ampara", "Katharagama", "Weraganthota"]);
assert.ok(hasNoForecast("Ampara") && hasNoForecast("Katharagama") && hasNoForecast("Weraganthota"));
assert.ok(!hasNoForecast("Hanwella"));
// the scoreboard drops them from every group (they have no forecast to score)
assert.equal(groupOf("Ampara"), "none");
assert.equal(groupOf("Hanwella"), "main");
assert.equal(groupOf("Holombuwa"), "fast");
assert.equal(groupOf("Padiyathalawa"), "other");

// a town on one of them does not promise "No flooding expected today" either
const g0 = { station: "Ampara", name: "Ampara", basin: "Gal Oya", tier: "normal", level: 0, unit: "ft", ts: 1, rate3hM: 0, km: 1 };
const rain0 = { past6hMm: 0, past24hMm: 0, next6hMm: 0, next24hMm: 0, next24hP90Mm: null, next6hP90Mm: null };
const t0 = { drainage: "riverbank", primary: g0, secondary: null, forecast: null, rain: rain0, release: null, warning: null, now: 1 };
assert.equal(assessTown(t0).day.key, "n24.noGauge");
assert.equal(assessTown({ ...t0, primary: { ...g0, station: "Hanwella", name: "Hanwella" } }).day.key, "n24.none", "other gauges unchanged");

// ---- 3. fast tributaries
assert.deepEqual(SB_FAST, FAST_TRIBUTARIES, "scoreboard and display share one list");
for (const g of ["Holombuwa", "Deraniyagala", "Kithulgala", "Norwood", "Thawalama", "Pitabeddara", "Urawa", "Peradeniya", "Nawalapitiya", "Panadugama"]) {
  assert.ok(SHORT_FORECAST_GAUGES.includes(g), g);
  assert.equal(maxForecastHours(g), 6, g);
}
assert.equal(FAST_MAX_H, 6);
assert.equal(maxForecastHours("Hanwella"), null);
assert.equal(maxForecastHours("Nagalagam Street"), null);

// ---- 4. one steady threshold
assert.equal(STEADY_M_PER_H, 0.006);
assert.ok(isFalling3h(-0.007));
assert.ok(!isFalling3h(-0.006), "exactly the band edge is steady");
assert.ok(!isFalling3h(0.1));
assert.ok(!isFalling3h(null));

console.log("forecast-rules tests passed");
