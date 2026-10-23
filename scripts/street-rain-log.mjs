// Live validation of the street-rain rule: logs what the rule says after every GSMaP snapshot,
// records each change of state, and tells the owner on Slack when it rises or clears.
// The rule (validated 2018-2026, research/wellampitiya-flood-rule-backtest.md): 24 h satellite rain with each hour
// clipped at 15 mm (zones.<id>.mm24hClipped in latest.json) >= 100 mm = likely, >= 60 mm = possible (a quiet heads-up),
// and the Kelani at its minor flood level (Nagalagam Street >= 5 ft, Hanwella at its own published minor mark, read from
// the site's /api/levels) = likely.
//
// Usage (CI, after scripts/gsmap-snapshot.mjs): node --experimental-strip-types scripts/street-rain-log.mjs <dataDir>
//   reads <dataDir>/gsmap/latest.json (the file the website reads); writes to Cloudflare D1 "sl-water-levels" with
//   wrangler (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) and posts to SLACK_WEBHOOK_URL (optional).
//   Flags: --dry-run  print the SQL and the Slack text, touch nothing (also skips the D1 read: pass --prev none|possible|likely)
//          --river 1|0  use this river-trigger value instead of asking SITE_URL/api/levels (tests, dry runs)
//
// What it writes (d1/0003_street_flood.sql, applied at the top of every run, all idempotent):
//   street_rain_log      one row per zone per run (1/3/6/24 h rain, the clipped 24 h total, the river-trigger flag, the
//                        rule's state; columns added later are migrated with PRAGMA table_info), keyed by the satellite hour it
//                        describes, so re-running on an unchanged latest.json inserts nothing
//   street_rain_changes  one row per change of state (none -> possible -> likely -> none ...)
// Slack: once per rise (none -> possible / likely, possible -> likely) and once when it clears, with the numbers,
// a link to the town page and "Did your street flood?". A rise within 3 h of the last rise message is held back
// (24 h totals wobble around a threshold); likely -> possible is logged but silent. Rises are labelled "possible (heads-up)"
// or "likely". (Push alerts to residents are separate: scripts/push-notify.mjs sends "likely" only.) A message that fails to send is
// retried by the next run for up to 6 h (street_rain_changes.notified: 0 pending, 1 sent, 2 skipped).
// The rule only reads data the website would also show: latest.json older than 3 h is not logged.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streetState, stateChange, isReportable, noticeFor, riverTrigger, STREET_POSSIBLE_MM_24H, STREET_LIKELY_MM_24H, STREET_HOURLY_CAP_MM } from "../lib/streetRainLog.ts";
import { PLACES } from "../lib/places.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const prevFlag = args.includes("--prev") ? args[args.indexOf("--prev") + 1] : null;
const riverFlag = args.includes("--river") ? args[args.indexOf("--river") + 1] : null;
const dataDir = args.find((a) => !a.startsWith("--") && a !== prevFlag && a !== riverFlag);
if (!dataDir) {
  console.error("usage: node --experimental-strip-types scripts/street-rain-log.mjs <dataDir> [--dry-run [--prev none|possible|likely]]");
  process.exit(1);
}
const SITE = process.env.SITE_URL || "https://sl-water-levels.vercel.app";
const SLACK = process.env.SLACK_WEBHOOK_URL || "";
const MAX_DATA_AGE_MS = 3 * 3_600_000;
const NOW = Date.now();
const q = (v) => (v == null || (typeof v === "number" && !Number.isFinite(v)) ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const latest = JSON.parse(readFileSync(path.join(dataDir, "gsmap/latest.json"), "utf8"));
const dataEnd = Date.parse(latest.latestEnd);
if (!Number.isFinite(dataEnd)) throw new Error("gsmap/latest.json has no latestEnd");
if (NOW - dataEnd > MAX_DATA_AGE_MS) {
  console.log(`latest.json is ${Math.round((NOW - dataEnd) / 60_000)} min old (limit 180): not logged, the site treats it as unavailable too`);
  process.exit(0);
}

// zone -> the town slugs the rule covers (lib/places.ts rainZone), the town the Slack link points at first
const townsOf = (zone) => PLACES.filter((p) => p.rainZone === zone).map((p) => p.slug);
const LEAD_TOWN = "wellampitiya";

// ---- wrangler ---------------------------------------------------------------------------------
function wrangler(wargs) {
  return execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", ...wargs], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
}
const rowsOf = (sql) => {
  const out = wrangler(["--json", "--command", sql]);
  return JSON.parse(out)[0]?.results ?? [];
};

if (!DRY) {
  wrangler(["--yes", "--file", path.join(here, "../d1/0003_street_flood.sql")]);
  // idempotent column migration: SQLite has no ADD COLUMN IF NOT EXISTS, so look first
  for (const [table, cols] of [["street_rain_log", [["mm24h_clipped", "REAL"], ["river_trigger", "INTEGER"]]], ["street_rain_changes", [["mm24h_clipped", "REAL"], ["river_trigger", "INTEGER"]]]]) {
    const have = new Set(rowsOf(`PRAGMA table_info(${table})`).map((r) => r.name));
    for (const [c, type] of cols) if (!have.has(c)) wrangler(["--yes", "--command", `ALTER TABLE ${table} ADD COLUMN ${c} ${type}`]);
  }
}

// ---- river half of the rule: the Kelani at its minor flood level, from the site's public gauge list
// true / false, or null when the gauges cannot be read (then only the rain decides, and the log says "unknown").
async function readRiver() {
  if (riverFlag === "1" || riverFlag === "0") return { on: riverFlag === "1", station: null, levelFt: null };
  try {
    const res = await fetch(`${SITE}/api/levels`, { signal: AbortSignal.timeout(20_000), headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const pick = (name) => {
      const s = (j.stations ?? []).find((x) => x.station === name);
      return { station: name, levelFt: typeof s?.level === "number" ? s.level : null, minorFt: typeof s?.marks?.minor === "number" ? s.marks.minor : null, ageMin: typeof s?.ageMinutes === "number" ? s.ageMinutes : null };
    };
    const t = riverTrigger([pick("Nagalagam Street"), pick("Hanwella")]);
    return { on: t.triggered, station: t.station, levelFt: t.levelFt };
  } catch (e) {
    console.warn(`river gauges unreadable (${e instanceof Error ? e.message : "error"}): river trigger unknown`);
    return null;
  }
}
const river = await readRiver();
const riverOn = river ? river.on : false;

const sql = [];
const notices = []; // {zone, changedMs, from, to, mm1h, mm6h, mm24h, kind}
for (const [zone, z] of Object.entries(latest.zones ?? {})) {
  // the rule's number is the clipped 24 h sum; a file from before the clip has none (rule off for the rain part)
  const clipped = typeof z.mm24hClipped === "number" ? z.mm24hClipped : null;
  let state = streetState(clipped, riverOn);
  const riverCol = river ? (river.on ? 1 : 0) : null;
  // what D1 already knows about this zone
  let newestLogged = 0, lastKnown = null, lastRiseNoticeMs = null, pending = [];
  if (DRY) {
    lastKnown = prevFlag && prevFlag !== "null" ? prevFlag : null;
  } else {
    const z1 = q(zone);
    newestLogged = Number(rowsOf(`SELECT COALESCE(MAX(data_end_ms), 0) AS t FROM street_rain_log WHERE zone = ${z1}`)[0]?.t ?? 0);
    lastKnown = rowsOf(`SELECT state FROM street_rain_log WHERE zone = ${z1} AND state IS NOT NULL ORDER BY data_end_ms DESC LIMIT 1`)[0]?.state ?? null;
    lastRiseNoticeMs = rowsOf(`SELECT MAX(notified_ms) AS t FROM street_rain_changes WHERE zone = ${z1} AND notified = 1 AND to_state <> 'none'`)[0]?.t ?? null;
    pending = rowsOf(`SELECT changed_ms, from_state, to_state, mm1h, mm6h, mm24h, mm24h_clipped, river_trigger FROM street_rain_changes WHERE zone = ${z1} AND notified = 0 ORDER BY changed_ms`).map((r) => ({
      zone, changedMs: Number(r.changed_ms), from: r.from_state, to: r.to_state, mm1h: r.mm1h, mm6h: r.mm6h, mm24h: r.mm24h, clipped: r.mm24h_clipped, river: Number(r.river_trigger) === 1, riverStation: null, riverFt: null,
    }));
  }
  // gauges unreadable this run: do not let "river unknown" read as "river fell" and clear a likely that the river caused
  if (!river && lastKnown === "likely" && state !== "likely") state = null;
  const fresh = dataEnd > newestLogged;
  if (fresh) {
    sql.push(`INSERT OR IGNORE INTO street_rain_log (zone, data_end_ms, run_ms, rate_mm_h, mm1h, mm3h, mm6h, mm24h, mm24h_clipped, river_trigger, state) VALUES (${[zone, dataEnd, NOW, z.rateMmPerHour, z.mm1h, z.mm3h, z.mm6h, z.mm24h, clipped, riverCol, state].map(q).join(", ")});`);
    const c = stateChange(lastKnown, state);
    if (c && isReportable(c)) {
      sql.push(`INSERT OR IGNORE INTO street_rain_changes (zone, changed_ms, from_state, to_state, mm1h, mm6h, mm24h, mm24h_clipped, river_trigger, towns, notified) VALUES (${[zone, dataEnd, c.from, c.to, z.mm1h, z.mm6h, z.mm24h, clipped, riverCol, townsOf(zone).join(",")].map(q).join(", ")}, 0);`);
      pending.push({ zone, changedMs: dataEnd, from: c.from, to: c.to, mm1h: z.mm1h, mm6h: z.mm6h, mm24h: z.mm24h, clipped, river: riverCol === 1, riverStation: river?.station ?? null, riverFt: river?.levelFt ?? null });
    }
  }
  for (const p of pending) {
    const kind = noticeFor({ from: p.from, to: p.to }, lastRiseNoticeMs, p.changedMs, NOW);
    if (kind === "rise") lastRiseNoticeMs = NOW; // a second pending rise in this run is a flap
    notices.push({ ...p, kind });
  }
  console.log(`${zone}: ${clipped ?? "?"} mm/24h counted (${z.mm24h ?? "?"} raw), river ${river ? (river.on ? "AT MINOR" : "below minor") : "unknown"} -> ${state ?? "no state"}${fresh ? "" : " (already logged)"}; last known ${lastKnown ?? "none"}`);
}

if (sql.length) {
  const body = sql.join("\n") + "\n";
  if (DRY) console.log("--- SQL ---\n" + body);
  else {
    const dir = mkdtempSync(path.join(tmpdir(), "street-log-"));
    try {
      const f = path.join(dir, "log.sql");
      writeFileSync(f, body);
      wrangler(["--yes", "--file", f]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---- Slack ------------------------------------------------------------------------------------
const mm = (v) => (v == null ? "?" : String(Math.round(v)));
function text(n) {
  const link = `${SITE}/flood/${LEAD_TOWN}`;
  const counted = n.clipped ?? n.mm24h;
  const nums = `24 h ${mm(counted)} mm counted (each hour capped at ${STREET_HOURLY_CAP_MM} mm${n.mm24h != null && n.clipped != null && n.mm24h - n.clipped >= 1 ? `; ${mm(n.mm24h)} mm uncapped` : ""}), 6 h ${mm(n.mm6h)} mm, 1 h ${mm(n.mm1h)} mm`;
  if (n.kind === "clear")
    return `Street-water rule has cleared for Wellampitiya and nearby (satellite rain: ${nums}; below ${STREET_POSSIBLE_MM_24H} mm, Kelani below minor level). Did your street flood today? ${link}`;
  if (n.to === "likely") {
    const why = n.river ? `the Kelani is at its minor flood level${n.riverStation ? ` (${n.riverStation}${n.riverFt != null ? ` ${n.riverFt.toFixed(1)} ft` : ""})` : ""}${(counted ?? 0) >= STREET_LIKELY_MM_24H ? ` and 24 h rain is at or above ${STREET_LIKELY_MM_24H} mm` : ""}` : `24 h rain at or above ${STREET_LIKELY_MM_24H} mm`;
    return `Street water *likely* in Wellampitiya and nearby (${why}). Satellite rain: ${nums}. Residents with alerts on are being told. Did your street flood? ${link}`;
  }
  return `Street water *possible (heads-up)* in Wellampitiya and nearby (24 h rain at or above ${STREET_POSSIBLE_MM_24H} mm; often wrong, about 8 times a year with no recorded flood; residents are NOT alerted). Satellite rain: ${nums}. Did your street flood? ${link}`;
}
async function slack(msg) {
  if (DRY) return console.log(`[dry-run] Slack: ${msg}`), true;
  if (!SLACK) return false;
  try {
    const res = await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: msg }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) console.warn(`Slack post failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`Slack post failed: ${e instanceof Error ? e.name : "error"}`);
    return false;
  }
}
const updates = [];
for (const n of notices) {
  if (n.kind == null) {
    updates.push(`UPDATE street_rain_changes SET notified = 2, notified_ms = ${NOW} WHERE zone = ${q(n.zone)} AND changed_ms = ${n.changedMs} AND notified = 0;`);
    continue;
  }
  if (await slack(text(n))) updates.push(`UPDATE street_rain_changes SET notified = 1, notified_ms = ${NOW} WHERE zone = ${q(n.zone)} AND changed_ms = ${n.changedMs};`);
}
if (updates.length && !DRY) wrangler(["--yes", "--command", updates.join(" ")]);
else if (updates.length) console.log(updates.join("\n"));
