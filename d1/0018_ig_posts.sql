-- The Instagram account (scripts/ig-post.mjs, .github/workflows/ig-post.yml). The script repeats these statements at the
-- start of every run (IG_SCHEMA in scripts/ig-post.mjs): all idempotent, so there is no manual migration step.
-- scripts/ig-post.test.mts fails if this file and that list drift apart.
-- PRIVATE: never read by the website and never published. Holds only text that was (or would have been) posted publicly.
-- Times are epoch milliseconds (UTC); "day" is the Asia/Colombo calendar date.

-- One row per post: what was said (or, in dry-run, what would have been), when, and how it went.
-- dedupe_key is claimed BEFORE posting, so two runs at once can never post the same thing twice.
-- format: story | feed. situation: what the mode decision said at the time (disaster | weather | calm).
-- status: claimed (in flight) | posted | dry (shown in Slack only) | failed | held (a daily limit)
CREATE TABLE IF NOT EXISTS ig_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, format TEXT NOT NULL, situation TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, status TEXT NOT NULL, caption TEXT NOT NULL, image_url TEXT, container_id TEXT, media_id TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS idx_ig_posts_day ON ig_posts (day);
-- Memory: key 'main' = per gauge: what was told and since when it has been below Alert (all-clear hold), the shared event-detection
-- state of scripts/x-engine.mjs, which day's morning post was made; key 'meta' = pause-until after an Instagram error, once-a-day notes.
CREATE TABLE IF NOT EXISTS ig_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_ms INTEGER NOT NULL);
