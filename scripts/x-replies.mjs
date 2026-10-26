// Automatic replies for the X account: reads new mentions (and, behind X_DM=on, direct messages), works out what each
// person wants, and answers genuine questions with live data. See DOCS.md "X replies".
//
//   node --experimental-strip-types --no-warnings scripts/x-replies.mjs
//
// Modes (X_REPLIES_MODE): dry (default) = drafts go to Slack marked "DRY RUN REPLY", nothing is posted; live = replies are
// sent (also needs X_POSTING=live and the four keys); off = does nothing. X_POSTING=off is the kill switch for this too.
// Env: SITE_URL, SLACK_WEBHOOK_URL, CLOUDFLARE_API_TOKEN (memory), X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET,
//      OPENAI_API_KEY, X_AI_POLISH=off, X_REPLY_DAILY_CAP (30), X_REPLY_READ_CAP (150 posts read a day), X_REPLY_MAX_AGE_MIN (360),
//      X_REPLY_BLOCK (comma list of handles never answered), X_HANDLE, X_DM (off|on), X_MONTHLY_BUDGET_USD (10), X_COST_POST
//      (0.015), X_COST_READ (0.005 per post read), X_CRITICAL_SLACK_MENTION (default <!channel>).
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { d1Query } from "../lib/d1.ts";
import { gate, postTweet } from "../lib/xClient.ts";
import { getMe, getMentions, getDms, sendDm } from "../lib/xRead.ts";
import { colomboDay, tweetLength, MAX_TWEET } from "../lib/xCompose.ts";
import { OPENAI_MODEL } from "../lib/openai.ts";
import { PLACES, RIVERS } from "../lib/places.ts";
import {
  REPLIES_SCHEMA, SHARED_SCHEMA, REPLY_INTENTS, DEFAULT_LIMITS, FIXED_VARIANTS, classify, cleanText, looksLikeBot, directedAtUs, makeResolver, resolveTarget,
  buildAnswer, fixedReply, validateFixed, writeReply, mayReply, seedOf, scriptOf, mentionsIn,
} from "../lib/xReply.ts";

const SITE_DEFAULT = "https://waterlevels.lk";
const log = (...a) => console.log(...a);
const STATIONS = JSON.parse(readFileSync(new URL("./fuzzy-stations.json", import.meta.url), "utf8"));

// ---- live data -----------------------------------------------------------------------------------------------------

async function getJson(url, doFetch, ms = 45_000) {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(ms), headers: { "Cache-Control": "no-cache" } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Levels (with next-hour forecasts) and reservoirs, each null when it could not be read. */
export async function loadData({ site = SITE_DEFAULT, doFetch = fetch } = {}) {
  const [lv, rs] = await Promise.all([getJson(`${site}/api/levels`, doFetch), getJson(`${site}/api/reservoirs`, doFetch)]);
  const levels = lv?.stations ?? null;
  const reservoirs = rs?.reservoirs ?? null;
  return { levels, reservoirs, resolver: makeResolver(STATIONS, PLACES, RIVERS, (reservoirs ?? []).map((r) => ({ id: r.id, name: r.name }))) };
}

// ---- the model -----------------------------------------------------------------------------------------------------

/** Same conventions as scripts/x-post.mjs makeLlm (gpt-6-luna, JSON-schema output, store false, per-run call cap). null without a key. */
export function makeLlm(env, doFetch = fetch) {
  const key = env.OPENAI_API_KEY;
  if (!key || (env.X_AI_POLISH ?? "").trim().toLowerCase() === "off") return null;
  const cap = Number(env.AI_MAX_CALLS_PER_HOUR) > 0 ? Number(env.AI_MAX_CALLS_PER_HOUR) : 60;
  let calls = 0;
  return async (instructions, input) => {
    if (calls >= cap) return null;
    calls++;
    const res = await doFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL, instructions, input, reasoning: { effort: "low" }, max_output_tokens: 800, store: false,
        text: { format: { type: "json_schema", name: "reply", strict: true, schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[ai] reply writer call failed: HTTP ${res.status}`);
      return null;
    }
    const j = await res.json();
    let out = "";
    for (const item of j.output ?? []) if (item.type === "message") for (const c of item.content ?? []) if (c.type === "output_text" && c.text) out += c.text;
    try { return JSON.parse(out).text ?? null; } catch { return null; }
  };
}

// ---- deciding what to say (no memory, no sending) -----------------------------------------------------------------

/**
 * What we would say to one message, and why. Pure given the data and the model: used by the run and by the local dry run.
 * @param item { text, source: "mention" | "dm", id }
 * @returns { intent, why, target, answer, reply: { text, ai, why, fixed } | null, place }
 */
export async function planReply(item, ctx) {
  const handle = ctx.handle ?? "waterlevelslk";
  const text = cleanText(item.text);
  const target = ctx.data.resolver ? resolveTarget(text, ctx.data.resolver) : null;
  const { intent, why } = classify(item.text, { handle, hasTarget: !!target });
  const place = target && target.kind !== "reservoir" && target.kind === "place" ? target.label : null;
  const seed = seedOf(String(item.id)) + (item.variant ?? 0);
  const fixed = (kind) => {
    const t = fixedReply(kind, { place, variant: seed });
    return { text: t, ai: false, why: null, fixed: kind };
  };
  const out = { intent, why, target, answer: null, reply: null, place };
  if (intent === "emergency") out.reply = fixed("emergency");
  else if (intent === "report") out.reply = fixed("report");
  else if (intent === "correction") out.reply = fixed("correction");
  else if (intent === "question") {
    if (!target) out.reply = fixed("notfound");
    else {
      const answer = buildAnswer(target, ctx.data.levels, ctx.data.reservoirs, ctx.now);
      out.answer = answer;
      if (!answer) out.reply = fixed("unavailable");
      else {
        const note = /\b(safe|safety|travel|trip|drive|driving|journey|go to|going to|tonight|tomorrow|will it|will .* flood)\b/i.test(text)
          ? "The person asks about safety, travel or the future. Do not say whether it is safe to go or whether it will flood; say plainly that a gauge reading cannot tell that, and give the reading and the forecast if there is one."
          : undefined;
        const w = await writeReply(answer, { userMessage: text, recent: ctx.recent ?? [], llm: ctx.llm ?? null, offReason: ctx.offReason, note });
        out.reply = w.text ? { text: w.text, ai: w.used === "llm", why: w.why ?? null, fixed: null } : null;
        if (!w.text) out.error = w.why;
      }
    }
  } else if (item.source === "dm" && (intent === "offtopic" || intent === "thanks")) {
    // a person who wrote to us in private and said nothing we can answer gets one welcome / pointer
    if (intent === "offtopic") out.reply = fixed("welcome");
  }
  return out;
}

// ---- Slack ---------------------------------------------------------------------------------------------------------

async function slack(text, { env, doFetch }) {
  const hook = env.SLACK_X_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
  if (!hook) {
    log(`[no Slack webhook] ${text}`);
    return false;
  }
  try {
    const res = await doFetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) });
    return res.ok;
  } catch {
    return false;
  }
}
const quote = (t) => String(t).split("\n").map((l) => `> ${l}`).join("\n");

/**
 * The one Slack line-block every notification gets: who, what they wrote, link, how we classified it and what we did.
 * @param o.outcome  "dry" (draft only) | "posted" | "ignored" | "skipped" | "failed"
 */
export function feedMessage({ item, plan, user, outcome, why, reply, reason }) {
  const kindWord = item.source === "dm" ? "direct message" : "mention / reply";
  const head = {
    dry: "*DRY RUN REPLY: not sent to X*",
    posted: ":white_check_mark: *X notification, replied*",
    failed: ":x: *X notification, reply FAILED*",
    skipped: ":no_entry_sign: *X notification, not answered*",
    ignored: ":speech_balloon: *X notification, no reply needed*",
  }[outcome] ?? "*X notification*";
  const link = item.source === "dm" ? "direct message" : `<https://x.com/i/status/${item.id}|open on X>`;
  return [
    `${head} (${kindWord}) from @${user?.username ?? "?"} [${plan.intent}${plan.target ? `, ${plan.target.kind}: ${plan.target.label}` : ""}] ${link}`,
    quote(cleanText(item.text) || "(no text)"),
    reply ? `_${outcome === "dry" ? "Draft reply" : "Reply"} (${tweetLength(reply.text)}/${MAX_TWEET}, ${reply.fixed ? `fixed wording: ${reply.fixed}` : reply.ai ? `written by ${OPENAI_MODEL}, every number checked` : `plain template${reply.why ? ` (${reply.why})` : ""}`}):_\n${quote(reply.text)}` : `_No reply: ${why ?? plan.error ?? plan.why}._`,
    reason && outcome === "dry" ? `_${reason}_` : null,
  ].filter(Boolean).join("\n");
}

// ---- memory --------------------------------------------------------------------------------------------------------

async function loadValue(key, query) {
  const r = (await query("SELECT value FROM x_state WHERE key = ?", [key]))[0];
  try { return r ? JSON.parse(String(r.value)) : null; } catch { return null; }
}
const saveValue = (key, v, now, query) => query("INSERT INTO x_state (key, value, updated_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms", [key, JSON.stringify(v), now]);

/** Settings from the environment (pure, for tests). */
export function configOf(env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const m = (env.X_REPLIES_MODE ?? "").trim().toLowerCase();
  return {
    want: m === "live" ? "live" : m === "off" ? "off" : "dry",
    limits: { ...DEFAULT_LIMITS, dailyCap: num(env.X_REPLY_DAILY_CAP, 30), maxAgeMs: num(env.X_REPLY_MAX_AGE_MIN, 360) * 60_000, budgetUsd: num(env.X_MONTHLY_BUDGET_USD, 10) },
    readCap: num(env.X_REPLY_READ_CAP, 150),
    costPost: num(env.X_COST_POST, 0.015),
    costRead: num(env.X_COST_READ, 0.005),
    dm: (env.X_DM ?? "").trim().toLowerCase() === "on",
    handle: (env.X_HANDLE || "waterlevelslk").replace(/^@/, ""),
    block: new Set((env.X_REPLY_BLOCK ?? "").split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean)),
  };
}

/** off | dry | live, and why. live needs X_REPLIES_MODE=live AND the posting gate live. */
export function replyMode(env) {
  const cfg = configOf(env);
  const g = gate(env);
  if (g.mode === "off") return { mode: "off", reason: "X_POSTING=off (kill switch)" };
  if (cfg.want === "off") return { mode: "off", reason: "X_REPLIES_MODE=off" };
  if (cfg.want === "live") return g.mode === "live" ? { mode: "live", reason: "X_REPLIES_MODE=live and posting is live" } : { mode: "dry", reason: `X_REPLIES_MODE=live but ${g.reason}` };
  return { mode: "dry", reason: "X_REPLIES_MODE is dry (default)" };
}

const keysOf = (env) => {
  const k = { apiKey: env.X_API_KEY ?? "", apiSecret: env.X_API_SECRET ?? "", accessToken: env.X_ACCESS_TOKEN ?? "", accessSecret: env.X_ACCESS_SECRET ?? "" };
  return Object.values(k).every((v) => v.trim()) ? k : null;
};

// ---- one message ---------------------------------------------------------------------------------------------------

/**
 * Handle one message end to end: claim it, check the rules, plan, send (live) or show in Slack (dry), remember.
 * @param x     the run's shared context (env, mode, keys, query, doFetch, now, cfg, data, llm, me, meta, spent, repliesToday, recent)
 * @param item  { id, text, authorId, user, conversationId, createdAt, inReplyToUserId, source }
 */
export async function handleItem(item, x) {
  const { query, now, mode } = x;
  const day = colomboDay(now).day;
  const exists = (await query("SELECT mention_id FROM x_replies WHERE mention_id = ?", [item.id])).length > 0;
  if (exists) return { status: "seen" };
  const text = cleanText(item.text);
  const base = [item.id, now, day, item.source, item.authorId, item.user?.username ?? null, item.conversationId ?? null, text.slice(0, 300), mode];
  const readCost = item.source === "dm" ? x.cfg.costRead : x.cfg.costRead; // every post or message read is billed
  const write = (intent, status, o = {}) => query(
    "INSERT OR IGNORE INTO x_replies (mention_id, ts, day, source, author_id, author_username, conversation_id, text, mode, intent, status, target, reply_text, ai, error, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [...base, intent, status, o.target ?? null, o.reply ?? null, o.ai ? 1 : 0, o.error ?? null, readCost + (o.cost ?? 0)],
  );

  const handle = x.cfg.handle;
  const user = item.user ?? {};
  const isSelf = item.authorId === x.me.id || (user.username ?? "").toLowerCase() === handle.toLowerCase();
  const plan = await planReply(item, { ...x, handle });
  const intent = plan.intent;
  const feed = (outcome, why, reply) => x.note(feedMessage({ item, plan, user, outcome, why, reply, reason: x.reason }));
  if (item.source === "mention" && !directedAtUs({ text: item.text, inReplyToUserId: item.inReplyToUserId }, x.me.id, handle)) { await write(intent, "skipped", { error: "not addressed to us" }); await feed("skipped", "not addressed to us (only tagged in someone else's thread)"); return { status: "skipped", why: "not addressed to us", plan }; }
  const wantsReply = REPLY_INTENTS.includes(intent) || !!plan.reply;
  if (!wantsReply || !plan.reply) {
    await write(intent, "ignored", { target: plan.target?.label, error: plan.error ?? plan.why });
    await feed("ignored", intent === "abuse" || intent === "spam" ? `${intent}: never answered` : plan.error ?? plan.why);
    return { status: "ignored", plan };
  }

  const lastRows = await query("SELECT intent, ts FROM x_replies WHERE author_id = ? AND status IN ('posted','dry') ORDER BY ts DESC LIMIT 20", [item.authorId]);
  const userLastReplyMs = lastRows.length ? Number(lastRows[0].ts) : null;
  const em = lastRows.find((r) => r.intent === "emergency");
  const conv = item.conversationId ? Number((await query("SELECT COUNT(*) AS n FROM x_replies WHERE conversation_id = ? AND day = ? AND status IN ('posted','dry')", [item.conversationId, day]))[0]?.n ?? 0) : 0;
  const limits = item.source === "dm" ? { ...x.cfg.limits, perConversation: 1 } : x.cfg.limits;
  const verdict = mayReply({
    intent, now, createdAt: item.createdAt ?? null, limits, isSelf, isBot: looksLikeBot(user), blocked: x.cfg.block.has((user.username ?? "").toLowerCase()),
    directed: true, protectedAccount: !!user.protected, repliesToday: x.repliesToday, userLastReplyMs, userLastEmergencyMs: em ? Number(em.ts) : null,
    conversationReplies: conv, spentUsd: x.spent,
  });
  if (!verdict.ok) {
    await write(intent, "skipped", { target: plan.target?.label, error: verdict.why });
    await feed("skipped", verdict.why);
    // an emergency we may not answer is still a human's problem
    if (intent === "emergency") await slack(`${x.cfg.critical} :rotating_light: *EMERGENCY message NOT answered automatically (${verdict.why})* from @${user.username ?? "?"}:\n${quote(text)}\nhttps://x.com/i/status/${item.id}`, x);
    return { status: "skipped", why: verdict.why, plan };
  }

  // owner pings (always, dry or live): reports, corrections, emergencies
  const link = item.source === "dm" ? "(direct message)" : `https://x.com/i/status/${item.id}`;
  if (intent === "emergency") await slack(`${x.cfg.critical} :rotating_light: *HIGH PRIORITY: someone says they need help* (@${user.username ?? "?"}). ${x.mode === "live" ? "The reply with 117 and the emergency numbers is being sent." : "DRY RUN: no reply is going out, please check it yourself."}\n${quote(text)}\n${link}`, x);
  else if (intent === "report") await slack(`:speech_balloon: Report from @${user.username ?? "?"}${plan.place ? ` (${plan.place})` : ""}: not confirmed, from one person. ${link}\n${quote(text)}`, x);
  else if (intent === "correction") await slack(`:warning: @${user.username ?? "?"} says something looks wrong. ${link}\n${quote(text)}`, x);

  let reply = plan.reply;
  const cost = x.cfg.costPost;
  const bad = reply.fixed ? validateFixed(reply.text, reply.fixed) : [];
  if (bad.length) {
    await write(intent, "failed", { target: plan.target?.label, error: `fixed reply failed its checks: ${bad.join("; ")}` });
    await feed("failed", `fixed reply failed its checks: ${bad.join("; ")}`);
    return { status: "failed", plan };
  }

  await write(intent, "claimed", { target: plan.target?.label, reply: reply.text, ai: reply.ai });
  if (mode !== "live") {
    await feed("dry", null, reply);
    await query("UPDATE x_replies SET status = 'dry', cost_usd = cost_usd + ? WHERE mention_id = ?", [cost, item.id]);
    x.repliesToday++; x.spent += cost; x.recent.unshift(reply.text);
    return { status: "dry", plan, reply };
  }

  const send = (t) => (item.source === "dm" ? sendDm(x.keys, item.authorId, t, { doFetch: x.doFetch, now }) : postTweet(x.keys, t, { replyTo: item.id, doFetch: x.doFetch, now }));
  let r = await send(reply.text);
  if (!r.ok && r.duplicate && reply.fixed) {
    // X refuses identical text: say it another way, once
    for (let v = 1; v < FIXED_VARIANTS && !r.ok && r.duplicate; v++) {
      const t = fixedReply(reply.fixed, { place: plan.place, variant: seedOf(String(item.id)) + (plan.variant ?? 0) + v });
      if (t !== reply.text) { reply = { ...reply, text: t }; r = await send(t); }
    }
  }
  if (!r.ok) {
    await query("UPDATE x_replies SET status = 'failed', error = ? WHERE mention_id = ?", [r.detail, item.id]);
    if (r.status === 429 || r.status === 401) {
      x.meta.pauseUntil = r.retryAfterMs ?? now + 3_600_000;
      x.meta.pauseWhy = r.detail;
      x.paused = true;
      await x.note(`:rotating_light: X reply failed (${r.detail}). Posting and replies are paused until ${new Date(x.meta.pauseUntil).toISOString()}.`);
    } else if (intent === "emergency") await x.note(`${x.cfg.critical} :rotating_light: The emergency reply to @${user.username ?? "?"} FAILED (${r.detail}). Please answer by hand: ${link}`);
    await feed("failed", r.detail, reply);
    return { status: "failed", plan, detail: r.detail };
  }
  await query("UPDATE x_replies SET status = 'posted', reply_id = ?, reply_text = ?, cost_usd = cost_usd + ? WHERE mention_id = ?", [r.id, reply.text, cost, item.id]);
  x.repliesToday++; x.spent += cost; x.recent.unshift(reply.text);
  await feed("posted", null, reply);
  return { status: "posted", plan, reply };
}

// ---- one run -------------------------------------------------------------------------------------------------------

export async function run(o = {}) {
  const env = o.env ?? process.env;
  const doFetch = o.doFetch ?? fetch;
  const query = o.query ?? d1Query;
  const now = o.now ?? Date.now();
  const cfg = { ...configOf(env), critical: env.X_CRITICAL_SLACK_MENTION ?? "<!channel>" };
  const { mode, reason } = replyMode(env);
  log(`replies: ${mode} (${reason})`);
  if (mode === "off") return { mode, handled: 0 };
  const keys = keysOf(env);
  if (!keys) {
    log("the four X keys are not all set: nothing can be read");
    return { mode, handled: 0, skipped: "no keys" };
  }
  for (const s of [...SHARED_SCHEMA, ...REPLIES_SCHEMA]) await query(s);
  const day = colomboDay(now).day;
  const note = (t) => slack(t, { env, doFetch });
  const meta = (await loadValue("meta", query)) ?? {};
  if (mode === "live" && meta.pauseUntil && now < meta.pauseUntil) {
    log(`paused until ${new Date(meta.pauseUntil).toISOString()} (${meta.pauseWhy ?? ""})`);
    return { mode, paused: true, handled: 0 };
  }

  // who we are (one read, remembered)
  let me = await loadValue("replies_me", query);
  if (!me?.id) {
    const r = await getMe(keys, { doFetch, now });
    if (!r.ok) {
      log(`could not read our own account: ${r.detail}`);
      if (r.status === 402 || r.status === 403 || r.status === 401) {
        const st = (await loadValue("replies_note", query)) ?? {};
        if (st.day !== day) { await note(`:warning: X replies: could not read the account (${r.detail}). Check the API credits and keys.`); await saveValue("replies_note", { day }, now, query); }
      }
      return { mode, handled: 0, error: r.detail };
    }
    me = { id: r.data.id, username: r.data.username };
    await saveValue("replies_me", me, now, query);
  }
  cfg.handle = me.username || cfg.handle;

  // reading budget
  const reads = (await loadValue("replies_reads", query)) ?? {};
  const todayReads = reads.day === day ? reads.n : 0;
  const month = day.slice(0, 7);
  const sum = async (sql, p) => Number((await query(sql, p))[0]?.c ?? 0);
  let spent = (await sum("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM x_posts WHERE day LIKE ? AND mode = ? AND status IN ('posted','dry')", [`${month}%`, mode])) + (await sum("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM x_replies WHERE day LIKE ? AND mode = ?", [`${month}%`, mode]));
  if (spent >= cfg.limits.budgetUsd) {
    log("monthly budget used up: not reading");
    return { mode, handled: 0, skipped: "budget" };
  }
  const left = cfg.readCap - todayReads;
  if (left < 5) {
    log(`read cap reached (${todayReads}/${cfg.readCap} posts today)`);
    return { mode, handled: 0, skipped: "read cap" };
  }

  const llm = o.llm === undefined ? makeLlm(env, doFetch) : o.llm;
  const offReason = llm ? undefined : env.OPENAI_API_KEY ? "AI writer switched off (X_AI_POLISH=off)" : "OPENAI_API_KEY is not set, so the plain templates are used";
  const data = o.data ?? (await loadData({ site: env.SITE_URL || SITE_DEFAULT, doFetch }));
  const repliesToday = await sum("SELECT COUNT(*) AS c FROM x_replies WHERE day = ? AND mode = ? AND status IN ('posted','dry')", [day, mode]);
  let recent = [];
  try { recent = (await query("SELECT reply_text FROM x_replies WHERE reply_text IS NOT NULL AND ai = 1 AND status IN ('posted','dry') ORDER BY ts DESC LIMIT 5")).map((r) => String(r.reply_text)); } catch { /* fresh table */ }
  const x = { env, mode, reason, keys, query, doFetch, now, cfg, data, llm, offReason, me, meta, spent, repliesToday, recent, note, paused: false, handle: cfg.handle };

  let handled = 0;
  const counts = {};
  const count = (r) => { counts[r.status] = (counts[r.status] ?? 0) + 1; if (r.status === "posted" || r.status === "dry") handled++; };

  // mentions
  const since = await loadValue("replies_since", query);
  const mr = await getMentions(keys, me.id, { sinceId: since?.id ?? null, max: Math.min(20, left), doFetch, now });
  let used = 0;
  if (!mr.ok) {
    log(`could not read mentions: ${mr.detail}`);
    if (mr.status === 429 || mr.status === 401 || mr.status === 402 || mr.status === 403) {
      const st = (await loadValue("replies_note", query)) ?? {};
      if (st.day !== day) { await note(`:warning: X replies: could not read mentions (${mr.detail}).`); await saveValue("replies_note", { day }, now, query); }
    }
  } else {
    used += mr.reads;
    const list = mr.data.mentions.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)); // oldest first
    log(`mentions: ${list.length} new`);
    for (const m of list) {
      if (x.paused) break;
      const r = await handleItem({ ...m, source: "mention", user: mr.data.users[m.authorId] }, x);
      log(`  ${m.id} ${r.plan?.intent ?? ""} -> ${r.status}${r.why ? ` (${r.why})` : ""}`);
      count(r);
    }
    if (mr.data.newestId && !x.paused) await saveValue("replies_since", { id: mr.data.newestId }, now, query);
  }

  // direct messages (only with X_DM=on and the app's DM permission)
  if (cfg.dm && !x.paused && left - used >= 5) {
    const dr = await getDms(keys, { max: Math.min(20, left - used), doFetch, now });
    if (!dr.ok) {
      log(`could not read direct messages: ${dr.detail}`);
      const st = (await loadValue("replies_note", query)) ?? {};
      if (st.dmDay !== day) { await note(`:warning: X replies: direct messages could not be read (${dr.detail}). X_DM=on needs the app permission "Read and write and Direct message" and a regenerated access token. See DOCS.md "X replies".`); await saveValue("replies_note", { ...st, dmDay: day }, now, query); }
    } else {
      used += dr.reads;
      const first = (await loadValue("replies_dm_since", query)) == null;
      const sinceDm = (await loadValue("replies_dm_since", query))?.id ?? null;
      const fresh = dr.data.dms.filter((d) => d.senderId !== me.id && (sinceDm == null || BigInt(d.id) > BigInt(sinceDm))).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      if (first) log(`direct messages: first look, ${fresh.length} existing message(s) marked as seen without replying`);
      else for (const d of fresh) {
        if (x.paused) break;
        const r = await handleItem({ id: `dm:${d.id}`, text: d.text, authorId: d.senderId, user: dr.data.users[d.senderId], conversationId: d.conversationId, createdAt: d.createdAt, inReplyToUserId: null, source: "dm" }, x);
        log(`  dm ${d.id} ${r.plan?.intent ?? ""} -> ${r.status}${r.why ? ` (${r.why})` : ""}`);
        count(r);
      }
      const top = dr.data.dms.reduce((a, d) => (a == null || BigInt(d.id) > BigInt(a) ? d.id : a), null);
      if (top && !x.paused) await saveValue("replies_dm_since", { id: top }, now, query);
    }
  }

  if (used) {
    await saveValue("replies_reads", { day, n: todayReads + used }, now, query);
    if (todayReads + used >= cfg.readCap) await note(`:information_source: X replies: reached today's read cap (${cfg.readCap} posts); reading resumes tomorrow. Raise it with: gh variable set X_REPLY_READ_CAP --body <n>`);
  }
  if (x.paused) await saveValue("meta", meta, now, query);
  // old mention text is not kept for long
  await query("UPDATE x_replies SET text = '' WHERE ts < ? AND text <> ''", [now - 30 * 86_400_000]);
  log(`replies: handled ${handled}${mode === "live" ? "" : " (dry run)"}, ${JSON.stringify(counts)}, read ${used} post(s)`);
  return { mode, handled, counts, read: used };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(`x-replies failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
