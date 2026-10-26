#!/usr/bin/env node
// Live forecast accuracy from the prediction log -> accuracy/latest.json on the `data` branch.
//
// usage: node scripts/accuracy-snapshot.mjs <archiveDir>      (needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, wrangler via npx)
//
// Reads forecast_verification (each stored forecast point matched to the gauge reading closest to its target time,
// within 40 minutes) joined to forecast_runs.current_level (the "no change" baseline). Everything is converted to feet.
// Segments: "model-v4" forecasts issued from V4_SINCE on (the storm model reads satellite-measured rain with up-channel timing where it beat v3; v3 and
// the gauge-only model everywhere else), "model-v3" from STORM_SINCE to then (storm-aware: gauge-only model at every horizon + rain correction on
// storm hours), "model" from GM_SINCE to then (gauge-only 1/3/6 h; 12/24 h still the older rain ridge), "model-early" before that,
// and "trend" (simple estimate for gauges without a fitted model).
// "rainSplit": the fitted-model forecasts (model + model-v3) split by whether rain was part of the picture when they were issued
// (forecast_runs.storm, d1/0009_forecast_rain.sql: a heavy-rain warning showing or a storm-horizon step in use) into "storm" and "calm".
// Runs from before that column existed have no flag and are left out of the split.
// Windows: last 30 days and since launch. Scopes: all gauges and each gauge.
// The site reads the file (lib/accuracy.ts); a missing or old file just hides the figures. Run by .github/workflows/accuracy-snapshot.yml.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { feedbackRows, feedbackSql, publicFeedback } from "../lib/feedbackLearn.mjs";

export const GM_SINCE = 1792841552000; // 2026-10-24, commit 717de26 (gauge-only model live)
// Storm-aware version (v3): gauge-only model at all of 1/3/6/12/24 h plus the rain correction on storm hours. Replaced the 8-day rain ridge at 12/24 h.
export const V4_SINCE = 9e15; // set to the deploy time of model-v4 when it ships (a far-future value = no v4 segment yet)
export const STORM_SINCE = 1792991600000; // 2026-10-26, commit 2242440 deployed (Vercel status success 1792991585)
const FT = 0.3048, STEADY_FT = 0.02, DAY = 864e5;
const HORIZONS = [1, 3, 6, 12, 24];
const out = process.argv[2];
if (!out && import.meta.url === `file://${process.argv[1]}`) { console.error("usage: node scripts/accuracy-snapshot.mjs <archiveDir>"); process.exit(1); }

function d1(sql) {
  const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 256 << 20 });
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
}

const now = Date.now();
const rows = [];
const hasStorm = d1("PRAGMA table_info(forecast_runs)").some((c) => c.name === "storm");
// Fetch in 4-day slices so no single D1 query is heavy.
const first = d1("SELECT MIN(issued_at) AS a FROM forecast_runs")[0].a;
for (let a = first; a < now; a += 4 * DAY) {
  rows.push(...d1(`SELECT v.station, v.issued_at, v.method, v.unit, v.horizon_h AS h, v.predicted AS p, v.low, v.high, v.actual AS y, r.current_level AS c${hasStorm ? ", r.storm AS storm" : ", NULL AS storm"}
    FROM forecast_verification v JOIN forecast_runs r ON r.station = v.station AND r.issued_at = v.issued_at
    WHERE v.issued_at >= ${a} AND v.issued_at < ${a + 4 * DAY}`));
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const pct = (v) => (v == null ? null : Math.round(v * 100));

function stats(rs) {
  const miss = rs.map((r) => Math.abs(r.y - r.p));
  const base = rs.map((r) => Math.abs(r.y - r.c));
  const wide = rs.filter((r) => r.low != null && r.high != null);
  const sg = (d) => (Math.abs(d) < STEADY_FT ? 0 : Math.sign(d));
  return {
    n: rs.length,
    gauges: new Set(rs.map((r) => r.station)).size,
    maeFt: r2(mean(miss)),
    baseMaeFt: r2(mean(base)),
    inBandPct: wide.length ? pct(mean(wide.map((r) => (r.y >= r.low && r.y <= r.high ? 1 : 0)))) : null,
    bandFt: wide.length ? r2(mean(wide.map((r) => r.high - r.low))) : null,
    dirPct: pct(mean(rs.map((r) => (sg(r.p - r.c) === sg(r.y - r.c) ? 1 : 0)))),
    dirSteadyPct: pct(mean(rs.map((r) => (sg(0) === sg(r.y - r.c) ? 1 : 0)))),
  };
}

const usable = rows
  .filter((r) => (r.unit === "ft" || r.unit === "m") && [r.p, r.y, r.c].every((v) => v != null && Number.isFinite(v)))
  .map((r) => {
    const k = r.unit === "m" ? 1 / FT : 1;
    return { ...r, p: r.p * k, y: r.y * k, c: r.c * k, low: r.low == null ? null : r.low * k, high: r.high == null ? null : r.high * k,
      seg: r.method === "trend" ? "trend" : r.method === "model" ? (r.issued_at >= V4_SINCE ? "model-v4" : r.issued_at >= STORM_SINCE ? "model-v3" : r.issued_at >= GM_SINCE ? "model" : "model-early") : null };
  })
  .filter((r) => r.seg && HORIZONS.includes(r.h));

// Storm vs calm hours, fitted-model forecasts only (the trend estimate uses no rain).
function splitBuild(rs) {
  const o = {};
  for (const [w, from] of Object.entries(WINDOWS)) {
    for (const [mode, flag] of [["storm", 1], ["calm", 0]]) {
      for (const h of HORIZONS) {
        const sub = rs.filter((r) => r.issued_at >= from && r.storm === flag && r.h === h && (r.seg === "model" || r.seg === "model-v3" || r.seg === "model-v4"));
        if (sub.length) ((o[w] ??= {})[mode] ??= {})[h] = stats(sub);
      }
    }
  }
  return o;
}
const WINDOWS = { d30: now - 30 * DAY, all: 0 };
function build(rs) {
  const o = {};
  for (const [w, from] of Object.entries(WINDOWS)) {
    for (const seg of ["model", "model-early", "model-v3", "model-v4", "trend"]) {
      for (const h of HORIZONS) {
        const sub = rs.filter((r) => r.issued_at >= from && r.seg === seg && r.h === h);
        if (sub.length) ((o[w] ??= {})[seg] ??= {})[h] = stats(sub);
      }
    }
  }
  return o;
}
// "Is this right?" answers (forecast_feedback), aggregates only and only where 3 or more people answered: a gauge with
// fewer is simply missing. Notes, places and distances are private (scripts/feedback-digest.mjs). The table may not exist yet.
let feedback = null;
try {
  feedback = publicFeedback(feedbackRows(d1(feedbackSql(now - 30 * DAY))));
} catch (e) {
  console.log(`feedback: skipped (${String(e.message).split("\n")[0].slice(0, 80)})`);
}
const stations = {};
for (const s of [...new Set(usable.map((r) => r.station))].sort()) stations[s] = build(usable.filter((r) => r.station === s));
const json = {
  version: 1,
  generatedAt: new Date(now).toISOString(),
  asOf: new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10), // Sri Lanka date
  firstForecast: new Date(first + 5.5 * 3600e3).toISOString().slice(0, 10),
  gaugeModelSince: new Date(GM_SINCE + 5.5 * 3600e3).toISOString().slice(0, 10),
  stormModelSince: new Date(STORM_SINCE + 5.5 * 3600e3).toISOString().slice(0, 10),
  ...(V4_SINCE < 9e15 ? { stormModelV4Since: new Date(V4_SINCE + 5.5 * 3600e3).toISOString().slice(0, 10) } : {}),
  overall: build(usable),
  rainSplit: splitBuild(usable),
  stations,
};
if (out) {
  mkdirSync(path.join(out, "accuracy"), { recursive: true });
  writeFileSync(path.join(out, "accuracy/latest.json"), JSON.stringify(json));
}
console.log(`${usable.length} checks (${rows.length} read), ${Object.keys(stations).length} gauges`);
console.log(JSON.stringify(json.overall, null, 0).slice(0, 1500));
