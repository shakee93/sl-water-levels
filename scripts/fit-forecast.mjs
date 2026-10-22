#!/usr/bin/env node
// Fits the per-station, per-horizon ridge models and writes lib/model/coefficients.json.
//
// usage: node scripts/fit-forecast.mjs [archiveDir] [--out lib/model/coefficients.json]
//   archiveDir  a checkout/export of the `data` branch (YYYY/YYYY-MM-DD.csv, optional rain/).
//               Default: `git archive origin/data` into a temp dir (run `git fetch origin data` first).
//
// Rain comes from the archive's rain/ files when present, else from Open-Meteo (see forecast-data.mjs).
// Re-run whenever the archive has grown (weekly is plenty) and commit the JSON.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitStation } from "../lib/model/core.mjs";
import { STATIONS, exportDataBranch, gaugesOf, hourlyGrid, loadArchive, loadRain, makeCtx } from "./forecast-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const outFile = oi >= 0 ? args[oi + 1] : path.join(here, "../lib/model/coefficients.json");
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out") ?? exportDataBranch();

const series = loadArchive(dir);
const stations = {};
const rainCache = {};
for (const [name, def] of Object.entries(STATIONS)) {
  const cfg = { target: name, terms: def.terms };
  const names = gaugesOf(cfg);
  const absent = names.filter((g) => !series[g]);
  if (absent.length) { console.error(`${name}: skipped, no archive data for ${absent.join(", ")}`); continue; }
  const times = hourlyGrid(series, names);
  if (!rainCache[def.basin]) rainCache[def.basin] = await loadRain(dir, def.basin, times[0] - 24 * 3600e3, times.at(-1));
  const ctx = makeCtx(series, rainCache[def.basin]);
  const fit = fitStation(cfg, ctx, times);
  stations[name] = {
    basin: def.basin,
    mainLeader: def.mainLeader,
    terms: def.terms,
    trainDays: fit.trainDays,
    trainRange: fit.trainRange,
    levelMin: fit.levelMin,
    levelMax: fit.levelMax,
    horizons: fit.horizons,
  };
  console.log(`${name}: ${fit.trainDays} days, horizons ${Object.keys(fit.horizons).join("/")}h`);
  for (const [h, m] of Object.entries(fit.horizons))
    console.log(`  ${String(h).padStart(2)}h n=${m.n} OOS MAE ${m.mae?.toFixed(3)} vs persistence ${m.maePersistence.toFixed(3)}  q10/q90 ${m.q10.toFixed(2)}/${m.q90.toFixed(2)}  w=[${m.w.map((v) => v.toFixed(3)).join(", ")}]`);
}
const round = (k, v) => (typeof v === "number" ? +v.toPrecision(6) : v);
const json = { version: 1, fittedAt: new Date().toISOString(), lambda: 0.15, stations };
writeFileSync(outFile, JSON.stringify(json, round, 1) + "\n");
console.log(`wrote ${outFile}`);
