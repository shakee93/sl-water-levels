// node --experimental-strip-types --no-warnings scripts/sheet-freshness.test.mts   (pure rule in lib/sheetFreshness.mjs)
import { daysFromToday, newestRowProblem } from "../lib/sheetFreshness.mjs";

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

const prob = (d: string | null, now: number): string => String(newestRowProblem(d, now));

// 8 Nov 2026 10:00 Colombo = 04:30 UTC
const now = Date.parse("2026-11-08T04:30:00Z");
eq("today ok", newestRowProblem("2026-11-08", now), null);
eq("yesterday ok", newestRowProblem("2026-11-07", now), null);
eq("tomorrow ok (the 8 Nov false alarm)", newestRowProblem("2026-11-09", now), null);
eq("two days ahead is a fault", /2 days in the future/.test(prob("2026-11-10", now)), true);
eq("two days old is stale", /2 days old/.test(prob("2026-11-06", now)), true);
eq("no date", /none/.test(prob(null, now)), true);
eq("garbage date", /not a valid date/.test(prob("2026-13-45", now)), true);

// Colombo midnight edge: 23:30 UTC on 8 Nov is 05:00 on 9 Nov in Colombo, so "today" is 9 Nov
const late = Date.parse("2026-11-08T23:30:00Z");
eq("edge: Colombo day already 9 Nov", daysFromToday("2026-11-09", late), 0);
eq("edge: 10 Nov is tomorrow, ok", newestRowProblem("2026-11-10", late), null);
eq("edge: 11 Nov is a fault", newestRowProblem("2026-11-11", late) !== null, true);
// 18:00 UTC on 8 Nov is 23:30 Colombo, still the 8th
eq("edge: before Colombo midnight", daysFromToday("2026-11-08", Date.parse("2026-11-08T18:00:00Z")), 0);
// month and year rollover
eq("rollover: 1 Jan is tomorrow of 31 Dec", daysFromToday("2027-01-01", Date.parse("2026-12-31T04:00:00Z")), 1);

if (bad) { console.log(`${bad} FAILED`); process.exit(1); }
console.log("all passed");
