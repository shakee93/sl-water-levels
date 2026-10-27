// @ts-nocheck (node strip-types test: explicit .ts / .mjs extensions)
// node --experimental-strip-types scripts/feedback-check.test.mts
import assert from "node:assert/strict";
import { cleanLocation, roundCoord, distKm as distTs, validateWhere } from "../lib/feedback.ts";
import { GRID, pixelIndex, pointRain } from "../lib/pointRain.mjs";
import { FAR, FAR_KM, checkWorse, distKm, exportColumns, gaugeNext3h, nearestGauge, stationInfo } from "../lib/feedbackCheck.mjs";

const tok = "0123456789abcdef01234567";
const H = 3_600_000;

// ---- rounding: precise phone coordinates are cut to 0.01 degree and never kept finer
assert.equal(roundCoord(6.906123), 6.91);
assert.equal(roundCoord(79.95749), 79.96);
assert.deepEqual(cleanLocation(6.906123, 79.95749), { lat: 6.91, lon: 79.96 });
assert.equal(cleanLocation(48.85, 2.35), null, "outside Sri Lanka");
assert.equal(cleanLocation("6.9", 79.9), null);
assert.equal(cleanLocation(NaN, 79.9), null);

// ---- distance
assert.equal(distKm({ lat: 6.9, lon: 79.9 }, { lat: 6.9, lon: 79.9 }), 0);
assert.ok(Math.abs(distKm({ lat: 6.9061, lon: 79.957 }, { lat: 6.9583, lon: 79.8786 }) - 10.2) < 0.6, "Malabe to Nagalagam Street is about 10 km");
assert.equal(distKm({ lat: 6.9, lon: 79.9 }, { lat: 6.95, lon: 79.9 }), distTs({ lat: 6.9, lon: 79.9 }, { lat: 6.95, lon: 79.9 }), "same formula in lib/feedback.ts");

// ---- "where": a phone position or a town, both rounded; unknown towns, odd input and bots are refused
const lookup = (s) => (s === "malabe" ? { lat: 6.9061, lon: 79.957 } : null);
assert.deepEqual(validateWhere({ token: tok, lat: 6.906123, lon: 79.95749 }, lookup).value, { token: tok, loc: { lat: 6.91, lon: 79.96 }, place: null });
assert.deepEqual(validateWhere({ token: tok, place: "malabe" }, lookup).value, { token: tok, loc: { lat: 6.91, lon: 79.96 }, place: "malabe" });
assert.equal(validateWhere({ token: tok, place: "paris" }, lookup).reason, "invalid");
assert.equal(validateWhere({ token: tok, lat: 1, lon: 2 }, lookup).reason, "invalid");
assert.equal(validateWhere({ token: "x", place: "malabe" }, lookup).reason, "invalid");
assert.equal(validateWhere({ token: tok, place: "malabe", hp: "x" }, lookup).reason, "bot");
assert.equal(validateWhere(null, lookup).reason, "invalid");

// ---- satellite pixel and totals
assert.equal(pixelIndex(9.95, 79.55), 0);
assert.equal(pixelIndex(6.95, 79.95), Math.round((9.95 - 6.95) / 0.1) * GRID.nx + Math.round((79.95 - 79.55) / 0.1));
assert.equal(pixelIndex(20, 79.9), -1);
{
  const n = GRID.nx * GRID.ny, idx = pixelIndex(6.91, 79.96);
  const times = [], frames = [];
  for (let h = 0; h < 30; h++) for (const m of [0, 30]) {
    times.push(new Date(Date.UTC(2026, 9, 26, 0, 0) + h * H + m * 60_000).toISOString());
    const f = new Array(n).fill(0);
    f[idx] = m === 0 ? 50 : 999; // 5 mm/h on the hour; the :30 frames must be ignored
    frames.push(f);
  }
  const r = pointRain({ times, frames }, 6.91, 79.96);
  assert.equal(r.mm3h, 15);
  assert.equal(r.mm24h, 120);
  assert.equal(r.endMs, Date.UTC(2026, 9, 26, 0, 0) + 29 * H + H);
  assert.equal(pointRain({ times, frames }, 20, 79.9), null);
  // fewer than 75% of the hours: null, never zero
  const holes = frames.map((f, i) => (i > 40 ? f.map(() => -1) : f));
  assert.equal(pointRain({ times, frames: holes }, 6.91, 79.96).mm3h, null);
}

// ---- stations
const stations = [
  { station: "Nagalagam Street", latitude: 6.9583, longitude: 79.8786, basin: "Kelani Ganga     ", Unit: "ft", Alert_Level: 4, Minor_Flood_Level: 5 },
  { station: "Hanwella", latitude: 6.9097, longitude: 80.0831, basin: "Kelani Ganga", Unit: "m", Alert_Level: 6.5, Minor_Flood_Level: 8 },
  { station: "Badalgama", latitude: 7.1, longitude: 79.99, basin: "Maha Oya", Unit: "m", Alert_Level: 2, Minor_Flood_Level: 3 },
].map(stationInfo);
assert.equal(stations[0].basin, "Kelani Ganga", "trailing whitespace trimmed");
assert.equal(stations[1].minorFt, Math.round((8 / 0.3048) * 100) / 100, "metres converted to feet");
assert.equal(nearestGauge({ lat: 6.91, lon: 80.07 }, stations).station, "Hanwella");
const NG = stations[0], HW = stations[1];

// ---- the gauge in the next 3 h
const T0 = Date.UTC(2026, 9, 26, 6, 0);
const rising = [{ ts: T0 + H, v: 3.0 }, { ts: T0 + 2 * H, v: 3.4 }, { ts: T0 + 3 * H, v: 3.6 }, { ts: T0 + 4 * H, v: 9 }];
const g1 = gaugeNext3h(rising, T0, 3.0, { alertFt: 4, minorFt: 5 });
assert.deepEqual([g1.dir, g1.maxFt, g1.riseFt, g1.n], ["rose", 3.6, 0.6, 3], "the reading 4 h later is outside the window");
assert.deepEqual(g1.nextMark, { name: "alert", ft: 4 });
assert.equal(g1.toMarkFt, 0.4);
assert.equal(gaugeNext3h([{ ts: T0 + H, v: 2.5 }, { ts: T0 + 3 * H, v: 2.5 }], T0, 3.0, {}).dir, "fell");
assert.equal(gaugeNext3h([{ ts: T0 + H, v: 3.05 }], T0, 3.0, {}).dir, "steady");
assert.equal(gaugeNext3h([{ ts: T0 - H, v: 3 }], T0, 3.0, {}), null, "no reading after the answer");
assert.equal(gaugeNext3h([{ ts: T0 - 20 * 60_000, v: 2.8 }, { ts: T0 + H, v: 3.1 }], T0, null, {}).startFt, 2.8, "no shown level: the reading just before");
assert.equal(gaugeNext3h(rising, T0, 5.5, { alertFt: 4, minorFt: 5 }).nextMark, null, "already above every mark");

// ---- verdicts
const base = { shown: NG, stations, createdMs: T0, base: 3.0, marks: NG, now: T0 + 10 * H, obs: [], rain: { mm3h: 0, mm24h: 0 } };
const nearNG = { lat: 6.95, lon: 79.88 };
{
  const r = checkWorse({ ...base, loc: nearNG, obs: rising });
  assert.equal(r.check, "river confirms");
  assert.ok(r.distShownKm < FAR_KM);
  assert.equal(r.nearest, "Nagalagam Street");
}
// the river did not rise but the satellite saw heavy rain over the pixel
assert.equal(checkWorse({ ...base, loc: nearNG, obs: [{ ts: T0 + H, v: 3.0 }], rain: { mm3h: 14, mm24h: 20 } }).check, "local rain likely");
assert.equal(checkWorse({ ...base, loc: nearNG, obs: [{ ts: T0 + H, v: 3.0 }], rain: { mm3h: 2, mm24h: 70 } }).check, "local rain likely");
// nothing explains it
assert.equal(checkWorse({ ...base, loc: nearNG, obs: [{ ts: T0 + H, v: 3.0 }] }).check, "unexplained");
assert.equal(checkWorse({ ...base, loc: nearNG, obs: [], rain: null }).check, "unexplained", "gauge silent and the answer is old");
// too new to judge
assert.equal(checkWorse({ ...base, loc: nearNG, obs: [], now: T0 + H }).check, "pending");
// the river rising does not rescue an answer from far away: Malabe (answer #64) with Nagalagam Street shown
{
  const malabe = { lat: 6.91, lon: 79.96 };
  const r = checkWorse({ ...base, loc: malabe, obs: rising });
  assert.equal(r.check, FAR);
  assert.ok(r.reasons[0].includes("km from the gauge shown"));
  assert.equal(r.nearest, "Nagalagam Street");
}
// close to the shown gauge's distance limit but another gauge is much closer
{
  const r = checkWorse({ ...base, shown: HW, marks: HW, loc: { lat: 6.96, lon: 79.88 }, obs: rising });
  assert.equal(r.check, FAR);
  assert.ok(r.reasons.some((x) => x.includes("Nagalagam Street is much closer")));
}
// within 5 km of the shown gauge but the nearest gauge is on another river
{
  const nearBadalgama = checkWorse({ ...base, shown: HW, marks: HW, loc: { lat: 7.04, lon: 80.0 }, obs: rising, stations });
  assert.equal(nearBadalgama.check, FAR);
}
{
  // 2.4 km from Hanwella (the gauge shown, and the nearest), same river: a normal near answer, judged by the gauge
  const r = checkWorse({ ...base, shown: HW, marks: HW, loc: { lat: 6.91, lon: 80.06 }, obs: rising });
  assert.equal(r.check, "river confirms");
  assert.deepEqual(r.reasons, []);
}
// no location, no shown gauge: no verdict
assert.equal(checkWorse({ ...base, loc: null }).check, null);
assert.equal(checkWorse({ ...base, loc: nearNG, shown: null }).check, null);

// ---- export columns
{
  const c = checkWorse({ ...base, loc: nearNG, obs: rising });
  const cols = exportColumns({ answer: "worse", lat_r: 6.95, lon_r: 79.88, place_pick: null, rain_3h_mm: 1.2, rain_24h_mm: 8 }, c);
  assert.deepEqual(Object.keys(cols), ["place_pick", "lat_r", "lon_r", "nearest_gauge", "nearest_km", "rain_3h_mm", "rain_24h_mm", "gauge_next3h_dir", "gauge_next3h_max", "gauge_next_mark", "gauge_to_mark_ft", "check", "check_reasons"]);
  assert.equal(cols.check, "river confirms");
  assert.equal(cols.gauge_next_mark, "alert 4 ft");
  assert.equal(cols.gauge_next3h_max, 3.6);
  assert.equal(exportColumns({ answer: "worse", lat_r: null }, null).check, "no location");
  assert.equal(exportColumns({ answer: "yes" }, null).check, null);
  // nothing finer than the 0.01 degree rounding can be exported
  assert.ok(Object.values(cols).every((v) => typeof v !== "number" || Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 || ![cols.lat_r, cols.lon_r].includes(v)));
}
console.log("feedback check tests passed");
