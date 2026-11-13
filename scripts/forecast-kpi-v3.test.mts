// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/forecast-kpi-v3.test.mts
// Spec 3 of the forecast KPIs (owner-approved 13 Nov 2026): lib/forecastKpi.mjs v3*, scripts/forecast-kpi.mjs -> kpi/v3. No network, no secrets, no packages.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOUR, buildReadings, colomboDay, dayStart } from "../lib/forecastScoreboard.mjs";
import { V3, buildContext, v3Bar, v3DayStats, v3JudgeNotice, v3Notice, v3Report, v3RiseCatch, v3StepLine, v3Sum, v3WindowExact } from "../lib/forecastKpi.mjs";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);
let checks = 0;
const ok = (name, fn) => { fn(); checks++; };

// ---------------------------------------------------------------- parity with the reference implementation (small synthetic cases)
// Expected numbers were computed with the lab's reference Python code for the same rules: per gauge-step bar at 2% of the calendar hours,
// a 5% floor, ties at the bar split in proportion; rise catch per river with the allowance on false hours.
ok("notice parity", () => {
  const run = (v, w, z, days) => {
    const hours = new Map([["g|alert", v.map((c, i) => ({ c, w: w[i] }))]]);
    const floods = z.map((x) => ({ s: "g", k: "alert", cls: "big", st: "scored", z: x }));
    const n = v3Notice(hours, floods, days).big;
    return { num: n.num, den: n.den, bar: v3Bar(hours.get("g|alert"), V3.X * 24 * days) };
  };
  // A: a bar inside the hours, two floods exactly at the bar (tie share 0.3): reference = 3.6 warned of 11, bar 0.4
  let r = run([.9, .7, .5, .5, .4, .3, .3, .3, .2, .2, .15, .1, .08, .06, .05, .04], [1, .5, 2, 1, 1, 1, .5, 1, 1, 3, 1, 1, 1, 1, 1, 1], [.95, .5, .4, .4, .25, .2, .06, .04, -1, .5, .3], 10);
  near(r.num, 3.6, 1e-9, "A warned"); assert.equal(r.den, 11); near(r.bar.bar, 0.4, 1e-12); near(r.bar.tie, 0.3, 1e-9);
  // B: fewer false-alarm hours than the allowance: every chance of at least 5% warns (reference 2 of 4)
  r = run([.3, .2, .1, .05], [1, 1, 1, 1], [.05, .04, .9, -1], 10);
  near(r.num, 2, 1e-12, "B warned"); assert.equal(r.den, 4);
  // C: many hours tied at the bar (reference 4.4 of 6, bar 0.2)
  r = run([.4, .4, .4, .4, .2, .2, .1], [1, 1, 1, 1, 1, 1, 1], [.4, .4, .2, .5, .1, .3], 10);
  near(r.num, 4.4, 1e-9, "C warned"); assert.equal(r.den, 6); near(r.bar.bar, 0.2, 1e-12);
});
ok("rise catch parity", () => {
  const rows = [[1,0.006,false,true],[1,0.017,false,true],[1,0.022,false,true],[1,0.035,false,true],[1,0.017,false,true],[1,0.033,false,true],[1,-0.047,false,true],[1,-0.008,false,true],[1,0.035,false,true],[1,0.008,false,true],[1,0.031,false,true],[1,-0.04,false,true],[1,-0.008,false,true],[1,-0.028,false,true],[1,-0.001,false,true],[1,0.002,false,true],[1,-0.049,false,true],[1,-0.03,false,true],[1,-0.025,false,true],[1,0.032,false,true],[1,0.019,false,true],[1,-0.036,false,true],[1,0.022,false,true],[1,-0.038,false,true],[1,0.006,false,true],[1,-0.039,false,true],[1,-0.05,false,true],[1,0.028,false,true],[1,-0.031,false,true],[1,-0.031,false,true],[1,0.038,false,true],[1,0.029,false,true],[1,-0.024,false,true],[1,0.037,false,true],[1,-0.001,false,true],[1,0.011,false,true],[1,-0.032,false,true],[1,0.035,false,true],[1,0.012,false,true],[1,0.037,false,true],[1,0.179,true,false],[1,0.06,true,false],[1,0.072,true,false],[1,0.033,true,false],[1,0.029,true,false],[1,0.013,true,false],[1,0.01,false,false],[1,0.01,false,false],[1,0.01,false,false],[1,0.01,false,false],[2,0.01,false,true],[2,-0.01,false,true],[2,-0.01,false,true],[2,0.0,false,true],[2,-0.01,false,true],[2,0.01,false,true],[2,0.0,false,true],[2,0.01,false,true],[2,0.01,false,true],[2,0.01,false,true],[2,0.02,false,true],[2,0.01,false,true],[2,0.0,false,true],[2,0.02,false,true],[2,0.02,false,true],[2,0.0,false,true],[2,0.0,false,true],[2,0.01,false,true],[2,0.0,false,true],[2,0.01,false,true],[2,0.02,false,true],[2,0.0,false,true],[2,-0.01,false,true],[2,0.02,false,true],[2,0.01,false,true],[2,0.02,true,false],[2,0.1,true,false],[2,0.0,true,false],[2,0.02,true,false],[2,0.0,true,false],[3,0.05,true,false],[3,0.05,true,false],[3,0.05,true,false]];
  const entries = rows.map(([g, rate, fast, still]) => ({ g, rate, fast: fast ? 1 : 0, still: still ? 1 : 0 }));
  near(v3RiseCatch(entries), 35.714285714285715, 1e-9, "rise catch"); // reference value; a river with no false hours catches nothing
  const flat = [];
  for (let i = 0; i < 1000; i++) flat.push({ g: 1, rate: 0.01, fast: i % 10 === 0 ? 1 : 0, still: i % 10 === 0 ? 0 : 1 });
  near(v3RiseCatch(flat), 10, 1e-9, "no information scores the chance level");
});

// ---------------------------------------------------------------- synthetic archive: one big river and one fast river, hourly runs, two floods each
const D0 = "2026-10-25";
const T0 = dayStart(D0);
const NH = 24 * 6; // runs per gauge: six Colombo days
const END = NH + 40; // readings run past the last run (24 h outcomes)
const FLOODS = { Big1: [50, 110], Holombuwa: [50, 110] };
const levelAt = (st, i) => {
  let v = 5 + (i % 2) * 0.01;
  for (const F of FLOODS[st] ?? []) {
    if (i >= F - 10 && i <= F + 2) v = 5 + 0.5 * (i - (F - 10));
    else if (i > F + 2 && i <= F + 12) v = Math.max(v, 11 - 0.5 * (i - (F + 2)));
  }
  return v;
};
const ALERT = 10, MINOR = 12, MAJOR = 14;
/** Hourly runs for the stations; chance(st, i, comesTrue) is what the forecaster states for the alert step. */
function archive(stations, chance, { minorP = () => 0, cross = null } = {}) {
  const lines = [], readings = {};
  for (const st of stations) {
    readings[st] = { unit: "ft", pts: Array.from({ length: END }, (_, i) => ({ ts: T0 + i * HOUR, level: levelAt(st, i) })) };
    for (let i = 0; i < NH; i++) {
      const cur = levelAt(st, i);
      let comes = false;
      for (let j = i + 1; j <= i + 24 && j < END; j++) if (levelAt(st, j) >= ALERT) comes = true;
      const c = cur >= ALERT ? 1 : chance(st, i, comes);
      const mk = (t, L, p) => ({ threshold: t, level: L, probability: Math.round(p * 20) / 20, p_model: p });
      const crossings = [mk("alert", ALERT, c), mk("minor", MINOR, minorP(st, i, comes)), mk("major", MAJOR, 0)];
      if (cross) cross(st, i, crossings);
      lines.push({
        station: st, basin: "B", issued_at: T0 + i * HOUR, method: "model", status: "ok", model_version: "v", unit: "ft", current_level: cur, tier: "normal", verdict: "normal", storm: 0, rain_risk: null,
        horizons: [], crossings, shadows: {}, max24: null, cover24: false,
      });
    }
  }
  return { lines, readings };
}
const ctxOf = ({ lines, readings }) => buildContext({ lines: lines.map((l) => ({ ...l, day: colomboDay(l.issued_at) })), readings });
const daysOf = (ctx) => [...new Set(ctx.runs.map((r) => r.day))].sort();
const noticeOf = (ctx) => { const { hoursByKey, floods } = v3WindowExact(ctx, daysOf(ctx)); return v3Notice(hoursByKey, floods, daysOf(ctx).length); };
const statsOf = (ctx) => daysOf(ctx).map((d) => v3DayStats(ctx, d, { final: true }));
const perfect = (st, i, comes) => (comes ? 1 : 0);

ok("a perfect forecaster reaches both targets and every record reads perfect", () => {
  const ctx = ctxOf(archive(["Big1", "Holombuwa"], perfect));
  assert.equal(ctx.events.length, 4, "the alert step is crossed twice per gauge; minor and major never");
  const n = noticeOf(ctx);
  assert.equal(n.big.notice, 100); assert.equal(n.fast.notice, 100);
  assert.ok(n.big.notice >= V3.TARGET.noticeBig && n.fast.notice >= V3.TARGET.noticeFast);
  assert.equal(n.big.scored, 2); assert.equal(n.fast.scored, 2);
  const rep = v3Report(v3Sum(statsOf(ctx)), { exact: v3WindowExact(ctx, daysOf(ctx)) });
  assert.equal(rep.spanDays, 6);
  const [tb, tf] = rep.targets;
  assert.equal(tb.pointAtOrAboveTarget, true); assert.equal(tf.pointAtOrAboveTarget, true);
  assert.equal(tb.met, null, "a 6-day window is never judged"); assert.equal(tf.met, null);
  assert.match(tb.status, /not judged/);
  // P1: warning showing at every lead; P4: no surprises; P2: no warning hour came to nothing
  for (const [type, leads] of Object.entries({ big: [12, 6, 3, 1], fast: [6, 3, 1] })) for (const L of leads) {
    const a = rep.public.p1[type][L].any;
    assert.deepEqual([a.rises, a.alreadyAtLevel, a.noLeadRun, a.warned, a.pct], [2, 0, 0, 2, 100], `${type} ${L} h`);
  }
  assert.equal(rep.public.p4.big.pct, 0); assert.equal(rep.public.p4.fast.pct, 0);
  assert.equal(rep.public.p2.big.notComeTrue, 0); assert.equal(rep.public.p2.fast.notComeTrue, 0);
  assert.equal(rep.public.p2.big.perGaugePer30Days, 0);
  const top = rep.public.p3.levels.alert.tiers.find((t) => t.tier === "5+in10");
  assert.equal(top.stated, 100); assert.equal(top.cameTrue, 100); assert.equal(top.gap, 0);
  const low = rep.public.p3.levels.alert.tiers.find((t) => t.tier === "<1in10");
  assert.equal(low.cameTrue, 0); assert.equal(low.verdict, "too few hours", "two small gauges: under 300 hours is never judged");
  // the day-file route gives the same Notice as the runs
  const viaDays = v3Report(v3Sum(statsOf(ctx)));
  assert.equal(viaDays.lab.notice.big.value, 100); assert.equal(viaDays.lab.notice.fast.value, 100);
});

ok("inflating the chances does not raise Notice (the bar moves with them), but it does raise the page-style records", () => {
  const graded = (mul) => (st, i, comes) => Math.min(0.98, (comes ? 0.2 + 0.5 * ((i * 13) % 7) / 6 : 0.05 + 0.25 * ((i * 37) % 11) / 10) * mul);
  const a = ctxOf(archive(["Big1", "Holombuwa"], graded(1)));
  const b = ctxOf(archive(["Big1", "Holombuwa"], graded(1.4)));
  const na = noticeOf(a), nb = noticeOf(b);
  assert.ok(na.big.notice > 0 && na.big.notice < 100, `a graded forecaster is neither perfect nor useless: ${na.big.notice}`);
  assert.equal(nb.big.notice, na.big.notice); assert.equal(nb.fast.notice, na.fast.notice);
  const ra = v3Report(v3Sum(statsOf(a))), rb = v3Report(v3Sum(statsOf(b)));
  assert.ok(rb.public.p2.big.warningHours > ra.public.p2.big.warningHours, "more hours show a warning");
  assert.ok(rb.public.p2.big.notComeTrue > ra.public.p2.big.notComeTrue, "and more of them come to nothing");
  // a forecaster with no information (chances unrelated to what happens) does not reach the targets
  const none = ctxOf(archive(["Big1", "Holombuwa"], (st, i) => 0.05 + 0.25 * ((i * 37) % 11) / 10));
  const nn = noticeOf(none);
  assert.ok(nn.big.notice < V3.TARGET.noticeBig && nn.fast.notice < V3.TARGET.noticeFast, `${nn.big.notice} ${nn.fast.notice}`);
  // the histogram path (rolling window) agrees with the runs
  near(rb.lab.notice.big.value, na.big.notice, 1e-9);
});

ok("the shown chance is the archived p_shown where the line has it, else recomputed and marked", () => {
  const fix = archive(["Big1", "Holombuwa"], perfect, { cross: (st, i, cr) => { if (st === "Holombuwa") cr[0].p_shown = 0.1; } });
  const ctx = ctxOf(fix);
  const r = ctx.runs.find((x) => x.station === "Holombuwa");
  assert.deepEqual([v3StepLine(r, "alert").shown, v3StepLine(r, "alert").shownSrc], [0.1, "archive"]);
  const rb = ctx.runs.find((x) => x.station === "Big1");
  assert.equal(v3StepLine(rb, "alert").shownSrc, "recomputed");
  const rep = v3Report(v3Sum(statsOf(ctx)));
  assert.equal(rep.public.p1.fast[6].any.warned, 0, "an archived shown chance of 10% is not a warning");
  assert.equal(rep.public.p1.big[12].any.warned, 2);
  assert.ok(rep.sources.shownArchive > 0 && rep.sources.shownRecomputed > 0);
  // the lab yardstick reads the model's own chance, not the shown one
  assert.equal(noticeOf(ctx).fast.notice, 100);
});

ok("hours at the display limit are a separate record, never judged", () => {
  const ctx = ctxOf(archive(["Big1"], perfect, { minorP: () => 0.9 }));
  const rep = v3Report(v3Sum(statsOf(ctx)));
  const minor = rep.public.p3.levels.minor;
  assert.ok(minor.atLimit.hours > 0, "a stated 90% shows as the 30% limit");
  assert.equal(minor.atLimit.cameTrue, 0);
  assert.ok(minor.tiers.every((t) => t.hours === 0 || t.tier === "<1in10"), "none of those hours sits in a judged tier");
  assert.equal(minor.verdict, "no claim");
});

ok("next hour: a rate that separates the rises from the quiet hours catches all of them; R1-R3 read what the tile said", () => {
  const lines = [], pts = [];
  const lv = (i) => (i % 4 === 1 ? 5.5 : 5 + (i % 2) * 0.01);
  for (let i = 0; i < END; i++) pts.push({ ts: T0 + i * HOUR, level: lv(i) });
  for (let i = 0; i < NH; i++) {
    const up = i % 4 === 0;
    lines.push({ station: "Nh1", basin: "B", issued_at: T0 + i * HOUR, method: "model", status: "ok", model_version: "v", unit: "ft", current_level: lv(i), tier: "normal", verdict: "normal", storm: 0, rain_risk: null,
      horizons: [], crossings: [], shadows: {}, max24: null, cover24: false, nh_rate_m_h: up ? 0.15 : -0.02, nh_word: up ? "rising" : "falling" });
  }
  const ctx = ctxOf({ lines, readings: { Nh1: { unit: "ft", pts } } });
  const rep = v3Report(v3Sum(statsOf(ctx)), { exact: v3WindowExact(ctx, daysOf(ctx)) });
  const nh = rep.nextHour;
  assert.equal(nh.riseCatchAt10PctFalseHours.value, 100);
  assert.equal(nh.records.R1_risingWhenRoseTenCm.pct, 100);
  assert.equal(nh.records.R2_risingFollowedByRise.pct, 100);
  near(nh.records.R3_hoursShowingRising.pct, 25, 0.5);
  assert.equal(nh.records.R3_hoursShowingRising.pctOfHoursWithoutARise, 0);
  assert.ok(nh.wordSource.archived > 0 && nh.wordSource.rebuiltByRulesOfTheDay === 0);
  assert.equal(v3Report(v3Sum(statsOf(ctx))).nextHour.riseCatchAt10PctFalseHours.value, 100, "binned day files agree");
});

// ---------------------------------------------------------------- targets: judged only with enough floods and storms in a rolling year
const mkFloods = (spec) => { // spec: [[stormNo, count, z]]
  const out = [];
  for (const [storm, n, z] of spec) for (let k = 0; k < n; k++) out.push({ s: "g", k: "alert", cls: "big", st: "scored", z, ts: Date.UTC(2026, 0, 1) + storm * 10 * 24 * HOUR + k * 3 * HOUR });
  return out;
};
ok("a target is judged only with a rolling year, 30 floods and 8 storms", () => {
  const J = (floods, span) => v3JudgeNotice({ cls: "big", hoursByKey: new Map(), floods, calDays: span, spanDays: span, target: 45 });
  const good = mkFloods(Array.from({ length: 10 }, (_, s) => [s, 4, 0.9])); // 40 floods, 10 storms, all warned
  assert.equal(J(good, 400).met, true);
  assert.equal(J(good, 100).met, null, "a short window");
  assert.equal(J(good.slice(0, 25), 400).met, null, "too few floods");
  assert.equal(J(mkFloods(Array.from({ length: 6 }, (_, s) => [s, 6, 0.9])), 400).met, null, "too few storms");
  assert.equal(J(mkFloods(Array.from({ length: 10 }, (_, s) => [s, 4, 0.04])), 400).met, false, "judged and below");
  // one storm holds more than 15% of the floods: met only if it also holds without that storm
  const oneStorm = mkFloods([[0, 20, 0.9], ...Array.from({ length: 9 }, (_, s) => [s + 1, 2, s < 1 ? 0.9 : 0.04]), [10, 2, 0.9]]); // 20 + 9x2 + 2 = 40 floods; 23 warned
  const j = J(oneStorm, 400);
  assert.ok(j.value >= 45 && j.valueWithoutLargestStorm < 45 && j.met === false && /without the largest storm/.test(j.status), JSON.stringify(j));
  // a short window never reads "met" even at the target (the point is reported)
  const s = J(good, 20);
  assert.equal(s.met, null); assert.equal(s.pointAtOrAboveTarget, true);
});

// ---------------------------------------------------------------- the nightly script: files, idempotent, spec 1 and 2 files present beside them
ok("scripts/forecast-kpi.mjs writes kpi/v3 beside the old files and re-runs byte for byte", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = mkdtempSync(path.join(tmpdir(), "kpi-v3-"));
  try {
    const fix = archive(["Big1", "Holombuwa"], perfect);
    const days = daysOf(ctxOf(fix));
    for (const d of days) {
      const f = path.join(dir, "forecasts", d.slice(0, 4));
      mkdirSync(f, { recursive: true });
      const dl = fix.lines.filter((l) => colomboDay(l.issued_at) === d).map((l) => ({ ...l, day: d }));
      writeFileSync(path.join(f, `${d}.jsonl`), dl.map((l) => JSON.stringify(l)).join("\n") + "\n");
      const obs = Object.fromEntries(Object.entries(fix.readings).map(([s, r]) => [s, r.pts]));
      writeFileSync(path.join(f, `${d}.readings.json`), JSON.stringify(buildReadings({ day: d, runs: dl, obs })));
    }
    const run = () => execFileSync("node", [path.join(here, "forecast-kpi.mjs"), dir, "--now", "2026-11-02T06:00:00Z", "--window", "10"], { encoding: "utf8", env: { ...process.env, GITHUB_SHA: "test", CLOUDFLARE_API_TOKEN: "" } });
    const out1 = run();
    assert.match(out1, /spec 3 /);
    const v3 = path.join(dir, "kpi", "v3");
    assert.ok(existsSync(path.join(v3, "latest.json")) && existsSync(path.join(dir, "kpi", "latest.json")) && existsSync(path.join(dir, "kpi", "v2", "latest.json")));
    const dayFiles = readdirSync(path.join(v3, "days")).sort();
    assert.equal(dayFiles.length, 6);
    const l3 = JSON.parse(readFileSync(path.join(v3, "latest.json"), "utf8"));
    assert.equal(l3.kpiSpec, 3);
    assert.equal(l3.window.days, 5, "the first loaded day is an edge day (its previous day is not in the archive): not summed");
    assert.deepEqual(l3.window.edge, [days[0]]);
    assert.equal(l3.rolling.calendarDays, 5);
    assert.equal(JSON.parse(readFileSync(path.join(dir, "kpi", "latest.json"), "utf8")).kpiSpec, 1);
    const snap = () => Object.fromEntries([...dayFiles.map((f) => [f, readFileSync(path.join(v3, "days", f), "utf8")]), ["latest", readFileSync(path.join(v3, "latest.json"), "utf8")]]);
    const a = snap();
    run();
    assert.deepEqual(snap(), a, "a second run the same night changes nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`forecast-kpi-v3: ${checks} groups passed`);
