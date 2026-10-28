// node scripts/season.test.mts   (pure maths in lib/seasonCalc.ts)
// @ts-expect-error node strip-types needs explicit extensions
import { compareSeason, seasonOf, summariseSeasonTab } from "../lib/seasonCalc.ts";

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};
const throws = (name: string, f: () => unknown, re: RegExp) => {
  let msg = "";
  try { f(); } catch (e) { msg = String((e as Error).message); }
  eq(name, re.test(msg), true);
};

// ---- a Maha tab like the sheet's: numbers with thousands commas, blank cells for days still to come
const MAHA_H = ["NO", "Update Date", "Reservoir", "Latitude", "Longitude", "Range", "Division", "Active Storage (Acft)", "Long Term Avarage", "ES_24_25_Acft", "ES_25_26_Acft", "ES_26_27_Acft"];
const mahaRow = (day: string, name: string, active: string, lta: string, a: string, b: string, c: string) => ["1", day, name, "7.6", "81.4", "AMPARA", "Maha Oya", active, lta, a, b, c];
const names = Array.from({ length: 25 }, (_, i) => `Tank ${i}`);
const grid = [MAHA_H];
for (const n of names) {
  grid.push(mahaRow("10/27/2026", n, "1,970", "700", "1,400", "300", "600"));
  grid.push(mahaRow("10/28/2026", n, "1,970", "985", "1,500", "400", "985"));
  grid.push(mahaRow("10/29/2026", n, "1,970", "990", "1,500", "400", "")); // future day: blank
}
grid.push(mahaRow("10/28/2026", "Tampitiya", "1,970", "985", "1,500", "400", "655"));
grid.push(mahaRow("1/5/2027", "Tampitiya", "1,970", "1,000", "1,500", "400", "")); // wrapped into next year

const s = summariseSeasonTab(grid, "maha", "2026-10-28");
eq("kind and as-of", [s.kind, s.asOf], ["maha", "2026-10-28"]);
const t = s.rows.find((r: { name: string }) => r.name === "Tampitiya");
eq("today's row is used, blank future days skipped", t, { name: "Tampitiya", activeAcft: 1970, ltaAcft: 985, curAcft: 655, prevAcft: 400, day: "2026-10-28" });
eq("every reservoir present once", s.rows.length, 26);

// Day after the last filled one: falls back to the newest filled day (within the gap limit)
const s2 = summariseSeasonTab(grid, "maha", "2026-10-30");
eq("two days past the last filled row still uses it", s2.rows.find((r: { name: string }) => r.name === "Tampitiya")?.day, "2026-10-28");
throws("a week past the last filled row is dropped", () => summariseSeasonTab(grid, "maha", "2026-11-10"), /only 0 reservoirs/);

// January belongs to the season that started in October: its columns are ES_26_27, not ES_27_28
const jan = [MAHA_H, ...names.map((n) => mahaRow("1/5/2027", n, "1,000", "500", "800", "200", "250"))];
const sj = summariseSeasonTab(jan, "maha", "2027-01-05");
eq("January uses the season that began in October", sj.rows[0], { name: "Tank 0", activeAcft: 1000, ltaAcft: 500, curAcft: 250, prevAcft: 200, day: "2027-01-05" });

// ---- Yala: one column per calendar year
const YALA_H = ["NO", "Update Date", "Reservoir", "Latitude", "Longitude", "Range", "Division", "Active Storage (Acft)", "Long Term Avarage", "EFFECTIVE STORAGE (Acft) 2023", "EFFECTIVE STORAGE (Acft) 2024", "EFFECTIVE STORAGE (Acft) 2025", "EFFECTIVE STORAGE (Acft) 2026"];
const yala = [YALA_H, ...names.map((n) => ["1", "7/15/2026", n, "7", "81", "X", "Y", "2,000", "1,200", "900", "1,000", "1,100", "1,300"])];
eq("Yala picks this year and last year", summariseSeasonTab(yala, "yala", "2026-07-15").rows[0], { name: "Tank 0", activeAcft: 2000, ltaAcft: 1200, curAcft: 1300, prevAcft: 1100, day: "2026-07-15" });
eq("seasonOf", [1, 3, 4, 9, 10, 12].map(seasonOf), ["maha", "maha", "yala", "yala", "maha", "maha"]);

// ---- layout changes are loud
throws("no header row", () => summariseSeasonTab([["a", "b"]], "maha", "2026-10-28"), /header row not found/);
throws("missing long-term column", () => summariseSeasonTab([MAHA_H.filter((h) => !/Long/.test(h)), ...grid.slice(1)], "maha", "2026-10-28"), /columns missing/);
throws("too few rows", () => summariseSeasonTab(grid.slice(0, 5), "maha", "2026-10-28"), /only/);
const noCur = summariseSeasonTab([MAHA_H.slice(0, 11), ...grid.slice(1).map((r: string[]) => r.slice(0, 11))], "maha", "2026-10-28");
eq("no current-season column: rows kept, current unknown", noCur.rows[0].curAcft, null);

// ---- the comparison
const row = { name: "T", activeAcft: 1000, ltaAcft: 480, curAcft: 620, prevAcft: 550, day: "2026-10-28" };
eq("above normal, late October", compareSeason(row, null), { nowPct: 62, avgPct: 48, lastPct: 55, band: "above", diffPts: 14, month: 10, part: "late" });
eq("live figure wins over the tab's", compareSeason(row, 50)?.band, "near");
eq("exactly 10 points above is above", compareSeason({ ...row, curAcft: 580 }, null)?.band, "above");
eq("9 points below is about normal", compareSeason({ ...row, curAcft: 390 }, null)?.band, "near");
eq("10 points below is below", compareSeason({ ...row, curAcft: 380 }, null)?.band, "below");
eq("an overflowing tank counts as 100%", compareSeason({ ...row, curAcft: 1590, ltaAcft: 1090 }, null)?.nowPct, 100);
eq("no average means no line", compareSeason({ ...row, ltaAcft: null }, null), null);
eq("no current figure means no line", compareSeason({ ...row, curAcft: null }, null), null);
eq("unknown last year stays null", compareSeason({ ...row, prevAcft: null }, null)?.lastPct, null);
eq("part of month", [1, 10, 11, 20, 21, 31].map((d) => compareSeason({ ...row, day: `2026-10-${String(d).padStart(2, "0")}` }, null)?.part), ["early", "early", "mid", "mid", "late", "late"]);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
