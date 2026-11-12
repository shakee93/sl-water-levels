-- Extra archive fields for the warning rule, logged beside the live forecast and never shown to visitors.
-- NEW tables beside forecast_runs / forecast_crossings (no ALTER of a live table); written by scripts/store-forecasts.mjs into the
-- failure-tolerant .shadow.sql file, read by scripts/forecast-archive.mjs, which adds the fields to the archive line when the rows exist.
-- Keyed like the live tables: (gauge, reading the forecast started from[, step]).
--   p_model       the model's UNROUNDED chance of reaching the step over ALL fitted horizons, before capP / 5% rounding / the experimental ceiling
--   p_model_seen  the same over the horizons the page may show (a fast gauge shows 1-6 h only)
--   p_shown       the number the page passes to chanceWords = today's shown chance (r5 of shownChance of the capped chance over the shown horizons)
--   wording_shown the wording the page shows for the step (likely | possible | unlikely | already)
-- A step the gauge is already at or above has p_model = p_model_seen = p_shown = 1 and wording "already".
CREATE TABLE IF NOT EXISTS forecast_crossings_x (
  station       TEXT    NOT NULL,
  issued_at     INTEGER NOT NULL,
  threshold     TEXT    NOT NULL,
  p_model       REAL,
  p_model_seen  REAL,
  p_shown       REAL,
  wording_shown TEXT,
  PRIMARY KEY (station, issued_at, threshold)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_crossings_x_issued ON forecast_crossings_x (issued_at);
--   horizon_limit_h  longest horizon the page may show (fast tributaries 6); NULL = no limit
--   experimental_on  1 when capP's 90% ceiling was active
--   nh_rate_m_h      rate behind the Next hour tile, metres per hour; nh_word its word (rising | falling | steady)
CREATE TABLE IF NOT EXISTS forecast_runs_x (
  station         TEXT    NOT NULL,
  issued_at       INTEGER NOT NULL,
  horizon_limit_h INTEGER,
  experimental_on INTEGER,
  nh_rate_m_h     REAL,
  nh_word         TEXT,
  PRIMARY KEY (station, issued_at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_runs_x_issued ON forecast_runs_x (issued_at);
