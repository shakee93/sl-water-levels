// Turn /api/forecasts JSON into SQL for the Cloudflare D1 prediction log.
//
// Usage: node scripts/store-forecasts.mjs <forecasts.json> <out.sql>
// Then:  wrangler d1 execute sl-water-levels --remote --file <out.sql>
//
// Idempotent: a run is keyed by (station, issued_at), where issued_at is the
// gauge reading the forecast started from, so hourly re-runs on an unchanged
// reading insert nothing. Observations are keyed by (station, ts).

import { readFile, writeFile } from "node:fs/promises";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/store-forecasts.mjs <forecasts.json> <out.sql>");
  process.exit(1);
}

const data = JSON.parse(await readFile(input, "utf8"));
const q = (v) =>
  v == null || (typeof v === "number" && !Number.isFinite(v))
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

const now = data.generatedAt ?? Date.now();

// Fail loudly (Slack via the workflow) when the feed is stale: newest forecast older than 3 h means
// the site is serving an old copy and nothing new would be logged.
const newestIssued = Math.max(0, ...(data.runs ?? []).map((r) => r.issuedAt ?? 0));
if (newestIssued && Date.now() - newestIssued > 3 * 3600_000) {
  console.error(`stale forecasts: newest issuedAt ${new Date(newestIssued).toISOString()}`);
  process.exit(1);
}
const sql = [];
let points = 0;
let obs = 0;

for (const r of data.runs ?? []) {
  if (r.issuedAt == null) continue;
  sql.push(
    `INSERT OR IGNORE INTO forecast_runs (station, basin, issued_at, stored_at, method, status, model_version, unit, current_level, tier, verdict, headline, rain_past6h_mm, rain_next24h_mm, outlook, rain_next6h_mm, rain_next6h_p90_mm, rain_next24h_p90_mm, rain_risk_kind, rain_risk_level, storm_horizons, storm, measured_mm1h, measured_mm3h, measured_mm24h, sat_mm6h, sat_mm24h) VALUES (${[
      r.station, r.basin, r.issuedAt, now, r.method, r.status, data.modelVersion, r.unit, r.currentLevel,
      r.tier, r.verdict, r.headline, r.rainPast6hMm, r.rainNext24hMm, r.outlook,
      r.rainNext6hMm, r.rainNext6hP90Mm, r.rainNext24hP90Mm, r.rainRiskKind, r.rainRiskLevel,
      Array.isArray(r.stormHorizons) ? r.stormHorizons.join(",") : null, r.storm == null ? null : r.storm ? 1 : 0,
      r.measured?.mm1h, r.measured?.mm3h, r.measured?.mm24h, r.satellite?.mm6h, r.satellite?.mm24h,
    ].map(q).join(", ")});`,
  );
  // Children only attach to a run inserted in this batch (stored_at = now), so an
  // already-stored run never gets duplicate points.
  const runId = `(SELECT id FROM forecast_runs WHERE station = ${q(r.station)} AND issued_at = ${q(r.issuedAt)} AND stored_at = ${q(now)})`;
  for (const h of r.horizons ?? []) {
    sql.push(
      `INSERT OR IGNORE INTO forecast_points (run_id, horizon_h, target_ts, level, low, high) SELECT ${runId}, ${q(h.h)}, ${q(h.ts)}, ${q(h.level)}, ${q(h.low)}, ${q(h.high)} WHERE ${runId} IS NOT NULL;`,
    );
    points++;
  }
  for (const c of r.crossings ?? []) {
    sql.push(
      `INSERT OR IGNORE INTO forecast_crossings (run_id, threshold, level, probability, eta_ts, wording) SELECT ${runId}, ${q(c.threshold)}, ${q(c.level)}, ${q(c.probability)}, ${q(c.etaTs)}, ${q(c.wording)} WHERE ${runId} IS NOT NULL;`,
    );
  }
  for (const o of r.observations ?? []) {
    sql.push(
      `INSERT OR IGNORE INTO observations (station, ts, level, rain) VALUES (${[r.station, o.ts, o.level, o.rain].map(q).join(", ")});`,
    );
    obs++;
  }
}

await writeFile(output, sql.join("\n") + "\n");
console.log(`${data.runs?.length ?? 0} runs, ${points} points, ${obs} observations -> ${output}; errors: ${data.errors?.length ?? 0}`);
