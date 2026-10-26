// node scripts/spill-warning.test.mts : "nears spill level / may open gates" stories, never a release.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (s.startsWith(".")) return n(s + ".ts", c); throw e; } }`));
// @ts-expect-error explicit .ts extension for node
const { matchSpillWarningWith } = await import("../lib/spillWarningMatch.ts");
// @ts-expect-error explicit .ts extension for node
const { matchReservoir } = await import("../lib/reservoirs.ts");

let ok = 0;
let bad = 0;
const check = (title: string, want: string | null, desc = "") => {
  const r = matchSpillWarningWith(matchReservoir, title, desc);
  const got = r ? r.reservoir.id : null;
  const pass = got === want;
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${title}${pass ? "" : `  got ${got} want ${want}`}`);
};

// warnings
check("Kotmale Reservoir nears spill level amid heavy rain, Warning issued to downstream residents", "kotmale");
check("Victoria reservoir nearing spill level", "victoria");
check("Advance spill warning issued for Upper Kotmale reservoir", "upper-kotmale");
check("Spill warning for Castlereigh reservoir", "castlereagh");
check("Laxapana reservoir may open spill gates, residents warned", "laxapana");
check("Spill gates of Kotmale reservoir may be opened tonight", "kotmale");
check("Rajanganaya reservoir likely to spill", "rajangana");
check("Randenigala reservoir about to spill", "randenigala");
check("Residents downstream of Moragahakanda urged to be alert", null, "");
check("Bowatenna reservoir approaching full supply level", "bowatenna");
check("Samanalawewa reservoir close to spilling", "samanalawewa");
check("Norton reservoir nears spill level", "norton", "Two spill gates remain closed.");
// not a warning: a release (gates ARE open), unrelated, no reservoir
check("Two spill gates of Kotmale reservoir opened", null);
check("Kotmale reservoir spill gates opened, residents warned", null);
check("Victoria reservoir gates raised by 2 ft", null);
check("Oil spill nears Sri Lanka coast, navy on alert", null);
check("Sea level nears record high amid heavy rain", null);
check("Rough sea warning issued for southern coast", null);
check("Kotmale Oya valley residents shopping for groceries", null);
check("Victoria Park spill of paint near the fountain", null);
check("Kotmale reservoir water level rises", null);
check("Two gates of Upper Kotmale reservoir closed again", null);

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
