-- Reports from the unlisted 3D flood test map (/lab/flood-3d): "water here now", "flooded here last time", "stayed dry", "is the map right here".
-- PRIVATE: precise lat/lon never leave the server or the owner's exports; the public sees only area counts of at least 3
-- (app/api/flood3d/report GET). The route creates this table on first use (idempotent), exactly as written here.
-- One small indexed row per report; at most ~10 a day per person (person_day, lib/personDay.ts).
CREATE TABLE IF NOT EXISTS flood3d_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ms    INTEGER NOT NULL,
  day           TEXT    NOT NULL,            -- Colombo day
  kind          TEXT    NOT NULL,            -- water_now | past_wet | past_dry | map_check
  depth         TEXT,                        -- ankle | knee | waist | above_waist | house
  event         TEXT,                        -- ditwah_2025 | may_2016 | jun_2024 | other (past_* only)
  lat           REAL    NOT NULL,            -- precise (private)
  lon           REAL    NOT NULL,
  lat3          REAL    NOT NULL,            -- rounded to 0.001 degree (about 100 m): what area counts use
  lon3          REAL    NOT NULL,
  acc_m         REAL,                        -- GPS accuracy, metres (null for a dragged pin)
  src           TEXT    NOT NULL,            -- gps | pin
  map_right     TEXT,                        -- yes | no | unsure | null (asked only where the map shaded the spot)
  cell_ft       REAL,                        -- the map's flood-level estimate for the spot when the report was made (ft at Nagalagam)
  nag_ft        REAL,                        -- live levels at that moment, from the same server cache as the page
  han_ft        REAL,
  han_fast_ft   REAL,                        -- Hanwella 10-minute sensor (HMIS), when newer than the hourly reading
  person_day    TEXT    NOT NULL,
  ip_hash       TEXT    NOT NULL,
  lang          TEXT,
  status        TEXT    NOT NULL DEFAULT 'new'   -- new | used | outlier (set by scripts/flood3d/prep.py's checks, owner-side)
);
CREATE INDEX IF NOT EXISTS idx_f3r_area ON flood3d_reports (lat3, lon3);
CREATE INDEX IF NOT EXISTS idx_f3r_person ON flood3d_reports (person_day, created_ms);
CREATE INDEX IF NOT EXISTS idx_f3r_ip ON flood3d_reports (ip_hash, created_ms);
