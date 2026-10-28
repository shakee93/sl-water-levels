// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/report-context.test.mts
import assert from "node:assert/strict";
import { nearestGauge, districtAt, distKm, GAUGE_MAX_KM } from "../lib/reportContext.ts";

const g = (station, latitude, longitude, extra = {}) => ({ station, latitude, longitude, unit: "ft", levelTier: "normal", rate3h: 0.1234, rain6h: null, latest: { ts: 1_000, water_level: 3.456 }, ...extra });
const stations = [g("Baddegama", 6.1706, 80.2, { unit: "m", levelTier: "alert" }), g("Rathnapura", 6.68, 80.4), g("Nagalagam Street", 6.958, 79.878), g("Dead", 6.06, 80.22, { latest: null }), g("NoLevel", 6.05, 80.22, { latest: { ts: 1, water_level: null } })];
const galle = { lat: 6.0535, lon: 80.221 };
const n = nearestGauge(stations, galle);
assert.equal(n.name, "Baddegama"); // nearer gauges with no reading are skipped
assert.equal(n.unit, "m"); assert.equal(n.tier, "alert"); assert.equal(n.level, 3.46); assert.equal(n.rate3h, 0.12); assert.equal(n.ts, 1000);
assert.ok(n.km > 10 && n.km < 16, String(n.km));
assert.equal(nearestGauge(stations, { lat: 9.66, lon: 80.01 }), null); // Jaffna: nothing within 80 km
assert.equal(nearestGauge([], galle), null);
assert.equal(nearestGauge([g("Unit?", 6.1, 80.2, { unit: null })], galle).unit, null); // unknown unit stays unknown
assert.ok(Math.abs(distKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111.2) < 0.5);
assert.equal(GAUGE_MAX_KM, 80);
const places = [{ district: "Galle", lat: 6.03, lon: 80.21 }, { district: "Colombo", lat: 6.93, lon: 79.85 }];
assert.equal(districtAt(places, galle), "Galle");
assert.equal(districtAt(places, { lat: 8.5, lon: 81.2 }), null); // no town within 30 km
console.log("report-context tests ok");
