// Apply d1/0009_forecast_rain.sql to the prediction log once. SQLite cannot ADD COLUMN IF NOT EXISTS, so look first.
// Over the HTTP /query endpoint (lib/d1Sql.mjs): `wrangler d1 execute --file` is D1's import path and locks the database.
// Usage (needs CLOUDFLARE_API_TOKEN): node scripts/d1-ensure-forecast-rain.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitSql, runStatements, selectRows } from "../lib/d1Sql.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const info = await selectRows("PRAGMA table_info(forecast_runs)");
if (info.some((c) => c.name === "rain_risk_kind")) {
  console.log("forecast_runs already has the rain columns");
} else {
  await runStatements(splitSql(readFileSync(path.join(here, "../d1/0009_forecast_rain.sql"), "utf8")), { label: "forecast rain columns" });
  console.log("added the rain columns to forecast_runs");
}
