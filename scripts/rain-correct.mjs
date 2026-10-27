// Gauge-corrected satellite rain, written to the `data` branch under rain-correction/. Runs every 30 minutes (rain-correct.yml), after
// the GSMaP and HMIS snapshots, and makes NO request of its own: it reads files already on the data branch.
//
// Usage: node --experimental-strip-types --no-warnings scripts/rain-correct.mjs <dataDir>
//   reads  <dataDir>/gsmap/grid.json       the national 0.1 degree satellite grid (30-minute steps, tenths of mm/h)
//          <dataDir>/hmis/rain-live.json   every live HMIS rain gauge with its recent 24 h sums (scripts/hmis-snapshot.mjs)
//   writes <dataDir>/rain-correction/latest.json     factors, validation, the corrected grid and the corrected catchment / zone values
//          <dataDir>/rain-correction/log/YYYY/YYYY-MM-DD.jsonl   one line per satellite hour: zone + catchment raw and corrected values and
//                                                    the nonzero gauge/satellite pairs (what a backtest needs); written once per hour
// The maths and every constant: lib/rainCorrection.ts. Window: the 24 whole hours ending where the newest :00 satellite step ends; each
// gauge's 24 h sum is the one reported nearest that time (state keeps 4.5 h; the lag is recorded). Official steps never read this file.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitFactors, residualsOf, correct24, correctShort, looValidate, regionOf, classOf, MIN_SAT_MM, SHRINK_K, FACTOR_MIN, FACTOR_MAX, IDW_RADIUS_KM, REGIONS, CLASSES } from "../lib/rainCorrection.ts";
import { STREET_RAIN_ZONES } from "../lib/streetRainZones.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.argv[2];
if (!dataDir) {
  console.error("usage: node --experimental-strip-types scripts/rain-correct.mjs <dataDir>");
  process.exit(1);
}
const HOUR = 3_600_000;
const MIN = 60_000;
const MAX_LAG_MS = 3 * HOUR;
const MIN_PAIRS_TOTAL = 30; // under this many pairs the national fit is not trusted: nothing is published
const r1 = (x) => Math.round(x * 10) / 10;

const grid = JSON.parse(readFileSync(path.join(dataDir, "gsmap/grid.json"), "utf8"));
const live = JSON.parse(readFileSync(path.join(dataDir, "hmis/rain-live.json"), "utf8"));
const { lat0, lon0, step, nx, ny } = grid;
const centre = (i) => [lat0 - Math.floor(i / nx) * step, lon0 + (i % nx) * step];

// ---- satellite 24 h and 6 h per pixel, from the :00 steps (each is the rate over the hour starting there; summing never double counts)
const hours = grid.times.map((iso, i) => ({ start: Date.parse(iso), v: grid.frames[i] })).filter((h) => Number.isFinite(h.start) && h.start % HOUR === 0 && h.v?.length === nx * ny);
const newest = hours.at(-1);
if (!newest) { console.log("no whole-hour satellite steps: nothing to do"); process.exit(0); }
const E = newest.start + HOUR;
if (Date.now() - E > 6 * HOUR) { console.log(`satellite data ends ${new Date(E).toISOString()}, over 6 h old: not corrected`); process.exit(0); }
function totals(n) {
  const win = hours.filter((h) => h.start > newest.start - n * HOUR);
  const need = Math.ceil(n * 0.75);
  return Array.from({ length: nx * ny }, (_, i) => {
    let s = 0, have = 0;
    for (const h of win) if (h.v[i] >= 0) { s += h.v[i] / 10; have++; }
    return have >= need ? (s * n) / have : null;
  });
}
const sat24 = totals(24), sat6 = totals(6), sat3 = totals(3), sat1 = totals(1);
const pixelOf = (lat, lon) => {
  const r = Math.round((lat0 - lat) / step), c = Math.round((lon - lon0) / step);
  return r >= 0 && r < ny && c >= 0 && c < nx ? r * nx + c : -1;
};

// ---- pairs: each live gauge's 24 h sum nearest the end of the satellite window, with the pixel it sits in
const pairs = [];
const lags = [];
for (const [id, d] of Object.entries(live.devices ?? {})) {
  let best = null;
  for (const [tm, mm] of d.pts ?? []) {
    const lag = Math.abs(tm * MIN - E);
    if (lag <= MAX_LAG_MS && (!best || lag < best.lag)) best = { lag, mm };
  }
  const px = pixelOf(d.lat, d.lon);
  if (!best || px < 0 || sat24[px] == null || !(best.mm >= 0 && best.mm <= 1500)) continue;
  pairs.push({ id, name: d.n, lat: d.lat, lon: d.lon, sat: sat24[px], gauge: best.mm });
  lags.push(best.lag / MIN);
}
const lagMedianMin = lags.length ? Math.round([...lags].sort((a, b) => a - b)[lags.length >> 1]) : null;
console.log(`window ends ${new Date(E).toISOString()}: ${pairs.length} gauge/satellite pairs, median time lag ${lagMedianMin} min`);
if (pairs.length < MIN_PAIRS_TOTAL) {
  console.log(`fewer than ${MIN_PAIRS_TOTAL} pairs: not published`);
  process.exit(0);
}

// ---- fit, residuals, corrected fields
const fx = fitFactors(pairs);
const res = residualsOf(pairs, fx);
const corr24 = new Array(nx * ny).fill(null), gain = new Array(nx * ny).fill(null), near = new Array(nx * ny).fill(0);
for (let i = 0; i < nx * ny; i++) {
  if (sat24[i] == null) continue;
  const [lat, lon] = centre(i);
  const c = correct24(fx, res, lat, lon, sat24[i]);
  corr24[i] = c.corr;
  gain[i] = c.factor;
  near[i] = c.near;
}

// ---- catchments and zones: the mean of the corrected pixels over the same pixels the satellite snapshot uses
const cat = JSON.parse(readFileSync(path.join(here, "../lib/model/catchments.json"), "utf8"));
const areas = {}; // key -> pixel indices in the national grid
for (const [basin, b] of Object.entries(cat.basins)) {
  for (const [station, s] of Object.entries(b.stations ?? {})) {
    const pix = new Set();
    for (const i of s.cells ?? []) { const [lat, lon] = b.grid[i]; const p = pixelOf(lat, lon); if (p >= 0) pix.add(p); }
    if (pix.size) areas[`${basin}/${station}`] = [...pix];
  }
}
const zoneAreas = {};
for (const [id, z] of Object.entries(STREET_RAIN_ZONES)) {
  const pix = z.centres.map(([lat, lon]) => pixelOf(lat, lon)).filter((p) => p >= 0);
  if (pix.length) zoneAreas[id] = pix;
}
function areaValues(pix) {
  const ok = pix.filter((p) => sat24[p] != null);
  if (!ok.length) return null;
  const mean = (f) => ok.reduce((a, p) => a + f(p), 0) / ok.length;
  const short = (arr) => mean((p) => correctShort(fx, centre(p)[0], centre(p)[1], sat24[p], arr[p] ?? 0));
  return {
    raw24: r1(mean((p) => sat24[p])), corr24: r1(mean((p) => corr24[p])),
    raw6: r1(mean((p) => sat6[p] ?? 0)), corr6: r1(short(sat6)),
    near: Math.max(...ok.map((p) => near[p])),
  };
}
const stations = {}, zones = {};
for (const [k, pix] of Object.entries(areas)) { const v = areaValues(pix); if (v) stations[k] = v; }
for (const [k, pix] of Object.entries(zoneAreas)) { const v = areaValues(pix); if (v) zones[k] = v; }

// ---- validation (leave one out) and a compact summary
const loo = looValidate(pairs);
const cellOut = (c) => ({ f: Math.round(c.f * 100) / 100, n: c.n, median: c.med == null ? null : Math.round(c.med * 100) / 100 });
const factors = { national: Object.fromEntries(CLASSES.map((c) => [c, cellOut(fx.national[c])])), region: Object.fromEntries(REGIONS.map((r) => [r, Object.fromEntries(CLASSES.map((c) => [c, cellOut(fx.region[r][c])]))])) };
const regionPairs = Object.fromEntries(REGIONS.map((r) => [r, pairs.filter((p) => regionOf(p.lat, p.lon) === r).length]));
// the known failure modes, read off the data every run
const rows = (f) => pairs.filter((p) => p.sat >= MIN_SAT_MM && f(p));
const ratio = (rs) => (rs.length >= 3 ? Math.round((rs.reduce((a, p) => a + p.gauge, 0) / rs.reduce((a, p) => a + p.sat, 0)) * 100) / 100 : null);
const flags = {
  dryZoneGaugeOverSatellite: ratio(rows((p) => regionOf(p.lat, p.lon) === "dry")),
  heavySatelliteGaugeOverSatellite: ratio(rows((p) => classOf(p.sat) === "heavy")),
  note: "sum(gauge)/sum(satellite) over the pairs with satellite >= 1 mm; under 1 = satellite reads high, over 1 = satellite reads low",
};
const q = (a) => a.map((v) => (v == null ? "x" : Math.round(v * 10))).join(",");
const out = {
  method: "v1 (lib/rainCorrection.ts)",
  generatedAt: new Date().toISOString(),
  windowEnd: new Date(E).toISOString(),
  pairs: pairs.length,
  lagMedianMin,
  constants: { minSatMm: MIN_SAT_MM, shrinkK: SHRINK_K, factorMin: FACTOR_MIN, factorMax: FACTOR_MAX, idwRadiusKm: IDW_RADIUS_KM },
  regionPairs,
  factors,
  validation: { ...loo, flags },
  // pixel fields on the same grid as gsmap/grid.json: tenths of mm, "x" = missing; raw/corrected 24 h, per-pixel 1-6 h gain (x100), gauges within 10 km
  grid: { lat0, lon0, step, nx, ny, raw24: q(sat24), corr24: q(corr24), gain: gain.map((g) => (g == null ? "x" : Math.round(g * 100))).join(","), near: near.join(",") },
  stations,
  zones,
};
const dir = path.join(dataDir, "rain-correction");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "latest.json"), JSON.stringify(out) + "\n");
console.log(`wrote rain-correction/latest.json: ${Object.keys(stations).length} catchments, ${Object.keys(zones).length} zones`);

// ---- hourly log for the backtest: once per satellite hour
const stateFile = path.join(dir, "log-state.json");
let last = 0;
try { last = JSON.parse(readFileSync(stateFile, "utf8")).last ?? 0; } catch { /* first run */ }
if (E > last) {
  const iso = new Date(E).toISOString();
  const logDir = path.join(dir, "log", iso.slice(0, 4));
  mkdirSync(logDir, { recursive: true });
  const line = { end: iso, zones, stations: Object.fromEntries(Object.entries(stations).map(([k, v]) => [k, [v.raw24, v.corr24, v.raw6, v.corr6]])), pairs: pairs.filter((p) => p.sat >= 1 || p.gauge >= 1).map((p) => [p.id, r1(p.sat), r1(p.gauge)]) };
  appendFileSync(path.join(logDir, `${iso.slice(0, 10)}.jsonl`), JSON.stringify(line) + "\n");
  writeFileSync(stateFile, JSON.stringify({ last: E }) + "\n");
  console.log("appended the hourly log line");
}
const a = loo.all;
if (a) console.log(`leave-one-out over ${a.n} pairs: MAE raw ${a.maeRaw} mm, factor ${a.maeFactor}, corrected ${a.maeCorrected}`);
