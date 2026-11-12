-- Hidden level-model trial (lib/levelTrial/), beside the live forecast and never shown to visitors.
-- The rain inputs of each gauge run "as they stood": one row per (gauge, reading the forecast started from), same key as forecast_runs.
-- Written by scripts/store-forecasts.mjs into the failure-tolerant .shadow.sql file (CREATE ... IF NOT EXISTS runs first there, so the table
-- appears on first use; no manual migration and no ALTER of a live table). Read by the nightly trial runner, which rebuilds the model inputs
-- from `blob` plus the stored gauge readings (lib/levelTrial/rebuild.mjs).
--   blob   = base64 record, format `fmt` (lib/levelTrial/record.mjs): NULL when the run could not be logged, then `skip` says why
--   skip   = NULL when logged, else no_points | no_times | bad_now_hour | no_data | encode | too_large (the record could not be built),
--            no_grid (no rain grid / no forecast for the gauge), weather (the weather fetch failed), deadline (route past its time guard), error
--   made_ms = the route's generatedAt (when the run was made); weather_age_min = age of the weather answer then (its own Date header), NULL = unknown
-- The first logged record wins: a later hourly run on the same reading only upgrades a row whose blob is still NULL.
-- Retention: 400 days (deleted by the same store job and, as a backstop, by the nightly trial runner).
CREATE TABLE IF NOT EXISTS forecast_inputs (
  station         TEXT    NOT NULL,
  issued_at       INTEGER NOT NULL,
  fmt             INTEGER NOT NULL,
  grid_ms         INTEGER,
  weather_age_min INTEGER,
  made_ms         INTEGER NOT NULL,
  n_cells         INTEGER,
  blob            TEXT,
  skip            TEXT,
  PRIMARY KEY (station, issued_at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_inputs_issued ON forecast_inputs (issued_at);
