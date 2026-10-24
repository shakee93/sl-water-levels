// Sends the Web Push alerts for pinned places (lib/myPlaces.ts, app/AlertsToggle.tsx).
//
//   node --experimental-strip-types --no-warnings scripts/push-notify.mjs [--mode check|morning] [--dry-run] [--force]
//   node ... scripts/push-notify.mjs --test latest|<endpoint-sha256-prefix>     send ONE test push, change nothing else
//   node ... scripts/push-notify.mjs --broadcast [--dry-run]    one owner message (title/body/url/language from BC_* env vars)
//   node ... scripts/push-notify.mjs --stats [--dry-run]        counts-only subscriber summary to Slack (SLACK_WEBHOOK_URL)
//
// Every subscriber has settings (lib/pushPrefs.ts, table push_prefs; no row = the defaults, which equal the behaviour
// before settings existed). scripts/push-eval.mjs decides per subscriber what they hear: which places, the lowest river
// level, street water likely / possible, reservoir releases, all-clear, quiet hours (Colombo time).
//
// check    (every ~30 min, after the satellite-rain snapshot): reads the subscriptions from Cloudflare D1, asks the
//          site what it says about every pinned place (GET /api/places-state: the same answer the pages show), runs each
//          place through the state machine (lib/myPlaces.ts pushStep) and sends ONE message per real change:
//          a rise to "get ready" or worse (street water "likely" counts; "possible" is a quiet heads-up and never pings), and one all-clear. Nothing else is sent.
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
import { parsePrefs, baseKey, morningDue, colombo, inQuiet } from "../lib/pushPrefs.ts";
import { evalSub, broadcastPayload, broadcastRecipients } from "./push-eval.mjs";
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

const json = (v) => {
  try { return v ? JSON.parse(String(v)) : null; } catch { return null; }
};
const subsOf = async () =>
  (await d1Query("SELECT s.endpoint, s.p256dh, s.auth, s.places, s.lang, s.morning, s.fail_count, s.created_ms, p.prefs, p.state FROM push_subscriptions s LEFT JOIN push_prefs p ON p.endpoint = s.endpoint ORDER BY s.created_ms")).map((r) => {
    const prefs = parsePrefs(json(r.prefs), Number(r.morning) === 1);
    return {
      endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth), places: String(r.places).split("|").filter(Boolean),
      lang: r.lang === "si" || r.lang === "ta" ? r.lang : "en", morning: prefs.morning, prefs, fails: Number(r.fail_count ?? 0),
      created: Number(r.created_ms ?? 0), state: json(r.state), stateRaw: r.state == null ? null : String(r.state),
    };
  });

const saveState = (sub, state) => {
  const raw = JSON.stringify(state);
  if (raw === sub.stateRaw) return null;
  return d1Query("INSERT INTO push_prefs (endpoint, state, updated_ms) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET state = excluded.state", [sub.endpoint, raw, Date.now()]);
};

/** Sends to each subscription, then records success, gone (delete) or failure. Returns counts. */
async function deliver(send, jobs, now, dry, groups = null) {
  const c = { sent: 0, gone: 0, failed: 0 };
  const bump = (job, f) => {
    if (!groups || !job.kind) return;
    const k = `${job.kind}\u0000${job.place ?? ""}`;
    const g = groups.get(k) ?? { kind: job.kind, place: job.place ?? null, sent: 0, gone: 0, failed: 0 };
    g[f]++;
    groups.set(k, g);
  };
  await pool(jobs, CONCURRENCY, async (job) => {
    const { sub, payload } = job;
    if (dry) return void (c.sent++, bump(job, "sent"), console.log(`[dry-run] -> ${sha(sub.endpoint)} ${payload.title} | ${payload.body}`));
    const r = await send(sub, payload);
    if (r.ok) {
      c.sent++;
      bump(job, "sent");
      await d1Query("UPDATE push_subscriptions SET last_ok_ms = ?, fail_count = 0 WHERE endpoint = ?", [now, sub.endpoint]);
    } else if (r.gone || sub.fails + 1 >= MAX_FAILS) {
      c.gone++;
      sub.gone = true;
      bump(job, "gone");
      await d1Query("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint]);
      await d1Query("DELETE FROM push_prefs WHERE endpoint = ?", [sub.endpoint]);
    } else {
      c.failed++;
      bump(job, "failed");
      await d1Query("UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = ?", [sub.endpoint]);
    }
  });
  return c;
}

const logRow = (now, kind, place, c, dry) => (dry ? null : d1Query("INSERT INTO push_log (ts, kind, place, sent, gone, failed) VALUES (?, ?, ?, ?, ?, ?)", [now, kind, place, c.sent, c.gone, c.failed]));

const urlFor = (sub, href) => localePath(sub.lang, href);

/** Morning summaries for the people who asked, once a Colombo day each. `force` ignores the chosen time (manual run). */
function morningJobs(subs, glances, now, force) {
  const jobs = [];
  const { day } = colombo(now);
  for (const sub of subs) {
    if (!sub.prefs.morning) continue;
    const md = sub.state?.md ?? null;
    if (force ? md === day : !morningDue(sub.prefs, now, md)) continue;
    const places = sub.places.filter((k) => !sub.prefs.muted.includes(baseKey(k))).map((k) => glances.get(k)).filter(Boolean).map((g) => ({ name: g.name, level: levelOf(g), street: g.street })).filter((p) => p.level != null);
    if (places.length === 0) continue; // nothing readable: say nothing rather than "all calm"
    const m = pushText(sub.lang, "morning", places);
    jobs.push({ sub, kind: "morning", place: null, payload: { title: m.title, body: m.body, url: urlFor(sub, "/"), tag: "morning", lang: sub.lang } });
  }
  return jobs;
}

/** Counts only, no endpoints: how many people follow us and what they follow. Posts one line to Slack. */
export async function stats({ dry = false, now = Date.now(), post = null } = {}) {
  for (const s of PUSH_SCHEMA) await d1Query(s);
  const subs = await subsOf();
  const host = (e) => { try { return new URL(e).hostname; } catch { return ""; } };
  const svc = { apple: 0, google: 0, mozilla: 0, other: 0 };
  for (const s of subs) {
    const h = host(s.endpoint);
    if (/push\.apple\.com$/.test(h)) svc.apple++;
    else if (/googleapis\.com$/.test(h)) svc.google++;
    else if (/mozilla\.com$/.test(h)) svc.mozilla++;
    else svc.other++;
  }
  const by = (f) => subs.reduce((m, s) => m.set(f(s), (m.get(f(s)) ?? 0) + 1), new Map());
  const langs = by((s) => s.lang);
  const places = new Map();
  for (const s of subs) for (const k of new Set(s.places.map(baseKey))) places.set(k, (places.get(k) ?? 0) + 1);
  const top = [...places].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([k, n]) => `${k.slice(2).replace(/-/g, " ").replace(/(^| )\w/g, (c) => c.toUpperCase())} ${n}`);
  const fresh = subs.filter((s) => now - s.created < 86_400_000).length;
  const custom = subs.filter((s) => JSON.stringify(s.prefs) !== JSON.stringify(parsePrefs(null, s.morning))).length;
  const log = (await d1Query("SELECT COALESCE(SUM(sent),0) AS sent, COALESCE(SUM(gone),0) AS gone, COALESCE(SUM(failed),0) AS failed FROM push_log WHERE ts > ?", [now - 86_400_000]))[0] ?? {};
  const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const text = `Push alerts: ${subs.length} subscriber${subs.length === 1 ? "" : "s"} (${fresh} new in 24 h). Service: apple ${svc.apple}, google ${svc.google}, mozilla ${svc.mozilla}${svc.other ? `, other ${svc.other}` : ""}. Language: ${fmt(langs)}. Top places: ${top.join(", ") || "none"}. Own settings: ${custom}. Messages in 24 h: ${log.sent ?? 0} sent, ${log.gone ?? 0} gone, ${log.failed ?? 0} failed.`;
  console.log(text);
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (dry || !hook) return { text, posted: false };
  const res = await (post ?? fetch)(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) console.warn(`Slack post failed: HTTP ${res.status}`);
  return { text, posted: res.ok };
}

export async function main({ mode = "check", dry = false, test = null, now = Date.now(), send = null, doFetch = fetch, force = false, broadcast = null } = {}) {
  for (const s of PUSH_SCHEMA) await d1Query(s);
  if (broadcast) return runBroadcast({ broadcast, dry, now, send });
  if (!dry && !send) send = await realSender();
  if (!dry && !send) {
    console.warn("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set: nothing sent. See DOCS.md 'Reasons to come back'.");
    return { skipped: true };
  }
  const subs = await subsOf();
  console.log(`${subs.length} subscription(s)`);

  if (test) {
    const sub = test === "latest" ? subs.at(-1) : subs.find((s) => sha(s.endpoint).startsWith(test));
    if (!sub) throw new Error("no matching subscription");
    const m = pushText(sub.lang, "test", []);
    const c = await deliver(send, [{ sub, payload: { title: m.title, body: m.body, url: urlFor(sub, "/"), tag: "test", lang: sub.lang } }], now, dry);
    console.log(`test push to ${sha(sub.endpoint)}: ${JSON.stringify(c)}`);
    return c;
  }
  if (subs.length === 0) return { sent: 0 };

  const keys = [...new Set(subs.flatMap((s) => s.places).map((k) => parseKey(k)?.key).filter(Boolean))];
  const glances = await fetchGlances(keys, doFetch);
  console.log(`${glances.size}/${keys.length} place(s) readable`);

  if (mode === "morning") {
    const jobs = morningJobs(subs, glances, now, force);
    const c = await deliver(send, jobs, now, dry);
    if (!dry) for (const j of jobs) if (!j.sub.gone) await saveState(j.sub, { ...(j.sub.state ?? { pl: {}, hp: {}, rl: {} }), md: colombo(now).day });
    console.log(`morning: ${JSON.stringify(c)}`);
    if (!dry) await logRow(now, "morning", null, c, dry);
    return c;
  }

  // ---- check. First the shared per-place state (kept as before: it seeds a subscriber the first time we judge them)
  const stateRows = await d1Query("SELECT key, level, notified, last_rise_ms, clear_runs FROM push_place_state");
  const states = new Map(stateRows.map((r) => [String(r.key), { level: Number(r.level), notified: Number(r.notified), lastRiseMs: r.last_rise_ms == null ? null : Number(r.last_rise_ms), clearRuns: Number(r.clear_runs) }]));
  const seeds = new Map([...states].map(([k, v]) => [baseKey(k), v]));
  for (const key of keys) {
    const g = glances.get(key);
    if (!g) continue;
    const n = pushStep(states.get(key) ?? null, levelOf(g), now).next;
    if (!dry) {
      await d1Query(
        "INSERT INTO push_place_state (key, level, notified, last_rise_ms, clear_runs, updated_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET level = excluded.level, notified = excluded.notified, last_rise_ms = excluded.last_rise_ms, clear_runs = excluded.clear_runs, updated_ms = excluded.updated_ms",
        [key, n.level, n.notified, n.lastRiseMs, n.clearRuns, now],
      );
    }
  }

  // ---- then, per subscriber, what THEY asked to hear
  const jobs = [];
  const nextStates = new Map();
  for (const sub of subs) {
    const { messages, state } = evalSub({ prefs: sub.prefs, state: sub.state, keys: sub.places.map((k) => parseKey(k)?.key).filter(Boolean), glances, seeds, now });
    nextStates.set(sub, state);
    for (const m of messages) {
      const g = m.g;
      const street = sub.prefs.streetLikely || m.kind === "heads" ? g.street : null;
      const text = m.kind === "release"
        ? pushText(sub.lang, "release", [{ name: g.name, level: 0, street: null }], { reservoir: g.release?.name, confirmed: g.release?.confirmed })
        : pushText(sub.lang, m.kind, [{ name: g.name, level: m.level, street }]);
      jobs.push({ sub, kind: m.kind, place: m.key, payload: { title: text.title, body: text.body, url: urlFor(sub, g.href), tag: m.kind === "rise" || m.kind === "clear" ? m.key : `${m.key}:${m.kind}`, lang: sub.lang } });
    }
  }
  const groups = new Map();
  const c = await deliver(send, jobs, now, dry, groups);

  // morning summaries that came due during this check
  const day = colombo(now).day;
  const mJobs = morningJobs(subs, glances, now, false);
  const mc = await deliver(send, mJobs, now, dry, groups);
  for (const j of mJobs) nextStates.get(j.sub).md = day;

  if (!dry) {
    for (const [sub, st] of nextStates) if (!sub.gone) await saveState(sub, st);
    for (const g of groups.values()) await logRow(now, g.kind, g.place, g, dry);
  }
  for (const g of groups.values()) console.log(`${g.kind} ${g.place ?? ""}: ${JSON.stringify({ sent: g.sent, gone: g.gone, failed: g.failed })}`);
  return { sent: c.sent + mc.sent, gone: c.gone + mc.gone, failed: c.failed + mc.failed };
}

/** One owner message to everyone who has not turned announcements off. A dry run prints counts only. Never runs by itself. */
async function runBroadcast({ broadcast, dry, now, send }) {
  const v = broadcastPayload(broadcast);
  if (!v.ok) throw new Error(`broadcast not sent: ${v.error}`);
  const subs = await subsOf();
  const to = broadcastRecipients(subs, v.language);
  const quiet = to.filter((s) => inQuiet(s.prefs, now)).length;
  const optedOut = subs.filter((s) => !s.prefs.announce).length;
  console.log(`broadcast "${v.payload.title}" -> ${v.payload.url}`);
  console.log(`recipients: ${to.length} of ${subs.length} subscriber(s) (language ${v.language}; ${optedOut} opted out of announcements; ${quiet} are in their own quiet hours right now and will still get it)`);
  if (dry) {
    console.log("dry run: nothing sent");
    return { dry: true, recipients: to.length, total: subs.length };
  }
  if (!send) send = await realSender();
  if (!send) throw new Error("VAPID keys are not set: nothing sent");
  const c = await deliver(send, to.map((sub) => ({ sub, payload: { ...v.payload, lang: v.payload.lang ?? sub.lang } })), now, false);
  await logRow(now, "broadcast", null, c, false);
  console.log(`broadcast: ${JSON.stringify(c)}`);
  return { recipients: to.length, ...c };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  const dry = a.includes("--dry-run");
  const run = a.includes("--stats")
    ? stats({ dry })
    : main({
        mode: val("--mode") ?? "check", dry, test: val("--test"), force: a.includes("--force"),
        broadcast: a.includes("--broadcast") ? { title: process.env.BC_TITLE, body: process.env.BC_BODY, url: process.env.BC_URL, language: process.env.BC_LANGUAGE } : null,
      });
  run.catch((e) => {
    console.error(`push-notify failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
