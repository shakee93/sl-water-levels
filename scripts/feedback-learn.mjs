#!/usr/bin/env node
// The learning loop: joins every "Does this match what you see?" answer and street-flood report with what really happened
// (gauge level and trend at that moment, the forecast that was shown and how it ended, the town's satellite rain) and writes a few
// bounded, evidence-gated numbers to learned/town-params.json on the `data` branch. Maths: lib/learnedParams.mjs (tests:
// scripts/feedback-learn.test.mts). What each number may be used for is stated there and in DOCS.md "Learning from feedback":
// the verdict STEP is never touched.
//
// usage: node --experimental-strip-types scripts/feedback-learn.mjs <archiveDir>   (once a day: .github/workflows/feedback-learn.yml)
//   needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (wrangler via npx) and optionally SLACK_WEBHOOK_URL.
// Flags: --dry-run     read D1 (read-only), print the JSON it would write and the Slack text, write and send nothing
//        --fixture <f> use evidence from a JSON file instead of D1 (offline tests; implies --dry-run)
//
// D1 budget (the 5M rows-read/day limit was hit on 26 Oct): one run a day reads the two feedback tables (hundreds of rows), the
// observations table once (~5k rows, 7 days kept), the last 12 h of forecast crossings (official marks), 21 days of forecast points for
// horizons 1/3/6 h and a few street_rain_log windows by primary key. About 30k rows, no scan of curw_levels or any other large table,
// and never the forecast_verification view (its per-point subquery read 700k rows for 3.6k points).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { PLACES } from "../lib/places.ts";
import { HORIZONS, buildParams, colomboDay, learnedLines, nearest } from "../lib/learnedParams.mjs";

const args = process.argv.slice(2);
const FIXTURE = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : null;
const DRY = args.includes("--dry-run") || !!FIXTURE;
const outDir = args.find((a) => !a.startsWith("--") && a !== FIXTURE);
if (!outDir && !DRY) { console.error("usage: node --experimental-strip-types scripts/feedback-learn.mjs <archiveDir> [--dry-run]"); process.exit(1); }
const SLACK = process.env.SLACK_WEBHOOK_URL || "";
const NOW = Date.now();
const DAY = 864e5, HOUR = 3_600_000, FT = 0.3048;
const SINCE = NOW - 120 * DAY;          // answers and reports considered
const BACKTEST_SINCE = NOW - 21 * DAY;  // forecast points scored
/** Commit 961440f (27 Oct 2026 11:16 +05:30): station-page answers logged before it stored the raw gauge tier, not the step shown. */
const SHOWN_TIER_FIXED_MS = 1793080016000;

function d1(sql) {
  const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 128 << 20 });
  return JSON.parse(raw.slice(raw.indexOf("["))).map((x) => x.results);
}
const q = (v) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

function gather() {
  const feedback = d1(`SELECT created_ms, day, page, station, town, answer, river_obs, shown_tier, shown_level, shown_next_ft, shown_dir, ip_hash FROM forecast_feedback WHERE created_ms >= ${SINCE} ORDER BY created_ms`)[0];
  const reports = d1(`SELECT created_ms, day, town, answer, ip_hash FROM street_flood_reports WHERE created_ms >= ${SINCE} ORDER BY created_ms`)[0];
  const marksRaw = d1(`SELECT r.station, r.unit, c.threshold, MAX(c.level) AS level FROM forecast_runs r JOIN forecast_crossings c ON c.run_id = r.id WHERE r.issued_at >= ${NOW - 12 * HOUR} GROUP BY r.station, r.unit, c.threshold`)[0];
  const observations = d1(`SELECT station, ts, level FROM observations WHERE ts >= ${NOW - 8 * DAY}`)[0];
  const pts = d1(`SELECT r.station, r.issued_at, r.unit, r.current_level AS c, p.horizon_h AS h, p.target_ts AS t, p.level AS p FROM forecast_runs r JOIN forecast_points p ON p.run_id = r.id WHERE r.issued_at >= ${BACKTEST_SINCE} AND r.method = 'model' AND p.horizon_h IN (${HORIZONS.join(",")})`)[0];
  // satellite rain for the zone of each reported town, one primary-key window per zone and report day
  const placeOf = (slug) => PLACES.find((p) => p.slug === slug);
  const wins = new Map();
  for (const r of reports) {
    const z = placeOf(r.town)?.rainZone;
    if (z) wins.set(`${z}|${r.day}`, [z, Math.floor(r.created_ms / DAY) * DAY - 3 * HOUR, Math.floor(r.created_ms / DAY) * DAY + DAY + 3 * HOUR]);
  }
  const rainLog = [];
  const list = [...wins.values()].slice(-40);
  for (let i = 0; i < list.length; i += 20) {
    const res = d1(list.slice(i, i + 20).map(([z, a, b]) => `SELECT zone, data_end_ms, mm24h_clipped FROM street_rain_log WHERE zone = ${q(z)} AND data_end_ms BETWEEN ${a} AND ${b}`).join("; "));
    for (const rows of res) rainLog.push(...rows);
  }
  return { feedback, reports, marksRaw, observations, pts, rainLog };
}

const ev = FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf8")) : gather();

// ---- join
const unitOf = {}, marks = {};
for (const m of [...ev.marksRaw, ...ev.pts]) if (m.unit === "ft" || m.unit === "m") unitOf[m.station] = m.unit;
const toFt = (st, v) => (v == null || !unitOf[st] ? null : unitOf[st] === "m" ? v / FT : v);
for (const m of ev.marksRaw) {
  const ft = toFt(m.station, m.level);
  if (ft != null && (m.threshold === "minor" || m.threshold === "alert")) (marks[m.station] ??= {})[m.threshold === "minor" ? "minorFt" : "alertFt"] = Math.round(ft * 100) / 100;
}
const series = {};
for (const o of ev.observations) {
  const v = toFt(o.station, o.level);
  if (v != null) (series[o.station] ??= []).push({ ts: o.ts, v });
}
for (const s of Object.values(series)) s.sort((a, b) => a.ts - b.ts);
const placeOf = (slug) => PLACES.find((p) => p.slug === slug);

const answers = [], streetEvidence = [];
for (const f of ev.feedback) {
  const key = `${f.ip_hash}|${f.day}`;
  let err1h = null;
  if (f.shown_next_ft != null && f.station && series[f.station]) {
    const o = nearest(series[f.station], f.created_ms + HOUR, 40 * 60_000);
    if (o) err1h = Math.round((o.v - f.shown_next_ft) * 100) / 100;
  }
  answers.push({ station: f.station, town: f.town, answer: f.answer, dir: f.shown_dir, riverObs: f.river_obs, tier: f.shown_tier, tierOk: f.page === "town" || f.created_ms >= SHOWN_TIER_FIXED_MS, err1h, day: f.day, key });
  // "what is the river/canal near you doing": flooding roads or homes = street water; normal / high / over its banks = none
  if (f.station && f.shown_level != null && f.river_obs) streetEvidence.push({ station: f.station, level: f.shown_level, wet: f.river_obs === "flooding", day: f.day, key: `${key}|${f.station}` });
}
const rainEvidence = [], reports = [];
const rainByZone = {};
for (const r of ev.rainLog) if (r.mm24h_clipped != null) (rainByZone[r.zone] ??= []).push({ ts: r.data_end_ms, v: r.mm24h_clipped });
for (const r of ev.reports) {
  reports.push({ town: r.town, answer: r.answer, day: r.day });
  const place = placeOf(r.town), wet = r.answer === "deep" || r.answer === "little";
  const gauge = place?.stations.find((s) => series[s]?.length);
  const key = `${r.ip_hash}|${r.day}`;
  if (gauge) {
    const o = nearest(series[gauge], r.created_ms, 90 * 60_000);
    if (o) streetEvidence.push({ station: gauge, level: o.v, wet, day: r.day, key: `${key}|${gauge}` });
  }
  if (place?.rainZone && rainByZone[place.rainZone]) {
    const o = nearest(rainByZone[place.rainZone], r.created_ms, 2 * HOUR);
    if (o) rainEvidence.push({ zone: place.rainZone, mm: o.v, wet, day: r.day, key: `${key}|${place.rainZone}` });
  }
}
const backtestRows = [];
for (const p of ev.pts) {
  const o = series[p.station] && nearest(series[p.station], p.t, 40 * 60_000);
  const c = toFt(p.station, p.c), pf = toFt(p.station, p.p);
  if (o && c != null && pf != null) backtestRows.push({ st: p.station, t: p.issued_at, h: p.h, c, p: pf, y: o.v });
}

const params = buildParams({
  now: NOW, answers, streetEvidence, rainEvidence, reports, marks, backtestRows,
  window: backtestRows.length ? { from: colomboDay(Math.min(...backtestRows.map((r) => r.t))), to: colomboDay(Math.max(...backtestRows.map((r) => r.t))), points: backtestRows.length } : null,
});

// ---- write, and tell the owner about new values
const file = outDir ? path.join(outDir, "learned/town-params.json") : null;
let before = null;
try { if (file && existsSync(file)) before = JSON.parse(readFileSync(file, "utf8")); } catch {}
const news = [];
for (const [name, s] of Object.entries(params.stations)) {
  const old = before?.stations?.[name]?.streetLevel;
  if (s.streetLevel && (!old || Math.abs(old.ft - s.streetLevel.ft) >= 0.5)) news.push(`${name}: people report road water from ~${s.streetLevel.ft.toFixed(1)} ft (${s.streetLevel.n} reports, ${s.streetLevel.days} days)${old ? `, was ${old.ft.toFixed(1)} ft` : ""}`);
}
for (const [zone, z] of Object.entries(params.zones)) {
  const old = before?.zones?.[zone]?.streetRain;
  if (z.streetRain && (!old || old.possibleMm !== z.streetRain.possibleMm)) news.push(`${zone}: street water reported from ~${z.streetRain.possibleMm} mm of rain in 24 h (${z.streetRain.n} reports, ${z.streetRain.days} days)`);
}
const text = news.length ? `*Learned from visitors' answers:* ${news.join("; ")}. Notes and heads-ups only; the verdict step is unchanged. ${process.env.SITE_URL || "https://waterlevels.lk"}/about` : "";

if (DRY) {
  console.log(JSON.stringify(params, null, 2));
  console.log("\n--- digest lines ---\n" + learnedLines(params).join("\n"));
  if (text) console.log(`\n[dry-run] Slack:\n${text}`);
  process.exit(0);
}
mkdirSync(path.dirname(file), { recursive: true });
const same = before && JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...params, updatedAt: 0 });
if (!same) writeFileSync(file, JSON.stringify(params, null, 2) + "\n");
console.log(same ? "learned/town-params.json unchanged" : `wrote ${file}`);
if (text && SLACK) {
  try {
    const res = await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) console.warn(`Slack post failed: HTTP ${res.status}`);
  } catch (e) {
    console.warn(`Slack post failed: ${e instanceof Error ? e.name : "error"}`);
  }
}
