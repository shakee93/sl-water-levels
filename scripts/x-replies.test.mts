// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/x-replies.test.mts
// Automatic replies and reposts for the X account: what a message means, which place it names, facts and checks, caps, the
// emergency path, modes (off / dry / live), direct messages behind a flag, and reposts decided by the Decisions API (mocked).
// A fake D1 (node:sqlite), a fake X, a fake Slack and a fake model: nothing leaves the machine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { classify, cleanText, looksLikeBot, directedAtUs, makeResolver, resolveTarget, buildAnswer, fixedReply, validateFixed, validateReply, writeReply, mayReply, DEFAULT_LIMITS, REPLIES_SCHEMA, FIXED_VARIANTS } from "../lib/xReply.ts";
import { tweetLength } from "../lib/xCompose.ts";
import { PLACES, RIVERS } from "../lib/places.ts";
import { run, planReply, replyMode, configOf, feedMessage } from "./x-replies.mjs";
import { run as runReposts, repostConfig } from "./x-reposts.mjs";
import { parseAccounts, repostQuery, prefilter, interpret, judge, mayRepost, QUESTIONS } from "../lib/xRepost.ts";

const NOW = Date.parse("2026-10-26T05:40:00Z"); // 11:10 am Colombo
const iso = (ms) => new Date(ms).toISOString();
const stations = JSON.parse(readFileSync(new URL("./fuzzy-stations.json", import.meta.url), "utf8"));
const lv = (id, station, river, status, level, alert, o = {}) => ({ id, station, river, level, unit: "ft", marks: { alert, minor: alert + 3, major: alert + 6 }, status, trend: "rising", observedAt: iso(NOW - 300_000), ageMinutes: 5, nextHour: { level_ft: level + 0.4, low_ft: level + 0.2, high_ft: level + 0.7, direction: "rising", crossing: null }, ...o });
const levels = [
  lv("kelani-ganga/nagalagam-street", "Nagalagam Street", "Kelani Ganga", "normal", 2.3, 4),
  lv("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", "normal", 14.1, 21.3, { trend: "steady" }),
  lv("kalu-ganga/rathnapura", "Rathnapura", "Kalu Ganga", "alert", 24, 17.1, { nextHour: { level_ft: 25.2, low_ft: 24.9, high_ft: 25.5, direction: "rising", crossing: "expected to reach minor flood level" } }),
  lv("kalu-ganga/magura", "Magura", "Kalu Ganga", "alert", 13.8, 13.1),
  lv("mahaweli-ganga/peradeniya", "Peradeniya", "Mahaweli Ganga", "stale", null, 16.4, { observedAt: iso(NOW - 5 * 3_600_000), nextHour: null }),
];
const reservoirs = [
  { id: "deduru-oya", name: "Deduru Oya", river: "Deduru Oya", district: "Kurunegala", status: "spilling", storagePercent: 73.9, storageFresh: true, flow: { kind: "spill", cusecs: 10400, source: "Irrigation Department", day: "2026-10-26" }, readingDay: "2026-10-26" },
  { id: "bowatenna", name: "Bowatenna", river: "Mahaweli Ganga", district: "Matale", status: "nodata", storagePercent: null, storageFresh: null, flow: null, readingDay: "2026-10-23", source: "Mahaweli Authority" },
];
const resolver = makeResolver(stations, PLACES, RIVERS, reservoirs.map((r) => ({ id: r.id, name: r.name })));
const data = { levels, reservoirs, resolver };
const res = (t) => resolveTarget(t, resolver);

// ---- intent
const want = (text, intent, o) => assert.equal(classify(text, { handle: "waterlevelslk", ...o }).intent, intent, text);
want("@waterlevelslk is Wellampitiya flooding?", "question", { hasTarget: true });
want("@waterlevelslk Kelani ganga level at Hanwella now?", "question", { hasTarget: true });
want("@waterlevelslk will Ratnapura flood tonight?", "question", { hasTarget: true });
want("@waterlevelslk Kalu ganga Ratnapura water level", "question", { hasTarget: true });
want("@waterlevelslk Deduru oya spilling?", "question", { hasTarget: true });
want("@waterlevelslk කළු ගඟ වතුර මට්ටම?", "question", { hasTarget: true });
want("@waterlevelslk களனி கங்கை நிலை என்ன?", "question", { hasTarget: true });
want("@waterlevelslk Hanwela eka kohomada? wathura mattama", "question", { hasTarget: true });
want("@waterlevelslk water in my street at Kolonnawa", "report", { hasTarget: true });
want("@waterlevelslk our road is flooded here", "report");
want("@waterlevelslk is my street flooded?", "question");
want("@waterlevelslk මෙහේ වතුර ආවා", "report");
want("@waterlevelslk help we are trapped in Kaduwela", "emergency", { hasTarget: true });
want("@waterlevelslk need rescue please, water in the house", "emergency");
want("@waterlevelslk උදව් කරන්න බේරගන්න", "emergency");
want("@waterlevelslk காப்பாற்ற உதவி வேண்டும்", "emergency");
want("@waterlevelslk you guys are useless", "offtopic");
want("@waterlevelslk fuck off bot", "abuse");
want("@waterlevelslk follow me back, crypto giveaway", "spam");
want("@waterlevelslk @a @b @c @d check this", "spam");
want("@waterlevelslk thanks!", "thanks");
want("@waterlevelslk what's the weather in Kandy", "offtopic", { hasTarget: true });
want("@waterlevelslk hello", "offtopic");
want("@waterlevelslk your Hanwella reading is wrong", "correction", { hasTarget: true });
want("@waterlevelslk https://example.com/x", "offtopic");
assert.equal(cleanText("@waterlevelslk @x hi https://t.co/abc  there"), "hi there");

// ---- bots and who is talking to us
assert.ok(looksLikeBot({ username: "news_bot", name: "News" }));
assert.ok(looksLikeBot({ username: "alerts24", description: "Automated account posting RSS" }));
assert.ok(!looksLikeBot({ username: "nimal_p", name: "Nimal Perera", description: "Colombo, cricket" }));
assert.ok(directedAtUs({ text: "@waterlevelslk hi" }, "99", "waterlevelslk"));
assert.ok(directedAtUs({ text: "hello", inReplyToUserId: "99" }, "99", "waterlevelslk"));
assert.ok(!directedAtUs({ text: "@friend look @waterlevelslk" }, "99", "waterlevelslk"));

// ---- which place
const lab = (t) => { const r = res(t); return r ? `${r.kind}:${r.label}` : null; };
assert.equal(lab("is Wellampitiya flooding?"), "place:Wellampitiya");
assert.equal(lab("Kelani ganga level at Hanwella now?"), "place:Hanwella", "a town named next to a river is the answer");
assert.equal(lab("Hanwela eka kohomada"), "place:Hanwella");
assert.equal(lab("Rathnapura wathura"), "place:Ratnapura");
assert.equal(lab("Kalu ganga level"), "river:Kalu Ganga");
assert.equal(lab("කළු ගඟ වතුර මට්ටම?"), "river:Kalu Ganga", "Sinhala river name beats a loose guess");
assert.equal(lab("களனி கங்கை நிலை என்ன?"), "river:Kelani Ganga");
assert.equal(lab("කොළඹ වතුර"), "place:Colombo");
assert.equal(lab("Deduru oya spilling?"), "reservoir:Deduru Oya");
assert.equal(lab("Is the Deduru Oya river high?"), "river:Deduru Oya" , "no reservoir word: the river");
assert.equal(lab("Bowatenna wewa gates open?"), "reservoir:Bowatenna");
assert.equal(res("how is the water level now please"), null);
assert.equal(res("what is the best pizza in town"), null);

// ---- facts and templates
{
  const a = buildAnswer(res("is Wellampitiya flooding?"), levels, reservoirs, NOW);
  assert.equal(a.kind, "town");
  assert.deepEqual(validateReply(a.template, { facts: a.facts, must: [], names: a.names, recent: [], closing: true }), []);
  assert.ok(tweetLength(a.template) <= 280);
  assert.match(a.template, /Wellampitiya/); assert.match(a.template, /2\.3 ft/); assert.match(a.template, /11:05 am|11:0\d am/);
  assert.doesNotMatch(a.template, /flooded streets|street flooding/i);
  assert.equal(a.facts.gauges[0].level_ft, 2.3);
  const r = buildAnswer(res("Ratnapura level"), levels, reservoirs, NOW);
  assert.match(r.template, /could reach the minor flood level/, "a crossing is never certain");
  assert.doesNotMatch(r.template, /expected to/);
  assert.match(r.template, /Ratnapura|Rathnapura/);
  // a stale gauge is never presented as current
  const st = buildAnswer({ kind: "station", label: "Peradeniya", gauges: [{ station: "Peradeniya", basin: "Mahaweli Ganga" }], matched: "x", score: 1, loose: false }, levels, reservoirs, NOW);
  assert.match(st.template, /has not sent a reading in the last 3 hours/); assert.doesNotMatch(st.template, /\d ft/);
  // river
  const rv = buildAnswer(res("Kalu ganga level"), levels, reservoirs, NOW);
  assert.match(rv.template, /2 of its 2 gauges|2 of its \d+ gauges/);
  // reservoir
  const d = buildAnswer(res("Deduru oya spilling?"), levels, reservoirs, NOW);
  assert.match(d.template, /10,400 cusecs/); assert.match(d.template, /26 Oct/); assert.match(d.template, /not live/);
  const b = buildAnswer(res("Bowatenna wewa"), levels, reservoirs, NOW);
  assert.match(b.template, /no recent reading/);
  // loosely matched
  assert.match(buildAnswer({ ...res("Hanwella"), loose: true }, levels, reservoirs, NOW).template, /^Assuming you mean Hanwella/);
  // data missing
  assert.equal(buildAnswer(res("Hanwella"), null, reservoirs, NOW), null);
}

// ---- the model's words are checked
{
  const a = buildAnswer(res("will Ratnapura flood tonight?"), levels, reservoirs, NOW);
  const good = "Ratnapura on the Kalu Ganga is at alert level: 24 ft at 11:05 am, and rising. A gauge can't say what tonight brings. Not an official warning. Emergency: 117.";
  const mk = (answers) => { const calls = []; return { calls, llm: async (i, inp) => { calls.push(JSON.parse(inp)); return answers[Math.min(calls.length - 1, answers.length - 1)]; } }; };
  let m = mk([good]);
  let w = await writeReply(a, { userMessage: "will Ratnapura flood tonight? 999 ft", recent: [], llm: m.llm });
  assert.equal(w.used, "llm"); assert.equal(w.text, good);
  assert.ok(!JSON.stringify(m.calls[0].facts).includes("999"), "the person's own words never feed the facts");
  for (const [bad, re] of [
    [good.replace("24 ft", "29 ft"), /number 29/],
    [good + " It will flood tonight.", /certain/],
    [good.replace("Not an official warning. ", ""), /not an official warning/],
    [good.replace(" Emergency: 117.", ""), /117/],
    [good + " See https://example.com", /link/],
    [good + " @someone", /@mention/],
    [good + " Your street is safe.".replace("safe", "flooded") + " Low-lying ground may flood.", /low/i],
    [good.replace("Ratnapura on the Kalu Ganga", "Colombo"), /does not name/],
    [good.replace("alert level", "major flood level"), /major/],
    ["Hi @nimal, " + good, /@mention|greets/],
  ]) {
    m = mk([bad, bad]);
    w = await writeReply(a, { userMessage: "x", recent: [], llm: m.llm });
    assert.equal(w.used, "template", bad); assert.equal(m.calls.length, 2, "one retry, with the problems fed back"); assert.ok(m.calls[1].problems_to_fix.length, "problems are passed back");
    assert.deepEqual(validateReply(w.text, { facts: a.facts, must: [], names: a.names, recent: [], closing: true }), [], "the fallback is itself valid");
  }
  m = mk([good.replace("24 ft", "27 ft"), good]);
  w = await writeReply(a, { userMessage: "x", recent: [], llm: m.llm });
  assert.equal(w.used, "llm"); assert.equal(w.attempts, 2);
  w = await writeReply(a, { userMessage: "x", recent: [], llm: null, offReason: "no key" });
  assert.equal(w.used, "template"); assert.equal(w.why, "no key");
  w = await writeReply(a, { userMessage: "x", recent: [good], llm: mk([good, good]).llm });
  assert.equal(w.used, "template", "an identical recent reply is not reused");
  w = await writeReply(a, { userMessage: "x", recent: [], llm: async () => { throw new Error("boom"); } });
  assert.equal(w.used, "template");
}

// ---- fixed replies
for (const k of ["emergency", "report", "correction", "notfound", "unavailable", "welcome"])
  for (let v = 0; v < FIXED_VARIANTS; v++) {
    const t = fixedReply(k, { place: "Kolonnawa", variant: v });
    assert.ok(tweetLength(t) <= 280, `${k} ${v} length ${tweetLength(t)}`);
    assert.deepEqual(validateFixed(t, k), [], `${k} ${v}`);
  }
assert.match(fixedReply("emergency"), /117/); assert.match(fixedReply("emergency"), /119/); assert.match(fixedReply("emergency"), /1990/);
assert.match(fixedReply("report", { place: "Kolonnawa" }), /Did the streets near you get water\?/);
assert.doesNotMatch(fixedReply("report"), /(?<!can't )(?<!cannot )\bconfirm(ed|s)?\b/i);
assert.notEqual(fixedReply("emergency", { variant: 0 }), fixedReply("emergency", { variant: 1 }));

// ---- limits
{
  const g = { intent: "question", now: NOW, createdAt: NOW - 60_000, limits: DEFAULT_LIMITS, isSelf: false, isBot: false, blocked: false, directed: true, repliesToday: 0, userLastReplyMs: null, userLastEmergencyMs: null, conversationReplies: 0, spentUsd: 0 };
  assert.deepEqual(mayReply(g), { ok: true });
  const no = (o, re) => { const v = mayReply({ ...g, ...o }); assert.equal(v.ok, false); assert.match(v.why, re); };
  no({ isSelf: true }, /our own/); no({ isBot: true }, /bot/); no({ blocked: true }, /blocked/); no({ directed: false }, /not addressed/);
  no({ createdAt: NOW - 7 * 3_600_000 }, /too old/);
  no({ userLastReplyMs: NOW - 5 * 60_000 }, /10 minutes/);
  assert.equal(mayReply({ ...g, userLastReplyMs: NOW - 11 * 60_000 }).ok, true);
  no({ conversationReplies: 2 }, /conversation/);
  no({ repliesToday: 30 }, /daily/);
  no({ spentUsd: 8.5 }, /budget/);
  // emergencies skip the cap, the budget and the conversation limit, never the 10-minute / bot rules
  const e = { ...g, intent: "emergency", repliesToday: 30, spentUsd: 9.9, conversationReplies: 2 };
  assert.equal(mayReply(e).ok, true);
  assert.equal(mayReply({ ...e, repliesToday: 45 }).ok, false);
  assert.equal(mayReply({ ...e, userLastEmergencyMs: NOW - 60_000 }).ok, false);
  assert.equal(mayReply({ ...e, userLastReplyMs: NOW - 60_000 }).ok, true, "a question answered a minute ago does not block a cry for help");
  assert.equal(mayReply({ ...e, isBot: true }).ok, false);
}

// ---- modes
assert.equal(replyMode({}).mode, "dry");
assert.equal(replyMode({ X_REPLIES_MODE: "off" }).mode, "off");
assert.equal(replyMode({ X_POSTING: "off", X_REPLIES_MODE: "live" }).mode, "off");
assert.equal(replyMode({ X_REPLIES_MODE: "live" }).mode, "dry", "live replies need live posting and keys");
const KEYS = { X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" };
assert.equal(replyMode({ X_REPLIES_MODE: "live", X_POSTING: "live", ...KEYS }).mode, "live");
assert.equal(configOf({}).limits.dailyCap, 30); assert.equal(configOf({ X_REPLY_DAILY_CAP: "5" }).limits.dailyCap, 5); assert.equal(configOf({}).dm, false);

// ---- the whole run against a fake D1, X and Slack
const makeDb = () => {
  const db = new DatabaseSync(":memory:");
  return async (sql, params = []) => { const s = db.prepare(sql); return /^\s*select/i.test(sql) ? s.all(...params) : (s.run(...params), []); };
};
const mention = (id, text, authorId, o = {}) => ({ id, text, author_id: authorId, conversation_id: id, in_reply_to_user_id: null, created_at: iso(NOW - 120_000), ...o });
function world(env, { mentions = [], users = {}, dms = [], dmStatus = 200 } = {}) {
  const calls = { slack: [], posts: [], dms: [], dmReads: 0, mentionReads: 0, mentionQueries: [], me: 0 };
  const doFetch = async (url, init = {}) => {
    url = String(url);
    if (url === "https://hooks.example/slack") { calls.slack.push(JSON.parse(init.body).text); return new Response("ok"); }
    if (url.startsWith("https://api.x.com/2/users/me")) { calls.me++; return new Response(JSON.stringify({ data: { id: "99", username: "waterlevelslk" } })); }
    if (url.includes("/mentions")) { calls.mentionReads++; calls.mentionQueries.push(url); const since = new URL(url).searchParams.get("since_id"); const d = mentions.filter((m) => !since || BigInt(m.id) > BigInt(since)); return new Response(JSON.stringify({ data: d, includes: { users: Object.entries(users).map(([id, u]) => ({ id, ...u })) }, meta: {} })); }
    if (url.includes("/dm_events")) { calls.dmReads++; if (dmStatus !== 200) return new Response(JSON.stringify({ title: "Forbidden", detail: "missing dm.read" }), { status: dmStatus }); return new Response(JSON.stringify({ data: dms, includes: { users: Object.entries(users).map(([id, u]) => ({ id, ...u })) } })); }
    if (url.includes("/dm_conversations/with/")) { calls.dms.push(JSON.parse(init.body).text); return new Response(JSON.stringify({ data: { dm_event_id: "d" + calls.dms.length } }), { status: 201 }); }
    if (url === "https://api.x.com/2/tweets") { const b = JSON.parse(init.body); calls.posts.push(b); return new Response(JSON.stringify({ data: { id: String(5000 + calls.posts.length) } }), { status: 201 }); }
    return new Response("{}", { status: 404 });
  };
  return { calls, doFetch, env: { SLACK_WEBHOOK_URL: "https://hooks.example/slack", ...KEYS, ...env } };
}
const U = { 1: { username: "nimal_p", name: "Nimal" }, 2: { username: "kamala", name: "Kamala" }, 3: { username: "alerts_bot", name: "Alerts" }, 4: { username: "rude", name: "R" }, 5: { username: "thanker", name: "T" }, 6: { username: "scared", name: "S" } };
const sample = [
  mention("101", "@waterlevelslk is Wellampitiya flooding?", "1"),
  mention("102", "@waterlevelslk Hanwella level now?", "2"),
  mention("103", "@waterlevelslk Deduru oya spilling?", "3"), // a bot
  mention("104", "@waterlevelslk you are useless, fuck off", "4"),
  mention("105", "@waterlevelslk thanks!", "5"),
  mention("106", "@waterlevelslk help we are trapped in Kaduwela", "6"),
  mention("107", "@waterlevelslk and Galle level now?", "1"), // same person within 10 minutes
  mention("108", "@friend have you seen @waterlevelslk", "2"), // not to us
  mention("109", "@waterlevelslk water in my street at Kolonnawa", "5"),
  mention("110", "@waterlevelslk is Galle safe?", "2", { created_at: iso(NOW - 8 * 3_600_000) }), // too old
];
const good = (name) => async () => `${name} gauge reading is in the facts. Not an official warning. Emergency: 117.`;

{ // DRY (the default): drafts to Slack, nothing to X, and a second run does not repeat
  const w = world({}, { mentions: sample, users: U }); const query = makeDb();
  const r = await run({ env: w.env, doFetch: w.doFetch, query, now: NOW, data, llm: null });
  assert.equal(r.mode, "dry");
  assert.equal(w.calls.posts.length, 0, "dry never posts");
  const rows = await query("SELECT mention_id, intent, status, reply_text FROM x_replies ORDER BY mention_id");
  const by = Object.fromEntries(rows.map((x) => [x.mention_id, x]));
  assert.equal(by["101"].status, "dry"); assert.equal(by["101"].intent, "question");
  assert.equal(by["102"].status, "dry");
  assert.equal(by["103"].status, "skipped", "never another bot");
  assert.equal(by["104"].status, "ignored", "abuse gets nothing");
  assert.equal(by["105"].status, "ignored", "thanks gets nothing");
  assert.equal(by["106"].status, "dry"); assert.equal(by["106"].intent, "emergency"); assert.match(by["106"].reply_text, /117/);
  assert.equal(by["107"].status, "skipped", "not twice in 10 minutes");
  assert.equal(by["108"].status, "skipped");
  assert.equal(by["109"].status, "dry"); assert.equal(by["109"].intent, "report");
  assert.equal(by["110"].status, "skipped", "too old");
  const slack = w.calls.slack.join("\n---\n");
  assert.match(slack, /DRY RUN REPLY/); assert.match(slack, /HIGH PRIORITY/); assert.match(slack, /<!channel>/); assert.match(slack, /Report from @thanker/);
  assert.ok(w.calls.slack.length >= 10, "every notification is mirrored to Slack");
  for (const id of ["nimal_p", "kamala", "alerts_bot", "rude", "thanker", "scared"]) assert.ok(slack.includes(`@${id}`), id);
  assert.match(slack, /No reply: abuse/); assert.match(slack, /looks like another bot/);
  const n = w.calls.slack.length;
  const again = await run({ env: w.env, doFetch: w.doFetch, query, now: NOW + 60_000, data, llm: null });
  assert.equal(again.handled, 0); assert.equal(w.calls.slack.length, n, "nothing is shown twice");
  assert.match(w.calls.mentionQueries.at(-1), /since_id=110/, "since_id is remembered");
  assert.equal(w.calls.me, 1, "our id is looked up once");
}

{ // LIVE: replies are sent as replies to the mention; emergency numbers; duplicate guard; daily cap
  const w = world({ X_REPLIES_MODE: "live", X_POSTING: "live", X_REPLY_DAILY_CAP: "2" }, { mentions: sample.slice(0, 6), users: U }); const query = makeDb();
  const r = await run({ env: w.env, doFetch: w.doFetch, query, now: NOW, data, llm: null });
  assert.equal(r.mode, "live");
  const sent = w.calls.posts;
  assert.ok(sent.every((p) => p.reply?.in_reply_to_tweet_id), "all are replies");
  assert.ok(sent.every((p) => tweetLength(p.text) <= 280 && !/https?:\/\//.test(p.text) && !/@/.test(p.text)));
  const em = sent.find((p) => p.reply.in_reply_to_tweet_id === "106");
  assert.ok(em && /117/.test(em.text) && /119/.test(em.text), "the emergency reply goes out even over the daily cap");
  const rows = await query("SELECT mention_id, status FROM x_replies");
  assert.equal(rows.filter((x) => x.status === "posted").length, 3, "2 answers (cap) + the emergency");
  assert.ok(rows.some((x) => x.status === "skipped"), "the third question hit the cap");
  assert.ok(w.calls.slack.some((s) => /HIGH PRIORITY/.test(s)));
}

{ // LIVE with the model: its text goes out only when it passes the checks
  const w = world({ X_REPLIES_MODE: "live", X_POSTING: "live" }, { mentions: [mention("201", "@waterlevelslk Hanwella level now?", "2")], users: U }); const query = makeDb();
  const llm = async () => "Hanwella is at 99.9 ft. Not an official warning. Emergency: 117.";
  await run({ env: w.env, doFetch: w.doFetch, query, now: NOW, data, llm });
  assert.ok(!w.calls.posts[0].text.includes("99.9"), "an invented number never goes out");
  assert.match(w.calls.posts[0].text, /14\.1 ft/);
}

{ // failures: 429 pauses; a duplicate-content rejection tries the other wording
  const w = world({ X_REPLIES_MODE: "live", X_POSTING: "live" }, { mentions: [mention("301", "@waterlevelslk water in my street at Kolonnawa", "1")], users: U }); const query = makeDb();
  const inner = w.doFetch; let seen = 0;
  w.doFetch = async (url, init) => { if (String(url) === "https://api.x.com/2/tweets") { seen++; if (seen === 1) return new Response(JSON.stringify({ detail: "You are not allowed to create a Tweet with duplicate content." }), { status: 403 }); } return inner(url, init); };
  await run({ env: w.env, doFetch: w.doFetch, query, now: NOW, data, llm: null });
  assert.equal(seen, 2); assert.equal((await query("SELECT status FROM x_replies WHERE mention_id='301'"))[0].status, "posted");
  const w2 = world({ X_REPLIES_MODE: "live", X_POSTING: "live" }, { mentions: [mention("401", "@waterlevelslk Hanwella level now?", "1")], users: U });
  const q2 = makeDb(); const i2 = w2.doFetch;
  w2.doFetch = async (url, init) => String(url) === "https://api.x.com/2/tweets" ? new Response(JSON.stringify({ title: "Too Many Requests" }), { status: 429, headers: { "x-rate-limit-reset": String(Math.floor(NOW / 1000) + 900) } }) : i2(url, init);
  await run({ env: w2.env, doFetch: w2.doFetch, query: q2, now: NOW, data, llm: null });
  assert.ok(Number(JSON.parse((await q2("SELECT value FROM x_state WHERE key='meta'"))[0].value).pauseUntil) > NOW, "a 429 pauses posting and replies");
  const again = await run({ env: w2.env, doFetch: w2.doFetch, query: q2, now: NOW + 60_000, data, llm: null });
  assert.equal(again.paused, true);
}

{ // off, no keys, kill switch: nothing is read
  for (const env of [{ X_REPLIES_MODE: "off" }, { X_POSTING: "off" }]) { const w = world(env, { mentions: sample, users: U }); const r = await run({ env: w.env, doFetch: w.doFetch, query: makeDb(), now: NOW, data }); assert.equal(r.mode, "off"); assert.equal(w.calls.mentionReads, 0); }
  const w = world({ X_API_KEY: "" }, { mentions: sample, users: U }); await run({ env: w.env, doFetch: w.doFetch, query: makeDb(), now: NOW, data }); assert.equal(w.calls.mentionReads, 0);
}

{ // read cap
  const w = world({ X_REPLY_READ_CAP: "10" }, { mentions: sample, users: U }); const query = makeDb();
  await run({ env: w.env, doFetch: w.doFetch, query, now: NOW, data, llm: null });
  const second = await run({ env: w.env, doFetch: w.doFetch, query, now: NOW + 300_000, data, llm: null });
  assert.equal(second.skipped, "read cap");
}

{ // direct messages: off unless X_DM=on; first look marks old ones seen; one welcome / answer per conversation per day
  const dm = (id, text, sender) => ({ id, text, sender_id: sender, dm_conversation_id: `99-${sender}`, created_at: iso(NOW - 60_000), event_type: "MessageCreate" });
  let w = world({}, { mentions: [], users: U, dms: [dm("9001", "hello", "1")] });
  await run({ env: w.env, doFetch: w.doFetch, query: makeDb(), now: NOW, data, llm: null });
  assert.equal(w.calls.dmReads, 0, "X_DM defaults to off: no DM call at all");
  w = world({ X_DM: "on", X_REPLIES_MODE: "live", X_POSTING: "live" }, { mentions: [], users: U, dms: [dm("9001", "old message", "1")] }); const query = makeDb();
  await run({ env: w.env, doFetch: w.doFetch, query, now: NOW, data, llm: null });
  assert.equal(w.calls.dms.length, 0, "the first look only marks what is there");
  w.calls.dmReads = 0;
  const w2 = world({ X_DM: "on", X_REPLIES_MODE: "live", X_POSTING: "live" }, { mentions: [], users: U, dms: [dm("9004", "and Ratnapura?", "2"), dm("9003", "Hanwella level?", "2"), dm("9002", "hi", "1"), dm("9001", "old message", "1")] });
  await run({ env: w2.env, doFetch: w2.doFetch, query, now: NOW + 300_000, data, llm: null });
  assert.equal(w2.calls.dms.length, 2, "one for Nimal's welcome, one for Kamala's answer; the second Kamala message waits a day");
  assert.ok(w2.calls.dms.some((t) => /automated account/.test(t)) && w2.calls.dms.some((t) => /14\.1 ft/.test(t)));
  // without the DM permission: a clear note, mentions still work
  const w3 = world({ X_DM: "on" }, { mentions: sample.slice(0, 1), users: U, dmStatus: 403 }); const q3 = makeDb();
  const r3 = await run({ env: w3.env, doFetch: w3.doFetch, query: q3, now: NOW, data, llm: null });
  assert.equal(r3.handled, 1); assert.ok(w3.calls.slack.some((s) => /Direct message/.test(s)));
}

// ---- plan: the five typical questions (mock model off: templates)
for (const t of ["is Wellampitiya flooding?", "Kelani ganga level at Hanwella now?", "will Ratnapura flood tonight?", "Deduru oya spilling?", "Peradeniya level?"]) {
  const p = await planReply({ text: "@waterlevelslk " + t, id: "1", source: "mention" }, { data, llm: null, now: NOW, recent: [] });
  assert.equal(p.intent, "question"); assert.ok(p.reply.text && /117/.test(p.reply.text), t);
}
assert.match((await planReply({ text: "@waterlevelslk Zzzzville flooding?", id: "2", source: "mention" }, { data, llm: null, now: NOW })).reply.fixed, /notfound/);
assert.equal((await planReply({ text: "@waterlevelslk is Hanwella ok?", id: "3", source: "mention" }, { data: { ...data, levels: null }, llm: null, now: NOW })).reply.fixed, "unavailable");
assert.match(feedMessage({ item: { id: "1", text: "@waterlevelslk hi", source: "mention" }, plan: { intent: "offtopic", why: "x" }, user: { username: "u" }, outcome: "ignored", why: "nothing to answer" }), /open on X/);

// ---- schema file matches
{
  const sql = readFileSync(new URL("../d1/0007_x_replies.sql", import.meta.url), "utf8");
  for (const s of REPLIES_SCHEMA) assert.ok(sql.includes(s), `0007_x_replies.sql is missing: ${s.slice(0, 60)}`);
}

// ================= reposts =================
assert.deepEqual(parseAccounts(undefined), ["dmc_lk", "SLMetDept"]);
assert.deepEqual(parseAccounts("@A_b, bad handle!, c"), ["A_b", "c"]);
assert.match(repostQuery(["dmc_lk", "SLMetDept"]), /^\(from:dmc_lk OR from:SLMetDept\) \(flood OR .*\) -is:retweet -is:reply$/);
assert.ok(repostQuery(parseAccounts("a,b,c,d,e,f,g")).length < 512, "recent search queries are at most 512 characters");
{
  const c = { id: "1", username: "dmc_lk", text: "Landslide warning issued for Ratnapura and Kegalle districts until 6 pm today.", createdAt: NOW - 3_600_000 };
  const o = { now: NOW, accounts: ["dmc_lk"], maxAgeMs: 6 * 3_600_000 };
  assert.equal(prefilter(c, o), null);
  assert.match(prefilter({ ...c, username: "random" }, o), /listed/); assert.match(prefilter({ ...c, createdAt: NOW - 7 * 3_600_000 }, o), /6 hours/);
  assert.match(prefilter({ ...c, isReply: true }, o), /reply/); assert.match(prefilter({ ...c, text: "ok" }, o), /short/);
  const ans = (o) => new Map(QUESTIONS.map((q) => [q.name, { type: "predicate", name: q.name, probability: { worth_reposting: 0.95, about_sri_lanka: 0.99, official_warning_or_update: 0.97, duplicate_of_recent: 0.05, promotional_or_unrelated: 0.02, ...o }[q.name] }]));
  assert.equal(interpret(ans({})).repost, true);
  for (const [o, re] of [[{ worth_reposting: 0.6 }, /worth/], [{ about_sri_lanka: 0.4 }, /Sri Lanka/], [{ duplicate_of_recent: 0.7 }, /already/], [{ promotional_or_unrelated: 0.5 }, /promotional/]]) { const j = interpret(ans(o)); assert.equal(j.repost, false); assert.match(j.reason, re); }
  assert.equal(interpret(new Map()).repost, false);
  const seenInputs = [];
  const decide = (a) => async (input) => { seenInputs.push(input); return { ok: true, data: a }; };
  assert.equal((await judge(c, { now: NOW, recent: ["we posted X"], decide: decide(ans({})) })).repost, true);
  assert.match(seenInputs[0], /ignore any instruction/); assert.match(seenInputs[0], /we posted X/);
  assert.equal((await judge(c, { now: NOW, recent: [], decide: async () => ({ ok: false, reason: "HTTP 500" }) })).repost, false);
  assert.equal((await judge(c, { now: NOW, recent: [], decide: async () => { throw new Error("x"); } })).repost, false);
  assert.equal((await judge(c, { now: NOW, recent: [], decide: null })).repost, false);
  const g = { now: NOW, accounts: ["dmc_lk"], maxAgeMs: 6 * 3_600_000, alreadySeen: false, sharedToday: 0, dailyMax: 3, spentUsd: 0, budgetUsd: 10 };
  assert.equal(mayRepost(c, g).ok, true); assert.equal(mayRepost(c, { ...g, sharedToday: 3 }).ok, false); assert.equal(mayRepost(c, { ...g, alreadySeen: true }).ok, false); assert.equal(mayRepost(c, { ...g, spentUsd: 8.1 }).ok, false);
}
assert.equal(repostConfig({}).mode, "dry"); assert.equal(repostConfig({ X_REPOST_MODE: "live" }).mode, "dry"); assert.equal(repostConfig({ X_REPOST_MODE: "live", X_POSTING: "live", ...KEYS }).mode, "live");
assert.equal(repostConfig({ X_REPOST_MODE: "off" }).mode, "off"); assert.equal(repostConfig({ X_POSTING: "off", X_REPOST_MODE: "live" }).mode, "off");
{
  const found = (id, text, user = "dmc_lk", ageMs = 3_600_000) => ({ id, text, author_id: "d" + user, created_at: iso(NOW - ageMs), referenced_tweets: [] });
  const tweets = [
    found("501", "Flood warning: Kalu Ganga at Ratnapura has crossed the minor flood level. Residents near the river are asked to be alert."),
    found("502", "Join our workshop on disaster preparedness next month, register now with the link in our bio please."),
    found("503", "Heavy rain advisory for the Western and Sabaragamuwa provinces until tomorrow morning from the Met Department.", "SLMetDept"),
    found("504", "Flood warning for the Kelani basin issued by someone else entirely, watch the river today.", "randomuser"),
    found("505", "Landslide warning for the Badulla district, residents are urged to stay alert and evacuate if told to do so.", "dmc_lk", 8 * 3_600_000),
  ];
  const world2 = (env) => {
    const calls = { slack: [], retweets: [], search: [] };
    const doFetch = async (url, init = {}) => {
      url = String(url);
      if (url === "https://hooks.example/slack") { calls.slack.push(JSON.parse(init.body).text); return new Response("ok"); }
      if (url.includes("/users/me")) return new Response(JSON.stringify({ data: { id: "99", username: "waterlevelslk" } }));
      if (url.includes("/tweets/search/recent")) { calls.search.push(url); return new Response(JSON.stringify({ data: tweets, includes: { users: [{ id: "ddmc_lk", username: "dmc_lk" }, { id: "dSLMetDept", username: "SLMetDept" }, { id: "drandomuser", username: "randomuser" }] } })); }
      if (url.includes("/retweets")) { calls.retweets.push(JSON.parse(init.body).tweet_id); return new Response(JSON.stringify({ data: { retweeted: true } })); }
      return new Response("{}", { status: 404 });
    };
    return { calls, doFetch, env: { SLACK_WEBHOOK_URL: "https://hooks.example/slack", ...KEYS, ...env } };
  };
  const decide = async (input) => {
    const yes = /Flood warning: Kalu|Heavy rain advisory|Landslide warning/.test(input.split("RECENT_POSTS_WE_SHARED_START")[0]);
    const p = yes ? { worth_reposting: 0.95, about_sri_lanka: 0.99, official_warning_or_update: 0.95, duplicate_of_recent: 0.02, promotional_or_unrelated: 0.02 } : { worth_reposting: 0.1, about_sri_lanka: 0.9, official_warning_or_update: 0.1, duplicate_of_recent: 0.01, promotional_or_unrelated: 0.95 };
    return { ok: true, data: new Map(QUESTIONS.map((q) => [q.name, { type: "predicate", name: q.name, probability: p[q.name] }])) };
  };
  let w = world2({}); let query = makeDb();
  let r = await runReposts({ env: w.env, doFetch: w.doFetch, query, now: NOW, decide });
  assert.equal(r.mode, "dry"); assert.equal(w.calls.retweets.length, 0, "dry never reposts");
  assert.equal(r.reposted, 2, "the warning and the advisory; not the workshop, not a stranger, not the 8-hour-old one");
  const sl = w.calls.slack.join("\n");
  assert.match(sl, /DRY RUN REPOST/); assert.match(sl, /declined/); assert.match(sl, /not from a listed account|older than 6 hours/);
  assert.match(w.calls.search[0], /from%3Admc_lk/);
  assert.equal((await runReposts({ env: w.env, doFetch: w.doFetch, query, now: NOW + 60_000, decide })).reposted, 0, "never the same post twice");
  w = world2({ X_REPOST_MODE: "live", X_POSTING: "live", X_REPOST_DAILY_MAX: "1" }); query = makeDb();
  r = await runReposts({ env: w.env, doFetch: w.doFetch, query, now: NOW, decide });
  assert.deepEqual(w.calls.retweets, ["501"], "live: reposts the first confident yes, then the daily maximum stops it"); assert.equal(r.mode, "live");
  w = world2({ X_REPOST_MODE: "live", X_POSTING: "live" }); query = makeDb();
  await runReposts({ env: w.env, doFetch: w.doFetch, query, now: NOW, decide: async () => ({ ok: false, reason: "HTTP 500" }) });
  assert.equal(w.calls.retweets.length, 0, "if the model cannot be asked, nothing is reposted");
  w = world2({ X_REPOST_MODE: "off" }); assert.equal((await runReposts({ env: w.env, doFetch: w.doFetch, query: makeDb(), now: NOW, decide })).mode, "off"); assert.equal(w.calls.search.length, 0);
}

console.log("x-replies and x-reposts tests passed");
