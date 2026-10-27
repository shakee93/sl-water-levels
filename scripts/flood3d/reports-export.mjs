#!/usr/bin/env node
// OWNER-SIDE ONLY. Exports the flood3d_reports table (precise positions!) from D1 to a local JSON file for scripts/flood3d/prep.py (REPORTS=file).
// The file holds exact coordinates: keep it in the scratchpad, never commit it, never copy it to the public data branch.
// Read-only, one indexed query (id range). Usage: node scripts/flood3d/reports-export.mjs <out.json>   (needs wrangler's login, like feedback-export)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const out = process.argv[2];
if (!out) { console.error("usage: node scripts/flood3d/reports-export.mjs <out.json>"); process.exit(1); }
const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command",
  "SELECT id, created_ms, kind, depth, event, lat, lon, acc_m, src, map_right, cell_ft, nag_ft, han_ft, han_fast_ft, status FROM flood3d_reports ORDER BY id LIMIT 5000"],
  { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "83e812aa5ee674fe01ce3a9eb1e04cbe" } });
const rows = JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
writeFileSync(out, JSON.stringify(rows));
console.log(`${rows.length} reports -> ${out} (private: exact positions)`);
