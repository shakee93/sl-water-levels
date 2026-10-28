#!/usr/bin/env node
// OWNER-SIDE ONLY. Exports EVERY flood-survey / map report from D1 (flood3d_reports, all of Sri Lanka, exact positions) with the context stamped on each row,
// for finding patterns (where, when, how deep, at what river level and rain). The file holds exact coordinates: keep it in the scratchpad or a folder of your
// own, never commit it, never copy it to the public data branch. scripts/flood3d/reports-export.mjs stays corridor-only for the 3D map's fit.
// Read-only, one query (id order, at most 20000 rows). Usage: node scripts/reports-export-all.mjs <out.csv|out.json>   (needs wrangler's login, like feedback-export)
//
// Columns: id, time (Colombo), day, kind (water_now / dry_now = "now"; past_wet / past_dry = past flood), event, flood_month, lat, lon, acc_m, src (gps | pin), in_corridor (Kelani
//   corridor = the 3D map's area), district (nearest gazetteer town's), page + target (the page it was filed from: town / station / survey / lab and its slug or gauge),
//   street_m / inside_m (metres, from the visitor's feet number or the body level), steps_above_road, peak_day / peak_part, status, person (per-day hash: counts people),
//   nag_ft / han_ft (Nagalagam / Hanwella when filed), gauge_name / gauge_km / gauge_level / gauge_unit / gauge_tier / gauge_time / gauge_rate3h / gauge_rain6h
//   (nearest river gauge with a reading, within 80 km: its level in its own unit, the official step from the level alone, reading time, change per hour over 3 h, rain over 6 h),
//   rain_gauge / rain_km / rain_mm24 (nearest ground rain gauge with a record under 3 h old within 5 km, its 24 h total). Empty = not stamped (older row, slow cache, nothing near).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { inCorridor } from "../lib/flood3dReports.ts";

const out = process.argv[2];
if (!out) { console.error("usage: node scripts/reports-export-all.mjs <out.csv|out.json>"); process.exit(1); }
const FT = 0.3048;
const LEVEL_M = { ankle: 0.1, knee: 0.45, waist: 0.95, chest: 1.3, head: 1.7 }; // same as lib/flood3dReports.ts LEVEL_M
const BASE = "id, created_ms, day, kind, depth, event, lat, lon, acc_m, src, map_right, cell_ft, nag_ft, han_ft, han_fast_ft, status, person_day AS person";
const SURVEY = "survey, street_level, street_ft, inside, inside_level, inside_ft, steps_above_road, peak_day, peak_part, flood_month";
const CONTEXT = "page, target, district, gauge_name, gauge_km, gauge_level, gauge_unit, gauge_tier, gauge_ts, gauge_rate3h, gauge_rain6h, rain_gauge, rain_km, rain_mm24";
const query = (cols) => {
  const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command", `SELECT ${cols} FROM flood3d_reports WHERE status != 'test' ORDER BY id LIMIT 20000`],
    { encoding: "utf8", maxBuffer: 256 << 20, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "83e812aa5ee674fe01ce3a9eb1e04cbe" }, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
};
let rows, have = "survey + context";
try { rows = query(`${BASE}, ${SURVEY}, ${CONTEXT}`); }
catch { try { rows = query(`${BASE}, ${SURVEY}`); have = "survey only (no context columns in D1 yet)"; } catch { rows = query(BASE).map((r) => ({ ...r, survey: 0 })); have = "old fields only"; } }

const m = (level, ft) => (ft != null ? Math.round(ft * FT * 100) / 100 : level in LEVEL_M ? LEVEL_M[level] : null);
const colombo = (ms) => new Date(ms + 5.5 * 3_600_000).toISOString().replace("T", " ").slice(0, 16);
const table = rows.map((r) => ({
  id: r.id, time: colombo(r.created_ms), day: r.day, kind: r.kind, event: r.event ?? "", flood_month: r.flood_month ?? "", lat: r.lat, lon: r.lon, acc_m: r.acc_m ?? "", src: r.src,
  in_corridor: inCorridor(r.lat, r.lon), district: r.district ?? "", page: r.page ?? "", target: r.target ?? "",
  survey: r.survey ? 1 : 0, depth: r.depth ?? "", street_level: r.street_level ?? "", street_m: r.survey ? m(r.street_level, r.street_ft) ?? "" : "",
  inside: r.inside ?? "", inside_m: r.survey && r.inside === "yes" ? m(r.inside_level, r.inside_ft) ?? "" : "", steps_above_road: r.steps_above_road ?? "", peak_day: r.peak_day ?? "", peak_part: r.peak_part ?? "",
  status: r.status, person: r.person ?? "", nag_ft: r.nag_ft ?? "", han_ft: r.han_ft ?? "",
  gauge_name: r.gauge_name ?? "", gauge_km: r.gauge_km ?? "", gauge_level: r.gauge_level ?? "", gauge_unit: r.gauge_unit ?? "", gauge_tier: r.gauge_tier ?? "", gauge_time: r.gauge_ts ? colombo(r.gauge_ts) : "",
  gauge_rate3h: r.gauge_rate3h ?? "", gauge_rain6h: r.gauge_rain6h ?? "", rain_gauge: r.rain_gauge ?? "", rain_km: r.rain_km ?? "", rain_mm24: r.rain_mm24 ?? "",
}));
const cell = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const keys = Object.keys(table[0] ?? { id: 0 });
writeFileSync(out, out.endsWith(".json") ? JSON.stringify(table) : [keys.join(","), ...table.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n") + "\n");
const outside = table.filter((r) => !r.in_corridor).length;
console.log(`${table.length} reports (${outside} outside the Kelani corridor; columns: ${have}) -> ${out} (private: exact positions, never commit)`);
