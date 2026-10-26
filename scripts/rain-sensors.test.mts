// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/rain-sensors.test.mts
import assert from "node:assert/strict";
import { noRainSensor, suspectDeadSensors, type RainWindowStat } from "../lib/rainSensors.ts";

assert.equal(noRainSensor("Nagalagam Street"), true);
assert.equal(noRainSensor("  Nagalagam   Street "), true);
assert.equal(noRainSensor("Hanwella"), false);
assert.equal(noRainSensor("Katharagama"), false);

const g = (station: string, lat: number, lon: number, totalMm: number, readings = 165, spanDays = 7): RainWindowStat => ({ station, lat, lon, readings, totalMm, spanDays });
const kelani = [g("Nagalagam Street", 6.96, 79.88, 0), g("Hanwella", 6.91, 80.08, 120), g("Glencourse", 6.97, 80.18, 200), g("Holombuwa", 7.2, 80.3, 90)];
assert.deepEqual(suspectDeadSensors(kelani).map((s) => s.station), ["Nagalagam Street"]);
// a dry week everywhere: nobody is flagged
assert.deepEqual(suspectDeadSensors([g("A", 6.9, 79.9, 0), g("B", 6.95, 80, 10), g("C", 7, 80.1, 20)]), []);
// dry zone gauge with dry neighbours: not flagged
assert.deepEqual(suspectDeadSensors([g("Katharagama", 6.4, 81.3, 16), g("Wellawaya", 6.7, 81.1, 37), g("Thanamalwila", 6.4, 81.1, 63)]), []);
// not enough history: not judged
assert.deepEqual(suspectDeadSensors(kelani.map((s) => (s.station === "Nagalagam Street" ? { ...s, readings: 40, spanDays: 2 } : s))), []);
// too few neighbours: not judged
assert.deepEqual(suspectDeadSensors([g("X", 8, 80, 0), g("Y", 8.1, 80, 300)]), []);
console.log("rain-sensors ok");
