-- Live validation of the street-flood rain rule (lib/townRisk.ts step 6, research/wellampitiya-flood-rule-backtest.md).
-- Three tables: what the satellite-rain rule said (every run), when its state changed, and what residents
-- reported. Written by scripts/street-rain-log.mjs (after every GSMaP snapshot, .github/workflows/gsmap-snapshot.yml,
-- which repeats this file at the top of every run: all statements are idempotent, so there is no manual migration
-- step) and by app/api/flood-report/route.ts (which creates the reports table itself if it is missing).
-- PRIVATE: never read by the website and never published (the repository and its data branch are public).
-- Times are epoch milliseconds (UTC); "day" is the Asia/Colombo calendar date (YYYY-MM-DD).
-- Monthly review: scripts/export-street-flood.sh, or the SQL in DOCS.md ("Street-flood validation").

-- One row per snapshot run per rain zone (zone 'colombo-east' covers Wellampitiya, Kolonnawa and the other rule towns).
-- state: the rule's verdict (none < 60 mm <= possible < 100 mm <= likely, or likely when river_trigger = 1) from
--        mm24h_clipped, the 24 h sum of hourly rain with each hour capped at 15 mm; NULL = the clipped total was missing
--        and the river was not at minor level. mm24h is the unclipped total (display / analysis only).
-- river_trigger: 1 when the Kelani was at its minor flood level (Nagalagam Street >= 5 ft, or Hanwella at/above its own
--        published minor mark; fresh readings from /api/levels), 0 when not, NULL = gauges unreadable.
-- Columns added after the first release (mm24h_clipped, river_trigger) are in the ALTER statements below; rows logged
-- before then have NULL there and were judged on the old unclipped 60 / 100 mm rule.
CREATE TABLE IF NOT EXISTS street_rain_log (
  zone        TEXT    NOT NULL,
  data_end_ms INTEGER NOT NULL,            -- end of the newest satellite hour this row describes
  run_ms      INTEGER NOT NULL,            -- when the logging run happened
  rate_mm_h   REAL,
  mm1h        REAL,
  mm3h        REAL,
  mm6h        REAL,
  mm24h       REAL,
  state       TEXT,                        -- none | possible | likely | NULL
  mm24h_clipped REAL,                      -- 24 h sum, each hour capped at 15 mm: what the rule compares with 60 / 100
  river_trigger INTEGER,                   -- 1 = Kelani at minor flood level, 0 = no, NULL = unknown
  PRIMARY KEY (zone, data_end_ms)
);

-- One row each time the state changes (none -> possible, possible -> likely, likely -> none ...).
-- notified: 0 = Slack message still to send, 1 = sent, 2 = deliberately skipped (e.g. likely -> possible, or a flap).
CREATE TABLE IF NOT EXISTS street_rain_changes (
  zone         TEXT    NOT NULL,
  changed_ms   INTEGER NOT NULL,           -- data_end_ms of the run that first showed the new state
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  mm1h         REAL,
  mm6h         REAL,
  mm24h        REAL,
  mm24h_clipped REAL,                      -- the rule's number at the change (each hour capped at 15 mm)
  river_trigger INTEGER,                   -- 1 = Kelani at minor flood level at the change
  towns        TEXT    NOT NULL,           -- comma-separated town slugs the rule covers
  notified     INTEGER NOT NULL DEFAULT 0,
  notified_ms  INTEGER,
  PRIMARY KEY (zone, changed_ms)
);

-- "Did the streets near you get water today?" answers. No name, no free text, no location: the town slug,
-- one of three answers, an optional "now / earlier today", the page language, and a salted per-day hash of the IP
-- address (rotates every day, used only to rate-limit; the address itself is never stored).
CREATE TABLE IF NOT EXISTS street_flood_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ms INTEGER NOT NULL,
  day        TEXT    NOT NULL,             -- Asia/Colombo date of the report
  town       TEXT    NOT NULL,             -- places.ts slug
  answer     TEXT    NOT NULL,             -- deep | little | dry
  when_hint  TEXT,                         -- now | earlier | NULL (not given)
  lang       TEXT,                         -- en | si | ta
  ip_hash    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sfr_town_day ON street_flood_reports (town, day);
CREATE INDEX IF NOT EXISTS idx_sfr_ip ON street_flood_reports (ip_hash, created_ms);
CREATE INDEX IF NOT EXISTS idx_src_zone_time ON street_rain_changes (zone, changed_ms);

-- Idempotent migration for databases created before the clipped rule (2026-10-24). A CREATE TABLE IF NOT EXISTS does not
-- add columns to an existing table, and SQLite has no "ADD COLUMN IF NOT EXISTS", so scripts/street-rain-log.mjs adds
-- these two columns itself when PRAGMA table_info does not list them (it never runs these ALTERs blindly):
--   ALTER TABLE street_rain_log ADD COLUMN mm24h_clipped REAL;
--   ALTER TABLE street_rain_log ADD COLUMN river_trigger INTEGER;
-- street_rain_changes gets the same two columns for the same reason.
