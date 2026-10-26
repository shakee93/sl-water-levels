// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/measured-rain.test.mts
import assert from "node:assert/strict";
import { MEASURED_1H_MM, MEASURED_3H_MM, gaugeRainNow, measuredInWindow, measuredRainFor, tripped } from "../lib/measuredRain.ts";
import { measuredRainLine, measuredRainPush, rainRiskLine, rainRiskOf, rainRiskPush, withMeasured } from "../lib/rainRisk.ts";
import { pushText } from "../lib/i18n/return.ts";

const T = (hhmm: string) => Date.parse(`2026-10-26T${hhmm}:00+05:30`);
const near = (a: number, b: number, e = 0.1) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

// ---- the Holombuwa case, 26 Oct 2026: 31.9 mm (08:03-09:10), 34.7 mm (09:10-10:06)
const hol = [
  { ts: T("07:00"), rain_fall: 0 },
  { ts: T("08:03"), rain_fall: 1.0 },
  { ts: T("09:10"), rain_fall: 31.9 },
  { ts: T("10:06"), rain_fall: 34.7 },
];
near(measuredInWindow(hol, T("10:06"), 1), 34.7 + 31.9 * (4 / 67), 0.05); // only 4 of the 67 minutes of the 09:10 reading fall in the last hour
near(measuredInWindow(hol, T("10:06"), 3), 34.7 + 31.9 + 1.0 * (57 / 63), 0.05);
const g = gaugeRainNow("Holombuwa", hol, T("10:10"));
assert.ok(g.mm1h >= MEASURED_1H_MM && g.mm3h >= MEASURED_3H_MM);
assert.deepEqual(tripped(g), { hours: 3, mm: 68 });
const m = measuredRainFor("Holombuwa", [g]);
assert.equal(m.gauge, "Holombuwa");
assert.equal(m.upstream, false);
assert.equal(measuredRainLine(m, "Holombuwa"), "Very heavy rain was measured at Holombuwa in the last 3 hours (68 mm). The river may rise fast.");
// at 09:10 the 3 h total is already past 40 mm: the warning is on an hour before the river crossed anything
assert.ok(tripped(gaugeRainNow("Holombuwa", hol.slice(0, 3), T("09:12"))));

// ---- a 1 h burst alone quotes one hour
const burst = [{ ts: T("05:00"), rain_fall: 0 }, { ts: T("06:00"), rain_fall: 27 }];
assert.deepEqual(tripped(gaugeRainNow("X", burst, T("06:05"))), { hours: 1, mm: 27 });
assert.equal(measuredRainLine({ hours: 1, mm: 27 }, "Kithulgala"), "Very heavy rain was measured at Kithulgala in the last hour (27 mm). The river may rise fast.");

// ---- nulls are not zero, duplicates count once, long gaps and stale gauges say nothing
assert.equal(measuredInWindow([{ ts: T("05:00"), rain_fall: null }, { ts: T("06:00"), rain_fall: null }], T("06:00"), 3), null);
assert.equal(gaugeRainNow("X", [{ ts: T("06:00"), rain_fall: null }], T("06:10")), null);
near(measuredInWindow([{ ts: T("05:00"), rain_fall: 0 }, { ts: T("06:00"), rain_fall: 10 }, { ts: T("06:00"), rain_fall: 10 }], T("06:00"), 1), 10);
near(measuredInWindow([{ ts: T("05:00"), rain_fall: 0 }, { ts: T("06:00"), rain_fall: 10 }, { ts: T("06:00"), rain_fall: null }], T("06:00"), 1), 10);
assert.equal(measuredInWindow([{ ts: T("01:00"), rain_fall: 0 }, { ts: T("06:00"), rain_fall: 90 }], T("06:00"), 3), null); // 5 h since the previous reading: not attributed to any hour
assert.equal(gaugeRainNow("X", burst, T("09:30")), null); // newest reading 3.5 h old
near(measuredInWindow([{ ts: T("05:00"), rain_fall: 0 }, { ts: T("07:00"), rain_fall: 20 }], T("07:00"), 1), 10); // a 2 h reading is prorated
near(measuredInWindow([{ ts: T("06:00"), rain_fall: 8 }], T("06:00"), 1), 8); // first reading counts as one hour
assert.equal(tripped({ station: "X", mm1h: 24.9, mm3h: 39.9, endTs: 0 }), null);
assert.equal(tripped({ station: "X", mm1h: null, mm3h: null, endTs: 0 }), null);

// ---- upstream gauge trips, own gauge dry: the line names the upstream gauge
const dry = gaugeRainNow("Holombuwa", [{ ts: T("09:00"), rain_fall: 0 }, { ts: T("10:00"), rain_fall: 0.2 }], T("10:05"));
const kit = gaugeRainNow("Kithulgala", [{ ts: T("09:00"), rain_fall: 0 }, { ts: T("10:00"), rain_fall: 30 }], T("10:05"));
const up = measuredRainFor("Holombuwa", [kit, dry]);
assert.equal(up.gauge, "Kithulgala");
assert.equal(up.upstream, true);
assert.equal(measuredRainFor("Holombuwa", [dry]), null);
assert.equal(measuredRainFor("Holombuwa", []), null);

// ---- combined with a forecast: one line, one closing
const mm = { ...m, gaugeName: "Holombuwa" };
assert.equal(withMeasured(null, null), null);
const only = withMeasured(null, mm);
assert.equal(only.kind, "measured");
assert.equal(rainRiskLine(only), measuredRainLine(m, "Holombuwa"));
const both = withMeasured(rainRiskOf({ det: 80, p90: 120 }), mm);
assert.equal(both.kind, "both");
const line = rainRiskLine(both);
assert.match(line, /^Very heavy rain was measured at Holombuwa in the last 3 hours \(68 mm\)\. Heavy rain forecast upstream in the next 24 hours \(about 80 mm\)\. The river may rise fast\.$/);
assert.equal(withMeasured(rainRiskOf({ det: 80, p90: 120 }), null).kind, undefined); // forecast-only keeps its old shape and words
for (const lang of ["si", "ta"]) {
  assert.ok(measuredRainLine(m, "Holombuwa", lang).includes("68"));
  assert.ok(measuredRainLine(m, "Holombuwa", lang).includes("Holombuwa"));
  assert.ok(!measuredRainLine(m, "Holombuwa", lang).includes("{"));
  assert.notEqual(measuredRainLine(m, "Holombuwa", lang), measuredRainLine(m, "Holombuwa"));
  assert.ok(rainRiskLine(both, lang).includes("68") && rainRiskLine(both, lang).includes("80"));
  assert.notEqual(rainRiskPush(lang, "measured"), rainRiskPush(lang));
  assert.ok(measuredRainPush(lang).length > 10);
  const p = pushText(lang, "rise", [{ name: "Holombuwa", level: 3, street: null }], { rainRisk: "measured" });
  assert.ok(!p.body.includes("pn."));
}
assert.match(pushText("en", "rise", [{ name: "Holombuwa", level: 3, street: null }], { rainRisk: "measured" }).body, /Very heavy rain was just measured upstream/);
assert.match(pushText("en", "rise", [{ name: "Holombuwa", level: 3, street: null }], { rainRisk: true }).body, /Heavy rain is forecast upstream/);

console.log("measured-rain tests passed");
