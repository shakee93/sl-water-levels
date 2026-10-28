// Archives RiverNet (rivernet.lk) river levels to the `data` branch as compact JSON (no D1): every river device in the catalogue
// (lib/rivernetCalc.ts, including the gauges the site does not show yet, for later tributary travel-time fits), at 5-minute spacing.
//   <outDir>/rivernet/YYYY/YYYY-MM-DD.json  { "<unit>": { name, region, key, pts: [[epochMs UTC, metres], ...] } }  (Colombo day of the reading)
//   <outDir>/rivernet/devices.json          { updatedAt, devices: [{ unit, key, type, region, location }] }  (once per Colombo night: spots new devices, e.g. rain)
// Each run re-reads the last 24 h (RiverNet serves that every time), merges and de-duplicates points, so a missed run is healed by the next.
// A device that is not communicating is skipped (RiverNet pads its chart flat; lib/rivernetCalc.ts buildDevice). Politeness: one title + one
// chart request per device, 1.3 s apart (about 90 s a run), every 2 hours, User-Agent with the site URL and the owner's address.
// Usage: node --experimental-strip-types scripts/rivernet-snapshot.mjs <outDir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDevice, downsample, RIVERNET_CATALOG } from "../lib/rivernetCalc.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node --experimental-strip-types scripts/rivernet-snapshot.mjs <outDir>");
  process.exit(1);
}
const UA = "waterlevels.lk (https://waterlevels.lk; shakee.zats@gmail.com)";
const LK = 5.5 * 3_600_000;
const MIN = 60_000;
const dayOf = (ms) => new Date(ms + LK).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();
const hourEnd = Math.floor(now / 3_600_000) * 3_600_000;
const W = `${hourEnd - 86_400_000}/${hourEnd}`;

async function get(p) {
  const res = await fetch(`https://api.rivernet.lk/cache-api.php?path=${encodeURIComponent(p)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${p.split("?")[0]} HTTP ${res.status}`);
  return res.json();
}

const byDay = new Map(); // day -> Map<unit, { meta, pts }>
let failed = 0;
for (const e of RIVERNET_CATALOG) {
  try {
    const q = `keys=${e.key}&last24HoursData=1&isPublic=1`;
    const title = await get(`api/reports/river-level/title/minute/${W}?${q}`);
    await sleep(1300);
    const chart = await get(`api/reports/river-level/chart/minute/${W}?${q}`);
    await sleep(1300);
    const d = buildDevice(e.key, title, chart, now);
    if (!d) throw new Error("unexpected shape");
    for (const p of downsample(d.series, 5 * MIN)) {
      const day = dayOf(p.ts);
      if (!byDay.has(day)) byDay.set(day, new Map());
      const m = byDay.get(day);
      if (!m.has(e.unit)) m.set(e.unit, { meta: { name: e.name, region: e.region, key: e.key }, pts: [] });
      m.get(e.unit).pts.push([Math.round(p.ts), p.m]);
    }
  } catch (err) {
    failed++;
    console.error(`RiverNet ${e.unit} ${e.name}: ${err.message}`);
    await sleep(1300);
  }
}

for (const [day, devs] of byDay) {
  const file = path.join(outDir, "rivernet", day.slice(0, 4), `${day}.json`);
  let cur = {};
  try { cur = JSON.parse(await readFile(file, "utf8")); } catch { /* new day */ }
  for (const [unit, { meta, pts }] of devs) {
    const e = cur[unit] ?? { ...meta, pts: [] };
    const seen = new Set(e.pts.map((p) => p[0]));
    for (const p of pts) if (!seen.has(p[0])) e.pts.push(p);
    e.pts.sort((a, b) => a[0] - b[0]);
    cur[unit] = e;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cur) + "\n");
}

// Once per Colombo night: the device lists of every region the dashboard names, so a new device (rain gauges, new bridges) shows up in the archive.
if (new Date(now + LK).getUTCHours() < 2) {
  try {
    const out = [];
    for (const region of ["ratnapura", "kelaniya", "gampaha", "batticaloa", "nilwala", "galoya", "deduru_oya", "badulu_oya"]) {
      try {
        const j = await get(`api/overview/region-devices?region=${region}`);
        for (const group of Object.values(j.results ?? {})) {
          if (!group || Array.isArray(group)) continue;
          for (const list of Object.values(group)) for (const d of list) out.push({ unit: d.unitId, key: d.deviceKey, type: d.type, region: d.region ?? region, location: d.location });
        }
      } catch (err) { console.error(`RiverNet device list ${region}: ${err.message}`); }
      await sleep(1300);
    }
    if (out.length) {
      await mkdir(path.join(outDir, "rivernet"), { recursive: true });
      await writeFile(path.join(outDir, "rivernet", "devices.json"), JSON.stringify({ updatedAt: new Date(now).toISOString(), devices: out }) + "\n");
    }
  } catch (err) { console.error(`RiverNet device lists: ${err.message}`); }
}

if (failed > RIVERNET_CATALOG.length / 2) {
  console.error(`RiverNet: ${failed} of ${RIVERNET_CATALOG.length} devices failed`);
  process.exit(1);
}
console.log(`RiverNet snapshot: ${RIVERNET_CATALOG.length - failed} devices, ${failed} failed`);
