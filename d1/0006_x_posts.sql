-- The X (Twitter) account (scripts/x-post.mjs, .github/workflows/x-post.yml). The script repeats these statements at the
-- start of every run (X_SCHEMA in scripts/x-post.mjs): all idempotent, so there is no manual migration step.
-- scripts/x-post.test.mts fails if this file and that list drift apart.
-- PRIVATE: never read by the website and never published. Holds only text that was (or would have been) posted publicly.
-- Times are epoch milliseconds (UTC); "day" is the Asia/Colombo calendar date.

-- One row per post: what was said (or, in dry-run, what would have been), when, and how it went.
-- dedupe_key is claimed BEFORE posting, so two runs at once can never post the same thing twice.
-- cost_usd: ESTIMATED API cost of the post (and its replies), for the monthly budget guard (X_MONTHLY_BUDGET_USD).
-- status: claimed (in flight) | posted | dry (shown in Slack only) | failed | held (daily limit)
CREATE TABLE IF NOT EXISTS x_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, reply_text TEXT, tweet_id TEXT, reply_id TEXT, ai INTEGER NOT NULL DEFAULT 0, error TEXT, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_x_posts_day ON x_posts (day);
-- Memory: key 'main' = per gauge / reservoir / street zone / bulletin: the last state and whether we posted about it
-- (rise, all-clear and flap rules, shared with push alerts); key 'meta' = pause-until after an X error.
CREATE TABLE IF NOT EXISTS x_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_ms INTEGER NOT NULL);
