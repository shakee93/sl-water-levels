// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/push-news.test.mts
// The opt-in "Flood news" push alert: which stories, de-duplication, 3 h freshness, 4 a day, quiet hours, scope "mine",
// and that the settings round-trip. Pure rules (scripts/push-news.mjs); nothing is sent.
import assert from "node:assert/strict";
import { parsePrefs, DEFAULT_PREFS } from "../lib/pushPrefs.ts";
import { pushText } from "../lib/i18n/return.ts";
import { evalNews, newsWorthy, sameStory, titleKey, newsQuiet, areasOf, shortHeadline, NEWS_PER_DAY, NEWS_PER_CHECK } from "./push-news.mjs";

const H = 3_600_000;
// 2026-10-27 10:00 Colombo = 04:30 UTC
const T0 = Date.parse("2026-10-27T04:30:00Z");
const on = parsePrefs({ news: true });
const item = (id, title, ago, o = {}) => ({ id, title, source: "Newswire", publishedAt: T0 - ago, tag: "River", sure: true, rivers: [], towns: [], reservoirs: [], ...o });
const noAreas = { towns: new Set(), rivers: new Set() };
const run = (prefs, nw, items, now, areas = noAreas) => evalNews({ prefs, nw, items, areas, now });

// ---- settings: off by default for everyone, scope defaults to all, bad values fall back
assert.equal(DEFAULT_PREFS.news, false);
assert.equal(DEFAULT_PREFS.newsScope, "all");
assert.equal(parsePrefs({ news: "yes", newsScope: "x" }).news, false);
assert.equal(parsePrefs({ news: true, newsScope: "mine" }).newsScope, "mine");
assert.deepEqual(parsePrefs({}), DEFAULT_PREFS);
assert.equal(run(DEFAULT_PREFS, null, [item("a", "Flood warning issued for Kelani river", 0)], T0).messages.length, 0, "off: nothing");
assert.equal(run(DEFAULT_PREFS, { since: 0, d: "x", n: 2, s: [] }, [], T0).nw, null, "off: the memory is dropped");

// ---- which stories
assert.equal(newsWorthy(item("a", "Flood warning for Kelani river", 0)), true);
assert.equal(newsWorthy(item("a", "Flood warning for Kelani river", 0, { sure: false })), false, "model-confirmed borderline never pushes");
assert.equal(newsWorthy(item("a", "Showers expected in the evening", 0, { tag: "Rain" })), false, "a bare rain story is too weak");
assert.equal(newsWorthy(item("a", "Heavy rain expected in Western Province", 0, { tag: "Rain" })), true);
assert.equal(newsWorthy(item("a", "Strong winds expected", 0, { tag: "Cyclone" })), false);
assert.equal(newsWorthy(item("a", "Cyclone forms in Bay of Bengal", 0, { tag: "Cyclone" })), true);
assert.equal(newsWorthy(item("a", "Floods: Alternative dates for O/L practical exams in Sabaragamuwa", 0)), false, "exam schedules are not flood news");
assert.equal(newsWorthy(null), false);

// ---- first look: nothing older than the moment it was switched on (no backlog)
let r = run(on, null, [item("a", "Spill gates of Kotmale opened", 1 * H)], T0);
assert.equal(r.messages.length, 0, "a story from before the switch was turned on is not 'new'");
assert.equal(r.nw.since, T0);
r = run(on, r.nw, [item("b", "Spill gates of Laxapana opened", 0)], T0 + 30 * 60_000);
assert.equal(r.messages.length, 1, "a story published after the switch, fresh at the next check, is sent");
assert.equal(r.messages[0].id, "b");

// ---- never twice: same id, and the same story re-worded by another outlet
const mem = r.nw;
r = run(on, mem, [item("b", "Spill gates of Laxapana opened", 0)], T0 + 60 * 60_000);
assert.equal(r.messages.length, 0, "same id");
r = run(on, mem, [item("c", "Laxapana spill gates opened", 0, { source: "Ada Derana" })], T0 + 60 * 60_000);
assert.equal(r.messages.length, 0, "the same story from another outlet is not sent again");
r = run(on, mem, [item("d", "Landslide warning for Kegalle and Ratnapura districts", 0)], T0 + 60 * 60_000);
assert.equal(r.messages.length, 1, "a different story is");
assert.equal(sameStory("Spill gates of Laxapana opened", "Laxapana spill gates opened"), true);
assert.equal(sameStory("Spill gates of Laxapana opened", "Landslide warning for Kegalle"), false);
assert.ok(titleKey("Spill gates of Laxapana opened").includes("laxapana"));

// two outlets in the SAME batch: one alert
const fresh = { since: T0 - 6 * H, d: "2026-10-27", n: 0, s: [] };
r = run(on, fresh, [item("n1", "Kelani river rising, residents warned of flooding", 20 * 60_000), item("n2", "Residents warned of flooding as Kelani river rising", 10 * 60_000, { source: "Daily Mirror" })], T0);
assert.equal(r.messages.length, 1, "two outlets, one story, one alert");

// ---- freshness: 3 hours at send time
r = run(on, fresh, [item("old", "Flood warning for Kalu Ganga", 3 * H + 60_000), item("ok", "Flood warning for Gin Ganga", 3 * H - 60_000)], T0);
assert.deepEqual(r.messages.map((m) => m.id), ["ok"]);
r = run(on, fresh, [item("future", "Flood warning for Nilwala", -30 * 60_000)], T0);
assert.equal(r.messages.length, 0, "a time in the future is a bad clock, not news");

// ---- cap: 2 per check, 4 per Colombo day, resets the next day
const many = [
  "Spill gates of Kotmale reservoir opened",
  "Landslide warning for Kegalle and Ratnapura",
  "Kelani river overflows near Hanwella",
  "Train services suspended after flooding in Galle",
  "Evacuation begins in Matara as Nilwala rises",
  "Cyclone forming over Bay of Bengal",
].map((t, i) => item("m" + i, t, i * 60_000, { tag: "Warning" }));
r = run(on, fresh, many, T0);
assert.equal(r.messages.length, NEWS_PER_CHECK, "at most 2 in one check");
assert.equal(r.messages[0].id, "m0", "newest first");
r = run(on, r.nw, many, T0 + 30 * 60_000);
assert.equal(r.messages.length, 2);
assert.equal(r.nw.n, NEWS_PER_DAY);
r = run(on, r.nw, [item("z", "Landslide in Badulla after heavy rain", 0, { publishedAt: T0 + 60 * 60_000 })], T0 + 60 * 60_000);
assert.equal(r.messages.length, 0, "5th of the day is held");
r = run(on, r.nw, [item("z2", "Landslide in Matale after heavy rain", 0, { publishedAt: T0 + 24 * H })], T0 + 24 * H);
assert.equal(r.messages.length, 1, "a new Colombo day starts again");
assert.equal(r.nw.n, 1);

// ---- quiet hours 22:00-06:00 Colombo: dropped; a night story still goes out after 06:00 while under 3 h old
assert.equal(newsQuiet(Date.parse("2026-10-27T16:30:00Z")), true, "22:00");
assert.equal(newsQuiet(Date.parse("2026-10-27T16:29:00Z")), false, "21:59");
assert.equal(newsQuiet(Date.parse("2026-10-27T00:29:00Z")), true, "05:59");
assert.equal(newsQuiet(Date.parse("2026-10-27T00:30:00Z")), false, "06:00");
const night = Date.parse("2026-10-26T20:00:00Z"); // 01:30 Colombo
const base = { since: night - 6 * H, d: "2026-10-27", n: 0, s: [] };
const nightStory = { ...item("night", "Heavy flood warning for Kelani river", 0), publishedAt: Date.parse("2026-10-27T00:00:00Z") }; // 05:30 Colombo
assert.equal(evalNews({ prefs: on, nw: base, items: [nightStory], areas: noAreas, now: Date.parse("2026-10-26T23:00:00Z") }).messages.length, 0, "04:30 Colombo: quiet");
assert.equal(evalNews({ prefs: on, nw: base, items: [nightStory], areas: noAreas, now: Date.parse("2026-10-27T00:30:00Z") }).messages.length, 1, "06:00 Colombo, story 30 min old: sent");
assert.equal(evalNews({ prefs: on, nw: base, items: [nightStory], areas: noAreas, now: Date.parse("2026-10-27T03:30:00Z") }).messages.length, 0, "09:00: older than 3 h, dropped");
// the person's own quiet hours also hold it
const ownQuiet = parsePrefs({ news: true, quiet: { from: "09:00", to: "11:00" } });
assert.equal(run(ownQuiet, fresh, [item("q", "Flood warning for Kelani", 0)], T0).messages.length, 0, "own quiet hours 09-11");

// ---- scope "mine"
const mine = parsePrefs({ news: true, newsScope: "mine" });
const glances = new Map([["t:wellampitiya", { key: "t:wellampitiya", basin: "Kelani Ganga" }], ["s:Hanwella", { key: "s:Hanwella", basin: "Kelani Ganga" }]]);
const areas = areasOf(["t:wellampitiya@3.4", "s:Hanwella"], new Map([["t:wellampitiya@3.4", glances.get("t:wellampitiya")], ...glances]));
assert.ok(areas.towns.has("wellampitiya") && areas.rivers.has("Kelani Ganga"));
const items = [
  item("k", "Flood warning for Kelani river", 0, { rivers: ["Kelani Ganga"] }),
  item("g", "Flood warning for Gin river", 0, { rivers: ["Gin Ganga"] }),
  item("w", "Flooding in Wellampitiya canals", 0, { towns: ["wellampitiya"] }),
  item("s", "Flood warning island-wide", 0),
];
assert.deepEqual(run(mine, fresh, items, T0, areas).messages.map((m) => m.id).sort(), ["k", "w"], "my river and my town only");
assert.equal(run(mine, fresh, items, T0, noAreas).messages.length, 0, "no readable places: nothing, never everything");
assert.equal(run(parsePrefs({ news: true }), fresh, items, T0, noAreas).messages.length, 2, "All: cap applies");

// ---- notification text: headline, source, labelled as news, not official; si/ta present
const m = pushText("en", "news", [], { headline: shortHeadline("Spill gates of Laxapana opened"), source: "Newswire" });
assert.match(m.title, /^News: /);
assert.match(m.body, /Newswire/);
assert.match(m.body, /not an official warning/);
for (const lang of ["si", "ta"]) {
  const t = pushText(lang, "news", [], { headline: "X", source: "Newswire" });
  assert.ok(t.title.includes("X") && t.body.includes("Newswire") && !/\{/.test(t.title + t.body), lang);
}
const long = shortHeadline("Heavy rain and flood warnings issued for the Western, Sabaragamuwa and Southern provinces as the depression intensifies over the sea");
assert.ok(long.length <= 90 && long.endsWith("…"));

console.log("push-news tests passed");
