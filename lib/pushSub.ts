// Web Push subscriptions: what is accepted and stored, and nothing else. Pure (no I/O, no clock) so the route
// (app/api/push/route.ts), the sender (scripts/push-notify.mjs) and scripts/push.test.mts share it.
// Stored per browser: the push endpoint + its two public keys (needed to encrypt a message to it), the place keys the
// visitor pinned, the page language and an opt-in flag for the morning summary. No name, no email, no location,
// no account. Deleting the row (the "Turn off alerts" button, or a dead endpoint) removes everything we hold.
// No imports on purpose (node runs this file directly in tests and in the sender): the place-key parser is passed in.

const MAX_PLACES = 12; // same as lib/myPlaces.ts MAX_PLACES (scripts/push.test.mts checks)
export type KeyParser = (raw: string) => { key: string } | null;

export type PushSubInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Normalised place keys, 1..MAX_PLACES. */
  places: string[];
  lang: "en" | "si" | "ta";
  morning: boolean;
};

/** Hosts of the browsers' push services. The sender POSTs to whatever endpoint is stored, so only these are accepted. */
const HOST_OK = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const B64URL = /^[A-Za-z0-9_-]{16,160}$/;

export function endpointOk(raw: unknown, allowAnyHost = false): raw is string {
  if (typeof raw !== "string" || raw.length > 700) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (allowAnyHost) return u.protocol === "https:" || u.protocol === "http:";
  return u.protocol === "https:" && !u.username && !u.password && HOST_OK.some((re) => re.test(u.hostname));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates a decoded JSON body of POST /api/push. Returns null for anything malformed. */
export function validateSubscription(body: unknown, parseKey: KeyParser, allowAnyHost = false): PushSubInput | null {
  if (!isObj(body)) return null;
  const { subscription, places, lang, morning } = body;
  if (!isObj(subscription) || !isObj(subscription.keys)) return null;
  const endpoint = subscription.endpoint;
  const { p256dh, auth } = subscription.keys as Record<string, unknown>;
  if (!endpointOk(endpoint, allowAnyHost)) return null;
  if (typeof p256dh !== "string" || !B64URL.test(p256dh) || typeof auth !== "string" || !B64URL.test(auth)) return null;
  if (!Array.isArray(places) || places.length === 0 || places.length > MAX_PLACES) return null;
  const keys: string[] = [];
  for (const p of places) {
    const k = typeof p === "string" ? parseKey(p) : null;
    if (!k) return null;
    if (!keys.includes(k.key)) keys.push(k.key);
  }
  return { endpoint, p256dh, auth, places: keys, lang: lang === "si" || lang === "ta" ? lang : "en", morning: morning === true };
}

/** Hard cap on stored subscriptions: a flood of fabricated ones cannot grow the table without bound. */
export const MAX_SUBSCRIPTIONS = 50_000;
/** A subscription whose pushes failed this many times in a row is deleted (the browser unsubscribed or the app was removed). */
export const MAX_FAILS = 3;

export const PUSH_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, places TEXT NOT NULL, lang TEXT NOT NULL, morning INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, last_ok_ms INTEGER, fail_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS push_place_state (key TEXT PRIMARY KEY, level INTEGER NOT NULL, notified INTEGER NOT NULL, last_rise_ms INTEGER, clear_runs INTEGER NOT NULL DEFAULT 0, updated_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS push_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, place TEXT, sent INTEGER NOT NULL, gone INTEGER NOT NULL, failed INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_push_log_ts ON push_log (ts)`,
  `CREATE TABLE IF NOT EXISTS push_prefs (endpoint TEXT PRIMARY KEY, prefs TEXT, state TEXT, updated_ms INTEGER NOT NULL)`,
];
