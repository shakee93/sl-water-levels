#!/usr/bin/env node
// Derives per-station model configs (leader gauges, lags, rain window) from the archive by
// lagged cross-correlation, and writes scripts/station-configs.json (committed; read by
// forecast-data.mjs). Hanwella, Glencourse and Nagalagam Street keep their hand-tuned configs.
//
// usage: node scripts/derive-configs.mjs [archiveDir]      (default: git archive origin/data)
//
// For station S with hourly level L:
//   leader candidates = gauges upstream of S in lib/basinOrder.ts; for each, lag = argmax over 0..12 h of
//     corr( dL_leader(t - lag), dL_S(t) ) on 1 h changes (3 h smoothed); kept only when corr >= 0.3.
//     The best leader with lag <= 4 h gets a 3 h change term, the best with lag > 4 h a 6 h change term
//     (at most two leader terms: the archive is short, so more would overfit).
//   rain window = centred on argmax over 1..18 h of corr( rain(t - lag), dL_S(t) ) (rain = the gauge's
//     upstream-area mean, 3 h smoothed); window (lag+4, max(0, lag-4)] hours before the target time.
// Every correlation is printed; this script only suggests, the fit decides whether it ships.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { H } from "../lib/model/core.mjs";
import { BASIN_ORDER } from "../lib/basinOrder.ts";
import { CATCHMENTS, STATIONS, exportDataBranch, hourlyGrid, loadArchive, loadRain, makeCtx } from "./forecast-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? exportDataBranch();
const series = loadArchive(dir);

const corr = (a, b) => {
  const p = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null && Number.isFinite(x) && Number.isFinite(y));
  if (p.length < 40) return { r: 0, n: p.length };
  const ma = p.reduce((s, [x]) => s + x, 0) / p.length, mb = p.reduce((s, [, y]) => s + y, 0) / p.length;
  let sab = 0, saa = 0, sbb = 0;
  for (const [x, y] of p) { sab += (x - ma) * (y - mb); saa += (x - ma) ** 2; sbb += (y - mb) ** 2; }
  return { r: saa && sbb ? sab / Math.sqrt(saa * sbb) : 0, n: p.length };
};
const best = (xs, lags, target) => {
  let o = { r: -2, lag: 0 };
  for (const lag of lags) {
    const { r } = corr(xs.map((_, i) => xs[i - lag]), target);
    if (r > o.r) o = { r, lag };
  }
  return o;
};

const out = {};
for (const [basin, cfg] of Object.entries(CATCHMENTS)) {
  for (const name of Object.keys(cfg.stations)) {
    if (STATIONS[name] || !series[name]) continue;
    const upstream = (BASIN_ORDER[basin] ?? []).slice(0, Math.max(0, (BASIN_ORDER[basin] ?? []).indexOf(name))).filter((g) => series[g]);
    const names = [name, ...upstream];
    const times = hourlyGrid(series, names);
    const ctx = makeCtx(series, {});
    const d3 = (g) => times.map((t) => { const a = ctx.level(g, t), b = ctx.level(g, t - 3 * H); return a == null || b == null ? null : (a - b) / 3; });
    const target = times.map((t) => { const a = ctx.level(name, t), b = ctx.level(name, t - H); return a == null || b == null ? null : a - b; });
    const leaders = upstream.map((g) => ({ g, ...best(d3(g), [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12], target) })).filter((l) => l.r >= 0.3);
    const R = await loadRain(dir, basin, name, times[0] - 24 * H, times.at(-1));
    const rs = times.map((t) => { let s = 0; for (let k = 0; k < 3; k++) { const v = R[t - k * H]; if (v == null) return null; s += v; } return s / 3; });
    const rl = best(rs, [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 18], target);
    const near = leaders.filter((l) => l.lag <= 4).sort((a, b) => b.r - a.r)[0];
    const far = leaders.filter((l) => l.lag > 4).sort((a, b) => b.r - a.r)[0];
    const terms = [{ k: "delta", g: [name], hrs: 3, label: "own 3h change", local: true }];
    if (near) terms.push({ k: "delta", g: [near.g], hrs: 3, label: `${near.g} 3h change` });
    if (far) terms.push({ k: "delta", g: [far.g], hrs: 6, label: `${far.g} 6h change` });
    if (rl.r > 0.1) terms.push({ k: "rain", from: rl.lag + 4, to: Math.max(0, rl.lag - 4), label: "catchment rain" });
    else terms.push({ k: "rain", from: 12, to: 4, label: "catchment rain" });
    terms.push({ k: "level", label: "level", local: true });
    out[name] = {
      basin,
      mainLeader: (near ?? far)?.g ?? null,
      terms,
      evidence: { leaders: leaders.map((l) => ({ g: l.g, lag: l.lag, r: +l.r.toFixed(2) })), rainLag: rl.lag, rainR: +rl.r.toFixed(2) },
    };
    console.log(`${name.padEnd(26)} leaders ${leaders.map((l) => `${l.g} lag${l.lag} r${l.r.toFixed(2)}`).join(", ") || "none"} | rain lag ${rl.lag} r${rl.r.toFixed(2)}`);
  }
}
writeFileSync(path.join(here, "station-configs.json"), JSON.stringify(out, null, 1) + "\n");
console.log("wrote scripts/station-configs.json");
