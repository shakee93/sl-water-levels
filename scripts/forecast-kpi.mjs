#!/usr/bin/env node
// Nightly forecast KPIs from the archive -> kpi/latest.json, kpi/days/YYYY-MM-DD.json and kpi/history.csv on the `data` branch.
//
// usage: node scripts/forecast-kpi.mjs <archiveDir> [--asof YYYY-MM-DD] [--window 30] [--now ISO]
//   Reads forecasts/YYYY/YYYY-MM-DD.jsonl and .readings.json (scripts/forecast-archive.mjs) for the last --window Colombo days up to --asof
//   (default: yesterday), and writes under <archiveDir>/kpi/. MEASURES ONLY. Method and targets: lib/forecastKpi.mjs, DOCS.md "Forecast KPIs".
//   "People agree" (KPI 10): with CLOUDFLARE_API_TOKEN the answers come from D1 (forecast_feedback, per day and per version); without it the
//   published aggregate in <archiveDir>/accuracy/latest.json is used (30-day total only).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, colomboDay, daysBetween } from "../lib/forecastScoreboard.mjs";
import { buildContext, historyRows, kpiSet, mergeReadings, summarise, upsertHistory, variantsOf } from "../lib/forecastKpi.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
if (!out || out.startsWith("--")) {
  console.error("usage: node scripts/forecast-kpi.mjs <archiveDir> [--asof D] [--window 30] [--now ISO]");
  process.exit(1);
}
const now = opt("--now") ? Date.parse(opt("--now")) : Date.now();
const today = colomboDay(now);
const asOf = opt("--asof") ?? addDays(today, -1);
const windowDays = Number(opt("--window") ?? 30);
const from = addDays(asOf, -(windowDays - 1));
const versions = JSON.parse(readFileSync(path.join(here, "../lib/model/versions.json"), "utf8")).versions;

const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const days = daysBetween(from, asOf).filter((d) => existsSync(path.join(out, "forecasts", d.slice(0, 4), `${d}.jsonl`)));
if (!days.length) { console.error(`no archive files between ${from} and ${asOf}`); process.exit(1); }
const lines = [], readingFiles = [];
for (const d of days) {
  const dir = path.join(out, "forecasts", d.slice(0, 4));
  lines.push(...readFileSync(path.join(dir, `${d}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const r = readJson(path.join(dir, `${d}.readings.json`));
  if (r) readingFiles.push(r);
}
const withReadings = days.filter((d) => existsSync(path.join(out, "forecasts", d.slice(0, 4), `${d}.readings.json`)));

// ---- feedback answers (KPI 10)
let feedback = null, fallback = null, feedbackSource = "none";
if (process.env.CLOUDFLARE_API_TOKEN) {
  try {
    const { selectRows } = await import("../lib/d1Sql.mjs");
    const since = Date.parse(`${from}T00:00:00+05:30`);
    feedback = (await selectRows("SELECT created_ms, answer FROM forecast_feedback WHERE created_ms >= ?", [since])).map((r) => ({ ...r, day: colomboDay(r.created_ms) }));
    feedbackSource = "d1";
  } catch (e) {
    console.log(`feedback: D1 unavailable (${String(e.message).split("\n")[0].slice(0, 80)}), using the published aggregate`);
  }
}
if (!feedback) {
  const acc = readJson(path.join(out, "accuracy", "latest.json"));
  fallback = acc?.feedback?.overall ?? null;
  if (fallback) feedbackSource = "published";
}

const ctx = buildContext({ lines, readings: mergeReadings(readingFiles), versions });
const variants = variantsOf(lines);
const inDays = (set) => (x) => set.has(x.day);
const fbIn = (set) => (feedback ? feedback.filter((f) => set.has(f.day)) : null);

function scope(daySet, { sel = () => true, forDay = false } = {}) {
  const base = (r) => daySet.has(r.day) && sel(r);
  const events = ctx.events.filter(inDays(daySet));
  const live = kpiSet(ctx, { sel: base, events, feedback: fbIn(daySet), feedbackFallback: forDay ? null : fallback, today });
  return live;
}

const all = new Set(days);
const latest = {
  version: 1,
  generatedAt: new Date(now).toISOString(),
  asOf,
  window: { from: days[0], to: days[days.length - 1], days: days.length, requested: windowDays, daysWithReadings: withReadings.length },
  feedbackSource,
  runs: ctx.runs.length,
  events: ctx.events.filter(inDays(all)).length,
};
const liveKpis = scope(all);
latest.summary = summarise(liveKpis);
latest.kpis = liveKpis;

// storm days: any run that day with storm = 1 or a heavy-rain warning showing (the whole day, every gauge)
const stormDays = new Set(ctx.runs.filter((r) => r.stormDay && all.has(r.day)).map((r) => r.day));
latest.stormDays = [...stormDays].sort();
latest.storm = stormDays.size ? { days: latest.stormDays.length, kpis: scope(stormDays), summary: null } : null;
if (latest.storm) latest.storm.summary = summarise(latest.storm.kpis);

latest.variants = {};
for (const v of variants) latest.variants[v] = kpiSet(ctx, { sel: (r) => all.has(r.day), variant: v });

// per version: runs attributed to the version live at their issue time; its events/feedback by the days and times it was live
latest.versions = versions.map((v, i) => {
  const vruns = ctx.runs.filter((r) => all.has(r.day) && r.version === v.id);
  if (!vruns.length) return { id: v.id, name: v.name, from: v.from, what: v.what, runs: 0, kpis: null, summary: null };
  const t0 = Math.min(...vruns.map((r) => r.ts)), t1 = Math.max(...vruns.map((r) => r.ts));
  const vdays = new Set(vruns.map((r) => r.day));
  const events = ctx.events.filter((e) => e.ts >= t0 && e.ts <= t1 + 3 * 3_600_000);
  const fb = feedback ? feedback.filter((f) => f.created_ms >= t0 && f.created_ms <= t1) : null;
  const kpis = kpiSet(ctx, { sel: (r) => r.version === v.id && all.has(r.day), events, feedback: fb, feedbackFallback: null, today });
  return {
    id: v.id, name: v.name, from: v.from, what: v.what, runs: vruns.length, days: vdays.size,
    liveUntil: versions[i + 1]?.from ?? null, kpis, summary: summarise(kpis),
  };
});

mkdirSync(path.join(out, "kpi", "days"), { recursive: true });
writeFileSync(path.join(out, "kpi", "latest.json"), JSON.stringify(latest, null, 1) + "\n");

// ---- per day + history.csv (live and every shadow variant)
const histFile = path.join(out, "kpi", "history.csv");
let history = existsSync(histFile) ? readFileSync(histFile, "utf8") : "";
for (const d of days) {
  const ds = new Set([d]);
  const dayKpis = scope(ds, { forDay: true });
  const dayVariants = Object.fromEntries(variants.map((v) => [v, kpiSet(ctx, { sel: (r) => r.day === d, variant: v })]).filter(([, k]) => k.some((x) => x.n > 0)));
  const storm = ctx.runs.some((r) => r.day === d && r.stormDay);
  const file = { day: d, complete: d < today, storm, hasReadings: withReadings.includes(d), summary: summarise(dayKpis), kpis: dayKpis, variants: dayVariants };
  writeFileSync(path.join(out, "kpi", "days", `${d}.json`), JSON.stringify(file, null, 1) + "\n");
  const rows = [
    ...historyRows(d, storm ? "live-storm-day" : "live", dayKpis),
    ...Object.entries(dayVariants).flatMap(([v, k]) => historyRows(d, `variant:${v}`, k)),
  ];
  history = upsertHistory(history, d, rows);
}
writeFileSync(histFile, history);

const s = latest.summary;
console.log(`KPI ${latest.window.from}..${latest.window.to} (${latest.window.days} days, ${latest.runs} runs, ${latest.events} events): met ${s.met} of ${s.assessable} judged (${s.total} targets)`);
for (const k of liveKpis) console.log(`  ${String(k.id).padStart(2)} ${k.key.padEnd(12)} value ${k.value ?? "-"}${k.unit === "%" ? "%" : " " + k.unit} target ${k.targetText} | n ${k.n} | ${k.met == null ? "not enough cases" : k.met ? "MET" : "not met"}`);
