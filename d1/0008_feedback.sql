-- "Is this right?" feedback on station and town pages (app/feedback/AccuracyFeedback.tsx, app/api/feedback/route.ts).
-- One row per answer: what the page said at that moment, the answer, optional observations / note / rounded location.
-- PRIVATE: never read by the website except as aggregates of 3 or more answers (lib/feedbackStats.ts, accuracy/latest.json).
-- The route creates the table itself when missing and every statement is idempotent, so there is no manual step.
-- Times are epoch milliseconds (UTC); day is the Asia/Colombo date.
-- Not merged into street_flood_reports on purpose: that table answers "did water reach the street" (ground truth, one
-- town), this one answers "was our verdict right" (a judgement of the forecast, any gauge). Its rows are kept as they are
-- and the learning report (scripts/feedback-digest.mjs, lib/feedbackLearn.mjs) reads both.
CREATE TABLE IF NOT EXISTS forecast_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL,            -- random, lets the same browser add details to its own row once
  created_ms  INTEGER NOT NULL,
  day         TEXT    NOT NULL,
  page        TEXT    NOT NULL,            -- station | town
  station     TEXT,                        -- gauge name (the gauge the page is about, or the town's gauge)
  town        TEXT,                        -- places.ts slug (town pages)
  answer      TEXT    NOT NULL,            -- yes | worse | better | unsure
  river_obs   TEXT,                        -- normal | high | banks | flooding
  rain_obs    TEXT,                        -- none | light | heavy
  note        TEXT,                        -- optional, up to 500 chars, links / phone numbers / emails removed
  note_tags   TEXT,                        -- comma-separated rule tags (water, rain, road_home, place, complaint, praise)
  lat_r       REAL,                        -- rounded to 0.01 degree (about 1 km); NULL when not shared
  lon_r       REAL,
  dist_km     REAL,                        -- from the rounded point to the gauge
  shown_tier  TEXT,                        -- verdict tier on the page (normal | watch | alert | minor | major | stale)
  shown_level REAL,                        -- gauge level in feet at that moment
  shown_issued_at INTEGER,                 -- = forecast_runs.issued_at of the forecast shown: join key with forecast_runs / forecast_verification
  shown_next_ft REAL,                      -- next-hour forecast (feet) and its 80% range
  shown_low_ft  REAL,
  shown_high_ft REAL,
  shown_dir   TEXT,                        -- rising | falling | steady
  shown_method TEXT,                       -- model | trend (forecast_runs.method)
  shown_rain  TEXT,                        -- rainRisk kind: forecast | measured | both | NULL
  lang        TEXT,
  device      TEXT,                        -- mobile | desktop
  ip_hash     TEXT    NOT NULL,            -- salted, rotates daily, rate limits only
  details_ms  INTEGER,
  notified    INTEGER NOT NULL DEFAULT 0   -- urgent Slack ping: 0 = none needed, 1 = sent, 2 = needed and still to send
);
CREATE INDEX IF NOT EXISTS idx_ff_target_day ON forecast_feedback (page, station, town, day);
CREATE INDEX IF NOT EXISTS idx_ff_town_day ON forecast_feedback (town, day);
CREATE INDEX IF NOT EXISTS idx_ff_ip ON forecast_feedback (ip_hash, created_ms);
CREATE INDEX IF NOT EXISTS idx_ff_token ON forecast_feedback (token);
CREATE TABLE IF NOT EXISTS feedback_digest (day TEXT PRIMARY KEY, sent_ms INTEGER NOT NULL);
