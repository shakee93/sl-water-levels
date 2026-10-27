-- Optional photos on 3D flood test map reports (R2 bucket sl-flood-photos, private; Worker workers/flood-photos). PRIVATE like the reports.
-- The route creates these idempotently on first use. Names photo_key / photo_count / exif_agree are read by scripts/learn-all.mjs.
ALTER TABLE flood3d_reports ADD COLUMN photo_key TEXT;                       -- R2 key of the first photo, null when none
ALTER TABLE flood3d_reports ADD COLUMN photo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flood3d_reports ADD COLUMN exif_agree INTEGER;                   -- 1 = the photo's EXIF GPS is within 200 m of the pin, 0 = disagrees, NULL = no EXIF GPS
CREATE TABLE IF NOT EXISTS flood3d_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER NOT NULL,
  created_ms  INTEGER NOT NULL,
  r2_key      TEXT    NOT NULL,
  bytes       INTEGER NOT NULL,
  exif_time   TEXT,                        -- original capture time from the photo's EXIF, as sent by the browser (a hint, not proof)
  exif_agree  INTEGER,                     -- as above, for this photo
  person_day  TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending'   -- pending | ok | rejected | test; never shown publicly in the MVP
);
CREATE INDEX IF NOT EXISTS idx_f3p_report ON flood3d_photos (report_id);
CREATE INDEX IF NOT EXISTS idx_f3p_person ON flood3d_photos (person_day, created_ms);
