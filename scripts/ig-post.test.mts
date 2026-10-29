// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/ig-post.test.mts
// The Instagram account: gate and missing secrets, mode decision, selection per mode, caps, quiet hours, all-clear hold, dedupe,
// captions in 3 languages, the Graph API calls and the dry-run messages, using a fake D1 (node:sqlite), a fake Slack and a fake Graph API.
// Nothing here can reach graph.facebook.com: every fetch is a fake that records the address.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { gate, publishImage, classifyError, fetchJpeg, publishingUsage, IG_GRAPH_VERSION } from "../lib/igClient.ts";
import { composeCaption, validateCaption, hashtagsFor, tagOf, LIVE_LINE } from "../lib/igCompose.ts";
import { decideMode, planIg, applyIgCaps, emptyIgState, quiet, imageUrl, calmItem, IG_DEFAULTS } from "./ig-engine.mjs";
import { run, sample, IG_SCHEMA, dryRunMessage } from "./ig-post.mjs";

const SITE = "https://waterlevels.lk";
const iso = (ms) => new Date(ms).toISOString();
const H = 3_600_000;
const T0 = Date.parse("2026-10-28T03:30:00Z"); // 9:00 am Colombo, a Wednesday
const at = (h) => T0 + h * H;
const st = (id, station, river, status, level, now, o = {}) => ({
  id, station, river, status, level, unit: "ft", marks: { alert: 8, minor: 10, major: 12 }, trend: "rising", observedAt: iso(now - 600_000),
  url: `${SITE}/${id}`, nextHour: null, ...o,
});
const snap = (stations, now, extra = {}) => ({ now, site: SITE, stations, reservoirs: [], warnings: [], rain: { mm: 20, place: "Ratnapura" }, fallen: null, ...extra });
const hw = (status, level, now, extra) => snap([st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", status, level, now), st("kelani-ganga/glencourse", "Glencourse", "Kelani Ganga", "normal", 3, now), st("kalu-ganga/ratnapura", "Ratnapura", "Kalu Ganga", "normal", 4, now)], now, extra);
const noCtx = { used: { story: 0, feed: 0 }, keepWeek: 0, lastKeepMs: null, lastByType: {} };
const bulletin = (o = {}) => ({ source: "Irrigation Department", url: "https://dmc.example/kalu-03.pdf", title: "Flood warning Kalu", issuedAt: iso(T0 - H), basins: ["Kalu Ganga"], severity: "alert", releaseCusecs: null, ...o });

// ---- gate: default dry, the kill switch, a missing secret always means dry and says which
assert.equal(gate({}).mode, "dry");
assert.deepEqual(gate({}).missing, ["IG_ACCESS_TOKEN", "IG_USER_ID"]);
assert.equal(gate({ IG_MODE: "off", IG_ACCESS_TOKEN: "t", IG_USER_ID: "1" }).mode, "off");
assert.equal(gate({ IG_MODE: "live" }).mode, "dry", "live without secrets stays dry");
assert.match(gate({ IG_MODE: "live", IG_ACCESS_TOKEN: "t" }).reason, /IG_USER_ID not set/);
assert.equal(gate({ IG_ACCESS_TOKEN: "t", IG_USER_ID: "1" }).mode, "dry", "secrets alone never post");
assert.equal(gate({ IG_MODE: "dry", IG_ACCESS_TOKEN: "t", IG_USER_ID: "1" }).mode, "dry");
assert.equal(gate({ IG_MODE: " LIVE ", IG_ACCESS_TOKEN: "t", IG_USER_ID: "1" }).mode, "live");
assert.equal(gate({ IG_MODE: "live", IG_ACCESS_TOKEN: "  ", IG_USER_ID: "1" }).mode, "dry", "a blank secret is missing");

// ---- Graph API: container -> wait -> publish, never retried, token only in a header, only graph.facebook.com
{
  const KEYS = { token: "EAAtesttoken1234567890abcdef", userId: "1784" };
  const mk = (script) => {
    const calls = [];
    const doFetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? Object.fromEntries(new URLSearchParams(init.body.toString())) : null });
      return script(calls.length, String(url), init);
    };
    return { calls, doFetch };
  };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
  const ok = (n, url) => (url.endsWith("/media") ? json({ id: "C1" }) : url.includes("/C1") ? json({ status_code: n >= 3 ? "FINISHED" : "IN_PROGRESS" }) : json({ id: "M9" }));
  const f = mk((n, url) => ok(n, url));
  const r = await publishImage(KEYS, { imageUrl: `${SITE}/a.jpg`, format: "story", caption: "ignored" }, { doFetch: f.doFetch, sleep: async () => {}, now: 0 });
  assert.deepEqual([r.ok, r.mediaId, r.containerId], [true, "M9", "C1"]);
  assert.equal(f.calls.length, 4, "create, 2 polls, publish");
  for (const c of f.calls) {
    assert.ok(c.url.startsWith(`https://graph.facebook.com/${IG_GRAPH_VERSION}/`), c.url);
    assert.ok(!c.url.includes(KEYS.token) && (c.body ? !JSON.stringify(c.body).includes(KEYS.token) : true), "the token is never in a URL or body");
    assert.equal(c.headers.Authorization, `Bearer ${KEYS.token}`);
  }
  assert.deepEqual(f.calls[0].body, { image_url: `${SITE}/a.jpg`, media_type: "STORIES" }, "a story: media_type=STORIES and no caption");
  assert.equal(f.calls[0].url, `https://graph.facebook.com/${IG_GRAPH_VERSION}/1784/media`);
  assert.deepEqual(f.calls[3].body, { creation_id: "C1" });
  assert.equal(f.calls[3].url, `https://graph.facebook.com/${IG_GRAPH_VERSION}/1784/media_publish`);
  // a feed picture carries the caption and no media_type
  const f2 = mk((n, url) => ok(9, url));
  await publishImage(KEYS, { imageUrl: `${SITE}/b.jpg`, format: "feed", caption: "Hello\n\nLive levels: waterlevels.lk" }, { doFetch: f2.doFetch, sleep: async () => {}, env: { IG_GRAPH_VERSION: "v99.0" } });
  assert.deepEqual(f2.calls[0].body, { image_url: `${SITE}/b.jpg`, caption: "Hello\n\nLive levels: waterlevels.lk" });
  assert.ok(f2.calls[0].url.includes("/v99.0/"), "version override");
  // container ERROR, never ready, an API error, a network error: failures, no retry, no publish
  const fe = mk((n, url) => (url.endsWith("/media") ? json({ id: "C1" }) : json({ status_code: "ERROR", status: "Media upload has failed" })));
  const re = await publishImage(KEYS, { imageUrl: "x", format: "feed", caption: "c" }, { doFetch: fe.doFetch, sleep: async () => {} });
  assert.ok(!re.ok && re.stage === "wait" && /ERROR/.test(re.detail) && re.containerId === "C1" && fe.calls.length === 2);
  const fs = mk((n, url) => (url.endsWith("/media") ? json({ id: "C1" }) : json({ status_code: "IN_PROGRESS" })));
  const rs = await publishImage(KEYS, { imageUrl: "x", format: "feed", caption: "c" }, { doFetch: fs.doFetch, sleep: async () => {}, waits: 3 });
  assert.ok(!rs.ok && /not ready after 3/.test(rs.detail) && fs.calls.length === 4 && !fs.calls.some((c) => c.url.endsWith("media_publish")));
  const fa = mk(() => json({ error: { message: `Invalid OAuth access token ${KEYS.token}`, type: "OAuthException", code: 190, fbtrace_id: "x" } }, 400));
  const ra = await publishImage(KEYS, { imageUrl: "x", format: "story" }, { doFetch: fa.doFetch, now: 1000 });
  assert.ok(!ra.ok && ra.auth && ra.stage === "container" && ra.pauseUntilMs === 1000 + 6 * H && !ra.detail.includes(KEYS.token) && fa.calls.length === 1);
  const rn = await publishImage(KEYS, { imageUrl: "x", format: "story" }, { doFetch: async () => { throw new TypeError("fetch failed"); }, now: 0 });
  assert.ok(!rn.ok && rn.status === 0 && rn.pauseUntilMs === 15 * 60_000);
  assert.equal(classifyError(400, { error: { code: 4, message: "rate" } }, 0).pauseUntilMs, H, "rate limit pauses an hour");
  assert.equal(classifyError(400, { error: { code: 100, message: "bad param" } }, 0).pauseUntilMs, null, "a one-off error pauses nothing");
  assert.equal(await publishingUsage(KEYS, { doFetch: async (u) => { assert.ok(u.includes("content_publishing_limit")); return json({ data: [{ quota_usage: 12 }] }); } }), 12);
  assert.equal(await publishingUsage(KEYS, { doFetch: async () => json({ error: { code: 1 } }, 500) }), null);
  // the picture check: only a real JPEG from our site
  const pic = (type, n, first = [0xff, 0xd8]) => async () => new Response(Uint8Array.from({ length: n }, (_, i) => first[i] ?? 7), { headers: { "content-type": type } });
  assert.ok((await fetchJpeg("u", pic("image/jpeg", 9000))).ok);
  assert.match((await fetchJpeg("u", pic("image/png", 9000))).why, /not a JPEG/);
  assert.match((await fetchJpeg("u", pic("image/jpeg", 100))).why, /too small/);
  assert.match((await fetchJpeg("u", pic("image/jpeg", 9000, [1, 2]))).why, /not a JPEG/);
  assert.match((await fetchJpeg("u", async () => new Response("no", { status: 503 }))).why, /503/);
}

// ---- captions: English first, Sinhala, Tamil, the address line, hashtags on feed posts only, no links
{
  const gauge = { station: "Ratnapura", river: "Kalu Ganga", tier: "alert", level: 19.04, trend: "rising", nextHour: { level: 19.4 } };
  const item = { type: "gauge_rise", gauge };
  const feed = composeCaption(item, { feed: true });
  const lines = feed.text.split("\n").filter(Boolean);
  assert.equal(lines[0], "Ratnapura, Kalu Ganga: Alert at 19.0 ft, rising. Next hour: about 19.4 ft.");
  assert.ok(/[඀-෿]/.test(lines[1]) && /[஀-௿]/.test(lines[2]), "line 2 Sinhala, line 3 Tamil");
  assert.ok(feed.text.includes(LIVE_LINE.en) && !/https?:|www\./.test(feed.text));
  assert.deepEqual(feed.tags, ["#KaluGanga", "#Ratnapura", "#SriLankaFloods"]);
  assert.ok(feed.text.trimEnd().endsWith("#KaluGanga #Ratnapura #SriLankaFloods"));
  assert.deepEqual(validateCaption(feed.text, { feed: true }), []);
  const story = composeCaption(item, { feed: false });
  assert.ok(!story.text.includes("#") && validateCaption(story.text, { feed: false }).length === 0);
  assert.ok(validateCaption(feed.text, { feed: false }).some((p) => /hashtag/.test(p)), "hashtags on a story are caught");
  assert.ok(validateCaption("Hi\n\nLive levels: waterlevels.lk https://waterlevels.lk", { feed: true }).some((p) => /link/.test(p)));
  assert.ok(validateCaption("Hi", { feed: true }).some((p) => /Live levels/.test(p)));
  assert.ok(composeCaption({ type: "gauge_rise", gauge: { ...gauge, tier: "minor" } }, { feed: false }).en.includes("Emergency: 117."));
  assert.ok(!composeCaption(item, { feed: false }).en.includes("117"));
  assert.equal(composeCaption(item, { feed: true, langs: ["en"] }).text.split("\n").filter(Boolean).length, 1 + 1 + 1 /* en, address, tags */);
  // every kind of item: English first line, 3 languages, address line, checks pass
  const all = [
    { type: "gauge_clear", gauge: { ...gauge, tier: "normal", level: 8.9 } },
    { type: "warning", warning: { source: "Irrigation Department", severity: "alert", basins: ["Kalu Ganga"] } },
    { type: "home", home: { atAlert: 2, nearAlert: 3, assessed: 40, rain: { mm: 85, place: "Ratnapura" }, weather: true } },
    { type: "home", home: { atAlert: 0, nearAlert: 0, assessed: 40, rain: null, weather: false } },
    { type: "rain", rain: { place: "Thawalama", mm: 71 } },
    { type: "reservoirs", reservoirs: { count: 31, top: { name: "Rajanganaya", cusecs: 7704, day: "2026-10-28" } } },
    { type: "river", river: { name: "Kelani Ganga", gauges: 6, station: "Hanwella", level: 4.2, tier: "normal" } },
    { type: "survey" },
    { type: "embed" },
  ];
  for (const it of all) for (const f of [true, false]) {
    const c = composeCaption(it, { feed: f });
    assert.deepEqual(validateCaption(c.text, { feed: f }), [], `${it.type}: ${c.text}`);
    const l = c.text.split("\n").filter(Boolean);
    assert.ok(/[A-Za-z]/.test(l[0]) && /[඀-෿]/.test(l[1]) && /[஀-௿]/.test(l[2]), `${it.type} has en, si, ta lines: ${l.slice(0, 3).join(" | ")}`);
  }
  assert.match(composeCaption(all[2], { feed: false }).en, /2 gauges at Alert or higher, 3 near it\. Rain forecast: up to 85 mm in 24 hours near Ratnapura\./);
  assert.match(composeCaption(all[5], { feed: false }).en, /31 reservoirs are spilling or releasing.*Rajanganaya, 7,704 cusecs \(2026-10-28\)/);
  // native place names where the gazetteer has them (Latin stays otherwise)
  const nat = composeCaption({ type: "gauge_rise", gauge: { ...gauge, station: "Ratnapura" } }, { feed: false }).text.split("\n").filter(Boolean);
  assert.ok(/^[඀-෿]+:/.test(nat[1]) && /^[஀-௿]+:/.test(nat[2]), nat.join(" | "));
  assert.equal(tagOf("Kalu Ganga"), "#KaluGanga");
  assert.equal(tagOf("Kalawellawa (Millakanda)"), "#Kalawellawa");
  assert.equal(tagOf("අ"), null);
  assert.ok(hashtagsFor({ type: "rain", rain: { place: "Thawalama", mm: 1 } }).length <= 5);
  assert.ok(composeCaption({ type: "home", home: { atAlert: 0, nearAlert: 0, assessed: 5, rain: { mm: 50, place: "X" }, weather: false } }, { feed: false }).en.indexOf("Rain forecast") === -1, "the rain outlook is for weather-alert days only");
}

// ---- mode decision
{
  const calmS = hw("normal", 4, T0);
  assert.equal(decideMode(calmS, {}).mode, "calm");
  assert.equal(decideMode(hw("alert", 8.2, T0), {}).mode, "disaster", "a gauge at Alert");
  assert.equal(decideMode(hw("minor", 10.5, T0), {}).mode, "disaster");
  assert.equal(decideMode({ ...calmS, warnings: [bulletin()] }, {}).mode, "disaster", "an official flood bulletin alone");
  assert.equal(decideMode({ ...calmS, warnings: [bulletin({ severity: "advisory", source: "Department of Meteorology" })] }, {}).mode, "weather", "a Met advisory");
  assert.equal(decideMode({ ...calmS, warnings: [bulletin({ severity: "alert", source: "Department of Meteorology" })] }, {}).mode, "weather", "a Met Department bulletin is weather, not a river flood");
  assert.equal(decideMode({ ...calmS, rain: { mm: 120, place: "Ratnapura" } }, {}).mode, "weather", "a very heavy rain forecast");
  assert.equal(decideMode({ ...calmS, rain: { mm: 85, place: "Ratnapura" } }, {}).mode, "calm", "a forecast alone is below the weather bar");
  assert.equal(decideMode({ ...hw("watch", 6, T0) }, {}).mode, "calm", "watch is not Alert");
  assert.equal(decideMode({ ...calmS, stations: null }, {}).mode, null, "unreadable levels: unknown is never calm");
  assert.equal(decideMode({ ...calmS, warnings: null }, {}).mode, null, "unreadable bulletins: unknown is never calm");
  assert.equal(decideMode({ ...hw("alert", 9, T0), warnings: null }, {}).mode, "disaster", "a gauge at Alert needs no bulletin");
  assert.equal(decideMode(calmS, { "kalu-ganga/ratnapura": { told: 2, below: null } }).mode, "disaster", "an all-clear still waiting");
  assert.equal(decideMode(snap([st("a/b", "B", "A", "alert", 9, T0, { observedAt: null })], T0), {}).mode, "calm", "a gauge without a fresh reading does not count");
  assert.equal(quiet(22 * 60) && quiet(0) && quiet(5 * 60 + 59), true);
  assert.equal(quiet(6 * 60) || quiet(21 * 60 + 59) || quiet(12 * 60), false);
}

// ---- disaster mode: a story per gauge, an update on a step up, the 3 h all-clear hold, one feed post for Minor / Major, bulletins, the morning story
{
  let p = planIg(hw("normal", 4, at(-8)), emptyIgState(), noCtx);
  assert.equal(p.situation.mode, "calm");
  let state = p.state;
  // Hanwella rises to Alert: one story, no feed post, caption facts from the data
  p = planIg(hw("alert", 8.3, at(-7.5)), state, noCtx);
  assert.equal(p.situation.mode, "disaster");
  assert.deepEqual(p.items.map((i) => [i.format, i.kind, i.media.kind, i.media.slug]), [["story", "gauge_rise", "gauge", "hanwella"]]);
  assert.equal(p.items[0].cap.gauge.level, 8.3);
  assert.equal(imageUrl(SITE, p.items[0]), `${SITE}/api/story/gauge/hanwella.jpg?format=story`);
  state = p.state;
  // the same level again: nothing new (no repeat)
  p = planIg(hw("alert", 8.5, at(-7)), state, noCtx);
  assert.equal(p.items.length, 0);
  state = p.state;
  // a step up to Major: a story AND ONE feed post for the worst river (square river picture)
  p = planIg(hw("major", 12.4, at(-6.5)), state, noCtx);
  assert.deepEqual(p.items.map((i) => `${i.format}:${i.media.kind}/${i.media.slug}`).sort(), ["feed:river/kelani-ganga", "story:gauge/hanwella"]);
  assert.equal(imageUrl(SITE, p.items.find((i) => i.format === "feed")), `${SITE}/api/story/river/kelani-ganga.jpg?format=portrait`);
  assert.equal(p.items[0].format, "feed", "the Major feed post is the most important");
  state = p.state;
  // falls below Alert: no all-clear for 3 h; a bounce back up resets the hold
  p = planIg(hw("normal", 5, at(-6)), state, noCtx); state = p.state;
  assert.ok(!p.items.some((i) => i.kind === "gauge_clear"));
  assert.equal(p.situation.mode, "disaster", "still disaster-mode while the all-clear is pending");
  p = planIg(hw("normal", 5, at(-4)), state, noCtx); state = p.state;
  assert.ok(!p.items.some((i) => i.kind === "gauge_clear"), "2 h below Alert: not yet");
  p = planIg(hw("alert", 8.1, at(-3.5)), state, noCtx); state = p.state;
  assert.ok(!p.items.some((i) => i.kind === "gauge_clear"));
  p = planIg(hw("normal", 5, at(-3)), state, noCtx); state = p.state;
  p = planIg(hw("normal", 5, at(-0.5)), state, noCtx); state = p.state;
  assert.ok(!p.items.some((i) => i.kind === "gauge_clear"), "2.5 h since the bounce: not yet");
  p = planIg(hw("normal", 5, at(0)), state, noCtx);
  assert.deepEqual(p.items.filter((i) => i.kind === "gauge_clear").map((i) => [i.format, i.media.slug, i.cap.gauge.station]), [["story", "hanwella", "Hanwella"]], "after a 3 h hold: ONE all-clear story");
  assert.equal(p.situation.mode, "disaster");
  state = p.state;
  p = planIg(hw("normal", 5, at(0.5)), state, noCtx);
  assert.equal(p.items.filter((i) => i.kind === "gauge_clear").length, 0, "the all-clear is said once");
  assert.equal(p.situation.mode, "calm", "and then the account is calm again");
  // a gauge we never told about never gets an all-clear
  let q = planIg(hw("normal", 4, at(-9)), emptyIgState(), noCtx).state;
  q = planIg(hw("alert", 8.2, at(-8.9)), q, noCtx).state;
  delete q.hold["kelani-ganga/hanwella"];
  assert.equal(planIg(hw("normal", 4, at(0)), q, noCtx).items.filter((i) => i.kind === "gauge_clear").length, 0);
  // an unreadable gauge keeps its hold untouched (unknown is never calm)
  let u = planIg(hw("normal", 4, at(-9)), emptyIgState(), noCtx).state;
  u = planIg(hw("alert", 8.2, at(-8.5)), u, noCtx).state;
  const gone = snap([st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", "stale", 1, at(-5)), st("kalu-ganga/ratnapura", "Ratnapura", "Kalu Ganga", "normal", 4, at(-5))], at(-5));
  const g2 = planIg(gone, u, noCtx);
  assert.equal(g2.state.hold["kelani-ganga/hanwella"].below, null);
}
// two gauges of ONE river rising together are two stories (Instagram wants one per gauge; the X surge merge is off)
{
  const mk = (a, b, now) => snap([st("kalu-ganga/ratnapura", "Ratnapura", "Kalu Ganga", a, 9, now), st("kalu-ganga/putupaula", "Putupaula", "Kalu Ganga", b, 9, now), st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", "normal", 4, now), st("gin-ganga/baddegama", "Baddegama", "Gin Ganga", "normal", 4, now), st("nilwala-ganga/panadugama", "Panadugama", "Nilwala Ganga", "normal", 4, now)], now);
  let s = planIg(mk("normal", "normal", at(-3)), emptyIgState(), noCtx).state;
  const p = planIg(mk("alert", "alert", at(-2.5)), s, noCtx);
  assert.deepEqual(p.items.filter((i) => i.kind === "gauge_rise").map((i) => i.media.slug).sort(), ["putupaula", "ratnapura"]);
  // 3 rivers at once: still one story per gauge (no merged national post)
  const m3 = (now, st3) => snap([st("kalu-ganga/ratnapura", "Ratnapura", "Kalu Ganga", st3, 9, now), st("gin-ganga/baddegama", "Baddegama", "Gin Ganga", st3, 9, now), st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", st3, 9, now)], now);
  s = planIg(m3(at(-3), "normal"), emptyIgState(), noCtx).state;
  assert.equal(planIg(m3(at(-2.5), "alert"), s, noCtx).items.filter((i) => i.kind === "gauge_rise").length, 3);
}
// official bulletins: a river story per new bulletin, once; the morning story once a day
{
  const base = hw("normal", 4, T0, { warnings: [bulletin()] });
  let p = planIg(base, emptyIgState(), noCtx);
  assert.equal(p.situation.mode, "disaster");
  assert.deepEqual(p.items.map((i) => `${i.kind}:${i.format}:${i.media.kind}/${i.media.slug}`), ["warning:story:river/kalu-ganga", "morning:story:home/now"]);
  assert.equal(p.items.find((i) => i.kind === "warning").dedupe, "story:warning:https://dmc.example/kalu-03.pdf");
  p = planIg({ ...base, now: T0 + 0.5 * H }, p.state, noCtx);
  assert.equal(p.items.length, 0, "neither the bulletin nor the morning story twice");
  // a morning story outside the morning window is not made
  const late = hw("alert", 9, at(5), { warnings: [] });
  assert.ok(!planIg(late, emptyIgState(), noCtx).items.some((i) => i.kind === "morning"));
  // a disaster story goes out at night; a morning story is not a night thing (outside the window)
  const night = Date.parse("2026-10-28T19:00:00Z"); // 00:30 Colombo
  let n = planIg(hw("normal", 4, night - H), emptyIgState(), noCtx).state;
  const np = planIg(hw("alert", 8.4, night), n, noCtx);
  assert.equal(np.items.length, 1, "disaster stories ignore the quiet hours");
}
// caps: disaster 20 stories + 3 feed posts a day; other modes 1 post a day
{
  const mkItems = (n, format) => Array.from({ length: n }, (_, i) => ({ format, kind: "x", priority: 20 + (i % 3), dedupe: `${format}${i}`, label: "x" }));
  const items = [...mkItems(25, "story"), ...mkItems(5, "feed")];
  let r = applyIgCaps(items, "disaster", { story: 0, feed: 0 });
  assert.deepEqual([r.send.filter((i) => i.format === "story").length, r.send.filter((i) => i.format === "feed").length, r.held.length], [20, 3, 7]);
  r = applyIgCaps(items, "disaster", { story: 18, feed: 3 });
  assert.deepEqual([r.send.filter((i) => i.format === "story").length, r.send.filter((i) => i.format === "feed").length], [2, 0]);
  r = applyIgCaps(items, "weather", { story: 0, feed: 0 });
  assert.equal(r.send.length, 1);
  assert.equal(applyIgCaps(items, "calm", { story: 0, feed: 1 }).send.length, 0, "one post a day in total");
  assert.equal(applyIgCaps(items, "calm", { story: 1, feed: 0 }).send.length, 0, "a story counts too");
  const best = applyIgCaps([{ format: "feed", priority: 1, kind: "a", dedupe: "a", label: "a" }, { format: "feed", priority: 9, kind: "b", dedupe: "b", label: "b" }], "calm", { story: 0, feed: 0 }).send;
  assert.equal(best[0].kind, "b");
  assert.equal(planIg(hw("alert", 8.3, at(-7.5)), planIg(hw("normal", 4, at(-8)), emptyIgState(), noCtx).state, { ...noCtx, used: { story: 20, feed: 0 } }).held.length, 1, "planIg reports what the cap stopped");
}

// ---- weather mode: ONE morning feed post, no stories; quiet hours; calm mode: keep-alive posts with the weekly limit
{
  const adv = { warnings: [bulletin({ severity: "advisory", source: "Department of Meteorology", basins: [] })] };
  let p = planIg(hw("normal", 4, T0 - H, adv), emptyIgState(), noCtx); // 8 am
  assert.equal(p.situation.mode, "weather");
  assert.deepEqual(p.items.map((i) => [i.format, i.kind, i.media.kind, i.cap.home.weather]), [["feed", "weather_morning", "home", true]]);
  p = planIg(hw("normal", 4, T0, adv), p.state, noCtx);
  assert.equal(p.items.length, 0, "once a day");
  const ten = planIg(hw("normal", 4, at(1.5), adv), emptyIgState(), { ...noCtx, used: { story: 0, feed: 1 } });
  assert.equal(ten.items.length, 0, "and counted against the one-a-day cap");
  assert.equal(planIg(hw("normal", 4, at(5), adv), emptyIgState(), noCtx).items.length, 0, "outside the morning window (2 pm)");
  const night = Date.parse("2026-10-28T17:30:00Z"); // 23:00 Colombo
  assert.equal(planIg(hw("normal", 4, night, adv), emptyIgState(), noCtx).items.length, 0, "quiet hours");
  // calm: keep-alive
  const reservoirs = [{ id: "rajanganaya", name: "Rajanganaya", status: "spilling", flow: { cusecs: 7704, day: "2026-10-28" }, readingDay: "2026-10-28" }, { id: "old", name: "Old", status: "spilling", flow: { cusecs: 9000, day: "2026-10-20" } }];
  const calmSnap = (now, extra = {}) => hw("normal", 4, now, { reservoirs, fallen: { mm: 71, place: "Thawalama" }, ...extra });
  let c = planIg(calmSnap(T0), emptyIgState(), noCtx);
  assert.equal(c.situation.mode, "calm");
  assert.deepEqual(c.items.map((i) => [i.format, i.kind, i.media.kind]), [["feed", "keepalive:rain", "rain"]]);
  assert.equal(imageUrl(SITE, c.items[0]), `${SITE}/api/story/rain/now.jpg?format=portrait`);
  assert.equal(c.items[0].cap.rain.mm, 71);
  // rotation: the type posted longest ago goes next
  let ctx = { ...noCtx, keepWeek: 1, lastKeepMs: T0 - 2 * 86_400_000, lastByType: { rain: T0 - 2 * 86_400_000 } };
  c = planIg(calmSnap(T0), emptyIgState(), ctx);
  assert.equal(c.items[0].kind, "keepalive:reservoirs");
  assert.equal(c.items[0].cap.reservoirs.count, 1, "an old reading is not 'spilling now'");
  assert.equal(imageUrl(SITE, c.items[0]), `${SITE}/api/story/reservoirs/now.jpg?format=portrait`);
  ctx = { ...ctx, lastByType: { rain: 1, reservoirs: 2, river: 3, survey: 4, embed: 5 } };
  assert.equal(planIg(calmSnap(T0), emptyIgState(), ctx).items[0].kind, "keepalive:rain");
  // not eligible: little rain, no reservoir spilling
  const dry = calmItem(calmSnap(T0, { fallen: { mm: 4, place: "X" }, reservoirs: [] }), noCtx, IG_DEFAULTS, "2026-10-28", 9 * 60 + 30);
  assert.equal(dry.kind, "keepalive:river");
  assert.equal(dry.media.slug, "kalu-ganga" === dry.media.slug ? "kalu-ganga" : dry.media.slug);
  assert.ok(["kelani-ganga"].includes(dry.media.slug), "only a river with 2+ gauges is spotlighted");
  const cta = calmItem(snap([st("a/b", "B", "A", "normal", 3, T0)], T0, { fallen: null }), noCtx, IG_DEFAULTS, "2026-10-28", 9 * 60 + 30);
  assert.equal(cta.kind, "keepalive:survey", "with nothing else eligible, a survey / embed call");
  // limits: 3 a week, 30 h apart, the window, quiet hours
  assert.equal(planIg(calmSnap(T0), emptyIgState(), { ...noCtx, keepWeek: 3 }).items.length, 0, "3 a week");
  assert.equal(planIg(calmSnap(T0), emptyIgState(), { ...noCtx, keepWeek: 1, lastKeepMs: T0 - 20 * H }).items.length, 0, "a day apart at least");
  assert.equal(planIg(calmSnap(T0), emptyIgState(), { ...noCtx, keepWeek: 1, lastKeepMs: T0 - 31 * H }).items.length, 1);
  assert.equal(planIg(calmSnap(T0 - 2 * H), emptyIgState(), noCtx).items.length, 0, "7 am is before the keep-alive window");
  assert.equal(planIg(calmSnap(night), emptyIgState(), noCtx).items.length, 0, "quiet hours");
  assert.equal(planIg(calmSnap(T0), emptyIgState(), { ...noCtx, used: { story: 0, feed: 1 } }).items.length, 0, "one post a day");
  assert.equal(planIg({ ...calmSnap(T0), warnings: null }, emptyIgState(), noCtx).items.length, 0, "unreadable bulletins: no calm post");
  assert.equal(planIg({ ...calmSnap(T0), stations: null }, emptyIgState(), noCtx).items.length, 0);
}

// ---- a whole run against a fake D1, Slack, our site and a fake Graph API
const makeDb = () => {
  const db = new DatabaseSync(":memory:");
  const q = async (sql, params = []) => {
    const stmt = db.prepare(sql);
    return /^\s*select/i.test(sql) ? stmt.all(...params) : (stmt.run(...params), []);
  };
  return q;
};
const world = (env = {}) => {
  const w = { slack: [], graph: [], other: [], pictures: [], graphFail: null };
  w.doFetch = async (url, init = {}) => {
    const u = String(url);
    if (u === "https://hooks.example/slack") { w.slack.push(JSON.parse(init.body).text); return new Response("ok"); }
    if (u.startsWith("https://waterlevels.lk/api/story/")) {
      w.pictures.push(u);
      if (u.includes("/gauge/broken")) return new Response("x", { status: 503 });
      return new Response(Uint8Array.from({ length: 20_000 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : 9)), { headers: { "content-type": "image/jpeg" } });
    }
    if (u.startsWith("https://graph.facebook.com/")) {
      w.graph.push({ url: u, body: init.body ? Object.fromEntries(new URLSearchParams(init.body.toString())) : null });
      if (w.graphFail) return new Response(JSON.stringify(w.graphFail), { status: 400 });
      if (u.endsWith("/media")) return new Response(JSON.stringify({ id: `C${w.graph.length}` }));
      if (u.endsWith("/media_publish")) return new Response(JSON.stringify({ id: `M${w.graph.length}` }));
      return new Response(JSON.stringify({ status_code: "FINISHED" }));
    }
    w.other.push(u);
    return new Response("{}", { status: 404 });
  };
  w.env = { SLACK_WEBHOOK_URL: "https://hooks.example/slack", ...env };
  return w;
};
const SECRETS = { IG_ACCESS_TOKEN: "EAAfaketoken000000000000000000", IG_USER_ID: "1784" };
const rows = async (q) => q("SELECT kind, format, situation, mode, status, dedupe_key FROM ig_posts ORDER BY id");
{
  // DRY RUN: Slack only, picture checked, a second run says nothing twice, the missing-secret note comes once a day
  const w = world({}); const q = makeDb();
  await run({ env: w.env, doFetch: w.doFetch, query: q, snap: hw("normal", 4, at(-8)), now: at(-8) });
  const first = w.slack.length;
  assert.ok(w.slack[0].includes("IG_ACCESS_TOKEN and IG_USER_ID not set") && /once a day/.test(w.slack[0]), w.slack[0]);
  await run({ env: w.env, doFetch: w.doFetch, query: q, snap: hw("normal", 4, at(-7.5)), now: at(-7.5) });
  assert.equal(w.slack.filter((s) => /once a day/.test(s)).length, 1, "the missing-secret note is not repeated within the day");
  let r = await run({ env: w.env, doFetch: w.doFetch, query: q, snap: hw("alert", 8.3, at(-7)), now: at(-7) });
  assert.equal(r.posted, 1);
  const msg = w.slack.at(-1);
  assert.match(msg, /^\*DRY RUN: not posted to Instagram\* \(1\/1\) \[story: Hanwella alert\] mode: disaster \(1 gauge at Alert or above\)/);
  assert.ok(msg.includes(`${SITE}/api/story/gauge/hanwella.jpg?format=story`) && msg.includes("fetched, JPEG, 20 KB") && msg.includes("> Hanwella, Kelani Ganga: Alert at 8.3 ft, rising."));
  assert.deepEqual((await rows(q)).map((x) => [x.kind, x.format, x.situation, x.mode, x.status]), [["gauge_rise", "story", "disaster", "dry", "dry"]]);
  await run({ env: w.env, doFetch: w.doFetch, query: q, snap: hw("alert", 8.4, at(-6.9)), now: at(-6.9) });
  assert.equal((await rows(q)).length, 1, "nothing twice");
  assert.deepEqual(w.graph, [], "a dry run never calls the Graph API");
  assert.deepEqual(w.other, []);
  // the next day the note comes again
  const day2 = at(24 - 7);
  await run({ env: w.env, doFetch: w.doFetch, query: q, snap: hw("normal", 4, day2), now: day2 });
  assert.equal(w.slack.filter((s) => /once a day/.test(s)).length, 2);
  // a gauge whose picture is missing: shown in dry-run with the problem, and no live post
  const w2 = world({}); const q2 = makeDb();
  const bad = (now, s) => snap([st("x-ganga/broken", "Broken", "X Ganga", s, 9, now)], now);
  await run({ env: w2.env, doFetch: w2.doFetch, query: q2, snap: bad(at(-8), "normal"), now: at(-8) });
  await run({ env: w2.env, doFetch: w2.doFetch, query: q2, snap: bad(at(-7), "alert"), now: at(-7) });
  assert.ok(w2.slack.at(-1).includes("NOT available (HTTP 503): a live run would skip this post"), w2.slack.at(-1));
  // kill switch
  const w3 = world({ IG_MODE: "off" });
  assert.equal((await run({ env: w3.env, doFetch: w3.doFetch, query: makeDb(), snap: hw("alert", 9, at(0)), now: at(0) })).mode, "off");
  assert.deepEqual(w3.slack, []);
}
{
  // LIVE: both secrets and IG_MODE=live. Story = STORIES container; feed = caption; order create -> status -> publish; one run
  const w = world({ ...SECRETS, IG_MODE: "live" }); const q = makeDb();
  const live = (s, now) => run({ env: w.env, doFetch: w.doFetch, query: q, snap: s, now });
  await live(hw("normal", 4, at(-8)), at(-8));
  assert.equal(w.graph.length, 0, "nothing to post: no API call at all");
  w.graph.length = 0;
  await live(hw("alert", 8.3, at(-7)), at(-7));
  const creates = w.graph.filter((g) => g.url.endsWith("/1784/media"));
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].body, { image_url: `${SITE}/api/story/gauge/hanwella.jpg?format=story`, media_type: "STORIES" });
  assert.ok(w.graph.some((g) => g.url.endsWith("/1784/media_publish")));
  assert.deepEqual((await rows(q)).map((x) => [x.mode, x.status]), [["live", "posted"]]);
  assert.ok(w.graph.every((g) => g.url.startsWith("https://graph.facebook.com/")));
  assert.ok(!w.slack.some((s) => /DRY RUN/.test(s)));
  // Major: the story and ONE feed post with the caption (hashtags included)
  w.graph.length = 0;
  await live(hw("major", 12.4, at(-6.5)), at(-6.5));
  const feed = w.graph.find((g) => g.body?.caption);
  assert.ok(feed && feed.body.caption.includes("#KelaniGanga") && feed.body.caption.includes("Live levels: waterlevels.lk") && !feed.body.media_type);
  assert.equal(w.graph.filter((g) => g.url.endsWith("/media_publish")).length, 2);
  // a failure is skipped, reported, not retried, and an account-wide error pauses posting
  const f = world({ ...SECRETS, IG_MODE: "live" }); const fq = makeDb();
  const fl = (s, now) => run({ env: f.env, doFetch: f.doFetch, query: fq, snap: s, now });
  await fl(hw("normal", 4, at(-8)), at(-8));
  f.graphFail = { error: { message: "Error validating access token", type: "OAuthException", code: 190 } };
  f.graph.length = 0;
  const out = await fl(hw("alert", 8.3, at(-7)), at(-7));
  assert.equal(out.failed, 1);
  assert.equal(f.graph.filter((g) => g.url.endsWith("/media")).length, 1, "no retry");
  assert.ok(f.slack.at(-1).includes("Instagram post failed at container") && f.slack.at(-1).includes("paused until"), f.slack.at(-1));
  assert.ok(!f.slack.join("\n").includes(SECRETS.IG_ACCESS_TOKEN), "the token never reaches Slack");
  assert.equal((await rows(fq))[0].status, "failed");
  f.graphFail = null; f.graph.length = 0;
  const paused = await fl(hw("minor", 10.5, at(-6.5)), at(-6.5));
  assert.equal(paused.paused, true);
  assert.equal(f.graph.length, 0, "paused: nothing called");
  const later = await fl(hw("major", 12.5, at(0)), at(0));
  assert.ok(later.posted >= 1, "after the pause it posts again");
  // the API's own limit: 45 of 50 used -> nothing
  const l = world({ ...SECRETS, IG_MODE: "live" }); const lq = makeDb();
  const base = l.doFetch;
  l.doFetch = async (url, init) => (String(url).includes("content_publishing_limit") ? new Response(JSON.stringify({ data: [{ quota_usage: 49 }] })) : base(url, init));
  await run({ env: l.env, doFetch: l.doFetch, query: lq, snap: hw("normal", 4, at(-8)), now: at(-8) });
  await run({ env: l.env, doFetch: l.doFetch, query: lq, snap: hw("alert", 8.3, at(-7)), now: at(-7) });
  assert.ok(l.slack.some((s) => /49 of its 50/.test(s)) && !l.graph.some((g) => g.url.endsWith("/media")));
}
// the daily cap through run(): in dry-run, at most 20 stories a day in disaster mode
{
  const w = world({ IG_STORIES_MAX: "2" }); const q = makeDb();
  const many = (now, s) => snap(["a", "b", "c", "d"].map((n) => st(`r${n}/g${n}`, `G${n}`, `R${n}`, s, 9, now)), now);
  await run({ env: w.env, doFetch: w.doFetch, query: q, snap: many(at(-3), "normal"), now: at(-3) });
  const r = await run({ env: w.env, doFetch: w.doFetch, query: q, snap: many(at(-2.5), "alert"), now: at(-2.5) });
  assert.deepEqual([r.posted, r.held], [2, 3]); // 4 gauge stories + the 06:30 morning story, 2 allowed
  assert.ok(w.slack.some((s) => /3 post\(s\) held back by the daily limit/.test(s)));
}
// schema in d1/0018 matches the one the script creates
{
  const file = readFileSync(new URL("../d1/0018_ig_posts.sql", import.meta.url), "utf8");
  for (const s of IG_SCHEMA) assert.ok(file.includes(s), `d1/0018_ig_posts.sql is missing: ${s.slice(0, 60)}`);
}
// sample mode touches no memory and never posts
{
  const w = world({}); const s = await sample({ env: w.env, doFetch: w.doFetch, snap: hw("alert", 8.3, T0, { reservoirs: [{ name: "Rajanganaya", status: "spilling", flow: { cusecs: 7704, day: "2026-10-28" } }], fallen: { mm: 71, place: "Thawalama" } }), now: T0 });
  assert.equal(s.length, 4);
  assert.deepEqual(w.graph, []);
  assert.ok(w.slack.every((m) => /^\*SAMPLE, DRY RUN/.test(m)));
}

// ---- sample Slack messages per mode, saved for the owner to look at (IG_SAMPLE_DIR=...)
if (process.env.IG_SAMPLE_DIR) {
  mkdirSync(process.env.IG_SAMPLE_DIR, { recursive: true });
  const save = async (name, s0, s1, nowA, nowB, ctx, extra = {}) => {
    const w = world(extra); const q = makeDb();
    await run({ env: w.env, doFetch: w.doFetch, query: q, snap: s0, now: nowA });
    await run({ env: w.env, doFetch: w.doFetch, query: q, snap: s1, now: nowB });
    writeFileSync(`${process.env.IG_SAMPLE_DIR}/slack-${name}.txt`, w.slack.filter((m) => /DRY RUN/.test(m)).join("\n\n---\n\n") + "\n");
  };
  const ratn = (st3, lvl, now, extra = {}) => snap([st("kalu-ganga/rathnapura", "Ratnapura", "Kalu Ganga", st3, lvl, now, { marks: { alert: 18, minor: 22, major: 26 }, nextHour: { level_ft: lvl + 0.4, level: lvl + 0.4 } }), st("kalu-ganga/putupaula", "Putupaula", "Kalu Ganga", "normal", 4, now), st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", "normal", 4, now)], now, extra);
  await save("disaster", ratn("normal", 15, at(-9)), ratn("alert", 19.0, at(-8.5), { warnings: [bulletin()] }), at(-9), at(-8.5));
  // morning story + bulletin story + gauge story in one run
  await save("disaster-morning", ratn("normal", 15, at(-1.6)), ratn("minor", 22.4, at(-0.2), { warnings: [bulletin({ issuedAt: iso(at(-1)) })] }), at(-1.6), at(-0.2));
  await save("weather", ratn("normal", 15, at(-2.5)), ratn("normal", 15, at(-1), { warnings: [bulletin({ severity: "advisory", source: "Department of Meteorology", basins: [] })], rain: { mm: 85, place: "Ratnapura" } }), at(-2.5), at(-1));
  await save("calm", ratn("normal", 15, at(0.2)), ratn("normal", 15, at(0.5), { fallen: { mm: 71, place: "Thawalama" } }), at(0.2), at(0.5));
}
console.log("ig-post tests passed");
