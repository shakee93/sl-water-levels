// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/x-aggregate.test.mts
// One post per run: ordering (most severe first), the 280 limit and "+N more", long posts, the hold window, urgent bypass.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tweetLength, MAX_TWEET } from "../lib/xCompose.ts";
import { refreshEvents, newestReading, groupsOf, composeCombined, validateCombined, decide, capBatch, batchKey, isUrgentNow, MIN_GAP_MS } from "../lib/xAggregate.ts";
import { run, X_SCHEMA } from "./x-post.mjs";

const SITE = "https://waterlevels.lk";
const T0 = Date.parse("2026-10-27T00:34:00Z"); // 6:04 am Colombo
const AT = Date.parse("2026-10-27T00:46:00Z"); // 6:16 am
const gf = (station, river, tier, level, o = {}) => ({ station, river, tier, level, mark: 10, alertMark: 8, trend: "rising", nextHour: null, url: `${SITE}/${station}`, at: AT - 600_000, ...o });
const rise = (river, gauges, dedupe) => ({ type: "gauge_rise", kind: "alert", urgent: false, river, gauges, dedupe: dedupe ?? `rise:${river}`, priority: 22 });
const warning = { type: "warning", kind: "warning", urgent: true, priority: 40, dedupe: "w1", warning: { source: "Irrigation Department", severity: "minor flood", basins: ["Kelani Ganga"], issuedAt: AT - 3_600_000, releaseCusecs: null, bulletinUrl: "https://x/y", url: SITE } };
const summary = { type: "summary", kind: "morning", urgent: false, exempt: true, priority: 15, dedupe: "morning:2026-10-27", summary: { period: "morning", at: AT, reporting: 40, assessed: 38, atAlert: [{ station: "Holombuwa", tier: "alert" }], nearAlert: 3, rain: { mm: 85, place: "Ratnapura" }, fallen: null, rainWindowH: 24, spilling: 1, url: SITE } };
const clear = { type: "gauge_clear", kind: "clear", urgent: false, priority: 5, dedupe: "c1", gauges: [gf("Norwood", "Kelani Ganga", "normal", 4.2)] };

// wording: plain sentences, most severe first, rivers at the same step share a sentence
{
  const evs = [clear, summary, rise("Attanagalu Oya", [gf("Dunamale", "Attanagalu Oya", "alert", 8.3)]), rise("Maha Oya", [gf("Holombuwa", "Maha Oya", "alert", 8.6)]), rise("Kelani Ganga", [gf("Hanwella", "Kelani Ganga", "minor", 10.4), gf("Glencourse", "Kelani Ganga", "alert", 8.5)]), warning];
  const c = composeCombined(evs, { now: AT });
  assert.match(c.text, /^6:16 am: The Irrigation Department has issued a minor flood warning for the Kelani\. The Kelani is in minor flood at Hanwella \(10\.4 ft\) and still rising\./, c.text);
  assert.ok(c.text.endsWith("Near these rivers? Move valuables up. Emergency: 117."), c.text);
  assert.ok(!/#/.test(c.text));
  assert.deepEqual(validateCombined(c.text, evs, c.headAt, false), []);
  assert.ok(tweetLength(c.text) <= MAX_TWEET);
  const room = composeCombined(evs.slice(2, 5), { now: AT });
  assert.ok(room.text.includes("The Maha Oya at Holombuwa (8.6 ft) and the Attanagalu Oya at Dunamale (8.3 ft) have reached alert level."), room.text);
  // calm summary: no action line; one alert: action line, no emergency closing; all-clear: neither
  const none = { ...summary, summary: { ...summary.summary, atAlert: [] } };
  const c0 = composeCombined([none], { now: AT });
  assert.ok(/Good morning\. All 38 river gauges are below alert level/.test(c0.text) && !/Move valuables|117/.test(c0.text), c0.text);
  const c1 = composeCombined([rise("Maha Oya", [gf("Holombuwa", "Maha Oya", "alert", 8.6)])], { now: AT });
  assert.ok(/has reached alert level and is still rising\. Near this river\? Move valuables up\.$/.test(c1.text) && !/117/.test(c1.text), c1.text);
  const cc = composeCombined([clear], { now: AT });
  assert.ok(/The Kelani is back below alert level at Norwood \(4\.2 ft\)/.test(cc.text) && !/Move valuables|117/.test(cc.text), cc.text);
  // what was cut is said: rain only, one river, mixed
  const rain = { type: "rainwatch", kind: "storm", priority: 24, dedupe: "rw", rainwatch: { mm: 85, place: "Ratnapura", windowH: 24, atAlert: 1, at: AT, url: SITE } };
  const base = [rise("Maha Oya", [gf("Holombuwa", "Maha Oya", "alert", 8.6)])];
  const fit = composeCombined([...base, rain], { now: AT });
  assert.ok(/Heavy rain is forecast/.test(fit.text));
  const cutRain = composeCombined([...base, rain, rise("Attanagalu Oya", [gf("Dunamale", "Attanagalu Oya", "alert", 8.3)], "z")], { now: AT, link: SITE });
  assert.ok(/(Rain outlook on waterlevels\.lk\.|Heavy rain)/.test(cutRain.text), cutRain.text);
  // a rise and a storm update for the same river are ONE sentence
  const storm = { type: "storm", kind: "storm", priority: 25, dedupe: "s", storm: { river: "Kelani Ganga", at: AT, gauges: [gf("Hanwella", "Kelani Ganga", "minor", 10.6)], url: SITE } };
  assert.equal(groupsOf([evs[4], storm]).length, 1);
}
// length: many rivers keep the most severe and say how many are left; link counts 23; never a thread
{
  const many = Array.from({ length: 12 }, (_, i) => rise(`River ${i} Oya`, [gf(`Gauge ${i}`, `River ${i} Oya`, i === 7 ? "major" : "alert", 8.1 + i / 10)], `r${i}`));
  const c = composeCombined(many, { now: AT, link: SITE });
  assert.ok(tweetLength(c.text) <= MAX_TWEET, String(tweetLength(c.text)));
  assert.ok(c.shown < c.total && c.shown >= 1);
  assert.match(c.text, new RegExp(`${c.total - c.shown} more rivers at alert level on waterlevels.lk\\.`));
  assert.ok(c.text.includes("River 7 Oya is in major flood at Gauge 7 (8.8 ft)"), "the most severe survives the cut: " + c.text);
  assert.equal(c.text.split(SITE).length - 1, 1, "link once");
  assert.ok(c.text.trimEnd().endsWith(SITE));
  assert.deepEqual(validateCombined(c.text, many, c.headAt, false), []);
  // long posts (X Premium): short paragraphs, at most 10 rivers named, soft target ~700, "and N more rivers"
  const l = composeCombined(many, { now: AT, link: SITE, long: true });
  assert.equal(l.shown, 10); assert.ok(tweetLength(l.text) > MAX_TWEET && tweetLength(l.text) <= 760, String(tweetLength(l.text)));
  assert.match(l.text, /\.\.\.and 2 more rivers at alert level or higher, see waterlevels\.lk\./);
  assert.ok(l.text.split("\n\n").length >= 3, "paragraphs: flood, alerts, action");
  assert.deepEqual(validateCombined(l.text, many, l.headAt, true), []);
  const ls = composeCombined(many.slice(0, 2), { now: AT, long: true });
  assert.ok(!/more/.test(ls.text));
}
// held updates are refreshed from the current snapshot
{
  const OLD = AT - 45 * 60_000; // 5:31 am
  const held = [rise("Maha Oya", [gf("Holombuwa", "Maha Oya", "alert", 8.6, { at: OLD })], "h1"), rise("Attanagalu Oya", [gf("Dunamale", "Attanagalu Oya", "alert", 8.3, { at: OLD })], "h2"), rise("Kelani Ganga", [gf("Hanwella", "Kelani Ganga", "alert", 8.4, { at: OLD })], "h3")];
  const fresh = [
    { station: "Holombuwa", river: "Maha Oya", status: "alert", level: 9.2, unit: "ft", trend: "rising", observedAt: new Date(AT - 300_000).toISOString(), nextHour: null },
    { station: "Dunamale", river: "Attanagalu Oya", status: "normal", level: 6.1, unit: "ft", trend: "falling", observedAt: new Date(AT - 300_000).toISOString(), nextHour: null },
  ];
  const r = refreshEvents(held, fresh);
  assert.equal(r.length, 2, "the dropped one is gone");
  const c = composeCombined(r, { now: AT });
  assert.match(c.text, /Holombuwa \(9\.2 ft\)/); assert.ok(!/8\.6/.test(c.text), "the old level is not shown");
  assert.ok(!/Dunamale/.test(c.text));
  assert.match(c.text, /Hanwella \(8\.4 ft at 5:31 am\)/, c.text);
  assert.ok(c.text.startsWith("6:11 am:"), "heading = newest reading: " + c.text);
  assert.equal(newestReading(r), AT - 300_000);
  assert.deepEqual(validateCombined(c.text, r, c.headAt, false), []);
  assert.ok(validateCombined("6:11 am: The Maha Oya at Holombuwa (8.6 ft) has reached alert level.", r, c.headAt, false).length);
  const none = refreshEvents(held, null);
  assert.equal(none.length, 3); assert.match(composeCombined(none, { now: AT }).text, /Holombuwa \(8\.6 ft at 5:31 am\)/);
  assert.equal(refreshEvents([clear], [{ station: "Norwood", river: "Kelani Ganga", status: "alert", level: 8.2, unit: "ft", trend: "rising", observedAt: new Date(AT).toISOString() }]).length, 0);
}
// a made-up number is caught
assert.ok(validateCombined("6:16 am: The Kelani at X (99.9 ft) has reached alert level.", [rise("Kelani Ganga", [gf("X", "Kelani Ganga", "alert", 8.3)])], AT, false).length);

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
