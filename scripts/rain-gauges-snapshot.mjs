// Daily rain from rain GAUGES, archived to the `data` branch under rain-gauges/YYYY.jsonl.
//
// Usage: node scripts/rain-gauges-snapshot.mjs <dataDir>      (run from .github/workflows/gsmap-snapshot.yml)
//
// Why: the shadow street-flood rule (lib/gaugeRain.mjs, scripts/street-rain-log.mjs) needs how wet the past week was by
// gauges, and the ArcGIS feed keeps only about 7 days. This keeps the daily numbers for good; the archive is useful on
// its own (rain-gauge history for Colombo that the satellite under-reads).
//
// Two sources, one line per Asia/Colombo day: {"d":"2026-10-22","og":{"43466":51,...},"ag":{"Hanwella":{"mm":12.4,"n":24},...}}
//   og  Met Dept SYNOP via OGIMET (Colombo 43466, Katunayake 43450, Ratmalana 43467): the 03 UTC report's 24 h rain
//       (08:30 to 08:30 Colombo). This is what the backtest used. Politeness: at most one request per station per run,
//       4 s apart, and not more often than every 3 h (rain-gauges/state.json); the first run backfills 45 days, later
//       runs the last 14. A failure only logs a warning.
//   ag  Irrigation Dept ArcGIS gauges_2_view rain_fall, summed per Colombo calendar day for Hanwella, Glencourse, Dunamale
//       and Badalgama (the rain-reporting gauges nearest Colombo; Nagalagam Street's rain column is always 0, so it is not
//       used). n = hourly readings in the day; the feed keeps about 7 days, so every run re-reads them and keeps the more
//       complete count. Today's day is partial until tomorrow's run completes it.
// Best effort: neither source may fail the data branch push, so this exits 0 even when both fail.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { OGIMET_STATIONS, ARCGIS_GAUGES, parseSynopRain, ogimetUrl, arcgisDailySums, colomboDay, addDays, readGaugeArchive } from "../lib/gaugeRain.mjs";

const dataDir = process.argv[2];
if (!dataDir) {
  console.error("usage: node scripts/rain-gauges-snapshot.mjs <dataDir>");
  process.exit(1);
}
const SERVICES = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services";
const OGIMET_MIN_GAP_MS = 3 * 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = colomboDay(Date.now());
const dir = path.join(dataDir, "rain-gauges");
mkdirSync(dir, { recursive: true });
const archive = readGaugeArchive(dataDir);
const statePath = path.join(dir, "state.json");
let state = {};
try {
  if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, "utf8"));
} catch {
  state = {};
}
const rec = (d) => (archive[d] ??= { og: {}, ag: {} });

// ---- Met Dept SYNOP via OGIMET
async function ogimet() {
  if (state.ogimetTriedMs && Date.now() - state.ogimetTriedMs < OGIMET_MIN_GAP_MS) {
    console.log("OGIMET: tried less than 3 h ago, skipped");
    return;
  }
  const have = Object.values(archive).filter((r) => Object.keys(r.og ?? {}).length > 0).length;
  const from = addDays(today, have < 30 ? -45 : -14);
  state.ogimetTriedMs = Date.now();
  let got = 0;
  for (const block of Object.keys(OGIMET_STATIONS)) {
    try {
      await sleep(4000);
      const res = await fetch(ogimetUrl(block, from, today), { signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "sl-water-levels rain archive (github.com/shakee93/sl-water-levels)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parseSynopRain(await res.text());
      for (const r of rows) {
        rec(r.date).og[r.station] = r.mm;
        got++;
      }
      console.log(`OGIMET ${block} ${OGIMET_STATIONS[block]}: ${rows.length} daily values since ${from}`);
    } catch (e) {
      console.warn(`OGIMET ${block}: ${e instanceof Error ? e.message : "error"} (kept what the archive has)`);
    }
  }
  if (got === 0) console.warn("OGIMET: no values at all this run");
}

// ---- Irrigation Dept ArcGIS rain_fall
async function arcgisRows() {
  // Only the last 2 days: older days are already in the archive and do not change. Until 26 Oct 2026 this pulled all ~7 days
  // (up to 5 pages) every half hour from the Irrigation Department's ArcGIS, whose per-minute quota is shared by everyone.
  const since = new Date(Date.now() - 50 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
  const where = `gauge IN (${ARCGIS_GAUGES.map((g) => `'${g.replace(/'/g, "''")}'`).join(",")}) AND CreationDate >= TIMESTAMP '${since}'`;
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    let data;
    for (let attempt = 1; ; attempt++) {
      const url = new URL(`${SERVICES}/gauges_2_view/FeatureServer/0/query`);
      for (const [k, v] of Object.entries({ f: "json", where, outFields: "gauge,rain_fall,CreationDate", returnGeometry: "false", orderByFields: "CreationDate DESC, objectid DESC", resultOffset: offset, resultRecordCount: 1000 })) url.searchParams.set(k, String(v));
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const j = await res.json().catch(() => ({ error: { message: "not JSON" } }));
      if (res.ok && !j.error) {
        data = j;
        break;
      }
      // over quota (429): stop, the next run in 30 min tries again; anything else: up to 3 retries
      if (attempt >= 4 || j?.error?.code === 429) throw new Error(`ArcGIS: ${res.status} ${JSON.stringify(j.error)}`);
      await sleep(2000 * attempt);
    }
    rows.push(...data.features.map((f) => ({ gauge: String(f.attributes.gauge ?? "").trim(), ts: f.attributes.CreationDate, rain: f.attributes.rain_fall })));
    if (!data.exceededTransferLimit) break;
    await sleep(1500);
  }
  return rows;
}
async function arcgis() {
  try {
    const sums = arcgisDailySums(await arcgisRows());
    let days = 0;
    for (const [day, gauges] of Object.entries(sums)) {
      const r = rec(day);
      for (const [g, v] of Object.entries(gauges)) if (!r.ag[g] || v.n >= r.ag[g].n) r.ag[g] = v;
      days++;
    }
    console.log(`ArcGIS rain_fall: ${days} days for ${ARCGIS_GAUGES.join(", ")}`);
  } catch (e) {
    console.warn(`ArcGIS rain_fall: ${e instanceof Error ? e.message : "error"} (kept what the archive has)`);
  }
}

await ogimet();
await arcgis();

// ---- write, one file per year, sorted, only days that have something
const byYear = {};
for (const d of Object.keys(archive).sort()) {
  const r = archive[d];
  if (!Object.keys(r.og ?? {}).length && !Object.keys(r.ag ?? {}).length) continue;
  const line = { d };
  if (Object.keys(r.og).length) line.og = Object.fromEntries(Object.entries(r.og).sort());
  if (Object.keys(r.ag).length) line.ag = Object.fromEntries(Object.entries(r.ag).sort());
  (byYear[d.slice(0, 4)] ??= []).push(JSON.stringify(line));
}
for (const [y, lines] of Object.entries(byYear)) writeFileSync(path.join(dir, `${y}.jsonl`), lines.join("\n") + "\n");
writeFileSync(statePath, JSON.stringify(state) + "\n");
console.log(`rain-gauges: ${Object.values(byYear).reduce((a, l) => a + l.length, 0)} days archived`);
