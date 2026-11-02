// @ts-nocheck (node strip-types script)
// Backtest of GAUGE-FIRST catchment rain for the river-level forecast (lib/model/gaugeRain.mjs) against the satellite-only rain the live
// forecast used, on the forecast ARCHIVE. MEASURES ONLY: nothing here is read by the site.
//
// usage: node --experimental-strip-types --no-warnings scripts/gauge-first-rain-backtest.mts <archiveDir> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//                [--stations Hanwella,Glencourse,...] [--hanwella-detail] [--json out.json]
//   <archiveDir> = the `data` branch layout: forecasts/YYYY/DAY.jsonl (every hourly run: level, 80% band per horizon), YYYY/DAY.csv (readings),
//   gsmap/hourly/YYYY/DAY.jsonl (satellite rain per catchment/zone/hour), rain/YYYY/DAY.csv (Open-Meteo per grid point), hmis/rain/YYYY/DAY.json
//   (HMIS gauges: [epoch ms, rolling 24 h sum]). Make one with: git archive origin/data forecasts 2026 gsmap/hourly rain hmis/rain | tar -x -C <dir>
//
// HOW A RUN IS REPLAYED. The logged run holds the level and band the live site produced (old = satellite rain). The storm correction is the only part
// the rain changes, so the NEW level is  logged level - correction(old rain) + correction(new rain), where both corrections are worked out here with the
// production maths (stormModel.mjs, the same model files, a mirror of the storm branch of gaugeSteps in lib/forecast.ts). Where a storm model is on in the
// new arm its range is the storm range of the model file (as live); where it is off in the new arm but was on in the logged run, the logged range is only
// shifted. Everything else (gauge-only base, other gauges, bands off the storm path, chances) is untouched.
// INPUTS REBUILT AT THE RUN TIME (nothing after the run is used, except as stated):
//   * satellite: gsmap/hourly hours that END at or before (forecast hour - 1 h) (the newest satellite hour is not out yet, stormModel.mjs v4Rain), raw, then
//     the production bias factor and clip.
//   * HMIS gauges: the live state rebuilt from the archive = the points of the last 4.5 h ([minute, 24 h sum]) up to the run time. The archive keeps a gauge
//     only while its 24 h sum is above zero, so a gauge with NO points in the window while ~100+ others reported counts as dry (24 h sum 0). That is what the
//     live state file shows (it lists dry gauges too). Gauges never seen in the archive are unknown and absent.
//   * Open-Meteo rain (rain/ csv): the weather model's hour k = 0 and the forecast hours k >= 1 come from the LATEST file value for that hour, i.e. closer to
//     what fell than what was forecast at run time (a "perfect forecast" for the future hours). Both arms get the same future, so it cancels in the comparison
//     but it makes the storm gate fire on forecast rain more than live did. Future hours the archive does not hold yet (runs in the last 24 h before
//     the newest rain file) are taken as dry, which is the conservative end for both arms. The heavier (p90) scenario and the measured-heavy gate are not replayed.
//   * actual levels: the readings csv, linear between the neighbours either side of (run + h), at most 2 h apart.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadArchive } from "./forecast-data.mjs";
import { groundRainSeries, switchOnAllowed, zonesFrom } from "../lib/model/gaugeRain.mjs";
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

// ------------------------------------------------------------------------------------------------ replay
const zoneMean = (cells, t) => { // Open-Meteo mean over the zone's cells for the hour ending t (null if any cell is missing)
  const m = omBy.get(t);
  if (!m || !cells?.length) return undefined;
  let s = 0;
  for (const [la, lo] of cells) { const v = m.get(`${la},${lo}`); if (v == null) return undefined; s += v; }
  return s / cells.length;
};
const wanted = opt("--stations")?.split(",");
const rows = []; // one per run x horizon
const runInfo = [];
for (const run of runs) {
  const st = run.station;
  if (run.issued_at < from || run.issued_at >= to) continue;
  if (!S4.stations[st] || (wanted && !wanted.includes(st))) continue;
  const zones = zonesFrom(CATCH, SUBC, st);
  if (!zones) continue;
  if (S4.stations[st].unit !== run.unit) continue; // model units must be the run's units
  const origin = Math.floor(run.issued_at / HOUR) * HOUR;
  const key = `${zones.basin}/${st}`;
  // satellite file as at the run: hours ending <= origin - 1 h
  const arr = (suffix) => Array.from({ length: 96 }, (_, i) => { const m = satByEnd.get(origin - HOUR - (95 - i) * HOUR); const v = m?.[key + suffix]; return typeof v === "number" ? v : null; });
  const hasNear = zones.near && Object.keys([...satByEnd.values()][0] ?? {}).includes(key + "#near");
  const sat = { hourlyEnd: origin - HOUR, hourly: arr(""), hourlyNear: zones.near ? arr("#near") : null, hourlyUp: zones.up ? arr("#up") : null };
  const satUsable = sat.hourly[95] != null;
  // Open-Meteo: hour k = 0 and the future, plus the past for the v3 gate (k >= -71)
  const omS = { full: {}, near: {}, up: {} };
  let omOk = true, futureFilled = 0;
  for (let k = -71; k <= 24; k++) {
    const T = origin + k * HOUR;
    const f = zoneMean(zones.full, T);
    if (f === undefined) {
      if (k >= 1) { omS.full[T] = 0; omS.near[T] = 0; omS.up[T] = 0; futureFilled++; continue; } // not yet in the archive (it ends at the snapshot time): no more rain
      if (k >= -23) omOk = false;
      continue;
    }
    omS.full[T] = f;
    const n = zoneMean(zones.near ?? zones.full, T); if (n !== undefined) omS.near[T] = n;
    const u = zoneMean(zones.up, T); if (u !== undefined) omS.up[T] = u;
  }
  if (!omOk || !satUsable) continue; // no rain inputs for this run's hours: cannot replay
  const k4 = S4.stations[st].bias.k;
  const rOld = v4Rain(sat, k4, S4.clipMmPerHour, origin, { full: omS.full, near: omS.near, up: omS.up });
  if (!rOld) continue;
  const shapeFn = (a) => (a ? (k) => { const v = a[95 - (-1 - k)]; return typeof v === "number" ? v : null; } : undefined);
  const gs = gaugesAt(run.issued_at);
  const g = gs ? groundRainSeries({ gauges: gs, origin, zones, sat: { full: shapeFn(sat.hourly), near: shapeFn(sat.hourlyNear), up: shapeFn(sat.hourlyUp) } }) : null;
  const rNew = g ? v4Rain(sat, k4, S4.clipMmPerHour, origin, { full: omS.full, near: omS.near, up: omS.up }, g) : rOld;
  const gateMm = opt("--gate-mm") ? +opt("--gate-mm") : null; // experiment: a lower gauge-first gate than the model's own 40 mm (NOT production)
  const guardOk = !!g && switchOnAllowed(g.used);
  const groundGate = guardOk && !!g && g.past24Full != null && g.past24Full >= (gateMm ?? S3.gate);
  const A = stormSteps(st, origin, rOld, omS.full, false), B = stormSteps(st, origin, rNew, omS.full, groundGate, g && gateMm ? gateMm : S4.gate, !g || guardOk || A.stormOn4); // production guard: gauges may only switch ON with >= 2 gauges >= 20 mm
  const sum24 = (r) => { let s = 0; for (let k = -24; k <= -1; k++) s += r?.rFull(k) ?? 0; return s; };
  runInfo.push({ station: st, ts: run.issued_at, origin, liveStorm: !!run.storm, oldOn: A.stormOn4 || A.stormOn, newOn: B.stormOn4 || B.stormOn, rainOld: sum24(rOld), rainNew: sum24(rNew), gauges: g ? g.used.length : 0, ground24: g?.past24Full ?? null, L0: run.current_level });
  for (const hz of run.horizons) {
    const h = hz.h;
    if (!HS.includes(h)) continue;
    const actual = actualAt(st, hz.ts);
    if (actual == null) continue;
    const a = A.steps.get(h), b = B.steps.get(h);
    const cOld = a?.corr ?? 0, cNew = b?.corr ?? 0;
    const levelNew = hz.level - cOld + cNew;
    let lowNew, highNew;
    if (b) { lowNew = levelNew + b.q10; highNew = levelNew + b.q90; }
    else { lowNew = hz.low + (levelNew - hz.level); highNew = hz.high + (levelNew - hz.level); }
    rows.push({ station: st, ts: run.issued_at, h, L0: run.current_level, actual, oldLevel: hz.level, oldLow: hz.low, oldHigh: hz.high, newLevel: levelNew, newLow: lowNew, newHigh: highNew, oldOn: !!a, newOn: !!b, changed: !!a || !!b, flip: !!b && !a });
  }
}

// ------------------------------------------------------------------------------------------------ report
const r3 = (v) => (v == null || !Number.isFinite(v) ? "  n/a" : v.toFixed(3));
const pct = (v) => (v == null ? "  n/a" : `${Math.round(v * 100)}%`.padStart(4));
function stats(rs) {
  const n = rs.length;
  if (!n) return null;
  const mae = (f) => rs.reduce((s, r) => s + Math.abs(r[f] - r.actual), 0) / n;
  const cov = (lo, hi) => rs.filter((r) => r.actual >= r[lo] && r.actual <= r[hi]).length / n;
  const width = (lo, hi) => rs.reduce((s, r) => s + (r[hi] - r[lo]), 0) / n;
  return { n, maeOld: mae("oldLevel"), maeNew: mae("newLevel"), covOld: cov("oldLow", "oldHigh"), covNew: cov("newLow", "newHigh"), wOld: width("oldLow", "oldHigh"), wNew: width("newLow", "newHigh") };
}
function table(title, rs) {
  console.log(`\n${title}`);
  console.log("  h    n | MAE old  MAE new | cover old  new | width old  new");
  for (const h of HS) {
    const s = stats(rs.filter((r) => r.h === h));
    if (s) console.log(`  ${String(h).padStart(2)} ${String(s.n).padStart(5)} |  ${r3(s.maeOld)}   ${r3(s.maeNew)} |   ${pct(s.covOld)}  ${pct(s.covNew)} |   ${r3(s.wOld)}  ${r3(s.wNew)}`);
  }
  const s = stats(rs);
  if (s) console.log(`  all ${String(s.n).padStart(4)} |  ${r3(s.maeOld)}   ${r3(s.maeNew)} |   ${pct(s.covOld)}  ${pct(s.covNew)} |   ${r3(s.wOld)}  ${r3(s.wNew)}`);
}
const days = (a, b) => `${new Date(a).toISOString().slice(0, 10)} .. ${new Date(b).toISOString().slice(0, 10)}`;
console.log(`Gauge-first rain backtest. Runs replayed: ${runInfo.length} (${days(Math.min(...runInfo.map((r) => r.ts)), Math.max(...runInfo.map((r) => r.ts)))}); scored run x horizon rows: ${rows.length}. Units: station units (m).`);
const byStation = {};
for (const r of runInfo) { const s = (byStation[r.station] ??= { n: 0, withGauges: 0, oldOn: 0, newOn: 0, live: 0, agree: 0, flipOn: 0, flipOff: 0 }); s.n++; if (r.gauges) s.withGauges++; s.oldOn += +r.oldOn; s.newOn += +r.newOn; s.live += +r.liveStorm; s.agree += +(r.oldOn === r.liveStorm); s.flipOn += +(r.newOn && !r.oldOn); s.flipOff += +(!r.newOn && r.oldOn); }
console.log("\nRuns per gauge: with gauges in catchment / storm on (old replay, new, logged live) / replay-vs-live agreement / switched ON by gauges / switched OFF by gauges");
for (const [k, s] of Object.entries(byStation)) console.log(`  ${k.padEnd(18)} runs ${String(s.n).padStart(4)}  gauges ${String(s.withGauges).padStart(4)}  on: old ${String(s.oldOn).padStart(3)} new ${String(s.newOn).padStart(3)} live ${String(s.live).padStart(3)}  agree ${pct(s.agree / s.n)}  +on ${s.flipOn} -off ${s.flipOff}`);

table("ALL runs and gauges", rows);
table("Storm-affected rows (a storm model on in the old or the new replay)", rows.filter((r) => r.changed));
table("Rows where the gauges switched a storm model ON (off in the old replay)", rows.filter((r) => r.flip));
table("Rows where the gauges switched a storm model OFF (on in the old replay: the satellite storm was not backed by the gauges)", rows.filter((r) => r.oldOn && !r.newOn));
table("Rows where the gauge-first rain changed anything (level or range differs)", rows.filter((r) => Math.abs(r.newLevel - r.oldLevel) > 1e-9 || Math.abs(r.newLow - r.oldLow) > 1e-9 || Math.abs(r.newHigh - r.oldHigh) > 1e-9));
table("Calm rows (no storm model on in either arm: identical by construction)", rows.filter((r) => !r.changed));
for (const st of Object.keys(byStation)) { const rs = rows.filter((r) => r.station === st && r.changed); if (rs.length) table(`${st}: storm-affected rows`, rs); }

// false switch-ons: gauges turned a storm model on, but the river did not rise within the next 24 h (max actual rise < 10 cm) -- count and the error they add
const flipRuns = runInfo.filter((r) => r.newOn && !r.oldOn);
const calmFlips = [];
for (const r of flipRuns) {
  const rs = rows.filter((x) => x.station === r.station && x.ts === r.ts);
  const rise = Math.max(0, ...rs.map((x) => x.actual - x.L0));
  if (rise < 0.1) calmFlips.push({ ...r, rise, extraErr: rs.reduce((s, x) => s + Math.abs(x.newLevel - x.actual) - Math.abs(x.oldLevel - x.actual), 0) });
}
console.log(`\nSwitch-ons by gauges: ${flipRuns.length} runs; of these ${calmFlips.length} look false (the river rose less than 10 cm in the next 24 h).`);
for (const c of calmFlips.slice(0, 25)) console.log(`  ${c.station.padEnd(16)} ${new Date(c.ts).toISOString().slice(0, 16)}Z gauge 24h ${c.ground24?.toFixed(0)} mm vs satellite ${c.rainOld.toFixed(0)} mm  rise ${c.rise.toFixed(2)} m  net extra error ${c.extraErr.toFixed(3)} m (sum over horizons)`);
const offRuns = runInfo.filter((r) => !r.newOn && r.oldOn);
console.log(`Switch-offs by gauges (gauges dry/low while the satellite storm model was on): ${offRuns.length} runs`);

if (args.includes("--hanwella-detail") || !wanted) {
  console.log("\nHanwella, 31 Oct - 1 Nov, one run per hour (UTC). Levels in m (x3.281 = ft). Columns per horizon: actual | old (low-high) | new (low-high).");
  for (const ri of runInfo.filter((r) => r.station === "Hanwella" && r.ts >= Date.parse("2026-10-31T18:00:00Z") && r.ts <= Date.parse("2026-11-01T19:00:00Z"))) {
    const rs = rows.filter((x) => x.station === "Hanwella" && x.ts === ri.ts);
    const line = rs.map((x) => `+${x.h}h ${x.actual.toFixed(2)}|${x.oldLevel.toFixed(2)}(${x.oldLow.toFixed(2)}-${x.oldHigh.toFixed(2)})|${x.newLevel.toFixed(2)}(${x.newLow.toFixed(2)}-${x.newHigh.toFixed(2)})`).join("  ");
    console.log(`${new Date(ri.ts).toISOString().slice(5, 16)}Z L0 ${ri.L0} storm old/new ${ri.oldOn ? "on" : "off"}/${ri.newOn ? "on" : "off"} rain24 sat ${ri.rainOld.toFixed(0)} gauges ${ri.ground24 == null ? "-" : ri.ground24.toFixed(0)} mm: ${line}`);
  }
  const hw = rows.filter((r) => r.station === "Hanwella" && r.ts >= Date.parse("2026-10-31T18:00:00Z") && r.ts <= Date.parse("2026-11-01T19:00:00Z"));
  table("Hanwella 31 Oct 18:00Z - 1 Nov 19:00Z, all rows", hw);
  table("Hanwella same window, storm-affected rows only", hw.filter((r) => r.changed));
}
if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify({ runInfo, rows }));
