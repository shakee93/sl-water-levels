// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/release-alert.test.mts
// The shared "big confirmed release = Alert" rule (lib/releaseAlert.ts) and the release lookup behind it (lib/releases.ts).
import assert from "node:assert/strict";
import { officialReleaseAlert, tierWithRelease, releaseAlertLine, RELEASE_ALERT_CUSECS } from "../lib/releaseAlert.ts";

const dep = { active: true, confirmed: true, direct: true, cusecs: 10400, reservoir: "Deduru Oya", source: "Irrigation Department", gatesOpen: 8 };
assert.equal(RELEASE_ALERT_CUSECS, 5000);
assert.deepEqual(officialReleaseAlert(dep), { reservoir: "Deduru Oya", cusecs: 10400, gates: 8 });
assert.equal(releaseAlertLine(officialReleaseAlert(dep)), "Deduru Oya reservoir is releasing 10,400 cusecs through 8 gates");
assert.equal(releaseAlertLine({ reservoir: "Deduru Oya", cusecs: 5000, gates: null }), "Deduru Oya reservoir is releasing 5,000 cusecs");
assert.equal(releaseAlertLine({ reservoir: "X", cusecs: 6000, gates: 1 }), "X reservoir is releasing 6,000 cusecs through 1 gate");
assert.ok(releaseAlertLine(officialReleaseAlert(dep), "si").includes("10,400"));
assert.ok(releaseAlertLine(officialReleaseAlert(dep), "ta").includes("10,400"));

// tiers: only calm gauges move, only to alert
assert.equal(tierWithRelease("normal", dep), "alert");
assert.equal(tierWithRelease("watch", dep), "alert");
for (const t of ["alert", "minor", "major", "stale", "none"]) assert.equal(tierWithRelease(t, dep), t);

// what never counts
assert.equal(officialReleaseAlert(null), null);
assert.equal(officialReleaseAlert({ ...dep, cusecs: 4999 }), null);
assert.equal(officialReleaseAlert({ ...dep, cusecs: null }), null);
assert.equal(officialReleaseAlert({ ...dep, confirmed: false }), null); // news only
assert.equal(officialReleaseAlert({ ...dep, active: false }), null);
assert.equal(officialReleaseAlert({ ...dep, direct: false }), null); // only further down the same river
assert.equal(officialReleaseAlert({ ...dep, source: "Mahaweli Authority" }), null); // discharge includes power-station flow
assert.equal(officialReleaseAlert({ ...dep, source: "Ada Derana" }), null);
assert.equal(officialReleaseAlert({ ...dep, source: null }), null);
assert.equal(officialReleaseAlert({ ...dep, gatesOpen: null }).gates, null);

// the curated link behind it (lib/reservoirs.ts cannot be imported by node: extensionless imports): Deduru Oya sits directly above Moragaswewa (4-5 h)
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../lib/reservoirs.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf('id: "deduru-oya"'), src.indexOf("id:", src.indexOf('id: "deduru-oya"') + 10));
assert.ok(/station: "Moragaswewa"[\s\S]*?eta: \[4, 5\]/.test(block), "Deduru Oya is linked directly to Moragaswewa with a 4-5 h travel time");
assert.ok(!/indirect: true/.test(block));
console.log("release-alert ok");
