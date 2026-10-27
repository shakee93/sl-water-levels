// @ts-nocheck (node strip-types test)
// node --experimental-strip-types scripts/hmis.test.mts
import assert from "node:assert/strict";
import { fixHmisLevelTime, hmisRainTime, normaliseLevelRows, normaliseRain, mapDevice, medianOffset, fasterReading, nearestRain, instituteName, HMIS_GAUGES, HMIS_FAST } from "../lib/hmisCalc.ts";

const H = 3_600_000, M = 60_000;
// --- timestamps: water levels are SLT labelled Z (Hanwella 16:03:56.630Z = ArcGIS 10:33:56.630 UTC); rain is real UTC
assert.equal(new Date(fixHmisLevelTime("2026-10-27T16:03:56.630Z")).toISOString(), "2026-10-27T10:33:56.630Z");
assert.equal(new Date(fixHmisLevelTime("2026-10-27T02:00:00.000Z")).toISOString(), "2026-10-26T20:30:00.000Z");
assert.ok(Number.isNaN(fixHmisLevelTime("nope")));
assert.equal(new Date(hmisRainTime("2026-10-27T10:45:50.830Z")).toISOString(), "2026-10-27T10:45:50.830Z");
assert.ok(Number.isNaN(hmisRainTime(null)));

// --- rows -> devices
const row = (device, ts, value, extra = {}) => ({ device, timestamp: ts, value, device_name: device, latitude: "6.9", longitude: "80.0", institute: "A C C I M T", district_name: "Kegalle", threshold_value: { alert: "3", minor: "4", major: "6", extreme: "" }, ...extra });
const devs = normaliseLevelRows([
  row("A", "2026-10-27T16:10:00.000Z", "2.5"), row("A", "2026-10-27T16:00:00.000Z", "2.4"), row("A", "2026-10-27T16:00:00.000Z", "2.4"),
  row("A", "2026-10-27T16:20:00.000Z", "-9999"), row("A", "garbage", "1"), row("B", "2026-10-27T16:00:00.000Z", "x"), { nothing: 1 },
]);
assert.equal(devs.length, 1);
assert.deepEqual(devs[0].series.map((p) => p.m), [2.4, 2.5]);
assert.ok(devs[0].series[0].ts < devs[0].series[1].ts);
assert.equal(devs[0].thresholds.alert, 3); assert.equal(devs[0].thresholds.extreme, null);
assert.equal(devs[0].institute, "ACCIMT");
assert.deepEqual(normaliseLevelRows(null), []);
assert.equal(instituteName("NBRI"), "NBRO"); assert.equal(instituteName("Meteorology Department"), "Met Department");

// --- device -> our station
const ours = [
  { station: "Hanwella", basin: "Kelani Ganga", latitude: 6.9097, longitude: 80.0831 },
  { station: "Baddegama", basin: "Gin Ganga", latitude: 6.17619, longitude: 80.1769 },
  { station: "Thanamalwila", basin: "Kirindi Oya", latitude: 6.43267, longitude: 81.1371 },
  { station: "Kalawellawa (Millakanda)", basin: "Kalu Ganga", latitude: 6.63225, longitude: 80.1616 },
  { station: "Weraganthota", basin: "Mahaweli Ganga", latitude: 7.31811, longitude: 80.9892 },
];
const d = (device, name, lat, lon) => ({ device, name, lat, lon });
assert.deepEqual(mapDevice(d("00001HD002", "Kelani_Hanwella_HMIS", 6.90944, 80.0830), ours).station, "Hanwella");
assert.equal(mapDevice(d("00001HD002", "x", 6.90944, 80.083), ours).how, "fast-sensor");
const th = mapDevice(d("00022HD001", "Kirindi_Thanamalwila_HMIS", 6.44416, 81.1355), ours);
assert.equal(th.station, "Thanamalwila"); assert.ok(th.km < 2, "Thanamalwila sensor is ~1.3 km from the hourly gauge");
assert.equal(mapDevice(d("Kelani Ganga_Hanwella", "Kelani Ganga_Hanwella", 6.9097, 80.0831), ours).station, "Hanwella");
assert.equal(mapDevice(d("k", "Kalu Ganga_Kalawellawa (Millakanda)", 6.63, 80.16), ours).station, "Kalawellawa (Millakanda)");
assert.equal(mapDevice(d("w", "Weraganthota", 7.3181, 80.9892), ours).station, "Weraganthota");
assert.equal(mapDevice(d("IDX", "Galodaya Bridge", 7.56219, 81.3331), ours).how, "catalogue");
assert.equal(mapDevice(d("zz", "Some Bridge", 7.0, 81.0), ours), null);
assert.equal(mapDevice(d("zz", "Other", 6.9100, 80.0835), ours).how, "coords");
assert.equal(new Set(HMIS_GAUGES.map((g) => g.station)).size, HMIS_GAUGES.length);
assert.equal(HMIS_FAST.length, 3);

// --- offset: hourly gauge reads 0.04 m higher than the sensor, sensor every 10 min
const now = Date.parse("2026-10-27T11:00:00Z");
const fast = Array.from({ length: 6 * 24 + 1 }, (_, i) => ({ ts: now - (6 * 24 - i) * 10 * M, m: 5 + 0.002 * i }));
const hourly = Array.from({ length: 24 }, (_, i) => { const ts = now - (24 - i) * H - 20 * M; const f = 5 + 0.002 * ((ts - (now - 144 * 10 * M)) / (10 * M)); return { ts, m: f + 0.04 }; });
const off = medianOffset(fast, hourly, now);
assert.ok(off && Math.abs(off.offsetM - 0.04) < 0.003, JSON.stringify(off));
assert.equal(medianOffset(fast, hourly.slice(-3), now), null, "too few pairs");
assert.equal(medianOffset(fast, hourly.map((h, i) => ({ ...h, m: h.m + (i % 2 ? 1 : -1) })), now), null, "sensors that do not track each other are not used");
// the newest sensor point is newer than the hourly one -> shown, corrected
const fr = fasterReading(fast, hourly, now);
assert.ok(fr && Math.abs(fr.m - (fast.at(-1).m + 0.04)) < 0.003 && fr.ts === fast.at(-1).ts && fr.cadenceMin === 10);
// sensor not newer than the hourly reading by 10 min -> nothing to add
assert.equal(fasterReading(fast, [...hourly, { ts: fast.at(-1).ts - 5 * M, m: 5.3 }], now), null);
// sensor stale (3 h) -> nothing
assert.equal(fasterReading(fast, hourly, now + 3 * H), null);

// --- rain: nearest LIVE gauge within 5 km
const rain = normaliseRain([
  { device: "r1", station_name: "Baddegama", institute: "NBRI", latitude: "6.1762", longitude: "80.1770", latest_record_time: "2026-10-27T10:45:50.830Z", sum_diffval_in_period: "63.2" },
  { device: "r2", station_name: "Near but stale", institute: "Meteorology Department", latitude: "6.1765", longitude: "80.1772", latest_record_time: "2026-10-27T05:00:00.000Z", sum_diffval_in_period: "90" },
  { device: "r3", station_name: "Far", institute: "NBRI", latitude: "6.30", longitude: "80.30", latest_record_time: "2026-10-27T10:50:00.000Z", sum_diffval_in_period: "10" },
  { device: "r4", station_name: "No record", institute: "NBRI", latitude: "6.17", longitude: "80.17", latest_record_time: null, sum_diffval_in_period: "5" },
]);
assert.equal(rain.length, 3);
const at = { lat: 6.17619, lon: 80.1769 };
const n = nearestRain(rain, at, Date.parse("2026-10-27T11:30:00Z"));
assert.equal(n.device.name, "Baddegama"); assert.equal(n.device.institute, "NBRO"); assert.equal(n.device.mm24h, 63.2); assert.ok(n.km < 0.1);
assert.equal(nearestRain(rain, at, Date.parse("2026-10-27T14:30:00Z")), null, "older than 3 h");
assert.equal(nearestRain(rain, { lat: 7.5, lon: 80.9 }, Date.parse("2026-10-27T11:30:00Z")), null, "nothing within 5 km");
console.log("hmis ok");
