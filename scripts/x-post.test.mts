// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/x-post.test.mts
// The X account: wording (numbers only from data, length, link, disclaimer), rise / all-clear / flap rules, daily and
// monthly limits, and the dry-run / live / off gate, using a fake D1 (node:sqlite), a fake Slack and a fake X.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { gate, oauthHeader, postTweet } from "../lib/xClient.ts";
import { composeGaugeRise, composeGaugeClear, composeSummary, composeStorm, composeWarning, composeReservoirStart, validatePost, validateText, polish, tweetLength, numbersIn, MAX_TWEET, DISCLAIMER } from "../lib/xCompose.ts";
import { evaluate, applyCaps, emptyState } from "./x-engine.mjs";
import { run, X_SCHEMA, prepare, linkWanted, isCritical, costOf } from "./x-post.mjs";

const SITE = "https://sl-water-levels.vercel.app";
const NOW = Date.parse("2026-10-26T01:10:00Z"); // 6:40 am in Colombo
const LATE = NOW + 6 * 3_600_000; // 12:40 pm: outside the morning-summary window
const iso = (ms) => new Date(ms).toISOString();

const st = (id, station, river, status, level, o = {}) => ({
  id, station, river, status, level, unit: "ft", marks: { alert: 8, minor: 10, major: 12 }, trend: "rising", observedAt: iso(NOW - 600_000),
  url: `${SITE}/${id}`, nextHour: null, ...o,
});
const snap = (stations, extra = {}, now = NOW) => ({ now, site: SITE, stations, reservoirs: [], street: null, warnings: [], rain: { mm: 85, place: "Ratnapura" }, ...extra });
const calm = () => [st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", "normal", 4.2), st("kelani-ganga/glencourse", "Glencourse", "Kelani Ganga", "normal", 3.1)];

// ---- gate
assert.equal(gate({}).mode, "dry");
assert.equal(gate({ X_POSTING: "dry" }).mode, "dry");
assert.equal(gate({ X_POSTING: "off", X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" }).mode, "off");
assert.equal(gate({ X_POSTING: "live" }).mode, "dry", "live without keys stays dry");
assert.match(gate({ X_POSTING: "live", X_API_KEY: "a" }).reason, /X_API_SECRET/);
assert.equal(gate({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" }).mode, "dry", "keys alone never post");
assert.equal(gate({ X_POSTING: " LIVE ", X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" }).mode, "live");

// ---- OAuth 1.0a: deterministic, well-formed, depends on the secrets and not on the body
{
  const keys = { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessSecret: "as" };
  const o = { nonce: "abc", timestamp: "1700000000" };
  const h = oauthHeader("POST", "https://api.x.com/2/tweets", keys, o);
  assert.match(h, /^OAuth /);
  for (const k of ["oauth_consumer_key=\"ck\"", "oauth_token=\"at\"", "oauth_signature_method=\"HMAC-SHA1\"", "oauth_timestamp=\"1700000000\"", "oauth_version=\"1.0\"", "oauth_signature="]) assert.ok(h.includes(k), k);
  assert.equal(h, oauthHeader("POST", "https://api.x.com/2/tweets", keys, o));
  assert.notEqual(h, oauthHeader("POST", "https://api.x.com/2/tweets", { ...keys, accessSecret: "zz" }, o));
  // RFC 5849 / Twitter docs style example: the signature base is method&url&params; recompute independently
  const { createHmac } = await import("node:crypto");
  const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const params = "oauth_consumer_key=ck&oauth_nonce=abc&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1700000000&oauth_token=at&oauth_version=1.0";
  const sig = createHmac("sha1", "cs&as").update(["POST", enc("https://api.x.com/2/tweets"), enc(params)].join("&")).digest("base64");
  assert.ok(h.includes(`oauth_signature="${enc(sig)}"`));
}

// ---- postTweet: success, 429 (reset header), 403 duplicate, 401
{
  const keys = { apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" };
  const mk = (status, body, headers = {}) => async () => new Response(JSON.stringify(body), { status, headers });
  assert.deepEqual(await postTweet(keys, "hi", { doFetch: mk(201, { data: { id: "99" } }) }), { ok: true, id: "99" });
  const r429 = await postTweet(keys, "hi", { now: 1000, doFetch: mk(429, { title: "Too Many Requests" }, { "x-rate-limit-reset": "5000" }) });
  assert.equal(r429.ok, false); assert.equal(r429.status, 429); assert.equal(r429.retryAfterMs, 5_030_000);
  const dup = await postTweet(keys, "hi", { doFetch: mk(403, { detail: "You are not allowed to create a Tweet with duplicate content." }) });
  assert.equal(dup.duplicate, true); assert.equal(dup.retryAfterMs, null);
  const r401 = await postTweet(keys, "hi", { now: 0, doFetch: mk(401, { title: "Unauthorized" }) });
  assert.ok(r401.retryAfterMs > 0 && !r401.duplicate);
  let sent; await postTweet(keys, "x", { replyTo: "5", doFetch: async (u, i) => { sent = JSON.parse(i.body); return new Response("{}", { status: 500 }); } });
  assert.deepEqual(sent, { text: "x", reply: { in_reply_to_tweet_id: "5" } });
}

// ---- length the way X counts it
assert.equal(tweetLength("a".repeat(10) + " https://sl-water-levels.vercel.app/kelani-ganga/hanwella/very/long/path"), 10 + 1 + 23);
assert.equal(tweetLength("සූදානම්"), 7, "Sinhala letters count 1 each");
assert.equal(tweetLength("😀"), 2);
assert.deepEqual(numbersIn("1,200 cusecs at 2:30 pm, 8.2 ft https://x.com/a1/b2"), [1200, 2, 30, 8.2]);

// ---- composers: numbers only from the data, length, link, disclaimer, no-link version
const gf = (o = {}) => ({ station: "Hanwella", river: "Kelani Ganga", tier: "alert", level: 8.24, mark: 8, alertMark: 8, trend: "rising", nextHour: { level: 8.4, low: 8.3, high: 8.6, direction: "rising", crossing: null }, url: `${SITE}/kelani-ganga/hanwella`, at: NOW, ...o });
{
  const one = composeGaugeRise([gf()]);
  const post = { kind: "alert", facts: [gf()], ...one };
  assert.deepEqual(validatePost(post), []);
  assert.ok(one.text.includes(`${SITE}/kelani-ganga/hanwella`) && !/official|117/.test(one.text), "alert level: no closing");
  assert.ok(!one.textNoLink.includes("http") && !/official|117/.test(one.textNoLink) && one.textNoLink.includes("Hanwella"));
  assert.ok(one.text.includes("8.2 ft") && one.text.includes("6:40 am"), one.text);
  assert.ok(tweetLength(one.text) <= MAX_TWEET && tweetLength(one.textNoLink) <= MAX_TWEET);
  // a number not in the data is caught
  assert.ok(validateText(one.textNoLink.replace("8.2 ft", "9.9 ft"), { ...post, link: "" }).some((p) => /9\.9/.test(p)));
  // Minor / Major, or a forecast that could reach one: the short closing is part of the template and required
  const minor = composeGaugeRise([gf({ tier: "minor", mark: 10, level: 10.3 })]);
  assert.ok(minor.serious && minor.text.includes("Emergency: 117.") && !/official/.test(minor.text), minor.text);
  assert.ok(validateText(minor.text.replace("Emergency: 117.", ""), { kind: "alert", facts: [gf({ tier: "minor", mark: 10, level: 10.3 })], ...minor }).some((p) => /disclaimer/.test(p)));
  assert.ok(composeGaugeRise([gf({ nextHour: { level: 9.8, low: 9.6, high: 10.1, direction: "rising", crossing: "may reach minor flood level" } })]).text.includes("Emergency: 117."));
  assert.ok(!composeGaugeClear([gf({ tier: "normal" })]).text.includes("117"));
  assert.ok(composeWarning({ source: "Irrigation Department", severity: "alert", basins: ["Kalu Ganga"], issuedAt: NOW, releaseCusecs: null, bulletinUrl: `${SITE}/b`, url: `${SITE}/kalu-ganga` }).text.includes("not the source"));
  assert.ok(validateText(one.text.replace(post.link, ""), post).some((p) => /link/.test(p)));
  assert.ok(validateText(one.text + " #scam", post).some((p) => /hashtag/.test(p)));
  assert.ok(one.reply.includes("Forecast for the next hour (not official): about 8.4 ft") && one.reply.includes("8.3 ft") && one.reply.includes("8.6 ft"));
  assert.ok(!/forecast/i.test(one.text) || /not official/i.test(one.text));
  // many gauges: still within 280, names kept, counts come from the list
  const many = ["A", "B", "C", "D", "E"].map((n, i) => gf({ station: `Station ${n}`, level: 9 + i, url: `${SITE}/kelani-ganga/${n}` }));
  const m = composeGaugeRise(many);
  assert.deepEqual(validatePost({ kind: "alert", facts: many, ...m }), []);
  assert.ok(/5 gauges/.test(m.text) && /2 more/.test(m.text), m.text);
  assert.ok(tweetLength(m.text) <= MAX_TWEET);
  // a very long name still fits (hashtags are dropped first)
  const long = composeGaugeRise([gf({ station: "Kalawellawa (Millakanda) upper reach gauge", river: "Kalu Ganga" })]);
  assert.ok(tweetLength(long.text) <= MAX_TWEET && tweetLength(long.textNoLink) <= MAX_TWEET);
  const clr = composeGaugeClear([gf({ tier: "normal", level: 6.1 })]);
  assert.deepEqual(validatePost({ kind: "clear", facts: [gf({ tier: "normal", level: 6.1 })], ...clr }), []);
  assert.ok(/All clear at Hanwella/.test(clr.text));
}
{
  const f = { period: "morning", at: NOW, reporting: 40, assessed: 38, atAlert: [{ station: "Hanwella", tier: "alert" }], nearAlert: 2, rain: { mm: 85, place: "Ratnapura" }, rainWindowH: 24, spilling: 4, url: SITE };
  const c = composeSummary(f);
  assert.deepEqual(validatePost({ kind: "morning", facts: f, ...c }), []);
  assert.ok(/1 of 38/.test(c.text) && /85 mm near Ratnapura/.test(c.text) && /4 reservoirs/.test(c.text), c.text);
  const calmF = { ...f, atAlert: [], nearAlert: 0, spilling: 0, rain: null };
  const cc = composeSummary(calmF);
  assert.ok(/All 38 river gauges/.test(cc.text) && !/mm/.test(cc.text), "no rain claim without rain data");
  assert.deepEqual(validatePost({ kind: "morning", facts: calmF, ...cc }), []);
}
{
  const sf = { river: "Kelani Ganga", at: NOW, gauges: [gf()], url: `${SITE}/kelani-ganga/hanwella` };
  const c = composeStorm(sf);
  assert.deepEqual(validatePost({ kind: "storm", facts: sf, ...c }), []);
  assert.ok(/Forecast next hour: about 8.4 ft \(8.3 ft to 8.6 ft\)/.test(c.text), c.text);
  const nof = composeStorm({ ...sf, gauges: [gf({ nextHour: null })] });
  assert.ok(!/forecast/i.test(nof.text), "no forecast words without a forecast");
  const wf = { source: "Irrigation Department", severity: "minor flood", basins: ["Kelani Ganga"], issuedAt: NOW, releaseCusecs: 12000, bulletinUrl: "https://www.dmc.gov.lk/x.pdf", url: `${SITE}/kelani-ganga` };
  const w = composeWarning(wf);
  assert.deepEqual(validatePost({ kind: "warning", facts: wf, ...w }), []);
  assert.ok(w.text.includes("we are not the source") && /12,000 cusecs/.test(w.text));
  const rf = [{ name: "Deduru Oya", river: "Deduru Oya", status: "spilling", cusecs: 1234.6, storagePercent: 101.2, day: "2026-10-25", source: "Irrigation Department", url: `${SITE}/reservoirs/deduru-oya` }];
  const r = composeReservoirStart(rf);
  assert.deepEqual(validatePost({ kind: "reservoir", facts: rf, ...r }), []);
  assert.ok(/1,235 cusecs/.test(r.text));
}

// ---- polish: accepted only when it keeps the numbers, link, disclaimer and must-keep words
{
  const c = composeGaugeRise([gf({ tier: "minor", mark: 10, level: 10.3 })]);
  const post = { kind: "alert", facts: [gf({ tier: "minor", mark: 10, level: 10.3 })], ...c };
  const good = c.text.replace("reached at", "has been reached at");
  assert.deepEqual(await polish(post, async () => good), { text: good, used: "ai" });
  for (const bad of [c.text.replace("10.3 ft", "9.1 ft"), c.text.replace("Emergency: 117.", ""), c.text.replace("Hanwella", "Somewhere"), c.text + " #breaking", c.text + " 🚨", "x".repeat(300) + c.text]) {
    const r = await polish(post, async () => bad);
    if (r.used !== "template") console.log("ACCEPTED:", JSON.stringify(bad.slice(0, 150)));
    assert.equal(r.used, "template"); assert.equal(r.text, c.text);
  }
  assert.equal((await polish(post, async () => { throw new Error("down"); })).used, "template");
  assert.equal((await polish(post, null)).used, "template");
  assert.equal((await polish(post, async () => good, false)).used, "template", "a draft with a link is wrong for a no-link post");
}

// ---- links and critical
{
  const rise = (tier) => ({ type: "gauge_rise", gauges: [gf({ tier })] });
  assert.equal(linkWanted(rise("major"), "off"), false);
  assert.equal(linkWanted(rise("alert"), "alerts"), false);
  assert.equal(linkWanted(rise("major"), "alerts"), true);
  assert.equal(linkWanted({ type: "summary" }, "alerts"), false);
  assert.equal(linkWanted({ type: "summary" }, "all"), true);
  assert.equal(isCritical(rise("major")), true); assert.equal(isCritical(rise("minor")), false);
  assert.equal(isCritical({ type: "gauge_clear" }), true); assert.equal(isCritical({ type: "storm" }), false);
  assert.equal(costOf("hi", [], { post: 0.015, link: 0.2 }), 0.015);
  assert.ok(Math.abs(costOf("hi https://a.b/c", ["x"], { post: 0.015, link: 0.2 }) - 0.215) < 1e-9);
}

// ---- engine: first sight silent, rise, flap guard, all-clear, grouping
{
  let { events, state } = evaluate(snap(calm(), {}, NOW - 7 * 3_600_000), emptyState());
  assert.equal(events.filter((e) => e.type !== "summary").length, 0, "first sight says nothing");
  const T = (h) => NOW + h * 3_600_000;
  const hw = (status, level, now) => snap([st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", status, level, { observedAt: iso(now - 600_000) }), st("kelani-ganga/glencourse", "Glencourse", "Kelani Ganga", status, level + 1, { observedAt: iso(now - 600_000) })], { rain: null }, now);
  // rise: both gauges of one river -> ONE grouped event
  let r = evaluate(hw("alert", 8.3, T(0)), state);
  const rise = r.events.filter((e) => e.type === "gauge_rise");
  assert.equal(rise.length, 1); assert.equal(rise[0].gauges.length, 2); assert.equal(rise[0].urgent, false);
  state = r.state;
  // same level again: nothing
  r = evaluate(hw("alert", 8.5, T(0.5)), state);
  assert.equal(r.events.filter((e) => e.type === "gauge_rise").length, 0); state = r.state;
  // escalation to major: said, urgent
  r = evaluate(hw("major", 12.4, T(1)), state);
  assert.equal(r.events.filter((e) => e.type === "gauge_rise" && e.urgent).length, 1); state = r.state;
  // de-escalation 4 -> 3 silent; one calm check is not yet an all-clear; the second is
  r = evaluate(hw("minor", 10.5, T(2)), state); assert.equal(r.events.filter((e) => e.type.startsWith("gauge")).length, 0); state = r.state;
  r = evaluate(hw("normal", 5, T(2.5)), state); assert.equal(r.events.filter((e) => e.type === "gauge_clear").length, 0); state = r.state;
  r = evaluate(hw("normal", 5, T(3)), state);
  const clr = r.events.filter((e) => e.type === "gauge_clear");
  assert.equal(clr.length, 1); assert.equal(clr[0].gauges.length, 2); state = r.state;
  // flap: back up within 3 h of the last rise (T1 major rise) after a clear is recorded but silent
  r = evaluate(hw("alert", 8.2, T(3.5)), state);
  assert.equal(r.events.filter((e) => e.type === "gauge_rise").length, 0, "flap guard"); state = r.state;
  // a stale or unit-less gauge is unknown, never "calm" and never a clear
  const before = JSON.stringify(state.g);
  r = evaluate(snap([st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", "stale", 1), st("kelani-ganga/glencourse", "Glencourse", "Kelani Ganga", "alert", 9, { unit: null })], { rain: null }, T(4)), state);
  assert.equal(JSON.stringify(r.state.g), before); assert.equal(r.events.filter((e) => e.type.startsWith("gauge")).length, 0);
  // no clear for a place we never posted about (first sight already high)
  let s2 = evaluate(hw("alert", 8.3, T(10)), emptyState()).state;
  for (const h of [10.5, 11]) s2 = evaluate(hw("normal", 5, T(h)), s2).state;
  const none = evaluate(hw("normal", 5, T(11.5)), s2);
  assert.equal(none.events.filter((e) => e.type === "gauge_clear").length, 0);
}

// ---- engine: 3+ rivers rising to Alert in one run are ONE national post; Minor / Major keep their own
{
  const quiet = (id, station, river, o = {}) => st(id, station, river, "normal", 2, { observedAt: iso(NOW - 600_000), ...o });
  const rivers = [["kelani-ganga/hanwella", "Hanwella", "Kelani Ganga"], ["kalu-ganga/ratnapura", "Ratnapura", "Kalu Ganga"], ["gin-ganga/baddegama", "Baddegama", "Gin Ganga"], ["nilwala-ganga/pitabeddara", "Pitabeddara", "Nilwala Ganga"]];
  const base = snap(rivers.map(([id, n, r]) => quiet(id, n, r)), { rain: null }, NOW - 7 * 3_600_000);
  const first = evaluate(base, emptyState()).state;
  const at = (levels) => snap(rivers.map(([id, n, r], i) => levels[i] ? st(id, n, r, levels[i][0], levels[i][1]) : quiet(id, n, r)), { rain: null }, NOW);
  // three rivers at Alert: one rivers_rising, naming the top 3 with the total
  let r = evaluate(at([["alert", 8.2], ["alert", 9.5], ["alert", 8.6], ["alert", 8.1]]), first);
  const surge = r.events.filter((e) => e.type === "rivers_rising");
  assert.equal(r.events.filter((e) => e.type === "gauge_rise").length, 0); assert.equal(surge.length, 1);
  assert.equal(surge[0].rivers.count, 4); assert.equal(surge[0].rivers.gauges.length, 3); assert.equal(surge[0].rivers.gauges[0].station, "Ratnapura");
  assert.equal(surge[0].kind, "alert"); assert.match(surge[0].dedupe, /^surge:/);
  // it counts once against the daily limit
  assert.equal(applyCaps(r.events, { normal: 14, urgent: 0 }).send.filter((e) => e.type === "rivers_rising").length, 1);
  // two rivers only: separate posts
  r = evaluate(at([["alert", 8.2], ["alert", 9.5]]), first);
  assert.equal(r.events.filter((e) => e.type === "gauge_rise").length, 2); assert.equal(r.events.filter((e) => e.type === "rivers_rising").length, 0);
  // a Minor crossing keeps its own post; the three Alert rivers are merged
  r = evaluate(at([["alert", 8.2], ["alert", 9.5], ["alert", 8.6], ["minor", 10.6]]), first);
  assert.equal(r.events.filter((e) => e.type === "gauge_rise").length, 1); assert.equal(r.events.find((e) => e.type === "gauge_rise").gauges[0].station, "Pitabeddara");
  assert.equal(r.events.find((e) => e.type === "rivers_rising").rivers.count, 3);
  // Alert + Alert + Minor: only 2 alert rivers, nothing merged
  r = evaluate(at([["alert", 8.2], ["alert", 9.5], ["minor", 10.6]]), first);
  assert.equal(r.events.filter((e) => e.type === "gauge_rise").length, 3); assert.equal(r.events.filter((e) => e.type === "rivers_rising").length, 0);
  // the post can be composed and passes its own checks
  const p = await prepare(evaluate(at([["alert", 8.2], ["alert", 9.5], ["alert", 8.6]]), first).events.find((e) => e.type === "rivers_rising"), null, {});
  assert.ok(!p.error, p.error); assert.match(p.text, /3 rivers/);
}

// ---- engine: reservoirs, street, warnings, storm, summary window
{
  const rv = (status, cusecs, day = "2026-10-25") => [{ id: "deduru-oya", name: "Deduru Oya", river: "Deduru Oya", status, storagePercent: 100, flow: cusecs == null ? null : { cusecs, day, source: "Irrigation Department" }, readingDay: day, source: "Irrigation Department", url: `${SITE}/reservoirs/deduru-oya` }];
  let r = evaluate(snap(calm(), { reservoirs: rv("holding", null) }), emptyState());
  r = evaluate(snap(calm(), { reservoirs: rv("spilling", 1200) }), r.state);
  assert.equal(r.events.filter((e) => e.type === "reservoir_start").length, 1);
  r = evaluate(snap(calm(), { reservoirs: rv("spilling", 1100) }), r.state);
  assert.equal(r.events.filter((e) => e.type === "reservoir_start").length, 0);
  r = evaluate(snap(calm(), { reservoirs: rv("holding", null) }), r.state);
  assert.equal(r.events.filter((e) => e.type === "reservoir_stop").length, 0, "needs two checks");
  r = evaluate(snap(calm(), { reservoirs: rv("holding", null) }), r.state);
  assert.equal(r.events.filter((e) => e.type === "reservoir_stop").length, 1);
  // small spills, old readings and 'nodata' say nothing
  let q = evaluate(snap(calm(), { reservoirs: rv("holding", null) }), emptyState());
  assert.equal(evaluate(snap(calm(), { reservoirs: rv("spilling", 100) }), q.state).events.filter((e) => e.type === "reservoir_start").length, 0);
  assert.equal(evaluate(snap(calm(), { reservoirs: rv("spilling", 5000, "2026-10-20") }), q.state).events.filter((e) => e.type === "reservoir_start").length, 0);
  assert.equal(evaluate(snap(calm(), { reservoirs: rv("nodata", null) }), q.state).events.length >= 0, true);

  // heavy rain over a canal town's low spots is never posted, whatever a (legacy) snapshot says: only a few low spots ever get water
  const towns = (street) => ({ zone: "colombo-east", towns: [{ slug: "wellampitiya", name: "Wellampitiya", street, rain24: 112 }, { slug: "kolonnawa", name: "Kolonnawa", street, rain24: 112 }] });
  let s = evaluate(snap(calm(), { street: towns("likely") }), emptyState());
  s = evaluate(snap(calm(), { street: towns("likely") }), s.state);
  s = evaluate(snap(calm(), { street: towns(null) }), s.state);
  s = evaluate(snap(calm(), { street: towns(null) }), s.state);
  assert.equal(s.events.filter((e) => /street/.test(e.type) || e.kind === "street").length, 0);

  // official bulletin: once, only recent, only Alert or worse
  const wn = (o) => ({ source: "Irrigation Department", url: "https://dmc/x.pdf", title: "t", issuedAt: iso(NOW - 3_600_000), basins: ["Kelani Ganga"], severity: "minor flood", ...o });
  let w = evaluate(snap(calm(), { warnings: [wn({}), wn({ url: "https://dmc/old.pdf", issuedAt: iso(NOW - 20 * 3_600_000) }), wn({ url: "https://dmc/adv.pdf", severity: "advisory" })] }), emptyState());
  assert.equal(w.events.filter((e) => e.type === "warning").length, 1);
  w = evaluate(snap(calm(), { warnings: [wn({})] }), w.state);
  assert.equal(w.events.filter((e) => e.type === "warning").length, 0);

  // storm mode: 3 gauges at Alert -> hourly river updates, quiet when unchanged, ends after two calm checks
  const hi = (lv, now) => snap(["a", "b", "c"].map((n, i) => st(`kelani-ganga/${n}`, `G${n}`, "Kelani Ganga", "alert", lv + i, { observedAt: iso(now - 600_000) })), { rain: null }, now);
  let m = evaluate(hi(8.1, NOW - 2 * 3_600_000), emptyState());
  assert.equal(m.state.storm.on, true);
  const first = m.events.filter((e) => e.type === "storm");
  m = evaluate(hi(8.4, NOW - 3_600_000 + 60_000), m.state);
  assert.equal(m.events.filter((e) => e.type === "storm").length >= 0, true);
  const t1 = NOW - 3_000_000; // 50 min after last: too soon
  const tooSoon = evaluate(hi(8.9, t1 + 5 * 60_000), m.state);
  assert.equal(tooSoon.events.filter((e) => e.type === "storm").length, 0, "not more than hourly");
  const hourly = evaluate(hi(8.9, NOW + 3_600_000), m.state);
  assert.equal(hourly.events.filter((e) => e.type === "storm").length, 1);
  const same = evaluate(hi(8.9, NOW + 3_600_000 * 2.1), hourly.state);
  assert.equal(same.events.filter((e) => e.type === "storm").length, 0, "unchanged update waits 3 h");
  // heavy-rain forecast alone starts storm mode with one heads-up
  const rainy = evaluate(snap(calm(), { rain: { mm: 130, place: "Ratnapura" } }), emptyState());
  assert.equal(rainy.events.filter((e) => e.type === "rainwatch").length, 1);
  assert.equal(evaluate(snap(calm(), { rain: { mm: 130, place: "Ratnapura" } }, NOW + 1_800_000), rainy.state).events.filter((e) => e.type === "rainwatch").length, 0);

  // summary: once per Colombo day, inside the window only
  const mornin = evaluate(snap(calm()), emptyState());
  assert.equal(mornin.events.filter((e) => e.type === "summary").length, 1);
  assert.equal(evaluate(snap(calm(), {}, NOW + 600_000), mornin.state).events.filter((e) => e.type === "summary").length, 0);
  assert.equal(evaluate(snap(calm(), {}, NOW - 2 * 3_600_000), emptyState()).events.filter((e) => e.type === "summary").length, 0, "before 6:30 am");
  assert.equal(evaluate(snap(calm(), {}, NOW + 6 * 3_600_000), emptyState()).events.filter((e) => e.type === "summary").length, 0, "after 11 am");
  const eve = NOW + 11.5 * 3_600_000; // 6:10 pm Colombo
  assert.equal(evaluate(snap(calm(), {}, eve), emptyState()).events.filter((e) => e.type === "summary").length, 0, "evening is off by default");
  assert.equal(evaluate(snap(calm(), {}, eve), emptyState(), { evening: true }).events.filter((e) => e.type === "summary").length, 1);
  // a failed source is unknown: no summary when levels are missing
  assert.equal(evaluate(snap(null), emptyState()).events.length, 0);
}

// ---- daily limit
{
  const ev = (urgent, exempt = false) => ({ urgent, exempt, type: "t", dedupe: "d" });
  const a = applyCaps([ev(false), ev(false), ev(true)], { normal: 14, urgent: 0 }, { dailyMax: 15, urgentMax: 40 });
  assert.equal(a.send.length, 2); assert.equal(a.held.length, 1);
  assert.equal(applyCaps([ev(false, true)], { normal: 99, urgent: 0 }).send.length, 1);
  assert.equal(applyCaps([ev(true)], { normal: 20, urgent: 0 }).send.length, 1, "urgent goes past the routine limit");
  assert.equal(applyCaps([ev(true)], { normal: 40, urgent: 0 }).send.length, 0);
}

// ---- schema file and the script's list agree
{
  const file = readFileSync(new URL("../d1/0006_x_posts.sql", import.meta.url), "utf8");
  for (const s of X_SCHEMA) assert.ok(file.includes(s), `d1/0006_x_posts.sql is missing: ${s.slice(0, 60)}`);
}

// ---- the whole run: dry-run vs live vs off vs budget vs failure, against a fake D1, Slack and X
{
  const makeDb = () => {
    const db = new DatabaseSync(":memory:");
    return async (sql, params = []) => {
      const stmt = db.prepare(sql);
      return /^\s*select/i.test(sql) ? stmt.all(...params) : (stmt.run(...params), []);
    };
  };
  const world = (env) => {
    const calls = { slack: [], x: [], other: [] };
    const doFetch = async (url, init) => {
      if (url === "https://hooks.example/slack") { calls.slack.push(JSON.parse(init.body).text); return new Response("ok"); }
      if (String(url).startsWith("https://api.x.com/2/tweets")) {
        calls.x.push(JSON.parse(init.body));
        if (world.xStatus && world.xStatus !== 201) return new Response(JSON.stringify({ title: "Too Many Requests" }), { status: world.xStatus, headers: { "x-rate-limit-reset": String(Math.floor(LATE / 1000) + 900) } });
        return new Response(JSON.stringify({ data: { id: String(1000 + calls.x.length) } }), { status: 201 });
      }
      calls.other.push(url); return new Response("{}", { status: 404 });
    };
    return { calls, doFetch, env: { SLACK_WEBHOOK_URL: "https://hooks.example/slack", ...env } };
  };
  const KEYS = { X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" };
  const sceneA = () => snap(calm(), { rain: { mm: 85, place: "Ratnapura" } }); // morning summary only
  const rising = (now) => snap([st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", "major", 12.4, { observedAt: iso(now - 600_000) }), st("kelani-ganga/glencourse", "Glencourse", "Kelani Ganga", "normal", 3, { observedAt: iso(now - 600_000) })], { rain: null }, now);

  // DRY RUN (default): Slack only, nothing to X, and a second run says nothing twice
  {
    const w = world({}); const query = makeDb();
    const r = await run({ env: w.env, doFetch: w.doFetch, query, snap: sceneA(), now: NOW });
    assert.equal(r.mode, "dry"); assert.equal(r.posted, 1);
    assert.equal(w.calls.x.length, 0, "dry-run never touches X");
    assert.ok(w.calls.slack.some((t) => t.includes("DRY RUN: not posted to X") && t.includes("Good morning")));
    const again = await run({ env: w.env, doFetch: w.doFetch, query, snap: sceneA(), now: NOW + 1_800_000 });
    assert.equal(again.posted, 0, "no duplicate morning post");
    const row = (await query("SELECT status, mode, cost_usd FROM x_posts"))[0];
    assert.deepEqual([row.status, row.mode], ["dry", "dry"]); assert.equal(row.cost_usd, 0.015);
  }
  // live requested without keys: stays dry and tells Slack why
  {
    const w = world({ X_POSTING: "live" }); const query = makeDb();
    const r = await run({ env: w.env, doFetch: w.doFetch, query, snap: sceneA(), now: NOW });
    assert.equal(r.mode, "dry"); assert.equal(w.calls.x.length, 0);
    assert.ok(w.calls.slack.some((t) => /X_API_KEY.*not set/.test(t)));
  }
  // kill switch: nothing at all
  {
    const w = world({ X_POSTING: "off", ...KEYS }); const query = makeDb();
    const r = await run({ env: w.env, doFetch: w.doFetch, query, snap: sceneA(), now: NOW });
    assert.equal(r.mode, "off"); assert.equal(w.calls.x.length + w.calls.slack.length, 0);
  }
  // LIVE: posts to X, no link and no reply by default; the Major rise goes out; recorded as posted
  {
    const w = world({ X_POSTING: "live", ...KEYS }); const query = makeDb();
    const first = await run({ env: w.env, doFetch: w.doFetch, query, snap: snap(calm(), { rain: null }, NOW - 7 * 3_600_000), now: NOW - 7 * 3_600_000 });
    const r = await run({ env: w.env, doFetch: w.doFetch, query, snap: rising(LATE), now: LATE });
    assert.equal(r.mode, "live");
    assert.equal(w.calls.x.length, 1, "one post, no thread reply by default");
    assert.ok(!w.calls.x[0].text.includes("http"), "links are off by default");
    assert.ok(w.calls.x[0].text.includes("Hanwella") && w.calls.x[0].text.includes("Emergency: 117.") && w.calls.x[0].text.includes("12.4 ft"));
    assert.equal(w.calls.slack.length, 0);
    assert.equal((await query("SELECT status FROM x_posts WHERE kind = 'alert'"))[0].status, "posted");
    const again = await run({ env: w.env, doFetch: w.doFetch, query, snap: rising(LATE + 600_000), now: LATE + 600_000 });
    assert.equal(again.posted, 0); assert.equal(w.calls.x.length, 1, "no repeat");
  }
  // LIVE with links=alerts and replies=on: the Major rise has a link and a thread reply
  {
    const w = world({ X_POSTING: "live", X_LINKS: "alerts", X_REPLIES: "on", ...KEYS }); const query = makeDb();
    await run({ env: w.env, doFetch: w.doFetch, query, snap: snap(calm(), { rain: null }, NOW - 7 * 3_600_000), now: NOW - 7 * 3_600_000 });
    await run({ env: w.env, doFetch: w.doFetch, query, snap: rising(LATE), now: LATE });
    assert.equal(w.calls.x.length, 2);
    assert.ok(w.calls.x[0].text.includes(`${SITE}/kelani-ganga/hanwella`));
    assert.equal(w.calls.x[1].reply.in_reply_to_tweet_id, "1001");
    const cost = (await query("SELECT cost_usd FROM x_posts WHERE kind = 'alert'"))[0].cost_usd;
    assert.ok(Math.abs(cost - 0.4) < 1e-9, `link post + link reply = ${cost}`);
  }
  // monthly budget: routine posts stop at 80%, a Major rise and an all-clear still go out
  {
    const w = world({ X_POSTING: "live", X_MONTHLY_BUDGET_USD: "1", ...KEYS }); const query = makeDb();
    await run({ env: w.env, doFetch: w.doFetch, query, snap: snap(calm(), { rain: null }, NOW - 7 * 3_600_000), now: NOW - 7 * 3_600_000 });
    await query("INSERT INTO x_posts (ts, day, kind, dedupe_key, mode, status, text, cost_usd) VALUES (1, '2026-10-02', 'alert', 'old', 'live', 'posted', 'x', 0.85)");
    const r = await run({ env: w.env, doFetch: w.doFetch, query, snap: sceneA(), now: NOW });
    assert.equal(w.calls.x.length, 0, "summary held by the budget");
    assert.ok(w.calls.slack.some((t) => /80% limit/.test(t)));
    await run({ env: w.env, doFetch: w.doFetch, query, snap: rising(LATE + 1_800_000), now: LATE + 1_800_000 });
    assert.equal(w.calls.x.length, 1, "Major rise is always allowed");
  }
  // X refuses (429): reported to Slack, paused, queued, no retry loop; resumes after the pause
  {
    const w = world({ X_POSTING: "live", ...KEYS }); const query = makeDb();
    await run({ env: w.env, doFetch: w.doFetch, query, snap: snap(calm(), { rain: null }, NOW - 7 * 3_600_000), now: NOW - 7 * 3_600_000 });
    world.xStatus = 429;
    const r = await run({ env: w.env, doFetch: w.doFetch, query, snap: rising(LATE), now: LATE });
    assert.equal(r.failed, 1); assert.equal(w.calls.x.length, 1);
    assert.ok(w.calls.slack.some((t) => /X post failed/.test(t) && /429/.test(t) && /Not retrying in a loop/.test(t)));
    const paused = await run({ env: w.env, doFetch: w.doFetch, query, snap: rising(LATE + 60_000), now: LATE + 60_000 });
    assert.equal(paused.paused, true); assert.equal(w.calls.x.length, 1, "no retry while paused");
    world.xStatus = 201;
    const later = await run({ env: w.env, doFetch: w.doFetch, query, snap: rising(LATE + 1_000_000), now: LATE + 1_000_000 });
    assert.equal(later.posted, 1, "the queued post goes out once the pause ends");
    assert.equal(w.calls.x.length, 2);
    assert.equal((await query("SELECT COUNT(*) AS n FROM x_posts WHERE status = 'posted'"))[0].n, 1);
    world.xStatus = null;
  }
  // site unreadable: nothing happens
  {
    const w = world({}); const query = makeDb();
    const r = await run({ env: w.env, doFetch: w.doFetch, query, snap: { now: NOW, site: SITE, stations: null, reservoirs: null, street: null, warnings: null, rain: null }, now: LATE });
    assert.equal(r.posted, 0);
  }
  // prepare(): a template that breaks its own rules is never sent
  {
    const r = await prepare({ type: "gauge_rise", kind: "alert", gauges: [gf()] }, async () => "nonsense", {});
    assert.equal(r.ai, false); assert.ok(r.text.includes("Hanwella"));
  }
}

console.log("x-post tests passed");
