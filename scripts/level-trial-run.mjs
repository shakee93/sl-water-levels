#!/usr/bin/env node
// Nightly runner of the level-model HIDDEN TRIAL (lvl-lin-d4). Never in the site's request path; never shown to a visitor; never a verdict, alert or push input.
//
// usage: node --experimental-strip-types --no-warnings scripts/level-trial-run.mjs [--from D --to D | --days N] [--budget-min 6] [--dry] [--no-prune]
//   default days: the two Colombo days before today (the same two days scripts/forecast-archive.mjs archives next).
//   Needs CLOUDFLARE_API_TOKEN. Reads D1 (forecast_runs, forecast_inputs, forecast_trial_log, observations) and writes forecast_shadow_points + forecast_trial_log.
//
// For every live forecast run of a model gauge that has no trial row yet: take the rain record the hourly route logged (forecast_inputs), the gauge's and its
// partners' stored readings, rebuild the predictor input (lib/levelTrial/rebuild.mjs), call the predictor and write
//   verdict ok        -> forecast_shadow_points, variant "lvl-lin-d4"      (ts = t + h x 1 h, level / low / high in the gauge's own unit)
//   verdict degraded  -> forecast_shadow_points, variant "lvl-lin-d4-deg"  (scored as a variant of its own, never mixed into the trial's number)
//   refused / skipped -> forecast_trial_log only
// plus ONE forecast_trial_log row per run (variant "lvl-lin-d4"): verdict, reason, flags, history figures. The log row is written AFTER the run's points, so a
// run that stopped half-way is simply done again (all statements are INSERT OR REPLACE of deterministic rows).
//
// Where the writes go (requirement R4): through lib/d1Sql.mjs, the HTTP /query path (no import lock), in small batches, from a workflow of its OWN
// concurrency group (level-trial.yml). It is NOT in the `d1-writes` group of store-forecasts / curw-snapshot / gsmap-snapshot (a group keeps one pending run and
// cancels an older pending one: that is how a slow job got the hourly store cancelled twice on 11 Nov 2026) and NOT in the `snapshot` group of the nightly
// archive and KPI job (a pending trial run could replace its pending run). The runner has its own wall-clock budget (default 6 min), stops cleanly when it is
// used up and exits 0 with what is left; a transient D1 failure is a warning and exit 0 (the next run does the rest: everything is idempotent).
// Idempotent: a run with a final trial row is never recomputed; a run logged as "no inputs" is looked at again (a later hourly run may have stored the
// record) and written only when its outcome changed. A second run writes nothing.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { D1HttpError, runStatements, selectRows, splitSql } from "../lib/d1Sql.mjs";
import { HOUR, addDays, colomboDay, dayEnd, dayStart, daysBetween } from "../lib/forecastScoreboard.mjs";
import { rebuild } from "../lib/levelTrial/rebuild.mjs";

export const VARIANT = "lvl-lin-d4";
export const DEG_VARIANT = "lvl-lin-d4-deg";
export const OBS_BACK_H = 120; // history read per run (the rebuild needs 72 h + 6 older readings + the 36 h stuck-sensor look-back of lib/readingQc.mjs)
export const KEEP_INPUTS_DAYS = 400; // same limit as the hourly store job (TRIAL_RETENTION_MS); also applied to the warning rule's two tables, which nothing else prunes
export const KEEP_LOG_DAYS = 120;
export const DEFAULT_BUDGET_MS = 6 * 60_000;
const FLUSH_RUNS = 40; // runs per write

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- SQL helpers
/** One SQL literal. Strings are single-quoted ('' escapes); non-finite numbers become NULL. */
export const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL") : typeof v === "boolean" ? (v ? "1" : "0") : `'${String(v).replace(/'/g, "''")}'`);
const row = (vals) => `(${vals.map(q).join(", ")})`;

export function pointStatements(station, t, variant, hz) {
  const out = [];
  for (const p of Array.isArray(hz) ? hz : []) {
    const [h, level, low, high] = p;
    if (!Number.isInteger(h) || typeof level !== "number" || !Number.isFinite(level)) continue;
    const lo = typeof low === "number" && Number.isFinite(low) ? low : null;
    const hi = typeof high === "number" && Number.isFinite(high) ? high : null;
    out.push(`INSERT OR REPLACE INTO forecast_shadow_points (station, issued_at, variant, horizon_h, target_ts, level, low, high) VALUES ${row([station, t, variant, h, t + h * HOUR, level, lo, hi])};`);
  }
  return out;
}

export function logStatement(e) {
  return `INSERT OR REPLACE INTO forecast_trial_log (variant, station, issued_at, verdict, reason, flags, detail, n_hist, gap_h, lag_h, weather_age_min, runner, ran_ms) VALUES ${row([
    VARIANT, e.station, e.issued_at, e.verdict, e.reason, e.flags, e.detail == null ? null : String(e.detail).slice(0, 200), e.n_hist, e.gap_h, e.lag_h, e.weather_age_min, e.runner, e.ran_ms,
  ])};`;
}

/** Retryable = logged only because no usable record existed; a later hourly run may have stored one. */
const retryable = (v) => v.verdict === "skipped" && (v.reason === "no_inputs" || String(v.reason).startsWith("inputs_skip:"));

// ---------------------------------------------------------------- one run -> its statements and log entry
/** Pure: the outcome of one live run. `inp` = the forecast_inputs row or undefined. Returns { entry, statements, verdict }. */
export function judge(model, { station, issued_at, inp, rows, unitTable, runner, nowMs }) {
  const base = { station, issued_at, flags: null, detail: null, n_hist: null, gap_h: null, lag_h: null, weather_age_min: inp?.weather_age_min ?? null, runner, ran_ms: nowMs };
  if (!inp) return { entry: { ...base, verdict: "skipped", reason: "no_inputs" }, statements: [], verdict: "skipped" };
  if (inp.skip) return { entry: { ...base, verdict: "skipped", reason: `inputs_skip:${inp.skip}` }, statements: [], verdict: "skipped" };
  if (!inp.blob) return { entry: { ...base, verdict: "skipped", reason: "no_inputs", detail: "inputs row without a record" }, statements: [], verdict: "skipped" };
  const r = rebuild(model, { gauge: station, t: issued_at, record: inp.blob, rows, unitTable });
  const flags = r.result && Array.isArray(r.result.degraded) && r.result.degraded.length ? r.result.degraded.map((d) => d.code).join(",") : null;
  const entry = {
    ...base, verdict: r.verdict, reason: r.reason ?? null, flags, detail: r.detail ?? null,
    n_hist: r.nHist ?? null, gap_h: r.gapH ?? null, lag_h: r.lagH ?? null,
  };
  const statements = [];
  if (r.verdict === "ok") statements.push(...pointStatements(station, issued_at, VARIANT, r.result.hz));
  else if (r.verdict === "degraded") statements.push(...pointStatements(station, issued_at, DEG_VARIANT, r.result.hz));
  return { entry, statements, verdict: r.verdict };
}

// ---------------------------------------------------------------- the whole run
/**
 * @param model      parsed lib/model/lvl-lin-d4.json
 * @param unitTable  UNIT_BY_STATION
 * @param io         { select(sql, params) -> rows[], exec(statements[], label) -> Promise }
 * @param days       Colombo days "YYYY-MM-DD", processed in the order given
 * @param opts       { budgetMs, now: () => ms, runner, ddl: string[] (statements run first), prune: bool, keepInputsDays, keepLogDays, log: fn }
 * @returns summary { runs, checked, written, byVerdict, skipReasons, left, stopped, days: [...], pruned, errors }
 */
export async function run({ model, unitTable, io, days, opts = {} }) {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const runner = opts.runner ?? "local";
  const t0 = now();
  const over = () => now() - t0 >= budgetMs;
  const gauges = new Set(Object.keys(model.g));
  const sum = { runs: 0, alreadyDone: 0, changed: 0, written: { points: 0, log: 0 }, byVerdict: {}, skipReasons: {}, left: 0, stopped: null, days: [], pruned: null, errors: [] };
  const bump = (m, k) => (m[k] = (m[k] ?? 0) + 1);

  if (opts.ddl?.length) await io.exec(opts.ddl, "level-trial ddl");

  for (const day of days) {
    if (over()) { sum.stopped = "budget"; break; }
    const a = dayStart(day), b = dayEnd(day);
    const ds = { day, runs: 0, todo: 0, written: 0, left: 0, note: null };
    sum.days.push(ds);
    const runsAll = await io.select("SELECT station, issued_at FROM forecast_runs WHERE issued_at >= ? AND issued_at < ?", [a, b]);
    const seen = new Set();
    const runs = [];
    for (const r of runsAll) {
      const k = `${r.station}|${r.issued_at}`;
      if (!gauges.has(r.station) || seen.has(k)) continue;
      seen.add(k);
      runs.push({ station: r.station, issued_at: r.issued_at });
    }
    runs.sort((x, y) => x.issued_at - y.issued_at || x.station.localeCompare(y.station));
    ds.runs = runs.length;
    sum.runs += runs.length;
    if (!runs.length) { ds.note = "no live runs of model gauges"; continue; }

    // the inputs table may not exist yet (the hourly route's first run creates it): then there is nothing to say about any run, so write nothing
    let inputs;
    try {
      inputs = await io.select("SELECT station, issued_at, blob, skip, weather_age_min FROM forecast_inputs WHERE issued_at >= ? AND issued_at < ?", [a, b]);
    } catch (e) {
      if (e instanceof D1HttpError && e.transient) throw e;
      ds.note = "forecast_inputs not readable: " + String(e && e.message ? e.message : e).slice(0, 120);
      sum.errors.push(`${day}: ${ds.note}`);
      continue;
    }
    const inByKey = new Map(inputs.map((r) => [`${r.station}|${r.issued_at}`, r]));
    let logged = [];
    try {
      logged = await io.select("SELECT station, issued_at, verdict, reason FROM forecast_trial_log WHERE variant = ? AND issued_at >= ? AND issued_at < ?", [VARIANT, a, b]);
    } catch (e) {
      if (e instanceof D1HttpError && e.transient) throw e;
      // table not created yet (first dry run): nothing logged so far
      if (!/no such table/i.test(String(e && e.message ? e.message : e))) throw e;
    }
    const logByKey = new Map(logged.map((r) => [`${r.station}|${r.issued_at}`, r]));

    const todo = [];
    for (const r of runs) {
      const ex = logByKey.get(`${r.station}|${r.issued_at}`);
      if (ex && !retryable(ex)) { sum.alreadyDone++; continue; }
      todo.push({ ...r, ex, inp: inByKey.get(`${r.station}|${r.issued_at}`) });
    }
    ds.todo = todo.length;
    if (!todo.length) continue;

    // readings: one query per needed station (gauge + partners of the gauges that have a record), ts in [first t - 100 h, last t]
    const need = new Set();
    let lo = Infinity, hi = -Infinity;
    for (const r of todo) {
      if (!r.inp?.blob || r.inp.skip) continue;
      need.add(r.station);
      for (const p of model.g[r.station].ups) need.add(p.u);
      lo = Math.min(lo, r.issued_at - OBS_BACK_H * HOUR);
      hi = Math.max(hi, r.issued_at);
    }
    const obs = {};
    for (const st of need) {
      if (over()) break;
      obs[st] = (await io.select("SELECT ts, level FROM observations WHERE station = ? AND ts BETWEEN ? AND ?", [st, lo, hi])).filter((x) => x && x.level != null);
    }

    let pending = [], pendingRuns = 0;
    const flush = async () => {
      if (!pending.length) return;
      const n = pending.length;
      await io.exec(pending, `level-trial ${day}`);
      pending = [];
      pendingRuns = 0;
      return n;
    };
    let i = 0;
    for (; i < todo.length; i++) {
      if (over()) { sum.stopped = "budget"; break; }
      const r = todo[i];
      // a run whose readings were not all loaded (budget hit while reading) is left for the next run rather than judged on missing data
      const needed = r.inp?.blob && !r.inp.skip ? [r.station, ...model.g[r.station].ups.map((p) => p.u)] : [];
      if (needed.some((s) => !obs[s])) { sum.stopped = "budget"; break; }
      const rows = {};
      for (const s of needed) rows[s] = obs[s];
      const j = judge(model, { station: r.station, issued_at: r.issued_at, inp: r.inp, rows, unitTable, runner, nowMs: now() });
      if (r.ex && r.ex.verdict === j.entry.verdict && r.ex.reason === (j.entry.reason ?? null)) continue; // a retried run with the same outcome: nothing new
      if (r.ex) sum.changed++;
      bump(sum.byVerdict, j.entry.verdict);
      if (j.entry.verdict === "skipped" || j.entry.verdict === "refused") bump(sum.skipReasons, `${j.entry.verdict}:${j.entry.reason}`);
      pending.push(...j.statements, logStatement(j.entry));
      sum.written.points += j.statements.length;
      sum.written.log++;
      ds.written++;
      if (++pendingRuns >= FLUSH_RUNS) await flush();
    }
    await flush();
    ds.left = todo.length - i;
    sum.left += ds.left;
    if (sum.stopped) break;
  }

  // retention: after the writes, never before (and not when the budget stopped the run: the next run prunes)
  if (opts.prune !== false && !sum.stopped) {
    const nowMs = now();
    const stmts = [
      `DELETE FROM forecast_inputs WHERE issued_at < ${nowMs - (opts.keepInputsDays ?? KEEP_INPUTS_DAYS) * 24 * HOUR};`,
      `DELETE FROM forecast_crossings_x WHERE issued_at < ${nowMs - (opts.keepInputsDays ?? KEEP_INPUTS_DAYS) * 24 * HOUR};`,
      `DELETE FROM forecast_runs_x WHERE issued_at < ${nowMs - (opts.keepInputsDays ?? KEEP_INPUTS_DAYS) * 24 * HOUR};`,
      `DELETE FROM forecast_trial_log WHERE issued_at < ${nowMs - (opts.keepLogDays ?? KEEP_LOG_DAYS) * 24 * HOUR};`,
    ];
    sum.pruned = [];
    for (const s of stmts) {
      try {
        await io.exec([s], "level-trial prune");
        sum.pruned.push(s.split(" ")[2]);
      } catch (e) {
        if (e instanceof D1HttpError && e.transient) throw e;
        sum.errors.push("prune: " + String(e && e.message ? e.message : e).slice(0, 120)); // e.g. forecast_inputs does not exist yet
      }
    }
  }
  log(JSON.stringify(sum));
  return sum;
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const today = colomboDay(Date.now());
  let days;
  if (opt("--from")) days = daysBetween(opt("--from"), opt("--to") ?? opt("--from"));
  else if (opt("--days")) {
    const n = Math.max(1, Math.min(14, Number(opt("--days")) || 2));
    days = daysBetween(addDays(today, -n), addDays(today, -1));
  } else days = [addDays(today, -2), addDays(today, -1)];
  return { days, budgetMs: Math.max(10_000, Number(opt("--budget-min") ?? 6) * 60_000), dry: argv.includes("--dry"), prune: !argv.includes("--no-prune") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const model = JSON.parse(readFileSync(path.join(here, "../lib/model/lvl-lin-d4.json"), "utf8"));
  const { UNIT_BY_STATION } = await import("../lib/units.ts");
  const ddl = splitSql(readFileSync(path.join(here, "../d1/0025_level_trial_log.sql"), "utf8")).map((x) => x + ";");
  const shadowDdl = splitSql(readFileSync(path.join(here, "../d1/0016_forecast_shadow.sql"), "utf8")).map((x) => x + ";");
  const io = {
    select: (sql, params) => selectRows(sql, params),
    exec: args.dry ? async (s, label) => console.log(`DRY ${label}: ${s.length} statements not sent`) : (s, label) => runStatements(s, { label }),
  };
  console.log(`level trial: days ${args.days.join(", ")}, budget ${args.budgetMs / 60000} min${args.dry ? ", DRY RUN" : ""}`);
  try {
    const s = await run({
      model, unitTable: UNIT_BY_STATION, io, days: args.days,
      opts: { budgetMs: args.budgetMs, runner: process.env.GITHUB_RUN_ID ? `gha:${process.env.GITHUB_RUN_ID}` : "local", ddl: args.dry ? [] : [...shadowDdl, ...ddl], prune: args.prune && !args.dry, log: (l) => console.log("SUMMARY " + l) },
    });
    console.log(`level trial: ${s.runs} live runs, ${s.alreadyDone} already done, ${s.written.log} judged now (${JSON.stringify(s.byVerdict)}), ${s.written.points} points, ${s.left} left${s.stopped ? ` (stopped: ${s.stopped})` : ""}`);
    if (s.stopped) console.log(`::warning::level trial stopped on its time budget with ${s.left} runs left; the next run does them`);
    for (const e of s.errors) console.log(`::warning::level trial: ${e}`);
  } catch (e) {
    const transient = e instanceof D1HttpError && e.transient;
    console.log(`${transient ? "::warning::" : "::error::"}level trial: ${e instanceof Error ? e.message : e}`);
    process.exit(transient ? 0 : 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
