// Apply d1/0009_forecast_rain.sql to the prediction log once. SQLite cannot ADD COLUMN IF NOT EXISTS, so look first.
// Usage (needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, wrangler via npx): node scripts/d1-ensure-forecast-rain.mjs
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wr = (args) => execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--yes", "--json", ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const info = JSON.parse((() => { const raw = wr(["--command", "PRAGMA table_info(forecast_runs)"]); return raw.slice(raw.indexOf("[")); })())[0].results;
if (info.some((c) => c.name === "rain_risk_kind")) {
  console.log("forecast_runs already has the rain columns");
} else {
  wr([`--file=${path.join(here, "../d1/0009_forecast_rain.sql")}`]);
  console.log("added the rain columns to forecast_runs");
}
