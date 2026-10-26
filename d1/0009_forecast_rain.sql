-- Rain logged with every forecast run (store-forecasts.yml / scripts/store-forecasts.mjs), so a later miss can be sorted into
-- "rain-driven" or not: what rain the forecast saw, the heavy-rain warning that was showing, whether a storm-horizon step was in
-- use, and the rain the gauge and the satellite had already recorded. All nullable: older rows have none of it, and NULL means
-- "not known", never 0. SQLite has no ADD COLUMN IF NOT EXISTS, so scripts/d1-ensure-forecast-rain.mjs applies this file only when
-- `rain_risk_kind` is missing from forecast_runs (the workflow runs it before the insert).
ALTER TABLE forecast_runs ADD COLUMN rain_next6h_mm REAL;       -- catchment forecast, deterministic, next 6 h
ALTER TABLE forecast_runs ADD COLUMN rain_next6h_p90_mm REAL;   -- heavier ensemble scenario, next 6 h
ALTER TABLE forecast_runs ADD COLUMN rain_next24h_p90_mm REAL;  -- heavier ensemble scenario, next 24 h (rain_next24h_mm is the deterministic one)
ALTER TABLE forecast_runs ADD COLUMN rain_risk_kind TEXT;       -- forecast | measured | both; NULL = no heavy-rain warning showing
ALTER TABLE forecast_runs ADD COLUMN rain_risk_level TEXT;      -- heavy | very-heavy | possible (NULL for measured-only)
ALTER TABLE forecast_runs ADD COLUMN storm_horizons TEXT;       -- comma list of horizons (h) that used the storm rain correction, '' = none
ALTER TABLE forecast_runs ADD COLUMN storm INTEGER;             -- 1 = storm hour (a warning showing or a storm horizon in use), 0 = calm
ALTER TABLE forecast_runs ADD COLUMN measured_mm1h REAL;        -- this gauge's own sensor, to the newest reading (NULL without a sensor)
ALTER TABLE forecast_runs ADD COLUMN measured_mm3h REAL;
ALTER TABLE forecast_runs ADD COLUMN measured_mm24h REAL;
ALTER TABLE forecast_runs ADD COLUMN sat_mm6h REAL;             -- JAXA GSMaP catchment mean, past 6 h
ALTER TABLE forecast_runs ADD COLUMN sat_mm24h REAL;
