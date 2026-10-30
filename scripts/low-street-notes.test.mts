// @ts-nocheck
// node --experimental-strip-types --no-warnings scripts/low-street-notes.test.mts
import assert from "node:assert/strict";
import { canalNote, rainNote, plainGaugeName, isCalm, RAIN_NOTE_KM } from "../lib/lowStreetNotes.ts";

// ---- A. canals
assert.ok(isCalm("normal") && isCalm("watch") && !isCalm("alert") && !isCalm("stale") && !isCalm(null));
assert.equal(canalNote("normal", { kolonnawa: "higher" }, ["kolonnawa"]), "kolonnawa");
assert.equal(canalNote("watch", { north: "higher" }, ["kolonnawa", "north"]), "north");
assert.equal(canalNote("normal", { kolonnawa: "higher", north: "higher" }, ["kolonnawa", "north"]), "kolonnawa");
assert.equal(canalNote("alert", { kolonnawa: "higher" }, ["kolonnawa"]), null, "only under a calm verdict");
assert.equal(canalNote("normal", { kolonnawa: "normal" }, ["kolonnawa"]), null);
assert.equal(canalNote("normal", { kolonnawa: "lower", north: "offline" }, ["kolonnawa", "north"]), null);
assert.equal(canalNote("normal", { parliament: "higher" }, ["parliament"]), null, "other basins drain elsewhere");
assert.equal(canalNote("normal", {}, []), null);

// ---- B. rain. Met Department head office, Colombo 7 (6.905, 79.8717); points are [epoch MINUTE, rolling 24 h mm]
const met = (pts) => ({ n: "DOM HEAD OFFICE", i: "Met Department", lat: 6.905, lon: 79.8717, pts });
const T = (s) => Date.parse(s + "+05:30");
const m = (s) => Math.round(T(s) / 60000);
const goth = { lat: 6.93, lon: 79.91 }, nag = { lat: 6.958265, lon: 79.878642 };
// 29 Oct 2026 morning: 24 h sum 11 -> 15.5 (09:00) -> 17.5 (09:20), flat before
const morning = met([[m("2026-10-29T05:10"), 11], [m("2026-10-29T06:30"), 11], [m("2026-10-29T08:20"), 11], [m("2026-10-29T09:00"), 15.5], [m("2026-10-29T09:20"), 17.5]]);
const n1 = rainNote("normal", goth, [morning], T("2026-10-29T09:30"));
assert.ok(n1, "fires on the 29 Oct morning showers");
assert.equal(n1.hours, 1); assert.equal(n1.mm, 6); assert.equal(n1.name, "Met Department head office"); assert.ok(n1.km > 4 && n1.km < 6.5);
assert.ok(rainNote("normal", nag, [morning], T("2026-10-29T09:30")), "Nagalagam Street is within 7 km");
assert.equal(rainNote("minor", goth, [morning], T("2026-10-29T09:30")), null, "calm verdicts only");
assert.equal(rainNote("normal", goth, [morning], T("2026-10-29T11:00")), null, "newest record older than 60 minutes");
// dry day: 30 Oct 06:30 (24 h sum falling, no rise)
const dry = met([[m("2026-10-30T03:00"), 33], [m("2026-10-30T05:00"), 33], [m("2026-10-30T05:20"), 32], [m("2026-10-30T06:20"), 32]]);
assert.equal(rainNote("normal", goth, [dry], T("2026-10-30T06:30")), null);
// 1 h figure only: 5 mm in the hour, nothing in the 3 h window to compare
const burst = met([[m("2026-10-28T10:30"), 7.5], [m("2026-10-28T11:20"), 12.5]]);
const n2 = rainNote("normal", goth, [burst], T("2026-10-28T11:30"));
assert.ok(n2 && n2.hours === 1 && n2.mm === 6, JSON.stringify(n2)); // 5 mm in 50 min, scaled to an hour (lib/groundRain.ts)
// 3 h figure only: 3 + 3.5 mm over three hours, never 5 mm in one hour
const slow = met([[m("2026-10-28T08:30"), 5], [m("2026-10-28T10:00"), 8], [m("2026-10-28T10:40"), 8.5], [m("2026-10-28T11:30"), 11.5]]);
const n3 = rainNote("normal", goth, [slow], T("2026-10-28T11:40"));
assert.ok(n3 && n3.hours === 3 && n3.mm === 6, JSON.stringify(n3));
// too far, out-of-range point, missing / junk data
assert.equal(rainNote("normal", { lat: 7.3, lon: 80.6 }, [morning], T("2026-10-29T09:30")), null);
assert.ok(RAIN_NOTE_KM === 7);
assert.equal(rainNote("normal", goth, [], T("2026-10-29T09:30")), null);
assert.equal(rainNote("normal", goth, [{ n: "x", i: "", lat: NaN, lon: 1, pts: [] }], T("2026-10-29T09:30")), null);
assert.equal(rainNote("normal", { lat: NaN, lon: 1 }, [morning], T("2026-10-29T09:30")), null);
// the nearest QUALIFYING gauge wins; a nearer dry gauge does not hide a farther wet one
const nearDry = { n: "NEAR", i: "NBRO", lat: 6.931, lon: 79.911, pts: [[m("2026-10-29T08:00"), 1], [m("2026-10-29T09:20"), 1]] };
const w = rainNote("normal", goth, [nearDry, morning], T("2026-10-29T09:30"));
assert.ok(w && w.name === "Met Department head office");
assert.equal(plainGaugeName("COLOMBO - 5"), "Colombo - 5");
assert.equal(plainGaugeName("Kolonnawa"), "Kolonnawa");
console.log("low-street-notes ok");
