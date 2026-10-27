// node --experimental-strip-types scripts/town-notes.test.mts
import assert from "node:assert/strict";
// @ts-ignore node strip-types needs explicit extensions
import { markGap, dayOutlook, shapePeople as sp } from "../lib/townNotes.ts";
const shapePeople = (f: Parameters<typeof sp>[0], w: number) => sp(f, w, 3, 6);
// @ts-ignore node strip-types needs explicit extensions
import { assessTown } from "../lib/townRisk.ts";

const th = { alert: 21.3, minor: 24.6, major: 31.2 };
// Hanwella 20.5 ft: 0.8 below alert
let g = markGap(20.5, th, "ft")!;
assert.equal(g.above, null); assert.equal(g.below!.mark, "alert"); assert.ok(Math.abs(g.below!.ft - 0.8) < 1e-9);
g = markGap(22.5, th, "ft")!;
assert.equal(g.above!.mark, "alert"); assert.equal(g.below!.mark, "minor"); assert.ok(Math.abs(g.below!.ft - 2.1) < 1e-9);
assert.equal(markGap(5, th, "ft"), null, "far below the marks: nothing");
assert.equal(markGap(20.5, th, null), null, "unknown unit: nothing");
assert.equal(markGap(40, th, "ft")!.below, null);
// metre gauge reported in feet
assert.ok(Math.abs(markGap(4.5, { alert: 5, minor: 6, major: 7 }, "m")!.below!.ft - 1.6404) < 1e-3);

const hs = (a: number[]) => a.map((level, i) => ({ h: 4 * (i + 1), level }));
assert.equal(dayOutlook({ level: 20.5, horizons: hs([20.6, 20.5, 20.4]), alertMark: 21.3, unit: "ft" })!.kind, "flat");
assert.equal(dayOutlook({ level: 20.5, horizons: hs([20, 19.5, 19]), alertMark: 21.3, unit: "ft" })!.kind, "easing");
const pk = dayOutlook({ level: 20.5, horizons: hs([21, 22, 21.5, 20, 19, 18]), alertMark: 21.3, unit: "ft" })!;
assert.equal(pk.kind, "peak"); assert.equal(pk.kind === "peak" && pk.h, 8);
assert.equal(dayOutlook({ level: 22, horizons: hs([21.5, 21, 20.8, 20.5, 20.4, 20.3]), alertMark: 21.3, unit: "ft" })!.kind, "backBelow");
assert.equal(dayOutlook({ level: 20, horizons: hs([21, 22, 23, 24, 25, 26].map((v) => v - 0)), alertMark: 21.3, unit: "ft" })!.kind, "rising");
assert.equal(dayOutlook({ level: 20, horizons: hs([20]), alertMark: 21.3, unit: "ft" }), null, "too few points");
assert.equal(dayOutlook({ level: 20, horizons: hs([20, 20, 20]), alertMark: 21.3, unit: null }), null);

// privacy: nothing below K_MIN (3)
assert.equal(shapePeople({ n: 2, yes: 2, worse: 0, better: 0 }, 2), null);
assert.deepEqual(shapePeople({ n: 4, yes: 3, worse: 1, better: 0 }, 1), { answers: { n: 4, yes: 3, worse: 1, better: 0 }, water: null });
assert.equal(shapePeople({ n: 0, yes: 0, worse: 0, better: 0 }, 3)!.water!.n, 3);

// why: a warning holds the town at Alert while the gauge is below its alert mark
const gauge = { station: "Hanwella", name: "Hanwella", basin: "Kelani Ganga", tier: "watch" as const, level: 20.5, unit: "ft" as const, ts: 1, rate3hM: -0.01, km: 0.5 };
const base = { drainage: "riverbank" as const, primary: gauge, secondary: null, forecast: null, rain: null, release: null, warning: { severity: "alert" as const, source: "Irrigation Department", area: "Kelani Ganga" }, now: 1 };
assert.equal(assessTown(base).tone, "alert");
assert.equal(assessTown(base).why?.kind, "warning");
assert.equal(assessTown({ ...base, warning: null }).why, null);
assert.equal(assessTown({ ...base, primary: { ...gauge, tier: "alert" } }).why, null, "gauge itself at Alert: no 'why'");
console.log("town-notes ok");
