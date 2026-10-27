// Reposts for the X account: looks at recent posts from the listed official accounts, asks the Decisions API (gpt-6-luna)
// whether each is worth passing on, and reposts the confident yeses. See DOCS.md "X reposts".
//
//   node --experimental-strip-types --no-warnings scripts/x-reposts.mjs
//
// X_REPOST_MODE: dry (default; Slack "DRY RUN REPOST" with the decision and reason, nothing reposted) | live (also needs
// X_POSTING=live and the four keys) | off. X_POSTING=off is the kill switch. Env: X_REPOST_ACCOUNTS (default dmc_lk,SLMetDept),
// X_REPOST_DAILY_MAX (3), X_REPOST_READ_CAP (40 posts read a day), X_REPOST_MAX_AGE_MIN (360), X_MONTHLY_BUDGET_USD, X_COST_POST,
// X_COST_READ, SLACK_WEBHOOK_URL / SLACK_X_WEBHOOK_URL, CLOUDFLARE_API_TOKEN, OPENAI_API_KEY.
import { pathToFileURL } from "node:url";
import { d1Query, isD1ReadBlip } from "../lib/d1.ts";
import { gate } from "../lib/xClient.ts";
import { getMe, searchRecent, repostTweet } from "../lib/xRead.ts";
import { colomboDay } from "../lib/xCompose.ts";
import { decide } from "../lib/openai.ts";
import { SHARED_SCHEMA } from "../lib/xReply.ts";
import { REPLIES_SCHEMA } from "../lib/xReply.ts";
import { REPOSTS_SCHEMA, parseAccounts, repostQuery, judge, mayRepost } from "../lib/xRepost.ts";

const log = (...a) => console.log(...a);
const quote = (t) => String(t).split("\n").map((l) => `> ${l}`).join("\n");

export function repostConfig(env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const m = (env.X_REPOST_MODE ?? "").trim().toLowerCase();
  const g = gate(env);
  let mode = m === "live" ? "live" : m === "off" ? "off" : "dry";
  let reason = `X_REPOST_MODE=${m || "(unset, dry)"}`;
  if (g.mode === "off") { mode = "off"; reason = "X_POSTING=off (kill switch)"; }
  else if (mode === "live" && g.mode !== "live") { mode = "dry"; reason = `X_REPOST_MODE=live but ${g.reason}`; }
  return {
    mode, reason, accounts: parseAccounts(env.X_REPOST_ACCOUNTS), dailyMax: num(env.X_REPOST_DAILY_MAX, 3), readCap: num(env.X_REPOST_READ_CAP, 40),
    maxAgeMs: num(env.X_REPOST_MAX_AGE_MIN, 360) * 60_000, budget: num(env.X_MONTHLY_BUDGET_USD, 10), costPost: num(env.X_COST_POST, 0.015), costRead: num(env.X_COST_READ, 0.005),
  };
}

async function slack(text, { env, doFetch }) {
  const hook = env.SLACK_X_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
  if (!hook) { log(`[no Slack webhook] ${text}`); return false; }
  try {
    return (await doFetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) })).ok;
  } catch { return false; }
}

const loadValue = async (key, query) => { const r = (await query("SELECT value FROM x_state WHERE key = ?", [key]))[0]; try { return r ? JSON.parse(String(r.value)) : null; } catch { return null; } };
const saveValue = (key, v, now, query) => query("INSERT INTO x_state (key, value, updated_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms", [key, JSON.stringify(v), now]);

export function repostMessage({ c, j, outcome, why }) {
  const head = { dry: "*DRY RUN REPOST: not reposted*", posted: ":repeat: *X repost sent*", declined: ":thinking_face: *X repost considered, declined*", failed: ":x: *X repost FAILED*", skipped: ":no_entry_sign: *X repost skipped*" }[outcome];
  return [`${head} @${c.username} <https://x.com/${c.username}/status/${c.id}|open on X>`, quote(c.text.replace(/https?:\/\/\S+/g, "").trim().slice(0, 400)), `_Decision: ${j ? (j.repost ? "REPOST" : "no") : "none"}. ${why ?? j?.reason ?? ""}_`].join("\n");
}

export async function run(o = {}) {
  const env = o.env ?? process.env;
  const doFetch = o.doFetch ?? fetch;
  const query = o.query ?? d1Query;
  const now = o.now ?? Date.now();
  const cfg = repostConfig(env);
  log(`reposts: ${cfg.mode} (${cfg.reason}); accounts ${cfg.accounts.join(", ")}`);
  if (cfg.mode === "off") return { mode: "off", reposted: 0 };
  const keys = { apiKey: env.X_API_KEY ?? "", apiSecret: env.X_API_SECRET ?? "", accessToken: env.X_ACCESS_TOKEN ?? "", accessSecret: env.X_ACCESS_SECRET ?? "" };
  if (!Object.values(keys).every((v) => v.trim())) { log("the four X keys are not all set: nothing can be read"); return { mode: cfg.mode, reposted: 0, skipped: "no keys" }; }
  for (const s of [...SHARED_SCHEMA, ...REPLIES_SCHEMA, ...REPOSTS_SCHEMA]) await query(s);
  const day = colomboDay(now).day;
  const note = (t) => slack(t, { env, doFetch });
  const meta = (await loadValue("meta", query)) ?? {};
  if (cfg.mode === "live" && meta.pauseUntil && now < meta.pauseUntil) { log("paused"); return { mode: cfg.mode, paused: true, reposted: 0 }; }

  const reads = (await loadValue("reposts_reads", query)) ?? {};
  const todayReads = reads.day === day ? reads.n : 0;
  if (cfg.readCap - todayReads < 10) { log(`read cap reached (${todayReads}/${cfg.readCap})`); return { mode: cfg.mode, reposted: 0, skipped: "read cap" }; }
  const month = day.slice(0, 7);
  const sum = async (sql, p) => Number((await query(sql, p))[0]?.c ?? 0);
  let spent = (await sum("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM x_posts WHERE day LIKE ? AND mode = ? AND status IN ('posted','dry')", [`${month}%`, cfg.mode]))
    + (await sum("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM x_replies WHERE day LIKE ? AND mode = ?", [`${month}%`, cfg.mode]).catch(() => 0))
    + (await sum("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM x_reposts WHERE day LIKE ? AND mode = ?", [`${month}%`, cfg.mode]));
  if (spent >= cfg.budget) { log("monthly budget used up"); return { mode: cfg.mode, reposted: 0, skipped: "budget" }; }

  let me = await loadValue("replies_me", query);
  if (!me?.id) {
    const r = await getMe(keys, { doFetch, now });
    if (!r.ok) { log(`could not read our own account: ${r.detail}`); return { mode: cfg.mode, reposted: 0, error: r.detail }; }
    me = { id: r.data.id, username: r.data.username };
    await saveValue("replies_me", me, now, query);
  }

  const since = await loadValue("reposts_since", query);
  const sr = await searchRecent(keys, repostQuery(cfg.accounts), { sinceId: since?.id ?? null, startTime: now - cfg.maxAgeMs, max: 10, doFetch, now });
  if (!sr.ok) {
    log(`search failed: ${sr.detail}`);
    const st = (await loadValue("reposts_note", query)) ?? {};
    if (st.day !== day && [401, 402, 403, 429].includes(sr.status)) { await note(`:warning: X reposts: search failed (${sr.detail}).`); await saveValue("reposts_note", { day }, now, query); }
    return { mode: cfg.mode, reposted: 0, error: sr.detail };
  }
  await saveValue("reposts_reads", { day, n: todayReads + sr.reads }, now, query);
  const posts = sr.data.posts.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  log(`candidates: ${posts.length}`);
  const dec = o.decide === undefined ? (env.OPENAI_API_KEY ? decide : null) : o.decide;
  const recent = [];
  for (const r of await query("SELECT text FROM x_posts WHERE status IN ('posted','dry') AND mode = ? ORDER BY id DESC LIMIT 6", [cfg.mode])) recent.push(String(r.text));
  for (const r of await query("SELECT text FROM x_reposts WHERE status IN ('posted','dry') ORDER BY ts DESC LIMIT 4")) recent.push(String(r.text));
  let shared = await sum("SELECT COUNT(*) AS c FROM x_reposts WHERE day = ? AND mode = ? AND status IN ('posted','dry')", [day, cfg.mode]);
  const out = { mode: cfg.mode, reposted: 0, declined: 0, read: sr.reads };

  for (const p of posts) {
    const c = { id: p.id, text: p.text, username: p.username, createdAt: p.createdAt, isReply: p.isReply, isRepost: p.isRepost };
    const seen = (await query("SELECT tweet_id FROM x_reposts WHERE tweet_id = ?", [c.id])).length > 0;
    const row = (status, j, extra = {}) => query("INSERT OR IGNORE INTO x_reposts (tweet_id, ts, day, author, text, mode, status, decision, reason, error, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [c.id, now, day, c.username, c.text.slice(0, 500), cfg.mode, status, j ? JSON.stringify(j.probs) : null, j?.reason ?? extra.why ?? null, extra.error ?? null, cfg.costRead + (extra.cost ?? 0)]);
    const g = mayRepost(c, { now, accounts: cfg.accounts, maxAgeMs: cfg.maxAgeMs, alreadySeen: seen, sharedToday: shared, dailyMax: cfg.dailyMax, spentUsd: spent, budgetUsd: cfg.budget });
    if (!g.ok) {
      if (!seen) { await row("skipped", null, { why: g.why }); await note(repostMessage({ c, j: null, outcome: "skipped", why: g.why })); }
      continue;
    }
    const j = await judge(c, { now, recent, decide: dec });
    if (!j.repost) { await row("declined", j); await note(repostMessage({ c, j, outcome: "declined" })); out.declined++; continue; }
    if (cfg.mode !== "live") {
      await row("dry", j, { cost: cfg.costPost });
      await note(repostMessage({ c, j, outcome: "dry" }));
      shared++; spent += cfg.costPost; recent.unshift(c.text); out.reposted++;
      continue;
    }
    const r = await repostTweet(keys, me.id, c.id, { doFetch, now });
    if (!r.ok) {
      await row("failed", j, { error: r.detail });
      await note(repostMessage({ c, j, outcome: "failed", why: r.detail }));
      if (r.status === 429 || r.status === 401) { meta.pauseUntil = r.retryAfterMs ?? now + 3_600_000; meta.pauseWhy = r.detail; await saveValue("meta", meta, now, query); break; }
      continue;
    }
    await row("posted", j, { cost: cfg.costPost });
    await note(repostMessage({ c, j, outcome: "posted" }));
    shared++; spent += cfg.costPost; recent.unshift(c.text); out.reposted++;
  }
  const top = posts.reduce((a, p) => (a == null || BigInt(p.id) > BigInt(a) ? p.id : a), null);
  if (top) await saveValue("reposts_since", { id: top }, now, query);
  log(`reposts: ${JSON.stringify(out)}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    if (isD1ReadBlip(e)) {
      console.warn(`::warning::x-reposts skipped this run: D1 timed out (${e.message}). The next run looks at the same posts.`);
      process.exit(0);
    }
    console.error(`x-reposts failed: ${e instanceof Error ? e.message : e}`); process.exit(1);
  });
}
