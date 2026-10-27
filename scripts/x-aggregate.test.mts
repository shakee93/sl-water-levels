// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/x-aggregate.test.mts
// One post per run: ordering (most severe first), the 280 limit and "+N more", long posts, the hold window, urgent bypass.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tweetLength, MAX_TWEET } from "../lib/xCompose.ts";
import { refreshEvents, newestReading, itemsOf, composeCombined, validateCombined, decide, capBatch, batchKey, isUrgentNow, MIN_GAP_MS } from "../lib/xAggregate.ts";
import { run, X_SCHEMA } from "./x-post.mjs";

const SITE = "https://waterlevels.lk";
const T0 = Date.parse("2026-10-27T00:34:00Z"); // 6:04 am Colombo
const AT = Date.parse("2026-10-27T00:46:00Z"); // 6:16 am
const gf = (station, river, tier, level, o = {}) => ({ station, river, tier, level, mark: 10, alertMark: 8, trend: "rising", nextHour: null, url: `${SITE}/${station}`, at: AT - 600_000, ...o });
const rise = (river, gauges, dedupe) => ({ type: "gauge_rise", kind: "alert", urgent: false, river, gauges, dedupe: dedupe ?? `rise:${river}`, priority: 22 });
const warning = { type: "warning", kind: "warning", urgent: true, priority: 40, dedupe: "w1", warning: { source: "Irrigation Department", severity: "minor flood", basins: ["Kelani Ganga"], issuedAt: AT - 3_600_000, releaseCusecs: null, bulletinUrl: "https://x/y", url: SITE } };
const summary = { type: "summary", kind: "morning", urgent: false, exempt: true, priority: 15, dedupe: "morning:2026-10-27", summary: { period: "morning", at: AT, reporting: 40, assessed: 38, atAlert: [{ station: "Holombuwa", tier: "alert" }], nearAlert: 3, rain: { mm: 85, place: "Ratnapura" }, fallen: null, rainWindowH: 24, spilling: 1, url: SITE } };
const clear = { type: "gauge_clear", kind: "clear", urgent: false, priority: 5, dedupe: "c1", gauges: [gf("Norwood", "Kelani Ganga", "normal", 4.2)] };

// ordering: warning, then Major, Minor, Alert, summary, all-clear
{
  const evs = [clear, summary, rise("Attanagalu Oya", [gf("Dunamale", "Attanagalu Oya", "alert", 8.3)]), rise("Kelani Ganga", [gf("Hanwella", "Kelani Ganga", "minor", 10.4), gf("Glencourse", "Kelani Ganga", "alert", 8.5)]), warning];
  const it = itemsOf(evs).map((i) => i.line);
  assert.match(it[0], /^Official minor flood warning/);
  assert.match(it[1], /^Minor flood: Kelani Ganga, Hanwella 10.4 ft, rising, Glencourse 8.5 ft/);
  assert.match(it[2], /^Alert: Attanagalu Oya/);
  assert.match(it.at(-1), /^All clear/);
  const c = composeCombined(evs, { now: AT });
  assert.ok(c.text.startsWith("Water levels, 6:16 am"), c.text);
  assert.ok(c.text.includes("Emergency: 117."), "a Minor flood item brings the closing");
  assert.deepEqual(validateCombined(c.text, evs, c.headAt, false), []);
  assert.ok(tweetLength(c.text) <= MAX_TWEET);
  // a rise and a storm update for the same river are ONE line
  const storm = { type: "storm", kind: "storm", priority: 25, dedupe: "s", storm: { river: "Kelani Ganga", at: AT, gauges: [gf("Hanwella", "Kelani Ganga", "minor", 10.6)], url: SITE } };
  assert.equal(itemsOf([evs[3], storm]).length, 1);
}
// length: many items keep the most severe and say how many are left; link counts 23; never a thread
{
  const many = Array.from({ length: 12 }, (_, i) => rise(`River ${i}`, [gf(`Gauge ${i}`, `River ${i}`, i === 7 ? "major" : "alert", 8.1 + i / 10)], `r${i}`));
  const c = composeCombined(many, { now: AT, link: SITE });
  assert.ok(tweetLength(c.text) <= MAX_TWEET, String(tweetLength(c.text)));
  assert.ok(c.shown < c.total && c.shown >= 1);
  assert.match(c.text, new RegExp(`\\+${c.total - c.shown} more on waterlevels.lk`));
  assert.ok(c.text.includes("Major flood: River 7"), "the most severe line survives the cut");
  assert.equal(c.text.split(SITE).length - 1, 1, "link once");
  assert.ok(c.text.trimEnd().endsWith(SITE));
  assert.deepEqual(validateCombined(c.text, many, c.headAt, false), []);
  // long posts (X Premium): everything fits, no "+N more"
  const l = composeCombined(many, { now: AT, link: SITE, long: true });
  assert.equal(l.shown, 12); assert.ok(!/more on/.test(l.text)); assert.ok(tweetLength(l.text) > MAX_TWEET);
  assert.deepEqual(validateCombined(l.text, many, l.headAt, true), []);
}
// held updates are refreshed from the current snapshot
{
  const OLD = AT - 45 * 60_000; // 5:31 am
  const held = [rise("Maha Oya", [gf("Holombuwa", "Maha Oya", "alert", 8.6, { at: OLD })], "h1"), rise("Attanagalu Oya", [gf("Dunamale", "Attanagalu Oya", "alert", 8.3, { at: OLD })], "h2"), rise("Kelani Ganga", [gf("Hanwella", "Kelani Ganga", "alert", 8.4, { at: OLD })], "h3")];
  const fresh = [
    { station: "Holombuwa", river: "Maha Oya", status: "alert", level: 9.2, unit: "ft", trend: "rising", observedAt: new Date(AT - 300_000).toISOString(), nextHour: null }, // current level replaces 8.6
    { station: "Dunamale", river: "Attanagalu Oya", status: "normal", level: 6.1, unit: "ft", trend: "falling", observedAt: new Date(AT - 300_000).toISOString(), nextHour: null }, // dropped below: line dropped
  ]; // Hanwella: no fresh reading
  const r = refreshEvents(held, fresh);
  assert.equal(r.length, 2, "the dropped one is gone");
  const c = composeCombined(r, { now: AT });
  assert.match(c.text, /Holombuwa 9\.2 ft/); assert.ok(!/8\.6/.test(c.text), "the old level is not shown");
  assert.ok(!/Dunamale/.test(c.text));
  assert.match(c.text, new RegExp(`Hanwella 8\\.4 ft at ${"5:31 am"}`), c.text); // no fresh reading: kept, with its time
  assert.ok(c.text.startsWith("Water levels, 6:11 am"), "heading = newest reading: " + c.text);
  assert.equal(newestReading(r), AT - 300_000);
  assert.deepEqual(validateCombined(c.text, r, c.headAt, false), [], "number guard against the refreshed facts");
  // the old level is not allowed any more
  assert.ok(validateCombined("Water levels, 6:11 am\nAlert: Maha Oya, Holombuwa 8.6 ft", r, c.headAt, false).length);
  // snapshot unreadable: everything kept, all with their time
  const none = refreshEvents(held, null);
  assert.equal(none.length, 3); assert.match(composeCombined(none, { now: AT }).text, /Holombuwa 8\.6 ft at 5:31 am/);
  // an all-clear that is Alert again is dropped
  assert.equal(refreshEvents([clear], [{ station: "Norwood", river: "Kelani Ganga", status: "alert", level: 8.2, unit: "ft", trend: "rising", observedAt: new Date(AT).toISOString() }]).length, 0);
}
// a made-up number is caught
assert.ok(validateCombined("Water levels, 6:16 am\nAlert: X 99.9 ft", [rise("X", [gf("X", "X", "alert", 8.3)])], AT, false).length);

// hold window and urgency
{
  assert.equal(decide([], null, AT), "none");
  const a = rise("K", [gf("H", "K", "alert", 8.5)]);
  assert.equal(decide([a], AT - 20 * 60_000, AT), "defer", "routine update 20 min after a post waits");
  assert.equal(decide([a], AT - MIN_GAP_MS, AT), "send");
  assert.equal(decide([a], null, AT), "send");
  assert.equal(decide([a, summary], AT - 60_000, AT), "defer");
  const minor = rise("K", [gf("H", "K", "minor", 10.2)]);
  assert.ok(isUrgentNow(minor) && isUrgentNow(warning) && !isUrgentNow(a) && !isUrgentNow(clear));
  assert.equal(decide([a, minor], AT - 60_000, AT), "send", "urgent goes at once, with the rest");
  assert.equal(capBatch([a], 15, { dailyMax: 15, urgentMax: 40 }), false);
  assert.equal(capBatch([a, minor], 15, { dailyMax: 15, urgentMax: 40 }), true);
  assert.equal(capBatch([a, summary], 99, { dailyMax: 15, urgentMax: 40 }), true, "a summary is exempt");
  assert.equal(batchKey([a], 1), a.dedupe);
  assert.equal(batchKey([a, minor], 1), batchKey([minor, a], 1));
}

// ---- whole runs against a fake D1 / Slack / X
{
  const db = new DatabaseSync(":memory:");
  const query = async (sql, params = []) => { const s = db.prepare(sql); return /^\s*select/i.test(sql) ? s.all(...params) : (s.run(...params), []); };
  const calls = { x: [], slack: [] };
  const doFetch = async (url, init) => {
    if (url === "https://hooks.example/slack") { calls.slack.push(JSON.parse(init.body).text); return new Response("ok"); }
    if (String(url).startsWith("https://api.x.com/2/tweets")) { calls.x.push(JSON.parse(init.body)); return new Response(JSON.stringify({ data: { id: String(calls.x.length) } }), { status: 201 }); }
    return new Response("{}", { status: 404 });
  };
  const env = { SLACK_WEBHOOK_URL: "https://hooks.example/slack", X_POSTING: "live", X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" };
  const st = (id, station, river, status, level, now) => ({ id, station, river, status, level, unit: "ft", marks: { alert: 8, minor: 10, major: 12 }, trend: "rising", observedAt: new Date(now - 600_000).toISOString(), url: `${SITE}/${id}`, nextHour: null });
  const snapAt = (stations, now) => ({ now, site: SITE, stations, reservoirs: [], warnings: [], rain: null });
  const calm = (now) => [st("a/1", "Hanwella", "Kelani Ganga", "normal", 4, now), st("b/1", "Dunamale", "Attanagalu Oya", "normal", 3, now), st("c/1", "Holombuwa", "Maha Oya", "normal", 3, now)];
  const level = (now, over) => calm(now).map((s) => (over[s.id] ? { ...s, status: over[s.id][0], level: over[s.id][1] } : s));
  const R = (stations, now) => run({ env, doFetch, query, snap: snapAt(stations, now), now });
  await R(calm(T0 - 3_600_000), T0 - 3_600_000); // first sighting, nothing said
  // two rivers rise in the same run: ONE post, not two
  let r = await R(level(T0, { "a/1": ["alert", 8.4], "b/1": ["alert", 8.2] }), T0);
  assert.equal(r.posted, 1); assert.equal(calls.x.length, 1);
  assert.ok(/Hanwella/.test(calls.x[0].text) && /Dunamale/.test(calls.x[0].text), calls.x[0].text);
  // 15 min later another rises: held (a post went out < 45 min ago), nothing sent, remembered
  r = await R(level(T0 + 900_000, { "a/1": ["alert", 8.5], "b/1": ["alert", 8.2], "c/1": ["alert", 8.1] }), T0 + 900_000);
  assert.equal(r.posted, 0); assert.equal(calls.x.length, 1);
  // 50 min after the first post: the held one goes out, as its own single post
  r = await R(level(T0 + 3_000_000, { "a/1": ["alert", 8.5], "b/1": ["alert", 8.2], "c/1": ["alert", 8.1] }), T0 + 3_000_000);
  assert.equal(r.posted, 1); assert.equal(calls.x.length, 2);
  assert.ok(/Holombuwa/.test(calls.x[1].text), calls.x[1].text);
  // a Minor crossing right after: urgent, goes at once
  r = await R(level(T0 + 3_300_000, { "a/1": ["minor", 10.2], "b/1": ["alert", 8.2], "c/1": ["alert", 8.1] }), T0 + 3_300_000);
  assert.equal(r.posted, 1); assert.equal(calls.x.length, 3);
  assert.ok(/Minor flood level reached at Hanwella/.test(calls.x[2].text) && calls.x[2].text.includes("Emergency: 117."));
  assert.equal(calls.x.filter((p) => p.reply).length, 0, "never a thread");
}
console.log("x-aggregate tests passed");
