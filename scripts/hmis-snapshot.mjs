// Archives HMIS (hmis.gov.lk) readings to the `data` branch as compact JSON (no D1): the 24 h water-level series of every device
// and the ground rain gauges that reported. One request per endpoint per run (every 30 minutes), UA with the site URL and owner email.
//   <outDir>/hmis/levels/YYYY/YYYY-MM-DD.json  { "<device>": { name, institute, pts: [[epochMs UTC, metres], ...] } }  (Colombo day of the reading)
//   <outDir>/hmis/rain/YYYY/YYYY-MM-DD.json    { "<device>": { name, institute, lat, lon, pts: [[latest_record_ms UTC, mm in the last 24 h], ...] } }
// Points are merged and de-duplicated, so a missed run is healed by the next one (HMIS serves the last 24 h every time).
// Usage: node --experimental-strip-types scripts/hmis-snapshot.mjs <outDir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normaliseLevelRows, normaliseRain } from "../lib/hmisCalc.ts";

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
    if (now - d.latestTs > 3 * 3_600_000 || d.mm24h <= 0) continue;
    const day = dayOf(d.latestTs);
    if (!by.has(day)) by.set(day, new Map());
    by.get(day).set(d.device, { meta: { name: d.name, institute: d.institute, lat: d.lat, lon: d.lon }, pts: [[d.latestTs, d.mm24h]] });
  }
  await merge("rain", by);
  console.log(`rain: ${[...by.values()].reduce((n, m) => n + m.size, 0)} gauges with rain`);
} catch (e) {
  failed++;
  console.warn(`rain failed: ${e instanceof Error ? e.message : e}`);
}
// Non-fatal like the other snapshots: the next run heals a gap (HMIS returns the last 24 h each time).
process.exit(0);
