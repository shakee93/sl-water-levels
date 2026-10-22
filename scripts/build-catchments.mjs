#!/usr/bin/env node
// Builds the rain grids in lib/model/catchments.json (keeps each basin's "glofas" entry).
//
// usage: node scripts/build-catchments.mjs [--out lib/model/catchments.json]
//
// For every river basin that has a gauge with published thresholds:
//   1. the basin polygon comes from the Irrigation Department's ArcGIS `river_basins` layer;
//   2. `grid`  = lattice of points every 0.15 deg (~16 km, about the native size of the
//      Open-Meteo deterministic cells in Sri Lanka) that fall inside the polygon;
//      `ens`   = the same every 0.25 deg (the ECMWF IFS ensemble's native 0.25 deg);
//   3. for each gauge, `cells` / `ensCells` = indices of the grid points that count as its
//      UPSTREAM sub-catchment. There is no DEM here, so "upstream" is approximated: a cell is
//      upstream of a gauge when it is not closer to the river mouth than the gauge is
//      (within half a cell). Basins with < 8 points at 0.15 use 0.075. Small basins: if the 0.25 lattice has < 3 points the step is halved. The mouth is hand-placed in OUTLETS below. It is an approximation:
//      tributary gauges (Holombuwa, Urawa, Kuda Oya...) also get neighbouring catchments
//      that are not truly upstream of them. The nearest cell is always included.
// The catchment rain feature of a gauge = the plain mean over its cells (equal-size cells, so
// this is the area-weighted mean). Rerun the fit (scripts/fit-forecast.mjs) after changing this.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const outFile = oi >= 0 ? args[oi + 1] : path.join(here, "../lib/model/catchments.json");
const ARC = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services";
const DET_STEP = 0.15, ENS_STEP = 0.25;

// basin (trimmed hydrostations name) -> [river_basins layer Name, mouth lat, mouth lon]
const OUTLETS = {
  "Kelani Ganga": ["Kelani Ganga", 6.97, 79.85],
  "Kalu Ganga": ["Kalu Ganga", 6.58, 79.95],
  "Gin Ganga": ["Gin Ganga", 6.03, 80.19],
  "Nilwala Ganga": ["Nilwala Ganga", 5.94, 80.54],
  "Aththanagalu Oya": ["Attanagalu Oya", 7.17, 79.83],
  "Deduru Oya": ["Deduru Oya", 7.6, 79.8],
  "Heda Oya": ["Heda Oya", 6.87, 81.83],
  "Kirindi Oya": ["Kirindi Oya", 6.21, 81.31],
  "Kumbukkan Oya": ["Kumbukkan Oya", 6.65, 81.75],
  "Ma Oya": ["Ma Oya", 9.0, 80.8],
  "Maduru Oya": ["Maduru Oya", 7.9, 81.55],
  "Maha Oya": ["Maha Oya", 7.28, 79.88],
  "Mahaweli Ganga": ["Mahaweli Ganga", 8.4, 81.25],
  "Malwathu Oya": ["Aruvi Aru", 8.8, 79.95],
  "Mee Oya": ["Mi Oya", 8.0, 79.8],
  "Menik Ganga": ["Menik Ganga", 6.29, 81.45],
  "Walawe Ganga": ["Walawe Ganga", 6.12, 81.03],
  "Yan Oya": ["Yan Oya", 8.93, 81.0],
};
// GloFAS main-stem cells (verified 2026-10-22: best of a 5x5 scan at 0.05 deg around the lowest gauge, by mean
// discharge over the last 20 days; p95/p99 from the 2010-2024 daily series at that cell). Only basins where the
// 0.05 deg cell actually carries the river are listed; Aththanagalu (scan snapped to the Kelani), Kirindi, Menik,
// Kumbukkan, Heda, Maduru, Yan, Ma, Malwathu and Mee were rejected (cell flow ~0-7 m3/s, median above the recent mean, or wrong river).
const GLOFAS = {
  "Kalu Ganga": { lat: 6.725, lon: 80.125, p95: 285, p99: 405, note: "Kalu main stem near Ellagawa/Putupaula" },
  "Gin Ganga": { lat: 6.075, lon: 80.125, p95: 113, p99: 173, note: "Gin main stem below Baddegama" },
  "Nilwala Ganga": { lat: 6.025, lon: 80.475, p95: 89, p99: 143, note: "Nilwala main stem near Thalgahagoda" },
  "Mahaweli Ganga": { lat: 7.875, lon: 81.025, p95: 732, p99: 1399, note: "Mahaweli main stem near Manampitiya" },
  "Maha Oya": { lat: 7.275, lon: 79.875, p95: 196, p99: 315, note: "Maha Oya near its mouth" },
  "Walawe Ganga": { lat: 6.225, lon: 80.925, p95: 265, p99: 442, note: "Walawe main stem below Moraketiya" },
  "Deduru Oya": { lat: 7.675, lon: 79.875, p95: 169, p99: 333, note: "Deduru Oya near its mouth (the cell is ~12 km downstream of Moragaswewa)" },
};
// Gauges with no readings in the archive (or no thresholds) get no grid: Calidonia, Thambuththegama, Ampara.
const SKIP = new Set(["Calidonia", "Thambuththegama", "Ampara"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(u) {
  for (let a = 1; a <= 3; a++) {
    try { const r = await fetch(u); if (r.ok) return await r.json(); } catch {}
    await sleep(1500 * a);
  }
  throw new Error("fetch failed " + u);
}
const km = (la1, lo1, la2, lo2) => {
  const t = Math.PI / 180, dy = (la2 - la1) * 111.2, dx = (lo2 - lo1) * 111.2 * Math.cos(((la1 + la2) / 2) * t);
  return Math.hypot(dx, dy);
};
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const inside = (x, y, rings) => rings.reduce((c, r) => (inRing(x, y, r) ? !c : c), false);

const old = JSON.parse(readFileSync(outFile, "utf8"));
const st = await json(`${ARC}/hydrostations/FeatureServer/0/query?where=1%3D1&outFields=station,basin,latitude,longitude&returnGeometry=false&f=json`);
const gauges = st.features.map((f) => f.attributes).map((a) => ({ station: a.station.trim(), basin: a.basin.trim(), lat: a.latitude, lon: a.longitude }));

const basins = {};
for (const [basin, [layerName, olat, olon]] of Object.entries(OUTLETS)) {
  const j = await json(`${ARC}/river_basins/FeatureServer/0/query?where=Name%3D%27${encodeURIComponent(layerName)}%27&outFields=Name&returnGeometry=true&outSR=4326&geometryPrecision=3&f=json`);
  await sleep(400);
  const rings = j.features.flatMap((f) => f.geometry.rings);
  if (!rings.length) throw new Error("no polygon for " + basin);
  let minLa = 99, maxLa = -99, minLo = 999, maxLo = -999;
  for (const r of rings) for (const [x, y] of r) { minLa = Math.min(minLa, y); maxLa = Math.max(maxLa, y); minLo = Math.min(minLo, x); maxLo = Math.max(maxLo, x); }
  const lattice = (step) => {
    const out = [];
    for (let la = Math.ceil(minLa / step) * step; la <= maxLa; la += step)
      for (let lo = Math.ceil(minLo / step) * step; lo <= maxLo; lo += step) {
        const p = [+la.toFixed(3), +lo.toFixed(3)];
        if (inside(p[1], p[0], rings)) out.push(p);
      }
    return out;
  };
  let detStep = DET_STEP, grid = lattice(detStep);
  // small basins: halve the step (to 0.075 deg) so the mean still samples the polygon rather than 1-3 cells
  if (grid.length < 8) grid = lattice((detStep = DET_STEP / 2));
  let ensStep = ENS_STEP, ens = lattice(ensStep);
  // small basins fall between 0.25 deg lattice points: halve the step until there are >= 3 (the API snaps to its own cell anyway)
  while (ens.length < 3 && ensStep > 0.04) ens = lattice((ensStep /= 2));
  const mine = gauges.filter((g) => g.basin === basin && !SKIP.has(g.station));
  const stations = {};
  for (const g of mine) {
    const pick = (cells, step) => {
      const dG = km(g.lat, g.lon, olat, olon), margin = (step * 111.2) / 2;
      let idx = cells.map((c, i) => [i, km(c[0], c[1], olat, olon)]).filter(([, d]) => d >= dG - margin).map(([i]) => i);
      if (!idx.length) idx = [cells.map((c, i) => [i, km(c[0], c[1], g.lat, g.lon)]).sort((a, b) => a[1] - b[1])[0][0]];
      return idx;
    };
    stations[g.station] = { cells: pick(grid, detStep), ensCells: pick(ens, ENS_STEP) };
  }
  basins[basin] = { outlet: [olat, olon], grid, ens, stations, ...(GLOFAS[basin] ? { glofas: GLOFAS[basin] } : old.basins[basin]?.glofas ? { glofas: old.basins[basin].glofas } : {}) };
  console.log(basin.padEnd(18), "grid", grid.length, "ens", ens.length, Object.entries(stations).map(([k, v]) => `${k} ${v.cells.length}/${v.ensCells.length}`).join(", "));
}

// compact one-line-per-array formatting
const fmt = (o) => JSON.stringify(o, null, 1).replace(/\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)\n\s+\]/g, "[$1,$2]").replace(/\[\n\s+((?:-?\d+,\n\s+)*-?\d+)\n\s+\]/g, (_, m) => "[" + m.replace(/,\n\s+/g, ",") + "]");
writeFileSync(outFile, fmt({
  _note: "Rain grids per basin, generated by scripts/build-catchments.mjs (do not hand-edit). grid = 0.15 deg lattice points inside the basin polygon (Open-Meteo deterministic rain), ens = 0.25 deg lattice (ECMWF ensemble). stations.<gauge>.cells/ensCells index into grid/ens: the approximate upstream sub-catchment of that gauge (cells not nearer the river mouth than the gauge; see the script header). A gauge's catchment rain is the plain mean over its cells. Changing a grid or a gauge's cells changes the model's rain feature, so refit with scripts/fit-forecast.mjs afterwards. glofas is a main-stem river cell (NOT the nearest cell to a gauge: that can be a tributary); p95/p99 are the 2010-2024 GloFAS climatology at that cell in m3/s.",
  basins,
}) + "\n");
console.log("wrote", outFile);
