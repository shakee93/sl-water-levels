// "Flood news" push alert (opt-in, off by default): which news stories to tell ONE subscriber about on this check.
// Pure: no I/O, no clock, so scripts/push-news.test.mts can drive it. Used by scripts/push-notify.mjs, which reads the
// stories from the site's own /api/news (the same 10-minute cached fetch the /news page uses; no new news-site request).
//
// The rules (documented in DOCS.md "Flood news alert"):
//   - only stories our keyword classifier said "yes" to by itself (lib/newsClassify.ts; `sure`), never a model-confirmed
//     borderline one; a bare "rain" story needs a heavy-rain / flood / warning word, a "cyclone" tag needs a storm word;
//   - the same story from two outlets is one alert (title word overlap), and the same story is never sent twice to a person;
//   - never older than 3 hours at send time, and never older than the moment the person switched the alert on;
//   - at most 4 a day and 2 per check, per person (Colombo day);
//   - quiet hours 22:00-06:00 Colombo (plus the person's own quiet hours): DROPPED, not queued. A story published in the
//     night is still sent after 06:00 if it is then under 3 hours old; anything older is on /news only;
//   - "mine" scope: only stories that name one of the person's pinned towns, or the river their gauge sits on.
// The memory lives in the subscriber's existing push_prefs.state JSON under `nw`: { since, d, n, s: [{ i: id, t: title key, m: ms }] }.
import { colombo, inQuiet, minutesOf } from "../lib/pushPrefs.ts";

export const NEWS_MAX_AGE_MS = 3 * 3_600_000;
export const NEWS_PER_DAY = 4;
export const NEWS_PER_CHECK = 2;
export const NEWS_QUIET = { from: "22:00", to: "06:00" };
const REMEMBER = 12;
const REMEMBER_MS = 48 * 3_600_000;
const SAME_WINDOW_MS = 12 * 3_600_000;
const SAME_STORY = 0.6;

const STOP = new Set("the a an of in on at to for and or as by with from is are was were be been after amid over due into near new says say said sri lanka lankan".split(" "));
const words = (title) =>
  String(title ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
/** A short, stable key of a headline (the words, sorted, joined): what we remember so a re-worded copy is recognised. */
export const titleKey = (title) => [...new Set(words(title))].sort().join(" ").slice(0, 160);

/** Do two headlines tell the same story? Word-set overlap (Jaccard) of at least 0.6 on the words that remain. */
export function sameStory(a, b) {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (x.size < 3 || y.size < 3) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= SAME_STORY;
}
const sameKey = (key, title) => {
  const x = new Set(String(key).split(" ").filter(Boolean)), y = new Set(words(title));
  if (x.size < 3 || y.size < 3) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= SAME_STORY;
};

const NOISE = /\b(exams?|examinations?|timetables?|alternative\s+dates|rescheduled|dengue|cricket|match)\b/i;

/** Is this story clear enough to wake a phone for? Conservative on purpose. */
export function newsWorthy(item) {
  if (!item || item.sure !== true) return false;
  const t = String(item.title ?? "");
  if (NOISE.test(t)) return false; // schedules and health stories that merely mention weather
  if (item.tag === "Rain") return /\b(heavy|torrential|intense)\b|\bflood|\bwarning|\bdisaster\b|\blandslide/i.test(t);
  if (item.tag === "Cyclone") return /cyclon|depression|storm/i.test(t);
  return true;
}

/** Colombo 22:00-06:00, fixed for news. */
export function newsQuiet(ms) {
  const m = colombo(ms).minutes;
  return m >= minutesOf(NEWS_QUIET.from) || m < minutesOf(NEWS_QUIET.to);
}

/** The towns and river basins of a subscriber's pinned places, from the site's answers (Glance.key "t:slug", Glance.basin). */
export function areasOf(keys, glances) {
  const towns = new Set(), rivers = new Set();
  for (const k of keys) {
    const bk = k.split("@")[0];
    if (bk.startsWith("t:")) towns.add(bk.slice(2));
    const g = glances.get(k) ?? glances.get(bk);
    if (g?.basin) rivers.add(String(g.basin).trim());
  }
  return { towns, rivers };
}

const touches = (item, areas) => (item.towns ?? []).some((t) => areas.towns.has(t)) || (item.rivers ?? []).some((r) => areas.rivers.has(String(r).trim()));

/**
 * @param prefs  Prefs (news, newsScope, quiet)
 * @param nw     this subscriber's stored news memory (state.nw) or null/undefined
 * @param items  [{ id, title, source, publishedAt, tag, sure, rivers, towns }] from /api/news, any order
 * @param areas  { towns:Set, rivers:Set } (areasOf); only read for scope "mine"
 * @returns { messages: [item], nw }  nw = null when the alert is off (the memory is dropped, so switching it on later starts fresh)
 */
export function evalNews({ prefs, nw, items, areas, now }) {
  if (!prefs.news) return { messages: [], nw: null };
  const { day } = colombo(now);
  const mem = {
    since: Number.isFinite(nw?.since) ? nw.since : now, // first look: nothing published before the switch was turned on
    d: day,
    n: nw?.d === day ? Number(nw?.n) || 0 : 0,
    s: (Array.isArray(nw?.s) ? nw.s : []).filter((e) => e && typeof e.i === "string" && now - Number(e.m) < REMEMBER_MS),
  };
  const messages = [];
  if (newsQuiet(now) || inQuiet(prefs, now) || mem.n >= NEWS_PER_DAY) return { messages, nw: mem };
  const cands = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.id === "string" && Number.isFinite(it.publishedAt))
    .filter((it) => newsWorthy(it) && now - it.publishedAt <= NEWS_MAX_AGE_MS && it.publishedAt - now <= 5 * 60_000 && it.publishedAt >= mem.since)
    .filter((it) => prefs.newsScope !== "mine" || touches(it, areas ?? { towns: new Set(), rivers: new Set() }))
    .sort((a, b) => b.publishedAt - a.publishedAt);
  const picked = [];
  for (const it of cands) {
    if (messages.length >= NEWS_PER_CHECK || mem.n + messages.length >= NEWS_PER_DAY) break;
    if (mem.s.some((e) => e.i === it.id || sameKey(e.t, it.title))) continue;
    if (picked.some((p) => Math.abs(p.publishedAt - it.publishedAt) < SAME_WINDOW_MS && sameStory(p.title, it.title))) continue;
    picked.push(it);
    messages.push(it);
  }
  for (const it of messages) mem.s.push({ i: it.id, t: titleKey(it.title), m: now });
  mem.n += messages.length;
  mem.s = mem.s.slice(-REMEMBER);
  return { messages, nw: mem };
}

/** Headline cut for a notification: at a word boundary, 90 characters at most. */
export function shortHeadline(title, max = 90) {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[\s,;:.-]+$/, "")}…`;
}

/** The sender's read of /api/news. Returns the items, or null when the site cannot say (nothing is sent then). */
export async function fetchNewsItems(site, doFetch = fetch) {
  try {
    const res = await doFetch(`${site}/api/news?hours=6`, { signal: AbortSignal.timeout(30_000), headers: { "Cache-Control": "no-cache" } });
    const j = await res.json();
    return res.ok && j.ok && Array.isArray(j.items) ? j.items : null;
  } catch {
    return null;
  }
}
