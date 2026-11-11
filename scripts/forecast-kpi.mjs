#!/usr/bin/env node
// Nightly forecast KPIs from the archive -> kpi/latest.json, kpi/days/YYYY-MM-DD.json and kpi/history.csv on the `data` branch (scoring spec 1, read by the
// public /forecast-accuracy page), plus the complete, reproducible record next to them (all of it measures only):
//   kpi/published/YYYY-MM-DD.json   that night's latest.json, kept as published (history is recomputed every night)
//   kpi/v2/latest.json              the same KPIs under the corrected scoring, spec 2 (lib/forecastKpi.mjs SPEC2); NOT read by the page
//   kpi/history-wide.csv            long format, both specs: all / storm / calm / variant:* / version:* / system:* scopes, with runs, clusters and baselines
//   kpi/events/YYYY-MM.jsonl        permanent event ledger (one line per gauge-step crossing, with why a miss missed), idempotent upsert
//   kpi/gauges/YYYY-MM-DD.csv       per-gauge daily table
//   kpi/archive-health.json         days missing in the last 30 for every data-branch folder the forecast depends on
//
// usage: node scripts/forecast-kpi.mjs <archiveDir> [--asof YYYY-MM-DD] [--window 30] [--now ISO]
//   Reads forecasts/YYYY/YYYY-MM-DD.jsonl and .readings.json (scripts/forecast-archive.mjs) for the last --window Colombo days up to --asof
//   (default: yesterday), and writes under <archiveDir>/kpi/. MEASURES ONLY. Method and targets: lib/forecastKpi.mjs, DOCS.md "Forecast KPIs".
//   "People agree" (KPI 10): with CLOUDFLARE_API_TOKEN the answers come from D1 (forecast_feedback, per day and per version); without it the
//   published aggregate in <archiveDir>/accuracy/latest.json is used (30-day total only).
//   Re-running the same night is idempotent (every file is rewritten from the archive, ledger lines are upserted). The spec 1 files come first; the extra
//   files are written afterwards and a failure there is a warning, never a failed night.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, colomboDay, daysBetween } from "../lib/forecastScoreboard.mjs";
import {
  SPEC1, SPEC2, buildContext, dayCoverage, dropInternal, gaugeTable, historyRows, kpiSet, ledgerKey, ledgerMonth, ledgerRecords, mergeReadings, missingDays, summarise, systemSet, systemsOf,
  upsertHistory, upsertLedger, upsertWide, upsertWideEdge, parseLedger, variantsOf, wideRows,
} from "../lib/forecastKpi.mjs";

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
const versionsText = readFileSync(path.join(here, "../lib/model/versions.json"), "utf8");
const versions = JSON.parse(versionsText).versions;

const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const requested = daysBetween(from, asOf);
const days = requested.filter((d) => existsSync(path.join(out, "forecasts", d.slice(0, 4), `${d}.jsonl`)));
if (!days.length) { console.error(`no archive files between ${from} and ${asOf}`); process.exit(1); }
const lines = [], readingFiles = [];
for (const d of days) {
  const dir = path.join(out, "forecasts", d.slice(0, 4));
  lines.push(...readFileSync(path.join(dir, `${d}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const r = readJson(path.join(dir, `${d}.readings.json`));
  if (r) readingFiles.push(r);
}
const withReadings = days.filter((d) => existsSync(path.join(out, "forecasts", d.slice(0, 4), `${d}.readings.json`)));

// ---- provenance: so a number can be traced to the code, the model versions and the clock that produced it
const codeSha = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.join(here, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; }
})();
/** The day's 24 h outcomes can no longer change once the day after tomorrow has started (the last run's 24 h are then all read). */
const outcomesFinalDay = (d) => d <= addDays(today, -2);
const provenance = (spec) => ({
  kpiSpec: spec.id,
  generatedAt: new Date(now).toISOString(),
  nowUsed: new Date(now).toISOString(),
  codeSha,
  versionsHash: createHash("sha256").update(versionsText).digest("hex").slice(0, 16),
  daysRequested: windowDays,
  daysFound: days.length,
  daysMissing: requested.filter((d) => !days.includes(d)),
});

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
const systems = systemsOf(lines);
const inDays = (set) => (x) => set.has(x.day);
const fbIn = (set) => (feedback ? feedback.filter((f) => set.has(f.day)) : null);
const all = new Set(days);

function scope(daySet, spec, { forDay = false } = {}) {
  const events = ctx.events.filter(inDays(daySet));
  return kpiSet(ctx, { sel: (r) => daySet.has(r.day), events, feedback: fbIn(daySet), feedbackFallback: forDay ? null : fallback, today, spec });
}

/** The window file for one spec: spec 1 is kpi/latest.json (what the page reads), spec 2 is kpi/v2/latest.json. */
function buildLatest(spec) {
  const prov = provenance(spec);
  const latest = {
    version: 1,
    generatedAt: prov.generatedAt,
    ...prov,
    outcomesFinal: Object.fromEntries(days.map((d) => [d, outcomesFinalDay(d)])),
    asOf,
    window: { from: days[0], to: days[days.length - 1], days: days.length, requested: windowDays, daysWithReadings: withReadings.length },
    feedbackSource,
    runs: ctx.runs.length,
    events: ctx.events.filter(inDays(all)).length,
  };
  const liveKpis = scope(all, spec);
  latest.summary = summarise(liveKpis);
  latest.kpis = liveKpis;

  // storm days: any run that day with storm = 1 or a heavy-rain warning showing (the whole day, every gauge)
  const stormDays = new Set(ctx.runs.filter((r) => r.stormDay && all.has(r.day)).map((r) => r.day));
  latest.stormDays = [...stormDays].sort();
  latest.storm = stormDays.size ? { days: latest.stormDays.length, kpis: scope(stormDays, spec), summary: null } : null;
  if (latest.storm) latest.storm.summary = summarise(latest.storm.kpis);

  const winEvents = ctx.events.filter(inDays(all));
  latest.variants = {};
  for (const v of variants) latest.variants[v] = kpiSet(ctx, { sel: (r) => all.has(r.day), variant: v, spec, ...(spec.lookAll ? { events: winEvents } : {}) });

  // per version: runs attributed to the version live at their issue time. Spec 1: its events/feedback by the span it was live (+ 3 h slop). Spec 2: events
  // attributed by the version live at the event, the look-back runs through every version.
  latest.versions = versions.map((v, i) => {
    const vruns = ctx.runs.filter((r) => all.has(r.day) && r.version === v.id);
    if (!vruns.length) return { id: v.id, name: v.name, from: v.from, what: v.what, runs: 0, kpis: null, summary: null };
    const t0 = Math.min(...vruns.map((r) => r.ts)), t1 = Math.max(...vruns.map((r) => r.ts));
    const vdays = new Set(vruns.map((r) => r.day));
    const events = spec.lookAll ? winEvents.filter((e) => e.version === v.id) : ctx.events.filter((e) => e.ts >= t0 && e.ts <= t1 + 3 * 3_600_000);
    const fb = feedback ? feedback.filter((f) => f.created_ms >= t0 && f.created_ms <= t1) : null;
    const kpis = kpiSet(ctx, { sel: (r) => r.version === v.id && all.has(r.day), events, feedback: fb, feedbackFallback: null, today, spec });
    return {
      id: v.id, name: v.name, from: v.from, what: v.what, runs: vruns.length, days: vdays.size,
      liveUntil: versions[i + 1]?.from ?? null, kpis, summary: summarise(kpis),
    };
  });

  // full-system variants (shadow levels AND warning-candidate chances): one system on KPIs 1-8, with live on the same runs as its baseline
  latest.systems = {};
  for (const v of systems) latest.systems[v] = systemSet(ctx, { sel: (r) => all.has(r.day), events: winEvents, variant: v, spec });
  return { latest, liveKpis };
}

// ---------------------------------------------------------------- spec 1: the files the page reads (values unchanged; new keys only)
const kpiDir = path.join(out, "kpi");
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (o) => JSON.stringify(o, dropInternal, 1) + "\n";

const { latest, liveKpis } = buildLatest(SPEC1);
mkdirSync(path.join(kpiDir, "days"), { recursive: true });
write(path.join(kpiDir, "latest.json"), json(latest));

// ---- per day + history.csv (live and every shadow variant); the same days feed history-wide.csv in the extras below
const histFile = path.join(kpiDir, "history.csv");
let history = existsSync(histFile) ? readFileSync(histFile, "utf8") : "";
const expectedStations = new Set(ctx.runs.filter(inDays(all)).map((r) => r.station)).size;
const dayData = {}; // day -> { kpis, variants, storm } for spec 1
for (const d of days) {
  const ds = new Set([d]);
  const dayKpis = scope(ds, SPEC1, { forDay: true });
  const dayVariants = Object.fromEntries(variants.map((v) => [v, kpiSet(ctx, { sel: (r) => r.day === d, variant: v })]).filter(([, k]) => k.some((x) => x.n > 0)));
  const storm = ctx.runs.some((r) => r.day === d && r.stormDay);
  dayData[d] = { kpis: dayKpis, variants: dayVariants, storm };
  const prov = provenance(SPEC1);
  const file = {
    day: d, complete: d < today, storm, hasReadings: withReadings.includes(d), summary: summarise(dayKpis), kpis: dayKpis, variants: dayVariants,
    generatedAt: prov.generatedAt, nowUsed: prov.nowUsed, codeSha: prov.codeSha, kpiSpec: 1, versionsHash: prov.versionsHash,
    daysRequested: prov.daysRequested, daysFound: prov.daysFound, daysMissing: prov.daysMissing, outcomesFinal: outcomesFinalDay(d),
    coverage: dayCoverage(ctx, d, expectedStations),
  };
  write(path.join(kpiDir, "days", `${d}.json`), json(file));
  const rows = [
    ...historyRows(d, storm ? "live-storm-day" : "live", dayKpis),
    ...Object.entries(dayVariants).flatMap(([v, k]) => historyRows(d, `variant:${v}`, k)),
  ];
  history = upsertHistory(history, d, rows);
}
write(histFile, history);

const s = latest.summary;
console.log(`KPI ${latest.window.from}..${latest.window.to} (${latest.window.days} days, ${latest.runs} runs, ${latest.events} events): met ${s.met} of ${s.assessable} judged (${s.total} targets)`);
for (const k of liveKpis) console.log(`  ${String(k.id).padStart(2)} ${k.key.padEnd(12)} value ${k.value ?? "-"}${k.unit === "%" ? "%" : " " + k.unit} target ${k.targetText} | n ${k.n} | ${k.met == null ? "not enough cases" : k.met ? "MET" : "not met"}`);

// ---------------------------------------------------------------- the rest of the record: a failure here is a warning, not a failed night
const step = (name, fn) => {
  try { return fn(); } catch (e) { console.log(`::warning::forecast-kpi: ${name} not written: ${String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ").slice(0, 300)}`); return null; }
};
const sizeOf = {};
const put = (file, text) => { write(file, text); sizeOf[path.relative(out, file)] = Buffer.byteLength(text); };

// b. as published
step("published", () => put(path.join(kpiDir, "published", `${today}.json`), json(latest)));

// spec 2 window file + both specs into history-wide.csv
const latest2 = step("v2/latest.json", () => { const r = buildLatest(SPEC2); put(path.join(kpiDir, "v2", "latest.json"), json(r.latest)); return r.latest; });
step("history-wide.csv", () => {
  const file = path.join(kpiDir, "history-wide.csv");
  let wide = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const d of days) {
    const rows = [];
    for (const spec of [SPEC1, SPEC2]) {
      const dayEvents = ctx.events.filter((e) => e.day === d);
      const add = (scopeName, kpis, withInputs = false) => { if (kpis.some((k) => k.n > 0)) rows.push(...wideRows(d, scopeName, spec.id, withInputs ? kpis : kpis.filter((k) => k.id < 9))); };
      add("all", spec.id === 1 ? dayData[d].kpis : scope(new Set([d]), spec, { forDay: true }), true);
      // storm / calm here are RUN-level (the run's own storm flag at issue); latest.json's `storm` is day-level
      for (const [name, flag] of [["storm", true], ["calm", false]]) {
        add(name, kpiSet(ctx, { sel: (r) => r.day === d && !!r.storm === flag, events: dayEvents.filter((e) => e.stormAtEvent === flag), today, spec }));
      }
      for (const v of variants) add(`variant:${v}`, kpiSet(ctx, { sel: (r) => r.day === d, variant: v, spec, ...(spec.lookAll ? { events: dayEvents } : {}) }));
      for (const v of versions) {
        if (!ctx.runs.some((r) => r.day === d && r.version === v.id)) continue;
        add(`version:${v.id}`, kpiSet(ctx, { sel: (r) => r.day === d && r.version === v.id, events: dayEvents.filter((e) => e.version === v.id), today, spec }));
      }
      for (const v of systems) add(`system:${v}`, systemSet(ctx, { sel: (r) => r.day === d, events: dayEvents, variant: v, spec }));
    }
    wide = upsertWideEdge(wide, d, rows, d < addDays(days[0], 2));
  }
  put(file, wide);
});

// d. event ledger (all runs looked back through; upsert by station|step|ts) and e. per-gauge daily tables
const ledger = step("events ledger", () => {
  const recs = ledgerRecords(ctx, ctx.events.filter(inDays(all)));
  const byMonth = new Map(), out2 = [];
  for (const r of recs) (byMonth.get(ledgerMonth(r.ts)) ?? byMonth.set(ledgerMonth(r.ts), []).get(ledgerMonth(r.ts))).push(r);
  for (const [m, rs] of byMonth) {
    const file = path.join(kpiDir, "events", `${m}.jsonl`);
    const text = upsertLedger(existsSync(file) ? readFileSync(file, "utf8") : "", rs);
    put(file, text);
    const stored = parseLedger(text);
    for (const r of rs) out2.push(stored.get(ledgerKey(r)) ?? r); // what is stored (a full record outranks this run's cut-short one)
  }
  return out2;
}) ?? [];
step("gauge tables", () => { for (const d of days) put(path.join(kpiDir, "gauges", `${d}.csv`), gaugeTable(ctx, d, ledger)); });

// f. archive health: the days missing in the last 30 for every folder the forecast depends on
step("archive-health.json", () => {
  const FOLDERS = ["forecasts", "hmis/rain", "hmis/levels", "rain-forecast", "gsmap/archive", "rivernet", "rain"];
  const win = daysBetween(addDays(today, -30), addDays(today, -1));
  const datesIn = (dir, depth = 0, acc = new Set()) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const m = e.name.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) acc.add(m[1]);
      if (e.isDirectory() && depth < 3) datesIn(path.join(dir, e.name), depth + 1, acc);
    }
    return acc;
  };
  const folders = {};
  for (const f of FOLDERS) {
    const dir = path.join(out, f);
    if (!existsSync(dir)) { folders[f] = { exists: false, firstDay: null, lastDay: null, daysPresentInLast30: 0, missing: [] }; continue; }
    const present = datesIn(dir);
    const { firstDay, missing } = missingDays(present, win[0], win[win.length - 1], win);
    folders[f] = { exists: true, firstDay, lastDay: [...present].sort().pop() ?? null, daysPresentInLast30: win.filter((d) => present.has(d)).length, missing };
  }
  put(path.join(kpiDir, "archive-health.json"), json({ generatedAt: new Date(now).toISOString(), from: win[0], to: win[win.length - 1], note: "missing = days in the last 30 with no file, counted from the first day the folder has any file", folders }));
});

const extra = Object.entries(sizeOf).map(([f, b]) => `${f} ${b}`).join(", ");
console.log(`extras: spec 2 ${latest2 ? `met ${latest2.summary.met} of ${latest2.summary.assessable}` : "not written"}; ledger ${ledger.length} events; ${extra.length ? `bytes: ${extra.slice(0, 600)}` : ""}`);
