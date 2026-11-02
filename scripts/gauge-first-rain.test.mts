// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/gauge-first-rain.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOUR, gaugeHourly, groundRainSeries, inCells, zonesFrom } from "../lib/model/gaugeRain.mjs";
import { isStormHour4, v4Rain } from "../lib/model/stormModel.mjs";

const H = HOUR;
const cat = JSON.parse(readFileSync(new URL("../lib/model/catchments.json", import.meta.url), "utf8"));
const sub = JSON.parse(readFileSync(new URL("../lib/model/subcatchments.json", import.meta.url), "utf8"));
const v4 = JSON.parse(readFileSync(new URL("../lib/model/storm-model-v4.json", import.meta.url), "utf8"));
const origin = Date.UTC(2026, 10, 1, 14); // forecast hour 14:00 UTC; the run is a little later
const min = (ms) => Math.round(ms / 60_000);
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const sum = (f, a, b) => { let s = 0; for (let k = a; k <= b; k++) s += f(k); return s; };

// ---- zones: Hanwella has a near and an up zone inside the full catchment
const z = zonesFrom(cat, sub, "Hanwella");
assert.equal(z.basin, "Kelani Ganga");
assert.equal(z.full.length, 8);
assert.equal(z.near.length, 2);
assert.equal(z.up.length, 6);
assert.equal(zonesFrom(cat, sub, "Nowhere"), null);
const [nLat, nLon] = z.near[0], [uLat, uLon] = z.up[0];
assert.ok(inCells(z.full, z.half, nLat + 0.05, nLon - 0.05));
assert.ok(!inCells(z.full, z.half, nLat + 5, nLon));

// ---- one gauge: S(t) points every 30 minutes over the last 4.5 h; 10 mm/h from 11:00 to 14:00 UTC, nothing before (S = rain in the last 24 h)
const mkPts = (rateStart, rateEnd, rate, base = 0, from = origin - 4 * H, to = origin + 30 * 60_000) => {
  const out = [];
  for (let t = from; t <= to; t += 30 * 60_000) out.push([min(t), base + rate * Math.max(0, Math.min(t, rateEnd) - rateStart) / H]);
  return out;
};
const pts = mkPts(origin - 3 * H, origin, 10);
const g1 = gaugeHourly(pts, origin);
assert.ok(g1);
near(g1.total24, 20); // S at 13:00 (the hour mark origin - 1 h) = 10 mm/h x 2 h
near(sum((k) => g1.r.get(k), -24, -1), g1.total24); // the 24 h before the forecast hour add up to the gauge's own 24 h figure
near(g1.r.get(-1), 10); // hour ending 13:00
near(g1.r.get(-2), 10); // hour ending 12:00
near(g1.r.get(-3), 0); // hour ending 11:00
near(g1.r.get(0), 10); // the hour that has just ended: S(14:00) - S(13:00), a lower bound
assert.equal(g1.r.get(-10), 0); // nothing left over for the uncovered hours

// ---- the part the 4.5 h of points do not cover: rain of 40 mm fell yesterday evening (still inside the 24 h sum), none in the last 4.5 h
const old = mkPts(origin, origin, 0, 40);
const flatSat = () => 0;
const g2 = gaugeHourly(old, origin, flatSat);
near(g2.total24, 40);
near(sum((k) => g2.r.get(k), -24, -1), 40); // exact: the gate total is the gauge's figure
near(g2.r.get(-1), 0); // the covered hours read 0 (no increase in S)
near(g2.r.get(-12), 40 / (24 - g2.covered)); // uniform over the uncovered hours when the satellite shows nothing
// satellite shape: all the satellite rain in one hour -> that hour gets most of it (70% shape + 30% uniform)
const shaped = gaugeHourly(old, origin, (k) => (k === -15 ? 6 : 0));
const nU = 24 - shaped.covered;
near(shaped.r.get(-15), 40 * (0.7 + 0.3 / nU));
near(shaped.r.get(-16), (40 * 0.3) / nU);
near(sum((k) => shaped.r.get(k), -24, -1), 40);
// satellite below 2 mm over the uncovered hours = uniform
const weak = gaugeHourly(old, origin, (k) => (k === -15 ? 1.9 : 0));
near(weak.r.get(-15), weak.r.get(-16));
// the floor at 0 can over-count: increments that exceed the 24 h total are scaled down to it (a total of 3 mm after a 10 mm hour that fell out of the window)
const out = mkPts(origin, origin, 0, 3).map((p, i) => [p[0], i === 3 ? 13 : p[1]]); // one point 10 mm higher, then back down
const g3 = gaugeHourly(out, origin);
assert.ok(g3.total24 <= 13);
near(sum((k) => g3.r.get(k), -24, -1), g3.total24);
// unusable gauges: record too old at the hour mark, glitch value, no points
assert.equal(gaugeHourly(mkPts(0, 0, 0, 5, origin - 8 * H, origin - 4 * H), origin), null);
assert.equal(gaugeHourly(mkPts(0, 0, 0, 900), origin), null);
assert.equal(gaugeHourly([], origin), null);
assert.equal(gaugeHourly(undefined, origin), null);

// ---- the zones: mean of the gauges inside, none = null (satellite)
const gauge = (n, lat, lon, p) => ({ n, i: "NBRO", lat, lon, pts: p });
const wetPts = mkPts(origin - 3 * H, origin, 10, 50); // 50 mm already + 20 mm in the last 3 h before 13:00 -> 70 at 13:00
const gNear = gauge("Near gauge", nLat, nLon, wetPts);
const gUp = gauge("Up gauge", uLat, uLon, mkPts(origin, origin, 0, 30));
const gOut = gauge("Elsewhere", nLat + 4, nLon, wetPts);
assert.equal(groundRainSeries({ gauges: [gOut], origin, zones: z }), null); // nothing in the catchment
assert.equal(groundRainSeries({ gauges: [], origin, zones: z }), null);
assert.equal(groundRainSeries({ gauges: [gNear], origin, zones: null }), null);
const gr = groundRainSeries({ gauges: [gNear, gUp, gOut], origin, zones: z });
near(gr.past24Full, (70 + 30) / 2); // the catchment's past 24 h = mean of its gauges' own 24 h figures, the outside gauge ignored
near(sum(gr.near, -24, -1), 70); // the near zone holds one gauge
near(sum(gr.up, -24, -1), 30);
assert.deepEqual(gr.used.map((u) => u.name), ["Near gauge", "Up gauge"]);
assert.deepEqual(gr.used[0].zones.sort(), ["full", "near"]);
// a zone with no gauge: up = null for a catchment whose only gauge is in the near cells
const grNearOnly = groundRainSeries({ gauges: [gNear], origin, zones: z });
assert.equal(grNearOnly.up, null);

// ---- v4Rain: without gauges byte-identical to before; with gauges: gauge hours (no bias factor, clipped), satellite elsewhere
const satArr = (v) => Array.from({ length: 96 }, () => v);
const sat = { hourlyEnd: origin + H, hourly: satArr(1), hourlyNear: satArr(1), hourlyUp: satArr(1) }; // ~1 mm/h everywhere... quiet-ish satellite
const om = { full: { [origin]: 0.5 }, near: { [origin]: 0.5 }, up: { [origin]: 0.5 } };
const none = v4Rain(sat, 0.58, 15, origin, om);
const noneG = v4Rain(sat, 0.58, 15, origin, om, null);
for (let k = -30; k <= 1; k++) for (const f of ["rFull", "rNear", "rUp"]) assert.equal(none[f](k), noneG[f](k));
const withG = v4Rain(sat, 0.58, 15, origin, om, gr);
near(withG.rNear(-1), gr.near(-1)); // gauge hour, no factor
near(withG.rFull(-2), gr.full(-2));
assert.equal(withG.rUp(-1), gr.up(-1));
near(withG.rFull(0), gr.full(0)); // the hour that has just ended is measured too
assert.equal(withG.rFull(1), undefined); // forecast hours untouched
near(withG.rFull(-30), 1 * 0.58); // beyond the 24 h the gauges cover: satellite x bias factor, as before
// clip
const hot = gauge("Hot", nLat, nLon, mkPts(origin - 3 * H, origin, 40));
const grHot = groundRainSeries({ gauges: [hot], origin, zones: z });
assert.equal(v4Rain(sat, 0.58, 15, origin, om, grHot).rFull(-1), 15);
// no satellite file at all but gauges: still a series; no satellite and no gauges: null
const noSat = v4Rain(null, 0.58, 15, origin, om, gr);
near(noSat.rFull(-3), gr.full(-3));
assert.equal(noSat.rFull(-40), null);
assert.equal(v4Rain(null, 0.58, 15, origin, om, null), null);
// zone without a gauge falls back to the satellite hour with the factor
const grUpOnly = groundRainSeries({ gauges: [gUp], origin, zones: z });
near(v4Rain(sat, 0.58, 15, origin, om, grUpOnly).rNear(-2), grUpOnly.near(-2) ?? 0.58);

// ---- the storm that was missed on 31 Oct - 1 Nov: satellite ~1 mm in 24 h, gauges 55-77 mm
const quiet = { hourlyEnd: origin + H, hourly: satArr(1 / 24), hourlyNear: satArr(1 / 24), hourlyUp: satArr(1 / 24) };
const storm = (n, la, lo, mm) => gauge(n, la, lo, mkPts(origin, origin, 0, mm, origin - 4 * H, origin));
const grStorm = groundRainSeries({ gauges: [storm("Kalupahana", uLat, uLon, 76), storm("Deraniyagala", nLat, nLon, 55)], origin, zones: z });
const rSat = v4Rain(quiet, v4.stations.Hanwella.bias.k, v4.clipMmPerHour, origin, om);
const rGnd = v4Rain(quiet, v4.stations.Hanwella.bias.k, v4.clipMmPerHour, origin, om, grStorm);
assert.equal(isStormHour4(rSat.rFull, v4.gate, v4.burstMm3h), false); // as it was: the storm model never switched on
assert.equal(isStormHour4(rGnd.rFull, v4.gate, v4.burstMm3h), true); // gauge first: 65 mm in 24 h
near(sum(rGnd.rFull, -24, -1), 65.5, 1e-6);
// a calm day with a dry gauge and a quiet satellite stays calm; a single wet gauge among dry ones is averaged, not trusted alone
const dry = (n, la, lo) => gauge(n, la, lo, mkPts(origin, origin, 0, 0, origin - 4 * H, origin));
const grMix = groundRainSeries({ gauges: [storm("Wet", nLat, nLon, 60), dry("Dry1", uLat, uLon), dry("Dry2", z.up[1][0], z.up[1][1]), dry("Dry3", z.up[2][0], z.up[2][1])], origin, zones: z });
near(grMix.past24Full, 15);
assert.equal(isStormHour4(v4Rain(quiet, 0.58, 15, origin, om, grMix).rFull, v4.gate, v4.burstMm3h), false);
const grDry = groundRainSeries({ gauges: [dry("Dry1", uLat, uLon)], origin, zones: z });
const satWet = { hourlyEnd: origin + H, hourly: satArr(3), hourlyNear: satArr(3), hourlyUp: satArr(3) }; // satellite 72 mm/24 h x 0.58 = 42 mm: storm on
assert.equal(isStormHour4(v4Rain(satWet, 0.58, 15, origin, om).rFull, v4.gate, v4.burstMm3h), true);
assert.equal(isStormHour4(v4Rain(satWet, 0.58, 15, origin, om, grDry).rFull, v4.gate, v4.burstMm3h), false); // a dry gauge wins over a wet satellite (gauge first, owner decision)

console.log("gauge-first rain tests passed");
