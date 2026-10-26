// One "how to use the site" post a day for @waterlevelslk, from content/x-series.json, in order, each once.
// Same switch and memory as the X account (scripts/x-post.mjs): live only when X_POSTING=live and the four X secrets exist;
// every post is a row in D1 x_posts (kind "series", dedupe "series:<id>"), so it counts against the monthly budget
// (X_MONTHLY_BUDGET_USD, default 10; a post with a link costs about X_COST_LINK_POST=0.20) and can never be posted twice.
// Skips the day when the budget is at 80% or a series post already went out today (Colombo date).
//   node --experimental-strip-types scripts/x-series.mjs [--dry]
import { readFileSync } from "node:fs";
import { d1Query } from "../lib/d1.ts";
import { gate, postTweet } from "../lib/xClient.ts";
import { X_SCHEMA } from "./x-post.mjs";

const env = process.env;
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const colomboDay = (ms) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

async function slack(text) {
  if (!env.SLACK_WEBHOOK_URL) return;
  await fetch(env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) }).catch(() => {});
}

async function main() {
  const dry = process.argv.includes("--dry");
  const { posts } = JSON.parse(readFileSync(new URL("../content/x-series.json", import.meta.url), "utf8"));
  const g = gate(env);
  const mode = dry || g.mode !== "live" ? "dry" : "live";
  const now = Date.now();
  const day = colomboDay(now);
  for (const s of X_SCHEMA) await d1Query(s);

  const done = new Set((await d1Query("SELECT dedupe_key FROM x_posts WHERE kind = 'series' AND mode = ? AND status IN ('posted','dry','claimed')", [mode])).map((r) => String(r.dedupe_key)));
  // SERIES_ID (manual run) posts that one now, out of order and even if one went out today; still never twice
  const pick = (env.SERIES_ID ?? "").trim();
  if (!pick) {
    const today = await d1Query("SELECT 1 FROM x_posts WHERE kind = 'series' AND mode = ? AND day = ? AND status IN ('posted','dry')", [mode, day]);
    if (today.length) return console.log("series: already posted today");
  }
  const next = pick ? posts.find((p) => p.id === pick && !done.has(`series:${p.id}`)) : posts.find((p) => !done.has(`series:${p.id}`));
  if (pick && !next) return console.log(`series: "${pick}" is unknown or already posted`);
  if (!next) return console.log("series: all posts are out");

  const cost = num(env.X_COST_LINK_POST, 0.2);
  const budget = num(env.X_MONTHLY_BUDGET_USD, 10);
  const spent = Number((await d1Query("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM x_posts WHERE day LIKE ? AND mode = ? AND status IN ('posted','dry')", [`${day.slice(0, 7)}%`, mode]))[0]?.c ?? 0);
  if (spent + cost > budget * 0.8) {
    await slack(`:moneybag: X series: skipped "${next.id}", this month's estimated spend $${spent.toFixed(2)} is near the $${budget} budget.`);
    return console.log("series: budget");
  }

  const text = `${next.text} ${next.url}`;
  const key = `series:${next.id}`;
  // claim first (UNIQUE dedupe_key): a second run at the same moment finds the row and stops
  await d1Query("INSERT OR IGNORE INTO x_posts (ts, day, kind, dedupe_key, mode, status, text, cost_usd) VALUES (?, ?, 'series', ?, ?, 'claimed', ?, ?)", [now, day, key, mode, text, cost]);
  const mine = await d1Query("SELECT status FROM x_posts WHERE dedupe_key = ? AND ts = ?", [key, now]);
  if (!mine.length) return console.log("series: another run claimed it");

  if (mode === "dry") {
    await d1Query("UPDATE x_posts SET status = 'dry' WHERE dedupe_key = ?", [key]);
    await slack(`:test_tube: X series DRY RUN (${g.reason}):\n${text}`);
    return console.log(`series: dry ${next.id}`);
  }
  const res = await postTweet(g.keys, text);
  if (res.ok) {
    await d1Query("UPDATE x_posts SET status = 'posted', tweet_id = ? WHERE dedupe_key = ?", [res.id, key]);
    await slack(`:mega: X series posted "${next.id}": https://x.com/i/status/${res.id}`);
    console.log(`series: posted ${next.id} ${res.id}`);
  } else {
    // a duplicate means X already has it: never retry; anything else frees the claim for tomorrow's run
    if (res.duplicate) await d1Query("UPDATE x_posts SET status = 'posted', error = ? WHERE dedupe_key = ?", [res.detail, key]);
    else await d1Query("DELETE FROM x_posts WHERE dedupe_key = ? AND status = 'claimed'", [key]);
    await slack(`:warning: X series "${next.id}" not posted: ${res.detail}`);
    throw new Error(res.detail);
  }
}

main().catch((e) => {
  console.error("x-series failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
