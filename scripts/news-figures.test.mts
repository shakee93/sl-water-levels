// node scripts/news-figures.test.mts : cusecs / gates / feet in news stories, per reservoir.
import { register } from "node:module";
// lib/reservoirs.ts imports its siblings without extensions (Next resolves them); let plain node do the same.
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (s.startsWith(".")) return n(s + ".ts", c); throw e; } }`));
// @ts-expect-error explicit .ts extension for node
const { figureOf, reportedFigures } = await import("../lib/newsFigures.ts");
// @ts-expect-error explicit .ts extension for node
const { matchReservoir } = await import("../lib/reservoirs.ts");

let ok = 0;
let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const f = (s: string) => figureOf(s);

eq("over N cubic feet per second", f("to release more than 15,000 cubic feet of water per second into the Kala Oya."), { cusecs: 15000, atLeast: true, gates: null, openedFt: null, planned: false });
eq("over N cusecs", f("Over 12000 cusecs are being released")?.atLeast, true);
eq("plain cusecs", f("Rajanganaya is spilling 12,950 cusecs"), { cusecs: 12950, atLeast: false, gates: null, openedFt: null, planned: false });
eq("N cusecs small", f("880 cusecs released")?.cusecs, 880);
eq("thousand", f("about 15 thousand cusecs")?.cusecs, 15000);
eq("ft3/s", f("discharge 4,200 ft3/s")?.cusecs, 4200);
eq("sinhala marker, digits only", f("ඝණ අඩි 9,500 ක් මුදාහරී")?.cusecs, 9500);
eq("tamil marker", f("9500 கன அடி நீர்")?.cusecs, 9500);
eq("qualifier is the number's own", f("opened over 3 hours ago, releasing 2,000 cusecs")?.atLeast, false);
eq("sixteen spill gates, planned", f("16 spill gates of Rajanganaya Reservoir to be opened"), { cusecs: null, atLeast: false, gates: 16, openedFt: null, planned: true });
eq("gate words", f("Four radial gates opened by one foot each")?.gates, 4);
eq("opened by 1 ft", f("four spill gates have been opened by one foot each")?.openedFt, 1);
eq("opened 1 ft", f("4 gates opened 1 ft")?.openedFt, 1);
eq("opened by 2.5 feet", f("gates raised by 2.5 feet")?.openedFt, 2.5);
eq("have been opened is not planned", f("four spill gates of the Tabbowa Reservoir have been opened")?.planned, false);
eq("four of the six gates: not 6", f("four of the six gates were opened")?.gates ?? null, null);
eq("closing gives nothing", f("two gates closed again, releasing nothing"), null);
eq("no figure", f("Residents have been advised to remain vigilant."), null);
eq("noise: 3 ft depth is not cusecs", f("the water level rose by 3 feet")?.cusecs ?? null, null);
eq("small number near marker ignored", f("1 cusec")?.cusecs ?? null, null);

// The real Ada Derana story of 26 Oct 2026 (two reservoirs in one story).
const title = "16 spill gates of Rajanganaya Reservoir to be opened; residents of low-lying areas cautioned";
const body =
  "The Irrigation Department says 16 spill gates of the Rajanganaya Reservoir are to be opened to release more than 15,000 cubic feet of water per second into the Kala Oya. " +
  "The measure is to be taken to control the volume of water flowing into the reservoir as of 12 noon today (26). " +
  "The department stated that the number of spill gates opened may change depending on rainfall in the reservoir’s catchment areas and the volume of water flowing into the reservoir. " +
  "Accordingly, residents living in the low-lying areas of the Rajanganaya Reservoir and in areas surrounding the Kala Oya basin have been advised to remain vigilant about changes in water levels. " +
  "Meanwhile, four spill gates of the Tabbowa Reservoir, located in the Mee Oya basin, have also been opened by one foot each. " +
  "The measure has been taken to regulate the volume of water flowing into the reservoir as of 12 noon today, with 880 cubic feet of water per second being released into the Mee Oya, the Irrigation Department said. " +
  "Residents living in the low-lying areas of the Tabbowa Reservoir and along both banks of the Mee Oya have also been urged to remain alert.";
const m = reportedFigures(title, body, matchReservoir);
eq("story: reservoirs", [...m.keys()].sort(), ["rajangana", "tabbowa"]);
eq("story: Rajanganaya", m.get("rajangana"), { cusecs: 15000, atLeast: true, gates: 16, openedFt: null, planned: true });
eq("story: Tabbowa", m.get("tabbowa"), { cusecs: 880, atLeast: false, gates: 4, openedFt: 1, planned: false });

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
