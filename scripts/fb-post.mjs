// The site's Facebook Page: the same FEED posts the Instagram account makes (same rules for when, same pictures), never
// stories, each ending with the link of the page that matches the picture. OFF by default. See DOCS.md "Facebook Page posting".
//
//   node --experimental-strip-types --no-warnings scripts/fb-post.mjs [--mode run|sample] [--site URL]
//     run     (default) one pass.
//     sample  a few sample posts from TODAY's real data, to Slack only. Never posts, never touches the memory.
//
// The gate (lib/fbClient.ts gate()): FB_MODE unset or off -> does NOTHING (no reads, no Slack, no tables); FB_MODE=dry -> every
// post is shown in Slack as "DRY RUN"; FB_MODE=live with FB_PAGE_ID and FB_PAGE_TOKEN -> publishes. FB_MODE=live with a secret
// missing stays in dry-run and says so in Slack once a day.
//
// Independent of Instagram on purpose: the Page keeps its OWN copy of the Instagram engine's memory (fb_state) and its own post
// log (fb_posts), so an Instagram failure, pause or kill switch never silences Facebook, and the other way round. The rules
// are not written twice: scripts/ig-engine.mjs planIg decides, and this script keeps only its feed posts.
// Each post claims its key in D1 BEFORE anything is sent and a key is never freed again: one key, at most one publish
// request, ever. A failed Facebook call is told to Slack and skipped; an account-wide error also pauses posting.
//
// Env: SITE_URL, SLACK_WEBHOOK_URL, CLOUDFLARE_API_TOKEN (memory), FB_MODE, FB_PAGE_ID, FB_PAGE_TOKEN, IG_GRAPH_VERSION,
//      FB_LANGS / FB_FEED_MAX / FB_KEEPALIVE_WEEK (each falls back to Instagram's IG_LANGS / IG_FEED_MAX / IG_KEEPALIVE_WEEK),
//      FB_NO_PICTURE=skip|link (picture cannot be fetched: skip the post like Instagram, the default, or send it as a link post).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { d1Query, isD1ReadBlip } from "../lib/d1.ts";
import { splitSql, runStatements, D1HttpError } from "../lib/d1Sql.mjs";
import { gate, publishPhoto, publishFeed } from "../lib/fbClient.ts";
import { fetchJpeg } from "../lib/igClient.ts";
import { composeFbCaption, validateFbCaption, pageLink } from "../lib/fbCompose.ts";
import { colomboDay } from "../lib/xCompose.ts";
import { buildSnapshot } from "./x-post.mjs";
import { planIg, emptyIgState, imageUrl, calmItem, IG_DEFAULTS } from "./ig-engine.mjs";
import { tierLevel } from "./x-engine.mjs";
import { notify } from "../lib/notify.mjs";

export const FB_SCHEMA_FILE = new URL("../d1/0022_fb_posts.sql", import.meta.url);
export const OFF_LINE = 'Facebook Page posting is OFF: nothing was read, composed, shown in Slack or sent to Facebook. To see previews in Slack, set the repository variable FB_MODE to dry (DOCS.md "Facebook Page posting").';
const SITE_DEFAULT = "https://waterlevels.lk";
const DAY_MS = 86_400_000;
/** A live row still "claimed" this long after its run started was left by a run that died half-way. */
export const STUCK_MS = 3_600_000;

/** Creates the two tables from d1/0022_fb_posts.sql through lib/d1Sql.mjs (HTTP /query; every statement is IF NOT EXISTS). */
export async function applySchema() {
  await runStatements(splitSql(readFileSync(FB_SCHEMA_FILE, "utf8")), { label: "d1/0022_fb_posts.sql" });
}

// ---- Slack ---------------------------------------------------------------------------------------------------------

// Every message also goes into the in-house notification log (lib/notify.mjs) so recurring problems get one tracked issue.
async function slack(text, { env, doFetch, kind, severity, log = console.log }) {
  const hook = env.SLACK_WEBHOOK_URL;
  if (!hook) log(`[no Slack webhook] ${text}`);
  return (await notify(text, { source: "fb-post", kind, severity, env, doFetch, webhook: hook })).slackOk;
}
const quote = (t) => t.split("\n").map((l) => `> ${l}`).join("\n");

/** What the owner sees in Slack for one post that would have gone to the Page. */
export function dryRunMessage({ n, of, item, caption, url, check, situation, reason, how = "photo", sample = false }) {
  return [
    `*${sample ? "SAMPLE, " : ""}DRY RUN: not posted to Facebook* (${n}/${of}) [${how === "link" ? "link post, no picture" : "photo post"}: ${item.label}] mode: ${situation.mode} (${situation.why})`,
    `_Image (JPEG, 4:5, 1080x1350):_ ${url}${check ? `\n_Image check:_ ${check}` : ""}`,
    "_Caption (the link in it is clickable on Facebook):_",
    quote(caption),
    reason ? `_${reason}_` : null,
  ].filter(Boolean).join("\n");
}

// ---- memory --------------------------------------------------------------------------------------------------------

async function loadValue(key, query) {
  const r = (await query("SELECT value FROM fb_state WHERE key = ?", [key]))[0];
  try { return r ? JSON.parse(String(r.value)) : null; } catch { return null; }
}
const saveValue = (key, v, now, query) => query("INSERT INTO fb_state (key, value, updated_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms", [key, JSON.stringify(v), now]);

/**
 * Claims a dedupe key for this run. The UNIQUE key lets only one INSERT in, and the row carries the id of the run that got
 * in, so of two runs racing only one reads its own id back. True = this run may send the post. A key that already has a row
 * (posted, shown, failed or still in flight) is never taken again.
 */
async function claim(row, query) {
  await query("INSERT OR IGNORE INTO fb_posts (ts, day, kind, format, situation, dedupe_key, mode, status, caption, image_url, link, claim) VALUES (?, ?, ?, 'photo', ?, ?, ?, 'claimed', ?, ?, ?, ?)", [row.ts, row.day, row.kind, row.situation, row.dedupe, row.mode, row.caption, row.url, row.link, row.claim]);
  const r = (await query("SELECT claim, status FROM fb_posts WHERE dedupe_key = ?", [row.dedupe]))[0];
  return !!r && r.claim === row.claim && r.status === "claimed";
}

/**
 * What the caps and the keep-alive rules need, counted from fb_posts (dry runs count like real posts, in their own mode).
 * EVERY attempt uses its slot, whether it worked or not: a post that may be on the Page without our knowing (a run that died,
 * no answer from Facebook) must count towards the day's limit, and a keep-alive post that failed must move the rotation on
 * instead of being picked again on every run (its key stays taken, so it could never go out). The Page has no stories.
 */
export async function loadContext(query, { day, mode, now }) {
  const counted = "status IN ('posted','dry','claimed','failed')";
  const today = (await query(`SELECT COUNT(*) AS n FROM fb_posts WHERE day = ? AND mode = ? AND ${counted}`, [day, mode]))[0];
  const week = (await query(`SELECT COUNT(*) AS n FROM fb_posts WHERE mode = ? AND ${counted} AND kind LIKE 'keepalive:%' AND ts > ?`, [mode, now - 7 * DAY_MS]))[0];
  const lastByType = {};
  let lastKeepMs = null;
  for (const r of await query(`SELECT kind, MAX(ts) AS t FROM fb_posts WHERE mode = ? AND ${counted} AND kind LIKE 'keepalive:%' GROUP BY kind`, [mode])) {
    const t = Number(r.t);
    lastByType[String(r.kind).slice("keepalive:".length)] = t;
    if (lastKeepMs == null || t > lastKeepMs) lastKeepMs = t;
  }
  return { used: { story: 0, feed: Number(today?.n ?? 0) }, keepWeek: Number(week?.n ?? 0), lastKeepMs, lastByType };
}

const pick = (env, a, b) => ((env[a] ?? "").trim() ? env[a] : env[b]);
const langsOf = (env) => {
  const l = (pick(env, "FB_LANGS", "IG_LANGS") ?? "en,si,ta").split(",").map((s) => s.trim()).filter((s) => s === "en" || s === "si" || s === "ta");
  return l.length ? l : ["en", "si", "ta"];
};
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const noPicture = (env) => ((env.FB_NO_PICTURE ?? "").trim().toLowerCase() === "link" ? "link" : "skip");
const isFeed = (i) => i.format === "feed";
const kb = (pic) => `fetched, JPEG, ${Math.round(pic.bytes.length / 1024)} KB`;
const needs = (o, names) => {
  for (const n of names) if (typeof o[n] !== "function") throw new TypeError(`fb-post: ${n} must be handed in (nothing here uses the network or D1 by itself)`);
};

// ---- one run -------------------------------------------------------------------------------------------------------

/**
 * @param o.env          environment (gate, secrets, options). No env = off.
 * @param o.doFetch      fetch (Facebook, Slack, our own site): tests pass a fake, nothing real is ever called
 * @param o.query        D1 query function
 * @param o.applySchema  creates the tables (called only when a dry or live run finds them missing)
 * @param o.snap         a snapshot (tests) or built from the site
 */
export async function run(o = {}) {
  const env = o.env ?? {};
  const log = o.log ?? console.log;
  const g = gate(env);
  log(`gate: ${g.mode} (${g.reason})`);
  if (g.mode === "off") {
    log(OFF_LINE);
    return { mode: "off", posted: 0 };
  }
  needs(o, ["doFetch", "query", "applySchema"]);
  const { doFetch, query } = o;
  const now = o.now ?? Date.now();
  const day = colomboDay(now).day;
  const live = g.mode === "live";
  const site = env.SITE_URL || SITE_DEFAULT;
  const noteAs = (kind, severity) => (t) => slack(t, { env, doFetch, kind, severity, log });

  // the memory; the first dry or live run ever finds no tables and creates them. Any failed first read that is not a plain
  // timeout gets the same answer (the statements are IF NOT EXISTS, so applying them again is harmless), then one more try.
  let meta;
  try {
    meta = await loadValue("meta", query);
  } catch (e) {
    if (isD1ReadBlip(e)) throw e;
    log(`the memory could not be read (${String(e instanceof Error ? e.message : e).slice(0, 120)}): making sure the tables exist (d1/0022_fb_posts.sql)`);
    await o.applySchema();
    meta = await loadValue("meta", query);
  }
  meta ??= {};
  let metaDirty = false;

  if (meta.pauseUntil && now >= meta.pauseUntil) {
    delete meta.pauseUntil;
    delete meta.pauseWhy;
    metaDirty = true;
  }
  // A live row still "claimed" an hour later belongs to a run that died between its claim and its end. Nobody will ever send
  // it (the key stays taken) and it may already be on the Page: say so once instead of losing it silently.
  const stuck = await query("SELECT kind FROM fb_posts WHERE status = 'claimed' AND mode = 'live' AND ts < ?", [now - STUCK_MS]);
  if (stuck.length) {
    await query("UPDATE fb_posts SET status = 'failed', error = ? WHERE status = 'claimed' AND mode = 'live' AND ts < ?", ["the run stopped before it finished: may or may not be on the Page", now - STUCK_MS]);
    const one = stuck.length === 1;
    await noteAs("post-failed", "warn")(`:warning: Facebook: ${stuck.length} post${one ? "" : "s"} (${[...new Set(stuck.map((r) => String(r.kind)))].join(", ")}) ${one ? "was" : "were"} started by a run that never finished. ${one ? "It" : "They"} may or may not be on the Page and will not be sent again: look at the Page.`);
  }
  if (live && meta.pauseUntil) {
    log(`paused until ${new Date(meta.pauseUntil).toISOString()} (${meta.pauseWhy ?? ""}): nothing posted, memory untouched`);
    return { mode: "live", paused: true, posted: 0 };
  }
  if (g.asked === "live" && !live && meta.noteDay !== day) {
    await noteAs("config", "warn")(`:warning: Facebook Page posting: ${g.reason}. Posts are shown in this channel only (DRY RUN). To go live: ${g.fix}. See DOCS.md "Facebook Page posting". (This note comes once a day.)`);
    meta.noteDay = day;
    await saveValue("meta", meta, now, query);
    metaDirty = false;
  }

  const snap = o.snap ?? (await buildSnapshot({ site, now, doFetch, query }));
  if (!snap.stations && !snap.reservoirs) {
    log("the site could not be read: nothing to do (the health check reports it)");
    if (metaDirty) await saveValue("meta", meta, now, query);
    return { mode: g.mode, posted: 0, skipped: "site unreadable" };
  }

  // the Instagram rules, on the Page's own memory; the Page gets the feed posts only
  const prev = (await loadValue("main", query)) ?? emptyIgState();
  const ctx = await loadContext(query, { day, mode: g.mode, now });
  const cfg = { feedMaxDisaster: num(pick(env, "FB_FEED_MAX", "IG_FEED_MAX"), IG_DEFAULTS.feedMaxDisaster), keepWeekMax: num(pick(env, "FB_KEEPALIVE_WEEK", "IG_KEEPALIVE_WEEK"), IG_DEFAULTS.keepWeekMax) };
  const plan = planIg(snap, prev, ctx, cfg);
  const { situation, state } = plan;
  const items = plan.items.filter(isFeed);
  const held = plan.held.filter(isFeed);
  const stories = plan.items.length - items.length;
  log(`mode: ${situation.mode ?? "unknown"} (${situation.why}); ${items.length} to post, ${held.length} held by the daily limit${stories ? `, ${stories} stor${stories === 1 ? "y is" : "ies are"} for Instagram only` : ""}`);

  for (const h of held) {
    log(`held by the daily limit: ${h.kind} ${h.dedupe}`);
    await query("INSERT OR IGNORE INTO fb_posts (ts, day, kind, format, situation, dedupe_key, mode, status, caption) VALUES (?, ?, ?, 'photo', ?, ?, ?, 'held', ?)", [now, day, h.kind, situation.mode ?? "unknown", `held:${h.dedupe}`, g.mode, `(held by daily limit) ${h.label}`]);
  }
  if (held.length && meta.heldNoteDay !== day) {
    const cap = situation.mode === "disaster" ? cfg.feedMaxDisaster : IG_DEFAULTS.otherMax;
    await noteAs("held", "info")(`:information_source: Facebook: ${held.length} post${held.length === 1 ? "" : "s"} held back by the daily limit (${cap} post${cap === 1 ? "" : "s"} a day). (This note comes once a day.)`);
    meta.heldNoteDay = day;
    metaDirty = true;
  }

  const langs = langsOf(env);
  const fallback = noPicture(env);
  const runId = o.runId ?? randomUUID();
  const total = items.length;
  let posted = 0, failed = 0, blocked = false;
  for (const [i, item] of items.entries()) {
    if (blocked) break;
    const link = pageLink(site, item);
    const c = link ? composeFbCaption(item.cap, { link, langs }) : null;
    const bad = c ? validateFbCaption(c.text, { link: link.url, site }) : ["no page of the site matches this post"];
    const url = imageUrl(site, item);
    const key = item.dedupe;
    // claim first: from here on this key belongs to this run, and no other run will ever send it
    const mine = await claim({ ts: now, day, kind: item.kind, situation: situation.mode, dedupe: key, mode: g.mode, caption: c?.text ?? `(not composed) ${item.label}`, url, link: link?.url ?? null, claim: `${runId}:${i}` }, query);
    if (!mine) {
      log(`already handled (posted, shown, failed or in flight): ${key}`);
      continue;
    }
    if (bad.length) {
      // recorded, so it is said once and the rules move on (a calm post that fails here would otherwise be picked again every run)
      failed++;
      await query("UPDATE fb_posts SET status = 'failed', error = ? WHERE dedupe_key = ?", [`checks: ${bad.join("; ")}`.slice(0, 300), key]);
      await noteAs("post-failed", "warn")(`:warning: Facebook: a ${item.kind} post was NOT sent because it failed its own checks: ${bad.join("; ")}`);
      continue;
    }
    const pic = await fetchJpeg(url, doFetch);
    const asLink = !pic.ok && fallback === "link";
    if (!live) {
      const check = pic.ok ? kb(pic) : `NOT available (${pic.why}): a live run would ${asLink ? "send this as a link post without the picture" : "skip this post"}`;
      await noteAs("dry-run", "info")(dryRunMessage({ n: i + 1, of: total, item, caption: c.text, url, check, situation, reason: g.reason, how: asLink ? "link" : "photo" }));
      await query("UPDATE fb_posts SET status = 'dry', format = ? WHERE dedupe_key = ?", [asLink ? "link" : "photo", key]);
      posted++;
      continue;
    }
    if (!pic.ok && !asLink) {
      failed++;
      await query("UPDATE fb_posts SET status = 'failed', error = ? WHERE dedupe_key = ?", [`picture: ${pic.why}`, key]);
      await noteAs("media-missing", "warn")(`:warning: Facebook post skipped: its picture could not be fetched (${pic.why}): ${item.label}`);
      continue;
    }
    // the ONE request for this post. Whatever comes back, it is never sent again.
    const r = asLink ? await publishFeed(g.keys, { message: c.text, link: link.url }, { doFetch, now, env }) : await publishPhoto(g.keys, { imageUrl: url, caption: c.text }, { doFetch, now, env });
    if (!r.ok) {
      failed++;
      await query("UPDATE fb_posts SET status = 'failed', format = ?, error = ? WHERE dedupe_key = ?", [asLink ? "link" : "photo", r.detail, key]);
      await noteAs("post-failed", "error")(`:rotating_light: Facebook post failed (${r.detail}); skipped, not retried.${r.pauseUntilMs ? ` Posting is paused until ${new Date(r.pauseUntilMs).toISOString()}.` : ""}\n${quote(c.en)}`);
      if (r.pauseUntilMs) {
        meta.pauseUntil = r.pauseUntilMs;
        meta.pauseWhy = r.detail;
        metaDirty = true;
        blocked = true; // an account-wide problem: the rest of this run would fail the same way
      }
      continue;
    }
    await query("UPDATE fb_posts SET status = 'posted', format = ?, post_id = ?, photo_id = ? WHERE dedupe_key = ?", [asLink ? "link" : "photo", r.postId, r.photoId, key]);
    log(`posted ${item.label}`);
    posted++;
  }

  if (metaDirty) await saveValue("meta", meta, now, query);
  // A pause that started in this run leaves the memory as it was (as a run during the pause does): what was not sent is
  // planned again once the pause is over, if it is still true then. The post that failed keeps its key and is not among them.
  if (blocked) log("a pause started: the memory is left as it was, so the posts not sent are looked at again after it");
  else await saveValue("main", state, now, query);
  log(`posts ${posted}${live ? "" : " (dry run)"}, failed ${failed}, held ${held.length}`);
  return { mode: g.mode, situation: situation.mode, posted, failed, held: held.length, stories };
}

// ---- samples -------------------------------------------------------------------------------------------------------

/** One example of each kind of feed post that today's data allows, built by the engine's own keep-alive rules. */
export function sampleItems(snap) {
  const { day } = colomboDay(snap.now);
  const us = (snap.stations ?? []).filter((s) => tierLevel(s.status) != null && s.observedAt && s.status !== "stale" && s.status !== "none");
  const out = [{ format: "feed", kind: "weather_morning", label: "Rivers right now + rain outlook (weather-alert day)", media: { kind: "home", slug: "now" }, cap: { type: "home", home: { atAlert: us.filter((s) => tierLevel(s.status) >= 2).length, nearAlert: us.filter((s) => s.status === "watch").length, assessed: us.length, rain: snap.rain ?? null, weather: true } } }];
  const types = ["rain", "reservoirs", "river", "survey", "embed"];
  for (const type of types.slice(0, 4)) {
    // "posted just now" for every other type makes the engine choose this one, if today's data allows it
    const it = calmItem(snap, { keepWeek: 0, lastKeepMs: null, lastByType: Object.fromEntries(types.filter((t) => t !== type).map((t) => [t, snap.now])) }, IG_DEFAULTS, day, 12 * 60);
    if (it && it.kind === `keepalive:${type}`) out.push(it);
  }
  return out;
}

/** Sample posts to Slack only, from today's real data. Touches no memory, never posts. Off when FB_MODE is off. */
export async function sample(o = {}) {
  const env = o.env ?? {};
  const log = o.log ?? console.log;
  const g = gate(env);
  log(`gate: ${g.mode} (${g.reason})`);
  if (g.mode === "off") {
    log(OFF_LINE);
    return [];
  }
  needs(o, ["doFetch"]);
  const { doFetch } = o;
  const now = o.now ?? Date.now();
  const site = env.SITE_URL || SITE_DEFAULT;
  const snap = o.snap ?? (await buildSnapshot({ site, now, doFetch, query: async () => [] }));
  if (!snap.stations) throw new Error("the site's levels could not be read");
  const langs = langsOf(env);
  const items = sampleItems(snap);
  const out = [];
  for (const [i, item] of items.entries()) {
    const link = pageLink(site, item);
    const c = link ? composeFbCaption(item.cap, { link, langs }) : null;
    const bad = c ? validateFbCaption(c.text, { link: link.url, site }) : ["no page of the site matches this post"];
    if (bad.length) throw new Error(`${item.label}: failed its checks: ${bad.join("; ")}`);
    const url = imageUrl(site, item);
    const pic = await fetchJpeg(url, doFetch);
    const msg = dryRunMessage({ n: i + 1, of: items.length, item, caption: c.text, url, check: pic.ok ? kb(pic) : `NOT available (${pic.why})`, situation: { mode: "sample", why: "one example of each kind of post, from today's real data" }, sample: true, reason: "Sample to show the wording, the picture and the link. The real Page posts only by the mode rules." });
    out.push({ item, caption: c.text, msg });
    await slack(msg, { env, doFetch, kind: "dry-run", severity: "info", log });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  if (val("--site")) process.env.SITE_URL = val("--site");
  const mode = val("--mode") ?? "run";
  if (mode !== "run" && mode !== "sample") {
    console.error("usage: node --experimental-strip-types --no-warnings scripts/fb-post.mjs [--mode run|sample] [--site URL]");
    process.exit(1);
  }
  if (mode === "run" && gate(process.env).mode !== "off" && !process.env.CLOUDFLARE_API_TOKEN) {
    console.warn("::warning::CLOUDFLARE_API_TOKEN is missing: the Facebook Page job keeps its memory in D1, so nothing is shown or posted.");
    process.exit(0);
  }
  const deps = { env: process.env, doFetch: fetch, query: d1Query, applySchema };
  (mode === "sample" ? sample(deps) : run(deps))
    .then((r) => {
      if (mode === "sample") for (const s of r) console.log(`\n${s.msg}`);
    })
    .catch((e) => {
      if (isD1ReadBlip(e) || (e instanceof D1HttpError && e.transient)) {
        console.warn(`::warning::fb-post skipped this run: D1 timed out (${e.message}). Nothing was posted; the next run looks again.`);
        process.exit(0);
      }
      console.error(`fb-post failed: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
