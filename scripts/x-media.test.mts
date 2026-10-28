// @ts-nocheck
// node --experimental-strip-types --no-warnings scripts/x-media.test.mts
// X pictures: selection per post type and X_MEDIA mode, fetch / upload / alt-text with a mocked fetch, text-only fallback, cost, dry-run message.
import assert from "node:assert/strict";
import { mediaMode, mediaFor, pickMedia, mediaCost, fetchImage, attachMedia } from "./x-media.mjs";
import { costOf, dryRunMessage } from "./x-post.mjs";

const SITE = "https://waterlevels.lk";
const NOW = Date.parse("2026-10-28T14:40:00Z"); // 8:10 pm Colombo
const g = (tier, o = {}) => ({ station: "Ratnapura", river: "Kalu Ganga", tier, level: 19, mark: 18, alertMark: 14, trend: "falling", nextHour: null, url: `${SITE}/kalu-ganga/ratnapura`, at: NOW, ...o });
const rise = { type: "gauge_rise", kind: "alert", gauges: [g("alert")] };
const clear = { type: "gauge_clear", kind: "clear", gauges: [g("normal")] };
const storm = { type: "storm", kind: "storm", storm: { river: "Kalu Ganga", at: NOW, gauges: [g("alert")], url: `${SITE}/kalu-ganga/ratnapura` } };
const morning = { type: "summary", kind: "morning", summary: { period: "morning", at: NOW, atAlert: [{ station: "A", tier: "alert" }], nearAlert: 2, url: SITE } };
const evening = { type: "summary", kind: "evening", summary: { ...morning.summary, period: "evening" } };
const resv = { type: "reservoir_start", kind: "reservoir", reservoirs: [{ name: "X", url: `${SITE}/reservoirs/x` }] };

// mode parsing
assert.equal(mediaMode({}), "alerts");
assert.equal(mediaMode({ X_MEDIA: " OFF " }), "off");
assert.equal(mediaMode({ X_MEDIA: "all" }), "all");
assert.equal(mediaMode({ X_MEDIA: "junk" }), "alerts");

// selection
const m = pickMedia([rise], "alerts", SITE);
assert.equal(m.url, `${SITE}/api/story/gauge/ratnapura.png?format=square`);
assert.equal(m.alt, "Ratnapura, Kalu Ganga: 19.0 ft, Alert, falling, 8:10 pm");
assert.equal(pickMedia([morning], "alerts", SITE).url, `${SITE}/api/story/home/now.png?format=square`);
for (const ev of [clear, storm, evening, resv]) assert.equal(pickMedia([ev], "alerts", SITE), null, ev.type);
assert.equal(pickMedia([rise], "off", SITE), null);
assert.equal(pickMedia([clear], "all", SITE).url, `${SITE}/api/story/gauge/ratnapura.png?format=square`);
assert.equal(pickMedia([storm], "all", SITE).url, `${SITE}/api/story/river/kalu-ganga.png?format=square`);
assert.equal(pickMedia([evening], "all", SITE).kind, "home");
assert.equal(pickMedia([resv], "all", SITE), null);
assert.equal(pickMedia([storm, rise], "alerts", SITE).kind, "gauge", "combined: first event that wants a picture");
assert.equal(mediaFor({ ...rise, gauges: [g("alert"), g("major", { station: "Kalawellawa", url: `${SITE}/kalu-ganga/kalawellawa` })] }, "alerts").slug, "kalawellawa", "worst gauge");

// cost
const rates = { post: 0.015, link: 0.2, media: 0, alt: 0.005 };
assert.equal(mediaCost(rates), 0.005);
assert.ok(Math.abs(costOf("hi", [], rates) - 0.015) < 1e-9);
assert.ok(Math.abs(costOf("hi", [], rates, true) - 0.02) < 1e-9);
assert.ok(Math.abs(costOf("hi https://x.lk", [], rates, true) - 0.205) < 1e-9);

// fetch + upload with a mocked fetch (no network)
const png = new Uint8Array(5000).fill(7);
const calls = [];
const mock = (o = {}) => async (url, init = {}) => {
  calls.push([String(url), init.method ?? "GET"]);
  const u = String(url);
  if (u.includes("/api/story/")) return o.img ?? new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  if (u.endsWith("/2/media/upload")) return o.up ?? new Response(JSON.stringify({ data: { id: "m1" } }), { status: 200 });
  if (u.endsWith("/2/media/metadata")) return o.meta ?? new Response("{}", { status: 200 });
  return new Response("{}", { status: 404 });
};
const keys = { apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" };
{
  const r = await attachMedia(keys, m, { doFetch: mock() });
  assert.deepEqual(r.mediaIds, ["m1"]); assert.equal(r.altSet, true);
  assert.deepEqual(calls.map((c) => c[0].replace(/^https:\/\/[^/]+/, "")), ["/api/story/gauge/ratnapura.png?format=square", "/2/media/upload", "/2/media/metadata"]);
}
// failures never throw: text-only
assert.match((await attachMedia(keys, m, { doFetch: mock({ img: new Response("x", { status: 500 }) }) })).why, /HTTP 500/);
assert.match((await attachMedia(keys, m, { doFetch: mock({ img: new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }) }) })).why, /not a PNG/);
assert.match((await attachMedia(keys, m, { doFetch: mock({ img: new Response(new Uint8Array(10), { status: 200, headers: { "content-type": "image/png" } }) }) })).why, /too small/);
assert.match((await attachMedia(keys, m, { doFetch: mock({ up: new Response("{}", { status: 403 }) }) })).why, /upload failed/);
assert.match((await attachMedia(keys, m, { doFetch: async () => { throw new Error("net"); } })).why, /not fetched/);
{
  const r = await attachMedia(keys, m, { doFetch: mock({ meta: new Response("{}", { status: 400 }) }) });
  assert.deepEqual(r.mediaIds, ["m1"]); assert.equal(r.altSet, false, "alt text failing keeps the picture");
}
assert.equal((await fetchImage(m.url, mock())).ok, true);

// dry-run message shows the image and alt text
const msg = dryRunMessage({ n: 1, of: 1, kind: "alert", text: "hello", media: m, mediaCheck: "fetched, 4 KB", cost: 0.02 });
assert.ok(msg.includes(m.url) && msg.includes(m.alt) && msg.includes("fetched, 4 KB") && msg.includes("$0.020"));
assert.ok(!dryRunMessage({ n: 1, of: 1, kind: "alert", text: "hello" }).includes("Image"));
console.log("x-media tests passed");
