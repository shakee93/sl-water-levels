-- Warning-rule candidates (lib/warningCandidates.mjs), logged beside the live forecast and never shown to visitors.
-- Written by scripts/store-forecasts.mjs, which runs these statements first in the .shadow.sql file (CREATE ... IF NOT EXISTS),
-- so the table appears on first use: no manual migration is needed.
-- One row per (gauge, reading the forecast started from, variant, step) and ONLY where the candidate's shown chance differs from the live one;
-- a run with no row for a variant means "same as live". `shown` is the chance (0..1) after lib/forecastRules.shownChance.
-- Scored by lib/forecastKpi.mjs (KPI 1-3 per variant) from the daily archive (scripts/forecast-archive.mjs, `candidates`).
CREATE TABLE IF NOT EXISTS forecast_warning_shadow (
  station   TEXT    NOT NULL,
  issued_at INTEGER NOT NULL,
  variant   TEXT    NOT NULL,
  threshold TEXT    NOT NULL,
  shown     REAL    NOT NULL,
  eta_h     REAL,
  PRIMARY KEY (station, issued_at, variant, threshold)
);
CREATE INDEX IF NOT EXISTS idx_warning_shadow_issued ON forecast_warning_shadow (issued_at);
