#!/usr/bin/env node
// Backtest of the hidden warning-rule candidate `ground-rain` (lib/warningCandidates.mjs groundRain) on the ARCHIVE, against the live
// forecast on the SAME runs, scored with the KPI 1 / KPI 2 code of lib/forecastKpi.mjs (so "warned in time" and "false alarm" mean exactly
// what the nightly KPI means). MEASURES ONLY: nothing here is read by the site.
//
// usage: node --experimental-strip-types --no-warnings scripts/ground-rain-warning-backtest.mjs <archiveDir> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json out.json]
//   <archiveDir> holds the `data` branch layout: forecasts/YYYY/DAY.jsonl + .readings.json (scripts/forecast-archive.mjs) and hmis/rain/YYYY/DAY.json
//   (scripts/hmis-snapshot.mjs). Default window: every day that has BOTH a forecast archive and an HMIS rain file.
//
// How the inputs are rebuilt (nothing after the run time is used):
//   * ground gauges: the 4.5 h rolling state the live site keeps ([minute, 24 h sum] per gauge, lib/groundRain.ts), cut at the run time and at
//     1-3 h earlier (the 3 h hold). 1 h / 3 h totals are LOWER BOUNDS from the rolling 24 h sum. The archive keeps a gauge only while it has
//     rain (zeros only near the Colombo rain zones): a gauge with no earlier point in the state is taken as dry before its first point.
//   * catchment: lib/model/catchments.json cells (catchmentContains). Gauges with no catchment grid get no rule.
//   * "measured" comparison = the existing measured-rain warning (lib/measuredRain.ts: 25 mm / 1 h or 40 mm / 3 h at the gauge or any gauge above it
//     on the river, newest record <= 2 h) approximated with the HMIS copies of the Irrigation Department sensors (institute "Irrigation Department",
//     device "<Basin>_<Gauge>"), because the archive holds no ArcGIS `rain_fall`. HMIS gives only a rolling 24 h sum, so this under-reads a little.
//     The same fast / slow chance and lag as ground-rain are used, to show the effect of WHERE the rain is measured, not of another rule.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, colomboDay, daysBetween } from "../lib/forecastScoreboard.mjs";
import { POSSIBLE_P, isShortForecastGauge, shownChance } from "../lib/forecastRules.mjs";
import { buildContext, kpiSet, mergeReadings, crossingsFor, reachedWithin24h } from "../lib/forecastKpi.mjs";
import { PARAMS, catchmentContains, groundRain, warningCandidates } from "../lib/warningCandidates.mjs";
import { gaugeTotals } from "../lib/groundRain.ts";
import { BASIN_ORDER } from "../lib/basinOrder.ts";

const HOUR = 3_600_000, MIN = 60_000;
const args = process.argv.slice(2);
const dir = args[0];
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
if (!dir || dir.startsWith("--")) {
  console.error("usage: node --experimental-strip-types --no-warnings scripts/ground-rain-warning-backtest.mjs <archiveDir> [--from D] [--to D] [--json out.json]");
  process.exit(1);
}
const has = (kind, d) => existsSync(path.join(dir, kind === "f" ? "forecasts" : "hmis/rain", d.slice(0, 4), `${d}${kind === "f" ? ".jsonl" : ".json"}`));
const allDays = [];
for (const y of readdirSync(path.join(dir, "forecasts"))) for (const f of readdirSync(path.join(dir, "forecasts", y))) if (f.endsWith(".jsonl")) allDays.push(f.replace(".jsonl", ""));
allDays.sort();
const from = opt("--from") ?? allDays.find((d) => has("r", d)), to = opt("--to") ?? allDays[allDays.length - 1];
const days = daysBetween(from, to).filter((d) => has("f", d) && has("r", d));
if (!days.length) { console.error("no day with both a forecast archive and an HMIS rain file"); process.exit(1); }

// ---- load
const lines = [], readingFiles = [];
for (const d of daysBetween(addDays(days[0], -1), days[days.length - 1])) {
  const fd = path.join(dir, "forecasts", d.slice(0, 4));
  if (existsSync(path.join(fd, `${d}.readings.json`))) readingFiles.push(JSON.parse(readFileSync(path.join(fd, `${d}.readings.json`), "utf8")));
  if (days.includes(d)) lines.push(...readFileSync(path.join(fd, `${d}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
const dev = new Map(); // device -> { device, n, i, lat, lon, pts: [[ms, mm24]] }
for (const d of daysBetween(addDays(days[0], -1), days[days.length - 1])) {
  const f = path.join(dir, "hmis", "rain", d.slice(0, 4), `${d}.json`);
  if (!existsSync(f)) continue;
  for (const [id, e] of Object.entries(JSON.parse(readFileSync(f, "utf8")))) {
    const x = dev.get(id) ?? { device: id, n: e.name, i: e.institute, lat: e.lat, lon: e.lon, pts: [] };
    x.pts.push(...e.pts);
    dev.set(id, x);
  }
}
for (const x of dev.values()) { x.pts.sort((a, b) => a[0] - b[0]); x.pts = x.pts.filter((p, i) => i === 0 || p[0] !== x.pts[i - 1][0]); }

/** The 4.5 h state of one gauge at time t, as the live site keeps it ([epoch minute, 24 h sum]); null when the gauge has no point in it. */
function stateOf(d, t) {
  const pts = d.pts.filter((p) => p[0] <= t && p[0] > t - 4.5 * HOUR);
  if (!pts.length) return null;
  const first = pts[0], m = pts.map((p) => [Math.floor(p[0] / MIN), p[1]]);
  const seed = first[0] > t - 4.5 * HOUR + 30 * MIN && first[1] > 0 && !d.pts.some((p) => p[0] < first[0] && p[0] > first[0] - 24 * HOUR);
  return seed ? [[Math.floor((t - 4.5 * HOUR) / MIN), 0], ...m] : m;
}
/** hist[j] = the gauge's totals as they stood j hours before t. */
function histOf(d, t) {
  return [0, 1, 2, 3].map((j) => {
    const st = stateOf(d, t - j * HOUR);
    const g = st && gaugeTotals(st, t - j * HOUR);
    return g ? { ageMin: g.ageMin, mm1h: g.mm1h, mm3h: g.mm3h } : null;
  });
}

// ---- variants: name -> { p (thresholds), pick(station, line) -> devices[], rules (groundRain params) }
const base = PARAMS.groundRain;
const withMarks = (mm1h, mm3h, extra = {}) => ({ ...base, mm1h, mm3h, ...extra });
const withRise = (rise) => ({ ...base, rules: base.rules.map((r) => ({ ...r, rise })) });
const inCatch = (st) => [...dev.values()].filter((d) => catchmentContains(st, d.lat, d.lon));
const irrChain = (st, line) => {
  const basin = line.basin.trim(), order = BASIN_ORDER[basin] ?? [], i = order.indexOf(st);
  const chain = i >= 0 ? order.slice(0, i + 1) : [st];
  return chain.map((g) => dev.get(`${basin}_${g}`)).filter((d) => d && d.i === "Irrigation Department");
};
const VAR = {
  "ground-rain": { p: base, pick: inCatch },
  "ground-rain-wide": { p: PARAMS.groundRainWide, pick: inCatch }, // the candidate of 10 Nov 2026: fast-river distance gate opened
  "ground 15/25": { p: withMarks(15, 25), pick: inCatch },
  "ground 20/30": { p: withMarks(20, 30), pick: inCatch },
  "ground 30/50": { p: withMarks(30, 50), pick: inCatch },
  "ground + rising": { p: withRise(true), pick: inCatch },
  "ground 1 h mark only": { p: withMarks(25, 1e9), pick: inCatch },
  "measured (Irrigation)": { p: { ...base, maxAgeMin: 120 }, pick: irrChain },
};

// ---- candidate rows per run
const stat = Object.fromEntries(Object.keys(VAR).map((v) => [v, { fired: 0, stations: new Set(), days: new Set() }]));
let selfCheck = 0;
for (const l of lines) l.candidates = {}; // every run is "logged": no row = same as live
const merged = mergeReadings(readingFiles);
for (const l of lines) {
  if (l.method !== "model" || l.current_level == null) continue;
  const t = l.issued_at, r = merged[l.station];
  if (!r) continue;
  const snapshot = { [l.station]: { unit: l.unit, readings: r.pts.filter((p) => p.ts <= t + 5000 && p.ts >= t - 12 * HOUR).map((p) => ({ ts: p.ts, level: p.level })) } };
  const crossings = (l.crossings ?? []).map((c) => ({ threshold: c.threshold, level: c.level, probability: c.probability }));
  const live = (th) => { const c = crossings.find((x) => x.threshold === th); return c ? shownChance(th, c.probability) : 0; };
  const histCache = new Map();
  for (const [name, v] of Object.entries(VAR)) {
    const devs = v.pick(l.station, l);
    if (!devs.length) continue;
    const ground = devs.map((d) => ({ name: d.n, lat: d.lat, lon: d.lon, hist: histCache.get(d.device) ?? (histCache.set(d.device, histOf(d, t)), histCache.get(d.device)) }));
    const gr = groundRain(snapshot, t, { [l.station]: ground }, v.p)[l.station];
    if (!gr) continue;
    const shown = shownChance(gr.threshold, gr.chance);
    if (shown > live(gr.threshold) + 1e-9) {
      (l.candidates[name] ??= []).push({ threshold: gr.threshold, shown, eta: gr.etaHours, gauge: gr.gauge, mm: gr.rainMm, hours: gr.hours });
      stat[name].fired++; stat[name].stations.add(l.station); stat[name].days.add(l.day);
    }
    if (name === "ground-rain") { // the module's own entry point must agree with the direct call
      const full = warningCandidates({ station: l.station, method: "model", currentLevel: l.current_level, asOfTs: t, crossings, rate3hM: null, rain: null, rainBy: null, ground, snapshot });
      const a = JSON.stringify((full["ground-rain"] ?? []).map((x) => [x.threshold, x.shown])), b = JSON.stringify((l.candidates[name] ?? []).slice(-1).map((x) => [x.threshold, x.shown]));
      if (a !== b) throw new Error(`warningCandidates and groundRain disagree at ${l.station} ${new Date(t).toISOString()}: ${a} vs ${b}`);
      selfCheck++;
    }
    if (name === "ground-rain-wide") {
      const full = warningCandidates({ station: l.station, method: "model", currentLevel: l.current_level, asOfTs: t, crossings, rate3hM: null, rain: null, rainBy: null, ground, snapshot });
      const a = JSON.stringify((full["ground-rain-wide"] ?? []).map((x) => [x.threshold, x.shown])), b = JSON.stringify((l.candidates[name] ?? []).slice(-1).map((x) => [x.threshold, x.shown]));
      if (a !== b) throw new Error(`warningCandidates and groundRain (wide) disagree at ${l.station} ${new Date(t).toISOString()}: ${a} vs ${b}`);
    }
  }
}
// ---- score
const ctx = buildContext({ lines, readings: merged, versions: [] });
const inWin = new Set(days);
const events = ctx.events.filter((e) => inWin.has(e.day));
const runsInWin = ctx.runs.filter((r) => inWin.has(r.day));
const sel = (r) => inWin.has(r.day);
const byStation = new Map();
for (const r of runsInWin) if (r.usable && !r.flagged && !r.noForecast && r.model) (byStation.get(r.station) ?? byStation.set(r.station, []).get(r.station)).push(r);
const GAP = 3 * HOUR;
function leadOf(e, variant) {
  const rs = byStation.get(e.station);
  if (!rs) return null;
  let i = rs.length - 1;
  while (i >= 0 && rs[i].ts >= e.ts) i--;
  if (i < 0 || e.ts - rs[i].ts > GAP) return null;
  const shownAt = (r) => crossingsFor(ctx, r, variant).find((c) => c.t === e.threshold)?.shown ?? 0;
  if (shownAt(rs[i]) < POSSIBLE_P) return 0;
  let j = i;
  while (j - 1 >= 0 && rs[j].ts - rs[j - 1].ts <= GAP && shownAt(rs[j - 1]) >= POSSIBLE_P) j--;
  return (e.ts - rs[j].ts) / HOUR;
}
const needOf = (e) => (isShortForecastGauge(e.station) ? 2 : e.threshold === "alert" ? 6 : 12);
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const f1 = (v) => (v == null ? "-" : (Math.round(v * 10) / 10).toString());

const scored = events.map((e) => ({ e, live: leadOf(e, null) })).filter((x) => x.live != null);
const liveCaught = scored.filter((x) => x.live >= needOf(x.e));
console.log(`Window ${days[0]} .. ${days[days.length - 1]} (${days.length} days, ${runsInWin.length} runs, ${lines.length} lines; ${selfCheck} runs cross-checked against warningCandidates()).`);
console.log(`Crossings in the window: ${events.length} (alert ${events.filter((e) => e.threshold === "alert").length}, minor ${events.filter((e) => e.threshold === "minor").length}, major ${events.filter((e) => e.threshold === "major").length}); scored (a model run within 3 h before): ${scored.length}; of which fast-river ${scored.filter((x) => isShortForecastGauge(x.e.station)).length}.`);
console.log(`Live warned in time: ${liveCaught.length} of ${scored.length}\n`);

const kp = (variant) => {
  const k = kpiSet(ctx, { sel, variant: ctx.runs.some((r) => r.cand?.[variant]) ? variant : null });
  return k;
};
const rows = [];
for (const name of Object.keys(VAR)) {
  const sc = scored.map((x) => ({ ...x, v: leadOf(x.e, name) }));
  const caught = sc.filter((x) => x.v >= needOf(x.e));
  const added = sc.filter((x) => x.v >= needOf(x.e) && x.live < needOf(x.e));
  const gained = sc.filter((x) => x.v > x.live + 1e-9).map((x) => x.v - x.live);
  const k = stat[name].fired ? kpiSet(ctx, { sel, variant: name }) : null;
  const k2 = k?.[1];
  const fa = (d) => (d ? d.possible.didNot + d.likely.didNot : 0);
  rows.push({
    variant: name, fired: stat[name].fired, stations: [...stat[name].stations].join(", ") || "-", caught: caught.length, added: added.length,
    addedList: added.map((x) => `${x.e.station} ${x.e.threshold} ${new Date(x.e.ts + 5.5 * HOUR).toISOString().slice(5, 16).replace("T", " ")} (live ${f1(x.live)} h -> ${f1(x.v)} h)`),
    medianLeadGainedH: med(gained), nGained: gained.length,
    faLive: k2 ? fa(k2.baseline.detail) : null, faVar: k2 ? fa(k2.detail) : null,
    warnsLive: k2 ? k2.baseline.detail.possible.n + k2.baseline.detail.likely.n : null, warnsVar: k2 ? k2.detail.possible.n + k2.detail.likely.n : null,
    kpi1: k?.[0]?.value ?? null, kpi1Live: k?.[0]?.baseline.value ?? null, kpi2Possible: k2?.parts[0].value ?? null, kpi2PossibleLive: k2?.baseline.parts[0].value ?? null,
  });
}
console.log("variant | runs with a row | caught in time (live " + liveCaught.length + "/" + scored.length + ") | added | median lead gained (n) | false-alarm groups live -> variant | warnings live -> variant | KPI1 % live -> variant | KPI2 'possible' did-not-happen % live -> variant");
for (const r of rows) console.log([r.variant, r.fired, `${r.caught}/${scored.length}`, r.added, `${f1(r.medianLeadGainedH)} h (${r.nGained})`, `${r.faLive ?? "-"} -> ${r.faVar ?? "-"}`, `${r.warnsLive ?? "-"} -> ${r.warnsVar ?? "-"}`, `${f1(r.kpi1Live)} -> ${f1(r.kpi1)}`, `${f1(r.kpi2PossibleLive)} -> ${f1(r.kpi2Possible)}`].join(" | "));
console.log("\nTriggers per variant (stations):");
for (const r of rows) console.log(`  ${r.variant}: ${r.stations}`);
console.log("\nCrossings the variant added (caught in time, live was not):");
for (const r of rows) if (r.addedList.length) console.log(`  ${r.variant}: ${r.addedList.join("; ")}`);

// ---- every scored crossing: live lead, ground-rain lead, heaviest ground rain in the catchment in the 6 h before
console.log("\nEvery scored crossing (times Sri Lanka): station step time | fast | need h | live lead | ground-rain lead | ground-rain-wide lead | measured lead | max 1 h / 3 h ground mm in catchment in the 6 h before (lower bounds)");
for (const x of scored) {
  const e = x.e, devs = inCatch(e.station);
  let m1 = 0, m3 = 0;
  for (let h = 0; h <= 6; h += 0.5) for (const d of devs) {
    const st = stateOf(d, e.ts - h * HOUR), g = st && gaugeTotals(st, e.ts - h * HOUR);
    if (g && g.ageMin <= 180) { m1 = Math.max(m1, g.mm1h ?? 0); m3 = Math.max(m3, g.mm3h ?? 0); }
  }
  const rl = ctx.runs.filter((r) => r.station === e.station && r.ts < e.ts && e.ts - r.ts < 24 * HOUR).slice(-1)[0];
  console.log(`  ${e.station} ${e.threshold} ${new Date(e.ts + 5.5 * HOUR).toISOString().slice(5, 16).replace("T", " ")} | ${isShortForecastGauge(e.station) ? "fast" : "big"} | ${needOf(e)} | ${f1(x.live)} | ${f1(leadOf(e, "ground-rain"))} | ${f1(leadOf(e, "ground-rain-wide"))} | ${f1(leadOf(e, "measured (Irrigation)"))} | ${f1(m1)} / ${f1(m3)} (${devs.length} gauges)${rl?.storm ? " storm-flag" : ""}`);
}
// ---- trigger episodes of ground-rain: what the river did in the 24 h after (the same test KPI 2 uses)
console.log("\nground-rain rows grouped per gauge and day (first run .. last run, Sri Lanka time): gauge | day | rows | rain (gauge, mm in window) | live shown at first row | reached alert within 24 h of the first row");
{
  const groups = new Map();
  for (const l of lines) for (const w of l.candidates["ground-rain"] ?? []) { const k = `${l.station}|${l.day}`; (groups.get(k) ?? groups.set(k, []).get(k)).push({ l, w }); }
  const hhmm = (ms) => new Date(ms + 5.5 * HOUR).toISOString().slice(11, 16);
  for (const [k, g] of groups) {
    const first = g[0], run = ctx.runs.find((r) => r.station === first.l.station && r.ts === first.l.issued_at);
    const lvl = ctx.steps[first.l.station]?.alert;
    const hit = lvl == null ? null : reachedWithin24h(ctx, run, lvl);
    const liveC = run?.crossings.find((c) => c.t === "alert")?.shown ?? 0;
    console.log(`  ${k.replace("|", " | ")} | ${g.length} | ${hhmm(first.l.issued_at)}..${hhmm(g[g.length - 1].l.issued_at)} | ${first.w.gauge} ${first.w.mm} mm/${first.w.hours} h | ${f1(liveC)} | ${hit == null ? "unknown" : hit ? "YES" : "no"}`);
  }
}
// what the existing rain_risk (measured) flag was on the runs
const rr = lines.filter((l) => l.rain_risk);
console.log(`\nRuns with the live measured heavy-rain warning (rain_risk): ${rr.length} on ${[...new Set(rr.map((l) => l.station))].join(", ") || "-"}`);

if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify({ window: days, events: events.length, scored: scored.length, liveCaught: liveCaught.length, rows }, null, 1));
