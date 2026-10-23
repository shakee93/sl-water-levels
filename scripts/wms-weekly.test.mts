// node scripts/wms-weekly.test.mts   (needs unpdf from node_modules; sample PDF path as arg or default below)
import { readFileSync } from "node:fs";
import { getDocumentProxy } from "unpdf";
// @ts-expect-error node strip-types needs explicit extensions
import { parseWeekly, parseSpillDays } from "../lib/wmsWeeklyParse.ts";

let ok = 0;
let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

// ---- date expressions seen in the 16 Oct 2026 file, plus variants
const M = "2026-10-16";
eq("range", parseSpillDays("20 to 22 Oct", M), ["2026-10-20", "2026-10-21", "2026-10-22"]);
eq("range with dot", parseSpillDays("16 to 29 Oct.", M).length, 14);
eq("list with gap", parseSpillDays("16 to 18 ,20 & 21 Oct.", M), ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-20", "2026-10-21"]);
eq("month first with volumes", parseSpillDays("Oct 20 -0.76mcm, 21 -0.85 mcm, 22 -1.23mcm , 23 - 1.5mcmc & 24 - 0.47mcm", M), ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
eq("single", parseSpillDays("21 Oct", M), ["2026-10-21"]);
eq("two singles", parseSpillDays("20 & 21 Oct", M), ["2026-10-20", "2026-10-21"]);
eq("ordinals inline", parseSpillDays("20th to 22nd Oct", M), ["2026-10-20", "2026-10-21", "2026-10-22"]);
eq("across months", parseSpillDays("30 Oct to 2 Nov", M), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
eq("across months, month only at end", parseSpillDays("30 to 2 Nov", M), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
eq("full month name", parseSpillDays("5th - 7th November", "2026-11-02"), ["2026-11-05", "2026-11-06", "2026-11-07"]);
eq("year rollover", parseSpillDays("2 to 4 Jan", "2026-12-28"), ["2027-01-02", "2027-01-03", "2027-01-04"]);
eq("no month: meeting month", parseSpillDays("20 to 22", M), ["2026-10-20", "2026-10-21", "2026-10-22"]);
eq("nothing", parseSpillDays("maintain level", M), []);

// ---- the saved PDF
const file = process.argv[2] ?? "/private/tmp/claude-503/-Users-shakeeb-projects-sl-water-levels/e9c9a5fa-f47f-4c44-9d18-7d5d414d895f/scratchpad/wms/weekly.pdf";
const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
type Cell = { s: string; x: number; r: number; y: number; page: number };
const cells: Cell[] = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const tc = await (await pdf.getPage(p)).getTextContent();
  for (const it of tc.items as { str?: string; transform: number[]; width: number }[]) if (it.str?.trim()) cells.push({ s: it.str!.trim(), x: it.transform[4], r: it.transform[4] + it.width, y: it.transform[5], page: p });
}
const r = parseWeekly(cells);
eq("meeting date", r.meetingDate, "2026-10-16");
eq("next week", r.nextWeek, { from: "2026-10-19", to: "2026-10-25" });
type Item = { name: string; spillWindow: { from: string; to: string } | null; spillDays: string[]; lastWeekMcm: number | null; plannedMcmPerDay: number | null };
const by = new Map<string, Item>((r.items as Item[]).map((i) => [i.name, i]));
const win = (n: string) => by.get(n)?.spillWindow ?? null;
eq("reservoir count", r.items.length >= 18, true);
eq("Upper Kotmale window", win("Upper Kotmale"), { from: "2026-10-20", to: "2026-10-22" });
eq("Norton window", win("Norton"), { from: "2026-10-16", to: "2026-10-29" });
eq("Laxapana window", win("Laxapana"), { from: "2026-10-16", to: "2026-10-21" });
eq("Laxapana days", by.get("Laxapana")?.spillDays, ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-20", "2026-10-21"]);
eq("Kukule window (wrapped remark)", win("Kukuleganga"), { from: "2026-10-20", to: "2026-10-24" });
eq("Polgolla window (remark split over 2 rows)", win("Polgolla"), { from: "2026-10-16", to: "2026-10-29" });
eq("Puhulpola single day", win("Puhulpola"), { from: "2026-10-21", to: "2026-10-21" });
eq("Dayaraba", win("Dayaraba"), { from: "2026-10-20", to: "2026-10-21" });
for (const n of ["Maussakelle", "Canyon", "Castlereigh", "Kotmale", "Victoria", "Randenigala", "Rantambe", "Samanalawewa", "Bowatenna", "Moragahakanda", "Broadland", "Udawalawa"]) eq(`${n}: no spill`, win(n), null);
eq("Upper Kotmale numbers", [by.get("Upper Kotmale")!.lastWeekMcm, by.get("Upper Kotmale")!.plannedMcmPerDay], [15.98, 2.5]);
eq("Kotmale numbers", [by.get("Kotmale")!.lastWeekMcm, by.get("Kotmale")!.plannedMcmPerDay], [36.21, 6]);
eq("Maussakelle numbers", [by.get("Maussakelle")!.lastWeekMcm, by.get("Maussakelle")!.plannedMcmPerDay], [14.94, 1.25]);
eq("Randenigala planned from remark", by.get("Randenigala")!.plannedMcmPerDay, 4.1);
eq("Rantambe planned from remark", [by.get("Rantambe")!.lastWeekMcm, by.get("Rantambe")!.plannedMcmPerDay], [33.68, 6.48]);
eq("Moragahakanda cusec -> mcm/day", by.get("Moragahakanda")!.plannedMcmPerDay, 3.43);
eq("Broadland blank release", by.get("Broadland")!.lastWeekMcm, null);
eq("Kukule planned", by.get("Kukuleganga")!.plannedMcmPerDay, 3.3);
console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
