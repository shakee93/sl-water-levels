#!/usr/bin/env node
// Downloads hourly rain for every catchment grid cell (lib/model/catchments.json) for the gauge-archive period from the
// Open-Meteo Previous Runs API, and writes one compact JSON that scripts/storm-backtest.mjs and
// scripts/fit-storm-model.mjs read.
//   observed  = hourly "precipitation" (short-lead analysis; identical to the ERA5 archive API over this period), the same
//               thing the live site calls "past rain"
//   forecast  = "precipitation_previous_day1": what the model forecast for that hour ONE DAY EARLIER (a real forecast, no
//               hindsight; a little older than what the site sees live, so storm skill measured with it is on the cautious side)
// usage: node scripts/fetch-rain-history.mjs --out rain-history.json [--from 2025-11-23] [--to 2026-10-25]
// Keyless. Sequential, polite, retries 429 with a wait. ~300 cells; takes a few minutes.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const out = opt("--out", "rain-history.json");
const from = opt("--from", "2025-11-23"), to = opt("--to", "2026-10-25");
const basins = JSON.parse(readFileSync(path.join(here, "../lib/model/catchments.json"), "utf8")).basins;
const pts = [];
for (const [b, v] of Object.entries(basins)) v.grid.forEach((p, i) => pts.push({ b, i, lat: p[0], lon: p[1] }));
const res = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { from, to, cells: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todo = pts.filter((p) => !res.cells[`${p.b}/${p.i}`]);
console.log(`${pts.length} cells, ${todo.length} to fetch`);
const BATCH = 4;
for (let k = 0; k < todo.length; k += BATCH) {
  const b = todo.slice(k, k + BATCH);
  const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${b.map((p) => p.lat).join(",")}&longitude=${b.map((p) => p.lon).join(",")}&hourly=precipitation,precipitation_previous_day1&start_date=${from}&end_date=${to}&timezone=UTC`;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url);
    if (r.status === 429 || r.status >= 500) { const w = attempt < 3 ? 70_000 : 600_000; console.log(`HTTP ${r.status}, waiting ${w / 1000}s`); await sleep(w); continue; }
    const j = await r.json();
    if (j.error) { const w = /hourly|daily/i.test(j.reason ?? "") ? 3_600_000 : 70_000; console.log(`error ${j.reason}, waiting ${w / 1000}s`); await sleep(w); continue; }
    const list = Array.isArray(j) ? j : [j];
    list.forEach((e, n) => {
      const t = e.hourly.time;
      res.cells[`${b[n].b}/${b[n].i}`] = {
        t0: Date.parse(`${t[0]}Z`),
        obs: e.hourly.precipitation.map((v) => (v == null ? null : +v.toFixed(2))),
        fc1: e.hourly.precipitation_previous_day1.map((v) => (v == null ? null : +v.toFixed(2))),
      };
    });
    break;
  }
  writeFileSync(out, JSON.stringify(res));
  console.log(`${Object.keys(res.cells).length}/${pts.length}`);
  await sleep(2500);
}
console.log("done", out);
