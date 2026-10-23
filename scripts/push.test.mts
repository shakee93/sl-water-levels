// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types --no-warnings scripts/push.test.mts
// Runs the real sender (scripts/push-notify.mjs) against a fake Cloudflare D1 (node:sqlite behind a local HTTP server),
// a fake "places-state" answer and a fake push service, so the whole rise / all-clear / morning / cleanup path is checked.
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { validateSubscription, endpointOk, PUSH_SCHEMA } from "../lib/pushSub.ts";
import { parseKey } from "../lib/myPlaces.ts";

// ---- validation
const good = { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }, places: ["t:wellampitiya", "s:Hanwella", "t:wellampitiya"], lang: "si", morning: true };
const v = validateSubscription(good, parseKey);
assert.deepEqual(v.places, ["t:wellampitiya", "s:Hanwella"]);
assert.equal(v.lang, "si");
assert.equal(v.morning, true);
assert.equal(validateSubscription({ ...good, subscription: { ...good.subscription, endpoint: "https://evil.example.com/x" } }, parseKey), null, "only browsers' push services");
assert.equal(validateSubscription({ ...good, subscription: { ...good.subscription, endpoint: "http://fcm.googleapis.com/x" } }, parseKey), null, "https only");
assert.equal(validateSubscription({ ...good, subscription: { ...good.subscription, endpoint: "https://u:p@fcm.googleapis.com/x" } }, parseKey), null);
assert.equal(validateSubscription({ ...good, subscription: { ...good.subscription, endpoint: "https://fcm.googleapis.com.evil.com/x" } }, parseKey), null, "suffix match must be on a dot boundary");
assert.equal(validateSubscription({ ...good, places: [] }, parseKey), null);
assert.equal(validateSubscription({ ...good, places: ["nope"] }, parseKey), null);
assert.equal(validateSubscription({ ...good, places: Array.from({ length: 13 }, (_, i) => `t:p${i}`) }, parseKey), null);
assert.equal(validateSubscription({ ...good, subscription: { ...good.subscription, keys: { p256dh: "x", auth: "y" } } }, parseKey), null);
assert.equal(validateSubscription("nope", parseKey), null);
assert.equal(validateSubscription({ ...good, lang: "xx", morning: "yes" }, parseKey).lang, "en");
assert.equal(validateSubscription({ ...good, morning: "yes" }, parseKey).morning, false);
assert.equal(endpointOk("https://updates.push.services.mozilla.com/wpush/v2/x"), true);
assert.equal(endpointOk("https://web.push.apple.com/x"), true);
assert.equal(endpointOk("https://wns2-par02p.notify.windows.com/w"), true);

// ---- the d1 file mirrors PUSH_SCHEMA
const sqlFile = readFileSync(new URL("../d1/0004_push.sql", import.meta.url), "utf8");
for (const s of PUSH_SCHEMA) assert.ok(sqlFile.includes(s + ";"), "d1/0004_push.sql is missing: " + s.slice(0, 60));

// ---- fake D1
const db = new DatabaseSync(":memory:");
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") return res.end(JSON.stringify({ success: true, result: [{ uuid: "db1", name: "sl-water-levels" }] }));
    const { sql, params } = JSON.parse(body);
    try {
      const rows = db.prepare(sql).all(...params);
      res.end(JSON.stringify({ success: true, result: [{ results: rows }] }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, errors: [{ message: String(e.message) }] }));
    }
  });
});
await new Promise((r) => server.listen(0, r));
process.env.CF_API_BASE = `http://127.0.0.1:${server.address().port}`;
process.env.CLOUDFLARE_API_TOKEN = "test";
const { main } = await import("./push-notify.mjs");
const { d1Query } = await import("../lib/d1.ts");

const H = 3_600_000;
const sub = (n, places, o = {}) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, p256dh: "p".repeat(87), auth: "a".repeat(22), places: places.join("|"), lang: o.lang ?? "en", morning: o.morning ? 1 : 0 });
for (const s of PUSH_SCHEMA) await d1Query(s);
for (const [i, s] of [sub("a", ["t:wellampitiya", "s:Hanwella"]), sub("b", ["t:wellampitiya"], { lang: "si", morning: true }), sub("c", ["s:Hanwella"])].entries()) {
  await d1Query("INSERT INTO push_subscriptions (endpoint, p256dh, auth, places, lang, morning, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [s.endpoint, s.p256dh, s.auth, s.places, s.lang, s.morning, 1000 + i, 1000 + i]);
}
const glance = (key, name, o = {}) => ({ key, kind: key[0], name, href: key.startsWith("t:") ? `/flood/${key.slice(2)}` : "/kelani-ganga/hanwella", tone: "normal", street: null, streetDrives: false, trend: "steady", levelText: null, rain24: null, rainNext24: null, gaugeStation: null, ts: 1, ...o });
let world = {};
const doFetch = async (url) => {
  const keys = decodeURIComponent(new URL(url).searchParams.get("keys")).split("|");
  return { ok: true, status: 200, json: async () => ({ ok: true, places: keys.map((k) => world[k]).filter(Boolean) }) };
};
const sent = [];
let dead = new Set();
const send = async (s, payload) => {
  if (dead.has(s.endpoint)) return { ok: false, gone: true, status: 410 };
  sent.push({ to: s.endpoint.split("/").pop(), ...payload });
  return { ok: true };
};
const run = (extra = {}, t = Date.now()) => main({ send, doFetch, now: t, ...extra });
let t = 10_000 * H;

world = { "t:wellampitiya": glance("t:wellampitiya", "Wellampitiya"), "s:Hanwella": glance("s:Hanwella", "Hanwella") };
await run({}, t);
assert.equal(sent.length, 0, "first sight sends nothing");

// the quiet "possible" heads-up never pings
world["t:wellampitiya"] = glance("t:wellampitiya", "Wellampitiya", { tone: "watch", street: "possible", streetDrives: true });
await run({}, (t += H / 2));
assert.equal(sent.length, 0, "street 'possible' sends nothing");
await run({}, (t += H / 2));
assert.equal(sent.length, 0, "still nothing while it stays 'possible'");

world["t:wellampitiya"] = glance("t:wellampitiya", "Wellampitiya", { tone: "minor", street: "likely", streetDrives: true });
await run({}, (t += H / 2));
assert.deepEqual(sent.map((m) => m.to).sort(), ["a", "b"], "only people who pinned Wellampitiya");
const mb = sent.find((m) => m.to === "b");
assert.ok(mb.title.startsWith("Wellampitiya: "), "title names the place");
assert.equal(mb.url, "/si/flood/wellampitiya", "opens the place in the subscriber's language");
assert.equal(mb.tag, "t:wellampitiya");
sent.length = 0;

await run({}, (t += H / 2));
assert.equal(sent.length, 0, "no repeat while it stays the same");

world["t:wellampitiya"] = glance("t:wellampitiya", "Wellampitiya");
await run({}, (t += H / 2));
assert.equal(sent.length, 0, "first calm check: wait");
await run({}, (t += H / 2));
assert.deepEqual(sent.map((m) => [m.to, m.title]).sort(), [["a", "Wellampitiya: back to normal"], ["b", "Wellampitiya: back to normal".replace("Wellampitiya: back to normal", sent.find((m) => m.to === "b").title)]].sort(), "one all-clear each");
assert.equal(sent.length, 2);
sent.length = 0;
await run({}, (t += H / 2));
assert.equal(sent.length, 0, "all-clear once");

// unreadable place: nothing sent, state kept
world["s:Hanwella"] = glance("s:Hanwella", "Hanwella", { tone: "stale" });
await run({}, (t += H / 2));
assert.equal(sent.length, 0);

// dead subscription is deleted, others unaffected
dead.add("https://fcm.googleapis.com/fcm/send/c");
world["s:Hanwella"] = glance("s:Hanwella", "Hanwella", { tone: "alert" });
await run({}, (t += H / 2));
assert.deepEqual(sent.map((m) => m.to).sort(), ["a"], "c is gone, a still gets it");
assert.equal((await d1Query("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%/c'"))[0].n, 0, "dead subscription deleted");
sent.length = 0;

// morning summary: only opted-in, only readable
world["t:wellampitiya"] = glance("t:wellampitiya", "Wellampitiya");
await run({ mode: "morning" }, (t += H));
assert.deepEqual(sent.map((m) => m.to), ["b"]);
assert.ok(sent[0].body.length > 0);
sent.length = 0;
world = {};
await run({ mode: "morning" }, (t += H));
assert.equal(sent.length, 0, "no readable place: no 'all calm' claim");

// test mode
await run({ test: "latest" }, (t += H));
assert.equal(sent.length, 1);
assert.equal(sent[0].tag, "test");
assert.equal((await d1Query("SELECT COUNT(*) AS n FROM push_log"))[0].n > 0, true, "counts are logged");
assert.equal(Object.keys((await d1Query("SELECT * FROM push_log LIMIT 1"))[0]).includes("endpoint"), false, "the log holds no endpoints");

server.close();
console.log("push: ok");
