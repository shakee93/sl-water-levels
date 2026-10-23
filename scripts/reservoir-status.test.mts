// node scripts/reservoir-status.test.mts   (pure maths in lib/reservoirStatusCalc.ts)
// @ts-expect-error node strip-types needs explicit extensions
import { computeKnown, fslConsistent, planOf, trendOf, FSL_M } from "../lib/reservoirStatusCalc.ts";

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

// ---- full supply levels against the WMS report of 23 Oct 2026 (level m, storage %)
const live: Record<string, [number, number]> = {
  kotmale: [696.3, 78], victoria: [436.39, 94], randenigala: [222.83, 75], rantambe: [149.95, 59],
  samanalawewa: [443.79, 54], bowatenna: [250.55, 76], maussakele: [1165.12, 85], castlereagh: [1094.02, 90],
};
const below = (id: string) => fslConsistent(FSL_M[id], live[id][0], live[id][1]);
eq("Victoria reconciles", below("victoria"), 1.61);
eq("Kotmale reconciles", below("kotmale"), 6.7);
eq("Randenigala reconciles", below("randenigala"), 9.17);
eq("Rantambe reconciles", below("rantambe"), 2.05);
eq("Samanalawewa reconciles", below("samanalawewa"), 16.21);
eq("Bowatenna reconciles", below("bowatenna"), 1.21);
eq("Maussakele reconciles", below("maussakele"), 2.28);
eq("Castlereagh is left out", below("castlereagh"), null);
eq("Castlereagh SOP value would fail the check", fslConsistent(1094.2, 1094.02, 90), null);
eq("90% full but 0.1 m below is rejected", fslConsistent(100, 99.9, 90), null);
eq("100% full but 3 m below is rejected", fslConsistent(100, 97, 100), null);
eq("above full by 1 m is rejected", fslConsistent(100, 101, 100), null);
eq("no level", fslConsistent(100, null, 90), null);

// ---- trend between two daily reports
eq("Victoria filling", trendOf({ day: "2026-10-23", levelMsl: 436.39, pct: 94 }, { day: "2026-10-22", levelMsl: 436.08, pct: 93 })?.kind, "filling");
eq("Castlereagh emptying", trendOf({ day: "2026-10-23", levelMsl: 1094.02, pct: 90 }, { day: "2026-10-22", levelMsl: 1094.21, pct: 91 })?.kind, "emptying");
eq("Kotmale steady", trendOf({ day: "2026-10-23", levelMsl: 696.3, pct: 78 }, { day: "2026-10-22", levelMsl: 696.32, pct: 78 })?.kind, "steady");
eq("two days apart halves the rate", trendOf({ day: "2026-10-24", levelMsl: 100.15, pct: 50 }, { day: "2026-10-22", levelMsl: 100, pct: 50 })?.kind, "steady");
eq("two days apart, 0.25 m", trendOf({ day: "2026-10-24", levelMsl: 100.25, pct: 50 }, { day: "2026-10-22", levelMsl: 100, pct: 50 })?.kind, "filling");
eq("no earlier day", trendOf({ day: "2026-10-23", levelMsl: 1, pct: 1 }, null), null);
eq("too old to compare", trendOf({ day: "2026-10-23", levelMsl: 1, pct: 1 }, { day: "2026-10-10", levelMsl: 1, pct: 1 }), null);
eq("pct only", trendOf({ day: "2026-10-23", levelMsl: null, pct: 60 }, { day: "2026-10-22", levelMsl: null, pct: 55 })?.kind, "filling");

// ---- weekly plan: mcm/day as an average in cusecs
const nextWeek = { from: "2026-10-19", to: "2026-10-25" };
const item = { plannedMcmPerDay: 6, lastWeekMcm: 36.21, spillWindow: null };
eq("6 mcm/day is about 2450 cusecs", planOf(item, "2026-10-16", nextWeek, "2026-10-23")?.avgCusecs, 2450);
eq("1.25 mcm/day is about 510 cusecs", planOf({ ...item, plannedMcmPerDay: 1.25 }, "2026-10-16", nextWeek, "2026-10-23")?.avgCusecs, 510);
eq("plan week over is greyed", planOf(item, "2026-10-16", nextWeek, "2026-10-26")?.stale, true);
eq("plan is current in its week", planOf(item, "2026-10-16", nextWeek, "2026-10-25")?.stale, false);
eq("old plan disappears", planOf(item, "2026-10-16", nextWeek, "2026-11-05"), null);
eq("no planned figure", planOf({ ...item, plannedMcmPerDay: null }, null, nextWeek, "2026-10-23"), null);

// ---- near spill
const base = {
  today: "2026-10-23", catalogueId: "victoria", flow: null,
  storage: { pct: 94, source: "Mahaweli Authority" as const, day: "2026-10-23", fresh: true },
  wms: { day: "2026-10-23", fresh: true, levelMsl: 436.39 },
  prev: { day: "2026-10-22", levelMsl: 436.08, pct: 93 }, weekly: null,
};
eq("Victoria today: 94%, 1.6 m below: not near spill", computeKnown(base).nearSpill, false);
eq("95% and filling: near spill", computeKnown({ ...base, storage: { ...base.storage, pct: 96 }, wms: { ...base.wms, levelMsl: 436.9 } }).nearSpill, true);
eq("0.3 m below and filling: near spill", computeKnown({ ...base, wms: { ...base.wms, levelMsl: 437.7 }, storage: { ...base.storage, pct: 98 }, prev: { ...base.prev, levelMsl: 437.5, pct: 97 } }).nearSpill, true);
eq("95% but falling: not near spill", computeKnown({ ...base, storage: { ...base.storage, pct: 96 }, prev: { ...base.prev, levelMsl: 437.0 } }).nearSpill, false);
eq("stale storage never raises it", computeKnown({ ...base, storage: { ...base.storage, pct: 99, fresh: false }, wms: { ...base.wms, fresh: false } }).nearSpill, false);
eq("nothing known", computeKnown({ ...base, storage: null, wms: null, prev: null, catalogueId: null }).known, false);
eq("Castlereagh shows no metres", computeKnown({ ...base, catalogueId: "castlereagh", wms: { ...base.wms, levelMsl: 1094.02 }, storage: { ...base.storage, pct: 90 } }).fsl, null);

console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
