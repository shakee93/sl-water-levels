// Satellite rainfall per river catchment from JAXA GSMaP_NOW, written to the `data` branch.
//
// Usage: JAXA_FTP_USER=... JAXA_FTP_PASSWORD=... node scripts/gsmap-snapshot.mjs <outDir>
//
// Why this exists: ground rain gauges are often null at the places that matter, and the site's only
// other rain source is a weather MODEL (Open-Meteo). GSMaP is satellite-OBSERVED rain, available with
// almost no delay. The site has no JAXA credentials, so this runs in GitHub Actions and publishes
// plain JSON that the site reads from the data branch (lib/gsmap.ts).
//
// Source: ftp://hokusai.eorc.jaxa.jp/now/latest/gsmap_now.YYYYMMDD.HHNN.dat.gz (GSMaP_NOW, UTC).
// One file per 30 minutes, ~1.8 MB gzipped: a global 0.1 degree grid, 3600 x 1200 float32 little-endian,
// row 0 = 59.95N going south, column 0 = 0.05E going east, value = rain RATE in mm/h for the hour
// starting at the file's time (negative = missing). The file stamped 12:00 shows up on the server at
// about 13:01, so the newest rain is roughly 1 hour old at best.
//
// Catchments: the same cells the forecast model uses for each gauge (lib/model/catchments.json,
// built by scripts/build-catchments.mjs): the plain mean over the gauge's upstream cells, each cell
// read from the nearest 0.1 degree GSMaP pixel.
//
// Zones: besides the catchments, a few named boxes of 0.1 degree pixels (STREET_RAIN_ZONES below) get the same
// numbers under "zones". The first is "colombo-east" (6.85/6.95 N x 79.85/79.95 E, the 4-pixel box the
// street-flood rule was backtested on, research/wellampitiya-flood-rule-backtest.md). Zone hours are the mean of
// the :00 and :30 files, as in that backtest.
//
// Output in <outDir>/gsmap/:
//   latest.json          per gauge: rate now (mm/h) and rain over the past 1/3/6/24 h (mm); plus "zones"
//   series.json          rolling 49 h of 30-minute rates per gauge (the state each run builds on)
//   archive/YYYY/YYYY-MM-DD.jsonl   one line per new 30-minute step {t, r: {gauge: mm/h}} (UTC day of t)
//
// The ~24 files needed for the first run are downloaded once; afterwards each run fetches only the
// steps it has not seen. Credentials go to curl on stdin, never on the command line.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zoneWindow as zoneWindowOf, STREET_HOURLY_CAP_MM } from "../lib/streetRainWindow.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2];
const user = process.env.JAXA_FTP_USER;
const pass = process.env.JAXA_FTP_PASSWORD;
if (!outDir) {
  console.error("usage: node scripts/gsmap-snapshot.mjs <outDir>");
  process.exit(1);
}
if (!user || !pass) {
  console.error("JAXA_FTP_USER and JAXA_FTP_PASSWORD are not set. Add both as GitHub repository secrets (Settings > Secrets and variables > Actions); the login comes from the JAXA G-Portal / GSMaP registration.");
  process.exit(1);
}

const HOST = "ftp://hokusai.eorc.jaxa.jp";
const DIR = "/now/latest/";
const NX = 3600, NY = 1200, STEP = 0.1, LAT0 = 59.95, LON0 = 0.05;
const KEEP_MS = 49 * 3_600_000; // 48 h of history + the anchor step
const NEED_MS = 25 * 3_600_000; // first run: enough for the 24 h window
const HOUR = 3_600_000;

function curl(args) {
  const cfg = `user = "${`${user}:${pass}`.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n`;
  return execFileSync("curl", ["-K", "-", "-sS", "--fail", "--max-time", "180", "--retry", "2", ...args], {
    input: cfg,
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ---- catchments -------------------------------------------------------------------------------
const cat = JSON.parse(readFileSync(path.join(here, "../lib/model/catchments.json"), "utf8"));
const gauges = []; // {key, basin, station, pixels: [index...]}
for (const [basin, b] of Object.entries(cat.basins)) {
  for (const [station, s] of Object.entries(b.stations ?? {})) {
    const pix = new Set();
    for (const i of s.cells ?? []) {
      const [lat, lon] = b.grid[i];
      const row = Math.round((LAT0 - lat) / STEP);
      const col = Math.round((lon - LON0) / STEP);
      if (row >= 0 && row < NY && col >= 0 && col < NX) pix.add(row * NX + col);
    }
    if (pix.size) gauges.push({ key: `${basin}/${station}`, basin, station, cells: s.cells.length, pixels: [...pix] });
  }
}
console.log(`${gauges.length} gauges with catchment cells`);

// Zones: pixel CENTRES (lat, lon) of the 0.1 degree cells that are averaged. Keys are prefixed "zone:" in the series.
const STREET_RAIN_ZONES = {
  "colombo-east": {
    name: "Greater Colombo east (Wellampitiya, Kolonnawa, Kotikawatta, Mulleriyawa ...)",
    centres: [[6.85, 79.85], [6.85, 79.95], [6.95, 79.85], [6.95, 79.95]],
  },
};
const zones = [];
for (const [id, z] of Object.entries(STREET_RAIN_ZONES)) {
  const pixels = z.centres.map(([lat, lon]) => Math.round((LAT0 - lat) / STEP) * NX + Math.round((lon - LON0) / STEP));
  zones.push({ key: `zone:${id}`, id, name: z.name, cells: pixels.length, pixels });
}
const allKeys = [...gauges, ...zones].map((x) => x.key);

// ---- state ------------------------------------------------------------------------------------
const root = path.join(outDir, "gsmap");
const seriesFile = path.join(root, "series.json");
mkdirSync(path.join(root, "archive"), { recursive: true });
/** rec: Map<ms, {key: rate|null}> */
const rec = new Map();
if (existsSync(seriesFile)) {
  try {
    const s = JSON.parse(readFileSync(seriesFile, "utf8"));
    s.times.forEach((iso, i) => {
      const o = {};
      for (const k of Object.keys(s.stations)) o[k] = s.stations[k][i];
      rec.set(Date.parse(iso), o);
    });
  } catch (e) {
    console.warn(`series.json unreadable, starting over: ${e.message}`);
  }
}

// ---- find new files ---------------------------------------------------------------------------
const names = curl(["--list-only", `${HOST}${DIR}`]).toString().split(/\r?\n/);
const files = [];
for (const n of names) {
  const m = /^gsmap_now\.(\d{4})(\d{2})(\d{2})\.(\d{2})(00|30)\.dat\.gz$/.exec(n.trim());
  if (m) files.push({ name: n.trim(), t: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) });
}
if (!files.length) {
  console.error("No gsmap_now files in the listing: the JAXA directory layout may have changed.");
  process.exit(1);
}
files.sort((a, b) => a.t - b.t);
const newest = files[files.length - 1].t;
// New steps, plus recent steps an older series.json recorded without a zone (re-read once, not archived again).
const todo = files.filter((f) => f.t >= newest - NEED_MS && (!rec.has(f.t) || zones.some((z) => !(z.key in rec.get(f.t)))));
console.log(`newest step ${new Date(newest).toISOString()}, ${todo.length} file(s) to read`);

const newSteps = [];
const tmp = mkdtempSync(path.join(tmpdir(), "gsmap-"));
try {
  for (const f of todo) {
    let grid;
    try {
      const gz = curl([`${HOST}${DIR}${f.name}`]);
      const raw = gunzipSync(gz);
      if (raw.length !== NX * NY * 4) throw new Error(`unexpected size ${raw.length}`);
      grid = new Float32Array(raw.buffer, raw.byteOffset, NX * NY);
    } catch (e) {
      console.warn(`skip ${f.name}: ${e.message}`);
      continue;
    }
    const isNew = !rec.has(f.t);
    const o = rec.get(f.t) ?? {};
    for (const g of [...gauges, ...zones]) {
      if (!isNew && g.key in o) continue;
      let sum = 0, n = 0;
      for (const p of g.pixels) {
        const v = grid[p];
        if (v >= 0 && v < 1000) { sum += v; n++; }
      }
      o[g.key] = n ? Math.round((sum / n) * 100) / 100 : null;
    }
    rec.set(f.t, o);
    if (isNew) newSteps.push([f.t, o]);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- trim, write series -----------------------------------------------------------------------
const times = [...rec.keys()].sort((a, b) => a - b).filter((t) => t >= newest - KEEP_MS);
if (!times.length) {
  console.error("No usable steps.");
  process.exit(1);
}
const anchor = times[times.length - 1];
const series = { updated: new Date().toISOString(), stepMinutes: 30, unit: "mm/h", times: times.map((t) => new Date(t).toISOString()), stations: {} };
for (const k of allKeys) series.stations[k] = times.map((t) => rec.get(t)?.[k] ?? null);
writeFileSync(seriesFile, JSON.stringify(series));

// ---- archive new steps ------------------------------------------------------------------------
for (const [t, o] of newSteps.sort((a, b) => a[0] - b[0])) {
  const iso = new Date(t).toISOString();
  const dir = path.join(root, "archive", iso.slice(0, 4));
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, `${iso.slice(0, 10)}.jsonl`), JSON.stringify({ t: iso, r: o }) + "\n");
}

// ---- latest.json ------------------------------------------------------------------------------
// Rain over the past N hours = sum of the hourly rates at anchor, anchor-1h, ... (each rate is mm/h
// over its own hour, so one step per hour does not double count). Needs 75% of the hours.
function window(key, n) {
  let sum = 0, have = 0;
  for (let k = 0; k < n; k++) {
    const v = rec.get(anchor - k * HOUR)?.[key];
    if (typeof v === "number") { sum += v; have++; }
  }
  if (have === 0 || have < Math.ceil(n * 0.75)) return null;
  return Math.round(((sum * n) / have) * 10) / 10;
}
// Zone rain over the past n clock hours (hour = mean of its :00 and :30 files, each hour capped at 15 mm for the
// "clipped" sum): see lib/streetRainWindow.mjs, shared with the tests.
const zoneWindow = (key, n) => zoneWindowOf((t) => rec.get(t)?.[key], anchor, n);
const out = {
  source: "GSMaP_NOW (JAXA)",
  credit: "GSMaP data by Japan Aerospace Exploration Agency (JAXA)",
  generatedAt: new Date().toISOString(),
  // The newest rain covers the hour starting here (UTC); it ends 1 h later.
  latestStart: new Date(anchor).toISOString(),
  latestEnd: new Date(anchor + HOUR).toISOString(),
  unit: "mm",
  stations: {},
  zones: {},
};
for (const z of zones) {
  const rate = rec.get(anchor)?.[z.key];
  out.zones[z.id] = {
    name: z.name,
    cells: z.cells,
    rateMmPerHour: typeof rate === "number" ? rate : null,
    // raw sums of the hourly means (display); the street rule uses mm24hClipped
    mm1h: zoneWindow(z.key, 1)?.raw ?? null,
    mm3h: zoneWindow(z.key, 3)?.raw ?? null,
    mm6h: zoneWindow(z.key, 6)?.raw ?? null,
    mm24h: zoneWindow(z.key, 24)?.raw ?? null,
    // 24 h sum with each hour capped at hourlyCapMm: the number the street rule compares with 60 / 100 mm
    mm24hClipped: zoneWindow(z.key, 24)?.clipped ?? null,
    hourlyCapMm: STREET_HOURLY_CAP_MM,
  };
}
for (const g of gauges) {
  const rate = rec.get(anchor)?.[g.key];
  out.stations[g.key] = {
    basin: g.basin,
    station: g.station,
    cells: g.cells,
    rateMmPerHour: typeof rate === "number" ? rate : null,
    mm1h: window(g.key, 1),
    mm3h: window(g.key, 3),
    mm6h: window(g.key, 6),
    mm24h: window(g.key, 24),
  };
}
writeFileSync(path.join(root, "latest.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote latest.json (anchor ${out.latestStart}, ${times.length} steps kept)`);
