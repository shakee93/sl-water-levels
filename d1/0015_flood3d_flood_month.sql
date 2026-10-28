-- Flood survey: the month of the flood the answer is about ("YYYY-MM", required in the survey from 28 Oct 2026; NULL on older rows).
-- Ads in an area can bring answers about old floods; the export groups and evidence-gates by this month. Added on first use by the report route.
ALTER TABLE flood3d_reports ADD COLUMN flood_month TEXT;
