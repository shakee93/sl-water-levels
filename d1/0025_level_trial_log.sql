-- Level-model hidden trial (lvl-lin-d4): one row per live forecast run the nightly runner looked at (scripts/level-trial-run.mjs).
-- A NEW table only (CREATE TABLE IF NOT EXISTS): nothing here changes a live table. The runner creates it on first use.
-- verdict: ok | degraded | refused | skipped. reason: the predictor's code, the rebuild's skip reason, inputs_skip:<why the hourly route logged no record> or no_inputs.
-- flags: the predictor's degraded codes, comma separated (NULL = none). The forecasts themselves are in forecast_shadow_points under the variants
-- lvl-lin-d4 (ok) and lvl-lin-d4-deg (degraded); refused and skipped runs have no points. Kept 120 days (the runner prunes).
CREATE TABLE IF NOT EXISTS forecast_trial_log (
  variant         TEXT    NOT NULL,
  station         TEXT    NOT NULL,
  issued_at       INTEGER NOT NULL,
  verdict         TEXT    NOT NULL,
  reason          TEXT,
  flags           TEXT,
  detail          TEXT,
  n_hist          INTEGER,
  gap_h           REAL,
  lag_h           INTEGER,
  weather_age_min INTEGER,
  runner          TEXT    NOT NULL,
  ran_ms          INTEGER NOT NULL,
  PRIMARY KEY (variant, station, issued_at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_trial_log_issued ON forecast_trial_log (issued_at);
