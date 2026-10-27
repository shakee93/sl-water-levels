-- Learning from feedback, two additions (applied by the routes themselves when a column is missing: lib/d1Migrate.ts; this file is the record).
-- person_day: one salted code per person per Colombo day, the SAME in forecast_feedback and street_flood_reports (lib/personDay.ts),
--   so the learning job counts someone who answers both forms once. Rotates daily, never exported or shown. Old rows stay NULL.
-- water_at: the "Where is the water now?" follow-up after "No, it's worse": road | yard | inside | none. NULL when not asked or skipped.
ALTER TABLE forecast_feedback ADD COLUMN person_day TEXT;
ALTER TABLE forecast_feedback ADD COLUMN water_at TEXT;
ALTER TABLE street_flood_reports ADD COLUMN person_day TEXT;
