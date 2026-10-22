// Builds <archiveDir>/history.json for the /history flood-calendar page.
//
// Usage: node scripts/build-history.mjs <archiveDir>
//   (archiveDir = a checkout of the `data` branch, written by snapshot.mjs)
//
// Two sources, kept separate because they mean different things:
//
// 1. gauge: real daily-maximum gauge levels, in the feed's own raw units, so
//    the page can classify them with the same thresholds and lib/status.ts
//    logic as the live site. From 2025-11-23 onward:
//      - our archive CSVs (<archiveDir>/YYYY/*.csv), and
//      - nuuuwan/lk_irrigation (MIT), an hourly scraper of the same ArcGIS
//        feed that started 2025-11-23, before ours. Its values match ours
//        exactly at identical timestamps, except it converts ft gauges to
//        metres; we derive that factor per station from the overlap and undo
//        it.
//
// 2. model: daily river discharge (m³/s) at each station's coordinates from
//    the GloFAS v4 reanalysis via Open-Meteo's free flood API, 2022 onward.
//    No public gauge archive goes back that far. Discharge has no official
//    flood marks, so per-station thresholds are percentiles of the 1995-2021
//    baseline, chosen so the national rate matches real gauges over
//    2025-11..2026-10: 3.9% of station-days at alert or worse, 1.6% at minor
//    or worse, 0.55% at major. GloFAS is a ~5 km grid, so small rivers can be
//    off; the page labels these rows as modelled.
//
// No npm dependencies (Node 22 fetch), so the workflow needs no install.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const archiveDir = process.argv[2];
if (!archiveDir) {
  console.error("usage: node scripts/build-history.mjs <archiveDir>");
  process.exit(1);
}

const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const NUUUWAN_URL = "https://raw.githubusercontent.com/nuuuwan/lk_irrigation/main/data/all.json";
const FLOOD_API = "https://flood-api.open-meteo.com/v1/flood";
const GAUGE_START = "2025-11-23";
const MODEL_START = "2022-01-01";
const BASELINE = ["1995-01-01", "2021-12-31"];
// Quantiles matched to the observed national warning rates (see header).
const MODEL_QUANTILES = { alert: 1 - 0.039, minor: 1 - 0.016, major: 1 - 0.0055 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colomboDay = (ms) => new Date(ms + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
const todayColombo = colomboDay(Date.now());

function dayRange(start, end) {
  const out = [];
  for (let t = Date.parse(start + "T00:00:00Z"); t <= Date.parse(end + "T00:00:00Z"); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

async function getJson(url, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      // Open-Meteo's free tier has a per-minute budget weighted by date range.
      if (r.status === 429 && attempt < 4) {
        await sleep(65000);
        continue;
      }
      if (attempt >= 4) throw new Error(`${label}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      if (attempt >= 4) throw e;
    }
    await sleep(3000 * attempt);
  }
}

function parseCsv(text) {
  const [head, ...lines] = text.trim().split("\n");
  const cols = head.split(",");
  // Our archive never quotes the columns we read (numbers + plain names), but
  // handle quoted fields anyway so a comma in a future name doesn't shift cells.
  return lines.map((line) => {
    const cells = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") cells.push(cur), (cur = "");
      else cur += c;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

const num = (v) => (v === "" || v == null ? null : Number(v));

// ---- stations + latest thresholds from our archive ----

const stationsRaw = JSON.parse(await readFile(path.join(archiveDir, "stations.json"), "utf8"));
const seen = new Set();
const stations = stationsRaw
  .filter((s) => s.station && !seen.has(s.station) && seen.add(s.station))
  .map((s) => ({ station: s.station, basin: s.basin, lat: s.latitude, lon: s.longitude }));

const ours = []; // { station, ms, level, alert, minor, major }
for (const year of (await readdir(archiveDir)).filter((d) => /^\d{4}$/.test(d)).sort()) {
  for (const f of (await readdir(path.join(archiveDir, year))).filter((f) => f.endsWith(".csv")).sort()) {
    for (const r of parseCsv(await readFile(path.join(archiveDir, year, f), "utf8"))) {
      ours.push({
        station: r.gauge,
        ms: Number(r.creation_ms),
        level: num(r.water_level),
        alert: num(r.alertpull),
        minor: num(r.minorpull),
        major: num(r.majorpull),
      });
    }
  }
}
ours.sort((a, b) => a.ms - b.ms);
const thresholds = {};
for (const r of ours) thresholds[r.station] = { alert: r.alert, minor: r.minor, major: r.major };

// ---- gauge daily maxima ----

const daily = new Map(); // station -> Map(day -> max raw level)
const bump = (station, ms, level) => {
  if (level == null || !Number.isFinite(level)) return;
  if (!daily.has(station)) daily.set(station, new Map());
  const m = daily.get(station);
  const d = colomboDay(ms);
  if (!(m.get(d) >= level)) m.set(d, level);
};
for (const r of ours) bump(r.station, r.ms, r.level);

let nuuRows = [];
try {
  nuuRows = await getJson(NUUUWAN_URL, "nuuuwan all.json");
} catch (e) {
  // Not fatal: our own archive still covers everything since 2026-10-15.
  console.warn(`nuuuwan data unavailable, using our archive only: ${e.message}`);
}

// Per-station conversion factor nuuuwan applied (1 or 0.3048), from rows that
// share an exact timestamp with ours.
const ourBySecond = new Map(ours.map((r) => [`${r.station}|${Math.floor(r.ms / 1000)}`, r.level]));
const ratios = new Map();
for (const r of nuuRows) {
  const o = ourBySecond.get(`${r.station_name}|${r.time_ut}`);
  if (o == null || !o || r.water_level_m == null) continue;
  if (!ratios.has(r.station_name)) ratios.set(r.station_name, []);
  ratios.get(r.station_name).push(r.water_level_m / o);
}
const factor = (station) => {
  const rs = ratios.get(station);
  if (!rs?.length) return 1;
  const median = rs.sort((a, b) => a - b)[Math.floor(rs.length / 2)];
  return Math.abs(median - 0.3048) < 0.02 ? 0.3048 : 1;
};
const factors = Object.fromEntries([...new Set(nuuRows.map((r) => r.station_name))].map((s) => [s, factor(s)]));
for (const r of nuuRows) {
  if (r.water_level_m == null) continue;
  bump(r.station_name, r.time_ut * 1000, r.water_level_m / factors[r.station_name]);
}
console.log(
  `gauge: ${ours.length} archive rows + ${nuuRows.length} nuuuwan rows; ft-converted there: ${Object.entries(factors)
    .filter(([, f]) => f !== 1)
    .map(([s]) => s)
    .join(", ") || "none"}`,
);

const gaugeDays = dayRange(GAUGE_START, todayColombo);
const round = (v, dp) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

// ---- modelled discharge ----

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
}

const modelDays = dayRange(MODEL_START, todayColombo);
const model = {};
// The 1995-2021 baseline never changes, so reuse thresholds from the last
// build and only fetch 2022 onward. Cuts the daily run's API cost ~6x.
let previous = {};
try {
  previous = JSON.parse(await readFile(path.join(archiveDir, "history.json"), "utf8")).model?.stations ?? {};
} catch {}
for (const s of stations) {
  if (s.lat == null || s.lon == null) continue;
  const cached = previous[s.station]?.thresholds;
  const from = cached ? MODEL_START : BASELINE[0];
  const url = `${FLOOD_API}?latitude=${s.lat}&longitude=${s.lon}&daily=river_discharge&start_date=${from}&end_date=${todayColombo}`;
  try {
    const d = await getJson(url, `flood ${s.station}`);
    const byDay = new Map(d.daily.time.map((t, i) => [t, d.daily.river_discharge[i]]));
    let q = cached;
    if (!q) {
      const base = d.daily.time
        .filter((t) => t >= BASELINE[0] && t <= BASELINE[1])
        .map((t) => byDay.get(t))
        .filter((v) => v != null)
        .sort((a, b) => a - b);
      if (base.length < 3650 || base[base.length - 1] <= 0) continue; // dry/invalid cell
      q = Object.fromEntries(Object.entries(MODEL_QUANTILES).map(([k, p]) => [k, round(quantile(base, p), 2)]));
    }
    model[s.station] = {
      thresholds: q,
      values: modelDays.map((t) => round(byDay.get(t) ?? null, 1)),
    };
  } catch (e) {
    console.warn(`model ${s.station}: ${e.message}`);
  }
  await sleep(400); // stay well under Open-Meteo's free-tier burst limits
}
console.log(`model: ${Object.keys(model).length}/${stations.length} stations`);

const out = {
  generatedAt: new Date().toISOString(),
  sources: {
    gauge: "Dept of Irrigation ArcGIS feed: this repo's data branch + github.com/nuuuwan/lk_irrigation (MIT)",
    model: "GloFAS v4 river discharge via open-meteo.com flood API (CC BY 4.0)",
  },
  stations: stations.map((s) => ({ ...s, thresholds: thresholds[s.station] ?? null })),
  gauge: {
    start: GAUGE_START,
    days: gaugeDays.length,
    levels: Object.fromEntries(
      [...daily].map(([station, m]) => [station, gaugeDays.map((d) => round(m.get(d) ?? null, 2))]),
    ),
  },
  model: { start: MODEL_START, days: modelDays.length, quantiles: MODEL_QUANTILES, stations: model },
};
await writeFile(path.join(archiveDir, "history.json"), JSON.stringify(out));
console.log(`wrote history.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
