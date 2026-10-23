-- Colombo canal water levels digitised from CUrW's public charts (pub.curwsl.org), for calibration only.
-- PRIVATE: never read by the website and never published (waiting for CUrW's permission). Written every
-- 15 minutes by .github/workflows/curw-snapshot.yml from scripts/curw-snapshot.mjs, which repeats this file
-- at the top of every run (all statements are idempotent), so there is no manual migration step.
-- Times are epoch milliseconds (UTC); observed_at is the same instant in Colombo time.

-- One row per gauge per 15-minute reading. src 'title' = exact value printed on the chart (the newest
-- point at fetch time); 'curve' = read off the plotted line (about +-0.005 m).
CREATE TABLE IF NOT EXISTS curw_levels (
  station     TEXT    NOT NULL,
  grp         TEXT    NOT NULL,            -- CUrW chart page the gauge was first seen on
  observed_ms INTEGER NOT NULL,
  observed_at TEXT    NOT NULL,            -- ISO, +05:30
  level_m_msl REAL    NOT NULL,
  src         TEXT    NOT NULL,            -- title | curve
  status      TEXT    NOT NULL,            -- ok
  stored_at   INTEGER NOT NULL,
  PRIMARY KEY (station, observed_ms)
);

-- Latest state per gauge: ok, offline (CUrW says "has not responded in 24 hours") or parse_error.
CREATE TABLE IF NOT EXISTS curw_status (
  station          TEXT PRIMARY KEY,
  grp              TEXT NOT NULL,
  status           TEXT NOT NULL,
  observed_ms      INTEGER,
  level_m_msl      REAL,
  since_ms         INTEGER NOT NULL,       -- when this status was first seen by us
  last_observed_ms INTEGER,                -- last time we saw it working
  checked_ms       INTEGER NOT NULL,
  detail           TEXT
);

-- Raw chart PNGs (base64 in 48,000-character chunks, seq 0..n), kept 14 days: once a day, on high water or when
-- parsing was doubtful. Re-assemble: SELECT group_concat(b64, '') FROM (SELECT b64 FROM curw_raw WHERE page = ? AND stamp = ? ORDER BY seq).
CREATE TABLE IF NOT EXISTS curw_raw (
  page      TEXT    NOT NULL,
  stamp     TEXT    NOT NULL,
  seq       INTEGER NOT NULL,
  reason    TEXT,
  b64       TEXT    NOT NULL,
  stored_ms INTEGER NOT NULL,
  PRIMARY KEY (page, stamp, seq)
);
