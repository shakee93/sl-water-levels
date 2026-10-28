#!/usr/bin/env node
// Daily archive of the stored forecasts and what the river did next -> forecasts/YYYY/YYYY-MM-DD.jsonl on the `data` branch.
//
// usage: node scripts/forecast-archive.mjs <archiveDir> [--day YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD]
//   default: the two Colombo days before today (yesterday is provisional, its 24 h points are not observed yet; the next night rewrites it).
// Needs CLOUDFLARE_API_TOKEN (read only use). One line per forecast run: the run, its points with the later observed value `y`, its
// threshold chances, any shadow (candidate) points (lib/shadowForecast.ts) and the 24 h maximum after issue. See lib/forecastScoreboard.mjs.
// Reads are small: runs by issued_at, children by run-id range in slices of 300, observations per gauge by primary-key range.
// Observations stay in D1 for 7 days, so a day can be archived for about a week after it happens.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { selectRows } from "../lib/d1Sql.mjs";
import { HOUR, addDays, buildArchiveLines, colomboDay, dayEnd, dayStart, daysBetween } from "../lib/forecastScoreboard.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
if (!out || out.startsWith("--")) {
  console.error("usage: node scripts/forecast-archive.mjs <archiveDir> [--day D | --from D --to D]");
  process.exit(1);
}
const today = colomboDay(Date.now());
const days = opt("--day") ? [opt("--day")] : opt("--from") ? daysBetween(opt("--from"), opt("--to") ?? opt("--from")) : [addDays(today, -2), addDays(today, -1)];

async function archiveDay(day) {
  const a = dayStart(day), b = dayEnd(day);
  const runs = await selectRows(
    "SELECT id, station, basin, issued_at, method, status, model_version, unit, current_level, tier, verdict, storm FROM forecast_runs WHERE issued_at >= ? AND issued_at < ?",
    [a, b],
  ).catch(async () =>
    // a database from before d1/0009 has no `storm` column
    (await selectRows("SELECT id, station, basin, issued_at, method, status, model_version, unit, current_level, tier, verdict, NULL AS storm FROM forecast_runs WHERE issued_at >= ? AND issued_at < ?", [a, b])),
  );
  if (!runs.length) { console.log(`${day}: no runs, nothing archived`); return; }
  const ids = new Set(runs.map((r) => r.id));
  const lo = Math.min(...ids), hi = Math.max(...ids);
  const points = [], crossings = [];
  for (let s = lo; s <= hi; s += 300) {
    const e = Math.min(hi, s + 299);
    for (const p of await selectRows("SELECT run_id, horizon_h, target_ts, level, low, high FROM forecast_points WHERE run_id BETWEEN ? AND ?", [s, e])) if (ids.has(p.run_id)) points.push(p);
    for (const c of await selectRows("SELECT run_id, threshold, level, probability FROM forecast_crossings WHERE run_id BETWEEN ? AND ?", [s, e])) if (ids.has(c.run_id)) crossings.push(c);
  }
  const shadows = await selectRows("SELECT station, issued_at, variant, horizon_h, target_ts, level, low, high FROM forecast_shadow_points WHERE issued_at >= ? AND issued_at < ?", [a, b]).catch(() => []); // table appears with the first stored shadow run
  const obs = {};
  for (const st of new Set(runs.map((r) => r.station))) {
    obs[st] = await selectRows("SELECT ts, level FROM observations WHERE station = ? AND ts BETWEEN ? AND ?", [st, a - HOUR, b + 25 * HOUR]);
    obs[st].sort((x, y) => x.ts - y.ts);
  }
  const lines = buildArchiveLines({ runs, points, crossings, shadows, obs });
  const file = path.join(out, "forecasts", day.slice(0, 4), `${day}.jsonl`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  console.log(`${day}: ${lines.length} runs, ${points.length} points, ${shadows.length} shadow points -> ${file}`);
}

for (const d of days) await archiveDay(d);
