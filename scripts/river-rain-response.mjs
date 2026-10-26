#!/usr/bin/env node
// How each river reacts to rain, learned from 11 months of hourly levels and measured (satellite, bias-corrected) catchment rain.
// Writes (1) lib/model/rain-thresholds.json: per gauge, the catchment rain over a window that historically came before a rise of
// 1 ft or more within the next 24 h (shape read by lib/rainTriggers.ts: gauges[name] = { mm1h, mm3h, mm24h, ... }), and
// (2) lib/model/river-response.json: the small facts the station page needs (travel times, typical rise, confidence), and
// (3) a long report (JSON) that research/river-rain-response.md is written from.
// usage: node scripts/river-rain-response.mjs --gs gs.json --rain rain-history.json --history all.json [archiveDir] [--prod now0] [--clip 15] [--report f]
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadV4 } from "./storm-v4-data.mjs";
import { CATCHMENTS } from "./forecast-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const skip = new Set(["--gs", "--rain", "--history", "--prod", "--clip", "--report", "--out-thresholds", "--out-response"]);
const dir = args.find((a, i) => !a.startsWith("--") && !skip.has(args[i - 1])) ?? undefined;
const D = loadV4({ dir, histFile: opt("--history"), rainFile: opt("--rain"), gsFile: opt("--gs"), prod: opt("--prod", "now0"), clip: +opt("--clip", 15) });
const { gs, L, t0, N, basinOf, thr, rainOf, kft, cover, zoneOf, norm, keyOf, biasInfo, lagOf, archive, H } = D;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(1));
const WINDOWS = [1, 3, 6, 12, 24];
const MM = [5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 120, 150, 200];
const FT = 1; // outcome thresholds in feet

function cellArea(B) {
  const grid = CATCHMENTS[B].grid, lats = [...new Set(grid.map((p) => p[0]))].sort((a, b) => a - b), lons = [...new Set(grid.map((p) => p[1]))].sort((a, b) => a - b);
  const stepOf = (v) => { const d = []; for (let i = 1; i < v.length; i++) d.push(+(v[i] - v[i - 1]).toFixed(4)); d.sort((a, b) => a - b); return d[0] ?? 0.15; };
  const step = Math.min(stepOf(lats) || 0.15, stepOf(lons) || 0.15);
  const lat = grid.reduce((s, p) => s + p[0], 0) / grid.length;
  return step * 111.2 * step * 111.2 * Math.cos((lat * Math.PI) / 180);
}

const out = {}, thresholds = {}, response = {};
for (const g of Object.keys(rainOf).sort()) {
  if (cover(g) <= 0.7) continue;
  const R = rainOf[g], B = norm(basinOf[g]), k = kft(g), lvl = L[g];
  const cs = CATCHMENTS[B].stations[g];
  const m = R.m;
  // rolling sums of measured catchment rain over the last w hours (hours ending at i)
  const roll = {};
  for (const w of WINDOWS) {
    const a = new Float64Array(N).fill(NaN);
    for (let i = w; i < N; i++) { let s = 0, ok = true; for (let j = 0; j < w; j++) { const v = m[i - j]; if (!Number.isFinite(v)) { ok = false; break; } s += v; } if (ok) a[i] = s; }
    roll[w] = a;
  }
  const rise = new Float64Array(N).fill(NaN), crossAlert = new Uint8Array(N), T = thr[g] ?? {};
  for (let i = 80; i < N - 25; i++) {
    if (!Number.isFinite(lvl[i])) continue;
    let mx = -Infinity;
    for (let j = 1; j <= 24; j++) { const v = lvl[i + j]; if (Number.isFinite(v) && v > mx) mx = v; }
    if (Number.isFinite(mx)) { rise[i] = Math.max(0, (mx - lvl[i]) * k); if (T.alert > 0 && lvl[i] < T.alert && mx >= T.alert) crossAlert[i] = 1; }
  }
  const base = (() => { let n = 0, c = 0; for (let i = 80; i < N - 25; i++) if (Number.isFinite(rise[i])) { n++; if (rise[i] >= FT) c++; } return n ? c / n : 0; })();
  // threshold per window: smallest mm whose hours were followed by a >= 1 ft rise at least half the time (>= 8 hours, >= 2 separate events)
  const events = (hrs) => { let n = 0, last = -999; for (const i of hrs) { if (i - last > 24) n++; last = i; } return n; };
  const perWin = {};
  for (const w of WINDOWS) {
    const rows = [];
    for (let i = 80; i < N - 25; i++) if (Number.isFinite(roll[w][i]) && Number.isFinite(rise[i])) rows.push(i);
    // AUC-like: P(rain higher at a rise hour than at a non-rise hour), by ranks on a subsample
    const pos = rows.filter((i) => rise[i] >= FT).map((i) => roll[w][i]), neg = rows.filter((i) => rise[i] < FT).map((i) => roll[w][i]);
    let auc = null;
    if (pos.length >= 10 && neg.length >= 10) {
      const sn = [...neg].sort((a, b) => a - b); let s = 0;
      for (const p of pos) { let lo = 0, hi = sn.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sn[mid] < p) lo = mid + 1; else hi = mid; } s += lo / sn.length; }
      auc = s / pos.length;
    }
    // a threshold only counts if it lifts the odds well above the gauge's own base rate (hours cluster inside one event, so "any rain" can look precise)
    const baseOf = (flagOutcome) => (rows.length ? rows.filter(flagOutcome).length / rows.length : 0);
    const pick = (flagOutcome, minPrec0) => {
      const minPrec = Math.max(minPrec0, 3 * baseOf(flagOutcome));
      for (const mm of MM) {
        const f = rows.filter((i) => roll[w][i] >= mm);
        if (f.length < 8) return null;
        const hit = f.filter((i) => flagOutcome(i));
        const ev = events(f);
        if (ev >= 2 && hit.length / f.length >= minPrec) return { mm, hours: f.length, events: ev, precision: +(hit.length / f.length).toFixed(2), caught: +(hit.length / Math.max(1, rows.filter(flagOutcome).length)).toFixed(2) };
      }
      return null;
    };
    perWin[w] = { auc: auc == null ? null : +auc.toFixed(3), rise1ft: pick((i) => rise[i] >= FT, 0.5), rise3ft: pick((i) => rise[i] >= 3, 0.4), alert: T.alert > 0 ? pick((i) => crossAlert[i] === 1, 0.3) : null };
  }
  // Longer windows always score higher (a day's rain is a bigger number), so take the SHORTEST window within 0.03 of the best score.
  const aucs = WINDOWS.filter((w) => perWin[w].auc != null);
  const topAuc = Math.max(...aucs.map((w) => perWin[w].auc));
  const bestW = aucs.find((w) => perWin[w].auc >= topAuc - 0.03) ?? null;
  // sensitivity: ft of rise within 24 h per 10 mm over the best window, wet vs dry ground (72 h rain above / below the median)
  let sens = null;
  if (bestW) {
    const rows = [];
    for (let i = 80; i < N - 25; i++) if (Number.isFinite(roll[bestW][i]) && roll[bestW][i] >= 10 && Number.isFinite(rise[i]) && Number.isFinite(roll[24][i])) rows.push(i);
    const p72 = (i) => { let s = 0; for (let j = 0; j < 72; j++) { const v = m[i - j]; if (Number.isFinite(v)) s += v; } return s; };
    const mid = med(rows.map(p72)) ?? 0;
    const ratio = (rs) => med(rs.map((i) => (rise[i] / roll[bestW][i]) * 10));
    sens = { n: rows.length, all: r1(ratio(rows)), wet: r1(ratio(rows.filter((i) => p72(i) >= mid))), dry: r1(ratio(rows.filter((i) => p72(i) < mid))), p72Median: r1(mid) };
  }
  // travel times: near / up-channel, and each upstream gauge's catchment against the rise here
  const trust = (l) => (l && l.corr >= 0.15 ? l : null); // a correlation under 0.15 is noise: no travel time claimed
  const own = trust(lagOf(g, R.mn)), up = R.hasUp ? trust(lagOf(g, R.mu)) : null;
  const children = (R.children ?? []).map((u) => { const l = rainOf[u] ? trust(lagOf(g, rainOf[u].m)) : null; return { gauge: u, hours: l?.lag ?? null, corr: l?.corr ?? null, cells: CATCHMENTS[B].stations[u].cells.length }; });
  // time from the heaviest 3 h of an event to the peak: events = runs of hours with 6 h rain >= half the gauge's own 1 ft threshold
  const th6 = perWin[6]?.rise1ft?.mm ?? 20;
  const peaks = [];
  for (let i = 80, last = -999; i < N - 49; i++) {
    if (!(roll[6][i] >= th6) || i - last <= 48) continue;
    // event starts here: its heaviest hour and the level peak in the next 60 h
    let hr = i, hm = -1, lp = i, lm = -Infinity;
    for (let j = 0; j < 36 && i + j < N; j++) { const v = m[i + j]; if (Number.isFinite(v) && v > hm) { hm = v; hr = i + j; } }
    for (let j = 0; j < 60 && i + j < N; j++) { const v = lvl[i + j]; if (Number.isFinite(v) && v > lm) { lm = v; lp = i + j; } }
    const riseFt = (lm - lvl[i]) * k;
    if (riseFt >= 0.5) peaks.push({ start: new Date(t0 + i * H).toISOString().slice(0, 10), hoursToPeak: lp - hr, riseFt: r1(riseFt), rain6: r1(roll[6][i]) });
    last = i;
  }
  // worked examples: Ditwah and 26 Oct
  const win = (a, b) => { const i0 = Math.round((Date.UTC(...a) - t0) / H), i1 = Math.round((Date.UTC(...b) - t0) / H); let mx = -Infinity, mi = 0, r24 = 0, base0 = lvl[Math.max(0, i0)]; for (let i = Math.max(i0, 0); i <= Math.min(i1, N - 1); i++) { if (lvl[i] > mx) { mx = lvl[i]; mi = i; } } for (let i = Math.max(i0, 25); i <= Math.min(i1, N - 1); i++) if (Number.isFinite(roll[24][i]) && roll[24][i] > r24) r24 = roll[24][i]; return Number.isFinite(mx) && mx > -Infinity ? { peakFt: r1(mx * k), riseFt: r1((mx - base0) * k), peakAt: new Date(t0 + mi * H + 5.5 * H).toISOString().slice(5, 16).replace("T", " "), max24hRainMm: r1(r24) } : null; };
  const ditwah = win([2025, 10, 25], [2025, 10, 30]);
  const today = win([2026, 9, 25, 12], [2026, 9, 26, 12]);
  // data quality
  const gaugeRows = (archive[g] ?? []).filter((r) => r.ts >= Date.UTC(2026, 9, 15));
  const rfShare = gaugeRows.length ? gaugeRows.filter((r) => r.rf != null).length / gaugeRows.length : null;
  const rfSum = gaugeRows.reduce((s, r) => s + (r.rf ?? 0), 0);
  const dead = gaugeRows.length > 50 && rfSum === 0;
  const omRatio = (() => { const a = []; for (let i = 30; i < N; i++) { let o = 0, s = 0, ok = true; for (let j = 0; j < 6; j++) { const x = R.full.obs[i - j], y = m[i - j]; if (!Number.isFinite(x) || !Number.isFinite(y)) { ok = false; break; } o += x; s += y; } if (ok && s >= 8) a.push(o / s); } return { median: med(a) == null ? null : +med(a).toFixed(2), n: a.length }; })();
  const riseHours = (() => { let c = 0; for (let i = 80; i < N - 25; i++) if (rise[i] >= FT) c++; return c; })();
  const evTotal = (() => { const hrs = []; for (let i = 80; i < N - 25; i++) if (rise[i] >= FT) hrs.push(i); return events(hrs); })();
  const area = cs.cells.length * cellArea(B);
  const t = perWin;
  const pk = (w) => (t[w]?.auc != null && t[w].auc >= 0.6 ? t[w]?.rise1ft?.mm ?? null : null);
  const conf = (() => { const w = bestW && t[bestW].auc >= 0.6 && t[bestW].rise1ft; if (!w) return "none"; return w.events >= 4 && w.hours >= 25 && t[bestW].auc >= 0.7 ? "high" : w.events >= 3 && t[bestW].auc >= 0.6 ? "medium" : "low"; })();
  out[g] = { basin: B, unit: gs.unit(g), zone: zoneOf(g), cells: { full: cs.cells.length, near: R.mn ? D.SUB[basinOf[g]]?.[g]?.near?.length ?? null : null, up: D.SUB[basinOf[g]]?.[g]?.up?.length ?? 0 }, areaKm2: Math.round(area / 10) * 10, children, tidal: gs.unit(g) !== "x" && g === "Nagalagam Street",
    quality: { gaugeRainShare: rfShare == null ? null : +rfShare.toFixed(2), gaugeRainDead: dead, satBiasFactor: biasInfo[g], openMeteoOverSatellite6h: omRatio },
    lag: { nearH: own?.lag ?? null, nearCorr: own?.corr ?? null, upH: up?.lag ?? null, upCorr: up?.corr ?? null }, bestWindowH: bestW, windows: perWin, baseRateRise1ftPct: +(base * 100).toFixed(1), riseHours, riseEvents: evTotal, sensitivity: sens,
    timeToPeakH: { median: med(peaks.map((p) => p.hoursToPeak)), n: peaks.length, events: peaks.slice(0, 12) }, ditwah, today26Oct: today, confidence: conf, alertFt: T.alert ?? null };
  thresholds[g] = { mm1h: pk(1), mm3h: pk(3), mm6h: pk(6), mm12h: pk(12), mm24h: pk(24), windowH: bestW, mmWindow: bestW ? pk(bestW) : null, mmAlert: bestW && t[bestW].auc >= 0.6 ? t[bestW].alert?.mm ?? null : null, confidence: conf, events: bestW ? t[bestW].rise1ft?.events ?? 0 : 0 };
  response[g] = { nearLagH: own?.lag ?? null, upLagH: up?.lag ?? null, upGauges: children.filter((c) => c.hours != null).sort((a, b) => b.cells - a.cells).slice(0, 3).map((c) => ({ gauge: c.gauge, hours: c.hours })),
    windowH: bestW, mmFor1ft: bestW ? pk(bestW) : null, ftPer10mm: sens?.all ?? null, ftPer10mmWet: sens?.wet ?? null, ftPer10mmDry: sens?.dry ?? null, timeToPeakH: med(peaks.map((p) => p.hoursToPeak)), confidence: conf, events: bestW ? t[bestW].rise1ft?.events ?? 0 : 0, tidal: g === "Nagalagam Street" };
  console.log(g.padEnd(26), `area~${out[g].areaKm2} km2 lag near ${own?.lag ?? "-"} up ${up?.lag ?? "-"} | window ${bestW}h auc ${bestW ? t[bestW].auc : "-"} 1ft at ${bestW ? pk(bestW) : "-"} mm | alert ${thresholds[g].mmAlert ?? "-"} | ft/10mm ${sens?.all ?? "-"} (wet ${sens?.wet ?? "-"}, dry ${sens?.dry ?? "-"}) | peak lag ${out[g].timeToPeakH.median ?? "-"} h (${peaks.length}) | conf ${conf}`);
}
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === null ? undefined : v)));
writeFileSync(opt("--out-thresholds", path.join(here, "../lib/model/rain-thresholds.json")), JSON.stringify({
  note: "Per-gauge flood-relevant rain thresholds, read by lib/rainTriggers.ts. Written by scripts/river-rain-response.mjs from 11 months of hourly levels and JAXA GSMaP_NOW catchment rain (bias-corrected per catchment against rain gauges, each hour clipped at 15 mm/h). mmNh = catchment-mean mm over the last N hours that was followed, at least half of the time, by a rise of 1 ft or more within 24 h (smallest tested amount with at least 8 hours and 2 separate events). windowH = the window whose rain separated rise from no-rise best; mmWindow = the threshold for that window; mmAlert = the same for crossing the alert mark (>= 30% of hours). AREA averages, not a point gauge reading: a point gauge in a cloudburst reads more. Gauges with no determinable threshold use the national numbers (lib/rainWords.ts).",
  basis: "catchment-mean satellite rain, bias-corrected", generatedAt: new Date().toISOString(), gauges: strip(Object.fromEntries(Object.entries(thresholds).filter(([, v]) => v.confidence === "high" || v.confidence === "medium"))), // low / none: the national numbers stay
}, null, 1) + "\n");
writeFileSync(opt("--out-response", path.join(here, "../lib/model/river-response.json")), JSON.stringify({ generatedAt: new Date().toISOString(), gauges: strip(response) }) + "\n");
if (opt("--report")) writeFileSync(opt("--report"), JSON.stringify(out, null, 1));
