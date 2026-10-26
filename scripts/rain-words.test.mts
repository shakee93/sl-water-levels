// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/rain-words.test.mts
import assert from "node:assert/strict";
import { MEASURED_1H_MM, MEASURED_3H_MM } from "../lib/measuredRain.ts";
import { RAIN_RISK_MM, RAIN_RISK_VERY_MM } from "../lib/rainRisk.ts";
import { RAIN_BANDS, NATIONAL_TRIGGERS, forThisRiver, rainBand, rainWord, reachesTrigger, satelliteCaveat, triggersFor } from "../lib/rainWords.ts";

assert.equal(RAIN_BANDS["1h"].veryHeavy, MEASURED_1H_MM);
assert.equal(RAIN_BANDS["3h"].veryHeavy, MEASURED_3H_MM);
assert.equal(RAIN_BANDS["24h"].heavy, RAIN_RISK_MM);
assert.equal(RAIN_BANDS["24h"].veryHeavy, RAIN_RISK_VERY_MM);
assert.equal(rainBand("1h", 0), "none");
assert.equal(rainBand("1h", 1), "light");
assert.equal(rainBand("1h", 3), "moderate");
assert.equal(rainBand("1h", 12), "heavy");
assert.equal(rainBand("1h", 25), "veryHeavy");
assert.equal(rainBand("24h", 49.9), "moderate");
assert.equal(rainBand("24h", 50), "heavy");
assert.equal(rainBand("24h", 100), "veryHeavy");
assert.equal(rainBand("3h", null), null);
assert.equal(rainWord("24h", 60), "heavy rain");
assert.equal(triggersFor("Hanwella"), NATIONAL_TRIGGERS);
const table = { gauges: { Holombuwa: { mm3h: 30 }, Bad: { mm1h: -1 } } };
const h = triggersFor("Holombuwa", table);
assert.deepEqual(h, { mm1h: 25, mm3h: 30, mm24h: 50, local: true });
assert.equal(triggersFor("Bad", table).local, false);
assert.equal(reachesTrigger("3h", 31, h), true);
assert.equal(reachesTrigger("3h", 31, NATIONAL_TRIGGERS), false);
assert.equal(forThisRiver(true, h), " (heavy for this river)");
assert.equal(forThisRiver(true, NATIONAL_TRIGGERS), "");
assert.match(satelliteCaveat("Heda Oya"), /dry-zone/);
assert.doesNotMatch(satelliteCaveat("Kelani Ganga"), /dry-zone/);
console.log("rain-words ok");
