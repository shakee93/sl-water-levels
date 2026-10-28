-- Flood survey rows from anywhere in Sri Lanka (28 Oct 2026): where the answer came from and the context at the pinned point, for finding patterns.
-- Added on first use by app/api/flood3d/report/route.ts (lib/d1Migrate addColumns); all nullable, so older rows and a slow cache just leave them empty.
ALTER TABLE flood3d_reports ADD COLUMN page TEXT;            -- town | station | survey | lab
ALTER TABLE flood3d_reports ADD COLUMN target TEXT;          -- town slug or gauge name of that page
ALTER TABLE flood3d_reports ADD COLUMN district TEXT;        -- district of the nearest gazetteer town (within 30 km)
ALTER TABLE flood3d_reports ADD COLUMN gauge_name TEXT;      -- nearest river gauge with a reading (within 80 km)
ALTER TABLE flood3d_reports ADD COLUMN gauge_km REAL;
ALTER TABLE flood3d_reports ADD COLUMN gauge_level REAL;     -- its latest level, in gauge_unit (ft | m | NULL = unit unknown)
ALTER TABLE flood3d_reports ADD COLUMN gauge_unit TEXT;
ALTER TABLE flood3d_reports ADD COLUMN gauge_tier TEXT;      -- official step from the level alone: normal | watch | alert | minor | major | none
ALTER TABLE flood3d_reports ADD COLUMN gauge_ts INTEGER;     -- reading time, epoch ms
ALTER TABLE flood3d_reports ADD COLUMN gauge_rate3h REAL;    -- change per hour over 3 h, gauge units
ALTER TABLE flood3d_reports ADD COLUMN gauge_rain6h REAL;    -- mm at that gauge in the 6 h to its reading (NULL = not measured)
ALTER TABLE flood3d_reports ADD COLUMN rain_gauge TEXT;      -- nearest ground rain gauge with a record under 3 h old, within 5 km (HMIS)
ALTER TABLE flood3d_reports ADD COLUMN rain_km REAL;
ALTER TABLE flood3d_reports ADD COLUMN rain_mm24 REAL;       -- its 24 h total
CREATE INDEX IF NOT EXISTS idx_f3r_district ON flood3d_reports (district);
