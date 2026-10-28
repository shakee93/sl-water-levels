#!/usr/bin/env node
// OWNER-SIDE ONLY. Exports the flood3d_reports table (precise positions!) from D1 to a local JSON file for scripts/flood3d/prep.py (REPORTS=file).
// The file holds exact coordinates: keep it in the scratchpad, never commit it, never copy it to the public data branch.
// Read-only, one indexed query (id range). Usage: node scripts/flood3d/reports-export.mjs <out.json>   (needs wrangler's login, like feedback-export)
//
// WHAT prep.py SHOULD READ (prep.py is not changed by this commit; today it uses only kind / event / nag_ft / lat / lon / acc_m / status):
//   Every row has the old fields (id, created_ms, kind, depth, event, lat, lon, acc_m, src, map_right, cell_ft, nag_ft, han_ft, han_fast_ft, status).
//   Flood-survey rows (survey = 1, from /flood-survey and the map's "Tell us how deep it got") are past_wet / past_dry rows with these extras:
//     street_m      deepest water on the street outside, metres: the visitor's feet number if given, else the body level (lib/flood3dReports.ts LEVEL_M)
//     inside_m      deepest water inside the house, metres (null: not asked, or no water inside; inside = "no" means dry floor)
//     steps         floor is N steps above the road (null = not answered); about 0.17 m each: floor_above_road_m = steps * 0.17
//     flood_month   "YYYY-MM" of the flood (required in the survey since 28 Oct 2026; null on older rows). Group and gate by it, not by event alone:
//                   ads can bring answers about old floods, and a spot needs >= 2 people for the same flood month.
//     peak_day      "YYYY-MM-DD" when it was deepest (null = not answered), peak_part night | morning | afternoon | evening
//     spot_n        independent reports at the same ~100 m spot for the same flood (distinct `person` hashes; the hash is per person per day, so one
//                   person on two days counts twice: an upper bound)
//     usable        spot_n >= 2. Evidence gate: prep.py must ignore street_m / inside_m / steps unless usable is true. A single report may still
//                   serve as the wet/dry bound it always was.
//   Use: a wet spot at the named flood's stage S (Nagalagam ft) had water at least street_m deep over the ground there, so ground level at
//   the spot is about (flood level at S) - street_m; inside_m + steps tell whether the floor was reached. Never put survey answers into the live
//   map without a fit run and the usual false-alarm check.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const out = process.argv[2];
if (!out) { console.error("usage: node scripts/flood3d/reports-export.mjs <out.json>"); process.exit(1); }

const FT = 0.3048;
const LEVEL_M = { ankle: 0.1, knee: 0.45, waist: 0.95, chest: 1.3, head: 1.7 }; // same as lib/flood3dReports.ts LEVEL_M
const OLD = "id, created_ms, kind, depth, event, lat, lon, lat3, lon3, acc_m, src, map_right, cell_ft, nag_ft, han_ft, han_fast_ft, status";
const NEW = "survey, street_level, street_ft, inside, inside_level, inside_ft, steps_above_road, peak_day, peak_part, flood_month, person_day AS person";
const query = (cols) => {
  const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command",
    `SELECT ${cols} FROM flood3d_reports WHERE status != 'test' ORDER BY id LIMIT 5000`],
    { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "83e812aa5ee674fe01ce3a9eb1e04cbe" }, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
};
let rows;
try { rows = query(`${OLD}, ${NEW}`); }
catch { rows = query(OLD).map((r) => ({ ...r, survey: 0 })); console.error("survey columns not in D1 yet (no survey answers so far): exported the old fields only"); }

const m = (level, ft) => (ft != null ? Math.round(ft * FT * 100) / 100 : level in LEVEL_M ? LEVEL_M[level] : null);
for (const r of rows) {
  r.street_m = r.survey ? m(r.street_level, r.street_ft) : null;
  r.inside_m = r.survey && r.inside === "yes" ? m(r.inside_level, r.inside_ft) : null;
  r.steps = r.survey ? r.steps_above_road ?? null : null;
  r.peak_day = r.peak_day ?? null; r.peak_part = r.peak_part ?? null; r.flood_month = r.flood_month ?? null;
}
// evidence gate: independent people at the same ~100 m spot and flood
const people = new Map();
for (const r of rows) if (r.survey) { const k = `${r.lat3},${r.lon3},${r.event},${r.flood_month}`; (people.get(k) ?? people.set(k, new Set()).get(k)).add(r.person); }
for (const r of rows) { r.spot_n = r.survey ? people.get(`${r.lat3},${r.lon3},${r.event},${r.flood_month}`).size : null; r.usable = r.survey ? r.spot_n >= 2 : null; delete r.person; }

writeFileSync(out, JSON.stringify(rows));
const sv = rows.filter((r) => r.survey);
console.log(`${rows.length} reports (${sv.length} survey answers, ${sv.filter((r) => r.usable).length} at spots with 2+ independent reports) -> ${out} (private: exact positions)`);
