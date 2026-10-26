-- Automatic replies and reposts for the X account (scripts/x-replies.mjs, scripts/x-reposts.mjs). Both scripts repeat these
-- statements at the start of every run (REPLIES_SCHEMA in lib/xReply.ts, REPOSTS_SCHEMA in lib/xRepost.ts): all idempotent, so
-- there is no manual migration step. scripts/x-replies.test.mts fails if this file and the lists drift apart.
-- PRIVATE: never read by the website. Holds what people wrote to the account (cut to 300 characters, emptied after 30 days).
-- Times are epoch milliseconds (UTC); "day" is the Asia/Colombo calendar date.
-- status: claimed | posted | dry (shown in Slack only) | failed | skipped (a rule said no) | ignored (nothing to answer).
CREATE TABLE IF NOT EXISTS x_replies (mention_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mention', author_id TEXT NOT NULL, author_username TEXT, conversation_id TEXT, text TEXT NOT NULL, intent TEXT NOT NULL, target TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, reply_text TEXT, reply_id TEXT, ai INTEGER NOT NULL DEFAULT 0, error TEXT, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_x_replies_day ON x_replies (day);
CREATE INDEX IF NOT EXISTS idx_x_replies_author ON x_replies (author_id, ts);
-- Reposts decided by the Decisions API. status: dry | posted | declined | skipped | failed.
CREATE TABLE IF NOT EXISTS x_reposts (tweet_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, decision TEXT, reason TEXT, error TEXT, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_x_reposts_day ON x_reposts (day);
