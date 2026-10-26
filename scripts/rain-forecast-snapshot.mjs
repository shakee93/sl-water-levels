// Archive the rain forecast AS IT WAS ISSUED, next to the satellite archive on the `data` branch.
//
// Usage: node scripts/rain-forecast-snapshot.mjs <outDir> [baseUrl]
//
// Why: a backtest of "what did we think would fall" needs the forecast of that moment per catchment: deterministic and p90,
// next 6 and 24 h. Open-Meteo's past-run API is a different model run than the one we showed. The site's /api/rain gives
// exactly the numbers the pages used; this appends one line per new forecast hour (the weather fetch is cached 30 min, so
// the hour boundary `issuedAt` changes at most hourly) to <outDir>/rain-forecast/YYYY/YYYY-MM-DD.jsonl:
//   {"t": "<issuedAt>", "at": "<generatedAt>", "s": {"Basin/Station": {"f": [next6h, next6hP90, next24h, next24hP90, modelPast6h, modelPast24h], "m": [mm1h, mm3h, mm24h] | null}}}
// Array order is fixed (see FORECAST_FIELDS / MEASURED_FIELDS in the first line of each file's meta in DOCS.md "Rain archive").
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const outDir = process.argv[2];
const base = (process.argv[3] ?? "https://waterlevels.lk").replace(/\/$/, "");
if (!outDir) {
  console.error("usage: node scripts/rain-forecast-snapshot.mjs <outDir> [baseUrl]");
  process.exit(1);
}

const res = await fetch(`${base}/api/rain`, { headers: { "User-Agent": "sl-water-levels-archive" }, signal: AbortSignal.timeout(90_000) });
if (!res.ok) {
  console.error(`/api/rain HTTP ${res.status}`);
  process.exit(1);
}
const j = await res.json();
const keys = Object.keys(j.stations ?? {});
if (!keys.length) {
  console.error("/api/rain returned no stations");
  process.exit(1);
}
const issued = keys.map((k) => j.stations[k].forecast?.issuedAt).filter(Boolean).sort();
const t = issued[issued.length - 1] ?? j.generatedAt;

const dir = path.join(outDir, "rain-forecast", t.slice(0, 4));
const file = path.join(dir, `${t.slice(0, 10)}.jsonl`);
if (existsSync(file)) {
  const lines = readFileSync(file, "utf8").trim().split("\n");
  if (lines.some((l) => { try { return JSON.parse(l).t === t; } catch { return false; } })) {
    console.log(`forecast hour ${t} already archived`);
    process.exit(0);
  }
}
const s = {};
for (const k of keys) {
  const { forecast: f, measured: m } = j.stations[k];
  s[k] = { f: f ? [f.next6h, f.next6hP90, f.next24h, f.next24hP90, f.modelPast6h, f.modelPast24h] : null, m: m ? [m.mm1h, m.mm3h, m.mm24h] : null };
}
mkdirSync(dir, { recursive: true });
appendFileSync(file, JSON.stringify({ t, at: j.generatedAt, s }) + "\n");
console.log(`archived forecast hour ${t} for ${keys.length} gauges -> ${file}`);
