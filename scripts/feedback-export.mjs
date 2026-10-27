#!/usr/bin/env node
// Owner's private feedback dashboard (a claude.ai artifact): exports forecast_feedback and street_flood_reports from D1 as two
// JSON files the dashboard reads. Read-only: two small queries (~200 rows read) plus one indexed (station, ts) range query per located
// "worse" answer (a handful of rows each). Leaves out IP hashes and tokens; locations only as stored (rounded to 0.01 degree, about 1 km);
// notes are included because the dashboard is private to the owner. "Worse" answers also get the cross-check (lib/feedbackCheck.mjs):
// nearest gauge, satellite rain, what the gauge did in the next 3 h, and a verdict `check`. Needs one fetch of stations.json from the
// `data` branch (gauge coordinates). Usage: node scripts/feedback-export.mjs <outDir>
// Needs wrangler's login (CLOUDFLARE_ACCOUNT_ID is set below; no API token in the repo).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkWorse, exportColumns, stationInfo } from "../lib/feedbackCheck.mjs";

const out = process.argv[2];
if (!out) { console.error("usage: node scripts/feedback-export.mjs <outDir>"); process.exit(1); }
mkdirSync(out, { recursive: true });
const d1all = (sql) => {
  const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command", sql], {
    encoding: "utf8", maxBuffer: 64 << 20, cwd: out, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "83e812aa5ee674fe01ce3a9eb1e04cbe" },
  });
  return JSON.parse(raw.slice(raw.indexOf("["))).map((x) => x.results);
};
const d1 = (sql) => d1all(sql)[0];
const t = (ms) => new Date(ms + 19_800_000).toISOString().slice(0, 16).replace("T", " "); // Sri Lanka time, UTC+5:30

// water_at, place_pick, rain_* are added by the route on the first answer after they shipped: until then export without them (columns stay null)
const BASE = "id, created_ms, day, page, station, town, answer, river_obs, rain_obs, note, note_tags, dist_km, shown_tier, shown_level, shown_next_ft, shown_dir, lang, device";
const fbSql = (level) => `SELECT ${BASE}${level >= 1 ? ", water_at" : ""}${level >= 2 ? ", lat_r, lon_r, place_pick, rain_3h_mm, rain_24h_mm" : ""} FROM forecast_feedback ORDER BY created_ms`;
let fbRows;
for (const level of [2, 1, 0]) {
  try { fbRows = d1(fbSql(level)); break; } catch (e) { if (level === 0 || !/no such column/i.test(`${e?.message ?? e} ${e?.stdout ?? ""}`)) throw e; }
}
const stationsRaw = await (await fetch(process.env.STATIONS_URL || "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/stations.json", { signal: AbortSignal.timeout(15_000) })).json();
const stations = stationsRaw.map(stationInfo);
const byName = new Map(stations.map((s) => [s.station, s]));
// what each located "worse" answer's gauge did in the next 3 hours: one tiny indexed range query each, batched into one call
const located = fbRows.filter((r) => r.answer === "worse" && r.lat_r != null && byName.has(r.station));
const obsOf = new Map();
if (located.length) {
  const res = d1all(located.map((r) => `SELECT ts, level FROM observations WHERE station = '${String(r.station).replace(/'/g, "''")}' AND ts > ${r.created_ms - 90 * 60_000} AND ts <= ${r.created_ms + 3 * 3_600_000}`).join("; "));
  located.forEach((r, i) => obsOf.set(r.id, (res[i] ?? []).map((o) => ({ ts: o.ts, v: o.level == null ? NaN : o.level * byName.get(r.station).factor }))));
}
const fb = fbRows.map((r) => {
  const g = byName.get(r.station);
  const c = r.answer === "worse" && r.lat_r != null && g
    ? checkWorse({ loc: { lat: r.lat_r, lon: r.lon_r }, shown: g, stations, rain: { mm3h: r.rain_3h_mm, mm24h: r.rain_24h_mm }, obs: obsOf.get(r.id) ?? [], createdMs: r.created_ms, base: r.shown_level, marks: g, now: Date.now() })
    : null;
  return { id: r.id, time: t(r.created_ms), day: r.day, page: r.page, place: r.page === "town" ? r.town : r.station, station: r.station, town: r.town, answer: r.answer,
    river_seen: r.river_obs, water_at: r.water_at ?? null, rain_seen: r.rain_obs, note: r.note, tags: r.note_tags, dist_km: r.dist_km, shown_step: r.shown_tier, shown_level: r.shown_level,
    shown_next_ft: r.shown_next_ft, shown_trend: r.shown_dir, lang: r.lang, device: r.device, ...exportColumns(r, c) };
});
const sr = d1("SELECT id, created_ms, day, town, answer, when_hint, lang FROM street_flood_reports ORDER BY created_ms")
  .map((r) => ({ id: r.id, time: t(r.created_ms), day: r.day, town: r.town, answer: r.answer, when: r.when_hint, lang: r.lang }));

writeFileSync(path.join(out, "feedback.json"), JSON.stringify(fb));
writeFileSync(path.join(out, "street-reports.json"), JSON.stringify(sr));
console.log(JSON.stringify({ feedback: fb.length, street_reports: sr.length, at: new Date().toISOString() }));
