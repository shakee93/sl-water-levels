#!/usr/bin/env node
// Owner Slack for the "Is this right?" feedback (forecast_feedback in Cloudflare D1).
//   1. Urgent catch-up: any "worse than shown" + "flooding roads or homes" row still marked notified = 2 (the site could not
//      ping Slack itself) is sent now and marked 1.
//   2. Daily digest: from 08:00 Asia/Colombo, once a day (feedback_digest holds the days already sent), covering the day before:
//      (a day with no answers is marked done and says nothing) counts, the gauges with most "worse" answers, agreement by distance from the gauge, and the notes (private),
//      then the "Learned: ..." lines from learned/town-params.json on the data branch (scripts/feedback-learn.mjs; no D1 reads).
// Run by .github/workflows/feedback-digest.yml every 30 minutes. Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (wrangler via npx)
// and SLACK_WEBHOOK_URL (optional; nothing is sent without it).
// Flags: --dry-run     print what would be sent, change nothing, send nothing
//        --rows <file> read the day's rows from a JSON file instead of D1 (offline test; implies --dry-run)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { digestText, feedbackRows, feedbackSql } from "../lib/feedbackLearn.mjs";
import { learnedLines } from "../lib/learnedParams.mjs";

const args = process.argv.slice(2);
const FILE = args.includes("--rows") ? args[args.indexOf("--rows") + 1] : null;
const DRY = args.includes("--dry-run") || !!FILE;
const SLACK = process.env.SLACK_WEBHOOK_URL || "";
const SITE = process.env.SITE_URL || "https://waterlevels.lk";
const COLOMBO = 5.5 * 3_600_000;
const now = Date.now();
const today = new Date(now + COLOMBO).toISOString().slice(0, 10);
const hour = new Date(now + COLOMBO).getUTCHours();
const yesterday = new Date(now + COLOMBO - 864e5).toISOString().slice(0, 10);

function d1(sql) {
  const raw = execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "sl-water-levels", "--remote", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 64 << 20 });
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
}
/** What the learning job (scripts/feedback-learn.mjs) has learned so far: read from the data branch, no D1 reads; "" when unavailable. */
async function learnedText() {
  try {
    const res = await fetch(process.env.LEARNED_URL || "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/learned/town-params.json", { signal: AbortSignal.timeout(10_000) });
    return res.ok ? "\n" + learnedLines(await res.json()).join("\n") : "";
  } catch {
    return "";
  }
}
async function slack(text) {
  if (DRY) return console.log(`[dry-run] Slack:\n${text}\n`), true;
  if (!SLACK) return false;
  try {
    const res = await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) console.warn(`Slack post failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`Slack post failed: ${e instanceof Error ? e.name : "error"}`);
    return false;
  }
}

if (FILE) {
  const rows = feedbackRows(JSON.parse(readFileSync(FILE, "utf8")));
  await slack(digestText({ day: yesterday, rows: rows.filter((r) => r.day === yesterday || !r.day), urgentCount: rows.filter((r) => r.answer === "worse" && r.river_obs === "flooding").length, site: SITE }) + (await learnedText()));
  process.exit(0);
}

try {
  // 1. urgent catch-up
  const urgent = d1("SELECT id, page, station, town, dist_km, note FROM forecast_feedback WHERE notified = 2 ORDER BY id LIMIT 20");
  for (const u of urgent) {
    const name = u.page === "town" ? `${u.town}${u.station ? ` (gauge ${u.station})` : ""}` : u.station;
    const link = `${SITE}${u.page === "town" ? `/flood/${u.town}` : "/"}`;
    const text = `*Feedback: our verdict looks too mild.* Someone at ${name} says it is worse than shown and water is on roads or in homes${u.dist_km != null ? ` (about ${u.dist_km} km from the gauge)` : ""}.${u.note ? ` They wrote: ${u.note}` : ""} ${link}`;
    if ((await slack(text)) && !DRY) d1(`UPDATE forecast_feedback SET notified = 1 WHERE id = ${Number(u.id)}`);
  }
  // 2. daily digest
  if (hour >= 8) {
    const sent = d1(`SELECT day FROM feedback_digest WHERE day = '${today}'`);
    if (!sent.length) {
      const rows = feedbackRows(d1(feedbackSql(0).replace("ORDER BY", `AND f.day = '${yesterday}' ORDER BY`)));
      const urgentCount = rows.filter((r) => r.answer === "worse" && r.river_obs === "flooding").length;
      {
        const ok = rows.length === 0 ? true : await slack(digestText({ day: yesterday, rows, urgentCount, site: SITE }) + (await learnedText()));
        if (ok && !DRY) d1(`INSERT OR IGNORE INTO feedback_digest (day, sent_ms) VALUES ('${today}', ${now})`);
        else if (!ok) console.log("digest not sent (no Slack webhook)");
      }
    }
  }
} catch (e) {
  // the table is created by the first answer; before that there is nothing to report
  if (/no such table/i.test(String(e.message))) console.log("no feedback yet");
  else throw e;
}
