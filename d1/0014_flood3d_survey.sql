-- Flood survey answers ("pin your spot, how deep did it get", /flood-survey and the map's "Tell us how deep it got"): extra columns on flood3d_reports.
-- Survey rows are ordinary reports (kind past_wet / past_dry, event set, depth mapped onto the old scale so existing readers keep working) with survey = 1.
-- PRIVATE like the rest of the table. The report route adds these idempotently on the first insert that needs them (lib/d1Migrate.ts addColumns); existing rows get NULL / 0.
ALTER TABLE flood3d_reports ADD COLUMN survey INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flood3d_reports ADD COLUMN street_level TEXT;     -- ankle | knee | waist | chest | head : deepest water on the street outside
ALTER TABLE flood3d_reports ADD COLUMN street_ft REAL;        -- the visitor's own number in feet (optional), 0-20
ALTER TABLE flood3d_reports ADD COLUMN inside TEXT;           -- no | yes : did water enter the house (past_wet only)
ALTER TABLE flood3d_reports ADD COLUMN inside_level TEXT;     -- same scale, when inside = yes
ALTER TABLE flood3d_reports ADD COLUMN inside_ft REAL;        -- optional number in feet, 0-15
ALTER TABLE flood3d_reports ADD COLUMN steps_above_road INTEGER;  -- the floor is N steps above the road, 0-30 (optional)
ALTER TABLE flood3d_reports ADD COLUMN peak_day TEXT;         -- YYYY-MM-DD when it was deepest (optional)
ALTER TABLE flood3d_reports ADD COLUMN peak_part TEXT;        -- night | morning | afternoon | evening (optional)
