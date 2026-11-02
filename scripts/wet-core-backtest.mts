// @ts-nocheck (node strip-types script)
// Backtest of the HIDDEN shadow variant `wet-core` (lib/model/wetCore.mjs) on the forecast ARCHIVE. MEASURES ONLY: nothing here is read by the site.
// Three arms per run: LOGGED (the satellite-only forecast the site produced then), GAUGE-FIRST (what is live since d0c0ec6: gauge means per zone, guard
// >= 2 gauges at >= 20 mm) and WET-CORE (gauge-first + the wet-core floor on the rise). Wet-core is judged against gauge-first.
// The replay (inputs rebuilt at the run time, the storm branch mirrored with the production maths) is the one of scripts/gauge-first-rain-backtest.mts; read
// its header for what is and is not replayed. The wet-core step itself needs only the gauges' 24 h totals at the run time and the gauge's own readings of
// the 24 h before the run (nothing after the run is used).
//
// usage: node --experimental-strip-types --no-warnings scripts/wet-core-backtest.mts <archiveDir> [--beta B] [--peak-h H] [--all-gauges] [--sweep] [--json out.json]
//   --sweep   also prints the beta sweep, the leave-one-gauge-out and the leave-one-day-out fits.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadArchive } from "./forecast-data.mjs";
import { groundRainSeries, switchOnAllowed, zonesFrom } from "../lib/model/gaugeRain.mjs";
import { BETA, PEAK_H, applyWetCore, wetCore, wetCoreRise, wetCoreScale } from "../lib/model/wetCore.mjs";
import { isStormHour4, rainTotals, stormFeatures, stormFeatures4, tier4Bin, v4Rain } from "../lib/model/stormModel.mjs";

const HOUR = 3_600_000;
const HS = [1, 3, 6, 12, 24];
const here = path.dirname(new URL(import.meta.url).pathname);
const J = (f) => JSON.parse(readFileSync(path.join(here, "../lib/model", f), "utf8"));
const CATCH = J("catchments.json"), SUBC = J("subcatchments.json"), S3 = J("storm-model.json"), S4 = J("storm-model-v4.json");
const STORM_MAX_CORR = 2; // lib/forecast.ts

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
if (!dir) { console.error("usage: node --experimental-strip-types --no-warnings scripts/gauge-first-rain-backtest.mts <archiveDir> [--from D] [--to D] [--stations A,B] [--hanwella-detail] [--json out.json]"); process.exit(1); }

// ------------------------------------------------------------------------------------------------ load
const csvRows = (txt) => { const [h, ...ls] = txt.trim().split("\n"); const cols = h.split(","); return ls.map((l) => { const m = l.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")); return Object.fromEntries(cols.map((c, i) => [c, m[i]])); }); };
const files = (sub, ext) => { const out = []; const d = path.join(dir, sub); if (!existsSync(d)) return out; for (const y of readdirSync(d)) { const yd = path.join(d, y); if (!/^\d{4}$/.test(y)) continue; for (const f of readdirSync(yd)) if (f.endsWith(ext)) out.push(path.join(yd, f)); } return out.sort(); };

const runs = [];
for (const f of files("forecasts", ".jsonl")) for (const l of readFileSync(f, "utf8").split("\n")) if (l) { const r = JSON.parse(l); if (r.horizons?.length) runs.push(r); }
const from = opt("--from") ? Date.parse(opt("--from") + "T00:00:00Z") : Date.parse("2026-10-27T00:00:00Z");
const to = opt("--to") ? Date.parse(opt("--to") + "T00:00:00Z") + 24 * HOUR : Infinity;
const readings = loadArchive(dir);

// satellite: endMs -> { key: mm }
const satByEnd = new Map();
for (const f of files("gsmap/hourly", ".jsonl")) for (const l of readFileSync(f, "utf8").split("\n")) if (l) { const o = JSON.parse(l); satByEnd.set(Date.parse(o.end), o.mm); }
// Open-Meteo: hourEnd -> Map(point -> mm), later files win
const omBy = new Map();
for (const f of files("rain", ".csv")) for (const o of csvRows(readFileSync(f, "utf8"))) { if (o.mm === "" || o.mm == null) continue; const t = Date.parse(o.time_utc); let m = omBy.get(t); if (!m) omBy.set(t, (m = new Map())); m.set(o.point, +o.mm); }
// HMIS ground gauges: the EXACT live state at each run. scripts/hmis-snapshot.mjs commits hmis/rain-live.json to the data branch every ~30 minutes
// (every live gauge with [epoch minute, 24 h sum] for the last 4.5 h, dry gauges included); <archiveDir>/rain-live/<commit time>.json holds each commit's copy
// (make them with: git log origin/data --format='%h %cI' -- hmis/rain-live.json, then git show "${sha}:hmis/rain-live.json"). The live site folds in the newest
// HMIS point on top of this; that is not replayed (it can only make the state a few minutes fresher).
const liveStates = [];
{
  const d = path.join(dir, "rain-live");
  if (existsSync(d)) for (const f of readdirSync(d).sort()) {
    const j = JSON.parse(readFileSync(path.join(d, f), "utf8"));
    const t = Date.parse(j.updatedAt ?? f.replace(".json", ""));
    liveStates.push({ t, devices: Object.entries(j.devices ?? {}).filter(([, e]) => e && Number.isFinite(e.lat) && Number.isFinite(e.lon) && Array.isArray(e.pts)).map(([id, e]) => ({ n: String(e.n ?? id), i: String(e.i ?? ""), lat: e.lat, lon: e.lon, pts: e.pts })) });
  }
  liveStates.sort((a, b) => a.t - b.t);
}
function gaugesAt(t) {
  let best = null;
  for (const s of liveStates) { if (s.t <= t && t - s.t <= 90 * 60_000) best = s; else if (s.t > t) break; }
  return best ? best.devices : null; // null = no state file within 90 minutes before the run: the live site would have used the satellite only
}

function actualAt(station, t) {
  const s = readings[station];
  if (!s) return null;
  let lo = 0, hi = s.length - 1;
  if (!hi || t < s[0].ts || t > s[hi].ts) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].ts <= t) lo = m; else hi = m; }
  const a = s[lo], b = s[hi];
  if (b.ts - a.ts > 2 * HOUR) return null;
  return b.ts === a.ts ? a.wl : a.wl + ((b.wl - a.wl) * (t - a.ts)) / (b.ts - a.ts);
}

// ------------------------------------------------------------------------------------------------ the production storm branch, mirrored
function stormSteps(station, origin, r4, omFull, groundGate, gate4 = S4.gate, allow4 = true) {
  const sm = S3.stations[station], m4 = S4.stations[station];
  const out = new Map();
  const rAt3 = (k) => omFull[origin + k * HOUR];
  const tot = rainTotals(rAt3);
  const heaviest = Math.max(tot.past24 ?? 0, tot.next24 ?? 0);
  const stormOn = !!sm && (heaviest >= S3.gate || groundGate);
  const stormOn4 = !!r4 && allow4 && isStormHour4(r4.rFull, gate4, S4.burstMm3h);
  for (const h of HS) {
    const sh = sm?.horizons[String(h)], sh4 = m4?.horizons[String(h)];
    const pooled = S3.pooled[String(h)], pooled4 = S4.pooled[String(h)];
    if (stormOn4 && r4 && sh4?.use && pooled4) {
      const x = stormFeatures4(r4.rFull, r4.rNear, r4.rUp, h, m4.lags);
      if (x) {
        const cap = STORM_MAX_CORR * m4.scale;
        const corr = Math.max(-cap, Math.min(cap, m4.scale * (pooled4.b0 + pooled4.w.reduce((a, w, j) => a + w * x[j], 0))));
        const bin = tier4Bin(r4.rFull), bf = S4.bandFactor[String(h)] ?? 1;
        const q10 = sh4.band ? sh4.band.q10[bin] : m4.scale * pooled4.q10[bin] * bf;
        const q90 = sh4.band ? sh4.band.q90[bin] : m4.scale * pooled4.q90[bin] * bf;
        out.set(h, { kind: "v4", corr, q10: Math.min(q10, 0), q90: Math.max(q90, 0) });
        continue;
      }
    }
    if (stormOn && sh?.use && pooled) {
      const x = stormFeatures(rAt3, h, sm.win);
      if (x) {
        const cap = STORM_MAX_CORR * sm.scale;
        const corr = Math.max(-cap, Math.min(cap, sm.scale * (pooled.b0 + pooled.w.reduce((a, w, j) => a + w * x[j], 0))));
        const bin = heaviest >= 100 ? 1 : 0, bf = S3.bandFactor[String(h)] ?? 1;
        const q10 = sh.band ? sh.band.q10[bin] : sm.scale * pooled.q10[bin] * bf;
        const q90 = sh.band ? sh.band.q90[bin] : sm.scale * pooled.q90[bin] * bf;
        out.set(h, { kind: "v3", corr, q10: Math.min(q10, 0), q90: Math.max(q90, 0) });
      }
    }
  }
  return { steps: out, stormOn4, stormOn, past24: tot.past24 };
}

// ------------------------------------------------------------------------------------------------ replay: prepare once, evaluate per parameter set
const num = (f, d) => (opt(f) != null ? +opt(f) : d);
const P0 = { beta: num("--beta", BETA), peakH: num("--peak-h", PEAK_H), all: args.includes("--all-gauges") }; // --all-gauges: ignore the eligibility rule (experiment)
const zoneMean = (cells, t) => {
  const m = omBy.get(t);
  if (!m || !cells?.length) return undefined;
  let s = 0;
  for (const [la, lo] of cells) { const v = m.get(`${la},${lo}`); if (v == null) return undefined; s += v; }
  return s / cells.length;
};
const wanted = opt("--stations")?.split(",");
const day = (ts) => new Date(ts + 5.5 * HOUR).toISOString().slice(0, 10); // Sri Lanka day
const base24 = (st, t) => { // the lowest reading of the 24 h up to the run (what the live site has in trend24h)
  const s = readings[st]; if (!s) return null;
  let m = null;
  for (const p of s) if (p.ts <= t && p.ts >= t - 24 * HOUR && p.wl != null && (m == null || p.wl < m)) m = p.wl;
  return m;
};
const rate3At = (st, t) => { // level change over the last 3 h (m), from the readings up to the run; null when no reading near t - 3 h
  const s = readings[st]; if (!s) return null;
  const last = [...s].reverse().find((p) => p.ts <= t); if (!last) return null;
  const back = s.filter((p) => Math.abs(p.ts - (t - 3 * HOUR)) <= 40 * 60_000 && p.ts <= t).sort((a, b) => Math.abs(a.ts - (t - 3 * HOUR)) - Math.abs(b.ts - (t - 3 * HOUR)))[0];
  return back ? last.wl - back.wl : null;
};
const preps = [];
for (const run of runs) {
  const st = run.station;
  if (run.issued_at < from || run.issued_at >= to) continue;
  if (!S4.stations[st] || (wanted && !wanted.includes(st))) continue;
  const zones = zonesFrom(CATCH, SUBC, st);
  if (!zones || S4.stations[st].unit !== run.unit) continue;
  const origin = Math.floor(run.issued_at / HOUR) * HOUR;
  const key = `${zones.basin}/${st}`;
  const arr = (suffix) => Array.from({ length: 96 }, (_, i) => { const m = satByEnd.get(origin - HOUR - (95 - i) * HOUR); const v = m?.[key + suffix]; return typeof v === "number" ? v : null; });
  const sat = { hourlyEnd: origin - HOUR, hourly: arr(""), hourlyNear: zones.near ? arr("#near") : null, hourlyUp: zones.up ? arr("#up") : null };
  if (sat.hourly[95] == null) continue;
  const omS = { full: {}, near: {}, up: {} };
  let omOk = true;
  for (let k = -71; k <= 24; k++) {
    const T = origin + k * HOUR;
    const f = zoneMean(zones.full, T);
    if (f === undefined) { if (k >= 1) { omS.full[T] = 0; omS.near[T] = 0; omS.up[T] = 0; continue; } if (k >= -23) omOk = false; continue; }
    omS.full[T] = f;
    const n = zoneMean(zones.near ?? zones.full, T); if (n !== undefined) omS.near[T] = n;
    const u = zoneMean(zones.up, T); if (u !== undefined) omS.up[T] = u;
  }
  if (!omOk) continue;
  const k4 = S4.stations[st].bias.k;
  const om = { full: omS.full, near: omS.near, up: omS.up };
  const rOld = v4Rain(sat, k4, S4.clipMmPerHour, origin, om);
  if (!rOld) continue;
  const shapeFn = (a) => (a ? (k) => { const v = a[95 - (-1 - k)]; return typeof v === "number" ? v : null; } : undefined);
  const gs = gaugesAt(run.issued_at);
  const g = gs ? groundRainSeries({ gauges: gs, origin, zones, sat: { full: shapeFn(sat.hourly), near: shapeFn(sat.hourlyNear), up: shapeFn(sat.hourlyUp) } }) : null;
  const guardOk = !!g && switchOnAllowed(g.used);
  const A = stormSteps(st, origin, rOld, omS.full, false);
  const rGf = g ? v4Rain(sat, k4, S4.clipMmPerHour, origin, om, g) : rOld;
  const B = stormSteps(st, origin, rGf, omS.full, guardOk && g.past24Full != null && g.past24Full >= S3.gate, S4.gate, !g || guardOk || A.stormOn4);
  // gauge-first horizons for this run: the logged level with the old storm correction swapped for the gauge-first one
  const gfHz = run.horizons.filter((hz) => HS.includes(hz.h)).map((hz) => {
    const a = A.steps.get(hz.h), b = B.steps.get(hz.h);
    const lvl = hz.level - (a?.corr ?? 0) + (b?.corr ?? 0);
    return b ? { h: hz.h, ts: hz.ts, level: lvl, low: lvl + b.q10, high: lvl + b.q90 } : { h: hz.h, ts: hz.ts, level: lvl, low: hz.low + (lvl - hz.level), high: hz.high + (lvl - hz.level) };
  });
  preps.push({ run, st, core: g ? wetCore(g.used) : wetCore([]), scale: wetCoreScale(S4.stations[st]), allScale: S4.stations[st].scale, base0: base24(st, run.issued_at), rate3: rate3At(st, run.issued_at), gfHz, A, B, day: day(run.issued_at) });
}

function evaluate(p) {
  const rows = [], info = [];
  for (const c of preps) {
    const { run, st } = c;
    const rise = wetCoreRise(c.core, p.all ? c.allScale : c.scale, p);
    const wcHz = applyWetCore(c.gfHz, c.base0, rise, p.peakH);
    info.push({ station: st, ts: run.issued_at, day: c.day, recent3: c.core.recent3, rate3: c.rate3, active: c.core.active && (p.all ? c.allScale : c.scale) > 0, rise, core24: c.core.core24, mean24: c.core.mean24, gfOn: c.B.stormOn4 || c.B.stormOn, L0: run.current_level });
    for (const hz of run.horizons) {
      const h = hz.h;
      if (!HS.includes(h)) continue;
      const actual = actualAt(st, hz.ts);
      if (actual == null) continue;
      const gf = c.gfHz.find((x) => x.h === h), wc = wcHz.find((x) => x.h === h);
      rows.push({ station: st, ts: run.issued_at, day: c.day, h, L0: run.current_level, actual, oldLevel: hz.level, oldLow: hz.low, oldHigh: hz.high, gfLevel: gf.level, gfLow: gf.low, gfHigh: gf.high, wcLevel: wc.level, wcLow: wc.low, wcHigh: wc.high, active: c.core.active && (p.all ? c.allScale : c.scale) > 0, gfOn: !!c.B.steps.get(h), changed: Math.abs(wc.level - gf.level) > 1e-9, up: wc.level - gf.level });
    }
  }
  return { rows, info };
}

// ------------------------------------------------------------------------------------------------ report
const r3 = (v) => (v == null || !Number.isFinite(v) ? "  n/a" : v.toFixed(3));
const pct = (v) => (v == null ? "  n/a" : `${Math.round(v * 100)}%`.padStart(4));
function stats(rs) {
  const n = rs.length;
  if (!n) return null;
  const mae = (f) => rs.reduce((s, r) => s + Math.abs(r[f] - r.actual), 0) / n;
  const bias = (f) => rs.reduce((s, r) => s + (r[f] - r.actual), 0) / n;
  const cov = (lo, hi) => rs.filter((r) => r.actual >= r[lo] && r.actual <= r[hi]).length / n;
  const width = (lo, hi) => rs.reduce((s, r) => s + (r[hi] - r[lo]), 0) / n;
  return { n, mae: { old: mae("oldLevel"), gf: mae("gfLevel"), wc: mae("wcLevel") }, bias: { old: bias("oldLevel"), gf: bias("gfLevel"), wc: bias("wcLevel") },
    cov: { old: cov("oldLow", "oldHigh"), gf: cov("gfLow", "gfHigh"), wc: cov("wcLow", "wcHigh") }, width: { old: width("oldLow", "oldHigh"), gf: width("gfLow", "gfHigh"), wc: width("wcLow", "wcHigh") } };
}
function table(title, rs, byH = true) {
  console.log(`\n${title}`);
  console.log("  h      n | MAE logged  gauge-first  wet-core | bias gf   wc | cover logged  gf  wc | width gf    wc");
  const line = (lab, s) => console.log(`  ${lab} ${String(s.n).padStart(5)} |  ${r3(s.mae.old)}     ${r3(s.mae.gf)}      ${r3(s.mae.wc)} | ${r3(s.bias.gf)} ${r3(s.bias.wc)} |   ${pct(s.cov.old)}   ${pct(s.cov.gf)} ${pct(s.cov.wc)} | ${r3(s.width.gf)} ${r3(s.width.wc)}`);
  if (byH) for (const h of HS) { const s = stats(rs.filter((r) => r.h === h)); if (s) line(String(h).padStart(3), s); }
  const s = stats(rs);
  if (s) line("all", s); else console.log("  (no rows)");
}
const P = P0;
const { rows, info } = evaluate(P);
console.log(`Wet-core backtest. Params: ${JSON.stringify(P)}. Runs replayed: ${preps.length}; scored run x horizon rows: ${rows.length}. Units: station units (m). Days are Sri Lanka days.`);
const byDay = {};
for (const i of info) { const d = (byDay[i.day] ??= { runs: 0, active: 0, stations: new Set(), rows: 0, changed: 0 }); d.runs++; if (i.active) { d.active++; d.stations.add(i.station); } }
for (const r of rows) { const d = byDay[r.day]; d.rows++; if (r.changed) d.changed++; }
console.log("\nPer day: runs | wet core active | rows scored | rows wet-core raised | stations active");
for (const [d, x] of Object.entries(byDay).sort()) console.log(`  ${d} ${String(x.runs).padStart(5)} ${String(x.active).padStart(5)} ${String(x.rows).padStart(6)} ${String(x.changed).padStart(5)}  ${[...x.stations].join(", ")}`);
table("ALL rows", rows);
table("Rows where wet-core raised the answer", rows.filter((r) => r.changed));
table("Rows on runs where the wet core is active (the only rows wet-core can touch)", rows.filter((r) => r.active));
table("STORM rows: a storm model on in gauge-first (live)", rows.filter((r) => r.gfOn));
table("CALM rows: wet core not active (identical by construction)", rows.filter((r) => !r.active));
const calmDays = Object.entries(byDay).filter(([, x]) => x.active === 0).map(([d]) => d).sort();
console.log(`\nDays with no active wet core at all: ${calmDays.join(", ") || "none"}. Wet-core output on those days is identical to gauge-first by construction (${rows.filter((r) => calmDays.includes(r.day) && r.changed).length} rows changed).`);
// false raises: wet-core lifted the answer by >= 5 cm at a row where the river then did NOT end up above the live answer (the raise made it worse)
const worse = rows.filter((r) => r.changed && Math.abs(r.wcLevel - r.actual) > Math.abs(r.gfLevel - r.actual));
const better = rows.filter((r) => r.changed && Math.abs(r.wcLevel - r.actual) < Math.abs(r.gfLevel - r.actual));
console.log(`Rows raised: ${rows.filter((r) => r.changed).length} (gauge-days ${new Set(rows.filter((r) => r.changed).map((r) => r.station + r.day)).size}); closer to the outcome: ${better.length}; farther: ${worse.length}.`);
const falseRaise = rows.filter((r) => r.changed && r.wcLevel > r.actual + 0.25);
console.log(`Over-raises (wet-core answer more than 25 cm ABOVE the outcome): ${falseRaise.length} rows on ${new Set(falseRaise.map((r) => r.station + " " + r.day)).size} gauge-days: ${[...new Set(falseRaise.map((r) => `${r.station} ${r.day}`))].join("; ")}`);
console.log("\nPer gauge, rows raised: n | MAE gauge-first -> wet-core | bias gf -> wc");
for (const st of [...new Set(rows.filter((r) => r.changed).map((r) => r.station))].sort()) {
  const rs = rows.filter((r) => r.changed && r.station === st), s = stats(rs);
  console.log(`  ${st.padEnd(26)} ${String(s.n).padStart(4)} | ${r3(s.mae.gf)} -> ${r3(s.mae.wc)} | ${r3(s.bias.gf)} -> ${r3(s.bias.wc)}`);
}
for (const st of ["Hanwella", "Glencourse"]) {
  const win = rows.filter((r) => r.station === st && r.ts >= Date.parse("2026-11-01T11:00:00Z") && r.ts <= Date.parse("2026-11-01T19:00:00Z"));
  console.log(`\n${st} storm window 1 Nov 11:00-19:00Z, by run (UTC): actual | logged | gauge-first | wet-core (levels m; x3.281 = ft)`);
  for (const t of [...new Set(win.map((r) => r.ts))]) {
    const f = info.find((i) => i.station === st && i.ts === t);
    console.log(`${new Date(t).toISOString().slice(11, 16)}Z core ${f.core24?.toFixed(0) ?? "-"} mean ${f.mean24?.toFixed(0) ?? "-"} rise ${f.rise.toFixed(2)}: ` + win.filter((r) => r.ts === t && r.h >= 6).map((r) => `+${r.h}h ${r.actual.toFixed(2)}|${r.oldLevel.toFixed(2)}|${r.gfLevel.toFixed(2)}|${r.wcLevel.toFixed(2)}`).join("  "));
  }
  table(`${st} storm window 1 Nov 11:00-19:00Z`, win);
  table(`${st} 1 Nov (Sri Lanka day), all rows`, rows.filter((r) => r.station === st && r.day === "2026-11-01"));
}

// ---- beta sweep, leave-one-gauge-out, leave-one-day-out
if (args.includes("--sweep")) {
  const grid = [0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.06];
  const ev = Object.fromEntries(grid.map((b) => [b, evaluate({ ...P, beta: b })]));
  const maeOf = (rs, f = "wcLevel") => (rs.length ? rs.reduce((s, r) => s + Math.abs(r[f] - r.actual), 0) / rs.length : NaN);
  console.log("\nBETA sweep (0 = today's gauge-first). MAE (m) on: active-core rows with h >= 6 | Hanwella+Glencourse storm window | rows raised | rows over-raised by > 25 cm | calm-day rows changed");
  for (const b of grid) {
    const rs = ev[b].rows, act = rs.filter((r) => r.active && r.h >= 6);
    const hg = rs.filter((r) => (r.station === "Hanwella" || r.station === "Glencourse") && r.ts >= Date.parse("2026-11-01T11:00:00Z") && r.ts <= Date.parse("2026-11-01T19:00:00Z") && r.h >= 6);
    console.log(`  beta ${b.toFixed(3)}  ${r3(maeOf(act))} | ${r3(maeOf(hg))} | ${String(rs.filter((r) => r.changed).length).padStart(4)} | ${String(rs.filter((r) => r.changed && r.wcLevel > r.actual + 0.25).length).padStart(3)} | ${rs.filter((r) => calmDays.includes(r.day) && r.changed).length}`);
  }
  // choose beta on training rows = active-core rows with h >= 6 outside the held-out unit; ties -> smaller beta
  const pick = (keep) => {
    let best = null;
    for (const b of grid) { const m = maeOf(ev[b].rows.filter((r) => r.active && r.h >= 6 && keep(r))); if (m >= 0 && (best == null || m < best.m - 1e-9)) best = { b, m }; }
    return best;
  };
  const loo = (label, units, unitOf) => {
    console.log(`\nLeave-one-${label}-out: beta chosen on the other ${label}s' active-core rows (h >= 6), scored on the held-out ${label}'s active-core rows (MAE gauge-first -> wet-core)`);
    let n = 0, g = 0, w = 0;
    for (const u of units) {
      const best = pick((r) => unitOf(r) !== u);
      if (!best) continue;
      const te = ev[best.b].rows.filter((r) => r.active && r.h >= 6 && unitOf(r) === u);
      if (!te.length) continue;
      const mg = maeOf(te, "gfLevel"), mw = maeOf(te, "wcLevel");
      n += te.length; g += mg * te.length; w += mw * te.length;
      console.log(`  ${String(u).padEnd(26)} beta ${best.b.toFixed(3)} rows ${String(te.length).padStart(4)}: ${r3(mg)} -> ${r3(mw)}${mw < mg - 1e-9 ? "  better" : mw > mg + 1e-9 ? "  WORSE" : ""}`);
    }
    console.log(`  pooled held-out: ${n} rows: ${r3(g / n)} -> ${r3(w / n)}`);
  };
  loo("gauge", [...new Set(rows.filter((r) => r.active).map((r) => r.station))].sort(), (r) => r.station);
  loo("day", [...new Set(rows.filter((r) => r.active).map((r) => r.day))].sort(), (r) => r.day);
}
if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify({ params: P, info, rows }));
