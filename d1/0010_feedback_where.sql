-- "Where are you?" after "No, it's worse" (applied by the feedback route itself on the first "no such column": lib/d1Migrate.ts; this file is the record).
-- lat_r / lon_r / dist_km already exist (0008): the point, rounded to 0.01 degree (about 1 km), and its distance to the gauge the page showed.
-- place_pick:  town slug (lib/places.ts) when the location came from the town picker instead of the phone; NULL for a phone position.
-- rain_3h_mm / rain_24h_mm: satellite rain (JAXA GSMaP, 0.1 degree pixel) over the 3 / 24 h before the answer, read from the same grid the rain map uses.
-- PRIVATE like the rest of the table: exported only to the owner (scripts/feedback-export.mjs), never to the public repo or the data branch.
ALTER TABLE forecast_feedback ADD COLUMN place_pick TEXT;
ALTER TABLE forecast_feedback ADD COLUMN rain_3h_mm REAL;
ALTER TABLE forecast_feedback ADD COLUMN rain_24h_mm REAL;
