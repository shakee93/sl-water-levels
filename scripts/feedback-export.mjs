#!/usr/bin/env node
// Owner's private feedback dashboard (a claude.ai artifact): exports forecast_feedback and street_flood_reports from D1 as two
// JSON files the dashboard reads. Read-only, two small queries (~200 rows read). Leaves out IP hashes, tokens and locations;
// notes are included because the dashboard is private to the owner. Usage: node scripts/feedback-export.mjs <outDir>
// Needs wrangler's login (CLOUDFLARE_ACCOUNT_ID is set below; no API token in the repo).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = process.argv[2];
if (!out) { console.error("usage: node scripts/feedback-export.mjs <outDir>"); process.exit(1); }
mkdirSync(out, { recursive: true });
const d1 = (sql) => {
  const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command", sql], {
    encoding: "utf8", maxBuffer: 64 << 20, cwd: out, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "83e812aa5ee674fe01ce3a9eb1e04cbe" },
  });
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
};
const t = (ms) => new Date(ms + 19_800_000).toISOString().slice(0, 16).replace("T", " "); // Sri Lanka time, UTC+5:30

const fb = d1("SELECT id, created_ms, day, page, station, town, answer, river_obs, rain_obs, note, note_tags, dist_km, shown_tier, shown_level, shown_next_ft, shown_dir, lang, device FROM forecast_feedback ORDER BY created_ms")
  .map((r) => ({ id: r.id, time: t(r.created_ms), day: r.day, page: r.page, place: r.page === "town" ? r.town : r.station, station: r.station, town: r.town, answer: r.answer,
    river_seen: r.river_obs, rain_seen: r.rain_obs, note: r.note, tags: r.note_tags, dist_km: r.dist_km, shown_step: r.shown_tier, shown_level: r.shown_level,
    shown_next_ft: r.shown_next_ft, shown_trend: r.shown_dir, lang: r.lang, device: r.device }));
const sr = d1("SELECT id, created_ms, day, town, answer, when_hint, lang FROM street_flood_reports ORDER BY created_ms")
  .map((r) => ({ id: r.id, time: t(r.created_ms), day: r.day, town: r.town, answer: r.answer, when: r.when_hint, lang: r.lang }));

writeFileSync(path.join(out, "feedback.json"), JSON.stringify(fb));
writeFileSync(path.join(out, "street-reports.json"), JSON.stringify(sr));
console.log(JSON.stringify({ feedback: fb.length, street_reports: sr.length, at: new Date().toISOString() }));
