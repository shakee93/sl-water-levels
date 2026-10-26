// The X (Twitter) account: looks at the live site, decides what is worth saying, writes it, and either shows it to the
// owner in Slack (DRY RUN, the default) or posts it to X (live). See DOCS.md "X account".
//
//   node --experimental-strip-types --no-warnings scripts/x-post.mjs [--mode run|sample] [--site URL]
//     run     (default) one pass: alerts, all-clears, storm updates, and the morning / evening summary when due.
//     sample  composes up to 3 sample posts from TODAY's real data and sends them to Slack as DRY RUN. Never posts to X,
//             never touches the memory (D1) or the daily count.
//
// The gate (lib/xClient.ts gate()): X_POSTING=off -> does nothing; X_POSTING=live and the 4 keys -> posts to X;
// otherwise -> posts to Slack only. Every post is logged in D1 (x_posts); what was already said is kept in x_state, so a
// re-run says nothing twice. A failed X call (429, 403, 401, network) is reported to Slack, pauses posting for a while
// and queues the post for one retry within 2 h; it is never retried in a loop.
//
// Env: SITE_URL, SLACK_WEBHOOK_URL, CLOUDFLARE_API_TOKEN (state), X_POSTING, X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN,
//      X_ACCESS_SECRET, OPENAI_API_KEY (optional polish), X_AI_POLISH=off, X_LANGS=en,si,ta (default en), X_DAILY_MAX,
//      X_EVENING=on.
// Cost (the X API is pay-per-use; a post with a link costs about 13 times a post without): links are OFF by default
// (X_LINKS=off|alerts|all; "alerts" = major-flood rises, major official warnings), thread
// replies are OFF (X_REPLIES=on), and a monthly budget guard (X_MONTHLY_BUDGET_USD, default 10; X_COST_POST=0.015,
// X_COST_LINK_POST=0.20 are estimates) stops everything except Major-flood rises and all-clears at 80% of the budget.
import { pathToFileURL } from "node:url";
import { d1Query } from "../lib/d1.ts";
import { gate, postTweet } from "../lib/xClient.ts";
import {
  composeGaugeRise, composeGaugeClear, composeReservoirStart, composeReservoirStop,
  composeWarning, composeSummary, composeStorm, composeRainWatch, validatePost, validateText, polish, tweetLength, colomboDay, MAX_TWEET,
} from "../lib/xCompose.ts";
import { evaluate, applyCaps, emptyState, summaryEvent, tierLevel } from "./x-engine.mjs";
import { PLACES } from "../lib/places.ts";
import { pushText } from "../lib/i18n/return.ts";
import { localePath } from "../lib/i18n/config.ts";

export const X_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS x_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, reply_text TEXT, tweet_id TEXT, reply_id TEXT, ai INTEGER NOT NULL DEFAULT 0, error TEXT, cost_usd REAL NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS idx_x_posts_day ON x_posts (day)",
  "CREATE TABLE IF NOT EXISTS x_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_ms INTEGER NOT NULL)",
];

const SITE_DEFAULT = "https://sl-water-levels.vercel.app";
// The OpenAI model the site already uses for advisories (lib/openai.ts OPENAI_MODEL).
const OPENAI_MODEL = "gpt-6-luna";
const RAIN_PLACES = ["colombo", "gampaha", "kalutara", "ratnapura", "kandy", "galle", "matara", "anuradhapura", "batticaloa", "jaffna"];
const PENDING_MAX_AGE_MS = 2 * 3_600_000;

const log = (...a) => console.log(...a);

// ---- reading the site ----------------------------------------------------------------------------------------------

async function getJson(url, doFetch, ms = 60_000) {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(ms), headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Everything the engine needs, each part null when it could not be read. */
export async function buildSnapshot({ site = SITE_DEFAULT, now = Date.now(), doFetch = fetch, query = d1Query } = {}) {
  const [levels, rsv, warn] = await Promise.all([
    getJson(`${site}/api/levels`, doFetch),
    getJson(`${site}/api/reservoirs`, doFetch),
    getJson(`${site}/api/warnings`, doFetch),
  ]);
  const stations = levels?.stations
    ? levels.stations.map((s) => ({ id: s.id, station: s.station, river: s.river, status: s.status, level: s.level, unit: s.unit, marks: s.marks, trend: s.trend, observedAt: s.observedAt, url: s.url, nextHour: s.nextHour }))
    : null;
  const reservoirs = rsv?.reservoirs ?? null;

  // rain expected in the next 24 h: the heaviest among a few towns around the country (same figure the town pages show)
  let rain = null;
  const keys = RAIN_PLACES.filter((s) => PLACES.some((p) => p.slug === s)).map((s) => `t:${s}`);
  const pj = keys.length ? await getJson(`${site}/api/places-state?keys=${encodeURIComponent(keys.join("|"))}`, doFetch) : null;
  if (pj?.ok) {
    const withRain = pj.places.filter((g) => typeof g.rainNext24 === "number");
    if (withRain.length) {
      const top = withRain.reduce((a, g) => (g.rainNext24 > a.rainNext24 ? g : a));
      rain = { mm: Math.round(top.rainNext24), place: top.name };
    }
  }
  return { now, site, stations, reservoirs, warnings: warn?.warnings ?? null, rain };
}

// ---- words ---------------------------------------------------------------------------------------------------------

/** The Post (text, reply, facts) for one event. */
export function composeEvent(ev) {
  let c;
  let facts;
  switch (ev.type) {
    case "gauge_rise": c = composeGaugeRise(ev.gauges); facts = ev.gauges; break;
    case "gauge_clear": c = composeGaugeClear(ev.gauges); facts = ev.gauges; break;
    case "reservoir_start": c = composeReservoirStart(ev.reservoirs); facts = ev.reservoirs; break;
    case "reservoir_stop": c = composeReservoirStop(ev.reservoirs); facts = ev.reservoirs; break;
    case "warning": c = composeWarning(ev.warning); facts = ev.warning; break;
    case "summary": c = composeSummary(ev.summary); facts = ev.summary; break;
    case "storm": c = composeStorm(ev.storm); facts = ev.storm; break;
    case "rainwatch": c = composeRainWatch(ev.rainwatch); facts = ev.rainwatch; break;
    default: throw new Error(`unknown event ${ev.type}`);
  }
  return { kind: ev.kind, ...c, facts };
}

/** Optional Sinhala / Tamil reply (draft wording from the push-message strings), for the event types that have one. */
export function localisedReply(ev, lang) {
  const base = new URL(ev.gauges?.[0]?.url ?? ev.reservoirs?.[0]?.url ?? ev.summary?.url ?? SITE_DEFAULT);
  const link = `${base.origin}${localePath(lang, base.pathname)}`;
  let m = null;
  if (ev.type === "gauge_rise") m = pushText(lang, "rise", [{ name: ev.gauges[0].station, level: Math.max(2, tierLevel(ev.gauges.reduce((a, g) => (tierLevel(g.tier) > tierLevel(a) ? g.tier : a), "alert"))), street: null }]);
  else if (ev.type === "gauge_clear") m = pushText(lang, "clear", [{ name: ev.gauges[0].station, level: 0, street: null }]);
  else if (ev.type === "reservoir_start") m = pushText(lang, "release", [{ name: ev.reservoirs[0].name, level: 0, street: null }], { reservoir: ev.reservoirs[0].name, confirmed: true });
  if (!m) return null;
  const text = `${m.title}\n${m.body}\n${link}\n117`;
  return tweetLength(text) <= MAX_TWEET ? text : null;
}

/** OpenAI Responses call that returns the text field, or null. Only used when OPENAI_API_KEY is set. */
export function makeLlm(env, doFetch = fetch) {
  const key = env.OPENAI_API_KEY;
  if (!key || (env.X_AI_POLISH ?? "").trim().toLowerCase() === "off") return null;
  return async (instructions, input) => {
    const res = await doFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL, instructions, input, reasoning: { effort: "low" }, max_output_tokens: 600, store: false,
        text: { format: { type: "json_schema", name: "post", strict: true, schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } } },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    let out = "";
    for (const item of j.output ?? []) if (item.type === "message") for (const c of item.content ?? []) if (c.type === "output_text" && c.text) out += c.text;
    try { return JSON.parse(out).text ?? null; } catch { return null; }
  };
}

/** Does this event deserve a page link (which costs ~13x more on the X API)? X_LINKS: off (default) | alerts | all. */
export function linkWanted(ev, mode) {
  if (mode === "all") return true;
  if (mode !== "alerts") return false;
  if (ev.type === "gauge_rise") return ev.gauges.some((g) => g.tier === "major");
  return ev.type === "warning" && (ev.warning.severity === "major flood" || ev.warning.severity === "evacuation");
}

/** Always allowed, even over budget: a Major-flood rise, any all-clear, a major official warning. */
export function isCritical(ev) {
  if (ev.type === "gauge_rise") return ev.gauges.some((g) => g.tier === "major");
  if (ev.type === "warning") return ev.warning.severity === "major flood" || ev.warning.severity === "evacuation";
  return ev.type === "gauge_clear";
}

/** Estimated API cost in dollars of a post (and its replies). */
export function costOf(text, replies, rates) {
  const one = (t) => (/https?:\/\//.test(t) ? rates.link : rates.post);
  return one(text) + replies.reduce((n, t) => n + one(t), 0);
}

/** Compose, check and (optionally) polish. Returns { post, text, reply, ai } or { error }. A post that fails its own checks is never sent. */
export async function prepare(ev, llm, { links = "off", replies = false } = {}) {
  const post = composeEvent(ev);
  const bad = validatePost(post);
  if (bad.length) return { error: `template failed its own checks (${bad.join("; ")})`, post };
  const withLink = linkWanted(ev, links);
  let text = withLink ? post.text : post.textNoLink;
  let ai = false;
  if (llm && ev.type !== "warning") {
    const p = await polish(post, llm, withLink);
    text = p.text;
    ai = p.used === "ai";
    if (p.why) log(`polish rejected (${p.why}): using the template`);
  }
  let reply = replies ? post.reply ?? null : null;
  if (reply && !withLink && links !== "all") reply = reply.replace(/\nhttps?:\/\/\S+$/, "").replace(/\nBulletin: https?:\/\/\S+/, "");
  if (reply) {
    const rb = validateText(reply, { link: "", facts: post.facts, must: [], hashtags: post.hashtags, disclaimer: "" });
    if (rb.length) {
      log(`reply dropped (${rb.join("; ")})`);
      reply = null;
    }
  }
  return { post, text, reply, ai, withLink };
}

// ---- Slack ---------------------------------------------------------------------------------------------------------

async function slack(text, { env = process.env, doFetch = fetch } = {}) {
  const hook = env.SLACK_WEBHOOK_URL;
  if (!hook) {
    log(`[no Slack webhook] ${text}`);
    return false;
  }
  try {
    const res = await doFetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) console.warn(`Slack post failed: HTTP ${res.status}`);
    return res.ok;
  } catch {
    console.warn("Slack post failed");
    return false;
  }
}

const quote = (t) => t.split("\n").map((l) => `> ${l}`).join("\n");

export function dryRunMessage({ n, of, kind, text, reply, extra, ai, reason, cost = null, sample = false }) {
  return [
    `*${sample ? "SAMPLE, " : ""}DRY RUN: not posted to X* (${n}/${of}) [${kind}] ${tweetLength(text)}/${MAX_TWEET} characters, ${ai ? "reworded by AI (checked)" : "plain template"}${cost != null ? `, est. cost $${cost.toFixed(3)}` : ""}`,
    quote(text),
    reply ? `_Thread reply:_\n${quote(reply)}` : null,
    ...(extra ?? []).map((x) => `_${x.lang} reply (draft):_\n${quote(x.text)}`),
    reason ? `_${reason}_` : null,
  ].filter(Boolean).join("\n");
}

// ---- memory --------------------------------------------------------------------------------------------------------

async function loadValue(key, query) {
  const r = (await query("SELECT value FROM x_state WHERE key = ?", [key]))[0];
  try { return r ? JSON.parse(String(r.value)) : null; } catch { return null; }
}
const saveValue = (key, v, now, query) => query("INSERT INTO x_state (key, value, updated_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms", [key, JSON.stringify(v), now]);

/** Claims a dedupe key; false when another run already took it. */
async function claim(row, query) {
  const exists = (await query("SELECT id FROM x_posts WHERE dedupe_key = ?", [row.dedupe])).length > 0;
  if (exists) return false;
  await query("INSERT OR IGNORE INTO x_posts (ts, day, kind, dedupe_key, mode, status, text, reply_text, ai, cost_usd) VALUES (?, ?, ?, ?, ?, 'claimed', ?, ?, ?, ?)", [row.ts, row.day, row.kind, row.dedupe, row.mode, row.text, row.reply ?? null, row.ai ? 1 : 0, row.cost ?? 0]);
  const mine = (await query("SELECT id, status FROM x_posts WHERE dedupe_key = ?", [row.dedupe]))[0];
  return !!mine && mine.status === "claimed" && Number(mine.id) > 0;
}

// ---- one run -------------------------------------------------------------------------------------------------------

/**
 * @param o.env     environment (gate, secrets, options)
 * @param o.snap    a snapshot (tests) or built from the site
 * @param o.query   D1 query function
 * @param o.doFetch fetch (X, Slack, OpenAI)
 */
export async function run(o = {}) {
  const env = o.env ?? process.env;
  const doFetch = o.doFetch ?? fetch;
  const query = o.query ?? d1Query;
  const now = o.now ?? Date.now();
  const g = gate(env);
  log(`gate: ${g.mode} (${g.reason})`);
  if (g.mode === "off") return { mode: "off", posted: 0 };

  for (const s of X_SCHEMA) await query(s);
  const day = colomboDay(now).day;
  const cfg = {
    dailyMax: Number(env.X_DAILY_MAX) > 0 ? Number(env.X_DAILY_MAX) : 15,
    evening: (env.X_EVENING ?? "").toLowerCase() === "on",
  };
  const links = ["alerts", "all"].includes((env.X_LINKS ?? "").trim().toLowerCase()) ? env.X_LINKS.trim().toLowerCase() : "off";
  const replies = (env.X_REPLIES ?? "").trim().toLowerCase() === "on";
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const budget = num(env.X_MONTHLY_BUDGET_USD, 10);
  const rates = { post: num(env.X_COST_POST, 0.015), link: num(env.X_COST_LINK_POST, 0.2) };
  const langs = (replies ? (env.X_LANGS ?? "en") : "en").split(",").map((s) => s.trim()).filter((s) => s === "si" || s === "ta");
  const meta = (await loadValue("meta", query)) ?? {};
  const live = g.mode === "live";
  const note = (t) => slack(t, { env, doFetch });

  if (live && meta.pauseUntil && now < meta.pauseUntil) {
    log(`paused until ${new Date(meta.pauseUntil).toISOString()} (${meta.pauseWhy ?? ""}): nothing posted, memory untouched`);
    return { mode: "live", paused: true, posted: 0 };
  }
  if (g.reason.includes("staying in dry-run") && meta.noteDay !== day) {
    await note(`:warning: X posting: ${g.reason}. Posts are going to this channel only. See DOCS.md "X account".`);
    meta.noteDay = day;
    await saveValue("meta", meta, now, query);
  }

  const snap = o.snap ?? (await buildSnapshot({ site: env.SITE_URL || SITE_DEFAULT, now, doFetch, query }));
  if (!snap.stations && !snap.reservoirs) {
    log("the site could not be read: nothing to do (the health check reports it)");
    return { mode: g.mode, posted: 0, skipped: "site unreadable" };
  }
  const prev = (await loadValue("main", query)) ?? emptyState();
  const { events, state } = evaluate(snap, prev, cfg);

  const usedRows = await query("SELECT COUNT(*) AS n FROM x_posts WHERE day = ? AND mode = ? AND status IN ('posted','dry')", [day, g.mode]);
  const { send, held } = applyCaps(events, { normal: Number(usedRows[0]?.n ?? 0), urgent: 0 }, cfg);
  for (const e of held) {
    log(`held by the daily limit: ${e.type} ${e.dedupe}`);
    await query("INSERT OR IGNORE INTO x_posts (ts, day, kind, dedupe_key, mode, status, text) VALUES (?, ?, ?, ?, ?, 'held', ?)", [now, day, e.kind, `held:${e.dedupe}:${now}`, g.mode, `(held by daily limit) ${e.type}`]);
  }
  if (held.length) await note(`:information_source: X account: ${held.length} post(s) held back by the daily limit (${cfg.dailyMax}/day, urgent ${40}).`);

  const month = day.slice(0, 7);
  let spent = Number((await query("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM x_posts WHERE day LIKE ? AND mode = ? AND status IN ('posted','dry')", [`${month}%`, g.mode]))[0]?.c ?? 0);
  const llm = makeLlm(env, doFetch);
  const queue = [];
  // a post that failed earlier goes first, if still fresh
  for (const p of state.pending ?? []) {
    if (now - p.ts <= PENDING_MAX_AGE_MS) queue.push({ ...p, retry: true });
    else await note(`:warning: X account: dropped a queued post that is now too old to send: ${p.text.split("\n")[0]}`);
  }
  state.pending = [];
  for (const ev of send) {
    const r = await prepare(ev, llm, { links, replies });
    if (r.error) {
      await note(`:warning: X account: a ${ev.type} post was NOT sent because it failed its own checks: ${r.error}`);
      continue;
    }
    const cost = costOf(r.text, [r.reply, ...(replies ? langs.map((l) => localisedReply(ev, l)) : [])].filter(Boolean), rates);
    if (!isCritical(ev) && spent + cost > budget * 0.8) {
      log(`over 80% of the monthly budget: ${ev.type} not posted`);
      await query("INSERT OR IGNORE INTO x_posts (ts, day, kind, dedupe_key, mode, status, text) VALUES (?, ?, ?, ?, ?, 'held', ?)", [now, day, ev.kind, `budget:${ev.dedupe}:${now}`, g.mode, `(held by monthly budget) ${r.text}`]);
      if (meta.budgetNote !== month) {
        meta.budgetNote = month;
        await saveValue("meta", meta, now, query);
        await note(`:moneybag: X account: estimated spend this month is $${spent.toFixed(2)} of the $${budget} budget (80% limit reached). Routine updates (summaries, storm updates, reservoirs) are paused until next month; Major-flood rises and all-clears still go out. Raise it with: gh variable set X_MONTHLY_BUDGET_USD --body <dollars>`);
      }
      continue;
    }
    spent += cost;
    const extra = [];
    for (const lang of replies ? langs : []) {
      const t = localisedReply(ev, lang);
      if (t) extra.push({ lang, text: t });
    }
    queue.push({ ts: now, day, kind: ev.kind, dedupe: ev.dedupe, text: r.text, reply: r.reply, ai: r.ai, extra, cost });
  }

  let posted = 0;
  let failed = 0;
  let blocked = false;
  const total = queue.length;
  for (const [i, item] of queue.entries()) {
    if (blocked) {
      state.pending.push({ ts: item.ts, day: item.day, kind: item.kind, dedupe: item.dedupe, text: item.text, reply: item.reply, ai: item.ai, extra: item.extra, cost: item.cost });
      continue;
    }
    const mine = await claim({ ...item, mode: g.mode }, query);
    if (!mine) {
      log(`already handled by another run: ${item.dedupe}`);
      continue;
    }
    if (!live) {
      await note(dryRunMessage({ n: i + 1, of: total, kind: item.kind, text: item.text, reply: item.reply, extra: item.extra, ai: item.ai, reason: g.reason, cost: item.cost }));
      await query("UPDATE x_posts SET status = 'dry' WHERE dedupe_key = ?", [item.dedupe]);
      posted++;
      continue;
    }
    const r = await postTweet(g.keys, item.text, { doFetch, now });
    if (!r.ok) {
      failed++;
      const fail = `${item.dedupe}#failed${now}`;
      await query("UPDATE x_posts SET status = 'failed', cost_usd = 0, error = ?, dedupe_key = ? WHERE dedupe_key = ?", [r.detail, fail, item.dedupe]);
      if (r.duplicate) {
        await note(`:warning: X rejected a post as a duplicate, skipped: ${item.text.split("\n")[0]}`);
        continue;
      }
      blocked = true;
      meta.pauseUntil = r.retryAfterMs ?? now + 3_600_000;
      meta.pauseWhy = r.detail;
      await note(`:rotating_light: X post failed (${r.detail}). Posting is paused until ${new Date(meta.pauseUntil).toISOString()}; the post is queued for one retry within 2 h. Not retrying in a loop.\n${quote(item.text)}`);
      state.pending.push({ ts: item.ts, day: item.day, kind: item.kind, dedupe: item.dedupe, text: item.text, reply: item.reply, ai: item.ai, extra: item.extra, cost: item.cost });
      continue;
    }
    let replyId = null;
    const thread = [item.reply, ...(item.extra ?? []).map((x) => x.text)].filter(Boolean);
    let parent = r.id;
    for (const t of thread) {
      const rr = await postTweet(g.keys, t, { doFetch, now, replyTo: parent });
      if (!rr.ok) {
        await note(`:warning: X thread reply failed (${rr.detail}); the main post is up. Pausing.`);
        meta.pauseUntil = rr.retryAfterMs ?? now + 3_600_000;
        meta.pauseWhy = rr.detail;
        blocked = true;
        break;
      }
      replyId ??= rr.id;
      parent = rr.id;
    }
    await query("UPDATE x_posts SET status = 'posted', tweet_id = ?, reply_id = ? WHERE dedupe_key = ?", [r.id, replyId, item.dedupe]);
    posted++;
  }

  if (blocked || meta.pauseUntil) await saveValue("meta", meta, now, query);
  await saveValue("main", state, now, query);
  log(`events ${events.length}, sent ${posted}${live ? "" : " (dry run)"}, failed ${failed}, held ${held.length}`);
  return { mode: g.mode, posted, failed, held: held.length, events: events.length };
}

/** Up to 3 sample posts from today's real data, to Slack only. Touches no memory. */
export async function sample(o = {}) {
  const env = o.env ?? process.env;
  const doFetch = o.doFetch ?? fetch;
  const now = o.now ?? Date.now();
  const snap = o.snap ?? (await buildSnapshot({ site: env.SITE_URL || SITE_DEFAULT, now, doFetch }));
  if (!snap.stations) throw new Error("the site's levels could not be read");
  const llm = makeLlm(env, doFetch);
  const evs = [summaryEvent(snap, "morning", now)];
  const us = snap.stations.filter((s) => tierLevel(s.status) != null && s.unit === "ft" && s.observedAt && typeof s.level === "number");
  // a river update for the river with the highest gauge relative to its alert mark (real numbers, real forecast when there is one)
  const ratio = (s) => (s.marks?.alert ? s.level / s.marks.alert : 0);
  const top = us.slice().sort((a, b) => tierLevel(b.status) - tierLevel(a.status) || ratio(b) - ratio(a))[0];
  if (top) {
    const all = us.filter((s) => s.river === top.river && tierLevel(s.status) >= 0).sort((a, b) => ratio(b) - ratio(a)).slice(0, 3);
    const fact = (s) => ({ station: s.station, river: s.river, tier: s.status, level: s.level, mark: s.marks?.[s.status] ?? null, alertMark: s.marks?.alert ?? null, trend: s.trend, nextHour: s.nextHour ? { level: s.nextHour.level_ft, low: s.nextHour.low_ft, high: s.nextHour.high_ft, direction: s.nextHour.direction, crossing: s.nextHour.crossing } : null, url: s.url, at: Date.parse(s.observedAt) });
    evs.push({ type: "storm", kind: "storm", storm: { river: top.river, at: now, gauges: all.map(fact), url: all[0].url } });
  }
  const res = (snap.reservoirs ?? []).filter((r) => (r.status === "spilling" || r.status === "releasing") && r.flow?.cusecs > 0).sort((a, b) => b.flow.cusecs - a.flow.cusecs)[0];
  if (res) evs.push({ type: "reservoir_start", kind: "reservoir", reservoirs: [{ name: res.name, river: res.river, status: res.status, cusecs: res.flow.cusecs, storagePercent: res.storagePercent, day: res.flow.day ?? res.readingDay, source: res.source, url: res.url }] });
  const out = [];
  for (const [i, ev] of evs.slice(0, 3).entries()) {
    const r = await prepare(ev, llm);
    if (r.error) throw new Error(r.error);
    const msg = dryRunMessage({ n: i + 1, of: Math.min(3, evs.length), kind: ev.kind, text: r.text, reply: r.reply, ai: r.ai, sample: true, cost: costOf(r.text, [], { post: 0.015, link: 0.2 }), reason: "Sample from today's real data to show the wording. The real account posts only when something changes." });
    out.push({ ev, ...r, msg });
    await slack(msg, { env, doFetch });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  if (val("--site")) process.env.SITE_URL = val("--site");
  const mode = val("--mode") ?? "run";
  (mode === "sample" ? sample() : run())
    .then((r) => {
      if (mode === "sample") for (const s of r) console.log(`\n${s.msg}`);
    })
    .catch(async (e) => {
      console.error(`x-post failed: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
