// Daily archive of every gauge reading in the ArcGIS feed.
//
// Why: gauges_2_view only keeps a rolling ~7 days of readings (oldest row
// was 2026-10-15 on 2026-10-22), so history disappears unless we copy it.
//
// Usage: node scripts/snapshot.mjs <outDir>
//
// Pulls every row currently in the feed, groups by Sri Lanka calendar day
// (Asia/Colombo, UTC+05:30, no DST) and writes <outDir>/YYYY/YYYY-MM-DD.csv.
// Existing files are merged by objectid rather than overwritten, so each run
// is idempotent and a missed run self-heals as long as the next one lands
// within the feed's ~7-day window. Today's (incomplete) day is written too
// and gets completed by tomorrow's run. Also refreshes <outDir>/stations.json.
//
// Also archives the weather the forecast model is fitted on (best effort: a weather
// outage must never block the gauge archive, so failures only log a warning):
//   <outDir>/rain/YYYY/YYYY-MM-DD.csv     hourly Open-Meteo precipitation (mm, hour ENDING at
//                                         time_utc) at each catchment point in lib/model/catchments.json
//   <outDir>/glofas/YYYY/YYYY-MM-DD.csv   daily GloFAS river discharge (m3/s) at each basin's main-stem cell
// Rain is taken from the forecast api with past_days (analysis, no multi-day lag like the
// archive api) and only for hours already elapsed, so rewrites are stable.
//
// No dependencies: Node 22 fetch + fs only, so CI needs no npm install.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SERVICES = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services";
const PAGE = 1000; // layer maxRecordCount
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const COLUMNS = [
  "objectid",
  "basin",
  "gauge",
  "time_utc",
  "time_colombo",
  "water_level",
  "rain_fall",
  "alertpull",
  "minorpull",
  "majorpull",
  "creation_ms",
  "edit_ms",
];

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node scripts/snapshot.mjs <outDir>");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ArcGIS rate-limits bursts (>=1 req/s returns "Too many requests."), so
// space requests out and retry with backoff.
async function query(layer, params) {
  const url = new URL(`${SERVICES}/${layer}/FeatureServer/0/query`);
  url.searchParams.set("f", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url);
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text.slice(0, 200) } };
    }
    if (r.ok && !data.error) return data;
    if (attempt >= 5) throw new Error(`${layer} query failed: ${r.status} ${JSON.stringify(data.error)}`);
    await sleep(2000 * attempt);
  }
}

async function fetchAllReadings() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await query("gauges_2_view", {
      where: "1=1",
      outFields: "objectid,basin,gauge,water_level,rain_fall,CreationDate,EditDate,alertpull,minorpull,majorpull",
      orderByFields: "objectid ASC",
      resultOffset: offset,
      resultRecordCount: PAGE,
      returnGeometry: "false",
    });
    rows.push(...data.features.map((f) => f.attributes));
    if (!data.exceededTransferLimit && data.features.length < PAGE) break;
    await sleep(1500);
  }
  return rows;
}

async function fetchStations() {
  const data = await query("hydrostations", {
    where: "1=1",
    outFields: "*",
    returnGeometry: "false",
    resultRecordCount: 2000,
  });
  // basin has trailing whitespace in the source; trim every string field.
  return data.features.map((f) =>
    Object.fromEntries(
      Object.entries(f.attributes).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]),
    ),
  );
}

const iso = (ms) => (ms == null ? "" : new Date(ms).toISOString());
// Colombo wall-clock time, formatted without a Z so it isn't mistaken for UTC.
const colombo = (ms) => new Date(ms + COLOMBO_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
const colomboDay = (ms) => new Date(ms + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);

function toRecord(a) {
  return {
    objectid: a.objectid,
    basin: (a.basin ?? "").trim(),
    gauge: (a.gauge ?? "").trim(),
    time_utc: iso(a.CreationDate),
    time_colombo: colombo(a.CreationDate),
    water_level: a.water_level ?? "",
    rain_fall: a.rain_fall ?? "", // blank = not measured at this gauge, not zero
    alertpull: a.alertpull ?? "",
    minorpull: a.minorpull ?? "",
    majorpull: a.majorpull ?? "",
    creation_ms: a.CreationDate,
    edit_ms: a.EditDate ?? "",
  };
}

const csvCell = (v) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}

const readings = await fetchAllReadings();
const stations = await fetchStations();

const byDay = new Map();
for (const a of readings) {
  if (a.CreationDate == null) continue;
  const day = colomboDay(a.CreationDate);
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(toRecord(a));
}

await mkdir(outDir, { recursive: true });
let added = 0;
for (const [day, recs] of [...byDay].sort()) {
  const dir = path.join(outDir, day.slice(0, 4));
  const file = path.join(dir, `${day}.csv`);
  await mkdir(dir, { recursive: true });

  const merged = new Map();
  if (existsSync(file)) {
    for (const r of parseCsv(await readFile(file, "utf8"))) merged.set(String(r.objectid), r);
  }
  const before = merged.size;
  // Fresh rows win, so later edits to a reading replace the archived copy.
  for (const r of recs) merged.set(String(r.objectid), r);
  added += merged.size - before;

  const rows = [...merged.values()].sort(
    (a, b) => a.basin.localeCompare(b.basin) || a.gauge.localeCompare(b.gauge) || Number(a.creation_ms) - Number(b.creation_ms),
  );
  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c] ?? "")).join(","))].join("\n") + "\n";
  await writeFile(file, csv);
  console.log(`${day}: ${rows.length} rows (${merged.size - before} new)`);
}

await writeFile(path.join(outDir, "stations.json"), JSON.stringify(stations, null, 2) + "\n");
console.log(`fetched ${readings.length} readings across ${byDay.size} days, ${added} new; ${stations.length} stations`);

// ---------------------------------------------------------------------------
// Weather archive for the forecast model (best effort)
// ---------------------------------------------------------------------------

async function mergeKeyedCsv(file, columns, keyOf, newRows) {
  await mkdir(path.dirname(file), { recursive: true });
  const merged = new Map();
  if (existsSync(file)) for (const r of parseCsv(await readFile(file, "utf8"))) merged.set(keyOf(r), r);
  for (const r of newRows) merged.set(keyOf(r), r);
  const rows = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r);
  await writeFile(file, [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c] ?? "")).join(","))].join("\n") + "\n");
}

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
    } catch {}
    await sleep(1500 * attempt);
  }
  throw new Error(`request failed: ${url.slice(0, 80)}`);
}

async function archiveWeather() {
  const catchments = JSON.parse(await readFile(new URL("../lib/model/catchments.json", import.meta.url), "utf8")).basins;
  const hourNow = Math.floor(Date.now() / 3600e3) * 3600e3;
  const rainByDay = new Map();
  const glofasByDay = new Map();
  for (const [basin, cfg] of Object.entries(catchments)) {
    try {
      const pts = cfg.points;
      const j = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${pts.map((p) => p.lat)}&longitude=${pts.map((p) => p.lon)}&hourly=precipitation&past_days=3&forecast_days=1&timezone=UTC`,
      );
      (Array.isArray(j) ? j : [j]).forEach((p, i) => {
        p.hourly.time.forEach((t, k) => {
          const ms = Date.parse(t + "Z"), v = p.hourly.precipitation[k];
          if (v == null || ms > hourNow) return;
          const day = colomboDay(ms);
          if (!rainByDay.has(day)) rainByDay.set(day, []);
          rainByDay.get(day).push({ time_utc: new Date(ms).toISOString(), point: pts[i].name, mm: v });
        });
      });
    } catch (e) {
      console.warn(`rain archive skipped for ${basin}: ${e.message}`);
    }
    if (cfg.glofas) {
      try {
        const j = await getJson(
          `https://flood-api.open-meteo.com/v1/flood?latitude=${cfg.glofas.lat}&longitude=${cfg.glofas.lon}&daily=river_discharge&past_days=3&forecast_days=0`,
        );
        j.daily.time.forEach((d, k) => {
          const v = j.daily.river_discharge[k];
          if (v == null) return;
          if (!glofasByDay.has(d)) glofasByDay.set(d, []);
          glofasByDay.get(d).push({ date: d, basin, river_discharge_m3s: v });
        });
      } catch (e) {
        console.warn(`glofas archive skipped for ${basin}: ${e.message}`);
      }
    }
  }
  for (const [day, rows] of rainByDay)
    await mergeKeyedCsv(path.join(outDir, "rain", day.slice(0, 4), `${day}.csv`), ["time_utc", "point", "mm"], (r) => `${r.time_utc}|${r.point}`, rows);
  for (const [day, rows] of glofasByDay)
    await mergeKeyedCsv(path.join(outDir, "glofas", day.slice(0, 4), `${day}.csv`), ["date", "basin", "river_discharge_m3s"], (r) => `${r.date}|${r.basin}`, rows);
  console.log(`weather archive: ${rainByDay.size} rain days, ${glofasByDay.size} glofas days`);
}

try {
  await archiveWeather();
} catch (e) {
  console.warn(`weather archive failed (gauge archive is unaffected): ${e.message}`);
}
