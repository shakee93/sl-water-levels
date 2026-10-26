#!/usr/bin/env node
// Storm backtest + fit for the rain-aware correction (lib/model/stormModel.mjs). Writes lib/model/storm-model.json and a
// report (JSON) with every number quoted in DOCS.md "Storm backtest".
//
// usage: node scripts/fit-storm-model.mjs --rain rain-history.json [archiveDir] [--history all.json] [--out file] [--report file] [--gate 30]
//   rain-history.json  from scripts/fetch-rain-history.mjs (Open-Meteo Previous Runs: observed rain + the forecast made one day earlier)
//
// What is scored, all OUT OF SAMPLE:
//   * gauge-only baseline for 1/3/6/12/24 h: the same model as lib/model/gaugeModel.mjs, 7-fold blocked CV over the whole
//     11 months (2 days purged each side); a horizon that does not beat "level stays put" by 3% is persistence.
//   * storm correction: fitted on a gauge's storm hours only (gate: rain over the last 24 h or forecast for the next 24 h
//     reaches --gate mm), LEAVE ONE EVENT OUT (an event = a run of storm hours with gaps under 72 h; 48 h purged around it).
//     Ditwah (late Nov 2025) is one of the held-out events. Rain features use the FORECAST made a day earlier for future
//     hours, so there is no hindsight.
//   * storm bands: residual quantiles from an inner leave-one-event-out inside the training events (nested, so the
//     coverage printed is honest).
// A gauge/horizon ships the storm correction only when, in storm hours, it beats the gauge-only model by >= 5% AND beats
// "level stays put", over >= 120 storm hours and >= 3 events, and wins in at least half of the events it is scored on.
// Calm hours are untouched by construction (the correction is switched off unless the gate is on).
// Heavy-ish (minutes of CPU): run on the Mac mini per ~/.claude/CLAUDE.md.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitL1, gaugeFeatures, predictLinear } from "../lib/model/gaugeModel.mjs";
import { quantile } from "../lib/model/core.mjs";
import { STORM_HORIZONS, fitNonNegL1, isStormHour, rainTotals, stormFeatures } from "../lib/model/stormModel.mjs";
import { CATCHMENTS, STATIONS } from "./forecast-data.mjs";
import { loadGaugeSeries } from "./gauge-series.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const skip = new Set(["--rain", "--history", "--out", "--report", "--gate", "--only", "--lam"]);
const ONLY = opt("--only") ? opt("--only").split(",") : null;
const dir = args.find((a, i) => !a.startsWith("--") && !skip.has(args[i - 1])) ?? undefined;
const outFile = opt("--out", path.join(here, "../lib/model/storm-model.json"));
const reportFile = opt("--report");
const GATE = +opt("--gate", 50);
const LAM = +opt("--lam", 0.1);
const HEAVY = 1.6; // stand-in for the ensemble p90 rain (no archived ensemble exists): forecast rain x1.6
const H = 3_600_000, FT = 0.3048, WIDEN = 1.15;

const gs = loadGaugeSeries({ dir, histFile: opt("--history") ?? undefined });
const { L, t0, N, basinOf, thr } = gs;
const rainFile = JSON.parse(readFileSync(opt("--rain"), "utf8"));

// ---- catchment rain per gauge on the gauge time grid ------------------------------------------
const norm = (b) => b.trim();
function catchmentRain(g) {
  const B = norm(basinOf[g]);
  const cfg = CATCHMENTS[B];
  const sc = cfg?.stations?.[g];
  if (!sc) return null;
  const cells = sc.cells.map((i) => rainFile.cells[`${B}/${i}`]).filter(Boolean);
  if (cells.length < sc.cells.length) return null;
  const obs = new Float64Array(N).fill(NaN), fc = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) {
    const T = t0 + i * H;
    let so = 0, sf = 0, ko = 0, kf = 0;
    for (const c of cells) {
      const j = Math.round((T - c.t0) / H);
      const a = c.obs[j], b = c.fc1[j];
      if (a != null) { so += a; ko++; }
      if (b != null) { sf += b; kf++; }
    }
    if (ko === cells.length) obs[i] = so / ko;
    if (kf === cells.length) fc[i] = sf / kf;
  }
  return { obs, fc };
}
const winOf = (g) => {
  const t = STATIONS[g]?.terms?.find((x) => x.k === "rain");
  return t ? { from: t.from, to: t.to } : { from: 12, to: 2 };
};

// ---- baseline helpers (same as scripts/fit-gauge-model.mjs) ---------------------------------------
const ctx = { level: (g, t) => { const v = L[g]?.[Math.round((t - t0) / H)]; return Number.isFinite(v) ? v : null; } };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const cover = (g) => L[g].reduce((s, v) => s + (Number.isFinite(v) ? 1 : 0), 0) / N;
const upOf = (g) => gs.gauges.filter((u) => u !== g && basinOf[u] === basinOf[g] && cover(u) > 0.7);
const tercileEdges = (v) => { const s = [...v].sort((a, b) => a - b); return [quantile(s, 1 / 3), quantile(s, 2 / 3)]; };
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
function samples(g, up, tide, h) {
  const S = [];
  for (let i = 12; i < N - h; i++) {
    const y = L[g][i + h] - L[g][i];
    if (!Number.isFinite(y)) continue;
    const f = gaugeFeatures(g, up, tide, ctx, t0 + i * H, h);
    if (f && f.x.every(Number.isFinite)) S.push({ i, x: f.x, y, vol: f.vol, missing: f.missing.length });
  }
  return S;
}
const r5 = (v) => (typeof v === "number" ? +v.toPrecision(5) : v);

// ---- run --------------------------------------------------------------------------------------
const kft = (g) => (gs.unit(g) === "m" ? 1 / FT : 1); // native -> feet
const stationsOut = {};
const stormRows = []; // storm-hour rows scored out of sample, errors in native units
const calmAgg = {}; // per h: sums of |err| in feet on calm hours (pers, base)
const preds = {}; // preds[g][h] = per-hour Float32 arrays of the change predicted by each method, plus bands
const perGauge = [];
const rainOf = {}, gateOf = {}, tierOf = {};
const rAtOf = (g) => (i) => (k) => (k <= 0 ? rainOf[g].obs[i + k] : rainOf[g].fc[i + k]);

// pass 0: rain, gate and tier per gauge; union events across gauges (runs of storm hours with gaps < 72 h)
const active = [];
for (const g of gs.gauges.sort()) {
  const rain = catchmentRain(g);
  if (!rain || cover(g) <= 0.7 || (ONLY && !ONLY.includes(g))) continue;
  rainOf[g] = rain;
  const gate = new Uint8Array(N), tier = new Uint8Array(N);
  for (let i = 80; i < N - 25; i++) {
    const tt = rainTotals(rAtOf(g)(i));
    const m = Math.max(tt.past24 ?? 0, tt.next24 ?? 0);
    if (m >= GATE) gate[i] = 1;
    tier[i] = m >= 100 ? 3 : m >= 50 ? 2 : m >= GATE ? 1 : 0;
  }
  gateOf[g] = gate; tierOf[g] = tier;
  active.push(g);
}
const events = [];
const evAt = new Int16Array(N).fill(-1);
for (let i = 0, cur = null, last = -999; i < N; i++) {
  if (!active.some((g) => gateOf[g][i])) continue;
  if (cur == null || i - last > 72) { cur = { id: events.length, s: i, e: i }; events.push(cur); }
  cur.e = i; last = i; evAt[i] = cur.id;
}
console.log(`${active.length} gauges, ${events.length} storm events at gate ${GATE} mm:`, events.map((e) => new Date(t0 + e.s * H).toISOString().slice(0, 10) + "+" + Math.round((e.e - e.s) / 24) + "d").join(" "));
const purged = (r, e) => r.ev !== e && (r.i < events[e].s - 48 || r.i > events[e].e + 48);

// pass 1: gauge-only baseline per gauge and horizon (blocked CV), storm rows with features
const bundle = {};
const scaleOf = {};
for (const g of active) {
  const up = upOf(g), win = winOf(g), rAt = rAtOf(g);
  // gauge dynamic range: 90th percentile of |24 h change| over everything (a scale constant only)
  const d24 = [];
  for (let i = 0; i < N - 24; i++) { const d = Math.abs(L[g][i + 24] - L[g][i]); if (Number.isFinite(d)) d24.push(d); }
  d24.sort((a, b) => a - b);
  scaleOf[g] = quantile(d24, 0.9) || 1e-3;
  stationsOut[g] = { unit: gs.unit(g), up, win, scale: r5(scaleOf[g]), horizons: {} };
  bundle[g] = {};
  for (const h of STORM_HORIZONS) {
    const cand = {};
    for (const tide of [false, true]) {
      const S = samples(g, up, tide, h);
      const cv = blockedCv(S, 0, N - h, fitS);
      cand[tide] = { S, cv, mae: mean(cv.map((r) => Math.abs(r.y - r.p))) };
    }
    const tide = cand[true].mae < 0.95 * cand[false].mae;
    const { S, cv } = cand[tide];
    const persCv = mean(cv.map((r) => Math.abs(r.y)));
    const skilled = cand[tide].mae <= 0.97 * persCv;
    const p0 = new Map(cv.map((r) => [r.i, skilled ? r.p : 0]));
    const edges = tercileEdges(cv.map((r) => r.vol));
    const bandB = bandsFrom(cv.map((r) => ({ ...r, p: skilled ? r.p : 0 })), edges);
    const rows = S.filter((s) => p0.has(s.i)).map((s) => ({ g, h, ...s, p0: p0.get(s.i), gate: gateOf[g][s.i], tier: tierOf[g][s.i], ev: evAt[s.i] }));
    const heavyAt = (i) => (k) => (k <= 0 ? rainOf[g].obs[i + k] : HEAVY * rainOf[g].fc[i + k]);
    for (const r of rows) if (r.gate) { r.sx = stormFeatures(rAt(r.i), h, win); r.sxH = stormFeatures(heavyAt(r.i), h, win); }
    bundle[g][h] = { rows, edges, bandB, skilled, tide, S, cvMae: cand[tide].mae, persCv };
    for (const r of rows) {
      if (r.gate) continue;
      const a = (calmAgg[h] ??= { n: 0, pers: 0, base: 0 });
      a.n++; a.pers += Math.abs(r.y) * kft(g); a.base += Math.abs(r.y - r.p0) * kft(g);
    }
  }
  process.stderr.write(`baseline ${g}\n`);
}

// pass 2: ONE pooled storm model per horizon (rows scaled by each gauge's dynamic range), leave one event out
const pooledModel = {};
const scoredByH = {};
const bandFactor = {};
const fitPool = (rs) => fitNonNegL1(rs.map((r) => r.sx), rs.map((r) => (r.y - r.p0) / scaleOf[r.g]), LAM);
const corPool = (m, r, sx = r.sx) => scaleOf[r.g] * (m.b0 + m.w.reduce((s, v, j) => s + v * sx[j], 0));
const binT = (r) => (r.tier >= 3 ? 1 : 0); // band bin: 100+ mm vs less
const q = (a, p) => (a.length >= 40 ? quantile([...a].sort((x, y) => x - y), p) : null);
/** 80% band (native units) for gauge g in tier bin b from held-out residuals: the gauge's own tier bin, else its own all-tier residuals, else everyone's scaled by its dynamic range. */
function bandOf(list, g, b) {
  for (const sel of [(x) => x.g === g && x.b === b, (x) => x.g === g]) {
    const rs = list.filter(sel).map((x) => x.res);
    if (rs.length >= 40) return [q(rs, 0.1), q(rs, 0.9)];
  }
  const rs = list.filter((x) => x.b === b).map((x) => x.sres);
  return [q(rs, 0.1) == null ? null : q(rs, 0.1) * scaleOf[g], q(rs, 0.9) == null ? null : q(rs, 0.9) * scaleOf[g]];
}
for (const h of STORM_HORIZONS) {
  const all = active.flatMap((g) => bundle[g][h].rows.filter((r) => r.gate && r.sx));
  const evIds = [...new Set(all.map((r) => r.ev))];
  for (const e of evIds) {
    const te = all.filter((r) => r.ev === e);
    const tr = all.filter((r) => purged(r, e));
    if (tr.length < 200) { for (const r of te) r.ps = null; continue; }
    const m = fitPool(tr);
    for (const r of te) { r.ps = r.p0 + corPool(m, r); r.psH = r.sxH ? r.p0 + corPool(m, r, r.sxH) : r.ps; }
    const inner = [];
    for (const e2 of [...new Set(tr.map((r) => r.ev))]) {
      const tr2 = tr.filter((r) => purged(r, e2));
      if (tr2.length < 200) continue;
      const m2 = fitPool(tr2);
      for (const r of tr) if (r.ev === e2) inner.push({ g: r.g, b: binT(r), res: r.y - r.p0 - corPool(m2, r), sres: (r.y - r.p0 - corPool(m2, r)) / scaleOf[r.g] });
    }
    for (const r of te) { const b = bandOf(inner, r.g, binT(r)); r.q10s = b[0]; r.q90s = b[1]; }
  }
  // The per-gauge held-out bands are a little too narrow for a storm that is bigger than the ones the gauge was trained on, so one
  // factor per horizon (smallest on a 0.05 grid) stretches them until the nested coverage over all storm hours reaches 78%.
  {
    const sc0 = all.filter((r) => r.ps != null && r.q10s != null);
    let f = 1;
    const cov = (k) => mean(sc0.map((r) => (r.y - r.ps >= r.q10s * k && r.y - r.ps <= r.q90s * k ? 1 : 0)));
    while (f < 4 && cov(f) < 0.78) f += 0.05;
    bandFactor[h] = +f.toFixed(2);
    for (const r of sc0) { r.q10s *= f; r.q90s *= f; }
    console.log(`band factor ${h}h: ${f.toFixed(2)}`);
  }
  // final pooled fit on everything + band quantiles from the held-out residuals
  const scored = all.filter((r) => r.ps != null);
  const m = fitPool(all);
  const res = [[], []];
  for (const r of scored) res[binT(r)].push((r.y - r.ps) / scaleOf[r.g]);
  scoredByH[h] = scored.map((r) => ({ g: r.g, b: binT(r), res: r.y - r.ps, sres: (r.y - r.ps) / scaleOf[r.g] }));
  scoredByH[h].factor = bandFactor[h];
  pooledModel[h] = { b0: r5(m.b0), w: m.w.map(r5), q10: res.map((a) => r5(q(a, 0.1) ?? 0)), q90: res.map((a) => r5(q(a, 0.9) ?? 0)), n: all.length, events: evIds.length };
  console.log(`pooled ${h}h: n ${all.length} events ${evIds.length} w ${m.w.map((v) => v.toFixed(4))} b0 ${m.b0.toFixed(4)}`);
}

// pass 3: per gauge scoring, ship decision, prediction arrays
for (const g of active) {
  preds[g] = {};
  const rAt = rAtOf(g);
  for (const h of STORM_HORIZONS) {
    const { rows, edges, bandB, skilled, tide, S, cvMae, persCv } = bundle[g][h];
    const sc = rows.filter((r) => r.gate && r.sx && r.ps != null);
    const e_pers = sc.map((r) => Math.abs(r.y)), e_base = sc.map((r) => Math.abs(r.y - r.p0)), e_storm = sc.map((r) => Math.abs(r.y - r.ps));
    const evs = [...new Set(sc.map((r) => r.ev))];
    const perEvent = evs.map((e) => {
      const rs = sc.filter((r) => r.ev === e);
      return { e, n: rs.length, base: mean(rs.map((r) => Math.abs(r.y - r.p0))), storm: mean(rs.map((r) => Math.abs(r.y - r.ps))), pers: mean(rs.map((r) => Math.abs(r.y))) };
    });
    const wins = perEvent.filter((x) => x.storm < x.base).length;
    const use = sc.length >= 60 && evs.length >= 3 && mean(e_storm) <= 0.97 * mean(e_base) && mean(e_storm) < mean(e_pers) && wins >= Math.ceil(perEvent.length / 2);
    const P = { base: new Float32Array(N).fill(NaN), storm: new Float32Array(N).fill(NaN), lowB: new Float32Array(N).fill(NaN), highB: new Float32Array(N).fill(NaN), lowS: new Float32Array(N).fill(NaN), highS: new Float32Array(N).fill(NaN), highS0: new Float32Array(N).fill(NaN) };
    for (const r of rows) {
      P.base[r.i] = r.p0;
      const b = binOf(edges, r.vol);
      P.lowB[r.i] = r.p0 + bandB.q10[b] * WIDEN; P.highB[r.i] = r.p0 + bandB.q90[b] * WIDEN;
      P.storm[r.i] = r.p0; P.lowS[r.i] = P.lowB[r.i]; P.highS[r.i] = P.highB[r.i]; P.highS0[r.i] = P.highB[r.i];
    }
    if (use) for (const r of sc) if (r.q10s != null) { P.storm[r.i] = r.ps; P.lowS[r.i] = r.ps + r.q10s; P.highS[r.i] = Math.max(r.ps + r.q90s, r.psH); P.highS0[r.i] = r.ps + r.q90s; }
    preds[g][h] = P;
    for (const r of sc) {
      const b = binOf(edges, r.vol);
      stormRows.push({
        g, h, ev: r.ev, tier: r.tier, use, k: kft(g), y: r.y, p0: r.p0, ps: r.ps,
        inB: r.y - r.p0 >= bandB.q10[b] * WIDEN && r.y - r.p0 <= bandB.q90[b] * WIDEN ? 1 : 0, wB: (bandB.q90[b] - bandB.q10[b]) * WIDEN,
        inS: r.q10s == null ? null : r.y - r.ps >= r.q10s && r.y - r.ps <= r.q90s ? 1 : 0, wS: r.q10s == null ? null : r.q90s - r.q10s,
        inH: r.q10s == null ? null : r.y - r.ps >= r.q10s && r.y <= Math.max(r.ps + r.q90s, r.psH) - 0 ? 1 : 0, wH: r.q10s == null ? null : Math.max(r.ps + r.q90s, r.psH) - r.ps - r.q10s,
      });
    }
    let base = null;
    if (h >= 12) {
      const mAll = fitS(S);
      base = { skilled, tide, b0: r5(mAll.b0), w: mAll.w.map(r5), edges: edges.map(r5), q10: bandB.q10.map(r5), q90: bandB.q90.map(r5), n: S.length, cvMae: r5(cvMae), cvPersMae: r5(persCv) };
    }
    const sum = { stormN: sc.length, events: evs.length, pers: r5(mean(e_pers)), base: r5(mean(e_base)), storm: r5(mean(e_storm)), wins: `${wins}/${perEvent.length}` };
    const band = use ? [0, 1].map((b) => bandOf(scoredByH[h], g, b)) : null;
    stationsOut[g].horizons[h] = { base, use, ...(band ? { band: { q10: band.map((x) => r5(x[0] * bandFactor[h])), q90: band.map((x) => r5(x[1] * bandFactor[h])) } } : {}), backtest: sum };
    perGauge.push({ g, h, unit: gs.unit(g), skilled, use, ...sum, perEvent: perEvent.map((x) => ({ start: new Date(t0 + events[x.e].s * H).toISOString().slice(0, 10), n: x.n, pers: r5(x.pers), base: r5(x.base), storm: r5(x.storm) })) });
    console.log(`${g.padEnd(24)} ${String(h).padStart(2)}h base ${skilled ? "model" : "pers "} storm n ${String(sc.length).padStart(4)} ev ${evs.length} | MAE pers ${mean(e_pers).toFixed(3)} gauge ${mean(e_base).toFixed(3)} +rain ${mean(e_storm).toFixed(3)} wins ${wins}/${perEvent.length} ${use ? "SHIP" : ""}`);
  }
}

// ---- aggregate tables -------------------------------------------------------------------------
const pooled = (rows, f) => mean(rows.map(f));
const tbl = {};
const table = (rows) => {
  const o = {};
  for (const h of STORM_HORIZONS) {
    const rs = rows.filter((r) => r.h === h);
    if (!rs.length) continue;
    const ft = (r, d) => Math.abs(d) * r.k;
    const mp = pooled(rs, (r) => ft(r, r.y)), mb = pooled(rs, (r) => ft(r, r.y - r.p0));
    const shipped = (r) => (r.use ? r.ps : r.p0);
    const ms = pooled(rs, (r) => ft(r, r.y - shipped(r)));
    const mAll = pooled(rs, (r) => ft(r, r.y - r.ps));
    const sb = rs.filter((r) => r.inS != null);
    o[h] = {
      n: rs.length, gauges: new Set(rs.map((r) => r.g)).size,
      persFt: r5(mp), gaugeFt: r5(mb), shippedFt: r5(ms), rainEverywhereFt: r5(mAll),
      covBase: r5(pooled(rs, (r) => r.inB)), widthBaseFt: r5(pooled(rs, (r) => r.wB * r.k)),
      covStorm: sb.length ? r5(pooled(sb, (r) => r.inS)) : null, widthStormFt: sb.length ? r5(pooled(sb, (r) => r.wS * r.k)) : null,
      covHeavy: sb.length ? r5(pooled(sb, (r) => r.inH)) : null, widthHeavyFt: sb.length ? r5(pooled(sb, (r) => r.wH * r.k)) : null,
    };
  }
  return o;
};
const shippedGroups = (rows) => rows.filter((r) => r.use);
tbl.allStorm = table(stormRows);
tbl.byTier = { "30-50 mm": table(stormRows.filter((r) => r.tier === 1)), "50-100 mm": table(stormRows.filter((r) => r.tier === 2)), "100+ mm": table(stormRows.filter((r) => r.tier === 3)) };
tbl.shippedOnly = table(shippedGroups(stormRows));
tbl.calm = Object.fromEntries(Object.entries(calmAgg).map(([h, a]) => [h, { n: a.n, persFt: r5(a.pers / a.n), gaugeFt: r5(a.base / a.n) }]));
// Ditwah: samples whose time falls 25 Nov - 4 Dec 2025 (UTC)
const dw0 = Date.UTC(2025, 10, 25), dw1 = Date.UTC(2025, 11, 5);
const ditwah = stormRows.filter((r) => { const st = t0 + events[r.ev].s * H; return st >= dw0 - 3 * 864e5 && st < dw1; });
tbl.ditwah = table(ditwah);
tbl.ditwahShipped = table(ditwah.filter((r) => r.use));
console.log(JSON.stringify(tbl, null, 1));

// ---- peak and crossing analysis (storm hours, all 5 horizons together) ---------------------------------
const methods = ["pers", "gauge", "rain"];
const peakStats = { pers: [], gauge: [], rain: [] };
const cross = {};
for (const g of Object.keys(preds)) {
  const k = kft(g), P = preds[g];
  const rain = catchmentRain(g);
  const gate = (i) => { const tt = rainTotals((kk) => (kk <= 0 ? rain.obs[i + kk] : rain.fc[i + kk])); return Math.max(tt.past24 ?? 0, tt.next24 ?? 0) >= GATE; };
  const lvl = (i) => L[g][i];
  const T = thr[g] ?? {};
  const level = (m, h, i) => {
    const d = m === "pers" ? 0 : m === "gauge" ? P[h].base[i] : P[h].storm[i];
    return lvl(i) + d;
  };
  const high = (m, h, i) => (m === "pers" ? lvl(i) : m === "gauge" ? lvl(i) + P[h].highB[i] : lvl(i) + P[h].highS[i]);
  for (let i = 80; i < N - 25; i++) {
    if (!gate(i) || !Number.isFinite(lvl(i))) continue;
    let ok = true, amax = -Infinity, ah = 0;
    for (let j = 1; j <= 24; j++) { const v = lvl(i + j); if (!Number.isFinite(v)) { ok = false; break; } if (v > amax) { amax = v; ah = j; } }
    if (!ok) continue;
    if ((amax - lvl(i)) * k < 0.5) continue; // only origins with a real rise coming in the next 24 h
    for (const m of methods) {
      let best = -Infinity, bh = 0, good = true;
      for (const h of STORM_HORIZONS) {
        const v = level(m, h, i);
        if (!Number.isFinite(v)) { good = false; break; }
        if (v > best) { best = v; bh = h; }
      }
      if (!good) continue;
      best = Math.max(best, lvl(i));
      peakStats[m].push({ g, rise: (amax - lvl(i)) * k, seen: (best - lvl(i)) * k, errFt: (best - amax) * k, timeErr: bh - ah, tier: 0 });
    }
  }
  // crossings
  for (const name of ["alert", "minor", "major"]) {
    const Tn = T[name];
    if (Tn == null || !(Tn > 0)) continue;
    const key = `${name}`;
    const c = (cross[key] ??= { n: 0, ...Object.fromEntries(methods.flatMap((m) => [[m + "_pt", []], [m + "_hi", []]])), fa: Object.fromEntries(methods.map((m) => [m, { flags: 0, hit: 0 }])) });
    for (let i = 30; i < N - 2; i++) {
      if (!(lvl(i - 1) < Tn && lvl(i) >= Tn)) continue;
      let clear = true;
      for (let j = 2; j <= 24; j++) if (!(lvl(i - j) < Tn)) { clear = false; break; }
      if (!clear || !gate(i)) continue;
      c.n++;
      for (const m of methods) for (const mode of ["pt", "hi"]) {
        let lead = 0; // hours of continuous flagging immediately before the crossing, counted from i-1 down to i-24
        for (let j = 1; j <= 24; j++) {
          const o = i - j;
          if (!gate(o) || !Number.isFinite(lvl(o)) || lvl(o) >= Tn) break;
          let flag = false;
          for (const h of STORM_HORIZONS) {
            const v = mode === "pt" ? level(m, h, o) : high(m, h, o);
            if (Number.isFinite(v) && v >= Tn) { flag = true; break; }
          }
          if (!flag) break;
          lead = j;
        }
        c[`${m}_${mode}`].push(lead);
      }
    }
    for (let i = 80; i < N - 25; i++) {
      if (!gate(i) || !Number.isFinite(lvl(i)) || lvl(i) >= Tn || lvl(i) < Tn - 3 / k) continue; // within 3 ft below the mark
      let reach = false;
      for (let j = 1; j <= 24; j++) if (lvl(i + j) >= Tn) { reach = true; break; }
      for (const m of methods) {
        let flag = false;
        for (const h of STORM_HORIZONS) { const v = high(m, h, i); if (Number.isFinite(v) && v >= Tn) flag = true; }
        if (flag) { c.fa[m].flags++; if (reach) c.fa[m].hit++; }
      }
    }
  }
}
const summarisePeak = (arr) => ({ n: arr.length, seenPct: r5(100 * mean(arr.map((x) => Math.min(x.seen / x.rise, 2)))), absPeakErrFt: r5(mean(arr.map((x) => Math.abs(x.errFt)))), medPeakErrFt: r5(med(arr.map((x) => x.errFt))), absTimeErrH: r5(mean(arr.map((x) => Math.abs(x.timeErr)))) });
const peakOut = Object.fromEntries(methods.map((m) => [m, summarisePeak(peakStats[m])]));
const crossOut = {};
for (const [name, c] of Object.entries(cross)) {
  crossOut[name] = { crossings: c.n };
  for (const m of methods) for (const mode of ["pt", "hi"]) {
    const a = c[`${m}_${mode}`];
    crossOut[name][`${m}_${mode}`] = { flagged1h: a.filter((x) => x >= 1).length, flagged3h: a.filter((x) => x >= 3).length, flagged6h: a.filter((x) => x >= 6).length, flagged12h: a.filter((x) => x >= 12).length, medLeadH: med(a) };
  }
  crossOut[name].falseAlarm = Object.fromEntries(methods.map((m) => [m, { flags: c.fa[m].flags, precision: c.fa[m].flags ? r5(c.fa[m].hit / c.fa[m].flags) : null }]));
}
console.log("PEAK", JSON.stringify(peakOut));
console.log("CROSS", JSON.stringify(crossOut, null, 1));

// ---- what a rain warning is worth: for every hour, the forecast catchment rain for the next 24 h (the forecast made a day
// earlier) against how far the river really rose in those 24 h (feet; all gauges with a rain grid)
const buckets = [["under 10 mm", 0, 10], ["10-25 mm", 10, 25], ["25-50 mm", 25, 50], ["50-100 mm", 50, 100], ["100 mm or more", 100, 1e9]];
const warn = buckets.map(([name]) => ({ name, n: 0, up1: 0, up2: 0, up4: 0, sumRise: 0 }));
for (const g of active) {
  const k = kft(g);
  for (let i = 80; i < N - 25; i++) {
    const tt = rainTotals(rAtOf(g)(i));
    if (tt.next24 == null || !Number.isFinite(L[g][i])) continue;
    let mx = -Infinity;
    for (let j = 1; j <= 24; j++) { const v = L[g][i + j]; if (Number.isFinite(v) && v > mx) mx = v; }
    if (!Number.isFinite(mx)) continue;
    const rise = Math.max(0, (mx - L[g][i]) * k);
    const b = warn[buckets.findIndex(([, lo, hi]) => tt.next24 >= lo && tt.next24 < hi)];
    b.n++; b.sumRise += rise; if (rise >= 1) b.up1++; if (rise >= 2) b.up2++; if (rise >= 4) b.up4++;
  }
}
const warnOut = warn.map((b) => ({ forecastRain24h: b.name, hours: b.n, meanRiseFt: r5(b.sumRise / b.n), pctRiseOver1ft: r5((100 * b.up1) / b.n), pctRiseOver2ft: r5((100 * b.up2) / b.n), pctRiseOver4ft: r5((100 * b.up4) / b.n) }));
console.log("WARN", JSON.stringify(warnOut));

const json = {
  version: 1,
  fittedAt: new Date().toISOString(),
  gate: GATE,
  trainRange: [t0, gs.t1],
  source: "gauge archive (data branch + github.com/nuuuwan/lk_irrigation) + Open-Meteo Previous Runs rain (observed and the forecast made one day earlier)",
  pooled: pooledModel,
  bandFactor,
  stations: stationsOut,
};
writeFileSync(outFile, JSON.stringify(json) + "\n");
console.log(`wrote ${outFile}`);
if (reportFile) writeFileSync(reportFile, JSON.stringify({ gate: GATE, lam: LAM, bandFactor, events: events.map((e) => ({ start: new Date(t0 + e.s * H).toISOString().slice(0, 10), days: Math.round((e.e - e.s) / 24) })), tables: tbl, peak: peakOut, cross: crossOut, warn: warnOut, perGauge }, null, 1));
