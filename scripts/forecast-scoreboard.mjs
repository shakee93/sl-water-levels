#!/usr/bin/env node
// Nightly forecast scoreboard from the archive: scoreboard/YYYY-MM-DD.json + scoreboard/summary.csv on the `data` branch.
//
// usage: node scripts/forecast-scoreboard.mjs <archiveDir> [--day D | --from D --to D] [--now ISO]
//   default: the two Colombo days before today. Reads forecasts/YYYY/YYYY-MM-DD.jsonl (scripts/forecast-archive.mjs), needs no D1.
//   Days are scored oldest first so each day's verdict compares with the (already written) days before it.
// MEASURES ONLY. Method, groups, headline and verdict rule: lib/forecastScoreboard.mjs.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, colomboDay, daysBetween, scoreDay, shadowLine, upsertSummary } from "../lib/forecastScoreboard.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
if (!out || out.startsWith("--")) {
  console.error("usage: node scripts/forecast-scoreboard.mjs <archiveDir> [--day D | --from D --to D] [--now ISO]");
  process.exit(1);
}
const now = opt("--now") ? Date.parse(opt("--now")) : Date.now();
const today = colomboDay(now);
const days = opt("--day") ? [opt("--day")] : opt("--from") ? daysBetween(opt("--from"), opt("--to") ?? opt("--from")) : [addDays(today, -2), addDays(today, -1)];

const dir = path.join(out, "scoreboard");
mkdirSync(dir, { recursive: true });
const readDay = (d) => {
  const f = path.join(out, "forecasts", d.slice(0, 4), `${d}.jsonl`);
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : null;
};
const priorBoards = () =>
  readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));

const summaryFile = path.join(dir, "summary.csv");
let summary = existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : "";
for (const day of days) {
  const lines = readDay(day);
  if (!lines) { console.log(`${day}: no archive file, skipped`); continue; }
  const sb = scoreDay(day, lines, { now, prior: priorBoards() });
  writeFileSync(path.join(dir, `${day}.json`), JSON.stringify(sb, null, 1) + "\n");
  summary = upsertSummary(summary, sb);
  writeFileSync(summaryFile, summary);
  console.log(sb.verdict.line + (sb.complete ? "" : " (provisional: 24 h cells not final)"));
  for (const l of shadowLine(sb)) console.log(`  shadow ${l}`);
}
