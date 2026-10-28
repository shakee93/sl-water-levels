// @ts-nocheck (node strip-types test: explicit extensions)
// node --experimental-strip-types scripts/forecast-rules.test.mts
// The five forecast display decisions of 28 Oct 2026 (lib/forecastRules.mjs and the helpers built on it).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { directionFor, STEADY_M_PER_H as VERDICT_STEADY } from "../app/verdict.ts";
import { RISING_M_PER_H as TOWN_RISING } from "../lib/townRisk.ts";
import {
  MINOR_P_CAP, MAJOR_P_CAP, shownChance, shownWording,
  NO_FORECAST_GAUGES, hasNoForecast,
  FAST_TRIBUTARIES, SHORT_FORECAST_GAUGES, FAST_MAX_H, maxForecastHours,
  STEADY_M_PER_H, isFalling3h, fallingOutlook, nextHourRateM,
} from "../lib/forecastRules.mjs";
import { liftVerdict, chanceWords, RISING_M_PER_H as LIFT_RISING } from "../lib/verdictLift.ts";
import { assessTown } from "../lib/townRisk.ts";
import { holdWatch, heldTone, HOLD_GAUGES, NO_HOLD } from "../lib/verdictHold.ts";
import { dayOutlook } from "../lib/townNotes.ts";
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
// town pages on a fast tributary never get a model-made day line ("Peak about", "Still rising", "Little change", "Easing")
const hz = [1, 3, 6, 12, 24].map((h, i) => ({ h, level: 20 + i }));
assert.equal(dayOutlook({ level: 20, horizons: hz, alertMark: 21.3, unit: "ft" })?.kind, "rising", "a main-stem gauge still gets one");
assert.equal(dayOutlook({ level: 20, horizons: hz, alertMark: 21.3, unit: "ft", shortOnly: true }), null);
assert.equal(dayOutlook({ level: 20, horizons: hz.map((x) => ({ ...x, level: 20 })), alertMark: 21.3, unit: "ft", shortOnly: true }), null);

// ---- 4. one steady threshold
assert.equal(STEADY_M_PER_H, 0.006);
assert.ok(isFalling3h(-0.007));
assert.ok(!isFalling3h(-0.006), "exactly the band edge is steady");
assert.ok(!isFalling3h(0.1));
assert.ok(!isFalling3h(null));

assert.equal(VERDICT_STEADY, STEADY_M_PER_H, "app/verdict.ts re-exports the one threshold");
assert.equal(LIFT_RISING, STEADY_M_PER_H);
assert.equal(TOWN_RISING, STEADY_M_PER_H);
// the top sentence (lib/answers.ts) and the card (directionFor) call the same rates the same thing
assert.equal(directionFor(-0.007).en, "Falling");
assert.equal(directionFor(-0.005).en, "Steady");
// no file outside lib/forecastRules.mjs may keep a private "0.006" steady threshold again
const walk = (d) => readdirSync(d).flatMap((f) => (f === "node_modules" || f === ".next" || f.startsWith(".") ? [] : statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const offenders = [...walk(new URL("../app", import.meta.url).pathname), ...walk(new URL("../lib", import.meta.url).pathname)]
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/forecastRules\.mjs$|flood3d|i18n/.test(f))
  .filter((f) => /(?<![\d.])0\.006(?!\d)/.test(readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")));
assert.deepEqual(offenders, [], "private copies of the steady threshold: " + offenders.join(", "));

// the card tile and the sentence agree on a RiverNet / HMIS gauge: with no model the tile reads the measured 3 h rate
assert.equal(nextHourRateM({ h1ChangeM: 0, rate3hM: -0.02, source: "rivernet", method: "trend" }), -0.02);
assert.equal(nextHourRateM({ h1ChangeM: 0, rate3hM: -0.02, source: "hmis", method: "trend" }), -0.02);
assert.equal(nextHourRateM({ h1ChangeM: 0, rate3hM: -0.02, source: "arcgis", method: "trend" }), 0, "an ArcGIS gauge keeps its own next-hour figure");
assert.equal(nextHourRateM({ h1ChangeM: -0.01, rate3hM: 0.05, source: "rivernet", method: "model" }), -0.01);
assert.equal(nextHourRateM({ h1ChangeM: null, rate3hM: 0.03, source: "arcgis", method: "none" }), 0.03);

// ---- 4. falling river: never steady words for the day ahead
const hzLow = [{ h: 3, level: 24 }, { h: 6, level: 23 }, { h: 12, level: 22 }];
assert.equal(fallingOutlook({ rate3hM: -0.05, level: 25, horizons: hzLow, mpu: 0.3048 }), "keeps");
assert.equal(fallingOutlook({ rate3hM: -0.05, level: 25, horizons: [{ h: 6, level: 25.05 }], mpu: 0.3048 }), "now", "falling but the forecast is not lower: 'Falling now'");
assert.equal(fallingOutlook({ rate3hM: -0.05, level: 25, horizons: [], mpu: 1 }), "now");
assert.equal(fallingOutlook({ rate3hM: -0.003, level: 25, horizons: hzLow, mpu: 0.3048 }), null, "steady: usual wording");
assert.equal(fallingOutlook({ rate3hM: 0.05, level: 25, horizons: hzLow, mpu: 0.3048 }), null);
assert.equal(fallingOutlook({ rate3hM: null, level: 25, horizons: hzLow, mpu: 0.3048 }), null);
const hanwella = { station: "Hanwella", name: "Hanwella", basin: "Kelani Ganga", tier: "alert", level: 25, unit: "ft", ts: 1, rate3hM: -0.05, km: 0.5 };
const fIn = { status: "ok", h1Level: 24.8, h24Level: 21, maxLevel: 25, currentLevel: 25, metresPerUnit: 0.3048, crossings: [], horizons: hzLow };
const town = { drainage: "riverbank", primary: hanwella, secondary: null, forecast: fIn, rain: null, release: null, warning: null, now: 1 };
assert.equal(assessTown(town).day.key, "n24.fallingKeeps");
assert.equal(assessTown({ ...town, forecast: { ...fIn, horizons: [{ h: 6, level: 25 }] } }).day.key, "n24.falling");
assert.equal(assessTown({ ...town, primary: { ...hanwella, rate3hM: 0 } }).day.key, "n24.stay", "steady river keeps the old line");
assert.equal(assessTown({ ...town, primary: { ...hanwella, rate3hM: 0.05 } }).day.key, "n24.stay");
assert.equal(assessTown({ ...town, primary: { ...hanwella, station: "Nagalagam Street", name: "Nagalagam Street" } }).day.key, "n24.stay", "a tidal gauge's fall is mostly tide: no claim");
// and the day-outlook helper itself never says 'flat' for a falling-rate river through the town path (flat needs a non-falling rate)
const flatH = [4, 8, 12].map((h) => ({ h, level: 25 }));
assert.equal(dayOutlook({ level: 25, horizons: flatH, alertMark: 21.3, unit: "ft" })?.kind, "flat");

// ---- 5. headline hold (Nagalagam Street)
const HR = 3_600_000;
assert.ok(HOLD_GAUGES["Nagalagam Street"] && HOLD_GAUGES["Nagalagam Street"].hours === 3, "on by default for Nagalagam Street, 3 h");
const T = 1_000 * HR;
const hb = { station: "Nagalagam Street", tier: "normal", level: 3.3, watchFrom: 3.4, mpu: 0.3048, now: T, pastTiers: [], logged: [] };
assert.equal(holdWatch(hb).held, false, "nothing recent: no hold");
// the reading was near alert 2 h ago (tier watch), now reads Normal: held until 3 h after that reading
const h2 = holdWatch({ ...hb, pastTiers: [{ ts: T - 2 * HR, tier: "watch" }, { ts: T - HR, tier: "normal" }] });
assert.ok(h2.held && h2.why === "reading" && h2.until === T + HR);
assert.equal(holdWatch({ ...hb, pastTiers: [{ ts: T - 4 * HR, tier: "alert" }] }).held, false, "older than 3 h: released");
assert.equal(holdWatch({ ...hb, pastTiers: [{ ts: T - 2 * HR, tier: "alert" }] }).held, true, "an alert reading 2 h ago also holds");
// the forecast-driven watch (stored verdict) holds too
const hf = holdWatch({ ...hb, logged: [{ ts: T - 2 * HR, verdict: "watch" }] });
assert.ok(hf.held && hf.why === "forecast");
assert.equal(holdWatch({ ...hb, logged: [{ ts: T - 2 * HR, verdict: "normal" }] }).held, false);
// not for other gauges, not for a gauge that is already at watch or above (its own tier speaks), never when the river has really gone
assert.equal(holdWatch({ ...hb, station: "Hanwella", pastTiers: [{ ts: T - HR, tier: "watch" }] }).held, false);
for (const tier of ["watch", "alert", "minor", "major", "stale", "none"]) assert.equal(holdWatch({ ...hb, tier, pastTiers: [{ ts: T - HR, tier: "watch" }] }).held, false, tier);
assert.equal(holdWatch({ ...hb, level: 2.0, pastTiers: [{ ts: T - HR, tier: "watch" }] }).why, "cleared", "1.4 ft below where watch starts: the river has gone");
assert.equal(holdWatch({ ...hb, level: 2.5, pastTiers: [{ ts: T - HR, tier: "watch" }] }).held, true, "0.9 ft below: still held (tide swings are +-0.7 ft)");
// the official step is never touched: only a plain normal becomes watch; alert / minor / major / stale pass through even when 'held'
const held = { held: true, until: T, why: "reading" as const };
assert.equal(heldTone("normal", held), "watch");
for (const tone of ["watch", "alert", "minor", "major", "stale", "none"]) assert.equal(heldTone(tone, held), tone);
assert.equal(heldTone("normal", NO_HOLD), "normal");
// a flip-flopping gauge: raw verdicts hour by hour (normal, watch, normal, normal, normal, normal, normal) -> shown tone
const raw = ["normal", "watch", "normal", "normal", "normal", "normal", "normal"];
const shown = raw.map((v, i) => {
  const logged = raw.slice(0, i).map((x, j) => ({ ts: T + j * HR, verdict: x })).concat(v === "watch" ? [] : []);
  const r = holdWatch({ ...hb, now: T + i * HR, tier: "normal", logged });
  return heldTone(v, r);
});
assert.deepEqual(shown, ["normal", "watch", "watch", "watch", "watch", "normal", "normal"], "watch at hour 1 holds until 3 h later (hours 2-4, i.e. 3 h after it), then normal");
// town page: the hold lifts a plain normal river to watch, and never changes an official step
const hg = { station: "Nagalagam Street", name: "Nagalagam Street", basin: "Kelani Ganga", tier: "normal", level: 3.3, unit: "ft", ts: 1, rate3hM: 0, km: 0.5 };
const tw = { drainage: "riverbank", primary: hg, secondary: null, forecast: null, rain: rain0, release: null, warning: null, now: 1 };
assert.equal(assessTown(tw).tone, "normal");
assert.equal(assessTown({ ...tw, primary: { ...hg, holdWatch: true } }).tone, "watch");
assert.equal(assessTown({ ...tw, primary: { ...hg, holdWatch: true } }).reasons.some((r) => r.key === "r.held"), true);
assert.equal(assessTown({ ...tw, primary: { ...hg, tier: "alert", level: 4.2, holdWatch: true } }).tone, "alert", "an official alert reading is Alert, held or not");
assert.equal(assessTown({ ...tw, primary: { ...hg, tier: "watch", holdWatch: true } }).tone, "watch");

console.log("forecast-rules tests passed");
