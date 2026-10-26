#!/usr/bin/env node
// v4 storm model: measured (satellite) rain, bias-corrected per catchment, split into rain beside the gauge and rain on
// up-channels with a learned travel time each. Backtest + fit, leave one storm out. Writes lib/model/storm-model-v4.json and a report.
//
// usage: node --import ./scripts/ts-hooks.mjs scripts/fit-storm-model-v4.mjs --gs gsmap-catchment-hourly.json --rain rain-history.json
//          --history all.json [archiveDir] [--prod now0|nrt|gnrt] [--clip 15] [--gate3 50] [--gate4 40] [--burst 25] [--out f] [--report f] [--only A,B]
//   gsmap-catchment-hourly.json  from scripts/gsmap-history/aggregate.py (per-catchment hourly mean rate of GSMaP, hour started at the file stamp)
//   rain-history.json            from scripts/fetch-rain-history.mjs (Open-Meteo: model hour 0, and the forecast made a day earlier for k >= 1)
// What is scored is OUT OF SAMPLE and compared with the shipped v3 under the same rule (see scripts/fit-storm-model.mjs):
//   gauge-only baseline = blocked 7-fold CV; storm correction = pooled non-negative L1 ridge on storm hours, leave one storm event
//   out (48 h purged), bands from an inner leave-one-event-out. v3 = Open-Meteo rain only. v4 = measured past rain.
// A gauge/horizon ships v4 only if, over storm hours (either rule on), the hybrid "v4 where its gate is on and it shipped,
// else v3" beats v3 by >= 3%, over >= 60 hours and >= 3 events, winning in at least half the events.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitL1, gaugeFeatures, predictLinear } from "../lib/model/gaugeModel.mjs";
import { quantile } from "../lib/model/core.mjs";
import { STORM_HORIZONS, fitNonNegL1, isStormHour, rainTotals, stormFeatures, stormFeatures4, isStormHour4 } from "../lib/model/stormModel.mjs";
import { loadV4 } from "./storm-v4-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const skip = new Set(["--gs", "--rain", "--history", "--out", "--report", "--gate3", "--gate4", "--burst", "--only", "--lam", "--prod", "--clip", "--bias"]);
const ONLY = opt("--only") ? opt("--only").split(",") : null;
const dir = args.find((a, i) => !a.startsWith("--") && !skip.has(args[i - 1])) ?? undefined;
const outFile = opt("--out", path.join(here, "../lib/model/storm-model-v4.json"));
const reportFile = opt("--report");
const PROD = opt("--prod", "now0");
const CLIP = +opt("--clip", 15);
const GATE3 = +opt("--gate3", 50), GATE4 = +opt("--gate4", 40), BURST = +opt("--burst", 25);
const BIAS = opt("--bias", "on") !== "off";
const LAM = +opt("--lam", 0.1);
const H = 3_600_000, FT = 0.3048, WIDEN = 1.15;

const D = loadV4({ dir, histFile: opt("--history") ?? undefined, rainFile: opt("--rain"), gsFile: opt("--gs"), prod: PROD, clip: CLIP, bias: BIAS });
const { gs, L, t0, N, basinOf, thr, rainOf, comp, rAt3, winOf, bias, biasInfo, lagOf, kft, cover, zoneOf, norm, keyOf, GS, SUB, archive } = D;

// ---- baseline helpers (as scripts/fit-storm-model.mjs) -------------------------------------------------------------------------------
const ctx = { level: (g, t) => { const v = L[g]?.[Math.round((t - t0) / H)]; return Number.isFinite(v) ? v : null; } };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const upOf = (g) => gs.gauges.filter((u) => u !== g && basinOf[u] === basinOf[g] && cover(u) > 0.7);
const tercileEdges = (v) => { const s = [...v].sort((a, b) => a - b); return [quantile(s, 1 / 3), quantile(s, 2 / 3)]; };
const binOf = (e, v) => { let b = 0; while (b < e.length && v >= e[b]) b++; return b; };
function bandsFrom(rows, edges) {
  const out = { q10: [], q90: [] };
  const all = rows.map((r) => r.y - r.p).sort((a, b) => a - b);
  for (let b = 0; b <= edges.length; b++) {
    const rs = rows.filter((r) => binOf(edges, r.vol) === b).map((r) => r.y - r.p).sort((a, c) => a - c);
    const src = rs.length >= 100 ? rs : all;
    out.q10.push(quantile(src, 0.1)); out.q90.push(quantile(src, 0.9));
  }
  return out;
}
const K = 7;
function blockedCv(S, from, to, fit) {
  const rows = [], fl = Math.floor((to - from) / K);
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

// ---- pass 0: gates and events ----------------------------------------------------------------------------------------------------------
const active = [];
const gate3 = {}, gate4 = {}, tier3 = {}, tier4 = {}, lagsOf = {};
for (const g of Object.keys(rainOf)) {
  if (cover(g) <= 0.7 || (ONLY && !ONLY.includes(g))) continue;
  const g3 = new Uint8Array(N), g4 = new Uint8Array(N), t3 = new Uint8Array(N), t4 = new Uint8Array(N);
  for (let i = 80; i < N - 25; i++) {
    const tt = rainTotals(rAt3(g)(i)); const m = Math.max(tt.past24 ?? 0, tt.next24 ?? 0);
    if (m >= GATE3) g3[i] = 1;
    t3[i] = m >= 100 ? 3 : m >= 50 ? 2 : m >= GATE3 ? 1 : 0;
    const rf = comp(g, "full", i);
    if (isStormHour4(rf, GATE4, BURST)) g4[i] = 1;
    let a = 0, b = 0;
    for (let k = -24; k <= -1; k++) a += rf(k) ?? 0;
    for (let k = 1; k <= 24; k++) b += rf(k) ?? 0;
    const m4 = Math.max(a, b);
    t4[i] = m4 >= 100 ? 3 : m4 >= 50 ? 2 : g4[i] ? 1 : 0;
  }
  gate3[g] = g3; gate4[g] = g4; tier3[g] = t3; tier4[g] = t4;
  const R = rainOf[g];
  const ln = lagOf(g, R.mn), lu = R.hasUp ? lagOf(g, R.mu) : null;
  lagsOf[g] = { near: ln?.lag ?? 3, up: lu?.lag ?? (R.hasUp ? 12 : 0), nearCorr: ln?.corr ?? null, upCorr: lu?.corr ?? null };
  active.push(g);
}
const events = [], evAt = new Int16Array(N).fill(-1);
for (let i = 0, cur = null, last = -999; i < N; i++) {
  if (!active.some((g) => gate3[g][i] || gate4[g][i])) continue;
  if (cur == null || i - last > 72) { cur = { id: events.length, s: i, e: i }; events.push(cur); }
  cur.e = i; last = i; evAt[i] = cur.id;
}
console.log(`${active.length} gauges, ${events.length} storm events (v3 gate ${GATE3} mm forecast/analysis; v4 gate ${GATE4} mm measured/forecast or ${BURST} mm in 3 h):`, events.map((e) => new Date(t0 + e.s * H).toISOString().slice(5, 10) + "+" + Math.round((e.e - e.s) / 24) + "d").join(" "));
console.log("lags", JSON.stringify(Object.fromEntries(active.map((g) => [g, [lagsOf[g].near, lagsOf[g].up]]))));
const purged = (r, e) => r.ev !== e && (r.i < events[e].s - 48 || r.i > events[e].e + 48);

// ---- pass 1: gauge-only baseline per gauge and horizon --------------------------------------------------------------------------------------
const bundle = {}, scaleOf = {}, stationsOut = {};
for (const g of active) {
  const up = upOf(g), win = winOf(g), R = rainOf[g];
  const d24 = [];
  for (let i = 0; i < N - 24; i++) { const d = Math.abs(L[g][i + 24] - L[g][i]); if (Number.isFinite(d)) d24.push(d); }
  d24.sort((a, b) => a - b);
  scaleOf[g] = quantile(d24, 0.9) || 1e-3;
  bundle[g] = {};
  stationsOut[g] = { unit: gs.unit(g), up, win, scale: r5(scaleOf[g]), lags: lagsOf[g], bias: biasInfo[g], horizons: {} };
  const lags = { near: lagsOf[g].near, up: lagsOf[g].up };
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
    const rows = S.filter((s) => p0.has(s.i)).map((s) => ({ g, h, ...s, p0: p0.get(s.i), gate3: gate3[g][s.i], gate4: gate4[g][s.i], tier3: tier3[g][s.i], tier4: tier4[g][s.i], ev: evAt[s.i] }));
    for (const r of rows) {
      if (r.gate3) r.sx3 = stormFeatures(rAt3(g)(r.i), h, win);
      if (r.gate4) r.sx4 = stormFeatures4(comp(g, "full", r.i), comp(g, "near", r.i), R.hasUp ? comp(g, "up", r.i) : null, h, lags);
    }
    bundle[g][h] = { rows, edges, bandB, skilled, tide, S, cvMae: cand[tide].mae, persCv };
    process.stderr.write(`.`);
  }
  process.stderr.write(` baseline ${g}\n`);
}

// ---- pass 2: pooled storm models (v3 on Open-Meteo rain, v4 on measured rain), leave one event out, nested bands -------------------------------------
const q = (a, p) => (a.length >= 40 ? quantile([...a].sort((x, y) => x - y), p) : null);
function bandOf(list, g, b) {
  for (const sel of [(x) => x.g === g && x.b === b, (x) => x.g === g]) { const rs = list.filter(sel).map((x) => x.res); if (rs.length >= 40) return [q(rs, 0.1), q(rs, 0.9)]; }
  const rs = list.filter((x) => x.b === b).map((x) => x.sres);
  return [q(rs, 0.1) == null ? null : q(rs, 0.1) * scaleOf[g], q(rs, 0.9) == null ? null : q(rs, 0.9) * scaleOf[g]];
}
function runVariant(V) {
  const gateK = "gate" + V, sxK = "sx" + V, tierK = "tier" + V;
  const fitPool = (rs) => fitNonNegL1(rs.map((r) => r[sxK]), rs.map((r) => (r.y - r.p0) / scaleOf[r.g]), LAM);
  const corPool = (m, r) => scaleOf[r.g] * (m.b0 + m.w.reduce((s, v, j) => s + v * r[sxK][j], 0));
  const binT = (r) => (r[tierK] >= 3 ? 1 : 0);
  const pooled = {}, bandFactor = {}, scored = {};
  for (const h of STORM_HORIZONS) {
    const all = active.flatMap((g) => bundle[g][h].rows.filter((r) => r[gateK] && r[sxK]));
    const evIds = [...new Set(all.map((r) => r.ev))];
    for (const e of evIds) {
      const te = all.filter((r) => r.ev === e), tr = all.filter((r) => purged(r, e));
      if (tr.length < 200) { for (const r of te) r["ps" + V] = null; continue; }
      const m = fitPool(tr);
      for (const r of te) r["ps" + V] = r.p0 + corPool(m, r);
      const inner = [];
      for (const e2 of [...new Set(tr.map((r) => r.ev))]) {
        const tr2 = tr.filter((r) => purged(r, e2)); if (tr2.length < 200) continue;
        const m2 = fitPool(tr2);
        for (const r of tr) if (r.ev === e2) inner.push({ g: r.g, b: binT(r), res: r.y - r.p0 - corPool(m2, r), sres: (r.y - r.p0 - corPool(m2, r)) / scaleOf[r.g] });
      }
      for (const r of te) { const b = bandOf(inner, r.g, binT(r)); r["q10s" + V] = b[0]; r["q90s" + V] = b[1]; }
    }
    const sc0 = all.filter((r) => r["ps" + V] != null && r["q10s" + V] != null);
    let f = 1;
    const cov = (k) => mean(sc0.map((r) => (r.y - r["ps" + V] >= r["q10s" + V] * k && r.y - r["ps" + V] <= r["q90s" + V] * k ? 1 : 0)));
    while (f < 4 && cov(f) < 0.78) f += 0.05;
    bandFactor[h] = +f.toFixed(2);
    for (const r of sc0) { r["q10s" + V] *= f; r["q90s" + V] *= f; }
    const sco = all.filter((r) => r["ps" + V] != null);
    const m = fitPool(all);
    const res = [[], []];
    for (const r of sco) res[binT(r)].push((r.y - r["ps" + V]) / scaleOf[r.g]);
    scored[h] = sco.map((r) => ({ g: r.g, b: binT(r), res: r.y - r["ps" + V], sres: (r.y - r["ps" + V]) / scaleOf[r.g] }));
    pooled[h] = { b0: r5(m.b0), w: m.w.map(r5), q10: res.map((a) => r5(q(a, 0.1) ?? 0)), q90: res.map((a) => r5(q(a, 0.9) ?? 0)), n: all.length, events: evIds.length };
    console.log(`v${V} pooled ${h}h: n ${all.length} events ${evIds.length} w ${m.w.map((v) => v.toFixed(4))} b0 ${m.b0.toFixed(4)} bandFactor ${bandFactor[h]}`);
  }
  return { pooled, bandFactor, scored };
}
const V3 = runVariant(3), V4 = runVariant(4);

// ---- pass 3: ship decisions and predictions ----------------------------------------------------------------------------------------------------------
const stormRows = [], calmAgg = {}, preds = {};
const useOf = { 3: {}, 4: {} };
for (const g of active) {
  preds[g] = {};
  for (const h of STORM_HORIZONS) {
    const { rows, edges, bandB, skilled, S, cvMae, persCv } = bundle[g][h];
    // v3 decision (as in scripts/fit-storm-model.mjs) on its own gate
    const sc3 = rows.filter((r) => r.gate3 && r.sx3 && r.ps3 != null);
    const evs3 = [...new Set(sc3.map((r) => r.ev))];
    const pe3 = evs3.map((e) => { const rs = sc3.filter((r) => r.ev === e); return { base: mean(rs.map((r) => Math.abs(r.y - r.p0))), storm: mean(rs.map((r) => Math.abs(r.y - r.ps3))) }; });
    const use3 = sc3.length >= 60 && evs3.length >= 3 && mean(sc3.map((r) => Math.abs(r.y - r.ps3))) <= 0.97 * mean(sc3.map((r) => Math.abs(r.y - r.p0))) && mean(sc3.map((r) => Math.abs(r.y - r.ps3))) < mean(sc3.map((r) => Math.abs(r.y))) && pe3.filter((x) => x.storm < x.base).length >= Math.ceil(pe3.length / 2);
    useOf[3][`${g}|${h}`] = use3;
    // v4: hybrid vs v3 over storm hours of either rule
    const un = rows.filter((r) => r.gate3 || r.gate4);
    const p3 = (r) => (r.gate3 && use3 && r.ps3 != null ? r.ps3 : r.p0);
    const hyb = (r) => (r.gate4 && r.ps4 != null ? r.ps4 : p3(r));
    const e3 = un.map((r) => Math.abs(r.y - p3(r))), e4 = un.map((r) => Math.abs(r.y - hyb(r)));
    const evsU = [...new Set(un.map((r) => r.ev))];
    const peU = evsU.map((e) => { const rs = un.filter((r) => r.ev === e); return { a: mean(rs.map((r) => Math.abs(r.y - p3(r)))), b: mean(rs.map((r) => Math.abs(r.y - hyb(r)))) }; });
    const n4 = rows.filter((r) => r.gate4 && r.ps4 != null).length;
    const use4 = n4 >= 60 && evsU.length >= 3 && mean(e4) <= 0.97 * mean(e3) && peU.filter((x) => x.b < x.a).length >= Math.ceil(peU.length / 2);
    useOf[4][`${g}|${h}`] = use4;
    const p4s = (r) => (r.gate4 && use4 && r.ps4 != null ? r.ps4 : p3(r)); // what ships: v4 only where it earned it, else v3
    const P = { base: new Float32Array(N).fill(NaN), v3: new Float32Array(N).fill(NaN), v4: new Float32Array(N).fill(NaN), hi3: new Float32Array(N).fill(NaN), hi4: new Float32Array(N).fill(NaN), hiB: new Float32Array(N).fill(NaN), lo3: new Float32Array(N).fill(NaN), lo4: new Float32Array(N).fill(NaN) };
    for (const r of rows) {
      P.base[r.i] = r.p0; const b = binOf(edges, r.vol);
      P.hiB[r.i] = r.p0 + bandB.q90[b] * WIDEN;
      P.v3[r.i] = r.p0; P.v4[r.i] = r.p0; P.hi3[r.i] = P.hiB[r.i]; P.hi4[r.i] = P.hiB[r.i]; P.lo3[r.i] = r.p0 + bandB.q10[b] * WIDEN; P.lo4[r.i] = P.lo3[r.i];
      if (r.gate3 && use3 && r.ps3 != null && r.q10s3 != null) { P.v3[r.i] = r.ps3; P.hi3[r.i] = r.ps3 + r.q90s3; P.lo3[r.i] = r.ps3 + r.q10s3; P.v4[r.i] = r.ps3; P.hi4[r.i] = P.hi3[r.i]; P.lo4[r.i] = P.lo3[r.i]; }
      if (r.gate4 && use4 && r.ps4 != null && r.q10s4 != null) { P.v4[r.i] = r.ps4; P.hi4[r.i] = r.ps4 + r.q90s4; P.lo4[r.i] = r.ps4 + r.q10s4; }
    }
    preds[g][h] = P;
    for (const r of un) {
      const b = binOf(edges, r.vol);
      const in3 = r.gate3 && use3 && r.q10s3 != null ? (r.y - r.ps3 >= r.q10s3 && r.y - r.ps3 <= r.q90s3 ? 1 : 0) : (r.y - r.p0 >= bandB.q10[b] * WIDEN && r.y - r.p0 <= bandB.q90[b] * WIDEN ? 1 : 0);
      const used4 = r.gate4 && use4 && r.q10s4 != null;
      const in4 = used4 ? (r.y - r.ps4 >= r.q10s4 && r.y - r.ps4 <= r.q90s4 ? 1 : 0) : in3;
      stormRows.push({ g, h, i: r.i, ev: r.ev, k: kft(g), y: r.y, p0: r.p0, p3: p3(r), p4: p4s(r), pAll4: hyb(r), gate3: r.gate3, gate4: r.gate4, tier4: r.tier4, in3, in4, zone: zoneOf(g),
        w3: r.gate3 && use3 && r.q10s3 != null ? r.q90s3 - r.q10s3 : (bandB.q90[b] - bandB.q10[b]) * WIDEN, w4: used4 ? r.q90s4 - r.q10s4 : null });
    }
    for (const r of rows) if (!r.gate3 && !r.gate4) { const a = (calmAgg[h] ??= { n: 0, pers: 0, base: 0 }); a.n++; a.pers += Math.abs(r.y) * kft(g); a.base += Math.abs(r.y - r.p0) * kft(g); }
    let base = null;
    if (h >= 12) { const mAll = fitS(S); base = { skilled, tide: bundle[g][h].tide, b0: r5(mAll.b0), w: mAll.w.map(r5), edges: edges.map(r5), q10: bandB.q10.map(r5), q90: bandB.q90.map(r5), n: S.length, cvMae: r5(cvMae), cvPersMae: r5(persCv) }; }
    const band4 = use4 ? [0, 1].map((b) => bandOf(V4.scored[h], g, b)) : null;
    stationsOut[g].horizons[h] = { use: use4, use3, ...(band4 ? { band: { q10: band4.map((x) => r5(x[0] * V4.bandFactor[h])), q90: band4.map((x) => r5(x[1] * V4.bandFactor[h])) } } : {}),
      backtest: { stormN: un.length, events: evsU.length, v3Ft: r5(mean(e3) * kft(g)), v4Ft: r5(mean(e4) * kft(g)), persFt: r5(mean(un.map((r) => Math.abs(r.y))) * kft(g)), nV4Gate: n4 } };
    console.log(`${g.padEnd(24)} ${String(h).padStart(2)}h union ${String(un.length).padStart(4)} | pers ${mean(un.map((r) => Math.abs(r.y))).toFixed(3)} v3 ${mean(e3).toFixed(3)}${use3 ? "*" : " "} v4 ${mean(e4).toFixed(3)} ${use4 ? "SHIP4" : ""}`);
  }
}

// ---- tables (feet) ----------------------------------------------------------------------------------------------------------------------------------------------
const pm = (rows, f) => mean(rows.map(f));
const table = (rows) => {
  const o = {};
  for (const h of STORM_HORIZONS) {
    const rs = rows.filter((r) => r.h === h); if (!rs.length) continue;
    const ft = (r, d) => Math.abs(d) * r.k, w4 = rs.filter((r) => r.w4 != null);
    o[h] = { n: rs.length, gauges: new Set(rs.map((r) => r.g)).size, persFt: r5(pm(rs, (r) => ft(r, r.y))), gaugeFt: r5(pm(rs, (r) => ft(r, r.y - r.p0))), v3Ft: r5(pm(rs, (r) => ft(r, r.y - r.p3))), v4Ft: r5(pm(rs, (r) => ft(r, r.y - r.p4))), v4EverywhereFt: r5(pm(rs, (r) => ft(r, r.y - r.pAll4))),
      cov3: r5(pm(rs, (r) => r.in3)), cov4: r5(pm(rs, (r) => r.in4)), width3Ft: r5(pm(rs, (r) => r.w3 * r.k)), width4Ft: r5(pm(rs, (r) => (r.w4 ?? r.w3) * r.k)) };
  }
  return o;
};
const tbl = {};
tbl.allStorm = table(stormRows);
tbl.v3GateOnly = table(stormRows.filter((r) => r.gate3 && !r.gate4));
tbl.v4GateOnly = table(stormRows.filter((r) => !r.gate3 && r.gate4));
tbl.bothGates = table(stormRows.filter((r) => r.gate3 && r.gate4));
tbl.measuredHeavy = table(stormRows.filter((r) => r.tier4 >= 2));
tbl.wetZone = table(stormRows.filter((r) => r.zone === "wet"));
tbl.dryZone = table(stormRows.filter((r) => r.zone === "dry"));
tbl.byTier = { "50-100 mm": table(stormRows.filter((r) => r.tier4 === 2)), "100+ mm": table(stormRows.filter((r) => r.tier4 === 3)) };
const dw0 = Date.UTC(2025, 10, 24), dw1 = Date.UTC(2025, 11, 5);
tbl.ditwah = table(stormRows.filter((r) => { const T = t0 + r.i * H; return T >= dw0 && T < dw1; }));
const d26 = Date.UTC(2026, 9, 26);
tbl.today26Oct = table(stormRows.filter((r) => t0 + r.i * H >= d26));
tbl.calm = Object.fromEntries(Object.entries(calmAgg).map(([h, a]) => [h, { n: a.n, persFt: r5(a.pers / a.n), gaugeFt: r5(a.base / a.n) }]));
tbl.perEvent = events.map((e) => {
  const rs = stormRows.filter((r) => r.ev === e.id && r.h === 6); if (!rs.length) return null;
  return { start: new Date(t0 + e.s * H).toISOString().slice(0, 10), days: Math.round((e.e - e.s) / 24), n6h: rs.length, v3Ft6h: r5(pm(rs, (r) => Math.abs(r.y - r.p3) * r.k)), v4Ft6h: r5(pm(rs, (r) => Math.abs(r.y - r.p4) * r.k)), persFt6h: r5(pm(rs, (r) => Math.abs(r.y) * r.k)) };
}).filter(Boolean);
console.log(JSON.stringify(tbl, null, 1));

// ---- crossings (storm hours, alert / minor / major marks) ------------------------------------------------------------------------------------------------------
const methods = ["pers", "gauge", "v3", "v4"];
const cross = {};
for (const g of active) {
  const k = kft(g), P = preds[g], T = thr[g] ?? {}, lvl = (i) => L[g][i];
  const gate = (i) => gate3[g][i] || gate4[g][i];
  const level = (m, h, i) => lvl(i) + (m === "pers" ? 0 : P[h][m === "gauge" ? "base" : m][i]);
  const high = (m, h, i) => (m === "pers" ? lvl(i) : lvl(i) + P[h][m === "gauge" ? "hiB" : m === "v3" ? "hi3" : "hi4"][i]);
  for (const name of ["alert", "minor", "major"]) {
    const Tn = T[name]; if (Tn == null || !(Tn > 0)) continue;
    const c = (cross[name] ??= { n: 0, ...Object.fromEntries(methods.flatMap((m) => [[m + "_pt", []], [m + "_hi", []]])) });
    for (let i = 30; i < N - 2; i++) {
      if (!(lvl(i - 1) < Tn && lvl(i) >= Tn)) continue;
      let clear = true; for (let j = 2; j <= 24; j++) if (!(lvl(i - j) < Tn)) { clear = false; break; }
      if (!clear || !gate(i)) continue;
      c.n++;
      for (const m of methods) for (const mode of ["pt", "hi"]) {
        let lead = 0;
        for (let j = 1; j <= 24; j++) {
          const o = i - j;
          if (!gate(o) || !Number.isFinite(lvl(o)) || lvl(o) >= Tn) break;
          let flag = false;
          for (const h of STORM_HORIZONS) { const v = mode === "pt" ? level(m, h, o) : high(m, h, o); if (Number.isFinite(v) && v >= Tn) { flag = true; break; } }
          if (!flag) break;
          lead = j;
        }
        c[`${m}_${mode}`].push(lead);
      }
    }
  }
}
const crossOut = {};
for (const [name, c] of Object.entries(cross)) {
  crossOut[name] = { crossings: c.n };
  for (const m of methods) for (const mode of ["pt", "hi"]) { const a = c[`${m}_${mode}`]; crossOut[name][`${m}_${mode}`] = { ge1h: a.filter((x) => x >= 1).length, ge3h: a.filter((x) => x >= 3).length, ge6h: a.filter((x) => x >= 6).length, ge12h: a.filter((x) => x >= 12).length, medLeadH: med(a) }; }
}
console.log("CROSS", JSON.stringify(crossOut, null, 1));

// ---- Holombuwa on 26 Oct 2026: what each model said at each origin hour, held out -------------------------------------------------------------------------
const holo = [];
if (preds.Holombuwa) {
  const g = "Holombuwa";
  for (let i = 0; i < N; i++) {
    const T = t0 + i * H;
    if (T < Date.UTC(2026, 9, 26, 0) || T > Date.UTC(2026, 9, 26, 7)) continue;
    holo.push({ originUTC: new Date(T).toISOString().slice(11, 16), originColombo: new Date(T + 5.5 * H).toISOString().slice(11, 16), levelFt: r5(L[g][i] * kft(g)),
      actualFt: Object.fromEntries(STORM_HORIZONS.map((h) => [h, r5(L[g][i + h] * kft(g))])),
      v3Ft: Object.fromEntries(STORM_HORIZONS.map((h) => [h, r5((L[g][i] + preds[g][h].v3[i]) * kft(g))])),
      v4Ft: Object.fromEntries(STORM_HORIZONS.map((h) => [h, r5((L[g][i] + preds[g][h].v4[i]) * kft(g))])),
      v4HighFt: Object.fromEntries(STORM_HORIZONS.map((h) => [h, r5((L[g][i] + preds[g][h].hi4[i]) * kft(g))])),
      measured3hMm: r5([-3, -2, -1].reduce((s, k) => s + (rainOf[g].m[i + k] ?? 0), 0)) });
  }
  console.log("HOLOMBUWA", JSON.stringify(holo));
}

const json = {
  version: 1, fittedAt: new Date().toISOString(), product: PROD, clipMmPerHour: CLIP, gate: GATE4, burstMm3h: BURST, gate3: GATE3, lam: LAM, trainRange: [t0, gs.t1],
  features: ["beside", "up-channel", "arriving x wet", "forecast", "forecast x wet", "m1", "m3", "m6", "m12", "m24"],
  source: "gauge archive (data branch + nuuuwan/lk_irrigation) + JAXA GSMaP (hour started at the file stamp) bias-corrected per catchment against gauge rain_fall, + Open-Meteo Previous Runs (hour 0, forecast made a day earlier)",
  pooled: V4.pooled, bandFactor: V4.bandFactor, stations: stationsOut,
};
writeFileSync(outFile, JSON.stringify(json) + "\n");
console.log(`wrote ${outFile}`);
if (reportFile) writeFileSync(reportFile, JSON.stringify({ args: { PROD, CLIP, GATE3, GATE4, BURST, BIAS, LAM }, bias: biasInfo, lags: lagsOf, events: events.map((e) => ({ start: new Date(t0 + e.s * H).toISOString().slice(0, 10), days: Math.round((e.e - e.s) / 24) })), tables: tbl, cross: crossOut, holombuwa: holo, bandFactor3: V3.bandFactor, bandFactor4: V4.bandFactor, pooled3: V3.pooled, pooled4: V4.pooled }, null, 1));
