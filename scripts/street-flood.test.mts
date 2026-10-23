// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/street-flood.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  streetState, stateChange, isReportable, noticeFor, riverTrigger, FLAP_GUARD_MS, NOTICE_MAX_AGE_MS,
  STREET_POSSIBLE_MM_24H, STREET_LIKELY_MM_24H, STREET_HOURLY_CAP_MM, NAGALAGAM_MINOR_FT,
} from "../lib/streetRainLog.ts";
import { zoneWindow, STREET_HOURLY_CAP_MM as WINDOW_CAP } from "../lib/streetRainWindow.mjs";
import { validateReport, colomboDay, MIN_FILL_MS } from "../lib/floodReport.ts";
import { STREET_POSSIBLE_MM_24H as P, STREET_LIKELY_MM_24H as L, STREET_HOURLY_CAP_MM as C } from "../lib/townRisk.ts";

// the page, the log and the snapshot must use the same thresholds and the same hourly cap
assert.equal(STREET_POSSIBLE_MM_24H, P);
assert.equal(STREET_LIKELY_MM_24H, L);
assert.equal(STREET_HOURLY_CAP_MM, C);
assert.equal(STREET_HOURLY_CAP_MM, WINDOW_CAP);
assert.equal(STREET_HOURLY_CAP_MM, 15);
assert.ok(/STREET_HOURLY_CAP_MM/.test(readFileSync(new URL("../scripts/gsmap-snapshot.mjs", import.meta.url), "utf8")), "the snapshot uses the shared cap");

// ---- rule state
assert.equal(streetState(0), "none");
assert.equal(streetState(59.9), "none");
assert.equal(streetState(60), "possible");
assert.equal(streetState(99.9), "possible");
assert.equal(streetState(100), "likely");
assert.equal(streetState(null), null);
assert.equal(streetState(undefined), null);
assert.equal(streetState(NaN), null);
// edges on the CLIPPED total: 59 / 60 / 99 / 100
assert.equal(streetState(59), "none");
assert.equal(streetState(60), "possible");
assert.equal(streetState(99), "possible");
assert.equal(streetState(100), "likely");
// the river alone makes "likely", with little rain or no rain total at all
assert.equal(streetState(0, true), "likely");
assert.equal(streetState(null, true), "likely");
assert.equal(streetState(70, true), "likely");
assert.equal(streetState(null, false), null);
assert.equal(streetState(30, false), "none");

// ---- river trigger: Nagalagam Street >= 5 ft, or Hanwella at/above the minor mark the gauge itself publishes
{
  const NG = (levelFt, ageMin = 10) => ({ station: "Nagalagam Street", levelFt, minorFt: 5, ageMin });
  const HW = (levelFt, minorFt = 24.61, ageMin = 10) => ({ station: "Hanwella", levelFt, minorFt, ageMin });
  assert.equal(NAGALAGAM_MINOR_FT, 5);
  assert.equal(riverTrigger([NG(2.9), HW(11.8)]).triggered, false);
  assert.equal(riverTrigger([NG(4.9), HW(24.6)]).triggered, false, "just below both marks");
  assert.deepEqual(riverTrigger([NG(5), HW(11.8)]), { triggered: true, station: "Nagalagam Street", levelFt: 5 });
  assert.equal(riverTrigger([NG(2.9), HW(24.61)]).station, "Hanwella");
  assert.equal(riverTrigger([NG(2.9), HW(26)]).triggered, true);
  // Hanwella uses ITS OWN published mark: the 2026 scale (24.61 ft = 7.5 m) and the older scale (8.0 m = 26.25 ft) both work
  assert.equal(riverTrigger([HW(25, 26.25)]).triggered, false);
  assert.equal(riverTrigger([HW(26.3, 26.25)]).triggered, true);
  // no published mark = no trigger from Hanwella (never a hardcoded fallback)
  assert.equal(riverTrigger([HW(40, null)]).triggered, false);
  assert.equal(riverTrigger([HW(40, 0)]).triggered, false);
  // stale or missing readings never trigger
  assert.equal(riverTrigger([NG(8, 181)]).triggered, false);
  assert.equal(riverTrigger([NG(8, null)]).triggered, false);
  assert.equal(riverTrigger([NG(null)]).triggered, false);
  assert.equal(riverTrigger([{ station: "Glencourse", levelFt: 99, minorFt: 1, ageMin: 1 }]).triggered, false, "other gauges do not count");
  assert.equal(riverTrigger([]).triggered, false);
}

// ---- the hourly clip: hour = mean of its :00 and :30 files, each hour capped at 15 mm, then 24 h summed
{
  const H = 3_600_000, T0 = Date.UTC(2026, 9, 22, 10, 0); // a :00 step
  const steps = new Map();
  const put = (hoursAgo, a, b) => { steps.set(T0 - hoursAgo * H, a); if (b != null) steps.set(T0 - hoursAgo * H + H / 2, b); };
  const get = (ms) => steps.get(ms);
  // 24 hours: 23 quiet hours of 2 mm and one 118 mm spike hour (both halves 118)
  for (let h = 0; h < 24; h++) put(h, 2, 2);
  put(5, 118, 118);
  put(0, 2, null); // the newest hour has only its :00 file
  let w = zoneWindow(get, T0, 24);
  assert.equal(w.raw, 23 * 2 + 118, "raw keeps the spike");
  assert.equal(w.clipped, 23 * 2 + 15, "clipped caps it at 15 mm");
  // hour value is the MEAN of the two halves before the cap: 30 and 0 -> 15 (not capped to 15 + 0), 40 and 20 -> 30 -> 15
  steps.clear();
  for (let h = 0; h < 24; h++) put(h, 0, 0);
  put(3, 30, 0); put(4, 40, 20); put(6, 10, 20);
  w = zoneWindow(get, T0, 24);
  assert.equal(w.raw, 15 + 30 + 15);
  assert.equal(w.clipped, 15 + 15 + 15);
  // 59 / 60 / 99 / 100 clipped: four wet hours of 15 mm = 60, plus a 39 / 40 mm remainder spread under the cap
  steps.clear();
  for (let h = 0; h < 24; h++) put(h, 0, 0);
  for (let h = 0; h < 4; h++) put(h, 15, 15);
  assert.equal(streetState(zoneWindow(get, T0, 24).clipped), "possible", "4 x 15 = 60 mm");
  put(3, 14, 15); // hour mean 14.5 -> 59.5
  assert.equal(streetState(zoneWindow(get, T0, 24).clipped), "none", "59.5 mm");
  steps.clear();
  for (let h = 0; h < 24; h++) put(h, 0, 0);
  for (let h = 0; h < 6; h++) put(h, 15, 15);
  put(6, 10, 10);
  assert.equal(zoneWindow(get, T0, 24).clipped, 100);
  assert.equal(streetState(zoneWindow(get, T0, 24).clipped), "likely", "6 x 15 + 10 = 100 mm");
  // a lone 118 mm hour on a dry day is NOT a warning once clipped (raw would be)
  steps.clear();
  for (let h = 0; h < 24; h++) put(h, 0, 0);
  put(2, 118, 118);
  w = zoneWindow(get, T0, 24);
  assert.equal(streetState(w.raw), "likely");
  assert.equal(streetState(w.clipped), "none");
  // missing data: under 75% of the hours = null (rule off), a few missing hours scale up
  steps.clear();
  for (let h = 0; h < 17; h++) put(h, 5, 5);
  assert.equal(zoneWindow(get, T0, 24), null, "17 of 24 hours is under 75%");
  steps.clear();
  for (let h = 0; h < 18; h++) put(h, 4, 4);
  assert.equal(zoneWindow(get, T0, 24).raw, 96, "18 hours x 4 mm scaled to 24 h");
  assert.equal(zoneWindow(() => undefined, T0, 24), null);
}

// ---- state changes: compared with the last KNOWN state; missing data is not a change
assert.equal(stateChange("none", "none"), null);
assert.deepEqual(stateChange("none", "possible"), { from: "none", to: "possible" });
assert.deepEqual(stateChange("possible", "likely"), { from: "possible", to: "likely" });
assert.deepEqual(stateChange("likely", "none"), { from: "likely", to: "none" });
assert.equal(stateChange("possible", null), null);
assert.deepEqual(stateChange(null, "likely"), { from: null, to: "likely" });
// the very first row being "none" is not worth a row; the first row being wet is
assert.equal(isReportable({ from: null, to: "none" }), false);
assert.equal(isReportable({ from: null, to: "possible" }), true);
assert.equal(isReportable({ from: "likely", to: "none" }), true);

// ---- who gets a Slack message
const T = 1_000_000_000_000;
assert.equal(noticeFor({ from: "none", to: "possible" }, null, T, T), "rise");
assert.equal(noticeFor({ from: "none", to: "likely" }, null, T, T), "rise");
assert.equal(noticeFor({ from: "possible", to: "likely" }, null, T, T), "rise");
assert.equal(noticeFor({ from: "likely", to: "possible" }, null, T, T), null, "easing but still wet: silent");
assert.equal(noticeFor({ from: "possible", to: "none" }, null, T, T), "clear");
assert.equal(noticeFor({ from: "likely", to: "none" }, null, T, T), "clear");
assert.equal(noticeFor({ from: null, to: "possible" }, null, T, T), "rise");
// flap guard: a second rise within 3 h of the last rise message is held back; clears are never held back
assert.equal(noticeFor({ from: "none", to: "possible" }, T - FLAP_GUARD_MS + 1, T, T), null);
assert.equal(noticeFor({ from: "none", to: "possible" }, T - FLAP_GUARD_MS, T, T), "rise");
assert.equal(noticeFor({ from: "possible", to: "none" }, T - 60_000, T, T), "clear");
// a change nobody could be told about for 6 h is not announced late
assert.equal(noticeFor({ from: "none", to: "possible" }, null, T, T + NOTICE_MAX_AGE_MS + 1), null);
assert.equal(noticeFor({ from: "none", to: "possible" }, null, T, T + NOTICE_MAX_AGE_MS), "rise");

// a whole afternoon, replayed: clipped 24 h totals every 30 min
{
  const totals = [10, 40, 62, 75, 58, 63, 105, 98, 70, 59, 40, 20];
  let known = null;
  const log = [];
  totals.forEach((mm, i) => {
    const s = streetState(mm);
    const c = stateChange(known, s);
    if (c) log.push(`${c.from ?? "-"}>${c.to}`);
    if (s) known = s;
  });
  assert.deepEqual(log, ["->none", "none>possible", "possible>none", "none>possible", "possible>likely", "likely>possible", "possible>none"]);
}

// ---- report validator
const isTown = (s) => s === "wellampitiya" || s === "kolonnawa";
const ok = (o = {}) => ({ town: "wellampitiya", answer: "deep", when: "now", lang: "si", hp: "", ms: 5000, ...o });
{
  const v = validateReport(ok(), isTown);
  assert.equal(v.ok, true);
  assert.deepEqual(v.report, { town: "wellampitiya", answer: "deep", when: "now", lang: "si" });
}
// optional time, and unknown language falls back to en
assert.deepEqual(validateReport(ok({ when: undefined, lang: "fr" }), isTown).report, { town: "wellampitiya", answer: "deep", when: null, lang: "en" });
assert.equal(validateReport(ok({ when: null }), isTown).report.when, null);
for (const a of ["deep", "little", "dry"]) assert.equal(validateReport(ok({ answer: a }), isTown).ok, true);
// malformed -> invalid
for (const bad of [null, "x", [], 5, ok({ town: "nowhere" }), ok({ town: 3 }), ok({ town: "x".repeat(200) }), ok({ answer: "maybe" }), ok({ answer: undefined }), ok({ when: "yesterday" }), ok({ when: 4 })])
  assert.deepEqual(validateReport(bad, isTown), { ok: false, reason: "invalid" });
// bots -> bot (the route answers "thanks" and stores nothing)
assert.deepEqual(validateReport(ok({ hp: "http://spam" }), isTown), { ok: false, reason: "bot" });
assert.deepEqual(validateReport(ok({ ms: MIN_FILL_MS - 1 }), isTown), { ok: false, reason: "bot" });
assert.equal(validateReport(ok({ ms: MIN_FILL_MS }), isTown).ok, true);
assert.deepEqual(validateReport(ok({ ms: undefined }), isTown), { ok: false, reason: "bot" });
assert.deepEqual(validateReport(ok({ ms: "5000" }), isTown), { ok: false, reason: "bot" });
assert.deepEqual(validateReport(ok({ ms: Infinity }), isTown), { ok: false, reason: "bot" });
// extra fields (free text) are never carried over
assert.deepEqual(Object.keys(validateReport({ ...ok(), note: "my name is X", lat: 6.9 }, isTown).report).sort(), ["answer", "lang", "town", "when"]);

// ---- Colombo day
assert.equal(colomboDay(Date.parse("2026-10-23T18:29:59Z")), "2026-10-23");
assert.equal(colomboDay(Date.parse("2026-10-23T18:30:00Z")), "2026-10-24");

console.log("street-flood tests passed");
