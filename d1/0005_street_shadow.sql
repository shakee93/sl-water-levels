-- SHADOW test of a candidate street-flood rule (started 24 Oct 2026). Nothing users see changes: the live rule
-- (lib/townRisk.ts step 6, d1/0003_street_flood.sql) keeps deciding what the site shows and who is pinged. Every run
-- of scripts/street-rain-log.mjs also computes what the candidate WOULD have said and stores it next to the live state.
-- Candidate: "possible" from 45 mm of clipped 24 h satellite rain when the past week was wet by rain GAUGES (antecedent
-- precipitation index, k 0.9 a day, lag 2 days, at least 96 mm), otherwise possible at 60 mm; likely unchanged (100 mm or
-- the Kelani at minor level). Definition and thresholds: lib/gaugeRain.mjs, lib/streetRainLog.ts shadowStreetState();
-- evidence: research/wellampitiya-flood-rule-backtest.md ("Antecedent wetness and upstream rain", G1 to G5).
-- PRIVATE, like the other street tables.
--
-- Columns added to street_rain_log by scripts/street-rain-log.mjs when PRAGMA table_info does not list them (SQLite has no
-- ADD COLUMN IF NOT EXISTS, so it never runs these blindly):
--   ALTER TABLE street_rain_log ADD COLUMN api_gauge_mm REAL;     -- gauge antecedent index used, mm (NULL = gauges too sparse)
--   ALTER TABLE street_rain_log ADD COLUMN gauge_source TEXT;     -- ogimet | arcgis | NULL: which gauge network api_gauge_mm came from
--   ALTER TABLE street_rain_log ADD COLUMN shadow_state TEXT;     -- candidate's verdict: none | possible | likely | NULL (unknown, never "none")
--   ALTER TABLE street_rain_log ADD COLUMN api_ogimet_mm REAL;    -- the index from Met Dept SYNOP alone (what the backtest used)
--   ALTER TABLE street_rain_log ADD COLUMN api_arcgis_mm REAL;    -- the index from the Irrigation Dept ArcGIS gauges alone
-- shadow_state is NULL when the answer depends on a missing index (clipped rain 45 to 60 mm and no usable gauge week),
-- or when there is no rain total and no river trigger. Rows logged before 24 Oct 2026 have NULL in all five.

-- One row each time the candidate's state changes (none -> possible, ...). No Slack, no push: review only.
CREATE TABLE IF NOT EXISTS street_rain_shadow_changes (
  zone          TEXT    NOT NULL,
  changed_ms    INTEGER NOT NULL,          -- data_end_ms of the run that first showed the new shadow state
  from_state    TEXT,
  to_state      TEXT    NOT NULL,
  live_state    TEXT,                      -- what the live rule said in the same run
  mm24h_clipped REAL,
  api_gauge_mm  REAL,
  gauge_source  TEXT,
  PRIMARY KEY (zone, changed_ms)
);
CREATE INDEX IF NOT EXISTS idx_srsc_zone_time ON street_rain_shadow_changes (zone, changed_ms);
