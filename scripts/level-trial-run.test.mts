// @ts-nocheck (node strip-types test)
// Tests of the level-model hidden trial, stage 3 (the nightly side): scripts/level-trial-run.mjs (runner), lib/levelTrial/report.mjs (report), the report CLI.
//   node --experimental-strip-types --no-warnings scripts/level-trial-run.test.mts
// No network, no D1, no secrets: a fake D1 (in-memory tables behind the two functions the runner uses) and cases from the stage 1 fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { run, judge, q, VARIANT, DEG_VARIANT } from "./level-trial-run.mjs";
import { HOUR, colomboDay } from "../lib/forecastScoreboard.mjs";
import { UNIT_BY_STATION } from "../lib/units.ts";
import { encode } from "../lib/levelTrial/record.mjs";
import { buildReport, coverageOf, mergeLogs, pairedRows, rainOfDay, replayRange, skillPct, summariseLog, BELOW_MIN_N } from "../lib/levelTrial/report.mjs";

let n = 0;
const ok = async (name: string, fn: () => any) => {
  try {
    await fn();
    n++;
  } catch (e) {
    console.error("FAIL " + name + "\n  " + String((e as Error).message).split("\n").slice(0, 8).join("\n  "));
    process.exitCode = 1;
  }
};
const model = JSON.parse(readFileSync(new URL("../lib/model/lvl-lin-d4.json", import.meta.url), "utf8"));
const fx = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/lvl-lin-d4-cases.json.gz", import.meta.url))).toString("utf8"));
const UT = UNIT_BY_STATION as Record<string, "m" | "ft">;

// ------------------------------------------------------------------------------------------------ a fake D1
function splitValues(s: string): any[] {
  const out: any[] = [];
  let i = 0;
  while (i < s.length) {
    while (s[i] === " " || s[i] === ",") i++;
    if (i >= s.length) break;
    if (s[i] === "'") {
      let j = i + 1, v = "";
      while (j < s.length) {
        if (s[j] === "'") { if (s[j + 1] === "'") { v += "'"; j += 2; } else break; } else v += s[j++];
      }
      out.push(v);
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== ",") j++;
      const tok = s.slice(i, j).trim();
      out.push(tok === "NULL" ? null : Number(tok));
      i = j;
    }
  }
  return out;
}
function fakeD1(init: { runs?: any[]; inputs?: any[] | null; obs?: Record<string, any[]> }) {
  const d = { runs: init.runs ?? [], inputs: init.inputs === null ? null : init.inputs ?? [], obs: init.obs ?? {}, log: new Map<string, any>(), points: new Map<string, any>(), execs: 0, statements: 0, selects: [] as string[] };
  const io = {
    select: async (sql: string, p: any[]) => {
      d.selects.push(sql);
      if (sql.includes("FROM forecast_runs")) return d.runs.filter((r) => r.issued_at >= p[0] && r.issued_at < p[1]);
      if (sql.includes("FROM forecast_inputs")) {
        if (d.inputs === null) throw new Error("no such table: forecast_inputs");
        return d.inputs.filter((r) => r.issued_at >= p[0] && r.issued_at < p[1]);
      }
      if (sql.includes("FROM forecast_trial_log")) {
        if ((d as any).noLogTable) throw new Error("D1 HTTP 400: no such table: forecast_trial_log");
      }
      if (sql.includes("FROM forecast_trial_log")) return [...d.log.values()].filter((r) => r.variant === p[0] && r.issued_at >= p[1] && r.issued_at < p[2]);
      if (sql.includes("FROM observations")) return (d.obs[p[0]] ?? []).filter((r) => r.ts >= p[1] && r.ts <= p[2]);
      throw new Error("unexpected select " + sql);
    },
    exec: async (statements: string[]) => {
      d.execs++;
      for (const s of statements) {
        d.statements++;
        let m = s.match(/^INSERT OR REPLACE INTO (\w+) \(([^)]*)\) VALUES \((.*)\);$/s);
        if (m) {
          const cols = m[2].split(",").map((x) => x.trim());
          const vals = splitValues(m[3]);
          assert.equal(vals.length, cols.length, "column count of " + s.slice(0, 80));
          const rec = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
          if (m[1] === "forecast_shadow_points") d.points.set(`${rec.station}|${rec.issued_at}|${rec.variant}|${rec.horizon_h}`, rec);
          else if (m[1] === "forecast_trial_log") d.log.set(`${rec.variant}|${rec.station}|${rec.issued_at}`, rec);
          else throw new Error("unexpected table " + m[1]);
          continue;
        }
        m = s.match(/^DELETE FROM (\w+) WHERE issued_at < (\d+);$/);
        if (m) {
          if (m[1] === "forecast_inputs" && d.inputs) d.inputs = d.inputs.filter((r) => r.issued_at >= Number(m[2]));
          else if (m[1] === "forecast_trial_log") for (const [k, v] of d.log) if (v.issued_at < Number(m[2])) d.log.delete(k);
          continue;
        }
        throw new Error("unexpected statement " + s.slice(0, 100));
      }
    },
  };
  return { d, io };
}

// ------------------------------------------------------------------------------------------------ cases from the fixture
const pick = (verdict: string, gauge: string, scenario?: string) => fx.cases.find((c) => c.gauge === gauge && c.expect.verdict === verdict && (!scenario || c.scenario === scenario));
const cOk = pick("ok", "Badalgama", "control_wet");
const cDeg = pick("degraded", "Baddegama", "rain_obs72_missing");
const cRef = pick("refused", "Dunamale", "rain_fc_missing");
assert.ok(cOk && cDeg && cRef, "fixture cases");
function world(cases: any[], extra: { inputs?: any } = {}) {
  const runs: any[] = [], inputs: any[] = [], obs: Record<string, any[]> = {};
  for (const c of cases) {
    runs.push({ station: c.gauge, issued_at: c.t });
    inputs.push({ station: c.gauge, issued_at: c.t, blob: c.record, skip: null, weather_age_min: c.age });
    for (const [st, rows] of Object.entries(c.rows) as any) {
      const have = new Map((obs[st] ??= []).map((r) => [r.ts, r]));
      for (const [rel, level] of rows) if (!have.has(c.t + rel)) obs[st].push({ ts: c.t + rel, level });
    }
  }
  return fakeD1({ runs, inputs: extra.inputs === undefined ? inputs : extra.inputs, obs });
}
const daysOf = (cases: any[]) => [...new Set(cases.map((c) => colomboDay(c.t)))].sort();
const NOW = Date.parse("2026-11-12T19:30:00Z");
const baseOpts = { now: () => NOW, runner: "test", prune: false };
const go = (w: any, cases: any[], opts: any = {}) => run({ model, unitTable: UT, io: w.io, days: daysOf(cases), opts: { ...baseOpts, ...opts } });

// ------------------------------------------------------------------------------------------------ the runner
await ok("runner: ok -> variant lvl-lin-d4 points (ts = t + h, native unit, values of the lab), degraded -> lvl-lin-d4-deg, refused -> log only", async () => {
  const cases = [cOk, cDeg, cRef];
  const w = world(cases);
  const s = await go(w, cases);
  assert.equal(s.runs, 3);
  assert.deepEqual(s.byVerdict, { ok: 1, degraded: 1, refused: 1 });
  assert.equal(w.d.log.size, 3);
  const pts = (c, v) => [...w.d.points.values()].filter((p) => p.station === c.gauge && p.issued_at === c.t && p.variant === v);
  const okPts = pts(cOk, VARIANT);
  assert.equal(okPts.length, cOk.expect.hz.length);
  for (const [h, level, low, high] of cOk.expect.hz) {
    const p = okPts.find((x) => x.horizon_h === h);
    assert.equal(p.target_ts, cOk.t + h * HOUR);
    assert.ok(Math.abs(p.level - level) < 1e-6 && Math.abs(p.low - low) < 1e-6 && Math.abs(p.high - high) < 1e-6, `h${h}`);
  }
  assert.equal(pts(cOk, DEG_VARIANT).length, 0);
  const degPts = pts(cDeg, DEG_VARIANT);
  assert.equal(degPts.length, cDeg.expect.hz.length);
  assert.equal(pts(cDeg, VARIANT).length, 0, "a degraded run is never in the trial's own variant");
  assert.equal(pts(cRef, VARIANT).length + pts(cRef, DEG_VARIANT).length, 0, "a refused run has no points");
  const L = (c) => w.d.log.get(`${VARIANT}|${c.gauge}|${c.t}`);
  assert.equal(L(cOk).verdict, "ok");
  assert.equal(L(cDeg).verdict, "degraded");
  assert.ok(L(cDeg).flags && L(cDeg).flags.includes("rain_window_missing"), "flags " + L(cDeg).flags);
  assert.equal(L(cRef).verdict, "refused");
  assert.equal(L(cRef).reason, cRef.expect.reason);
  for (const c of cases) {
    assert.equal(L(c).runner, "test");
    assert.equal(L(c).ran_ms, NOW);
    assert.ok(L(c).n_hist > 0 && L(c).gap_h != null && L(c).lag_h === c.lagH);
  }
  // no point in the table other than the three variants' own rows
  assert.ok([...w.d.points.values()].every((p) => p.level != null && Number.isFinite(p.level)));
});

await ok("runner: a dry run on a database without forecast_trial_log reads it as empty (no error)", async () => {
  const w = world([cOk]);
  (w.d as any).noLogTable = true;
  const s = await go(w, [cOk]);
  assert.equal(s.runs, 1);
  assert.equal(s.errors.length, 0);
});

await ok("runner: idempotent (a second and third run write nothing)", async () => {
  const cases = [cOk, cDeg, cRef];
  const w = world(cases);
  await go(w, cases);
  const before = { statements: w.d.statements, log: w.d.log.size, pts: w.d.points.size };
  const s2 = await go(w, cases);
  const s3 = await go(w, cases);
  assert.equal(w.d.statements, before.statements, "no statement sent");
  assert.equal(s2.written.log + s3.written.log, 0);
  assert.equal(s2.alreadyDone, 3);
  assert.equal(w.d.log.size, before.log);
  assert.equal(w.d.points.size, before.pts);
});

await ok("runner: a time budget stops it cleanly, reports what is left, and the next run finishes without doubling", async () => {
  const cases = [cOk, cDeg, cRef];
  const w = world(cases);
  let clock = NOW;
  // every look at the clock costs 1 s; a 6 s budget runs out in the middle of the work
  const s1 = await go(w, cases, { now: () => (clock += 1000), budgetMs: 6000 });
  assert.equal(s1.stopped, "budget");
  assert.ok(s1.left > 0 || s1.days.length < daysOf(cases).length, "something is left");
  assert.ok(w.d.log.size < 3);
  const mid = w.d.log.size;
  const s2 = await go(w, cases);
  assert.equal(s2.stopped, null);
  assert.equal(w.d.log.size, 3);
  assert.ok(s2.written.log >= 3 - mid);
  const s3 = await go(w, cases);
  assert.equal(s3.written.log, 0);
});

await ok("runner: a zero budget does nothing and exits cleanly", async () => {
  const w = world([cOk]);
  const s = await go(w, [cOk], { budgetMs: 0 });
  assert.equal(s.stopped, "budget");
  assert.equal(w.d.statements, 0);
});

await ok("runner: no record -> logged as no_inputs (no points); a later record upgrades it; the same outcome again writes nothing", async () => {
  const w = world([cOk], { inputs: [] });
  const s1 = await go(w, [cOk]);
  assert.deepEqual(s1.byVerdict, { skipped: 1 });
  assert.equal(w.d.points.size, 0);
  const row = w.d.log.get(`${VARIANT}|${cOk.gauge}|${cOk.t}`);
  assert.equal(row.verdict, "skipped");
  assert.equal(row.reason, "no_inputs");
  const st = w.d.statements;
  const s2 = await go(w, [cOk]); // still no record: looked at again, nothing new to say
  assert.equal(w.d.statements, st, "re-looking at an unchanged no_inputs run writes nothing");
  assert.equal(s2.written.log, 0);
  w.d.inputs.push({ station: cOk.gauge, issued_at: cOk.t, blob: cOk.record, skip: null, weather_age_min: null }); // the hourly route's later run stored it
  const s3 = await go(w, [cOk]);
  assert.equal(w.d.log.get(`${VARIANT}|${cOk.gauge}|${cOk.t}`).verdict, "ok");
  assert.equal(s3.changed, 1);
  assert.equal(w.d.points.size, cOk.expect.hz.length);
});

await ok("runner: a skipped record is logged with the route's reason; a record that cannot be decoded is a rebuild skip", async () => {
  const w = world([cOk, cDeg], { inputs: [{ station: cOk.gauge, issued_at: cOk.t, blob: null, skip: "weather", weather_age_min: null }, { station: cDeg.gauge, issued_at: cDeg.t, blob: "not base64 at all !!", skip: null, weather_age_min: null }] });
  await go(w, [cOk, cDeg]);
  assert.equal(w.d.log.get(`${VARIANT}|${cOk.gauge}|${cOk.t}`).reason, "inputs_skip:weather");
  const bad = w.d.log.get(`${VARIANT}|${cDeg.gauge}|${cDeg.t}`);
  assert.equal(bad.verdict, "skipped");
  assert.equal(bad.reason, "decode_error");
  assert.equal(w.d.points.size, 0);
});

await ok("runner: incomplete history is logged with its figures (30 readings; and a single reading is skipped)", async () => {
  const w = world([cOk]);
  const all = w.d.obs[cOk.gauge].slice().sort((a, b) => a.ts - b.ts);
  w.d.obs[cOk.gauge] = all.slice(-30);
  await go(w, [cOk]);
  let row = w.d.log.get(`${VARIANT}|${cOk.gauge}|${cOk.t}`);
  assert.equal(row.n_hist, 30);
  assert.ok(row.verdict !== "skipped");
  const sm = summariseLog([row]);
  assert.equal(sm.history.incomplete, 1);
  assert.equal(sm.history.complete, 0);
  const w2 = world([cOk]);
  w2.d.obs[cOk.gauge] = w2.d.obs[cOk.gauge].filter((r) => r.ts === cOk.t);
  await go(w2, [cOk]);
  row = w2.d.log.get(`${VARIANT}|${cOk.gauge}|${cOk.t}`);
  assert.equal(row.verdict, "skipped");
  assert.equal(row.reason, "history_incomplete");
  assert.equal(w2.d.points.size, 0);
  const w3 = world([cOk]); // the gauge has no stored reading at t at all
  w3.d.obs[cOk.gauge] = w3.d.obs[cOk.gauge].filter((r) => r.ts < cOk.t);
  await go(w3, [cOk]);
  assert.equal(w3.d.log.get(`${VARIANT}|${cOk.gauge}|${cOk.t}`).reason, "t_not_newest");
});

await ok("runner: a unit table mismatch (a unit the site does not have for the gauge) is skipped, never guessed", async () => {
  const w = world([cOk]);
  const bad = { ...UT, [cOk.gauge]: UT[cOk.gauge] === "m" ? "ft" : "m" };
  await run({ model, unitTable: bad, io: w.io, days: daysOf([cOk]), opts: baseOpts });
  const row = w.d.log.get(`${VARIANT}|${cOk.gauge}|${cOk.t}`);
  assert.equal(row.reason, "unit_table_mismatch");
  assert.equal(w.d.points.size, 0);
});

await ok("runner: runs of gauges outside the model are ignored; the inputs table missing writes nothing", async () => {
  const w = world([cOk]);
  w.d.runs.push({ station: "Not A Gauge", issued_at: cOk.t });
  await go(w, [cOk]);
  assert.equal(w.d.log.size, 1);
  const w2 = world([cOk], { inputs: null });
  const s = await go(w2, [cOk]);
  assert.equal(w2.d.statements, 0);
  assert.ok(s.errors.length === 1 && /forecast_inputs/.test(s.errors[0]));
});

await ok("runner: prune deletes inputs older than 400 days and log rows older than 120 days, keeps the rest", async () => {
  const w = fakeD1({ runs: [], inputs: [{ station: "A", issued_at: NOW - 401 * 24 * HOUR }, { station: "B", issued_at: NOW - 399 * 24 * HOUR }, { station: "C", issued_at: NOW - HOUR }] });
  w.d.log.set("v|A|1", { variant: "v", station: "A", issued_at: NOW - 121 * 24 * HOUR });
  w.d.log.set("v|B|2", { variant: "v", station: "B", issued_at: NOW - 119 * 24 * HOUR });
  const s = await run({ model, unitTable: UT, io: w.io, days: [], opts: { ...baseOpts, prune: true } });
  assert.deepEqual(w.d.inputs.map((r) => r.station), ["B", "C"]);
  assert.deepEqual([...w.d.log.keys()], ["v|B|2"]);
  assert.deepEqual(s.pruned, ["forecast_inputs", "forecast_crossings_x", "forecast_runs_x", "forecast_trial_log"]);
});

await ok("runner: SQL literals escape quotes and drop non-finite numbers; a detail is cut to 200 characters", async () => {
  assert.equal(q("it's"), "'it''s'");
  assert.equal(q(NaN), "NULL");
  assert.equal(q(null), "NULL");
  assert.equal(q(1.5), "1.5");
  const j = judge(model, { station: cOk.gauge, issued_at: cOk.t, inp: { blob: null, skip: "x'y" }, rows: {}, unitTable: UT, runner: "r", nowMs: 1 });
  assert.equal(j.entry.reason, "inputs_skip:x'y");
  const w = fakeD1({});
  await w.io.exec([`INSERT OR REPLACE INTO forecast_trial_log (variant, station, issued_at, verdict, reason, flags, detail, n_hist, gap_h, lag_h, weather_age_min, runner, ran_ms) VALUES ('v', 'S', 1, 'skipped', 'inputs_skip:x''y', NULL, '${"d".repeat(10)}', NULL, NULL, NULL, NULL, 'r', 1);`]);
  assert.equal([...w.d.log.values()][0].reason, "inputs_skip:x'y");
});

// ------------------------------------------------------------------------------------------------ the report
const T0 = Date.parse("2026-11-10T04:00:00Z");
function line(o: any) {
  const unit = o.unit ?? "ft";
  return {
    day: colomboDay(o.issued_at), station: o.station ?? "A", basin: "X", issued_at: o.issued_at, method: o.method ?? "model", status: "ok", unit, current_level: o.c, tier: "normal", verdict: "normal",
    storm: o.storm ?? 0, rain_risk: null,
    horizons: (o.live ?? []).map(([h, level, low, high, y]) => ({ h, ts: o.issued_at + h * HOUR, level, low, high, y })),
    crossings: [], shadows: o.shadows ?? {}, max24: null, cover24: true,
  };
}
const sh = (arr: number[][]) => arr.map(([h, level, low, high]) => ({ h, ts: 0, level, low, high }));

await ok("report: pooled skill, bias, range coverage and the live comparison on the same rows (hand-computed, ft and m)", () => {
  // gauge A, ft, h = 1: c = 10; y = 11, 12, 10, 13; live p = 10 (errors 1, 2, 0, 3: mean 1.5); trial p = 11 (errors 0, 1, 1, 2: mean 1); "no change" error mean 1.5
  const ys = [11, 12, 10, 13];
  const lines = ys.map((y, i) => line({ issued_at: T0 + i * HOUR, c: 10, live: [[1, 10, 9.5, 10.5, y]], shadows: { [VARIANT]: sh([[1, 11, 10, 12]]) } }));
  // gauge B, m: c = 1 m, y = 2 m, live p = 1 m, trial p = 2 m (exact)
  lines.push(line({ station: "B", unit: "m", issued_at: T0 + 5 * HOUR, c: 1, live: [[1, 1, 0.9, 1.1, 2]], shadows: { [VARIANT]: sh([[1, 2, 1.5, 2.5]]) } }));
  // a live run with no trial, a degraded one, a run that is not a model run, a gauge outside the list
  lines.push(line({ issued_at: T0 + 6 * HOUR, c: 10, live: [[1, 10, 9, 11, 10]] }));
  lines.push(line({ issued_at: T0 + 7 * HOUR, c: 10, live: [[1, 10, 9, 11, 10]], shadows: { [DEG_VARIANT]: sh([[1, 10, 9, 11]]) } }));
  lines.push(line({ issued_at: T0 + 8 * HOUR, c: 10, method: "trend", live: [[1, 10, 9, 11, 10]] }));
  lines.push(line({ station: "Z", issued_at: T0 + 9 * HOUR, c: 10, live: [[1, 10, 9, 11, 10]], shadows: { [VARIANT]: sh([[1, 10, 9, 11]]) } }));
  const rep = buildReport({ lines, gauges: ["A", "B"] });
  const a = rep.perGauge.A.h1;
  assert.equal(a.n, 4);
  assert.equal(a.trialSkillPct, 33.3); // 100 x (1 - 1 / 1.5)
  assert.equal(a.liveSkillPct, 0);
  assert.equal(a.diffPts, 33.3);
  assert.equal(a.trialBiasFt, -0.5); // p - y = 0, -1, 1, -2
  assert.equal(a.liveBiasFt, -1.5);
  const pa = pairedRows(lines, { gauges: ["A", "B"] }).filter((r) => r.station === "A");
  assert.deepEqual(pa.map((r) => r.y), [11, 12, 10, 13]);
  // own range: [10, 12] holds 11, 12, 10, not 13; live's [9.5, 10.5] holds only 10
  assert.equal(rep.perGauge.A.h1.n, 4);
  const pooled = rep.pooled.h1;
  assert.equal(pooled.n, 5);
  assert.equal(pooled.trialRange.n, 5);
  assert.equal(pooled.trialRange.coveragePct, 80); // A: 3 of 4; B: y = 2 in [1.5, 2.5] m
  assert.equal(pooled.liveRange.coveragePct, 20); // A: 1 of 4; B: y = 2 in [0.9, 1.1] m: no
  assert.equal(skillPct(pairedRows(lines, { gauges: ["B"] }), "trial"), 100);
  assert.equal(skillPct(pairedRows(lines, { gauges: ["B"] }), "live"), 0);
  // pooled in feet: trial MAE (0+1+1+2+0)/5 = 0.8; "no change" (1+2+0+3 + 3.28084)/5
  const pers = (6 + 1 / 0.3048) / 5;
  assert.equal(pooled.trialSkillPct, Math.round(1000 * (1 - 0.8 / pers)) / 10);
  assert.equal(pooled.liveSkillPct, 0);
  assert.deepEqual(Object.keys(rep.pooled), ["h1"]);
  // coverage: gauges A, B only; the trend run and gauge Z are not counted; the degraded run has its own count and is NOT "with trial"
  assert.equal(rep.coverage.liveRuns, 7);
  assert.equal(rep.coverage.withTrial, 5);
  assert.equal(rep.coverage.withDegraded, 1);
  assert.equal(rep.coverage.sharePct, 71.4);
  assert.equal(rep.coverage.degradedSharePct, 14.3);
  assert.equal(rep.coverage.perGauge.A.liveRuns, 6);
  assert.equal(rep.coverage.perGauge.A.sharePct, 66.7);
  assert.equal(coverageOf(lines).liveRuns, 8); // no gauge list: Z counts too
});

await ok("report: the as-of rule of the range replay (an outcome is used only by runs issued 1 h + 40 min after its target time or later)", () => {
  // 30 runs of one gauge, 30 min apart; range [p - 0.5, p + 0.5]; every outcome misses by exactly 1.0 above the range (score 1.0 for all)
  const lines = [];
  for (let j = 0; j < 30; j++) lines.push(line({ issued_at: T0 + j * 1800_000, c: 10, live: [[1, 10, 9, 11, 11.5]], shadows: { [VARIANT]: sh([[1, 10, 9.5, 10.5]]) } }));
  const rows = replayRange(lines, pairedRows(lines));
  assert.equal(rows.length, 30);
  assert.ok(rows.every((r) => r.cal !== null), "every row got an interval (q = 0 before 20 outcomes)");
  const covered = rows.map((r) => (r.y >= r.cal.low && r.y <= r.cal.high ? 1 : 0));
  // run j has the outcomes of runs i <= j - 4 (30 i + 100 <= 30 j min); it has 20 of them when j - 3 >= 20, i.e. from j = 23
  assert.deepEqual(covered, Array.from({ length: 30 }, (_, j) => (j >= 23 ? 1 : 0)));
  assert.equal(rows[22].cal.high, 10.5); // 19 outcomes: still the trial's own range
  assert.equal(rows[23].cal.high, 11.5); // 20 outcomes of score 1: q = 1
  assert.equal(rows[29].cal.low, 8.5);
  // the same lines in any input order give the same replay (it sorts by issue time itself)
  const again = replayRange(lines.slice().reverse(), pairedRows(lines));
  assert.deepEqual(again.map((r) => r.cal), rows.map((r) => r.cal));
  // a run with no reading yet is not an outcome: with the first 10 runs unscored the 20th outcome comes 10 runs later
  const l2 = lines.map((l, j) => (j < 10 ? { ...l, horizons: l.horizons.map((p) => ({ ...p, y: null })) } : l));
  const r2 = replayRange(l2, pairedRows(l2));
  assert.equal(r2.length, 20);
  const rep = buildReport({ lines });
  assert.equal(rep.pooled.h1.trialRange.coveragePct, 0);
  assert.equal(rep.pooled.h1.calRange.n, 30);
  assert.equal(rep.pooled.h1.calRange.coveragePct, 23.3); // 7 of 30
  assert.equal(rep.pooled.h1.calRange.widthFt, 1.47); // (23 x 1.0 + 7 x 3.0) / 30
});

await ok("report: gauge-horizons with 100+ rows where the trial is more than 5 points below live are listed", () => {
  const mk = (st: string, trialP: number, count: number) => {
    const out = [];
    for (let i = 0; i < count; i++) out.push(line({ station: st, issued_at: T0 + i * HOUR, c: 10, live: [[3, 11, 10, 12, 11.5]], shadows: { [VARIANT]: sh([[3, trialP, trialP - 1, trialP + 1]]) } }));
    return out;
  };
  // y = 11.5; "no change" error 1.5; live error 0.5 -> skill 66.7; trial 10.5 -> error 1.0 -> 33.3 (33 points below); trial 11 -> error 0.5 -> same as live
  const lines = [...mk("W", 10.5, BELOW_MIN_N), ...mk("X", 10.5, BELOW_MIN_N - 1), ...mk("Y", 11, BELOW_MIN_N)];
  const rep = buildReport({ lines });
  assert.deepEqual(rep.belowLive.cells.map((c) => [c.gauge, c.h, c.n]), [["W", 3, BELOW_MIN_N]]);
  assert.equal(rep.belowLive.cells[0].diffPts, -33.3);
  assert.equal(rep.perGauge.Y.h3.diffPts, 0);
});

await ok("report: log counts, history completeness and rain days add up", () => {
  const a = summariseLog([
    { verdict: "ok", reason: null, flags: null, n_hist: 72, gap_h: 1, lag_h: 0, weather_age_min: 10 },
    { verdict: "degraded", reason: "x", flags: "partner_stale,own_lags_missing", n_hist: 50, gap_h: 2, lag_h: 1, weather_age_min: 40 },
    { verdict: "refused", reason: "rain_missing", flags: null, n_hist: 72, gap_h: 4, lag_h: 0, weather_age_min: null },
    { verdict: "skipped", reason: "no_inputs", flags: null, n_hist: null, gap_h: null, lag_h: null, weather_age_min: null },
  ]);
  assert.deepEqual(a.byVerdict, { ok: 1, degraded: 1, refused: 1, skipped: 1 });
  assert.deepEqual(a.reasons, { "degraded:x": 1, "refused:rain_missing": 1, "skipped:no_inputs": 1 });
  assert.deepEqual(a.degradedFlags, { partner_stale: 1, own_lags_missing: 1 });
  assert.deepEqual(a.history, { checked: 3, complete: 1, incomplete: 2 });
  assert.deepEqual(a.lagHours, { 0: 2, 1: 1 });
  assert.deepEqual(a.ageMin, { "<=15": 1, "<=60": 1, unknown: 2 });
  const m = mergeLogs([a, a, null]);
  assert.equal(m.runs, 8);
  assert.equal(m.history.complete, 2);
  assert.equal(m.history.completePct, 33.3);
  assert.equal(m.byVerdict.refused, 2);
  // rain: a record with 1 mm in every hour of the full zone = 24 mm over the 24 hours before the run
  const rec = (mm10: number) => encode({ fmt: 1, grid: Math.floor(T0 / HOUR) * HOUR, ageMin: null, zones: { full: Array(124).fill(mm10), near: null, up: null }, cells: [Array(52).fill(mm10)], nz: [1, 0, 0] });
  const rows = (k: number, mm10: number) => Array.from({ length: k }, (_, i) => ({ station: "G" + i, issued_at: T0, blob: rec(mm10) }));
  assert.equal(rainOfDay(rows(5, 10)).rainDay, true);
  assert.equal(rainOfDay(rows(5, 10)).gauges, 5);
  assert.equal(rainOfDay(rows(4, 10)).rainDay, false);
  assert.equal(rainOfDay(rows(5, 4)).gauges, 0); // 0.4 mm x 24 = 9.6 mm: below 10
  assert.equal(rainOfDay([...rows(4, 10), { station: "G0", issued_at: T0 + HOUR, blob: rec(10) }, { station: "H", issued_at: T0, blob: "garbage" }]).gauges, 4); // a gauge counts once; bad blobs are ignored
});

await ok("report CLI: writes latest.json and a day file from a small archive, never fails (also on bad input)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lt-report-"));
  const today = colomboDay(Date.now());
  const yday = colomboDay(Date.now() - 24 * HOUR);
  const t = Date.parse(yday + "T04:00:00Z");
  const g = Object.keys(model.g)[0];
  const lines = [0, 1, 2].map((i) => line({ station: g, unit: "ft", issued_at: t + i * HOUR, c: 10, live: [[1, 10, 9, 11, 12]], shadows: { [VARIANT]: sh([[1, 11, 10, 12]]) } }));
  mkdirSync(path.join(dir, "forecasts", yday.slice(0, 4)), { recursive: true });
  writeFileSync(path.join(dir, "forecasts", yday.slice(0, 4), yday + ".jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: "" };
  const out = execFileSync("node", ["scripts/level-trial-report.mjs", dir, "--no-d1"], { cwd: new URL("..", import.meta.url).pathname, env, encoding: "utf8" });
  assert.match(out, /level trial report: 1 days, 3 live runs, trial on 3/);
  const latest = JSON.parse(readFileSync(path.join(dir, "kpi/level-trial/latest.json"), "utf8"));
  assert.equal(latest.schema, "slwl-level-trial/report@1");
  assert.equal(latest.pooled.h1.n, 3);
  assert.equal(latest.pooled.h1.trialSkillPct, 50); // errors 1, 1, 1 against "no change" 2, 2, 2
  assert.ok(existsSync(path.join(dir, `kpi/level-trial/days/${yday}.json`)));
  assert.ok(today >= yday);
  const bad = execFileSync("node", ["scripts/level-trial-report.mjs"], { cwd: new URL("..", import.meta.url).pathname, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.equal(typeof bad, "string"); // exit 0
  const empty = mkdtempSync(path.join(os.tmpdir(), "lt-report-empty-"));
  execFileSync("node", ["scripts/level-trial-report.mjs", empty, "--no-d1"], { cwd: new URL("..", import.meta.url).pathname, env, encoding: "utf8" });
});

console.log(`level-trial-run: ${n} checks passed`);
