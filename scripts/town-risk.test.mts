// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/town-risk.test.mts
import assert from "node:assert/strict";
import { assessTown, type GaugeIn, type TownRiskInput } from "../lib/townRisk.ts";
import { PLACES } from "../lib/places.ts";

const g = (o: Partial<GaugeIn> = {}): GaugeIn => ({ station: "Nagalagam Street", name: "Nagalagam Street", basin: "Kelani Ganga", tier: "normal", level: 2, unit: "ft", ts: 0, rate3hM: 0, km: 3, ...o });
const base = (o: Partial<TownRiskInput> = {}): TownRiskInput => ({ drainage: "canal-backwater", primary: g(), secondary: null, forecast: null, rain: null, release: null, warning: null, now: 0, ...o });
const rain = (o = {}) => ({ past6hMm: 0, past24hMm: 0, next6hMm: 0, next24hMm: 0, next24hP90Mm: null, next6hP90Mm: null, ...o });

// slugs are unique
assert.equal(new Set(PLACES.map((p) => p.slug)).size, PLACES.length);

// calm
assert.equal(assessTown(base()).tone, "normal");
// heavy rain on a calm river: one step
assert.equal(assessTown(base({ rain: rain({ next6hMm: 60 }) })).tone, "watch");
assert.equal(assessTown(base({ rain: rain({ past24hMm: 120 }) })).tone, "watch");
// rain does not stack beyond one step
assert.equal(assessTown(base({ primary: g({ tier: "alert" }), rain: rain({ next6hMm: 80 }) })).tone, "minor");
assert.equal(assessTown(base({ primary: g({ tier: "minor" }), rain: rain({ next6hMm: 80 }) })).tone, "minor");
assert.equal(assessTown(base({ primary: g({ tier: "major" }), rain: rain({ next6hMm: 80 }) })).tone, "major");
// upland: rain stops at watch; river alert unchanged
assert.equal(assessTown(base({ drainage: "upland", primary: g({ tier: "alert" }), rain: rain({ next6hMm: 80 }) })).tone, "alert");
// light rain does nothing; ensemble never changes the tone
assert.equal(assessTown(base({ rain: rain({ next24hMm: 30, next24hP90Mm: 200 }) })).tone, "normal");
// canal early rule
assert.equal(assessTown(base({ primary: g({ tier: "watch", rate3hM: 0.05 }) })).tone, "alert");
assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ tier: "watch", rate3hM: 0.05 }) })).tone, "watch");
// personal level
assert.equal(assessTown(base({ primary: g({ level: 4.6 }) }), 4.5).tone, "minor");
assert.equal(assessTown(base({ primary: g({ level: 4.0 }) }), 4.5).tone, "watch");
assert.equal(assessTown(base({ primary: g({ level: 4.0, rate3hM: 0.05 }) }), 4.5).tone, "alert");
assert.equal(assessTown(base({ primary: g({ level: 2 }) }), 4.5).tone, "normal");
// warnings are floors, and never push past minor
assert.equal(assessTown(base({ warning: { severity: "alert", source: "DMC", area: "Kelani Ganga" } })).tone, "alert");
assert.equal(assessTown(base({ warning: { severity: "major flood", source: "DMC", area: "x" } })).tone, "minor");
// no gauge
assert.equal(assessTown(base({ primary: g({ tier: "stale" }) })).tone, "stale");
assert.equal(assessTown(base({ primary: g({ tier: "stale" }), rain: rain({ next6hMm: 60 }) })).tone, "watch");
// secondary takes over
assert.equal(assessTown(base({ primary: g({ tier: "stale" }), secondary: g({ station: "Hanwella", name: "Hanwella", tier: "alert" }) })).tone, "alert");
console.log("town-risk ok");
