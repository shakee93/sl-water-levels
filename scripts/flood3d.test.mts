// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/flood3d.test.mts
import assert from "node:assert/strict";
import { validateReport, round3, AREAS } from "../lib/flood3dReports.ts";
import { phi, pWet, chanceClass, gaugeSpread, hanwellaMToNagFt, nagFtToHanwellaM } from "../app/[lang]/lab/flood-3d/chance.ts";

const ok = { kind: "water_now", depth: "knee", lat: 6.955, lon: 79.922, acc: 12, src: "gps", consent: true, hp: "", ms: 5000, lang: "si" };
assert.equal(validateReport(ok).ok, true);
assert.equal(validateReport(ok).report.lang, "si");
assert.equal(validateReport({ ...ok, consent: false }).reason, "invalid"); // no consent, nothing stored
assert.equal(validateReport({ ...ok, hp: "x" }).reason, "bot");
assert.equal(validateReport({ ...ok, ms: 100 }).reason, "bot");
assert.equal(validateReport({ ...ok, lat: 6.87, lon: 79.86 }).ok, true); // Wellawatte is inside the margin: stored, the map just does not cover it
assert.equal(validateReport({ ...ok, lat: 7.5 }).reason, "outside");
assert.equal(validateReport({ ...ok, depth: "chest" }).reason, "invalid");
assert.equal(validateReport({ ...ok, kind: "past_wet", event: "ditwah_2025" }).ok, true);
assert.equal(validateReport({ ...ok, kind: "past_dry", depth: undefined, event: "may_2016" }).ok, true);
assert.equal(validateReport({ ...ok, kind: "past_dry", depth: undefined, event: "flood" }).reason, "invalid");
assert.equal(validateReport({ ...ok, kind: "map_check", depth: undefined, mapRight: "no" }).ok, true);
assert.equal(validateReport({ ...ok, kind: "map_check", depth: undefined }).reason, "invalid");
assert.equal(validateReport({ ...ok, note: "my house at 12 Main St" }).report.note, undefined); // free text is never kept
assert.equal(round3(6.95549), 6.955);
assert.ok(AREAS.every((a) => a.south < a.north && a.west < a.east));

assert.ok(Math.abs(phi(0) - 0.5) < 1e-6 && phi(3) > 0.998 && phi(-3) < 0.002);
const g = gaugeSpread(6, 5, 7, 3);
assert.ok(Math.abs(g.sd - 2 / 2.5632) < 1e-3);
assert.ok(pWet(7, 0.6, g) < pWet(6, 0.6, g) && pWet(6, 0.6, g) < pWet(5, 0.6, g)); // lower flood level = likelier wet
assert.ok(pWet(4, 1, g) > pWet(8, 1, g));
const cal = { a: 0.1, b: 0.55, sd_ft: 1 };
assert.equal(chanceClass(0.02, cal).cls, "none");
assert.equal(chanceClass(0.1, cal).cls, "low");
assert.equal(chanceClass(0.5, cal).cls, "medium");
assert.equal(chanceClass(0.99, cal).cls, "high");
const T = [[3, 2.6], [6, 3.7], [10, 7.4]];
assert.equal(hanwellaMToNagFt(2, T), 2.6);
assert.equal(hanwellaMToNagFt(12, T), 7.4);
assert.ok(Math.abs(nagFtToHanwellaM(hanwellaMToNagFt(8, T), T) - 8) < 1e-6);
// flood survey
const sv = { kind: "past_wet", survey: true, event: "ditwah_2025", streetLevel: "chest", streetFt: 4.2, inside: "yes", insideLevel: "knee", steps: 2, peakDay: "2025-12-01", peakPart: "night", floodMonth: "2025-12", lat: 6.955, lon: 79.922, src: "pin", consent: true, hp: "", ms: 9000, test: true };
const v1 = validateReport(sv);
assert.equal(v1.ok, true);
assert.equal(v1.report.depth, "above_waist"); // chest maps onto the old scale
assert.equal(v1.report.survey.streetFt, 4.2);
assert.equal(v1.report.test, true);
assert.equal(validateReport({ ...sv, kind: "past_dry", streetLevel: undefined, inside: undefined, insideLevel: undefined }).report.survey.streetLevel, null); // "no water" needs nothing more
assert.equal(validateReport({ ...sv, kind: "water_now" }).reason, "invalid"); // a "now" answer has no event or day
const nowSv = { ...sv, kind: "water_now", event: undefined, peakDay: undefined, peakPart: undefined, floodMonth: undefined };
assert.equal(validateReport(nowSv).ok, true); // "is your area flooded now?": the month is set by the server
assert.equal(validateReport({ ...nowSv, kind: "dry_now", streetLevel: undefined, inside: undefined, insideLevel: undefined }).ok, true);
assert.equal(validateReport({ ...nowSv, streetLevel: undefined }).reason, "invalid"); // water now needs a depth
assert.equal(validateReport({ ...sv, streetLevel: "neck" }).reason, "invalid");
assert.equal(validateReport({ ...sv, streetLevel: undefined }).reason, "invalid");
assert.equal(validateReport({ ...sv, streetFt: 99 }).reason, "invalid");
assert.equal(validateReport({ ...sv, peakDay: "2025-13-45x" }).reason, "invalid");
assert.equal(validateReport({ ...sv, peakDay: "2031-01-01" }).reason, "invalid");
assert.equal(validateReport({ ...sv, peakPart: "noon" }).reason, "invalid");
assert.equal(validateReport({ ...sv, inside: "no", insideLevel: "knee" }).report.survey.insideLevel, null);
assert.equal(validateReport({ ...sv, name: "A B", phone: "077" }).report.name, undefined);
assert.equal(validateReport({ ...sv, event: undefined }).reason, "invalid");
assert.equal(validateReport({ ...sv, floodMonth: undefined }).reason, "invalid"); // the flood month is required
assert.equal(validateReport({ ...sv, floodMonth: "2024-06" }).reason, "invalid"); // Ditwah was Nov-Dec 2025
assert.equal(validateReport({ ...sv, floodMonth: "2025-11", peakDay: "2025-12-01" }).reason, "invalid"); // deepest day outside the month
assert.equal(validateReport({ ...sv, event: "other", floodMonth: "2099-01", peakDay: undefined }).reason, "invalid"); // future
assert.equal(validateReport({ ...sv, event: "other", floodMonth: "2018-05", peakDay: undefined }).report.survey.floodMonth, "2018-05");
console.log("flood3d tests passed");

import { makeT } from "../app/[lang]/lab/flood-3d/strings.ts";
assert.equal(validateReport({ kind: "water_now", depth: "knee", lat: 6.95, lon: 79.9, src: "pin", consent: true, hp: "", ms: 5000, test: true }).report.test, true);
assert.equal(validateReport({ kind: "water_now", depth: "knee", lat: 6.95, lon: 79.9, src: "pin", consent: true, hp: "", ms: 5000 }).report.test, false);
const en = makeT("en"), si = makeT("si"), ta = makeT("ta");
assert.equal(en("Updated {time} · next update in ~{min} min", { time: "6:00 pm", min: 5 }), "Updated 6:00 pm · next update in ~5 min");
assert.ok(si("Locate me") !== "Locate me" && ta("Locate me") !== "Locate me");
assert.equal(si("Not a known key"), "Not a known key");
assert.ok(si("Nagalagam Street {ft} ft", { ft: "3.6" }).includes("3.6"));
console.log("flood3d i18n + test flag passed");

import { stripJpeg, exifAgree, distM } from "../lib/flood3dPhoto.ts";
{
  // a tiny fake JPEG: SOI, APP0, APP1 (EXIF with "GPS"), COM, DQT-like segment, SOS + data, EOI
  const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  const exif = [...Buffer.from("Exif\0\0GPSSECRET")];
  const jpeg = new Uint8Array([0xff, 0xd8, ...seg(0xe0, [1, 2, 3]), ...seg(0xe1, exif), ...seg(0xfe, [...Buffer.from("comment")]), ...seg(0xdb, [9, 9, 9]), 0xff, 0xda, 0, 4, 1, 2, 7, 7, 7, 0xff, 0xd9]);
  const out = stripJpeg(jpeg)!;
  assert.ok(out && out[0] === 0xff && out[1] === 0xd8);
  assert.ok(!Buffer.from(out).includes(Buffer.from("GPSSECRET")) && !Buffer.from(out).includes(Buffer.from("comment")));
  assert.ok(Buffer.from(out).includes(Buffer.from([0xff, 0xe0])) && Buffer.from(out).includes(Buffer.from([0xff, 0xdb])), "keeps APP0 and tables");
  assert.ok(out.length < jpeg.length);
  assert.equal(stripJpeg(new Uint8Array([1, 2, 3, 4, 5])), null);
  assert.equal(exifAgree({ lat: 6.955, lon: 79.922 }, "6.9551,79.9221"), 1);
  assert.equal(exifAgree({ lat: 6.955, lon: 79.922 }, "6.97,79.95"), 0);
  assert.equal(exifAgree({ lat: 6.955, lon: 79.922 }, ""), null);
  assert.ok(Math.abs(distM({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }) - 111.2) < 1);
  console.log("flood3d photo helpers passed");
}

import { composeLive } from "../lib/flood3dCompose.ts";
{
  const st = (station: string, lat: number, lon: number) => ({ station, latitude: lat, longitude: lon, basin: "Kelani Ganga   " });
  const rec = (s: { station: string }) => ({ station: s.station, level: 3.6, observedAt: "2026-10-27T12:00:00Z", marks: { alert: 4, minor: 5, major: 7 }, status: "watch", statusLabel: "Normal", trend: "falling", changePerHour3h: -0.1, url: "https://x/" + s.station });
  const box = { south: 6.8, north: 7.2, west: 79.75, east: 80.5 };
  const national = [st("Nagalagam Street", 6.958, 79.878), st("Hanwella", 6.909, 80.083), st("Kalu", 6.6, 80.1)];
  const a = composeLive(national, { now: 1 }, rec, [[3, 2.6]], 18, box, "Kelani Ganga")!;
  assert.equal(a.nagalagam!.levelFt, 3.6);                       // the core never depends on the optional parts
  assert.deepEqual(a.nagalagam!.horizons, []);                   // a slow forecast leaves horizons empty, not the level
  assert.equal(a.gauges.length, 2);                              // other basins are not drawn
  const b = composeLive(national, { now: 1, han: { horizons: [{ h: 3, level: 5, low: 4, high: 6 }], method: "model" }, fast: { ft: 17.9, at: "t" } }, rec, [[3, 2.6]], 18, box, "Kelani Ganga")!;
  assert.equal(b.hanwella!.fastFt, 17.9);
  assert.equal(b.hanwella!.horizons.length, 1);
  assert.equal(b.nagalagam!.fastFt, null);
  // a half-read snapshot without Nagalagam is never an answer (the data cache keeps its last good entry instead)
  assert.equal(composeLive([st("Hanwella", 6.909, 80.083)], { now: 1 }, rec, [], 18, box, "Kelani Ganga"), null);
  assert.equal(composeLive([], { now: 1 }, rec, [], 18, box, "Kelani Ganga"), null);
  console.log("flood3d live composition passed");
}
