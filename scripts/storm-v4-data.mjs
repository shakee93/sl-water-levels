// Shared loader for the v4 storm model and the river-rain response analysis: gauge levels, measured (satellite) rain with the
// per-catchment bias correction, Open-Meteo rain, the near / up-channel split and the learned travel times.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATCHMENTS, STATIONS, loadArchive } from "./forecast-data.mjs";
import { loadGaugeSeries } from "./gauge-series.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const H = 3_600_000, FT = 0.3048;

export function loadV4({ dir, histFile, rainFile: rainPath, gsFile, prod = "now0", clip = 15, bias: biasOn = true }) {
const PROD = prod, CLIP = clip, BIAS = biasOn;
const gs = loadGaugeSeries({ dir, histFile });
const { L, t0, N, basinOf, thr } = gs;
const rainFile = JSON.parse(readFileSync(rainPath, "utf8"));
const GS = JSON.parse(readFileSync(gsFile, "utf8"));
const SUB = JSON.parse(readFileSync(path.join(here, "../lib/model/subcatchments.json"), "utf8"));
const archive = loadArchive(dir ?? "");
const norm = (b) => b.trim();
const keyOf = (g) => `${norm(basinOf[g])}/${g}`;

// ---- measured rain: bias factors per catchment (satellite vs rain-gauge readings in the archive, Oct 2026) ----------------------
// Hourly gauge rain: each reading's rain_fall is mm since the previous reading, spread over that interval (<= 3 h), summed per clock hour.
function gaugeHourly(g) {
  const rows = archive[g] ?? [], out = new Map();
  for (let j = 1; j < rows.length; j++) {
    const a = rows[j - 1], b = rows[j];
    if (b.rf == null || !(b.rf >= 0 && b.rf < 500) || b.ts - a.ts > 3 * H || b.ts <= a.ts) continue;
    for (let T = Math.floor(a.ts / H) * H; T < b.ts; T += H) {
      const ov = Math.min(b.ts, T + H) - Math.max(a.ts, T);
      if (ov > 0) out.set(T + H, (out.get(T + H) ?? 0) + (b.rf * ov) / (b.ts - a.ts));
    }
  }
  return out;
}
const WET = new Set(["Kelani Ganga", "Kalu Ganga", "Gin Ganga", "Nilwala Ganga", "Maha Oya", "Aththanagalu Oya", "Deduru Oya", "Walawe Ganga", "Mahaweli Ganga"]);
const zoneOf = (g) => (WET.has(norm(basinOf[g])) ? "wet" : "dry");
const satRaw = (key) => GS.products[PROD]?.[key];
const gsAt = (arr, T) => { const j = Math.round((T - GS.t0End) / H); const v = arr?.[j]; return v == null ? NaN : v; };
const bias = {}, biasInfo = {};
{
  const acc = {};
  for (const g of gs.gauges) {
    const sat = satRaw(keyOf(g)); if (!sat || g === "Nagalagam Street") continue; // its rain sensor reads a constant 0
    const gh = gaugeHourly(g); let G = 0, S = 0, n = 0;
    for (const [T, v] of gh) { const s = gsAt(sat, T); if (Number.isFinite(s)) { G += v; S += Math.min(s, 40); n++; } }
    acc[g] = { G, S, n, zone: zoneOf(g) };
  }
  const zone = {};
  for (const z of ["wet", "dry"]) { const a = Object.values(acc).filter((x) => x.zone === z); const G = a.reduce((s, x) => s + x.G, 0), S = a.reduce((s, x) => s + x.S, 0); zone[z] = S > 20 ? G / S : 1; }
  const TAU = 60; // mm of satellite rain worth of prior: thin gauges lean on their zone
  for (const g of gs.gauges) {
    const a = acc[g], z = zone[zoneOf(g)] ?? 1;
    const k = a ? (a.G + TAU * z) / (a.S + TAU) : z;
    bias[g] = BIAS ? Math.max(0.25, Math.min(1.5, k)) : 1;
    biasInfo[g] = { k: +bias[g].toFixed(2), zone: zoneOf(g), zoneK: +z.toFixed(2), gaugeMm: a ? +a.G.toFixed(0) : null, satMm: a ? +a.S.toFixed(0) : null };
  }
  console.log("bias zone factors (gauge/satellite)", JSON.stringify(zone), "sat product", PROD, "clip", CLIP);
}

// ---- series per gauge: Open-Meteo (v3) and measured (v4) for the full catchment, near and up ---------------------------------------
function omCells(B, idx) {
  const cs = idx.map((i) => rainFile.cells[`${B}/${i}`]);
  if (!idx.length || cs.some((c) => !c)) return null;
  const obs = new Float64Array(N).fill(NaN), fc = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) {
    const T = t0 + i * H;
    let so = 0, sf = 0, ko = 0, kf = 0;
    for (const c of cs) { const j = Math.round((T - c.t0) / H); const a = c.obs[j], b = c.fc1[j]; if (a != null) { so += a; ko++; } if (b != null) { sf += b; kf++; } }
    if (ko === cs.length) obs[i] = so / ko;
    if (kf === cs.length) fc[i] = sf / kf;
  }
  return { obs, fc };
}
function measured(g, suffix = "") {
  const arr = satRaw(keyOf(g) + suffix);
  if (!arr) return null;
  const k = bias[g], a = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) { const v = gsAt(arr, t0 + i * H); if (Number.isFinite(v)) a[i] = Math.min(v * k, CLIP); }
  return a;
}
const rainOf = {};
for (const g of gs.gauges.sort()) {
  const B = norm(basinOf[g]), sc = CATCHMENTS[B]?.stations?.[g], sub = SUB[basinOf[g]]?.[g] ?? SUB[B]?.[g];
  if (!sc || !sub) continue;
  const full = omCells(B, sc.cells), near = omCells(B, sub.near), up = sub.up.length ? omCells(B, sub.up) : null;
  const m = measured(g), mn = measured(g, "#near"), mu = sub.up.length ? measured(g, "#up") : null;
  if (!full || !near || !m || !mn) continue;
  rainOf[g] = { full, near, up, m, mn, mu, hasUp: sub.up.length > 0, children: sub.children };
}
const winOf = (g) => { const t = STATIONS[g]?.terms?.find((x) => x.k === "rain"); return t ? { from: t.from, to: t.to } : { from: 12, to: 2 }; };
const rAt3 = (g) => (i) => (k) => (k <= 0 ? rainOf[g].full.obs[i + k] : rainOf[g].full.fc[i + k]);
// composite: k <= -1 measured, k = 0 model hour, k >= 1 forecast made a day earlier
const comp = (g, part, i) => {
  const R = rainOf[g];
  const meas = part === "full" ? R.m : part === "near" ? R.mn : R.mu;
  const om = part === "full" ? R.full : part === "near" ? R.near : R.up;
  return (k) => (k <= -1 ? meas[i + k] : k === 0 ? om.obs[i] : om.fc[i + k]);
};


const kft = (g) => (gs.unit(g) === "m" ? 1 / FT : 1);
const cover = (g) => L[g].reduce((s, v) => s + (Number.isFinite(v) ? 1 : 0), 0) / N;
// ---- learned travel times: rain on a sub-catchment (measured, bias-corrected) against the river's rise at the gauge --------------------
// For lag L in 0..36 h: correlation of rain(t-L) (1 h) with the 3 h-smoothed rise of the level at t, on hours where the sub-catchment saw >= 20 mm in 24 h.
function lagOf(g, ser) {
  if (!ser) return null;
  let best = { c: -1, lag: 0 };
  const n24 = (i) => { let s = 0; for (let k = 0; k < 24; k++) { const v = ser[i - k]; if (Number.isFinite(v)) s += v; } return s; };
  const rise = new Float64Array(N).fill(NaN);
  for (let i = 3; i < N; i++) { const d = L[g][i] - L[g][i - 3]; if (Number.isFinite(d)) rise[i] = Math.max(0, d) * kft(g); }
  for (let lag = 0; lag <= 36; lag++) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
    for (let i = 60; i < N; i++) {
      const x = ser[i - lag], y = rise[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || n24(i - lag) < 20) continue;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    if (n < 80) return null;
    const c = (n * sxy - sx * sy) / Math.sqrt(Math.max(1e-9, (n * sxx - sx * sx) * (n * syy - sy * sy)));
    if (c > best.c) best = { c, lag };
  }
  return { lag: best.lag, corr: +best.c.toFixed(3) };
}


return { gs, L, t0, N, basinOf, thr, rainOf, comp, rAt3, winOf, bias, biasInfo, lagOf, kft, cover, zoneOf, keyOf, norm, archive, gaugeHourly, SUB, rainFile, GS, CLIP, PROD, H, FT };
}
