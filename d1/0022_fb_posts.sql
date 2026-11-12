-- The Facebook Page (scripts/fb-post.mjs, .github/workflows/fb-post.yml). Applied by the job itself, through lib/d1Sql.mjs
-- (HTTP /query, never wrangler), the first time a dry or live run finds the tables missing. Every statement is idempotent
-- (CREATE ... IF NOT EXISTS), so applying it again changes nothing. While FB_MODE is off nothing here is created or read.
-- scripts/fb-post.test.mts builds its fake database from this file, so the job and the file cannot drift apart.
-- PRIVATE: never read by the website and never published. Holds only text that was (or would have been) posted publicly.
-- Times are epoch milliseconds (UTC); "day" is the Asia/Colombo calendar date.

-- One row per post: what was said (or, in dry-run, what would have been), when, and how it went.
-- dedupe_key is claimed BEFORE anything is sent, and `claim` is the id of the run that inserted the row: a run posts only
-- when the row carries its own id, so two runs at once can never post the same thing. A key is never freed again, not even
-- after a failure: one key, at most one publish request, ever.
-- format: photo | link (how it went or would go to the Page). situation: the mode decision at the time (disaster | weather | calm).
-- status: claimed (in flight) | posted | dry (shown in Slack only) | failed | held (a daily limit)
CREATE TABLE IF NOT EXISTS fb_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, format TEXT NOT NULL, situation TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, status TEXT NOT NULL, caption TEXT NOT NULL, image_url TEXT, link TEXT, claim TEXT, post_id TEXT, photo_id TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS idx_fb_posts_day ON fb_posts (day);
-- Memory: key 'main' = the Page's own copy of the Instagram engine's memory (scripts/ig-engine.mjs: what was told per gauge,
-- the all-clear holds, which day's morning post was made); key 'meta' = pause-until after a Facebook error, once-a-day notes.
CREATE TABLE IF NOT EXISTS fb_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_ms INTEGER NOT NULL);
