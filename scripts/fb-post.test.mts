// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/fb-post.test.mts
// The Facebook Page job: the gate in all three modes and with a secret missing, the Pages API calls, the caption with its page
// link, claim-before-publish, no second publish for the same post, no retry after a failed publish, the token never in an
// address, and the proof that nothing here can reach graph.facebook.com. Fake D1 (node:sqlite, built from d1/0022), fake
// Slack, fake site pictures and a fake Graph API.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { gate, endpoint, publishPhoto, publishFeed, classifyFbError, FB_HOST } from "../lib/fbClient.ts";
import { IG_GRAPH_VERSION } from "../lib/igClient.ts";
import { pageLink, composeFbCaption, validateFbCaption } from "../lib/fbCompose.ts";
import { splitSql } from "../lib/d1Sql.mjs";
import { run, sample, sampleItems, OFF_LINE, FB_SCHEMA_FILE, STUCK_MS } from "./fb-post.mjs";

// ---- the network is forbidden: the real fetch is replaced by a trap for the whole file. Every test hands in its own fake;
// anything that fell through to the global fetch would throw here, and the last line of this file checks it never happened.
const net = [];
globalThis.fetch = async (u) => {
  net.push(String(u?.url ?? u));
  throw new Error(`the network is forbidden in tests: ${String(u?.url ?? u)}`);
};

const SITE = "https://waterlevels.lk";
const HOOK = "https://hooks.example/slack";
const TOKEN = "EAAfbTestToken0000000000000000000000";
const PAGE = "100200300400500";
const SECRETS = { FB_PAGE_TOKEN: TOKEN, FB_PAGE_ID: PAGE };
const BASE = `https://graph.facebook.com/${IG_GRAPH_VERSION}/${PAGE}`;
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
const advisory = { warnings: [{ source: "Department of Meteorology", url: "https://dmc.example/met-01.pdf", title: "Heavy rain advisory", issuedAt: iso(T0 - 2 * H), basins: [], severity: "advisory", releaseCusecs: null }] };
const weather = (now) => hw("normal", 4, now, advisory);
const calm = (now, extra = {}) => hw("normal", 4, now, { fallen: { mm: 71, place: "Thawalama" }, reservoirs: [{ id: "rajanganaya", name: "Rajanganaya", status: "spilling", flow: { cusecs: 7704, day: "2026-10-28" }, readingDay: "2026-10-28" }], ...extra });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const jpeg = () => new Response(Uint8Array.from({ length: 20_000 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : 9)), { headers: { "content-type": "image/jpeg" } });

// ---- the gate: OFF unless told; dry previews; live only with both secrets; a missing secret always means dry
{
  assert.equal(gate({}).mode, "off", "nothing set: off");
  assert.match(gate({}).reason, /not set: off/);
  assert.equal(gate(SECRETS).mode, "off", "secrets alone never post");
  assert.equal(gate({ FB_MODE: "off", ...SECRETS }).mode, "off");
  assert.match(gate({ FB_MODE: "OFF" }).reason, /kill switch/);
  for (const v of ["on", "true", "1", "yes", "live!", "dry-run", "live dry", "LIVE\nx"]) assert.equal(gate({ FB_MODE: v, ...SECRETS }).mode, "off", `FB_MODE=${v} is unknown: off`);
  assert.deepEqual([gate({ FB_MODE: "dry" }).mode, gate({ FB_MODE: "dry" }).missing], ["dry", ["FB_PAGE_ID", "FB_PAGE_TOKEN"]]);
  assert.deepEqual([gate({ FB_MODE: " Dry ", ...SECRETS }).mode, gate({ FB_MODE: "dry", ...SECRETS }).keys], ["dry", null], "dry never holds the keys");
  const live = gate({ FB_MODE: " LIVE ", ...SECRETS });
  assert.deepEqual([live.mode, live.asked, live.keys], ["live", "live", { token: TOKEN, pageId: PAGE }]);
  const noToken = gate({ FB_MODE: "live", FB_PAGE_ID: PAGE });
  assert.deepEqual([noToken.mode, noToken.asked, noToken.missing, noToken.keys], ["dry", "live", ["FB_PAGE_TOKEN"], null], "live without the token stays dry");
  assert.match(noToken.reason, /FB_MODE=live but FB_PAGE_TOKEN not set: staying in dry-run/);
  assert.equal(gate({ FB_MODE: "live" }).mode, "dry");
  assert.equal(gate({ FB_MODE: "live", FB_PAGE_ID: PAGE, FB_PAGE_TOKEN: "   " }).mode, "dry", "a blank secret is missing");
  for (const id of ["me", "waterlevels.lk", "123/../456", "https://facebook.com/1234567", "12 345 678", "1234"]) {
    const g = gate({ FB_MODE: "live", FB_PAGE_TOKEN: TOKEN, FB_PAGE_ID: id });
    assert.deepEqual([g.mode, g.keys], ["dry", null], `a Page id like ${id} never goes live`);
  }
  for (const env of [{}, SECRETS, { FB_MODE: "dry", ...SECRETS }, { FB_MODE: "live", ...SECRETS }, { FB_MODE: "live", FB_PAGE_TOKEN: TOKEN, FB_PAGE_ID: "x" }, { FB_MODE: TOKEN, ...SECRETS }]) {
    assert.ok(!gate(env).reason.includes(TOKEN) && !gate(env).reason.includes(PAGE), "the reason never carries a secret");
  }
}

// ---- the Pages API client: one POST per publish, token only in a header, only graph.facebook.com, never retried
{
  const KEYS = { token: TOKEN, pageId: PAGE };
  const mk = (answer) => {
    const calls = [];
    const doFetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers, redirect: init.redirect, body: init.body ? Object.fromEntries(new URLSearchParams(init.body.toString())) : null });
      return answer(calls.length, String(url));
    };
    return { calls, doFetch };
  };
  // a photo post: url + caption, answered with the photo and the Page post
  const f = mk(() => json({ id: "P1", post_id: `${PAGE}_77` }));
  const r = await publishPhoto(KEYS, { imageUrl: `${SITE}/a.jpg?format=portrait`, caption: "Hello\n\nLive levels: https://waterlevels.lk" }, { doFetch: f.doFetch, now: 0 });
  assert.deepEqual(r, { ok: true, postId: `${PAGE}_77`, photoId: "P1" });
  assert.equal(f.calls.length, 1, "one request");
  assert.deepEqual([f.calls[0].url, f.calls[0].method, f.calls[0].redirect], [`${BASE}/photos`, "POST", "error"]);
  assert.deepEqual(f.calls[0].body, { url: `${SITE}/a.jpg?format=portrait`, caption: "Hello\n\nLive levels: https://waterlevels.lk" }, "caption, not the deprecated message; no token in the body");
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!f.calls[0].url.includes(TOKEN) && !JSON.stringify(f.calls[0].body).includes(TOKEN) && !f.calls[0].url.includes("access_token"), "the token is never in the address or the body");
  // a link or text post
  const l = mk(() => json({ id: `${PAGE}_78` }));
  assert.deepEqual(await publishFeed(KEYS, { message: "Hi", link: `${SITE}/rain` }, { doFetch: l.doFetch }), { ok: true, postId: `${PAGE}_78`, photoId: null });
  assert.deepEqual([l.calls[0].url, l.calls[0].body], [`${BASE}/feed`, { message: "Hi", link: `${SITE}/rain` }]);
  await publishFeed(KEYS, { message: "Text only" }, { doFetch: l.doFetch });
  assert.deepEqual(l.calls[1].body, { message: "Text only" });
  assert.ok(l.calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}` && !c.url.includes(TOKEN)));
  // the Graph version is Instagram's, with the same override; anything that is not a version is refused before any request
  const v = mk(() => json({ id: "P", post_id: "X" }));
  await publishPhoto(KEYS, { imageUrl: "u", caption: "c" }, { doFetch: v.doFetch, env: { IG_GRAPH_VERSION: "v27.0" } });
  assert.equal(v.calls[0].url, `https://graph.facebook.com/v27.0/${PAGE}/photos`);
  for (const bad of ["27.0", "v27", "v27.0/../../x", "v1.0?x=1", "v1.0#x", "v1.0@evil.example"]) {
    const b = mk(() => json({ id: "P" }));
    const br = await publishPhoto(KEYS, { imageUrl: "u", caption: "c" }, { doFetch: b.doFetch, env: { IG_GRAPH_VERSION: bad } });
    assert.ok(!br.ok && b.calls.length === 0 && br.pauseUntilMs === null, `version ${bad}: refused, nothing sent`);
  }
  // only graph.facebook.com/<version>/<digits>/<photos|feed>: any other Page id is refused before any request
  for (const id of ["me", "1/../2", "evil.example/1234567", "1234567?x=1", "", "@evil.example"]) {
    const b = mk(() => json({ id: "P" }));
    assert.equal(endpoint({ token: TOKEN, pageId: id }, "photos"), null);
    const br = await publishFeed({ token: TOKEN, pageId: id }, { message: "x" }, { doFetch: b.doFetch });
    assert.ok(!br.ok && b.calls.length === 0, `Page id "${id}": refused, nothing sent`);
  }
  assert.equal(endpoint(KEYS, "videos"), null, "only the two edges exist");
  for (const edge of ["photos", "feed"]) assert.deepEqual([new URL(endpoint(KEYS, edge)).hostname, new URL(endpoint(KEYS, edge)).protocol], [FB_HOST, "https:"]);
  // failures: ONE request, never a second one, and the token never in the text
  const fa = mk(() => json({ error: { message: `Error validating access token ${TOKEN}`, type: "OAuthException", code: 190 } }, 400));
  const ra = await publishPhoto(KEYS, { imageUrl: "u", caption: "c" }, { doFetch: fa.doFetch, now: 1000 });
  assert.ok(!ra.ok && ra.auth && ra.pauseUntilMs === 1000 + 6 * H && fa.calls.length === 1, "an expired token: one request, 6 h pause");
  assert.ok(!ra.detail.includes(TOKEN) && /code 190/.test(ra.detail));
  let thrown = 0;
  const rn = await publishPhoto(KEYS, { imageUrl: "u", caption: "c" }, { doFetch: async () => { thrown++; throw new TypeError("fetch failed"); }, now: 0 });
  assert.ok(!rn.ok && rn.status === 0 && rn.pauseUntilMs === 15 * 60_000 && thrown === 1 && /may or may not be on the Page/.test(rn.detail), "no answer: one request, not sent again");
  const f5 = mk(() => json({}, 502));
  assert.ok(!(await publishFeed(KEYS, { message: "x" }, { doFetch: f5.doFetch, now: 0 })).ok && f5.calls.length === 1, "a 5xx is not retried either");
  const noId = mk(() => json({ success: true }));
  const rz = await publishPhoto(KEYS, { imageUrl: "u", caption: "c" }, { doFetch: noId.doFetch });
  assert.ok(!rz.ok && /without an id/.test(rz.detail) && noId.calls.length === 1);
  // error classes: the shared ones plus Facebook's Page rate limit
  assert.equal(classifyFbError(400, { error: { code: 80001, message: "There have been too many calls to this Page account." } }, 0).pauseUntilMs, H, "Page rate limit pauses an hour");
  assert.equal(classifyFbError(400, { error: { code: 32, message: "Page request limit reached" } }, 0).pauseUntilMs, H);
  assert.equal(classifyFbError(400, { error: { code: 368, message: "deemed abusive" } }, 0).pauseUntilMs, H);
  assert.equal(classifyFbError(400, { error: { code: 200, message: "Permissions error" } }, 0).pauseUntilMs, 6 * H, "a missing permission pauses 6 h");
  assert.equal(classifyFbError(400, { error: { code: 324, message: "Missing or invalid image file" } }, 0).pauseUntilMs, null, "a bad picture is a one-off");
  assert.equal(classifyFbError(400, { error: { code: 100, message: "Invalid parameter" } }, 0).pauseUntilMs, null);
  assert.ok(!classifyFbError(400, { error: { code: 100, message: `bad ${TOKEN}` } }, 0, TOKEN).detail.includes(TOKEN));
  // no fetch handed in: it throws; it never falls back to the global fetch
  await assert.rejects(publishPhoto(KEYS, { imageUrl: "u", caption: "c" }, {}), /a fetch must be handed in/);
  await assert.rejects(publishFeed(KEYS, { message: "x" }), /a fetch must be handed in/);
  assert.deepEqual(net, [], "the global fetch was not touched");
  const src = readFileSync(new URL("../lib/fbClient.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/(?<![\w.])fetch\(/.test(src), "lib/fbClient.ts never calls the global fetch");
  assert.ok(!/access_token/.test(src), "lib/fbClient.ts never puts the token in a parameter");
}

// ---- the page link and the caption: the Instagram caption with its address line replaced by the matching page's link
{
  const feed = (kind, slug, cap = {}) => ({ format: "feed", media: { kind, slug }, cap });
  const links = [
    [feed("river", "kelani-ganga", { type: "gauge_rise" }), `${SITE}/kelani-ganga`, "Live levels", "app/[lang]/[river]/page.tsx"],
    [feed("river", "kalu-ganga", { type: "river" }), `${SITE}/kalu-ganga`, "Live levels", "app/[lang]/[river]/page.tsx"],
    [feed("home", "now", { type: "home" }), SITE, "Live levels", "app/[lang]/page.tsx"],
    [feed("rain", "now", { type: "rain" }), `${SITE}/rain`, "Rain map", "app/[lang]/rain/page.tsx"],
    [feed("reservoirs", "now", { type: "reservoirs" }), `${SITE}/reservoirs/spilling`, "Reservoirs", "app/[lang]/reservoirs/spilling/page.tsx"],
    [feed("home", "now", { type: "survey" }), `${SITE}/flood-survey`, "Add your spot", "app/[lang]/flood-survey/page.tsx"],
    [feed("home", "now", { type: "embed" }), `${SITE}/embed`, "Get the widget", "app/[lang]/embed/page.tsx"],
  ];
  for (const [item, url, label, route] of links) {
    assert.deepEqual(pageLink(`${SITE}/`, item), { url, label });
    assert.ok(existsSync(new URL(`../${route}`, import.meta.url)), `the page behind ${url} exists (${route})`);
  }
  assert.equal(pageLink(SITE, feed("gauge", "hanwella", { type: "gauge_rise" })), null, "a story picture has no feed link");
  for (const slug of ["", "../x", "a/b", "A", "a?b=1", "a#b", "a b"]) assert.equal(pageLink(SITE, feed("river", slug)), null, `river slug "${slug}" gives no link`);

  const gauge = { station: "Hanwella", river: "Kelani Ganga", tier: "major", level: 12.4, trend: "rising", nextHour: null };
  const link = pageLink(SITE, links[0][0]);
  const c = composeFbCaption({ type: "gauge_rise", gauge }, { link });
  const lines = c.text.split("\n").filter(Boolean);
  assert.equal(lines[0], "Hanwella, Kelani Ganga: Major flood at 12.4 ft, rising. Emergency: 117.");
  assert.ok(/[඀-෿]/.test(lines[1]) && /[஀-௿]/.test(lines[2]), "line 2 Sinhala, line 3 Tamil");
  assert.equal(lines[3], "Live levels: https://waterlevels.lk/kelani-ganga");
  assert.equal(lines[4], "#KelaniGanga #Hanwella #SriLankaFloods");
  assert.deepEqual(validateFbCaption(c.text, { link: link.url, site: SITE }), []);
  assert.equal(composeFbCaption({ type: "gauge_rise", gauge }, { link, langs: ["en"] }).text.split("\n").filter(Boolean).length, 3, "English only: line, link, tags");
  // every kind of feed post passes its own checks with its own link
  const all = [
    [{ type: "home", home: { atAlert: 2, nearAlert: 3, assessed: 40, rain: { mm: 85, place: "Ratnapura" }, weather: true } }, links[2][0]],
    [{ type: "rain", rain: { place: "Thawalama", mm: 71 } }, links[3][0]],
    [{ type: "reservoirs", reservoirs: { count: 31, top: { name: "Rajanganaya", cusecs: 7704, day: "2026-10-28" } } }, links[4][0]],
    [{ type: "river", river: { name: "Kalu Ganga", gauges: 6, station: "Ratnapura", level: 4.2, tier: "normal" } }, links[1][0]],
    [{ type: "survey" }, links[5][0]],
    [{ type: "embed" }, links[6][0]],
  ];
  for (const [cap, item] of all) {
    const pl = pageLink(SITE, item);
    const t = composeFbCaption(cap, { link: pl }).text;
    assert.deepEqual(validateFbCaption(t, { link: pl.url, site: SITE }), [], `${cap.type}: ${t}`);
    assert.ok(t.includes(`\n\n${pl.label}: ${pl.url}`) && !t.includes("Live levels: waterlevels.lk"), `${cap.type} carries its link once`);
    assert.equal((t.match(/https?:\/\//g) ?? []).length, 1);
  }
  // what the checks catch
  const ok = c.text;
  const v = (t, l = link.url) => validateFbCaption(t, { link: l, site: SITE });
  assert.ok(v(`${ok}\nhttps://evil.example/x`).some((p) => /other than the one page link/.test(p)), "a second link");
  assert.ok(v(ok.replace(link.url, "https://evil.example/kelani-ganga")).some((p) => /other than the one page link/.test(p)), "a link that is not the page link");
  assert.ok(v(ok.replace(`Live levels: ${link.url}`, "")).some((p) => /missing the page link/.test(p)));
  assert.ok(v(ok.replace(link.url, "https://evil.example/x"), "https://evil.example/x").some((p) => /our own site/.test(p)), "a link to another site, even when expected");
  assert.ok(v(ok.replace(link.url, "http://waterlevels.lk/rain"), "http://waterlevels.lk/rain").some((p) => /our own site/.test(p)), "http is not https");
  assert.ok(v(ok.replace(link.url, `${link.url}?utm=1`), `${link.url}?utm=1`).some((p) => /our own site/.test(p)), "no query on the link");
  assert.ok(v(`${ok} @someone`).some((p) => /@mention/.test(p)));
  assert.ok(v(`${ok} #a1 #b2 #c3`).some((p) => /hashtags/.test(p)));
  assert.ok(v(`${ok}\nLive levels: waterlevels.lk`).some((p) => /Instagram address line/.test(p)));
}

// ---- a whole run against a fake D1 (built from d1/0022), Slack, our site's pictures and a fake Graph API
const world = (env = {}) => {
  const w = { slack: [], graph: [], pictures: [], other: [], ops: [], logs: [], schema: 0, graphFail: null, graphThrow: false, noPicture: false };
  w.db = new DatabaseSync(":memory:");
  w.query = async (sql, params = []) => {
    w.ops.push({ t: "d1", sql, params });
    const stmt = w.db.prepare(sql);
    return /^\s*select/i.test(sql) ? stmt.all(...params) : (stmt.run(...params), []);
  };
  w.applySchema = async () => {
    w.schema++;
    for (const s of splitSql(readFileSync(FB_SCHEMA_FILE, "utf8"))) w.db.exec(s);
  };
  w.doFetch = async (url, init = {}) => {
    const u = String(url);
    if (u === HOOK) { w.slack.push(JSON.parse(init.body).text); return new Response("ok"); }
    if (u.startsWith(`${SITE}/api/story/`)) {
      w.pictures.push(u);
      return w.noPicture ? new Response("x", { status: 503 }) : jpeg();
    }
    if (new URL(u).hostname === "graph.facebook.com") {
      w.ops.push({ t: "graph", url: u });
      w.graph.push({ url: u, method: init.method, auth: init.headers?.Authorization, body: init.body ? Object.fromEntries(new URLSearchParams(init.body.toString())) : null });
      if (w.graphThrow) throw new TypeError("fetch failed");
      if (w.graphFail) return json(w.graphFail, 400);
      return json(u.endsWith("/photos") ? { id: `P${w.graph.length}`, post_id: `${PAGE}_${w.graph.length}` } : { id: `${PAGE}_${w.graph.length}` });
    }
    w.other.push(u);
    return new Response("{}", { status: 404 });
  };
  w.env = { SLACK_WEBHOOK_URL: HOOK, ...env };
  w.run = (s, now, extra = {}) => run({ env: w.env, doFetch: w.doFetch, query: w.query, applySchema: w.applySchema, snap: s, now, log: (line) => w.logs.push(String(line)), ...extra });
  w.rows = () => w.db.prepare("SELECT kind, format, situation, mode, status, dedupe_key, link, image_url, post_id, photo_id, error, caption FROM fb_posts ORDER BY id").all();
  w.state = () => w.db.prepare("SELECT value FROM fb_state WHERE key = 'main'").get()?.value;
  w.setState = (v) => w.db.prepare("UPDATE fb_state SET value = ? WHERE key = 'main'").run(v);
  // everything that left the process or was stored: used to check the token is in none of it
  w.everything = () => JSON.stringify([w.slack, w.logs, w.ops, w.graph.map((g) => [g.url, g.body]), w.rows()]);
  return w;
};
const RIVER_JPG = `${SITE}/api/story/river/kelani-ganga.jpg?format=portrait`;
const RISE_KEY = "feed:rise:Kelani Ganga:major:2026-10-28";

// OFF (the default): nothing is read, written, shown or sent, whatever the data says and even with both secrets present
{
  for (const env of [{}, SECRETS, { FB_MODE: "off", ...SECRETS }, { FB_MODE: "yes", ...SECRETS }]) {
    const w = world(env);
    const r = await w.run(hw("major", 12.4, T0), T0);
    assert.deepEqual(r, { mode: "off", posted: 0 });
    assert.deepEqual([w.ops.length, w.slack.length, w.graph.length, w.pictures.length, w.other.length, w.schema], [0, 0, 0, 0, 0, 0], "off touches nothing");
    assert.ok(w.logs[0].startsWith("gate: off (") && w.logs[1] === OFF_LINE, "and says so in its log");
  }
  assert.match(OFF_LINE, /OFF: nothing was read, composed, shown in Slack or sent to Facebook/);
  // off needs no fetch and no database at all; dry or live without them is an error, never a silent call
  assert.equal((await run({ log: () => {} })).mode, "off");
  assert.equal((await run({ env: { FB_MODE: "off" }, log: () => {} })).mode, "off");
  await assert.rejects(run({ env: { FB_MODE: "dry" }, log: () => {} }), /doFetch must be handed in/);
  await assert.rejects(run({ env: { FB_MODE: "live", ...SECRETS }, doFetch: async () => json({}), log: () => {} }), /query must be handed in/);
}

// DRY: previews in Slack only; the tables are created on the first run; nothing twice; stories never
{
  const w = world({ FB_MODE: "dry" });
  let r = await w.run(weather(at(-1)), at(-1)); // 8 am Colombo, a weather advisory in force
  assert.equal(w.schema, 1, "the first run creates the tables from d1/0022");
  assert.deepEqual([r.mode, r.situation, r.posted], ["dry", "weather", 1]);
  assert.equal(w.slack.length, 1, "one preview and no missing-secret note in a dry run");
  const msg = w.slack[0];
  assert.match(msg, /^\*DRY RUN: not posted to Facebook\* \(1\/1\) \[photo post: Rivers right now \+ rain outlook\] mode: weather \(1 weather advisory in force\)/);
  assert.ok(msg.includes(`${SITE}/api/story/home/now.jpg?format=portrait`) && msg.includes("fetched, JPEG, 20 KB"), msg);
  assert.ok(msg.includes("> Rivers right now: no gauge at Alert or higher. Rain forecast: up to 20 mm in 24 hours near Ratnapura.") && msg.includes("> Live levels: https://waterlevels.lk\n"), msg);
  assert.ok(msg.includes("FB_MODE=dry: previews only, nothing goes to Facebook (FB_PAGE_ID and FB_PAGE_TOKEN not set: needed before FB_MODE=live)_"), msg);
  assert.deepEqual(w.rows().map((x) => [x.kind, x.format, x.situation, x.mode, x.status, x.link, x.dedupe_key]), [["weather_morning", "photo", "weather", "dry", "dry", SITE, "feed:weather:2026-10-28"]]);
  r = await w.run(weather(at(-0.5)), at(-0.5));
  assert.deepEqual([r.posted, w.slack.length, w.rows().length, w.schema], [0, 1, 1, 1], "a second run says nothing twice and creates nothing twice");
  // disaster: a gauge reaching Alert is an Instagram STORY only; Major adds the one river feed post
  const d = world({ FB_MODE: "dry", ...SECRETS });
  await d.run(hw("normal", 4, at(-8)), at(-8));
  r = await d.run(hw("alert", 8.3, at(-7)), at(-7));
  assert.deepEqual([r.situation, r.posted, r.stories, d.slack.length, d.rows().length], ["disaster", 0, 1, 0, 0], "a story is never shown or posted on the Page");
  r = await d.run(hw("major", 12.4, at(-6.5)), at(-6.5));
  assert.deepEqual([r.posted, r.stories, d.slack.length], [1, 1, 1]);
  assert.match(d.slack[0], /^\*DRY RUN: not posted to Facebook\* \(1\/1\) \[photo post: Kelani Ganga major\] mode: disaster/);
  assert.ok(d.slack[0].includes(RIVER_JPG) && d.slack[0].includes("> Live levels: https://waterlevels.lk/kelani-ganga") && d.slack[0].includes("> #KelaniGanga #Hanwella #SriLankaFloods"), d.slack[0]);
  assert.ok(d.slack[0].includes("_FB_MODE=dry: previews only, nothing goes to Facebook_"), "with both secrets set the reason has nothing to add");
  assert.deepEqual(d.rows().map((x) => [x.kind, x.status, x.dedupe_key, x.link]), [["gauge_rise", "dry", RISE_KEY, `${SITE}/kelani-ganga`]]);
  for (const x of [w, d]) {
    assert.deepEqual([x.graph, x.other], [[], []], "a dry run never calls the Graph API, with or without the secrets");
    assert.ok(!x.everything().includes(TOKEN));
  }
}

// LIVE asked but a secret is missing: always a dry run, and Slack is told once a day
{
  const w = world({ FB_MODE: "live", FB_PAGE_ID: PAGE });
  await w.run(hw("normal", 4, at(-8)), at(-8));
  assert.equal(w.slack.length, 1);
  assert.ok(w.slack[0].includes("FB_MODE=live but FB_PAGE_TOKEN not set: staying in dry-run") && /add the GitHub secret FB_PAGE_TOKEN\./.test(w.slack[0]) && /once a day/.test(w.slack[0]), w.slack[0]);
  await w.run(hw("normal", 4, at(-7.5)), at(-7.5));
  const r = await w.run(weather(at(-1)), at(-1));
  assert.equal(w.slack.filter((s) => /once a day/.test(s)).length, 1, "the note is not repeated within the day");
  assert.deepEqual([r.mode, r.posted], ["dry", 1]);
  assert.match(w.slack.at(-1), /^\*DRY RUN: not posted to Facebook\*/);
  assert.deepEqual(w.rows().map((x) => [x.mode, x.status]), [["dry", "dry"]]);
  await w.run(hw("normal", 4, at(24 - 7)), at(24 - 7));
  assert.equal(w.slack.filter((s) => /once a day/.test(s)).length, 2, "the next day it comes again");
  assert.deepEqual(w.graph, [], "a missing secret never reaches Facebook");
  // an FB_PAGE_ID that is not a number is the same case
  const b = world({ FB_MODE: "live", FB_PAGE_TOKEN: TOKEN, FB_PAGE_ID: "my-page" });
  await b.run(weather(at(-1)), at(-1));
  assert.ok(b.slack[0].includes("FB_PAGE_ID is not a Page id") && b.graph.length === 0 && !b.everything().includes(TOKEN));
}

// LIVE: one photo post with the caption and its link; claimed in D1 BEFORE the request; never a second request for the same post
{
  const w = world({ FB_MODE: "live", ...SECRETS });
  await w.run(hw("normal", 4, at(-8)), at(-8));
  await w.run(hw("alert", 8.3, at(-7)), at(-7));
  assert.equal(w.graph.length, 0, "nothing for the Page yet: no API call at all");
  const before = w.state();
  w.ops.length = 0;
  let r = await w.run(hw("major", 12.4, at(-6.5)), at(-6.5));
  assert.deepEqual([r.mode, r.posted, r.failed], ["live", 1, 0]);
  assert.equal(w.graph.length, 1, "one request for one post");
  const g = w.graph[0];
  assert.deepEqual([g.url, g.method, g.auth], [`${BASE}/photos`, "POST", `Bearer ${TOKEN}`]);
  assert.deepEqual(Object.keys(g.body).sort(), ["caption", "url"]);
  assert.equal(g.body.url, RIVER_JPG, "the same picture as the Instagram feed post");
  assert.ok(g.body.caption.startsWith("Hanwella, Kelani Ganga: Major flood at 12.4 ft, rising. Emergency: 117.\n") && g.body.caption.includes("\n\nLive levels: https://waterlevels.lk/kelani-ganga\n\n#KelaniGanga"), g.body.caption);
  assert.ok(!g.url.includes(TOKEN) && !JSON.stringify(g.body).includes(TOKEN), "the token is not in the address or the body");
  assert.deepEqual(w.rows().map((x) => [x.kind, x.format, x.mode, x.status, x.post_id, x.photo_id, x.link]), [["gauge_rise", "photo", "live", "posted", `${PAGE}_1`, "P1", `${SITE}/kelani-ganga`]]);
  assert.deepEqual(w.slack, [], "a live post that worked says nothing in Slack, and is never a DRY RUN message");
  // the order: the claim INSERT, then the read-back of the claim, then the one request, then the row is marked posted
  const idx = (f) => w.ops.findIndex(f);
  const claimAt = idx((o) => o.t === "d1" && /^INSERT OR IGNORE INTO fb_posts/.test(o.sql) && o.params.includes(RISE_KEY) && /'claimed'/.test(o.sql));
  const readAt = idx((o) => o.t === "d1" && /^SELECT claim, status FROM fb_posts/.test(o.sql) && o.params.includes(RISE_KEY));
  const sendAt = idx((o) => o.t === "graph");
  const doneAt = idx((o) => o.t === "d1" && /^UPDATE fb_posts SET status = 'posted'/.test(o.sql));
  assert.ok(claimAt >= 0 && claimAt < readAt && readAt < sendAt && sendAt < doneAt, `claim ${claimAt} < read ${readAt} < request ${sendAt} < posted ${doneAt}`);
  // the same water later: the engine remembers, nothing is sent
  await w.run(hw("major", 12.5, at(-6)), at(-6));
  assert.equal(w.graph.length, 1);
  // the run died before saving its memory, so the engine plans the very same post again: the claim stops it
  w.setState(before);
  w.logs.length = 0;
  r = await w.run(hw("major", 12.6, at(-5.5)), at(-5.5));
  assert.deepEqual([w.graph.length, r.posted, w.rows().length], [1, 0, 1], "no second publish for the same post");
  assert.ok(w.logs.some((line) => line.includes(`already handled`) && line.includes(RISE_KEY)));
  // a row left "claimed" by a run that died before or during the request is never sent by a later run either
  const c = world({ FB_MODE: "live", ...SECRETS });
  await c.run(hw("normal", 4, at(-8)), at(-8));
  const inFlight = "INSERT INTO fb_posts (ts, day, kind, format, situation, dedupe_key, mode, status, caption, claim) VALUES (?, '2026-10-28', 'gauge_rise', 'photo', 'disaster', ?, 'live', 'claimed', 'x', 'another-run:0')";
  c.db.prepare(inFlight).run(at(-6.5) - 60_000, RISE_KEY);
  r = await c.run(hw("major", 12.4, at(-6.5)), at(-6.5));
  assert.deepEqual([c.graph.length, r.posted, c.rows()[0].status, c.slack.length], [0, 0, "claimed", 0], "another run's claim is respected");
  // an hour on, that run is clearly dead: the row is closed and Slack hears once that the post may or may not be on the Page
  r = await c.run(hw("major", 12.5, at(-6.5) + STUCK_MS), at(-6.5) + STUCK_MS);
  assert.deepEqual([c.graph.length, c.rows()[0].status, c.slack.length], [0, "failed", 1], "a dead run's post is reported, never sent");
  assert.match(c.slack[0], /Facebook: 1 post \(gauge_rise\) was started by a run that never finished\. It may or may not be on the Page and will not be sent again/);
  await c.run(hw("major", 12.5, at(-5)), at(-5));
  assert.equal(c.slack.length, 1, "said once");
  // a dry preview of the same key earlier that day also keeps the live run from sending it (same as Instagram)
  for (const x of [w, c]) assert.ok(!x.everything().includes(TOKEN), "the token is in no log, Slack message or D1 row");
  assert.deepEqual([w.other, c.other], [[], []]);
}

// LIVE, a failed publish: reported, never retried (not in the run, not by a later run), and an account-wide error pauses posting
{
  const f = world({ FB_MODE: "live", ...SECRETS });
  await f.run(hw("normal", 4, at(-8)), at(-8));
  await f.run(hw("alert", 8.3, at(-7)), at(-7));
  const before = f.state();
  f.graphFail = { error: { message: `Error validating access token ${TOKEN}`, type: "OAuthException", code: 190 } };
  let r = await f.run(hw("major", 12.4, at(-6.5)), at(-6.5));
  assert.deepEqual([r.posted, r.failed, f.graph.length], [0, 1, 1], "one request, no retry");
  assert.ok(f.slack.at(-1).includes("Facebook post failed (OAuthException: code 190") && f.slack.at(-1).includes("skipped, not retried") && f.slack.at(-1).includes(`paused until ${iso(at(-0.5))}`), f.slack.at(-1));
  assert.deepEqual(f.rows().map((x) => [x.status, x.dedupe_key]), [["failed", RISE_KEY]], "the key stays taken");
  assert.ok(/code 190/.test(f.rows()[0].error));
  // paused: nothing is called, even though Facebook would now answer
  f.graphFail = null;
  r = await f.run(hw("major", 12.6, at(-6)), at(-6));
  assert.deepEqual([r.paused, f.graph.length], [true, 1], "paused: nothing called");
  // after the pause, with the memory rolled back so the engine plans the SAME post again: still not sent
  f.setState(before);
  r = await f.run(hw("major", 12.6, at(2.5)), at(2.5)); // 11:30 am Colombo, the same day
  assert.deepEqual([r.paused, r.posted, f.graph.length, f.rows().length], [undefined, 0, 1, 1], "a failed post is never sent again");
  // and a different post does go out once the pause is over
  r = await f.run(hw("major", 12.6, at(23)), at(23)); // 8 am the next day: the flood-day morning post
  assert.equal(r.posted, 1);
  assert.deepEqual([f.graph.length, f.graph[1].body.url, f.rows().at(-1).status], [2, `${SITE}/api/story/home/now.jpg?format=portrait`, "posted"]);
  assert.ok(!f.everything().includes(TOKEN), "the token never reaches Slack, the log or D1, even when Facebook echoes it");

  // no answer at all (timeout, connection lost): the post may exist, so it is not sent again; a short pause
  const n = world({ FB_MODE: "live", ...SECRETS });
  n.graphThrow = true;
  r = await n.run(weather(at(-1)), at(-1));
  assert.deepEqual([r.failed, n.graph.length, n.rows()[0].status], [1, 1, "failed"]);
  assert.ok(n.slack.at(-1).includes("may or may not be on the Page") && n.slack.at(-1).includes(`paused until ${iso(at(-1) + 15 * 60_000)}`), n.slack.at(-1));
  n.graphThrow = false;
  r = await n.run(weather(at(-0.5)), at(-0.5));
  assert.deepEqual([r.posted, n.graph.length], [0, 1], "after the pause the same morning post is not tried again");

  // a one-off error (a bad parameter) pauses nothing: the next post of the run still goes out
  const o = world({ FB_MODE: "live", ...SECRETS, FB_FEED_MAX: "3" });
  await o.run(hw("normal", 4, at(-1.5)), at(-1.5));
  let calls = 0;
  const base = o.doFetch;
  o.doFetch = async (url, init) => (String(url).startsWith("https://graph.facebook.com/") && ++calls === 1 ? (await base(url, init), json({ error: { code: 100, message: "Invalid parameter" } }, 400)) : base(url, init));
  r = await o.run(hw("major", 12.4, at(-1)), at(-1)); // 8 am: the river post and the flood-day morning post
  assert.deepEqual([r.posted, r.failed, o.graph.length], [1, 1, 2]);
  assert.deepEqual(o.rows().map((x) => [x.kind, x.status]), [["gauge_rise", "failed"], ["flood_morning", "posted"]]);
}

// the picture cannot be fetched: skipped like Instagram (default), or sent as a link post when FB_NO_PICTURE=link
{
  const s = world({ FB_MODE: "live", ...SECRETS });
  s.noPicture = true;
  let r = await s.run(calm(T0), T0);
  assert.deepEqual([r.failed, r.posted, s.graph.length], [1, 0, 0], "no picture: nothing is sent");
  assert.ok(s.slack.at(-1).includes("Facebook post skipped: its picture could not be fetched (HTTP 503): Rain, last 24 hours") && !/https?:\/\/\S+\?/.test(s.slack.at(-1)), s.slack.at(-1));
  assert.deepEqual(s.rows().map((x) => [x.kind, x.status, x.error]), [["keepalive:rain", "failed", "picture: HTTP 503"]]);
  const l = world({ FB_MODE: "live", ...SECRETS, FB_NO_PICTURE: "link" });
  l.noPicture = true;
  r = await l.run(calm(T0), T0);
  assert.deepEqual([r.posted, l.graph.length, l.graph[0].url], [1, 1, `${BASE}/feed`]);
  assert.deepEqual(Object.keys(l.graph[0].body).sort(), ["link", "message"]);
  assert.ok(l.graph[0].body.link === `${SITE}/rain` && l.graph[0].body.message.includes("Rain map: https://waterlevels.lk/rain"));
  assert.deepEqual(l.rows().map((x) => [x.format, x.status, x.post_id, x.photo_id]), [["link", "posted", `${PAGE}_1`, null]]);
  const d = world({ FB_MODE: "dry" });
  d.noPicture = true;
  await d.run(calm(T0), T0);
  assert.ok(d.slack[0].includes("NOT available (HTTP 503): a live run would skip this post"), d.slack[0]);
  const dl = world({ FB_MODE: "dry", FB_NO_PICTURE: "LINK" });
  dl.noPicture = true;
  await dl.run(calm(T0), T0);
  assert.ok(dl.slack[0].includes("[link post, no picture: Rain, last 24 hours]") && dl.slack[0].includes("a live run would send this as a link post without the picture"), dl.slack[0]);
}

// the Instagram rules, counted on the Page's own posts: calm keep-alive posts, one post a day, the daily limit in a flood
{
  const w = world({ FB_MODE: "dry" });
  let r = await w.run(calm(T0), T0);
  assert.deepEqual([r.situation, r.posted], ["calm", 1]);
  assert.match(w.slack[0], /\[photo post: Rain, last 24 hours\] mode: calm/);
  assert.ok(w.slack[0].includes(`${SITE}/api/story/rain/now.jpg?format=portrait`) && w.slack[0].includes("> Rain map: https://waterlevels.lk/rain"));
  assert.equal((await w.run(calm(at(2)), at(2))).posted, 0, "one post a day");
  assert.equal((await w.run(calm(at(26)), at(26))).posted, 0, "keep-alive posts are at least 30 h apart");
  r = await w.run(calm(at(31), { reservoirs: [{ id: "rajanganaya", name: "Rajanganaya", status: "spilling", flow: { cusecs: 7704, day: "2026-10-29" }, readingDay: "2026-10-29" }] }), at(31));
  assert.equal(r.posted, 1);
  assert.match(w.slack[1], /\[photo post: Reservoirs spilling\]/);
  assert.ok(w.slack[1].includes("> Reservoirs: https://waterlevels.lk/reservoirs/spilling"), "the rotation moves on to the next kind, with its own link");
  // a flood morning with the limit at 1: the river post goes, the morning post is held, and Slack hears it once a day
  const lim = world({ FB_MODE: "dry", IG_FEED_MAX: "1" });
  await lim.run(hw("normal", 4, at(-1.5)), at(-1.5));
  r = await lim.run(hw("major", 12.4, at(-1)), at(-1));
  assert.deepEqual([r.posted, r.held], [1, 1], "Instagram's limit applies when the Page has none of its own");
  assert.deepEqual(lim.rows().map((x) => [x.kind, x.status]), [["flood_morning", "held"], ["gauge_rise", "dry"]]);
  assert.equal(lim.slack.filter((s) => /1 post held back by the daily limit \(1 post a day\)/.test(s)).length, 1, lim.slack.join("\n"));
  const own = world({ FB_MODE: "dry", IG_FEED_MAX: "1", FB_FEED_MAX: "2" });
  await own.run(hw("normal", 4, at(-1.5)), at(-1.5));
  r = await own.run(hw("major", 12.4, at(-1)), at(-1));
  assert.deepEqual([r.posted, r.held], [2, 0], "FB_FEED_MAX overrides it");
  // unknown is never calm: unreadable levels or bulletins mean no post
  const u = world({ FB_MODE: "dry" });
  assert.equal((await u.run({ ...calm(T0), warnings: null }, T0)).posted, 0);
  assert.equal((await u.run({ ...calm(T0), stations: null, reservoirs: null }, T0)).skipped, "site unreadable");
  assert.deepEqual(u.slack, []);
}

// nothing may get stuck or be lost quietly (the review of 12 Nov 2026)
{
  // a setting that could never work is caught by the gate, before any post claims its key
  for (const bad of ["24.0", "v24", "latest"]) {
    const g = gate({ FB_MODE: "live", ...SECRETS, IG_GRAPH_VERSION: bad });
    assert.deepEqual([g.mode, g.asked, g.keys], ["dry", "live", null], `IG_GRAPH_VERSION=${bad} never goes live`);
    assert.match(g.reason, /IG_GRAPH_VERSION is not a version like v24\.0: staying in dry-run/);
  }
  assert.equal(gate({ FB_MODE: "live", ...SECRETS, IG_GRAPH_VERSION: " v27.0 " }).mode, "live");
  const v = world({ FB_MODE: "live", ...SECRETS, IG_GRAPH_VERSION: "v24" });
  let r = await v.run(weather(at(-1)), at(-1));
  assert.deepEqual([r.mode, r.posted, v.graph.length], ["dry", 1, 0], "shown in Slack, nothing sent, no post used up by a request that could not work");
  assert.ok(v.slack[0].includes("IG_GRAPH_VERSION is not a version like v24.0") && v.slack[0].includes("To go live: set the repository variable IG_GRAPH_VERSION to a version like v24.0, or delete it."), v.slack[0]);
  assert.deepEqual(v.rows().map((x) => [x.mode, x.status]), [["dry", "dry"]]);

  // a calm post that failed uses its slot: the rules move on instead of picking it again on every run
  const s = world({ FB_MODE: "live", ...SECRETS });
  s.noPicture = true;
  await s.run(calm(T0), T0);
  const told = s.slack.length;
  s.noPicture = false;
  s.logs.length = 0;
  r = await s.run(calm(at(0.5)), at(0.5));
  assert.deepEqual([r.posted, r.failed, s.graph.length, s.slack.length], [0, 0, 0, told], "not picked again, not said again");
  assert.ok(!s.logs.some((line) => line.includes("already handled")), "the rules themselves have moved on");
  r = await s.run(calm(at(31)), at(31));
  assert.deepEqual([r.posted, s.graph.length, s.rows().at(-1).kind, s.rows().at(-1).status], [1, 1, "keepalive:reservoirs", "posted"], "30 h later the next kind goes out");

  // a run that died right after Facebook took the post: the day's limit still counts it, and nothing is sent twice
  const d = world({ FB_MODE: "live", ...SECRETS });
  const realQuery = d.query;
  d.query = async (sql, params) => {
    if (/^UPDATE fb_posts SET status = 'posted'/.test(sql)) throw new Error("D1 write timed out");
    return realQuery(sql, params);
  };
  await assert.rejects(d.run(weather(at(-1)), at(-1)), /D1 write timed out/);
  assert.deepEqual([d.graph.length, d.rows()[0].status], [1, "claimed"], "on the Page, but the run died before writing it down");
  d.query = realQuery;
  r = await d.run(calm(at(0.5)), at(0.5)); // 9:30 am, the advisory is over: a calm day's post would be next
  assert.deepEqual([r.posted, d.graph.length], [0, 1], "one post a day still holds");
  assert.ok(d.slack.some((m) => /started by a run that never finished/.test(m)), "and the owner is told to look at the Page");

  // two runs at the very same moment: one sends, the other sees the claim
  const two = world({ FB_MODE: "live", ...SECRETS });
  await two.run(hw("normal", 4, at(-1.5)), at(-1.5));
  const both = await Promise.all([two.run(weather(at(-1)), at(-1), { runId: "run-a" }), two.run(weather(at(-1)), at(-1), { runId: "run-b" })]);
  assert.deepEqual([two.graph.length, both.map((x) => x.posted).sort(), two.rows().map((x) => x.status)], [1, [0, 1], ["posted"]], "two racing runs, one post");

  // a pause does not lose the posts behind the one that failed: the memory is left as it was
  const p = world({ FB_MODE: "live", ...SECRETS });
  await p.run(hw("normal", 4, at(-1.5)), at(-1.5));
  p.graphThrow = true;
  r = await p.run(hw("major", 12.4, at(-1)), at(-1)); // 8 am: the river post first, then the flood-day morning post
  assert.deepEqual([r.posted, r.failed, p.graph.length], [0, 1, 1], "no answer for the first: a pause starts and the second is not tried");
  p.graphThrow = false;
  r = await p.run(hw("major", 12.5, at(-0.5)), at(-0.5)); // the 15 min pause is over
  assert.deepEqual([r.posted, p.graph.length, p.graph[1]?.body.url], [1, 2, `${SITE}/api/story/home/now.jpg?format=portrait`]);
  assert.deepEqual(p.rows().map((x) => [x.kind, x.status]), [["gauge_rise", "failed"], ["flood_morning", "posted"]], "the morning post still went out; the failed one was not sent again");

  // a post that fails its own checks is recorded and said ONCE, not on every run
  const b = world({ FB_MODE: "dry", SITE_URL: "http://localhost:3000" });
  await b.run(calm(T0), T0);
  assert.ok(b.slack.length === 1 && /NOT sent because it failed its own checks: the link is not a plain https page of our own site/.test(b.slack[0]), b.slack.join("\n"));
  assert.deepEqual(b.rows().map((x) => [x.kind, x.status, /^checks: /.test(x.error)]), [["keepalive:rain", "failed", true]]);
  await b.run(calm(at(0.5)), at(0.5));
  assert.equal(b.slack.length, 1, "said once");
  assert.deepEqual([b.graph, b.pictures], [[], []]);

  // switching from dry to live in the middle of a day: what was already shown that day is not sent; the next new post is
  const sw = world({ FB_MODE: "dry", ...SECRETS });
  await sw.run(weather(at(-1)), at(-1));
  sw.env.FB_MODE = "live";
  r = await sw.run(weather(at(-0.5)), at(-0.5));
  assert.deepEqual([r.mode, r.posted, sw.graph.length], ["live", 0, 0]);
  r = await sw.run(weather(at(23)), at(23));
  assert.deepEqual([r.posted, sw.graph.length, sw.rows().map((x) => [x.mode, x.status])], [1, 1, [["dry", "dry"], ["live", "posted"]]]);
}

// the real script as a process: off by default, and stopped before anything when the database token is missing
{
  const script = fileURLToPath(new URL("./fb-post.mjs", import.meta.url));
  const cli = (env, ...args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8", timeout: 60_000 });
  const off = cli({});
  assert.deepEqual([off.status, off.stdout.trim().split("\n")], [0, ["gate: off (FB_MODE is not set: off (the default))", OFF_LINE]], off.stderr);
  const offSample = cli({ FB_MODE: "off", ...SECRETS }, "--mode", "sample");
  assert.ok(offSample.status === 0 && offSample.stdout.includes(OFF_LINE), offSample.stderr);
  const noDb = cli({ FB_MODE: "live", ...SECRETS });
  assert.ok(noDb.status === 0 && /CLOUDFLARE_API_TOKEN is missing/.test(noDb.stderr) && noDb.stdout === "", "no database token: nothing is read, shown or sent");
  assert.equal(cli({}, "--mode", "seed").status, 1, "an unknown mode is an error, never a guess");
}

// sample mode: Slack only, no memory, no Graph API; nothing at all when the switch is off
{
  const today = calm(T0);
  assert.deepEqual(sampleItems(today).map((i) => i.kind), ["weather_morning", "keepalive:rain", "keepalive:reservoirs", "keepalive:river", "keepalive:survey"]);
  const off = world(SECRETS);
  assert.deepEqual(await sample({ env: off.env, doFetch: off.doFetch, snap: today, now: T0, log: (x) => off.logs.push(x) }), []);
  assert.deepEqual([off.slack, off.pictures, off.graph, off.logs[1]], [[], [], [], OFF_LINE]);
  const w = world({ FB_MODE: "live", ...SECRETS });
  const out = await sample({ env: w.env, doFetch: w.doFetch, snap: today, now: T0, log: () => {} });
  assert.equal(out.length, 5);
  assert.ok(w.slack.length === 5 && w.slack.every((m) => /^\*SAMPLE, DRY RUN: not posted to Facebook\*/.test(m)), "samples are previews even when the switch says live");
  assert.ok(w.slack[4].includes("> Add your spot: https://waterlevels.lk/flood-survey") && w.slack[3].includes("https://waterlevels.lk/kelani-ganga"));
  assert.deepEqual([w.graph, w.ops, w.other], [[], [], []], "a sample never posts and never touches the memory");
  await assert.rejects(sample({ env: { FB_MODE: "dry" }, log: () => {} }), /doFetch must be handed in/);
}

// the files around the job
{
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const stmts = splitSql(read("d1/0022_fb_posts.sql"));
  assert.equal(stmts.length, 3);
  for (const s of stmts) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS (fb_posts|idx_fb_posts_day|fb_state)\b/, "every statement can be applied twice");
  const wf = read(".github/workflows/fb-post.yml");
  for (const need of ["if: github.event_name != 'schedule' || vars.FB_MODE == 'dry' || vars.FB_MODE == 'live'", "FB_MODE: ${{ vars.FB_MODE }}", "FB_PAGE_TOKEN: ${{ secrets.FB_PAGE_TOKEN }}", "FB_PAGE_ID: ${{ secrets.FB_PAGE_ID }}", "group: fb-post", "cancel-in-progress: false", "scripts/fb-post.mjs"]) assert.ok(wf.includes(need), `fb-post.yml has: ${need}`);
  assert.ok(!/IG_ACCESS_TOKEN|IG_USER_ID|X_API|X_ACCESS/.test(wf), "the Facebook job is handed no other platform's secret");
  assert.ok(!/FB_PAGE_TOKEN|FB_PAGE_ID|fb-post/.test(read(".github/workflows/ig-post.yml")), "the Instagram job does not carry the Facebook job");
  const start = read(".github/workflows/gsmap-snapshot.yml").split("\n      - name: ").find((s) => s.startsWith("Start the Facebook Page job"));
  assert.ok(start && /if: .*vars\.FB_MODE == 'dry' \|\| vars\.FB_MODE == 'live'/.test(start) && start.includes("continue-on-error: true") && start.includes("gh workflow run fb-post.yml"), "the job is not even started while FB_MODE is off, and can never fail the rain snapshot");
}

assert.deepEqual(net, [], "nothing in this file reached the network");
console.log("fb-post tests passed");
