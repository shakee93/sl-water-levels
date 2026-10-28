-- Shadow (candidate) forecasts, logged beside the live ones and never shown to visitors (lib/shadowForecast.ts).
-- Written by scripts/store-forecasts.mjs, which also runs these statements first (CREATE ... IF NOT EXISTS), so the table appears on first use.
-- One row per (gauge, reading the forecast started from, variant, horizon); levels are in the gauge's own unit like forecast_points.
-- Scored by scripts/forecast-scoreboard.mjs next to the live forecast (same station + issued_at in forecast_runs).
CREATE TABLE IF NOT EXISTS forecast_shadow_points (
  station   TEXT    NOT NULL,
  issued_at INTEGER NOT NULL,
  variant   TEXT    NOT NULL,
  horizon_h INTEGER NOT NULL,
  target_ts INTEGER NOT NULL,
  level     REAL    NOT NULL,
  low       REAL,
  high      REAL,
  PRIMARY KEY (station, issued_at, variant, horizon_h)
);
CREATE INDEX IF NOT EXISTS idx_shadow_issued ON forecast_shadow_points (issued_at);
