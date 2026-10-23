// node scripts/gate-story.test.mts : the news matcher against real-style headlines, with the full catalogue.
// @ts-expect-error node strip-types needs explicit extensions
import { matchGateStoryWith } from "../lib/gateStory.ts";
// @ts-expect-error explicit .ts extension for node
import { matchReservoir } from "../lib/reservoirs.ts";

const run = (t: string, d = "") => matchGateStoryWith(matchReservoir, t, d);
let ok = 0;
let bad = 0;
const check = (title: string, want: [string, string] | null, desc = "") => {
  const r = run(title, desc);
  const got = r ? [r.reservoir.id, r.action] : null;
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${title}${pass ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

// positives
check("Two spill gates of Upper Kotmale reservoir opened", ["upper-kotmale", "opened"]);
check("Kotmale reservoir spill gates opened", ["kotmale", "opened"]);
check("Victoria reservoir spill gates opened", ["victoria", "opened"]);
check("Two spill gates of Moussakele reservoir opened", ["maussakele", "opened"], "Residents downstream of the Maussakelle dam urged to be vigilant");
check("Castlereigh reservoir spill gates raised", ["castlereagh", "opened"]);
check("Canyon reservoir spill gates opened due to heavy rain", ["canyon", "opened"]);
check("Samanalawewa reservoir spill gates opened", ["samanalawewa", "opened"]);
check("Kukule Ganga reservoir gates opened", ["kukule", "opened"]);
check("Three radial gates of Bowatenna reservoir opened", ["bowatenna", "opened"]);
check("Moragahakanda reservoir spill gates opened", ["moragahakanda", "opened"]);
check("Polgolla barrage gates opened to release excess water", ["polgolla", "opened"]);
check("Rantambe reservoir: all spill gates opened", ["rantambe", "opened"]);
check("Spill gates of the Kaluganga reservoir opened", ["kaluganga", "opened"]);
check("Laxapana reservoir spill gates opened", ["laxapana", "opened"]);
check("Upper Kotmale: two gates closed again", ["upper-kotmale", "closed"]);
// negatives
check("Victoria Park gates opened to the public", null);
check("Spill gates of Upper Kotmale reservoir to open tonight", null);
check("Kotmale reservoir spill gates will be opened if rain continues", null);
check("Polgolla gates remain shut, says Mahaweli Authority", ["polgolla", "closed"]);
check("Randenigala reservoir water level rises", null);
check("Norton Bridge cricket ground reopened", null);
check("Gates of the Canyon Road school opened", null);
check("Castle Street gates opened", null);
console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
