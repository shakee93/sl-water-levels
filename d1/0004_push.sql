-- Web Push alerts for pinned places ("Tell me when it changes"). Written by app/api/push/route.ts (subscribe,
-- update, unsubscribe; creates the tables itself when missing) and by scripts/push-notify.mjs (the sender, run from
-- .github/workflows/push-notify.yml and gsmap-snapshot.yml, which repeats these statements at the start of every
-- run: all idempotent, so there is no manual migration step). The statements live in lib/pushSub.ts (PUSH_SCHEMA);
-- scripts/push.test.mts fails if this file and that list drift apart.
-- PRIVATE: never read by the website's pages and never published.
-- Personal data held: the browser's push endpoint and its two public keys, the pinned place keys, the page language.
-- No name, email, location or account. Turning alerts off deletes the row.

-- One row per browser that turned alerts on.
CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, places TEXT NOT NULL, lang TEXT NOT NULL, morning INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, last_ok_ms INTEGER, fail_count INTEGER NOT NULL DEFAULT 0);
-- Per place key: the last observed level (0-4), what subscribers were last told, for rise / all-clear / flap rules (lib/myPlaces.ts pushStep).
CREATE TABLE IF NOT EXISTS push_place_state (key TEXT PRIMARY KEY, level INTEGER NOT NULL, notified INTEGER NOT NULL, last_rise_ms INTEGER, clear_runs INTEGER NOT NULL DEFAULT 0, updated_ms INTEGER NOT NULL);
-- Counts only (no endpoints): how many messages of each kind went out, for the monthly review.
CREATE TABLE IF NOT EXISTS push_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, place TEXT, sent INTEGER NOT NULL, gone INTEGER NOT NULL, failed INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_push_log_ts ON push_log (ts);

-- What each browser asked to be alerted about (lib/pushPrefs.ts: places muted, river level, street water, reservoir,
-- all-clear, morning summary + time, quiet hours, announcements) and the sender's per-subscriber memory (what this person
-- was told per place, the day the morning summary last went out). One JSON text each; no row = the defaults, which equal
-- the behaviour before settings existed. Deleted together with the subscription. Choices only; nothing personal.
CREATE TABLE IF NOT EXISTS push_prefs (endpoint TEXT PRIMARY KEY, prefs TEXT, state TEXT, updated_ms INTEGER NOT NULL);
