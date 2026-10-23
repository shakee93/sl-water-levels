// Sends the Web Push alerts for pinned places (lib/myPlaces.ts, app/AlertsToggle.tsx).
//
//   node --experimental-strip-types --no-warnings scripts/push-notify.mjs [--mode check|morning] [--dry-run]
//   node ... scripts/push-notify.mjs --test latest|<endpoint-sha256-prefix>     send ONE test push, change nothing else
//
// check    (every ~30 min, after the satellite-rain snapshot): reads the subscriptions from Cloudflare D1, asks the
//          site what it says about every pinned place (GET /api/places-state: the same answer the pages show), runs each
//          place through the state machine (lib/myPlaces.ts pushStep) and sends ONE message per real change:
//          a rise to "get ready / water on the streets possible" or worse, and one all-clear. Nothing else is sent.
// morning  (once a day, 06:00 Colombo): a short summary to the people who ticked "send a summary each morning".
//          Skipped for a person whose places we cannot read (we never say "all calm" without data).
// Needs: CLOUDFLARE_API_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (GitHub Actions secrets). Without the VAPID pair it
// exits 0 with a warning (nothing breaks). Never prints endpoints or keys. A subscription the push service reports as
// gone (404/410), or that fails 3 times in a row, is deleted.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { d1Query } from "../lib/d1.ts";
import { levelOf, pushStep, parseKey } from "../lib/myPlaces.ts";
import { PUSH_SCHEMA, MAX_FAILS } from "../lib/pushSub.ts";
import { pushText } from "../lib/i18n/return.ts";
import { localePath } from "../lib/i18n/config.ts";

const SITE = process.env.SITE_URL || "https://sl-water-levels.vercel.app";
const CHUNK = 10;
const CONCURRENCY = 8;
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

async function loadWebPush() {
  const m = await import("web-push");
  return m.default ?? m;
}

/** Real sender: web-push with the VAPID pair. */
export async function realSender() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const wp = await loadWebPush();
  wp.setVapidDetails(process.env.VAPID_SUBJECT || SITE, pub, priv);
  return async (sub, payload) => {
    try {
      await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
      return { ok: true };
    } catch (e) {
      const status = e && typeof e === "object" && "statusCode" in e ? Number(e.statusCode) : 0;
      return { ok: false, gone: status === 404 || status === 410, status };
    }
  };
}

async function fetchGlances(keys, doFetch) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    try {
      const res = await doFetch(`${SITE}/api/places-state?keys=${encodeURIComponent(chunk.join("|"))}`, { signal: AbortSignal.timeout(60_000), headers: { "Cache-Control": "no-cache" } });
      const j = await res.json();
      if (res.ok && j.ok) for (const g of j.places) out.set(g.key, g);
      else console.warn(`places-state chunk ${i / CHUNK + 1}: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`places-state chunk ${i / CHUNK + 1}: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  return out;
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); }));
}

const subsOf = async () =>
  (await d1Query("SELECT endpoint, p256dh, auth, places, lang, morning, fail_count FROM push_subscriptions")).map((r) => ({
    endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth), places: String(r.places).split("|").filter(Boolean),
    lang: r.lang === "si" || r.lang === "ta" ? r.lang : "en", morning: Number(r.morning) === 1, fails: Number(r.fail_count ?? 0),
  }));

/** Sends to each subscription, then records success, gone (delete) or failure. Returns counts. */
async function deliver(send, jobs, now, dry) {
  const c = { sent: 0, gone: 0, failed: 0 };
  await pool(jobs, CONCURRENCY, async ({ sub, payload }) => {
    if (dry) return void (c.sent++, console.log(`[dry-run] -> ${sha(sub.endpoint)} ${payload.title} | ${payload.body}`));
    const r = await send(sub, payload);
    if (r.ok) {
      c.sent++;
      await d1Query("UPDATE push_subscriptions SET last_ok_ms = ?, fail_count = 0 WHERE endpoint = ?", [now, sub.endpoint]);
    } else if (r.gone || sub.fails + 1 >= MAX_FAILS) {
      c.gone++;
      await d1Query("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint]);
    } else {
      c.failed++;
      await d1Query("UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = ?", [sub.endpoint]);
    }
  });
  return c;
}

const logRow = (now, kind, place, c, dry) => (dry ? null : d1Query("INSERT INTO push_log (ts, kind, place, sent, gone, failed) VALUES (?, ?, ?, ?, ?, ?)", [now, kind, place, c.sent, c.gone, c.failed]));

export async function main({ mode = "check", dry = false, test = null, now = Date.now(), send = null, doFetch = fetch } = {}) {
  for (const s of PUSH_SCHEMA) await d1Query(s);
  if (!dry && !send) send = await realSender();
  if (!dry && !send) {
    console.warn("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set: nothing sent. See DOCS.md 'Reasons to come back'.");
    return { skipped: true };
  }
  const subs = await subsOf();
  console.log(`${subs.length} subscription(s)`);

  if (test) {
    const sub = test === "latest" ? (await subsOf()).at(-1) : subs.find((s) => sha(s.endpoint).startsWith(test));
    if (!sub) throw new Error("no matching subscription");
    const m = pushText(sub.lang, "test", []);
    const c = await deliver(send, [{ sub, payload: { title: m.title, body: m.body, url: localePath(sub.lang, "/"), tag: "test", lang: sub.lang } }], now, dry);
    console.log(`test push to ${sha(sub.endpoint)}: ${JSON.stringify(c)}`);
    return c;
  }
  if (subs.length === 0) return { sent: 0 };

  const keys = [...new Set(subs.flatMap((s) => s.places))].filter((k) => parseKey(k));
  const glances = await fetchGlances(keys, doFetch);
  console.log(`${glances.size}/${keys.length} place(s) readable`);

  if (mode === "morning") {
    const jobs = [];
    for (const sub of subs.filter((s) => s.morning)) {
      const places = sub.places.map((k) => glances.get(k)).filter(Boolean).map((g) => ({ name: g.name, level: levelOf(g), street: g.street })).filter((p) => p.level != null);
      if (places.length === 0) continue; // nothing readable: say nothing rather than "all calm"
      const m = pushText(sub.lang, "morning", places);
      jobs.push({ sub, payload: { title: m.title, body: m.body, url: localePath(sub.lang, "/"), tag: "morning", lang: sub.lang } });
    }
    const c = await deliver(send, jobs, now, dry);
    console.log(`morning: ${JSON.stringify(c)}`);
    if (!dry) await logRow(now, "morning", null, c, dry);
    return c;
  }

  // ---- check: advance each place's state, send only on a real change
  const stateRows = await d1Query("SELECT key, level, notified, last_rise_ms, clear_runs FROM push_place_state");
  const states = new Map(stateRows.map((r) => [String(r.key), { level: Number(r.level), notified: Number(r.notified), lastRiseMs: r.last_rise_ms == null ? null : Number(r.last_rise_ms), clearRuns: Number(r.clear_runs) }]));
  const total = { sent: 0, gone: 0, failed: 0 };
  for (const key of keys) {
    const g = glances.get(key);
    if (!g) continue;
    const step = pushStep(states.get(key) ?? null, levelOf(g), now);
    const n = step.next;
    if (!dry) {
      await d1Query(
        "INSERT INTO push_place_state (key, level, notified, last_rise_ms, clear_runs, updated_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET level = excluded.level, notified = excluded.notified, last_rise_ms = excluded.last_rise_ms, clear_runs = excluded.clear_runs, updated_ms = excluded.updated_ms",
        [key, n.level, n.notified, n.lastRiseMs, n.clearRuns, now],
      );
    }
    if (!step.send) continue;
    const jobs = subs.filter((s) => s.places.includes(key)).map((sub) => {
      const m = pushText(sub.lang, step.send, [{ name: g.name, level: step.level, street: g.street }]);
      return { sub, payload: { title: m.title, body: m.body, url: localePath(sub.lang, g.href), tag: key, lang: sub.lang } };
    });
    const c = await deliver(send, jobs, now, dry);
    console.log(`${step.send} ${key}: ${JSON.stringify(c)}`);
    total.sent += c.sent; total.gone += c.gone; total.failed += c.failed;
    if (!dry) await logRow(now, step.send, key, c, dry);
  }
  return total;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  main({ mode: val("--mode") ?? "check", dry: a.includes("--dry-run"), test: val("--test") }).catch((e) => {
    console.error(`push-notify failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
