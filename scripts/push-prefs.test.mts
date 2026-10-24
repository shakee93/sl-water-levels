// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/push-prefs.test.mts
// Alert settings: defaults equal the old behaviour, preference filtering per place and level, quiet hours in Colombo time,
// the all-clear rules, the owner broadcast and the counts-only stats line. Pure rules first, then the real sender against
// a fake D1 and a fake push service.
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_PREFS, parsePrefs, inQuiet, colombo, morningDue, subLevel, qualifies, bypassesQuiet, baseKey, isDefaultPrefs } from "../lib/pushPrefs.ts";
import { PUSH_SCHEMA } from "../lib/pushSub.ts";
import { evalSub, broadcastPayload, broadcastRecipients } from "./push-eval.mjs";

// ---------- defaults
assert.deepEqual(parsePrefs(undefined), DEFAULT_PREFS);
assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
assert.deepEqual(parsePrefs("garbage"), DEFAULT_PREFS);
assert.deepEqual(parsePrefs({}), DEFAULT_PREFS);
assert.deepEqual(parsePrefs({ riverMin: 9, morningAt: "03:00", quiet: { from: "22:00", to: "22:00" }, streetLikely: "yes" }), DEFAULT_PREFS, "malformed fields fall back");
assert.equal(DEFAULT_PREFS.riverMin, 2, "today's behaviour: Alert level, 'Get ready'");
assert.equal(DEFAULT_PREFS.streetLikely, true);
assert.equal(DEFAULT_PREFS.streetPossible, false);
assert.equal(DEFAULT_PREFS.reservoir, false);
assert.equal(DEFAULT_PREFS.allClear, true);
assert.equal(DEFAULT_PREFS.morning, false);
assert.equal(DEFAULT_PREFS.quiet, null);
assert.equal(DEFAULT_PREFS.announce, true);
assert.equal(parsePrefs(null, true).morning, true, "an old subscriber who ticked the morning summary keeps it");
assert.equal(isDefaultPrefs(parsePrefs({})), true);
const custom = parsePrefs({ muted: ["t:wellampitiya@3.4", "bad", "s:Hanwella"], riverMin: 3, quiet: { from: "22:00", to: "06:00" }, morning: true, morningAt: "07:30", announce: false });
assert.deepEqual(custom.muted, ["t:wellampitiya", "s:Hanwella"], "mute by place, not by the visitor's own street level");
assert.equal(custom.riverMin, 3);
assert.deepEqual(custom.quiet, { from: "22:00", to: "06:00" });
assert.equal(custom.morningAt, "07:30");
assert.equal(custom.announce, false);
assert.equal(baseKey("t:a@3.4"), "t:a");

// ---------- quiet hours in Colombo time (UTC+5:30, no daylight saving)
const at = (iso) => Date.parse(iso);
assert.equal(colombo(at("2026-10-24T17:00:00Z")).minutes, 22 * 60 + 30);
assert.equal(colombo(at("2026-10-24T20:00:00Z")).day, "2026-10-25", "the Colombo day, not the UTC day");
const q = parsePrefs({ quiet: { from: "22:00", to: "06:00" } });
assert.equal(inQuiet(q, at("2026-10-24T16:30:00Z")), true, "22:00 Colombo");
assert.equal(inQuiet(q, at("2026-10-24T16:29:00Z")), false, "21:59 Colombo");
assert.equal(inQuiet(q, at("2026-10-24T20:00:00Z")), true, "01:30 Colombo, after midnight");
assert.equal(inQuiet(q, at("2026-10-25T00:29:00Z")), true, "05:59 Colombo");
assert.equal(inQuiet(q, at("2026-10-25T00:30:00Z")), false, "06:00 Colombo: quiet ends");
assert.equal(inQuiet(DEFAULT_PREFS, at("2026-10-24T20:00:00Z")), false, "off by default");
const day = parsePrefs({ quiet: { from: "13:00", to: "15:00" } });
assert.equal(inQuiet(day, at("2026-10-24T08:00:00Z")), true, "13:30 Colombo");
assert.equal(inQuiet(day, at("2026-10-24T10:00:00Z")), false, "15:30 Colombo");

// ---------- morning time
const mp = parsePrefs({ morning: true, morningAt: "06:30" });
assert.equal(morningDue(mp, at("2026-10-25T00:30:00Z"), null), false, "06:00 is before 06:30");
assert.equal(morningDue(mp, at("2026-10-25T01:00:00Z"), null), true, "06:30");
assert.equal(morningDue(mp, at("2026-10-25T01:00:00Z"), "2026-10-25"), false, "once a day");
assert.equal(morningDue(mp, at("2026-10-25T07:00:00Z"), null), false, "never after midday (12:30)");
assert.equal(morningDue(DEFAULT_PREFS, at("2026-10-25T01:00:00Z"), null), false, "off by default");

// ---------- what a place says to a subscriber
const G = (o = {}) => ({ key: "t:wellampitiya", name: "Wellampitiya", href: "/flood/wellampitiya", tone: "normal", baseTone: "normal", street: null, release: undefined, ...o });
const alert = G({ tone: "alert", baseTone: "alert" }), minor = G({ tone: "minor", baseTone: "minor" }), major = G({ tone: "major", baseTone: "major" });
const streetLikely = G({ tone: "minor", baseTone: "normal", street: "likely" });
const streetPossible = G({ tone: "watch", baseTone: "normal", street: "possible" });
assert.equal(subLevel(DEFAULT_PREFS, alert), 2);
assert.equal(subLevel(DEFAULT_PREFS, streetLikely), 3);
assert.equal(subLevel(parsePrefs({ streetLikely: false }), streetLikely), 0, "street 'likely' off: the river alone decides");
assert.equal(subLevel(DEFAULT_PREFS, G({ tone: "stale", baseTone: "stale" })), null, "no data is never calm");
assert.equal(subLevel(DEFAULT_PREFS, G({ tone: "minor", baseTone: "stale", street: "likely" })), 3, "street answer stands without a river reading");
assert.equal(qualifies(parsePrefs({ riverMin: 3 }), alert), false);
assert.equal(qualifies(parsePrefs({ riverMin: 3 }), minor), true);
assert.equal(qualifies(parsePrefs({ riverMin: 4 }), streetLikely), true, "street likely is its own choice");
assert.equal(qualifies(parsePrefs({ riverMin: 4, streetLikely: false }), streetLikely), false);
assert.equal(bypassesQuiet(DEFAULT_PREFS, major), true);
assert.equal(bypassesQuiet(DEFAULT_PREFS, streetLikely), true);
assert.equal(bypassesQuiet(DEFAULT_PREFS, minor), false);
assert.equal(bypassesQuiet(parsePrefs({ streetLikely: false }), streetLikely), false);

// ---------- evalSub: a walk through a flood
const H = 3_600_000;
const step = (prefs, state, g, now, seeds) => evalSub({ prefs, state, keys: ["t:wellampitiya"], glances: new Map([["t:wellampitiya", g]]), seeds, now });
const walk = (prefs, gs, t0 = at("2026-10-24T06:00:00Z")) => {
  let st = null, t = t0;
  return gs.map((g) => {
    const r = step(prefs, st, g, (t += H));
    st = r.state;
    return r.messages.map((m) => m.kind).join("+") || "-";
  });
};
const calm = G();
assert.deepEqual(walk(DEFAULT_PREFS, [calm, alert, minor, minor, calm, calm, calm]), ["-", "rise", "rise", "-", "-", "clear", "-"], "defaults: rise at Get ready, again when worse, one all-clear after two calm checks");
assert.deepEqual(walk(parsePrefs({ riverMin: 3 }), [calm, alert, alert, minor, calm, calm]), ["-", "-", "-", "rise", "-", "clear"], "Minor level: silent at Alert, told at Minor, all-clear after");
assert.deepEqual(walk(parsePrefs({ riverMin: 3 }), [calm, alert, alert, calm, calm, calm]), ["-", "-", "-", "-", "-", "-"], "never told, so no all-clear");
assert.deepEqual(walk(parsePrefs({ riverMin: 4 }), [calm, minor, major, calm, calm]), ["-", "-", "rise", "-", "clear"], "Major only");
assert.deepEqual(walk(parsePrefs({ riverMin: 4 }), [calm, streetLikely, streetLikely, calm, calm]), ["-", "rise", "-", "-", "clear"], "street likely comes through even when the river level asked for is Major");
assert.deepEqual(walk(parsePrefs({ riverMin: 4, streetLikely: false }), [calm, streetLikely, calm, calm]), ["-", "-", "-", "-"], "street likely switched off");
assert.deepEqual(walk(parsePrefs({ allClear: false }), [calm, alert, calm, calm, calm, alert]), ["-", "rise", "-", "-", "-", "rise"], "no all-clear message, but a later rise is still announced");
assert.deepEqual(walk(DEFAULT_PREFS, [calm, streetPossible, streetPossible, calm]), ["-", "-", "-", "-"], "'possible' never pings by default");
{ // flap guard still applies: a wobble within 3 h is silent
  let st = null, t = at("2026-10-24T06:00:00Z"), out = [];
  for (const [g, gap] of [[calm, H], [alert, H], [calm, H / 2], [calm, H / 2], [alert, H / 2], [calm, H / 2]]) {
    t += gap;
    const r = step(DEFAULT_PREFS, st, g, t);
    st = r.state;
    out.push(r.messages.map((m) => m.kind).join("+") || "-");
  }
  assert.deepEqual(out, ["-", "rise", "-", "clear", "-", "-"], "second rise 1 h after the first is held back by the flap guard");
}

// muted place
{
  const p = parsePrefs({ muted: ["t:wellampitiya"] });
  assert.deepEqual(walk(p, [calm, alert, minor]), ["-", "-", "-"]);
  // un-muting while it is high: silent first sight, but the all-clear later still comes
  const a = step(p, null, alert, 1000);
  const b = step(DEFAULT_PREFS, a.state, alert, 2000);
  assert.equal(b.messages.length, 0, "no flood of messages on un-muting");
  const c = step(DEFAULT_PREFS, b.state, calm, 3000), d = step(DEFAULT_PREFS, c.state, calm, 4000);
  assert.equal(d.messages[0]?.kind, "clear");
}
// a place that is no longer pinned is forgotten
assert.deepEqual(Object.keys(evalSub({ prefs: DEFAULT_PREFS, state: step(DEFAULT_PREFS, null, alert, 1).state, keys: [], glances: new Map(), now: 2 }).state.pl), []);
// per-place levels: one subscriber, two places
{
  const prefs = parsePrefs({ riverMin: 3 });
  const gl = new Map([["t:wellampitiya", alert], ["s:Hanwella", G({ key: "s:Hanwella", name: "Hanwella", tone: "minor", baseTone: undefined })]]);
  const first = evalSub({ prefs, state: null, keys: ["t:wellampitiya", "s:Hanwella"], glances: new Map([["t:wellampitiya", calm], ["s:Hanwella", G({ name: "Hanwella", tone: "normal", baseTone: undefined })]]), now: 1 });
  const r = evalSub({ prefs, state: first.state, keys: ["t:wellampitiya", "s:Hanwella"], glances: gl, now: 2 * H });
  assert.deepEqual(r.messages.map((m) => m.key), ["s:Hanwella"], "Wellampitiya at Alert is below this person's level; Hanwella at Minor is not");
}

// quiet hours hold a message and send it afterwards; Major and street 'likely' never wait
{
  const qp = parsePrefs({ quiet: { from: "22:00", to: "06:00" } });
  const night = at("2026-10-24T18:00:00Z"), morning = at("2026-10-25T01:00:00Z"); // 23:30 and 06:30 Colombo
  let r = step(qp, null, calm, night - H);
  r = step(qp, r.state, alert, night);
  assert.equal(r.messages.length, 0, "Get ready at night waits");
  r = step(qp, r.state, alert, morning);
  assert.equal(r.messages[0]?.kind, "rise", "and arrives when quiet hours end, if still true");
  let m = step(qp, null, calm, night - H);
  m = step(qp, m.state, major, night);
  assert.equal(m.messages[0]?.kind, "rise", "Major flood comes through the night");
  let s = step(qp, null, calm, night - H);
  s = step(qp, s.state, streetLikely, night);
  assert.equal(s.messages[0]?.kind, "rise", "street 'likely' comes through the night");
  // all-clear waits too
  let c = step(qp, null, calm, night - 3 * H);
  c = step(qp, c.state, alert, night - 2 * H);
  assert.equal(c.messages[0]?.kind, "rise");
  c = step(qp, c.state, calm, night - H + 0); // 22:30 Colombo, quiet
  const c2 = step(qp, c.state, calm, night);
  const c3 = step(qp, c2.state, calm, night + H / 2);
  assert.equal(c2.messages.length + c3.messages.length, 0, "all-clear held during quiet hours");
  const c4 = step(qp, c3.state, calm, morning);
  assert.equal(c4.messages[0]?.kind, "clear", "and sent when they end");
}

// street 'possible' heads-up (opt-in): once, silent when already under way, resets after two clear checks
{
  const p = parsePrefs({ streetPossible: true });
  assert.deepEqual(walk(p, [calm, streetPossible, streetPossible, calm, calm, streetPossible]), ["-", "heads", "-", "-", "-", "heads"]);
  assert.deepEqual(walk(p, [streetPossible, streetPossible, calm]), ["-", "-", "-"], "already possible when first seen: silent");
  assert.deepEqual(walk(p, [calm, streetPossible, calm, streetPossible]), ["-", "heads", "-", "-"], "one calm check in between does not re-arm it");
  assert.deepEqual(walk(p, [calm, streetLikely]), ["-", "rise"], "straight to 'likely': the rise message covers it");
}
// reservoir release (opt-in)
{
  const p = parsePrefs({ reservoir: true });
  const rel = { name: "Deduru Oya", confirmed: true, etaHours: 4 };
  const gs = [G({ release: null }), G({ release: rel }), G({ release: rel }), G({ release: undefined }), G({ release: null }), G({ release: null }), G({ release: rel })];
  assert.deepEqual(walk(p, gs), ["-", "release", "-", "-", "-", "-", "release"]);
  assert.deepEqual(walk(DEFAULT_PREFS, gs), gs.map(() => "-"), "off by default");
}
// a subscriber already told before settings existed is not told twice (seeded from the shared place state)
{
  const seeds = new Map([["t:wellampitiya", { level: 2, notified: 2, lastRiseMs: 1, clearRuns: 0 }]]);
  const a = step(DEFAULT_PREFS, null, alert, 5 * H, seeds);
  assert.equal(a.messages.length, 0, "already announced: no repeat");
  const b = step(DEFAULT_PREFS, a.state, calm, 6 * H), c = step(DEFAULT_PREFS, b.state, calm, 7 * H);
  assert.equal(c.messages[0]?.kind, "clear", "and its all-clear still arrives");
}

// ---------- broadcast checks
const ok = broadcastPayload({ title: " Hello ", body: "Body", url: "https://sl-water-levels.vercel.app/si/flood/wellampitiya?x=1", language: "si" });
assert.equal(ok.ok, true);
assert.equal(ok.payload.url, "/si/flood/wellampitiya?x=1", "only the path travels");
assert.equal(ok.payload.title, "Hello");
assert.equal(broadcastPayload({ title: "t", body: "b", url: "", language: "all" }).payload.url, "/");
for (const bad of ["https://evil.example.com/x", "http://sl-water-levels.vercel.app/", "https://sl-water-levels.vercel.app.evil.com/", "https://user:pw@sl-water-levels.vercel.app/", "https://sl-water-levels.vercel.app:8443/", "javascript:alert(1)", "/relative"]) {
  assert.equal(broadcastPayload({ title: "t", body: "b", url: bad, language: "all" }).ok, false, "rejects " + bad);
}
assert.equal(broadcastPayload({ title: "", body: "b" }).ok, false);
assert.equal(broadcastPayload({ title: "t".repeat(81), body: "b" }).ok, false);
assert.equal(broadcastPayload({ title: "t", body: "b".repeat(241) }).ok, false);
assert.equal(broadcastPayload({ title: "t", body: "b", language: "fr" }).ok, false);
const subsB = [{ lang: "en", prefs: DEFAULT_PREFS }, { lang: "si", prefs: DEFAULT_PREFS }, { lang: "si", prefs: parsePrefs({ announce: false }) }, { lang: "ta", prefs: DEFAULT_PREFS }];
assert.equal(broadcastRecipients(subsB, "all").length, 3, "opted-out excluded");
assert.equal(broadcastRecipients(subsB, "si").length, 1);

// ---------- the real sender against a fake D1
const db = new DatabaseSync(":memory:");
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") return res.end(JSON.stringify({ success: true, result: [{ uuid: "db1", name: "sl-water-levels" }] }));
    const { sql, params } = JSON.parse(body);
    try {
      res.end(JSON.stringify({ success: true, result: [{ results: db.prepare(sql).all(...params) }] }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, errors: [{ message: String(e.message) }] }));
    }
  });
});
await new Promise((r) => server.listen(0, r));
process.env.CF_API_BASE = `http://127.0.0.1:${server.address().port}`;
process.env.CLOUDFLARE_API_TOKEN = "test";
const { main, stats } = await import("./push-notify.mjs");
const { d1Query } = await import("../lib/d1.ts");
for (const s of PUSH_SCHEMA) await d1Query(s);
await d1Query("DROP TABLE push_subscriptions");
await d1Query("DROP TABLE push_prefs");
for (const s of PUSH_SCHEMA) await d1Query(s); // the schema runs on every start: re-running it is harmless
for (const s of PUSH_SCHEMA) await d1Query(s);

let n = 0;
const addSub = async (name, places, { lang = "en", prefs = null, host = "fcm.googleapis.com", created = 1000 } = {}) => {
  const endpoint = `https://${host}/x/${name}`;
  await d1Query("INSERT INTO push_subscriptions (endpoint, p256dh, auth, places, lang, morning, created_ms, updated_ms) VALUES (?, 'p', 'a', ?, ?, 0, ?, ?)", [endpoint, places.join("|"), lang, created + n, created + n++]);
  if (prefs) await d1Query("INSERT INTO push_prefs (endpoint, prefs, updated_ms) VALUES (?, ?, 1)", [endpoint, JSON.stringify(prefs)]);
  return endpoint;
};
await addSub("def", ["t:wellampitiya"]);                                                  // defaults, no row at all
await addSub("m3", ["t:wellampitiya"], { prefs: { riverMin: 3 } });                       // Minor level and up
await addSub("muted", ["t:wellampitiya", "s:Hanwella"], { prefs: { muted: ["t:wellampitiya"] } });
await addSub("noann", ["s:Hanwella"], { lang: "si", prefs: { announce: false }, host: "web.push.apple.com" });
await addSub("ta", ["s:Hanwella"], { lang: "ta", host: "updates.push.services.mozilla.com" });

let world = {};
const doFetch = async (url) => {
  const keys = decodeURIComponent(new URL(url).searchParams.get("keys")).split("|");
  return { ok: true, status: 200, json: async () => ({ ok: true, places: keys.map((k) => world[k]).filter(Boolean) }) };
};
const sent = [];
const send = async (s, payload) => (sent.push({ to: s.endpoint.split("/").pop(), ...payload }), { ok: true });
const tos = () => sent.map((m) => m.to).sort();
const w = (o) => ({ "t:wellampitiya": G({ ...o }), "s:Hanwella": G({ key: "s:Hanwella", name: "Hanwella", href: "/kelani-ganga/hanwella", tone: "normal", baseTone: undefined }) });
let t = at("2026-10-24T06:00:00Z"); // 11:30 Colombo
const run = (extra = {}) => main({ send, doFetch, now: (t += H / 2), ...extra });

world = w({});
await run();
assert.equal(sent.length, 0, "first sight");
world = w({ tone: "alert", baseTone: "alert" });
await run();
assert.deepEqual(tos(), ["def"], "Alert level: the default subscriber only. m3 wants Minor, 'muted' muted this place");
sent.length = 0;
world = w({ tone: "minor", baseTone: "minor" });
await run();
assert.deepEqual(tos(), ["def", "m3"], "Minor level: m3 is told now, def is told it got worse; muted stays silent");
sent.length = 0;
const stRow = (await d1Query("SELECT state FROM push_prefs WHERE endpoint LIKE '%/m3'"))[0];
assert.ok(stRow && JSON.parse(stRow.state).pl["t:wellampitiya"], "memory is kept per subscriber");
assert.equal((await d1Query("SELECT prefs FROM push_prefs WHERE endpoint LIKE '%/m3'"))[0].prefs, JSON.stringify({ riverMin: 3 }), "saving memory never touches the saved choices");
world = w({});
await run(); await run();
assert.deepEqual(tos(), ["def", "m3"], "both get the all-clear");
sent.length = 0;

// morning at the chosen time, once a day, with the other choices left alone
await d1Query("INSERT INTO push_prefs (endpoint, prefs, updated_ms) VALUES ('https://fcm.googleapis.com/x/def', ?, 1) ON CONFLICT(endpoint) DO UPDATE SET prefs = excluded.prefs", [JSON.stringify({ morning: true, morningAt: "07:30" })]);
t = at("2026-10-25T01:00:00Z"); // 06:30 Colombo
await run();
assert.equal(sent.length, 0, "before the chosen time");
t = at("2026-10-25T02:10:00Z"); // 07:40
await run();
assert.deepEqual(tos(), ["def"]);
assert.equal(sent[0].tag, "morning");
sent.length = 0;
await run();
assert.equal(sent.length, 0, "only once that day");

// broadcast
const before = (await d1Query("SELECT COUNT(*) AS n FROM push_log"))[0].n;
const bc = { title: "New in the app", body: "You can now choose your alerts.", url: "https://sl-water-levels.vercel.app/en", language: "all" };
const lines = [];
const origLog = console.log;
console.log = (...a) => lines.push(a.join(" "));
const dryRes = await main({ send, now: t, broadcast: bc, dry: true });
console.log = origLog;
assert.equal(dryRes.recipients, 4, "5 subscribers, 1 opted out");
assert.equal(sent.length, 0, "a dry run sends nothing");
assert.ok(lines.join("\n").includes("recipients: 4 of 5"), "the dry run prints the count");
assert.ok(!lines.join("\n").includes("fcm.googleapis") && !lines.join("\n").includes("/x/"), "and no endpoints");
await assert.rejects(main({ send, now: t, broadcast: { ...bc, url: "https://evil.example.com" }, dry: true }), /url must be on/);
await assert.rejects(main({ send, now: t, broadcast: { ...bc, url: "https://evil.example.com" } }), /url must be on/);
assert.equal(sent.length, 0);
await main({ send, now: t, broadcast: { ...bc, language: "si" } });
assert.equal(sent.length, 0, "the only Sinhala subscriber opted out");
await main({ send, now: t, broadcast: bc });
assert.deepEqual(tos(), ["def", "m3", "muted", "ta"], "everyone except the one who opted out");
assert.equal(sent[0].url, "/en");
assert.equal(sent[0].tag, "announce");
assert.equal((await d1Query("SELECT COUNT(*) AS n FROM push_log WHERE kind = 'broadcast'"))[0].n, 2, "real broadcasts are counted (no endpoints)");
assert.ok((await d1Query("SELECT COUNT(*) AS n FROM push_log"))[0].n > before);
sent.length = 0;

// stats: counts only
process.env.SLACK_WEBHOOK_URL = "https://hooks.example.test/x";
const posts = [];
const res = await stats({ now: t, post: async (u, init) => (posts.push(JSON.parse(init.body).text), { ok: true }) });
assert.equal(res.posted, true);
assert.match(posts[0], /5 subscribers/);
assert.match(posts[0], /apple 1, google 3, mozilla 1/);
assert.match(posts[0], /Language: en 3, si 1, ta 1/);
assert.match(posts[0], /Top places: Hanwella 3, Wellampitiya 3/);
assert.ok(!/googleapis|\/x\/|p256dh/.test(posts[0]), "no endpoints, no keys");

server.close();
console.log("push-prefs: ok");
