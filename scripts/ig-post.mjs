// The Instagram account (@waterlevels.lk): looks at the live site, decides the mode (disaster / weather / calm), picks what is worth
// posting, writes it, and either shows it to the owner in Slack (DRY RUN, the default) or publishes it (live). See DOCS.md "Instagram".
//
//   node --experimental-strip-types --no-warnings scripts/ig-post.mjs [--mode run|sample] [--site URL]
//     run     (default) one pass.
//     sample  composes sample posts from TODAY's real data and sends them to Slack as DRY RUN. Never posts, never touches the memory.
//
// The gate (lib/igClient.ts gate()): IG_MODE=off -> does nothing; IG_MODE=live with IG_ACCESS_TOKEN and IG_USER_ID -> publishes;
// anything else (the default, and a missing secret always) -> Slack only. A missing secret is announced once a day, not every run.
// Memory in D1 (ig_posts: every post and its status; ig_state: what was told per gauge, the all-clear holds, the day's morning post),
// so a re-run never says anything twice. A failed Instagram call is reported to Slack and skipped: never retried in a loop; an
// account-wide error (expired token, rate limit) also pauses posting for a while.
//
// Event detection is the X account's (scripts/x-engine.mjs, via scripts/ig-engine.mjs) and the snapshot is x-post's buildSnapshot.
// Env: SITE_URL, SLACK_WEBHOOK_URL, CLOUDFLARE_API_TOKEN (state), IG_MODE, IG_ACCESS_TOKEN, IG_USER_ID, IG_LANGS=en,si,ta,
//      IG_STORIES_MAX (20), IG_FEED_MAX (3), IG_KEEPALIVE_WEEK (3), IG_GRAPH_VERSION.
import { pathToFileURL } from "node:url";
import { d1Query, isD1ReadBlip } from "../lib/d1.ts";
import { gate, publishImage, publishingUsage, fetchJpeg, IG_LIMIT_24H } from "../lib/igClient.ts";
import { composeCaption, validateCaption } from "../lib/igCompose.ts";
import { colomboDay } from "../lib/xCompose.ts";
import { buildSnapshot } from "./x-post.mjs";
import { planIg, emptyIgState, imageUrl, IG_DEFAULTS, releasingCount } from "./ig-engine.mjs";
import { tierLevel } from "./x-engine.mjs";

export const IG_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS ig_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, format TEXT NOT NULL, situation TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, status TEXT NOT NULL, caption TEXT NOT NULL, image_url TEXT, container_id TEXT, media_id TEXT, error TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_ig_posts_day ON ig_posts (day)",
  "CREATE TABLE IF NOT EXISTS ig_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_ms INTEGER NOT NULL)",
];

const SITE_DEFAULT = "https://waterlevels.lk";
const DAY_MS = 86_400_000;
const log = (...a) => console.log(...a);

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

/** What the owner sees in Slack for one post that would have gone to Instagram. */
export function dryRunMessage({ n, of, item, caption, url, check, situation, reason, sample = false }) {
  const size = item.format === "story" ? "story 1080x1920" : "square feed post 1080x1080";
  return [
    `*${sample ? "SAMPLE, " : ""}DRY RUN: not posted to Instagram* (${n}/${of}) [${item.format}: ${item.label}] mode: ${situation.mode} (${situation.why})`,
    `_Image (JPEG, ${size}):_ ${url}${check ? `\n_Image check:_ ${check}` : ""}`,
    item.format === "story" ? "_Caption (Instagram shows no caption on a story; kept in the log):_" : "_Caption:_",
    quote(caption),
    reason ? `_${reason}_` : null,
  ].filter(Boolean).join("\n");
}

// ---- memory --------------------------------------------------------------------------------------------------------

async function loadValue(key, query) {
  const r = (await query("SELECT value FROM ig_state WHERE key = ?", [key]))[0];
  try { return r ? JSON.parse(String(r.value)) : null; } catch { return null; }
}
const saveValue = (key, v, now, query) => query("INSERT INTO ig_state (key, value, updated_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms", [key, JSON.stringify(v), now]);

/** Claims a dedupe key; false when another run already took it. */
async function claim(row, query) {
  const exists = (await query("SELECT id FROM ig_posts WHERE dedupe_key = ?", [row.dedupe])).length > 0;
  if (exists) return false;
  await query("INSERT OR IGNORE INTO ig_posts (ts, day, kind, format, situation, dedupe_key, mode, status, caption, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?)", [row.ts, row.day, row.kind, row.format, row.situation, row.dedupe, row.mode, row.caption, row.url]);
  const mine = (await query("SELECT id, status FROM ig_posts WHERE dedupe_key = ?", [row.dedupe]))[0];
  return !!mine && mine.status === "claimed";
}

/** What the caps and the keep-alive rules need to know, counted from ig_posts (dry runs count like real posts, in their own mode). */
export async function loadContext(query, { day, mode, now }) {
  const counted = "status IN ('posted','dry')";
  const used = { story: 0, feed: 0 };
  for (const r of await query(`SELECT format, COUNT(*) AS n FROM ig_posts WHERE day = ? AND mode = ? AND ${counted} GROUP BY format`, [day, mode])) used[String(r.format) === "story" ? "story" : "feed"] = Number(r.n);
  const week = (await query(`SELECT COUNT(*) AS n FROM ig_posts WHERE mode = ? AND ${counted} AND kind LIKE 'keepalive:%' AND ts > ?`, [mode, now - 7 * DAY_MS]))[0];
  const last = (await query(`SELECT MAX(ts) AS t FROM ig_posts WHERE mode = ? AND ${counted} AND kind LIKE 'keepalive:%'`, [mode]))[0];
  const lastByType = {};
  for (const r of await query(`SELECT kind, MAX(ts) AS t FROM ig_posts WHERE mode = ? AND ${counted} AND kind LIKE 'keepalive:%' GROUP BY kind`, [mode])) lastByType[String(r.kind).slice("keepalive:".length)] = Number(r.t);
  return { used, keepWeek: Number(week?.n ?? 0), lastKeepMs: last?.t != null ? Number(last.t) : null, lastByType };
}

const langsOf = (env) => {
  const l = (env.IG_LANGS ?? "en,si,ta").split(",").map((s) => s.trim()).filter((s) => s === "en" || s === "si" || s === "ta");
  return l.length ? l : ["en", "si", "ta"];
};
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);

// ---- one run -------------------------------------------------------------------------------------------------------

/**
 * @param o.env     environment (gate, secrets, options)
 * @param o.snap    a snapshot (tests) or built from the site
 * @param o.query   D1 query function
 * @param o.doFetch fetch (Instagram, Slack, our own pictures): tests pass a fake, nothing real is ever called
 */
export async function run(o = {}) {
  const env = o.env ?? process.env;
  const doFetch = o.doFetch ?? fetch;
  const query = o.query ?? d1Query;
  const now = o.now ?? Date.now();
  const g = gate(env);
  log(`gate: ${g.mode} (${g.reason})`);
  if (g.mode === "off") return { mode: "off", posted: 0 };

  for (const s of IG_SCHEMA) await query(s);
  const day = colomboDay(now).day;
  const live = g.mode === "live";
  const site = env.SITE_URL || SITE_DEFAULT;
  const note = (t) => slack(t, { env, doFetch });
  const meta = (await loadValue("meta", query)) ?? {};

  if (live && meta.pauseUntil && now < meta.pauseUntil) {
    log(`paused until ${new Date(meta.pauseUntil).toISOString()} (${meta.pauseWhy ?? ""}): nothing posted, memory untouched`);
    return { mode: "live", paused: true, posted: 0 };
  }
  if (g.missing.length && meta.noteDay !== day) {
    await note(`:warning: Instagram posting: ${g.reason}. Posts are shown in this channel only (DRY RUN). To go live: add the GitHub secrets ${g.missing.join(", ")}, then set IG_MODE=live. See DOCS.md "Instagram". (This note comes once a day.)`);
    meta.noteDay = day;
    await saveValue("meta", meta, now, query);
  }

  const snap = o.snap ?? (await buildSnapshot({ site, now, doFetch, query }));
  if (!snap.stations && !snap.reservoirs) {
    log("the site could not be read: nothing to do (the health check reports it)");
    return { mode: g.mode, posted: 0, skipped: "site unreadable" };
  }

  const prev = (await loadValue("main", query)) ?? emptyIgState();
  const ctx = await loadContext(query, { day, mode: g.mode, now });
  const cfg = { storiesMax: num(env.IG_STORIES_MAX, IG_DEFAULTS.storiesMax), feedMaxDisaster: num(env.IG_FEED_MAX, IG_DEFAULTS.feedMaxDisaster), keepWeekMax: num(env.IG_KEEPALIVE_WEEK, IG_DEFAULTS.keepWeekMax) };
  const { situation, items, held, state } = planIg(snap, prev, ctx, cfg);
  log(`mode: ${situation.mode ?? "unknown"} (${situation.why}); ${items.length} to post, ${held.length} held by the daily limit`);

  for (const h of held) {
    log(`held by the daily limit: ${h.kind} ${h.dedupe}`);
    await query("INSERT OR IGNORE INTO ig_posts (ts, day, kind, format, situation, dedupe_key, mode, status, caption) VALUES (?, ?, ?, ?, ?, ?, ?, 'held', ?)", [now, day, h.kind, h.format, situation.mode ?? "unknown", `held:${h.dedupe}:${now}`, g.mode, `(held by daily limit) ${h.label}`]);
  }
  if (held.length) await note(`:information_source: Instagram: ${held.length} post(s) held back by the daily limit (${situation.mode === "disaster" ? `${cfg.storiesMax} stories + ${cfg.feedMaxDisaster} feed posts` : "1 post"} a day).`);

  // the API's own 50 a day: one read before the first live post; unreadable = trust our own caps
  let blocked = false;
  if (live && items.length) {
    const usage = await publishingUsage(g.keys, { doFetch, now, env });
    if (usage != null && usage + items.length > IG_LIMIT_24H) {
      await note(`:warning: Instagram says ${usage} of its 50 API posts in 24 h are used: nothing posted this run.`);
      blocked = true;
    }
  }

  const langs = langsOf(env);
  const total = items.length;
  let posted = 0, failed = 0;
  for (const [i, item] of items.entries()) {
    if (blocked) break;
    const feed = item.format === "feed";
    const c = composeCaption(item.cap, { feed, langs });
    const bad = validateCaption(c.text, { feed });
    if (bad.length) {
      await note(`:warning: Instagram: a ${item.kind} post was NOT sent because its caption failed its own checks: ${bad.join("; ")}`);
      continue;
    }
    const url = imageUrl(site, item);
    const mine = await claim({ ts: now, day, kind: item.kind, format: item.format, situation: situation.mode, dedupe: item.dedupe, mode: g.mode, caption: c.text, url }, query);
    if (!mine) {
      log(`already handled by another run: ${item.dedupe}`);
      continue;
    }
    const pic = await fetchJpeg(url, doFetch);
    if (!live) {
      const check = pic.ok ? `fetched, JPEG, ${Math.round(pic.bytes.length / 1024)} KB` : `NOT available (${pic.why}): a live run would skip this post`;
      await note(dryRunMessage({ n: i + 1, of: total, item, caption: c.text, url, check, situation, reason: g.reason }));
      await query("UPDATE ig_posts SET status = 'dry' WHERE dedupe_key = ?", [item.dedupe]);
      posted++;
      continue;
    }
    if (!pic.ok) {
      failed++;
      await query("UPDATE ig_posts SET status = 'failed', error = ?, dedupe_key = ? WHERE dedupe_key = ?", [`picture: ${pic.why}`, `${item.dedupe}#failed${now}`, item.dedupe]);
      await note(`:warning: Instagram post skipped: its picture could not be fetched (${pic.why}): ${url}`);
      continue;
    }
    const r = await publishImage(g.keys, { imageUrl: url, format: item.format, caption: feed ? c.text : undefined }, { doFetch, now, env });
    if (!r.ok) {
      failed++;
      await query("UPDATE ig_posts SET status = 'failed', error = ?, container_id = ?, dedupe_key = ? WHERE dedupe_key = ?", [`${r.stage}: ${r.detail}`, r.containerId, `${item.dedupe}#failed${now}`, item.dedupe]);
      await note(`:rotating_light: Instagram post failed at ${r.stage} (${r.detail}); skipped, not retried.${r.pauseUntilMs ? ` Posting is paused until ${new Date(r.pauseUntilMs).toISOString()}.` : ""}\n${quote(c.en)}`);
      if (r.pauseUntilMs) {
        meta.pauseUntil = r.pauseUntilMs;
        meta.pauseWhy = r.detail;
        blocked = true; // an account-wide problem: the rest of this run would fail the same way
      }
      continue;
    }
    await query("UPDATE ig_posts SET status = 'posted', container_id = ?, media_id = ? WHERE dedupe_key = ?", [r.containerId, r.mediaId, item.dedupe]);
    posted++;
  }

  if (meta.pauseUntil) await saveValue("meta", meta, now, query);
  await saveValue("main", state, now, query);
  log(`posts ${posted}${live ? "" : " (dry run)"}, failed ${failed}, held ${held.length}`);
  return { mode: g.mode, situation: situation.mode, posted, failed, held: held.length };
}

/** Sample posts from today's real data (one gauge story, the morning feed post, the keep-alive rain and reservoir posts), to Slack only. Touches no memory. */
export async function sample(o = {}) {
  const env = o.env ?? process.env;
  const doFetch = o.doFetch ?? fetch;
  const now = o.now ?? Date.now();
  const site = env.SITE_URL || SITE_DEFAULT;
  const snap = o.snap ?? (await buildSnapshot({ site, now, doFetch }));
  if (!snap.stations) throw new Error("the site's levels could not be read");
  const langs = langsOf(env);
  const us = snap.stations.filter((s) => tierLevel(s.status) != null && s.unit === "ft" && s.observedAt && typeof s.level === "number");
  const ratio = (s) => (s.marks?.alert ? s.level / s.marks.alert : 0);
  const top = us.slice().sort((a, b) => tierLevel(b.status) - tierLevel(a.status) || ratio(b) - ratio(a))[0];
  const slugOf = (u) => new URL(u).pathname.split("/").filter(Boolean).pop();
  const homeCap = (weather) => ({ type: "home", home: { atAlert: us.filter((s) => tierLevel(s.status) >= 2).length, nearAlert: us.filter((s) => s.status === "watch").length, assessed: us.length, rain: snap.rain ?? null, weather } });
  const res = (snap.reservoirs ?? []).filter((r) => (r.status === "spilling" || r.status === "releasing") && r.flow?.cusecs > 0).sort((a, b) => b.flow.cusecs - a.flow.cusecs);
  const items = [
    top && { format: "story", label: `${top.station} (disaster-mode story)`, kind: "gauge_rise", media: { kind: "gauge", slug: slugOf(top.url) }, cap: { type: "gauge_rise", gauge: { station: top.station, river: top.river, tier: top.status, level: top.level, trend: top.trend, nextHour: top.nextHour && typeof top.nextHour.level_ft === "number" ? { level: top.nextHour.level_ft } : null } } },
    { format: "feed", label: "Rivers right now + rain outlook (weather-alert day)", kind: "weather_morning", media: { kind: "home", slug: "now" }, cap: homeCap(true) },
    snap.fallen && { format: "feed", label: "Rain, last 24 hours (calm-day keep-alive)", kind: "keepalive:rain", media: { kind: "rain", slug: "now" }, cap: { type: "rain", rain: snap.fallen } },
    res[0] && { format: "feed", label: "Reservoirs spilling (calm-day keep-alive)", kind: "keepalive:reservoirs", media: { kind: "reservoirs", slug: "now" }, cap: { type: "reservoirs", reservoirs: { count: releasingCount(snap, colomboDay(snap.now ?? Date.now()).day), top: { name: res[0].name, cusecs: res[0].flow.cusecs, day: res[0].flow.day ?? res[0].readingDay ?? null } } } },
  ].filter(Boolean);
  const out = [];
  for (const [i, item] of items.entries()) {
    const c = composeCaption(item.cap, { feed: item.format === "feed", langs });
    const bad = validateCaption(c.text, { feed: item.format === "feed" });
    if (bad.length) throw new Error(`caption failed its checks: ${bad.join("; ")}`);
    const url = imageUrl(site, item);
    const pic = await fetchJpeg(url, doFetch);
    const check = pic.ok ? `fetched, JPEG, ${Math.round(pic.bytes.length / 1024)} KB` : `NOT available (${pic.why})`;
    const msg = dryRunMessage({ n: i + 1, of: items.length, item, caption: c.text, url, check, situation: { mode: "sample", why: "one example of each kind of post, from today's real data" }, sample: true, reason: "Sample to show the wording and pictures. The real account posts only by the mode rules." });
    out.push({ item, caption: c.text, msg });
    await slack(msg, { env, doFetch });
  }
  return out;
}

/**
 * The five first feed posts of a new account (owner, 28 Oct 2026: "add 5 posts and then start posting updates"), built from
 * today's data: rain in the last 24 h, reservoirs spilling, the two rivers highest above their marks, and "Rivers right now".
 * Published oldest-first so "Rivers right now" ends up first on the profile grid. Live only through the same gate as the
 * normal run (IG_MODE=live + both secrets); otherwise each goes to Slack as a dry run. Each is claimed in ig_posts under
 * seed:<kind>:<day>, so a second run the same day posts nothing again. `preview` builds and prints them, touching nothing.
 */
export function seedItems(snap) {
  const us = snap.stations.filter((s) => tierLevel(s.status) != null && s.unit === "ft" && s.observedAt && typeof s.level === "number");
  const ratio = (s) => (s.marks?.alert ? s.level / s.marks.alert : 0);
  const pathParts = (u) => new URL(u).pathname.split("/").filter(Boolean).filter((x) => x !== "si" && x !== "ta");
  const worst = us.slice().sort((a, b) => tierLevel(b.status) - tierLevel(a.status) || ratio(b) - ratio(a));
  const rivers = [];
  for (const s of worst) {
    if (tierLevel(s.status) < 2 || rivers.some((r) => r.river === s.river)) continue;
    rivers.push(s);
    if (rivers.length === 2) break;
  }
  const res = (snap.reservoirs ?? []).filter((r) => (r.status === "spilling" || r.status === "releasing") && r.flow?.cusecs > 0).sort((a, b) => b.flow.cusecs - a.flow.cusecs);
  const gauge = (s) => ({ station: s.station, river: s.river, tier: s.status, level: s.level, trend: s.trend, nextHour: s.nextHour && typeof s.nextHour.level_ft === "number" ? { level: s.nextHour.level_ft } : null });
  return [
    snap.fallen && { format: "feed", label: "Rain, last 24 hours", kind: "seed:rain", media: { kind: "rain", slug: "now" }, cap: { type: "rain", rain: snap.fallen } },
    res[0] && { format: "feed", label: "Reservoirs spilling", kind: "seed:reservoirs", media: { kind: "reservoirs", slug: "now" }, cap: { type: "reservoirs", reservoirs: { count: releasingCount(snap, colomboDay(snap.now ?? Date.now()).day), top: { name: res[0].name, cusecs: res[0].flow.cusecs, day: res[0].flow.day ?? res[0].readingDay ?? null } } } },
    ...rivers.slice().reverse().map((s) => ({ format: "feed", label: `${s.river} (${s.station}, ${s.status})`, kind: `seed:river:${pathParts(s.url)[0]}`, media: { kind: "river", slug: pathParts(s.url)[0] }, cap: { type: "gauge_rise", gauge: gauge(s) } })),
    { format: "feed", label: "Rivers right now", kind: "seed:home", media: { kind: "home", slug: "now" }, cap: { type: "home", home: { atAlert: us.filter((s) => tierLevel(s.status) >= 2).length, nearAlert: us.filter((s) => s.status === "watch").length, assessed: us.length, rain: snap.rain ?? null, weather: false } } },
  ].filter(Boolean);
}

export async function seed(o = {}) {
  const env = o.env ?? process.env;
  const doFetch = o.doFetch ?? fetch;
  const now = o.now ?? Date.now();
  const site = env.SITE_URL || SITE_DEFAULT;
  const preview = !!o.preview;
  const query = preview ? null : (o.query ?? d1Query);
  const g = gate(env);
  if (!preview && g.mode === "off") {
    log("gate: off: no seed posts");
    return [];
  }
  if (query) for (const s of IG_SCHEMA) await query(s);
  const snap = o.snap ?? (await buildSnapshot({ site, now, doFetch, query: query ?? undefined }));
  if (!snap.stations) throw new Error("the site's levels could not be read");
  const day = colomboDay(now).day;
  const langs = langsOf(env);
  const items = seedItems(snap);
  const out = [];
  for (const [i, item] of items.entries()) {
    const c = composeCaption(item.cap, { feed: true, langs });
    const bad = validateCaption(c.text, { feed: true });
    if (bad.length) throw new Error(`${item.label}: caption failed its checks: ${bad.join("; ")}`);
    const url = imageUrl(site, item);
    out.push({ item, caption: c.text, url });
    if (preview) continue;
    const dedupe = `${item.kind}:${day}`;
    if (!(await claim({ ts: now, day, kind: item.kind, format: "feed", situation: "seed", dedupe, mode: g.mode, caption: c.text, url }, query))) {
      log(`already posted today: ${dedupe}`);
      continue;
    }
    const pic = await fetchJpeg(url, doFetch);
    if (g.mode !== "live") {
      await slack(dryRunMessage({ n: i + 1, of: items.length, item, caption: c.text, url, check: pic.ok ? `fetched, JPEG, ${Math.round(pic.bytes.length / 1024)} KB` : `NOT available (${pic.why})`, situation: { mode: "seed", why: "the account's first posts" }, reason: g.reason }), { env, doFetch });
      await query("UPDATE ig_posts SET status = 'dry' WHERE dedupe_key = ?", [dedupe]);
      continue;
    }
    if (!pic.ok) {
      await query("UPDATE ig_posts SET status = 'failed', error = ?, dedupe_key = ? WHERE dedupe_key = ?", [`picture: ${pic.why}`, `${dedupe}#failed${now}`, dedupe]);
      await slack(`:warning: Instagram first post skipped: its picture could not be fetched (${pic.why}): ${url}`, { env, doFetch });
      continue;
    }
    const r = await publishImage(g.keys, { imageUrl: url, format: "feed", caption: c.text }, { doFetch, now, env });
    if (!r.ok) {
      await query("UPDATE ig_posts SET status = 'failed', error = ?, container_id = ?, dedupe_key = ? WHERE dedupe_key = ?", [`${r.stage}: ${r.detail}`, r.containerId, `${dedupe}#failed${now}`, dedupe]);
      await slack(`:rotating_light: Instagram first post failed at ${r.stage} (${r.detail}); the rest are not tried.`, { env, doFetch });
      break;
    }
    await query("UPDATE ig_posts SET status = 'posted', container_id = ?, media_id = ? WHERE dedupe_key = ?", [r.containerId, r.mediaId, dedupe]);
    log(`posted ${item.label} (${r.mediaId})`);
    await slack(`:camera: Instagram: posted "${item.label}" (first posts ${i + 1}/${items.length}).`, { env, doFetch });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  if (val("--site")) process.env.SITE_URL = val("--site");
  const mode = val("--mode") ?? "run";
  (mode === "sample" ? sample() : mode === "seed" ? seed() : mode === "seed-preview" ? seed({ preview: true }) : run())
    .then((r) => {
      if (mode === "sample") for (const s of r) console.log(`\n${s.msg}`);
      if (mode === "seed-preview") for (const s of r) console.log(`\n--- ${s.item.label}\n${s.url}\n${s.caption}`);
    })
    .catch(async (e) => {
      if (isD1ReadBlip(e)) {
        console.warn(`::warning::ig-post skipped this run: D1 timed out (${e.message}). Nothing was posted; the next run looks again.`);
        process.exit(0);
      }
      console.error(`ig-post failed: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
