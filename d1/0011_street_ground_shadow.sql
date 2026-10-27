-- SHADOW test of the ground-gauge street-water rule (started 27 Oct 2026). Nothing users see changes: the satellite rule
-- (lib/townRisk.ts, d1/0003_street_flood.sql) still decides what the site shows and who is pinged. Every run of
-- scripts/street-rain-log.mjs also runs scripts/ground-rain-shadow.mjs, which applies lib/groundRain.ts (live HMIS rain gauges within
-- 5 km, hmis/rain-live.json on the data branch) per rain zone and stores what it WOULD have said next to the live state.
-- PRIVATE, like the other street tables. One small indexed row per zone per HMIS snapshot (about 6 zones x 48 a day).

CREATE TABLE IF NOT EXISTS street_rain_ground_log (
  zone          TEXT    NOT NULL,
  obs_ms        INTEGER NOT NULL,          -- when the HMIS snapshot (hmis/rain-live.json updatedAt) was taken
  run_ms        INTEGER NOT NULL,
  town          TEXT,                      -- the town of the zone that decided the zone's state
  source        TEXT    NOT NULL,          -- ground | corrected | raw | none (lib/groundRain.ts pickRain)
  gauge         TEXT,                      -- nearest ground gauge, "name (institute)"
  km            REAL,
  n_gauges      INTEGER,
  age_min       INTEGER,                   -- age of the nearest gauge's newest record
  mm1h          REAL,                      -- LOWER BOUNDS from a rolling 24 h sum, see lib/groundRain.ts
  mm3h          REAL,
  mm24h         REAL,
  peak1h        REAL,
  partial       INTEGER,                   -- 1 = a short total is unknown
  wet_week      INTEGER,
  river_trigger INTEGER,
  state         TEXT,                      -- ground rule: none | possible | likely | NULL (unknown, never "none"; also NULL for the raw satellite tier)
  why           TEXT,
  live_state    TEXT,                      -- what the live satellite rule said in the same run
  sat_corr24    REAL,
  sat_raw24     REAL,
  PRIMARY KEY (zone, obs_ms)
);
CREATE INDEX IF NOT EXISTS idx_srgl_time ON street_rain_ground_log (obs_ms);

-- One row each time the ground rule's state changes; notified 0 = Slack shadow line pending, 1 = sent, 2 = skipped (flap / late / clear-from-nothing).
CREATE TABLE IF NOT EXISTS street_rain_ground_changes (
  zone        TEXT    NOT NULL,
  changed_ms  INTEGER NOT NULL,
  from_state  TEXT,
  to_state    TEXT    NOT NULL,
  live_state  TEXT,
  town        TEXT,
  source      TEXT,
  gauge       TEXT,
  km          REAL,
  mm1h        REAL,
  mm3h        REAL,
  mm24h       REAL,
  peak1h      REAL,
  why         TEXT,
  notified    INTEGER NOT NULL DEFAULT 0,
  notified_ms INTEGER,
  PRIMARY KEY (zone, changed_ms)
);
CREATE INDEX IF NOT EXISTS idx_srgc_zone_time ON street_rain_ground_changes (zone, changed_ms);
