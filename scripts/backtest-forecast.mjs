#!/usr/bin/env node
// Leave-one-day-out backtest of the forecast models against persistence ("level stays put")
// and a plain linear extrapolation of the last 3h change. Every number is out-of-sample at
// the day level: the day being scored is held out of the fit.
//
// usage: node scripts/backtest-forecast.mjs [archiveDir]      (default: git archive origin/data)
//
// Two rain assumptions are scored, because rain in the future window is the model's big lever:
//   perfect rain  = the rain that actually fell (best case; what a perfect forecast would give)
//   blind rain    = rain not yet fallen at time t is replaced by the training average (worst case)
// A real forecast lands between them. "active" = hours where the level moved more than 0.5
// (station units) over the horizon, i.e. the ones that matter.
// Caveat printed at the end: ~8 days, one rain event, no flood. Treat as a smoke test, not skill.

import { H, HORIZONS, fitStation, quantile } from "../lib/model/core.mjs";
import { STATIONS, exportDataBranch, gaugesOf, hourlyGrid, loadArchive, loadRain, makeCtx } from "./forecast-data.mjs";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? exportDataBranch();
const series = loadArchive(dir);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : "  n/a");
const rainCache = {};

for (const [name, def] of Object.entries(STATIONS)) {
  const cfg = { target: name, terms: def.terms };
  const names = gaugesOf(cfg);
  if (names.some((g) => !series[g])) { console.log(`${name}: skipped (missing archive data)`); continue; }
  const times = hourlyGrid(series, names);
  rainCache[def.basin] ??= await loadRain(dir, def.basin, times[0] - 24 * H, times.at(-1));
  const R = rainCache[def.basin];
  const meanRain = mean(Object.values(R));
  const base = makeCtx(series, R);
  const blind = { ...base, rainFor: (t) => (T) => (T <= t ? R[T] : meanRain) };
  const perfect = fitStation(cfg, base, times);
  const blindFit = fitStation(cfg, blind, times);
  console.log(`\n${name} (${def.basin}), ${perfect.trainDays} days of data. MAE in station units, leave-one-day-out.`);
  console.log("  h    n | persistence | 3h-trend | local-only | MODEL perfect rain | MODEL blind rain | model/persist | active n: persist -> model");
  for (const h of HORIZONS) {
    const o = perfect.oos[h], b = blindFit.oos[h], m = perfect.horizons[h];
    if (!o?.length) continue;
    const ctx = base;
    const trend = o.map((r) => {
      const a = ctx.level(name, r.t), c = ctx.level(name, r.t - 3 * H);
      return a == null || c == null ? NaN : Math.abs(r.y - ((a - c) / 3) * h);
    });
    const act = o.map((r) => Math.abs(r.y) > 0.5);
    const sel = (xs) => xs.filter((_, i) => act[i]);
    const pers = o.map((r) => Math.abs(r.y));
    // the model actually shipped (persistence where the model has no skill)
    const shipped = o.map((r) => Math.abs(r.y - (m.persistence ? 0 : r.pred)));
    const shippedBlind = (b ?? o).map((r) => Math.abs(r.y - (blindFit.horizons[h]?.persistence ? 0 : r.pred)));
    // coverage of the 80% band: pred + q10/q90 residual quantiles (the stored ones, x1.25 experimental inflation)
    const lo = m.q10 * 1.25, hi = m.q90 * 1.25;
    const cover = mean(o.map((r) => ((m.persistence ? 0 : r.pred) + lo <= r.y && r.y <= (m.persistence ? 0 : r.pred) + hi ? 1 : 0)));
    console.log(
      `  ${String(h).padStart(2)} ${String(o.length).padStart(4)} |    ${f(mean(pers))}   |  ${f(mean(trend))}  |   ${f(mean(o.map((r) => Math.abs(r.y - r.predLocal))))}  |       ${f(mean(shipped))}${m.persistence ? "*" : " "}      |      ${f(mean(shippedBlind))}      |    ${f(mean(shipped) / mean(pers))}    | ${act.filter(Boolean).length}: ${f(mean(sel(pers)))} -> ${f(mean(sel(shipped)))}   80% band coverage ${(cover * 100).toFixed(0)}%`,
    );
  }
  console.log("  (* = shipped as persistence because the fitted model had no out-of-sample skill)");
}
console.log("\nCaveat: the archive is ~8 days with one rain event and no flood. These errors say the plumbing works and");
console.log("beat 'no change'; they say nothing about how the model behaves at alert/flood levels. Refit as the archive grows.");
