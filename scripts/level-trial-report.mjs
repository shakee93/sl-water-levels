#!/usr/bin/env node
// Nightly report of the level-model hidden trial -> kpi/level-trial/latest.json and kpi/level-trial/days/YYYY-MM-DD.json on the `data` branch.
// MEASURES ONLY. Runs as the LAST, isolated step of the nightly forecast scoreboard workflow, after the archive and the KPIs: it can never fail that job
// (every error is caught and printed as a warning, the step exits 0, and a hard timer ends it after --budget-sec, default 150).
//
// usage: node scripts/level-trial-report.mjs <archiveDir> [--asof YYYY-MM-DD] [--window 30] [--d1-days 2] [--no-d1] [--budget-sec 150]
//   Reads forecasts/YYYY/YYYY-MM-DD.jsonl of the last --window Colombo days up to --asof (default yesterday): pooled / per-gauge skill of the trial and of live
//   on the same runs, range coverage (own and the replayed online layer), coverage of live runs, rain days (lib/levelTrial/report.mjs).
//   With CLOUDFLARE_API_TOKEN it also reads D1 for the last --d1-days days: forecast_trial_log (skip reasons, history completeness, lag, weather age) and
//   forecast_inputs (rain days). Those counts are kept in the day files, so the 30-day figures add up from them; without D1 the day files already there are used.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectRows } from "../lib/d1Sql.mjs";
import { addDays, colomboDay, dayEnd, dayStart, daysBetween } from "../lib/forecastScoreboard.mjs";
import { SCHEMA, VARIANT, buildReport, coverageOf, mergeLogs, rainOfDay, summariseLog } from "../lib/levelTrial/report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const out = args[0];
if (!out || out.startsWith("--")) {
  console.error("usage: node scripts/level-trial-report.mjs <archiveDir> [--asof D] [--window 30] [--d1-days 2] [--no-d1] [--budget-sec 150]");
  process.exit(0); // a mistake in the call never fails the nightly job
}
const hard = setTimeout(() => { console.log("::warning::level trial report: out of time, nothing more written"); process.exit(0); }, Number(opt("--budget-sec") ?? 150) * 1000);
hard.unref();

const writeJson = (file, obj) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 1) + "\n");
  renameSync(tmp, file);
};
const readJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; } };

async function main() {
  const today = colomboDay(Date.now());
  const asOf = opt("--asof") ?? addDays(today, -1);
  const windowDays = Number(opt("--window") ?? 30);
  const from = addDays(asOf, -(windowDays - 1));
  const model = JSON.parse(readFileSync(path.join(here, "../lib/model/lvl-lin-d4.json"), "utf8"));
  const gauges = Object.keys(model.g);
  const dir = path.join(out, "kpi", "level-trial");

  const days = daysBetween(from, asOf).filter((d) => existsSync(path.join(out, "forecasts", d.slice(0, 4), `${d}.jsonl`)));
  if (!days.length) { console.log(`level trial report: no archive files between ${from} and ${asOf}`); return; }
  const byDay = {};
  const lines = [];
  for (const d of days) {
    const L = readFileSync(path.join(out, "forecasts", d.slice(0, 4), `${d}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    byDay[d] = L;
    lines.push(...L);
  }

  // D1 for the newest days only (the rest is in the day files from earlier nights)
  const d1Days = args.includes("--no-d1") || !process.env.CLOUDFLARE_API_TOKEN ? [] : days.slice(-Number(opt("--d1-days") ?? 2));
  const fresh = {};
  for (const d of d1Days) {
    const a = dayStart(d), b = dayEnd(d);
    const f = { log: null, rain: null };
    try {
      const rows = await selectRows("SELECT verdict, reason, flags, n_hist, gap_h, lag_h, weather_age_min FROM forecast_trial_log WHERE variant = ? AND issued_at >= ? AND issued_at < ?", [VARIANT, a, b]);
      f.log = summariseLog(rows);
    } catch (e) { console.log(`::warning::level trial report: trial log of ${d} not read (${String(e && e.message ? e.message : e).slice(0, 100)})`); }
    try {
      const rows = await selectRows("SELECT station, issued_at, blob FROM forecast_inputs WHERE issued_at >= ? AND issued_at < ? AND blob IS NOT NULL", [a, b]);
      f.rain = rainOfDay(rows.filter((r) => gauges.includes(r.station)));
    } catch (e) { console.log(`::warning::level trial report: inputs of ${d} not read (${String(e && e.message ? e.message : e).slice(0, 100)})`); }
    fresh[d] = f;
  }

  // day files: this night's counts where D1 was read, else what an earlier night wrote
  const dayInfo = {};
  for (const d of days) {
    const file = path.join(dir, "days", `${d}.json`);
    const old = readJson(file);
    const f = fresh[d] ?? { log: null, rain: null };
    const cv = coverageOf(byDay[d], { gauges });
    const rep = buildReport({ lines: byDay[d], gauges, window: { from: d, to: d, days: 1 } });
    const info = {
      schema: SCHEMA + "/day", day: d, generatedAt: new Date().toISOString(),
      coverage: { liveRuns: cv.liveRuns, withTrial: cv.withTrial, withDegraded: cv.withDegraded, sharePct: cv.sharePct },
      pooled: Object.fromEntries(Object.entries(rep.pooled).map(([h, c]) => [h, { n: c.n, trialSkillPct: c.trialSkillPct, liveSkillPct: c.liveSkillPct, diffPts: c.diffPts }])),
      log: f.log ?? old?.log ?? null,
      rain: f.rain ?? old?.rain ?? null,
    };
    dayInfo[d] = info;
    if (cv.withTrial || cv.withDegraded || info.log || old) writeJson(file, info); // a day with nothing yet and no earlier file is not written
  }

  const rep = buildReport({ lines, gauges, dayInfo, window: { from: days[0], to: days[days.length - 1], days: days.length, asOf } });
  const logs = mergeLogs(days.map((d) => dayInfo[d].log));
  const latest = { ...rep, generatedAt: new Date().toISOString(), log: { ...logs, daysWithLog: days.filter((d) => dayInfo[d].log).length, daysWithoutLog: days.filter((d) => !dayInfo[d].log) } };
  writeJson(path.join(dir, "latest.json"), latest);
  const p = rep.pooled;
  console.log(`level trial report: ${days.length} days, ${rep.coverage.liveRuns} live runs, trial on ${rep.coverage.withTrial} (${rep.coverage.sharePct}%), degraded ${rep.coverage.withDegraded}; paired rows ${rep.pairedRows}; ` +
    ["h1", "h3", "h6", "h12", "h24"].map((h) => `${h}: ${p[h] ? `${p[h].trialSkillPct} vs ${p[h].liveSkillPct}` : "-"}`).join(", ") + ` -> ${dir}`);
}

try {
  await main();
} catch (e) {
  console.log(`::warning::level trial report failed (the KPI job is not affected): ${e instanceof Error ? e.message : e}`);
}
process.exit(0);
