// Archives HMIS (hmis.gov.lk) readings to the `data` branch as compact JSON (no D1): the 24 h water-level series of every device
// and the ground rain gauges that reported. One request per endpoint per run (every 30 minutes), UA with the site URL and owner email.
//   <outDir>/hmis/levels/YYYY/YYYY-MM-DD.json  { "<device>": { name, institute, pts: [[epochMs UTC, metres], ...] } }  (Colombo day of the reading)
//   <outDir>/hmis/rain/YYYY/YYYY-MM-DD.json    { "<device>": { name, institute, lat, lon, pts: [[latest_record_ms UTC, mm in the last 24 h], ...] } }
//     only gauges with rain, plus (since 27 Oct 2026) the zero readings of gauges within 30 km of a street-rain zone town
//   <outDir>/hmis/rain-live.json   { updatedAt, devices: { "<device>": { n: name, i: institute, lat, lon, pts: [[epoch minutes UTC, mm in the last 24 h], ...] } } }
//     EVERY live gauge (record under 3 h old), zeros included, last 4.5 h only: the input of scripts/rain-correct.mjs, which needs the gauge's
//     24 h sum at the time the satellite window ends (1-2 h ago) and needs the dry gauges too (the satellite's false rain). Rewritten each run.
// Points are merged and de-duplicated, so a missed run is healed by the next one (HMIS serves the last 24 h every time).
// Usage: node --experimental-strip-types scripts/hmis-snapshot.mjs <outDir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normaliseLevelRows, normaliseRain, haversineKm } from "../lib/hmisCalc.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node --experimental-strip-types scripts/hmis-snapshot.mjs <outDir>");
  process.exit(1);
}
const UA = "sl-water-levels (+https://waterlevels.lk; shakee.zats@gmail.com)";
const LK = 5.5 * 3_600_000;
const dayOf = (ms) => new Date(ms + LK).toISOString().slice(0, 10);

async function get(p) {
  const res = await fetch(`https://hmis.gov.lk/api/v1/${p}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${p} HTTP ${res.status}`);
  return (await res.json()).data;
}

async function merge(kind, entries) {
  // entries: Map<day, Map<device, { meta, pts: [ts, v][] }>>
  for (const [day, devs] of entries) {
    const file = path.join(outDir, "hmis", kind, day.slice(0, 4), `${day}.json`);
    let cur = {};
    try { cur = JSON.parse(await readFile(file, "utf8")); } catch { /* new day */ }
    for (const [dev, { meta, pts }] of devs) {
      const e = cur[dev] ?? { ...meta, pts: [] };
      const seen = new Set(e.pts.map((p) => p[0]));
      for (const p of pts) if (!seen.has(p[0])) e.pts.push(p);
      e.pts.sort((a, b) => a[0] - b[0]);
      cur[dev] = e;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(cur) + "\n");
  }
}

const now = Date.now();
// Rain-zone towns (lib/places.ts rainZone): a gauge within 30 km of one keeps its ZERO readings in the daily archive too, so the backtest of the
// ground-gauge street rule (scripts/ground-rain-backtest.mts) can tell a dry gauge from a missing one. Everywhere else zeros are skipped (size).
const ZONE_CENTRES = [[6.93, 79.89], [7.07, 79.89], [7.21, 79.84], [7.35, 79.85], [7.58, 79.80]];
const nearZone = (d) => ZONE_CENTRES.some(([lat, lon]) => haversineKm({ lat, lon }, d) <= 30);

/** Rolling state for the gauge-corrected satellite rain (see the header). */
async function writeLiveRain(rain) {
  const file = path.join(outDir, "hmis", "rain-live.json");
  let cur = { devices: {} };
  try { cur = JSON.parse(await readFile(file, "utf8")); } catch { /* first run */ }
  const keepFrom = Math.floor((now - 4.5 * 3_600_000) / 60_000);
  const devices = {};
  for (const [id, e] of Object.entries(cur.devices ?? {})) {
    const pts = (e.pts ?? []).filter((p) => p[0] >= keepFrom);
    if (pts.length) devices[id] = { ...e, pts };
  }
  for (const d of rain) {
    if (now - d.latestTs > 3 * 3_600_000 || d.latestTs > now + 10 * 60_000) continue;
    const e = devices[d.device] ?? { n: d.name, i: d.institute, lat: d.lat, lon: d.lon, pts: [] };
    const tm = Math.round(d.latestTs / 60_000);
    if (!e.pts.some((p) => p[0] === tm)) e.pts.push([tm, d.mm24h]);
    e.pts.sort((a, b) => a[0] - b[0]);
    devices[d.device] = e;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ updatedAt: new Date(now).toISOString(), devices }) + "\n");
}

let failed = 0;
try {
  const devices = normaliseLevelRows(await get("getwaterlevelsummary/1_day/live"));
  const by = new Map();
  for (const d of devices) {
    for (const p of d.series) {
      const day = dayOf(p.ts);
      if (!by.has(day)) by.set(day, new Map());
      const m = by.get(day);
      if (!m.has(d.device)) m.set(d.device, { meta: { name: d.name, institute: d.institute }, pts: [] });
      m.get(d.device).pts.push([p.ts, p.m]);
    }
  }
  await merge("levels", by);
  console.log(`levels: ${devices.length} devices`);
} catch (e) {
  failed++;
  console.warn(`levels failed: ${e instanceof Error ? e.message : e}`);
}
try {
  const rain = normaliseRain(await get("getrainfalldevices"));
  const by = new Map();
  for (const d of rain) {
    if (now - d.latestTs > 3 * 3_600_000 || (d.mm24h <= 0 && !nearZone(d))) continue;
    const day = dayOf(d.latestTs);
    if (!by.has(day)) by.set(day, new Map());
    by.get(day).set(d.device, { meta: { name: d.name, institute: d.institute, lat: d.lat, lon: d.lon }, pts: [[d.latestTs, d.mm24h]] });
  }
  await merge("rain", by);
  await writeLiveRain(rain);
  console.log(`rain: ${[...by.values()].reduce((n, m) => n + m.size, 0)} gauges with rain`);
} catch (e) {
  failed++;
  console.warn(`rain failed: ${e instanceof Error ? e.message : e}`);
}
// Non-fatal like the other snapshots: the next run heals a gap (HMIS returns the last 24 h each time).
process.exit(0);
