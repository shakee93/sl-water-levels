// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/street-flood.test.mts
import assert from "node:assert/strict";
import {
  streetState, stateChange, isReportable, noticeFor, FLAP_GUARD_MS, NOTICE_MAX_AGE_MS,
  STREET_POSSIBLE_MM_24H, STREET_LIKELY_MM_24H,
} from "../lib/streetRainLog.ts";
import { validateReport, colomboDay, MIN_FILL_MS } from "../lib/floodReport.ts";
import { STREET_POSSIBLE_MM_24H as P, STREET_LIKELY_MM_24H as L } from "../lib/townRisk.ts";

// the page and the log must use the same thresholds
assert.equal(STREET_POSSIBLE_MM_24H, P);
assert.equal(STREET_LIKELY_MM_24H, L);

// ---- rule state
assert.equal(streetState(0), "none");
assert.equal(streetState(59.9), "none");
assert.equal(streetState(60), "possible");
assert.equal(streetState(99.9), "possible");
assert.equal(streetState(100), "likely");
assert.equal(streetState(null), null);
assert.equal(streetState(undefined), null);
assert.equal(streetState(NaN), null);

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

// a whole afternoon, replayed: 24 h totals every 30 min
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
