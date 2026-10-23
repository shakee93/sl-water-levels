// Archives reservoir-release data to the `data` branch: one JSON line per CHANGED snapshot in
// <outDir>/releases/YYYY/YYYY-MM-DD.jsonl (Colombo day of our fetch).
//
// Why: the Irrigation Department sheet and the Mahaweli PDF are overwritten every day and carry no
// history or publish time, and news items scroll off the feeds. This archive (with OUR fetch time on
// every line) is what later lets the forecast learn how long water takes from a release to a gauge.
//
// Usage: node scripts/releases-snapshot.mjs <outDir> [baseUrl]
//
// The site's own /api/releases does the parsing (sheet + Mahaweli PDF + news detections), so this
// script needs no dependencies. A line is written only when the content changed since the last line
// of the day (hash over everything except fetch times). Sheet rows and WMS rows are all reservoirs
// (from 2026-10-23 evening; earlier lines only hold the spilling / discharging / catalogue ones).
//
// Line shape: { t, hash, sheet: {sheetDate, fetchedAt, rows[]}, wms: {reportDate, lastModified, fetchedAt, rows[]},
//               weekly: {meetingDate, nextWeek, lastModified, fetchedAt, items[{reservoirId, slug, name, spillWindow, spillDays, plannedMcmPerDay, lastWeekMcm, rawLine}]},
//               news: {detections[]}, active: [{reservoirId, kind, cusecs, source, observedAt}] }
// A source that failed is { error }. A day with no change has no new line; a failed fetch writes nothing.

import { mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const outDir = process.argv[2];
const base = (process.argv[3] ?? process.env.SITE_URL ?? "https://sl-water-levels.vercel.app").replace(/\/$/, "");
if (!outDir) {
  console.error("usage: node scripts/releases-snapshot.mjs <outDir> [baseUrl]");
  process.exit(1);
}

const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const now = Date.now();
const day = new Date(now + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);

let data;
try {
  const res = await fetch(`${base}/api/releases`, { headers: { "User-Agent": "sl-water-levels-archive" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  data = await res.json();
} catch (e) {
  // Non-fatal: the next run (15 minutes later) tries again.
  console.warn(`releases fetch failed: ${e instanceof Error ? e.message : e}`);
  process.exit(0);
}

// Content hash without the times that change on every server-side refresh.
const stable = JSON.parse(JSON.stringify(data));
for (const k of ["sheet", "wms", "weekly"]) if (stable[k]) delete stable[k].fetchedAt;
const hash = createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);

const dir = path.join(outDir, "releases", day.slice(0, 4));
const file = path.join(dir, `${day}.jsonl`);
await mkdir(dir, { recursive: true });

let last = null;
if (existsSync(file)) {
  const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
  try {
    last = JSON.parse(lines[lines.length - 1]);
  } catch {
    last = null;
  }
}
if (last?.hash === hash) {
  console.log(`${day}: unchanged (${hash})`);
  process.exit(0);
}

const colombo = new Date(now + COLOMBO_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
await appendFile(file, JSON.stringify({ t: colombo, hash, ...data }) + "\n");
console.log(`${day}: snapshot ${hash} at ${colombo} (${data.active?.length ?? 0} active releases)`);
