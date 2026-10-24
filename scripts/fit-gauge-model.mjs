#!/usr/bin/env node
// Fits the gauge-only next-hours model (lib/model/gaugeModel.mjs) for every gauge and horizon 1/3/6 h,
// scores it OUT OF SAMPLE against "level stays put" and writes lib/model/gauge-model.json.
//
// usage: node scripts/fit-gauge-model.mjs [archiveDir] [--history all.json] [--out file] [--report file]
//   archiveDir  checkout/export of the `data` branch (default: git archive origin/data; `git fetch origin data` first)
//   --history   nuuuwan/lk_irrigation data/all.json (hourly gauge readings since 2025-11-23, MIT; metres).
//               Default: downloaded from raw.githubusercontent.com. Our own archive wins where both have a reading;
//               gauges the feed publishes in feet are converted back to feet (factor found from the overlap).
//
// Validation (nothing the score is computed on is used to fit or to choose):
//   1. Blocked 7-fold cross-validation over everything before the last 60 days (2 days purged around each fold).
//      Used to choose, per gauge and horizon, tide term yes/no and model-vs-persistence.
//   2. A holdout: the last 60 days, fitted on data before it. These are the numbers reported as "backtest".
//   3. Range (80% band) = empirical quantiles of the signed CV residuals in three volatility bins; its coverage
//      and width are measured on the holdout using only bins built from earlier data.
// Shipped coefficients are refitted on all data (residual quantiles from a CV over all data).
// Heavy-ish (a few CPU minutes); run it on the Mac mini per ~/.claude/CLAUDE.md if the laptop is busy.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GM_HORIZONS, fitL1, gaugeFeatures, predictLinear } from "../lib/model/gaugeModel.mjs";
import { interp, quantile } from "../lib/model/core.mjs";
import { exportDataBranch, loadArchive } from "./forecast-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const outFile = opt("--out") ?? path.join(here, "../lib/model/gauge-model.json");
const reportFile = opt("--report");
const skip = new Set(["--history", "--out", "--report"]);
const dir = args.find((a, i) => !a.startsWith("--") && !skip.has(args[i - 1])) ?? exportDataBranch();
const H = 3_600_000;
const HOLD_H = 60 * 24;

// ---- data -------------------------------------------------------------------------------------
let histFile = opt("--history");
if (!histFile) {
  histFile = path.join(mkdtempSync(path.join(tmpdir(), "sl-hist-")), "all.json");
  execFileSync("curl", ["-sfL", "-o", histFile, "https://raw.githubusercontent.com/nuuuwan/lk_irrigation/main/data/all.json"], { stdio: "inherit" });
}
const ours = loadArchive(dir);
const stationList = JSON.parse(readFileSync(path.join(dir, "stations.json"), "utf8"));
const basinOf = {}, unitOf = {};
for (const s of stationList) { basinOf[s.station.trim()] = (s.basin ?? "").trim(); unitOf[s.station.trim()] = s.Unit ?? null; }
const by = {};
for (const r of JSON.parse(readFileSync(histFile, "utf8"))) {
  if (r.water_level_m == null) continue;
  (by[r.station_name.trim()] ??= []).push({ ts: r.time_ut * 1000, wl: r.water_level_m });
}
const series = {}, factor = {};
for (const g of Object.keys(by)) {
  by[g].sort((a, b) => a.ts - b.ts);
  const o = ours[g];
  let k = 1;
  if (o) {
    const m = new Map(by[g].map((p) => [Math.round(p.ts / 120000), p.wl]));
    const rs = [];
    for (const p of o) { const v = m.get(Math.round(p.ts / 120000)); if (v != null && p.wl > 0.2) rs.push(v / p.wl); }
    rs.sort((a, b) => a - b);
    if (rs.length > 10 && Math.abs(rs[rs.length >> 1] - 0.3048) < 0.02) k = 0.3048;
  } else if (unitOf[g] === "ft") k = 0.3048;
  factor[g] = k;
  const start = o ? o[0].ts : Infinity;
  const merged = by[g].map((p) => ({ ts: p.ts, wl: p.wl / k })).filter((p) => p.ts < start - 60000).concat(o ?? []);
  const d = [];
  for (const p of merged) if (!d.length || p.ts - d.at(-1).ts >= 60000) d.push(p);
  series[g] = d;
}
const gauges = Object.keys(series).filter((g) => basinOf[g]);
const t0 = Math.ceil(Math.min(...gauges.map((g) => series[g][0].ts)) / H) * H;
const t1 = Math.floor(Math.max(...gauges.map((g) => series[g].at(-1).ts)) / H) * H;
const N = (t1 - t0) / H + 1;
const L = {};
for (const g of gauges) {
  const a = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) { const v = interp(series[g], t0 + i * H); if (v != null) a[i] = v; }
  L[g] = a;
}
const cover = (g) => L[g].reduce((s, v) => s + (Number.isFinite(v) ? 1 : 0), 0) / N;
const ctx = { level: (g, t) => { const v = L[g]?.[Math.round((t - t0) / H)]; return Number.isFinite(v) ? v : null; } };
const hold0 = N - HOLD_H;

// ---- helpers ----------------------------------------------------------------------------------
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const mae = (P) => mean(P.map((r) => Math.abs(r.y - r.p)));
const tercileEdges = (vols) => { const s = [...vols].sort((a, b) => a - b); return [quantile(s, 1 / 3), quantile(s, 2 / 3)]; };
const binOf = (e, v) => { let b = 0; while (b < e.length && v >= e[b]) b++; return b; };
function bandsFrom(rows, edges) {
  const out = { q10: [], q90: [] };
  const all = rows.map((r) => r.y - r.p).sort((a, b) => a - b);
  for (let b = 0; b <= edges.length; b++) {
    const rs = rows.filter((r) => binOf(edges, r.vol) === b).map((r) => r.y - r.p).sort((a, c) => a - c);
    const src = rs.length >= 100 ? rs : all;
    out.q10.push(quantile(src, 0.1));
    out.q90.push(quantile(src, 0.9));
  }
  return out;
}
const K = 7;
/** Blocked CV: returns out-of-sample rows {i,y,p,vol} for samples S within [from, to). */
function blockedCv(S, from, to, fit) {
  const rows = [];
  const fl = Math.floor((to - from) / K);
  for (let k = 0; k < K; k++) {
    const lo = from + k * fl, hi = k === K - 1 ? to : lo + fl;
    const tr = S.filter((r) => r.i >= from && r.i < to && (r.i < lo - 48 || r.i >= hi + 48));
    const te = S.filter((r) => r.i >= lo && r.i < hi);
    if (tr.length < 300 || !te.length) continue;
    const m = fit(tr);
    for (const r of te) rows.push({ i: r.i, y: r.y, p: predictLinear(m, r.x), vol: r.vol });
  }
  return rows;
}
const fitS = (S) => fitL1(S.map((r) => r.x), S.map((r) => r.y));

const upOf = (g) => gauges.filter((u) => u !== g && basinOf[u] === basinOf[g] && cover(u) > 0.7);
function samples(g, up, tide, h, i0 = 12) {
  const S = [];
  for (let i = i0; i < N - h; i++) {
    const y = L[g][i + h] - L[g][i];
    if (!Number.isFinite(y)) continue;
    const f = gaugeFeatures(g, up, tide, ctx, t0 + i * H, h);
    if (f && f.x.every(Number.isFinite)) S.push({ i, x: f.x, y, vol: f.vol });
  }
  return S;
}
/** Steady threshold for direction scoring: 0.02 ft, in the gauge's unit. */
const steadyThr = (g) => (factor[g] === 0.3048 || unitOf[g] === "ft" ? 0.02 : 0.02 * 0.3048);

// ---- run --------------------------------------------------------------------------------------
const stations = {}, report = [];
const r3 = (v) => (typeof v === "number" ? +v.toPrecision(5) : v);
for (const g of gauges.sort()) {
  const unit = factor[g] === 0.3048 || unitOf[g] === "ft" ? "ft" : "m";
  const dense = cover(g) > 0.7;
  const up = dense ? upOf(g) : [];
  const horizons = {};
  for (const h of GM_HORIZONS) {
    let hm;
    if (!dense) {
      // Intermittent gauge: persistence with the empirical change distribution as the range, one bin.
      const ys = [];
      for (let i = 0; i < N - h; i++) { const y = L[g][i + h] - L[g][i]; if (Number.isFinite(y)) ys.push(y); }
      ys.sort((a, b) => a - b);
      hm = { skilled: false, tide: false, b0: 0, w: [], edges: [], q10: [quantile(ys, 0.1)], q90: [quantile(ys, 0.9)], n: ys.length, backtest: {} };
      horizons[h] = hm;
      continue;
    }
    // choose tide yes/no on the pre-holdout CV
    const cand = {};
    for (const tide of [false, true]) {
      const S = samples(g, up, tide, h);
      const cv = blockedCv(S, 0, hold0 - 48, fitS);
      cand[tide] = { S, cv, mae: mae(cv) };
    }
    const tide = cand[true].mae < 0.95 * cand[false].mae;
    const { S, cv } = cand[tide];
    const persCv = mean(cv.map((r) => Math.abs(r.y)));
    // holdout: fit before it, score on it
    const trS = S.filter((r) => r.i < hold0 - 48), teS = S.filter((r) => r.i >= hold0);
    const mH = fitS(trS);
    const ho = teS.map((r) => ({ i: r.i, y: r.y, p: predictLinear(mH, r.x), vol: r.vol }));
    const persHo = mean(ho.map((r) => Math.abs(r.y)));
    const maeCv = mae(cv), maeHo = mae(ho);
    const skilled = maeCv <= 0.97 * persCv && maeHo <= 0.97 * persHo;
    // range bins built from pre-holdout CV residuals; scored on the holdout
    const rowsFor = (rows) => rows.map((r) => ({ ...r, p: skilled ? r.p : 0 }));
    const edgesPre = tercileEdges(cv.map((r) => r.vol));
    const bandPre = bandsFrom(rowsFor(cv), edgesPre);
    const hoP = rowsFor(ho);
    const cov = mean(hoP.map((r) => { const b = binOf(edgesPre, r.vol); return r.y - r.p >= bandPre.q10[b] && r.y - r.p <= bandPre.q90[b] ? 1 : 0; }));
    const width = mean(hoP.map((r) => { const b = binOf(edgesPre, r.vol); return bandPre.q90[b] - bandPre.q10[b]; }));
    const W = 1.15; // lib/forecast.ts GM_WIDEN
    const cov115 = mean(hoP.map((r) => { const b = binOf(edgesPre, r.vol); return r.y - r.p >= bandPre.q10[b] * W && r.y - r.p <= bandPre.q90[b] * W ? 1 : 0; }));
    const thr = steadyThr(g);
    const dir = (d) => (Math.abs(d) < thr ? 0 : Math.sign(d));
    const moving = hoP.filter((r) => Math.abs(r.y) >= thr);
    const dirMoving = moving.length ? mean(moving.map((r) => (dir(r.p) === dir(r.y) ? 1 : 0))) : NaN;
    const dirAll = mean(hoP.map((r) => (dir(r.p) === dir(r.y) ? 1 : 0)));
    const dirAllPers = mean(hoP.map((r) => (dir(0) === dir(r.y) ? 1 : 0)));
    // shipped: refit on everything, range from a CV over everything
    const mAll = fitS(S);
    const cvAll = blockedCv(S, 0, N - h, fitS);
    const edges = tercileEdges(cvAll.map((r) => r.vol));
    const bands = bandsFrom(rowsFor(cvAll), edges);
    hm = {
      skilled, tide, b0: r3(mAll.b0), w: mAll.w.map(r3), edges: edges.map(r3), q10: bands.q10.map(r3), q90: bands.q90.map(r3), n: S.length,
      backtest: {
        cvN: cv.length, cvMae: r3(maeCv), cvPersMae: r3(persCv),
        holdN: ho.length, holdMae: r3(maeHo), holdPersMae: r3(persHo),
        holdShippedMae: r3(skilled ? maeHo : persHo),
        coverage80: r3(cov), width80: r3(width), coverage80Widened: r3(cov115), width80Widened: r3(width * W),
        dirMovingHold: r3(dirMoving), dirAllHold: r3(dirAll), dirAllPersHold: r3(dirAllPers), movingN: moving.length,
      },
    };
    horizons[h] = hm;
    report.push({ g, unit, h, tide, skilled, ...hm.backtest });
    console.log(`${g.padEnd(26)} ${unit} ${h}h ${skilled ? "MODEL" : "pers "}${tide ? "+tide" : "     "} cv ${maeCv.toFixed(4)}/${persCv.toFixed(4)} hold ${maeHo.toFixed(4)}/${persHo.toFixed(4)} (${(100 * (1 - maeHo / persHo)).toFixed(0)}%) cov80 ${(100 * cov).toFixed(0)}% width ${width.toFixed(3)} dir(moving) ${(100 * dirMoving).toFixed(0)}%`);
  }
  stations[g] = { unit, basin: basinOf[g], up, horizons };
}
const json = {
  version: 1,
  fittedAt: new Date().toISOString(),
  trainRange: [t0, t1],
  holdoutDays: HOLD_H / 24,
  source: "Dept of Irrigation ArcGIS feed: this repo's data branch + github.com/nuuuwan/lk_irrigation (hourly, MIT)",
  stations,
};
writeFileSync(outFile, JSON.stringify(json) + "\n");
console.log(`wrote ${outFile}`);
if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 1));
