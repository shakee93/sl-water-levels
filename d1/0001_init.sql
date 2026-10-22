-- Prediction log for Sri Lanka Water Levels (Cloudflare D1, database "sl-water-levels").
-- Written hourly by .github/workflows/store-forecasts.yml so forecasts can be checked
-- against what the river actually did. Times are epoch milliseconds (UTC).

-- One row per station per forecast. issued_at is the timestamp of the latest gauge
-- reading the forecast started from, so re-running on the same reading is a no-op.
CREATE TABLE IF NOT EXISTS forecast_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  station       TEXT    NOT NULL,
  basin         TEXT    NOT NULL,
  issued_at     INTEGER NOT NULL,
  stored_at     INTEGER NOT NULL,
  method        TEXT    NOT NULL,          -- model | trend | none
  status        TEXT    NOT NULL,          -- ok | degraded | unavailable
  model_version TEXT,                      -- coefficients fit id
  unit          TEXT,                      -- m | ft | null
  current_level REAL,
  tier          TEXT,                      -- tier at issue time
  verdict       TEXT,                      -- verdict shown to users
  headline      TEXT,
  rain_past6h_mm  REAL,                    -- upstream area-average rain
  rain_next24h_mm REAL,
  outlook       TEXT,                      -- GloFAS flag: normal | elevated | null
  UNIQUE (station, issued_at)
);
CREATE INDEX IF NOT EXISTS idx_runs_station_time ON forecast_runs (station, issued_at);

-- Predicted level per horizon.
CREATE TABLE IF NOT EXISTS forecast_points (
  run_id    INTEGER NOT NULL REFERENCES forecast_runs(id),
  horizon_h INTEGER NOT NULL,
  target_ts INTEGER NOT NULL,
  level     REAL    NOT NULL,
  low       REAL,
  high      REAL,
  PRIMARY KEY (run_id, horizon_h)
);
CREATE INDEX IF NOT EXISTS idx_points_target ON forecast_points (target_ts);

-- Stated chance of crossing each threshold within 24 h.
CREATE TABLE IF NOT EXISTS forecast_crossings (
  run_id      INTEGER NOT NULL REFERENCES forecast_runs(id),
  threshold   TEXT    NOT NULL,            -- alert | minor | major
  level       REAL,
  probability REAL    NOT NULL,
  eta_ts      INTEGER,
  wording     TEXT,                        -- unlikely | possible | likely
  PRIMARY KEY (run_id, threshold)
);

-- What actually happened: every gauge reading seen by the hourly job.
CREATE TABLE IF NOT EXISTS observations (
  station TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  level   REAL,
  rain    REAL,
  PRIMARY KEY (station, ts)
);

-- Forecast vs actual: the observation closest to each target time (within 40 min).
CREATE VIEW IF NOT EXISTS forecast_verification AS
SELECT r.station, r.basin, r.issued_at, r.method, r.unit, p.horizon_h, p.target_ts,
       p.level AS predicted, p.low, p.high, o.level AS actual,
       o.level - p.level AS error,
       CASE WHEN o.level BETWEEN p.low AND p.high THEN 1 ELSE 0 END AS in_band
FROM forecast_points p
JOIN forecast_runs r ON r.id = p.run_id
JOIN observations o ON o.station = r.station
 AND o.ts = (SELECT o2.ts FROM observations o2
             WHERE o2.station = r.station AND ABS(o2.ts - p.target_ts) <= 2400000
             ORDER BY ABS(o2.ts - p.target_ts) LIMIT 1);
