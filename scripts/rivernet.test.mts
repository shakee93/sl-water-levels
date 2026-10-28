// @ts-nocheck (node strip-types test)
// node --experimental-strip-types scripts/rivernet.test.mts
import assert from "node:assert/strict";
import {
  fixRivernetX, parseSltStamp, parseChart, parseMarks, parseTitle, trimToLatest, downsample, buildDevice,
  fasterThanOfficial, RIVERNET_CATALOG, RIVERNET_NEW, RIVERNET_FAST, RIVERNET_READ,
} from "../lib/rivernetCalc.ts";

const MIN = 60_000, HOUR = 3_600_000;
const slt = (s: string) => Date.parse(s + "Z"); // a stamp that is SLT labelled Z, as the chart's x

// timestamps: chart x is SLT labelled UTC; title time is SLT
assert.equal(fixRivernetX(1793213880000), Date.parse("2026-10-28T13:28:00Z"));
assert.equal(parseSltStamp("2026-10-28 18:58:00"), Date.parse("2026-10-28T13:28:00Z"));
assert.ok(Number.isNaN(parseSltStamp("garbage")));
assert.ok(Number.isNaN(parseSltStamp(null)));
// the same minute through both conventions agrees
assert.equal(fixRivernetX(slt("2026-10-28T18:58:00")), parseSltStamp("2026-10-28 18:58:00"));

// chart parsing
const chart = {
  results: {
    series: [{ name: "x", data: [{ x: slt("2026-10-28T18:56:00"), y: 5.9, t: "" }, { x: slt("2026-10-28T18:55:00"), y: "5.91" }, { x: slt("2026-10-28T18:55:00"), y: 5.92 }, { x: 1, y: -9999 }, { y: 3 }, { x: slt("2026-10-28T18:57:00"), y: null }] }],
    chartOptions: { yAxis: [{ plotLines: [{ value: 5.2, label: { text: "Alert Flood(5.20 m)" } }, { value: 7.5, label: { text: "Minor Flood(7.50 m)" } }, { value: 9.5, label: { text: "Major Flood(9.50 m)" } }, { value: 10.5, label: { text: "Critical Flood(10.50 m)" } }] }] },
  },
};
const pts = parseChart(chart)!;
assert.equal(pts.length, 2, "dedupes a repeated minute, drops sentinels and nulls");
assert.deepEqual(pts.map((p) => p.m), [5.91, 5.9]); // ascending: the first of two same-minute points (5.91) wins
assert.ok(pts[0].ts < pts[1].ts);
assert.equal(parseChart({}), null);
assert.equal(parseChart({ results: { series: [] } }), null);
assert.deepEqual(parseMarks(chart), { alert: 5.2, minor: 7.5, major: 9.5, critical: 10.5 });
assert.equal(parseMarks({ results: { chartOptions: { yAxis: [{ plotLines: [] }] } } }), null);
assert.equal(parseMarks({}), null);

// title parsing: {0,0} is "unknown", out-of-Sri-Lanka is unknown too
const title = (lat: number, lon: number, time = "2026-10-28 18:58:00", comm = true) => ({ results: { deviceData: [{ coordinates: { latitude: lat, longitude: lon }, latest: { time, latestLevel: "5.860", communication: comm } }] } });
assert.deepEqual(parseTitle(title(6.58, 80.327)), { lat: 6.58, lon: 80.327, latestTs: Date.parse("2026-10-28T13:28:00Z"), latestM: 5.86, communicating: true });
assert.equal(parseTitle(title(0, 0))!.lat, null);
assert.equal(parseTitle(title(40, 3))!.lon, null);
assert.equal(parseTitle({ results: {} }), null);

// the dead-device padding: Kukule's chart is flat to "now" but the title says it last reported on 26 Oct
const flat = { results: { series: [{ data: Array.from({ length: 100 }, (_, i) => ({ x: slt("2026-10-28T18:00:00") + i * MIN, y: 6.18 })) }] } };
const dead = buildDevice("k", title(6.58, 80.327, "2026-10-26 16:25:00", false), flat, Date.parse("2026-10-28T13:30:00Z"))!;
assert.equal(dead.series.length, 0, "a device that is not communicating has no series");
assert.equal(dead.latestTs, Date.parse("2026-10-26T10:55:00Z"));
// a live device keeps its points up to the title's newest reading and nothing after it
const live = buildDevice("k", title(6.58, 80.327, "2026-10-28 18:30:00"), flat, Date.parse("2026-10-28T13:05:00Z"))!;
assert.ok(live.series.length > 0 && live.series[live.series.length - 1].ts <= Date.parse("2026-10-28T13:00:00Z") + 2 * MIN);
// communicating but silent for over 6 h: not live either
assert.equal(buildDevice("k", title(6.58, 80.327, "2026-10-28 01:00:00"), flat, Date.parse("2026-10-28T13:30:00Z"))!.series.length, 0);
assert.equal(buildDevice("k", { results: {} }, flat), null);
assert.equal(buildDevice("k", title(6.58, 80.327), { results: {} }), null);

// downsample keeps real readings, one per 10 minutes, and always the newest
const min = Array.from({ length: 125 }, (_, i) => ({ ts: Date.UTC(2026, 9, 28, 0, 0) + i * MIN, m: i / 100 }));
const ds = downsample(min);
assert.ok(ds.length <= 14 && ds.length >= 12, `got ${ds.length}`);
assert.equal(ds[ds.length - 1], min[min.length - 1]);
assert.ok(ds.every((p) => min.includes(p)));
assert.deepEqual(downsample([]), []);

// "Latest" note on a duplicate: only when the sensor is newer by >= 10 min, fresh, and tracks the official gauge
const now = Date.parse("2026-10-28T13:40:00Z");
const sensor = Array.from({ length: 150 }, (_, i) => ({ ts: now - 25 * MIN - (149 - i) * 10 * MIN * 0 - (149 - i) * 10 * MIN, m: 5 + Math.sin(i / 20) * 0.5 + 0.03 }));
sensor[sensor.length - 1] = { ts: now - 3 * MIN, m: 5.9 };
const official = sensor.filter((_, i) => i % 6 === 0 && i < 140).map((p) => ({ ts: p.ts + 2 * MIN, m: p.m - 0.03 }));
const fr = fasterThanOfficial(sensor, official, now)!;
assert.ok(fr, "newer sensor reading is offered");
assert.ok(Math.abs(fr.offsetM + 0.03) < 0.001, `offset ${fr.offsetM}`);
assert.ok(Math.abs(fr.m - (5.9 - 0.03)) < 0.001);
assert.equal(fr.rawM, 5.9);
assert.equal(fasterThanOfficial(sensor, [...official, { ts: now - 5 * MIN, m: 5.9 }], now), null, "official reading is as new: nothing to add");
assert.equal(fasterThanOfficial(sensor, official, now + 3 * HOUR), null, "stale sensor");
assert.equal(fasterThanOfficial(sensor, official.slice(0, 3), now), null, "too few pairs");
assert.equal(fasterThanOfficial(sensor, official.map((p) => ({ ...p, m: p.m + 0.9 })), now), null, "offset over 0.5 m: not the same gauge");
assert.equal(fasterThanOfficial(sensor, official.map((p, i) => ({ ...p, m: p.m + (i % 2 ? 0.4 : -0.4) })), now), null, "spread over 0.12 m");
assert.equal(fasterThanOfficial([], official, now), null);

// the catalogue: every device decided, no duplicate keys, new gauges have a place and marks only where RiverNet publishes them
assert.equal(RIVERNET_CATALOG.length, 37);
assert.equal(new Set(RIVERNET_CATALOG.map((e) => e.key)).size, RIVERNET_CATALOG.length);
assert.equal(new Set(RIVERNET_CATALOG.map((e) => e.unit)).size, RIVERNET_CATALOG.length);
assert.equal(RIVERNET_NEW.length, 10);
assert.equal(RIVERNET_FAST.length, 9);
assert.equal(RIVERNET_READ.length, 19);
for (const g of RIVERNET_NEW) {
  assert.ok(g.lat > 5.5 && g.lat < 10 && g.lon > 79.4 && g.lon < 82, g.station);
  assert.ok(g.basin.length > 0);
}
assert.equal(RIVERNET_NEW.find((g) => g.station === "Pugoda")!.marks?.alert, 8);
assert.equal(RIVERNET_NEW.find((g) => g.station === "Kuru Ganga (Kuruvita)")!.marks, undefined, "never invent marks");
const stations = new Set(RIVERNET_NEW.map((g) => g.station));
assert.equal(stations.size, RIVERNET_NEW.length, "station names are unique (they are URL slugs)");
// none of the new names is one we already have from ArcGIS / HMIS
for (const n of ["Hanwella", "Glencourse", "Rathnapura", "Karawanella Bridge", "Ampara", "Wellawaya"]) assert.ok(!stations.has(n), n);

console.log("rivernet tests passed");
