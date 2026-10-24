// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/gauge-rain.test.mts
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  API_K, API_LAG_DAYS, API_WET_MM, ARCGIS_MIN_READINGS, addDays, colomboDay, parseSynopRain, ogimetUrl, arcgisDailySums,
  ogimetDayMean, arcgisDayMean, antecedentIndex, gaugeWetness, readGaugeArchive,
} from "../lib/gaugeRain.mjs";
import { shadowStreetState, streetState, SHADOW_POSSIBLE_WET_MM_24H, SHADOW_API_WET_MM, STREET_POSSIBLE_MM_24H } from "../lib/streetRainLog.ts";

// the report's definition: k 0.9 a day, lag 2 days, wet at 96 mm; the two files repeat the wet level
assert.equal(API_K, 0.9);
assert.equal(API_LAG_DAYS, 2);
assert.equal(API_WET_MM, 96);
assert.equal(SHADOW_API_WET_MM, API_WET_MM);
assert.equal(SHADOW_POSSIBLE_WET_MM_24H, 45);

// ---- dates
assert.equal(addDays("2026-10-24", -2), "2026-10-22");
assert.equal(addDays("2026-03-01", -1), "2026-02-28");
assert.equal(colomboDay(Date.parse("2026-10-23T19:00:00Z")), "2026-10-24", "Colombo is UTC+5:30");
assert.ok(ogimetUrl("43466", "2026-09-09", "2026-10-24").includes("begin=202609090000&end=202610242359"));

// ---- SYNOP parsing: only the 03 UTC report, group 7RRRR of section 3
{
  const t = [
    "43466,2026,10,20,00,00,AAXX 20001 43466 22470 70801 10270 333 553// 20000 59014 60008 91001 555 60008==",
    "43466,2026,10,20,03,00,AAXX 20031 43466 21470 70201 10267 20219 40142 5/029 70382 84101 333 10322 20247 3/022 553// 20151 58004 60008 70022 91002==",
    "43466,2026,10,21,03,00,AAXX 21031 43466 21470 10267 333 10322 70000 555 70999==", // 7-group: 0.0 mm; the 555 section is ignored
    "43466,2026,10,22,03,00,AAXX 22031 43466 21470 10267 333 10322 79999 91002==",    // trace
    "43466,2026,10,23,03,00,AAXX 23031 43466 21470 10267 333 10322 91002==",           // no 7-group: missing, not zero
    "43466,2026,10,24,03,00,AAXX 24031 43466 21470 10267 333 7//// 91002==",            // unreadable 7-group: missing
    "43466,2026,10,25,03,00,AAXX 25031 43466 21470 10267 no section 3==",
    "garbage",
  ].join("\n");
  const rows = Object.fromEntries(parseSynopRain(t).map((r) => [r.date, r.mm]));
  assert.deepEqual(rows, { "2026-10-20": 2.2, "2026-10-21": 0, "2026-10-22": 0.05 });
}

// ---- ArcGIS gauges: sums per Colombo day, bad values are not readings
{
  const day = Date.parse("2026-10-20T03:00:00Z"); // 08:30 Colombo
  const rows = [];
  for (let h = 0; h < 24; h++) rows.push({ gauge: "Hanwella", ts: day + h * 3_600_000 - 3 * 3_600_000, rain: 1 }); // Colombo 05:30..05:30 next day: splits two days
  rows.push({ gauge: "Hanwella", ts: day, rain: null }, { gauge: "Hanwella", ts: day, rain: -3 }, { gauge: "Nagalagam Street", ts: day, rain: 5 });
  const s = arcgisDailySums(rows);
  assert.equal(s["2026-10-20"].Hanwella.n + s["2026-10-21"].Hanwella.n, 24);
  assert.equal(s["2026-10-20"]["Nagalagam Street"], undefined, "only the chosen gauges");
  // a day needs full readings from at least two gauges
  const full = { mm: 10, n: ARCGIS_MIN_READINGS };
  assert.equal(arcgisDayMean({ A: full, B: { mm: 20, n: ARCGIS_MIN_READINGS } }), 15);
  assert.equal(arcgisDayMean({ A: full }), null, "one gauge is not an area");
  assert.equal(arcgisDayMean({ A: full, B: { mm: 20, n: ARCGIS_MIN_READINGS - 1 } }), null, "a partial day is not a day");
  assert.equal(arcgisDayMean({}), null);
  assert.equal(ogimetDayMean({ a: 10, b: 20, c: null }), 15, "mean of the stations that reported");
  assert.equal(ogimetDayMean({}), null);
}

// ---- the index: k 0.9, lag 2, missing days add nothing, too many missing days = unknown
{
  const event = "2026-10-24";
  const only = (day, mm) => (d) => (d === day ? mm : 0); // every other day: 0 mm, a real reading
  assert.equal(antecedentIndex(only("2026-10-22", 100), event), 100, "the newest day used is event - 2: weight 1");
  assert.equal(antecedentIndex(only("2026-10-21", 100), event), 90, "one day older: x0.9");
  assert.equal(antecedentIndex(only("2026-10-20", 100), event), 81);
  assert.equal(antecedentIndex(only("2026-10-23", 100), event), 0, "the day before the event is not used (lag)");
  assert.equal(antecedentIndex(only("2026-10-24", 100), event), 0, "the event day is not used");
  assert.equal(antecedentIndex((d) => 10, event), 98.5, "10 mm every day: 10 x (1 - 0.9^40) / 0.1");
  assert.ok(antecedentIndex((d) => 10, event) >= API_WET_MM);
  assert.ok(antecedentIndex((d) => 9.5, event) < API_WET_MM);
  // 7 days ending event - 2 are 2026-10-16..22: a missing day counts as 0 mm but enough days must exist
  const missing = (n) => (d) => (d >= "2026-10-16" && d < addDays("2026-10-16", n) ? null : 10);
  assert.equal(antecedentIndex(missing(2), event) !== null, true, "5 of 7 days is enough");
  assert.equal(antecedentIndex(missing(3), event), null, "4 of 7 days: unknown, not dry");
  assert.equal(antecedentIndex(() => null, event), null);
  assert.equal(antecedentIndex(() => undefined, event), null);
  // a missing day inside a covered week adds nothing (it is not an invented value)
  const a = antecedentIndex((d) => (d === "2026-10-20" ? null : 10), event);
  assert.ok(a < 98.5 && a > 98.5 - 10 * 0.9 ** 2 - 0.2);
}

// ---- which network: Met Dept first (the threshold was set on it), ArcGIS when it is too sparse, unknown when neither
{
  const ag = (mm) => ({ H: { mm, n: 24 }, G: { mm, n: 24 } });
  const days = (f) => Object.fromEntries(Array.from({ length: 30 }, (_, i) => [addDays("2026-09-25", i), f(i)]));
  const both = days(() => ({ og: { 43466: 10 }, ag: ag(5) }));
  const w = gaugeWetness(both, "2026-10-24");
  assert.equal(w.source, "ogimet");
  assert.equal(w.apiMm, w.ogimetMm);
  assert.ok(w.arcgisMm != null && w.arcgisMm < w.ogimetMm);
  const agOnly = days(() => ({ og: {}, ag: ag(10) }));
  const w2 = gaugeWetness(agOnly, "2026-10-24");
  assert.equal(w2.source, "arcgis");
  assert.equal(w2.ogimetMm, null);
  assert.ok(w2.apiMm > 0);
  const none = gaugeWetness({}, "2026-10-24");
  assert.deepEqual(none, { apiMm: null, source: null, ogimetMm: null, arcgisMm: null });
}

// ---- archive reader: missing folder, damaged line
{
  const dir = mkdtempSync(path.join(tmpdir(), "gauge-test-"));
  try {
    assert.deepEqual(readGaugeArchive(dir), {});
    mkdirSync(path.join(dir, "rain-gauges"));
    writeFileSync(path.join(dir, "rain-gauges/2026.jsonl"), '{"d":"2026-10-20","og":{"43466":2.2}}\nnot json\n{"d":"2026-10-21","ag":{"Hanwella":{"mm":1,"n":24}}}\n');
    const a = readGaugeArchive(dir);
    assert.deepEqual(Object.keys(a), ["2026-10-20", "2026-10-21"]);
    assert.equal(a["2026-10-20"].og["43466"], 2.2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the candidate rule's thresholds
const W = 150, D = 50; // a wet and a dry week
assert.equal(shadowStreetState(44.9, false, W), "none", "under 45 mm nothing, however wet");
assert.equal(shadowStreetState(45, false, W), "possible", "45 mm and a wet week");
assert.equal(shadowStreetState(45, false, SHADOW_API_WET_MM), "possible", "96 mm is wet");
assert.equal(shadowStreetState(45, false, SHADOW_API_WET_MM - 0.1), "none", "95.9 mm is not");
assert.equal(shadowStreetState(55, false, D), "none", "45 to 60 mm in a dry week");
assert.equal(shadowStreetState(59.9, false, D), "none");
assert.equal(shadowStreetState(60, false, D), "possible", "60 mm is possible whatever the week was");
assert.equal(shadowStreetState(99.9, false, D), "possible");
assert.equal(shadowStreetState(100, false, D), "likely", "likely is unchanged");
assert.equal(shadowStreetState(100, false, W), "likely");
assert.equal(shadowStreetState(0, true, D), "likely", "the river alone makes likely");
assert.equal(shadowStreetState(null, true, null), "likely");
// a missing gauge week: unknown (null) when the answer depends on it, and never "none"
assert.equal(shadowStreetState(50, false, null), null);
assert.equal(shadowStreetState(50, false, undefined), null);
assert.equal(shadowStreetState(50, false, NaN), null);
assert.equal(shadowStreetState(50, false), null, "no index argument");
assert.equal(shadowStreetState(45, false, null), null);
assert.equal(shadowStreetState(59.9, false, null), null);
// ... and not unknown when it does not matter
assert.equal(shadowStreetState(30, false, null), "none");
assert.equal(shadowStreetState(0, false, null), "none");
assert.equal(shadowStreetState(60, false, null), "possible");
assert.equal(shadowStreetState(120, false, null), "likely");
// no rain total and no river: off
assert.equal(shadowStreetState(null, false, W), null);
assert.equal(shadowStreetState(undefined, false, W), null);
assert.equal(shadowStreetState(NaN, false, W), null);
// the shadow rule never says less than the live rule, and equals it wherever the gauges do not matter
for (let mm = 0; mm <= 130; mm += 0.5)
  for (const api of [null, 10, 95.9, 96, 200]) {
    const live = streetState(mm, false), sh = shadowStreetState(mm, false, api);
    const rank = { none: 0, possible: 1, likely: 2 };
    if (sh !== null) assert.ok(rank[sh] >= rank[live], `shadow below live at ${mm} mm, api ${api}`);
    if (mm < SHADOW_POSSIBLE_WET_MM_24H || mm >= STREET_POSSIBLE_MM_24H) assert.equal(sh, live);
  }
// the same wet level in the snapshot script's comment-free source of truth
assert.ok(/API_WET_MM/.test(readFileSync(new URL("../scripts/street-rain-log.mjs", import.meta.url), "utf8")));

console.log("gauge-rain tests passed");
