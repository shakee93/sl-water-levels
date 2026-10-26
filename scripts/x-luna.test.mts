// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/x-luna.test.mts
// The AI writer for the X account (gpt-6-luna, mocked here): natural phrasing passes, invented numbers / links / @mentions /
// a missing disclaimer / low-spot talk fail, one retry with the problems fed back, then the template; no two identical
// openings; the path used (llm / template) is recorded and shown in the Slack preview. No real OpenAI call is made.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tweetLength, sharedWithRecent, composeRiversRising, MODEL_TARGET, composeGaugeRise, composeGaugeClear, composeStorm, composeSummary, composeWarning, lunaFacts, lunaWrite, validateLlmText, LUNA_INSTRUCTIONS, DISCLAIMER } from "../lib/xCompose.ts";
import { run, prepare, makeLlm, dryRunMessage, X_SCHEMA } from "./x-post.mjs";

const SITE = "https://sl-water-levels.vercel.app";
const NOW = Date.parse("2026-10-26T10:40:00Z"); // 4:10 pm in Colombo
const gf = (o = {}) => ({ station: "Ratnapura", river: "Kalu Ganga", tier: "alert", level: 21.34, mark: 21, alertMark: 21, trend: "rising", nextHour: { level: 21.5, low: 21.3, high: 21.8, direction: "rising", crossing: null }, url: `${SITE}/kalu-ganga/ratnapura`, at: NOW, ...o });
const ev = (o = {}) => ({ type: "gauge_rise", kind: "alert", gauges: [gf(o)] });
const post = (g = gf()) => ({ kind: "alert", facts: [g], ...composeGaugeRise([g]) });
const ctxOf = (type, facts, o = {}) => ({ type, facts: lunaFacts(type, facts), link: `${SITE}/x`, withLink: false, hashtags: ["#SriLanka", "#KaluGanga"], must: ["Ratnapura"], recent: [], ...o });
const good = "Kalu Ganga at Ratnapura is rising and just crossed the alert mark: 21.3 ft at 4:10 pm. If you're near the river in Ratnapura, keep an eye on it this evening. Not an official warning. Emergency: 117.";

// ---- the checker: natural phrasing passes
const c = ctxOf("gauge_rise", [gf()]);
assert.deepEqual(validateLlmText(good, c), []);
for (const t of [
  good.replace("21.3 ft", "21.30 ft"), // trailing zero
  good.replace("21.3 ft", "21 ft"), // rounded
  good.replace("4:10 pm", "4.10pm"), // time written another way
  good.replace("4:10 pm", "4:10 PM"),
  good.replace("Not an official warning.", "Not official, just what the gauge says."),
  good + " #KaluGanga",
  "⚠️ " + good,
  good.replace("Kalu Ganga at Ratnapura", "Ratnapura gauge on the Kalu Ganga"),
]) assert.deepEqual(validateLlmText(t, c), [], t);

// ---- the checker: rejects
const bad = (t, re, cx = c) => { const p = validateLlmText(t, cx); assert.ok(p.some((x) => re.test(x)), `${t} -> ${p.join("; ")}`); };
bad(good.replace("21.3 ft", "22.9 ft"), /number 22\.9/);
bad(good.replace("4:10 pm", "5:45 pm"), /number 45|number 5\b/);
bad(good.replace("this evening", "for the next 3 days"), /number 3 is not/);
bad(good + " https://example.com", /link/);
bad(good + " sl-water-levels.vercel.app", /link|web address/);
bad(good + " cc @DMCSriLanka", /@mention/);
bad(good.replace("Not an official warning. ", ""), /not an official warning/);
bad(good.replace(" Emergency: 117.", ""), /117/);
bad(good.replace("Emergency: 117", "Emergency: 119"), /number 119|117/);
bad(good.replace("Ratnapura is", "Colombo is").replace("in Ratnapura", "in Colombo"), /"Ratnapura" missing/);
bad(good + " #breaking", /hashtag/);
bad(good + " 🚨", /emoji/);
bad(good + " 🌧️ ⚠️", /more than one emoji/);
bad("This official warning says Ratnapura is rising, 21.3 ft at 4:10 pm. Not an official warning. Emergency: 117.", /"official"/);
bad(good.replace("alert mark", "major flood mark"), /major/);
bad(good + " People near canals may see water on the streets.", /canals|water on the streets/);
bad(good + " Low-lying ground may flood.", /low/i);
bad(good + " Please evacuate.", /evacuat/);
bad(good + " " + "x".repeat(280), /too long/);
bad(good.replace("is rising and just crossed", "is easing after it crossed"), /falling/, ctxOf("gauge_rise", [gf({ trend: "steady" })]));
bad("Rivers are calm across the island. Not an official warning. Emergency: 117.", /calm/, ctxOf("summary", { period: "morning", at: NOW, reporting: 40, assessed: 38, atAlert: [{ station: "Hanwella", tier: "alert" }], nearAlert: 0, rain: null, rainWindowH: 24, spilling: 0, url: SITE }, { must: [] }));
// numbers copied from the voice guide's examples must not pass
bad("Kalu Ganga at Ratnapura is rising and just crossed the alert mark: 21.3 ft at 4:10 pm (mark 21 ft). Hanwella 31.2 ft. Not an official warning. Emergency: 117.", /number 31\.2/);
assert.ok(LUNA_INSTRUCTIONS.includes("MADE UP") && LUNA_INSTRUCTIONS.includes("Not an official warning. Emergency: 117."));

// a relayed bulletin says we are not the source (and may say "official")
{
  const wf = { source: "Irrigation Department", severity: "alert", basins: ["Kalu Ganga"], issuedAt: NOW, releaseCusecs: 9000, bulletinUrl: `${SITE}/b`, url: `${SITE}/kalu-ganga` };
  const cx = ctxOf("warning", wf, { relay: true, must: ["Kalu Ganga"] });
  assert.deepEqual(validateLlmText("The Irrigation Department has put out an official flood alert for the Kalu Ganga basin, issued at 4:10 pm, with a release of about 9,000 cusecs. We're only passing it on, not the source. Emergency: 117.", cx), []);
  bad("The Irrigation Department has put out a flood alert for the Kalu Ganga basin at 4:10 pm. Emergency: 117.", /not the source/, cx);
}

// ---- lunaWrite: accepted, retry with the problems fed back, then the template
{
  const p = post();
  const calls = [];
  const llm = (answers) => async (instr, input) => { calls.push(JSON.parse(input)); return answers[Math.min(calls.length - 1, answers.length - 1)]; };

  let r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm: llm([good]) });
  assert.equal(r.used, "llm"); assert.equal(r.text, good); assert.equal(r.attempts, 1);
  assert.equal(calls[0].facts.gauges[0].level_ft, 21.3); assert.equal(calls[0].facts.gauges[0].time_sri_lanka, "4:10 pm");
  assert.ok(!JSON.stringify(calls[0]).includes("http"), "no URLs go to the model");

  calls.length = 0;
  r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm: llm([good.replace("21.3", "23.3"), good]) });
  assert.equal(r.used, "llm"); assert.equal(r.attempts, 2);
  assert.match(calls[1].problems_to_fix.join(), /number 23\.3/); assert.ok(calls[1].your_previous_answer.includes("23.3"));

  calls.length = 0;
  r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm: llm(["Totally invented 99 ft", "Still wrong 98 ft"]) });
  assert.equal(r.used, "template"); assert.equal(r.text, p.textNoLink); assert.equal(calls.length, 3, "two retries, no more"); assert.match(r.why, /rejected 3 times/);

  assert.equal((await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm: async () => { throw new Error("down"); } })).used, "template");
  assert.equal((await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm: async () => null })).used, "template");
  const none = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm: null, offReason: "no key" });
  assert.deepEqual([none.used, none.why, none.text], ["template", "no key", p.textNoLink]);

  // with a link: the code adds it (the model never writes one) and it counts as 23 characters
  r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: true, llm: llm([good]) });
  assert.equal(r.used, "llm"); assert.ok(r.text.endsWith(`\n${p.link}`));
  r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: true, llm: llm([good + " https://evil.example/x"]) });
  assert.equal(r.used, "template"); assert.equal(r.text, p.text);

  // a model that wraps the post in quotes still works
  r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm: llm([`"${good}"`]) });
  assert.equal(r.used, "llm"); assert.equal(r.text, good);
}

// ---- variety: an opening that repeats a recent post is sent back, and the second try is accepted
{
  const p = post();
  const other = good.replace(/^Kalu Ganga at Ratnapura is rising and just crossed the alert mark/, "Ratnapura on the Kalu Ganga has reached its alert line, reading").replace("If you're near the river in Ratnapura, keep an eye on it this evening.", "Worth a look if you live along it.");
  const seen = [];
  const llm = async (_i, input) => { seen.push(JSON.parse(input)); return seen.length === 1 ? good : other; };
  const r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm, recent: [good, "Morning! Rivers are calm."] });
  assert.equal(r.used, "llm"); assert.equal(r.attempts, 2); assert.equal(r.text, other);
  assert.match(seen[1].problems_to_fix.join(), /same words as a recent post/);
  assert.equal(seen[0].recent_posts.length, 2);
  // five posts in a row all begin differently
  const opens = ["Kalu Ganga at Ratnapura is rising", "Heads up, Ratnapura is over the alert mark", "Ratnapura gauge reads 21.3 ft at 4:10 pm", "Quick one for Ratnapura: the Kalu Ganga is up", "The Kalu Ganga has reached the alert mark at Ratnapura"];
  const recent = [];
  for (const o of opens) {
    const t = `${o}, 21.3 ft at 4:10 pm. Not an official warning. Emergency: 117.`;
    assert.deepEqual(validateLlmText(t, ctxOf("gauge_rise", [gf()], { recent })), [], t);
    recent.unshift(t);
  }
  assert.equal(new Set(recent.map((t) => t.split(" ").slice(0, 3).join(" "))).size, 5);
}

// ---- other kinds go through the same checker
{
  const sf = { period: "morning", at: NOW, reporting: 40, assessed: 38, atAlert: [], nearAlert: 0, rain: { mm: 12, place: "Colombo" }, rainWindowH: 24, spilling: 0, url: SITE };
  const cx = ctxOf("summary", sf, { must: [] });
  assert.deepEqual(validateLlmText("Morning! Rivers are calm across the island today: all 38 gauges are below their alert marks, with up to 12 mm of rain forecast near Colombo. Have a good one. Not an official warning. Emergency: 117.", cx), []);
  const clear = gf({ tier: "normal", level: 19.8, trend: "falling" });
  assert.deepEqual(validateLlmText("Good news from Ratnapura: the Kalu Ganga is back below the alert mark, 19.8 ft at 4:10 pm and easing. Not an official warning. Emergency: 117.", ctxOf("gauge_clear", [clear])), []);
  bad("Ratnapura is all clear 🌧️ 19.8 ft. Not an official warning. Emergency: 117.", /emoji/, ctxOf("gauge_clear", [clear]));
  const sto = { river: "Kalu Ganga", at: NOW, gauges: [gf()], url: SITE };
  assert.deepEqual(validateLlmText("Kalu Ganga at 4:10 pm: Ratnapura is at 21.3 ft, over the alert mark and rising. Forecast for the next hour is about 21.5 ft (likely 21.3 to 21.8). Not an official warning. Emergency: 117.", ctxOf("storm", sto, { must: ["Kalu Ganga", "Ratnapura"] })), []);
}

// ---- prepare(): llm / template path, shown in the Slack preview
{
  const e = ev();
  let r = await prepare(e, async () => good, { recent: [] });
  assert.equal(r.ai, true); assert.equal(r.text, good);
  assert.match(dryRunMessage({ n: 1, of: 1, kind: "alert", text: r.text, ai: r.ai, why: r.why }), /written by gpt-6-luna, every number checked/);
  r = await prepare(e, null, { offReason: "OPENAI_API_KEY is not set in GitHub, so the plain templates are used" });
  assert.equal(r.ai, false);
  assert.match(dryRunMessage({ n: 1, of: 1, kind: "alert", text: r.text, ai: r.ai, why: r.why }), /plain template \(OPENAI_API_KEY is not set in GitHub/);
  r = await prepare(e, async () => "Nonsense 99 ft", {});
  assert.equal(r.ai, false); assert.ok(r.text.includes(DISCLAIMER));
}

// ---- makeLlm: off without a key / when switched off; sends the model; per-run call cap
{
  assert.equal(makeLlm({}), null);
  assert.equal(makeLlm({ OPENAI_API_KEY: "k", X_AI_POLISH: "off" }), null);
  const bodies = [];
  const doFetch = async (url, init) => { bodies.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ text: "hi" }) }] }] })); };
  const llm = makeLlm({ OPENAI_API_KEY: "sk-test-fake", AI_MAX_CALLS_PER_HOUR: "2" }, doFetch);
  assert.equal(await llm("i", "x"), "hi");
  assert.equal(bodies[0].url, "https://api.openai.com/v1/responses"); assert.equal(bodies[0].body.model, "gpt-6-luna"); assert.equal(bodies[0].body.store, false);
  assert.equal(bodies[0].body.temperature, undefined);
  await llm("i", "x");
  assert.equal(await llm("i", "x"), null, "per-run call cap");
  assert.equal(bodies.length, 2);
  const t = makeLlm({ OPENAI_API_KEY: "k", X_AI_TEMPERATURE: "0.8" }, doFetch);
  await t("i", "x"); assert.equal(bodies[2].body.temperature, 0.8);
  assert.equal(await makeLlm({ OPENAI_API_KEY: "k" }, async () => new Response("no", { status: 500 }))("i", "x"), null);
}

// ---- a whole run with the mocked model: D1 records ai = 1 (llm) or 0 (template); the model is given the last posts
{
  const makeDb = () => { const db = new DatabaseSync(":memory:"); return async (sql, params = []) => { const s = db.prepare(sql); return /^\s*select/i.test(sql) ? s.all(...params) : (s.run(...params), []); }; };
  const iso = (ms) => new Date(ms).toISOString();
  const st = (id, station, river, status, level, now) => ({ id, station, river, status, level, unit: "ft", marks: { alert: 8, minor: 10, major: 12 }, trend: "rising", observedAt: iso(now - 600_000), url: `${SITE}/${id}`, nextHour: null });
  const snapOf = (status, level, now) => ({ now, site: SITE, stations: [st("kelani-ganga/hanwella", "Hanwella", "Kelani Ganga", status, level, now)], reservoirs: [], street: null, warnings: [], rain: null });
  const world = (env, answer) => {
    const calls = { slack: [], ai: [] };
    const doFetch = async (url, init) => {
      if (url === "https://hooks.example/slack") { calls.slack.push(JSON.parse(init.body).text); return new Response("ok"); }
      if (String(url).startsWith("https://api.openai.com")) { const b = JSON.parse(init.body); calls.ai.push(JSON.parse(b.input)); return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ text: answer(calls.ai.length) }) }] }] })); }
      return new Response("{}", { status: 404 });
    };
    return { calls, doFetch, env: { SLACK_WEBHOOK_URL: "https://hooks.example/slack", ...env } };
  };
  const EARLY = NOW - 7 * 3_600_000; // first sighting: nothing is said
  const hanwella = "Hanwella on the Kelani Ganga has reached the major flood level, 12.4 ft at 4:00 pm and rising. Please stay away from the river edge. Not an official warning. Emergency: 117.";
  const twice = async (w, query) => {
    await run({ env: w.env, doFetch: w.doFetch, query, snap: snapOf("normal", 4.2, EARLY), now: EARLY });
    w.calls.ai.length = 0;
    await run({ env: w.env, doFetch: w.doFetch, query, snap: snapOf("major", 12.4, NOW), now: NOW });
  };

  { // key present: the model's words are shown and recorded as ai = 1
    const w = world({ OPENAI_API_KEY: "sk-test-fake" }, () => hanwella); const query = makeDb();
    await twice(w, query);
    const row = (await query("SELECT ai, text FROM x_posts WHERE kind = 'alert'"))[0];
    assert.equal(row.ai, 1); assert.ok(row.text.startsWith("Hanwella on the Kelani Ganga"));
    assert.ok(w.calls.slack.some((t) => /written by gpt-6-luna/.test(t)));
    assert.equal(w.calls.ai.length, 1);
  }
  { // no key: templates, ai = 0, Slack says why
    const w = world({}, () => "unused"); const query = makeDb();
    await twice(w, query);
    assert.equal((await query("SELECT ai FROM x_posts WHERE kind = 'alert'"))[0].ai, 0); assert.equal(w.calls.ai.length, 0);
    assert.ok(w.calls.slack.some((t) => /plain template \(OPENAI_API_KEY is not set in GitHub/.test(t)));
  }
  { // the model keeps inventing numbers: template, only two calls, Slack says why
    const w = world({ OPENAI_API_KEY: "sk-test-fake" }, () => "Hanwella is at 99.9 ft. Not an official warning. Emergency: 117."); const query = makeDb();
    await twice(w, query);
    assert.equal((await query("SELECT ai FROM x_posts WHERE kind = 'alert'"))[0].ai, 0);
    assert.equal(w.calls.ai.length, 3);
    assert.ok(w.calls.slack.some((t) => /plain template \(model text rejected 3 times/.test(t)));
  }
  { // the writer is shown the last posts
    const w = world({ OPENAI_API_KEY: "sk-test-fake" }, () => hanwella); const query = makeDb();
    for (const s of X_SCHEMA) await query(s);
    await query("INSERT INTO x_posts (ts, day, kind, dedupe_key, mode, status, text) VALUES (1, '2026-10-25', 'alert', 'k1', 'dry', 'dry', 'Earlier post about the Kalu Ganga')");
    await twice(w, query);
    assert.ok(w.calls.ai[0].recent_posts.includes("Earlier post about the Kalu Ganga"));
  }
}

// ---- forecasts are never certain
bad(good.replace("keep an eye on it this evening", "it is expected to reach the minor flood level"), /certain/);
bad(good.replace("keep an eye on it this evening", "it will reach minor flood level"), /certain|minor/);
bad(good.replace("keep an eye on it this evening", "Ratnapura will flood tonight"), /certain/);
assert.deepEqual(validateLlmText(good.replace("keep an eye on it this evening", "it could reach the alert level in the next hour"), c), []);
assert.deepEqual(validateLlmText(good.replace("keep an eye on it this evening", "it may reach the alert level in the next hour"), c), []);
assert.equal(lunaFacts("storm", { river: "K", at: NOW, gauges: [gf({ nextHour: { level: 21.5, low: 21.3, high: 21.8, direction: "rising", crossing: "expected to reach minor flood level" } })] }).gauges[0].next_hour_forecast.may_cross, "could reach minor flood level");
// number words need their number in the facts
bad(good.replace("this evening", "for the next five hours"), /"five"/);

// ---- variety: nothing reused from the last posts
{
  const a = "Kalu Ganga at Ratnapura is rising and just crossed the alert mark: 21.3 ft at 4:10 pm. Worth a look if you live along it. Not an official warning. Emergency: 117.";
  assert.equal(sharedWithRecent(a, [a.replace("Worth a look if you live along it.", "Check back later.")]) != null, true, "same first sentence");
  assert.equal(sharedWithRecent("Ratnapura is above the alert mark at 21.3 ft, up since morning. Check back later. Not an official warning. Emergency: 117.", [a]), null);
  assert.equal(sharedWithRecent("Different words entirely. Worth a look if you live along it. Not an official warning. Emergency: 117.", [a]) != null, true, "a whole recent sentence reused");
  assert.equal(sharedWithRecent("Water is climbing quickly at the Ratnapura gauge right now. Take care near the river. Not an official warning. Emergency: 117.", ["Hanwella is up. Take care near the river. Not an official warning. Emergency: 117."]) != null, true, "Take care near the river repeated");
  assert.equal(sharedWithRecent("Calm morning on the rivers. Not an official warning. Emergency: 117.", ["Calm afternoon here. Not an official warning. Emergency: 117."]), null, "the closing is ignored");
  assert.equal(sharedWithRecent("Six words in a row are shared here today. Not official. 117.", ["Another post: six words in a row are shared. Not official. 117."]) != null, true, "6-word run");
  bad("Kalu Ganga at Ratnapura is rising and just crossed the alert mark: 21.3 ft at 4:10 pm. Check back later. Not an official warning. Emergency: 117.", /repeats wording/, ctxOf("gauge_rise", [gf()], { recent: [a.replace("Kalu Ganga at Ratnapura is rising", "Ratnapura is rising")] }));
  assert.match(LUNA_INSTRUCTIONS, /Take care near the river/); assert.match(LUNA_INSTRUCTIONS, /six or more words/); assert.match(LUNA_INSTRUCTIONS, /could reach/);
}

// ---- length: the model is told 260 (276 - link); a too-long answer gets a shorter-please; at most 3 calls
{
  const p = post();
  const seen = [];
  const long = good + " " + "x ".repeat(60);
  const llm = async (_i, input) => { seen.push(JSON.parse(input)); return seen.length < 3 ? long : good; };
  const r = await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: false, llm });
  assert.equal(r.used, "llm"); assert.equal(r.attempts, 3); assert.equal(seen[0].max_characters, MODEL_TARGET); assert.equal(MODEL_TARGET, 260);
  assert.match(seen[1].problems_to_fix.join(), /too long/); assert.ok(seen[1].shorten); assert.ok(seen[2].shorten);
  const w = [];
  await lunaWrite(p, { type: "gauge_rise", facts: [gf()], withLink: true, llm: async (_i, input) => { w.push(JSON.parse(input)); return good; } });
  assert.equal(w[0].max_characters, 260 - 24);
}

// ---- the national "rivers rising" post
{
  const rf = { at: NOW, count: 4, url: `${SITE}/x`, gauges: [gf(), gf({ station: "Holombuwa", river: "Kelani Ganga", level: 13, alertMark: 9.8, url: `${SITE}/k` }), gf({ station: "Dunamale", river: "Aththanagalu Oya", level: 10.8, alertMark: 11, tier: "watch" })] };
  const t = composeRiversRising(rf);
  assert.match(t.textNoLink, /4 rivers/); assert.ok(tweetLength(t.text) <= 280 && tweetLength(t.textNoLink) <= 280); assert.match(t.textNoLink, /and 1 more/);
  const lf = lunaFacts("rivers_rising", rf);
  assert.equal(lf.rivers_rising_total, 4); assert.equal(lf.other_rivers_not_listed, 1); assert.equal(lf.rivers.length, 3);
  const cx = ctxOf("rivers_rising", rf, { must: ["Ratnapura"] });
  assert.deepEqual(validateLlmText("Four rivers are rising towards or past their alert marks at 4:10 pm: Kalu Ganga at Ratnapura 21.3 ft, Kelani Ganga at Holombuwa 13 ft and Aththanagalu Oya at Dunamale 10.8 ft, plus 1 more. Not an official warning. Emergency: 117.", cx), []);
  const r = await prepare({ type: "rivers_rising", kind: "alert", rivers: rf }, async () => "Four rivers are rising at 4:10 pm: Kalu Ganga at Ratnapura 21.3 ft, Kelani Ganga at Holombuwa 13 ft and Aththanagalu Oya at Dunamale 10.8 ft. Not an official warning. Emergency: 117.", {});
  assert.equal(r.ai, true);
}

console.log("x-luna tests passed");
