-- Measured uptime: one row per probe per target, written every 5 minutes by the Cloudflare scheduler worker
-- (workers/scheduler/index.mjs, D1 binding DB). The worker runs this CREATE itself on first use, so no manual migration is needed.
-- target: "site" (/), "embed" (/embed/now), "api" (/api/levels). ts: epoch ms. ok: 1 when HTTP 2xx AND the body passed its sanity check.
-- status: HTTP status (0 = timeout or network error). ms: time to the full body. A missing row means "not measured", never "down".
-- Kept 90 days (the worker prunes once a day). Read by lib/uptime.ts, maths in lib/uptimeCalc.mjs.
CREATE TABLE IF NOT EXISTS uptime_checks (
  ts     INTEGER NOT NULL,
  target TEXT    NOT NULL,
  ok     INTEGER NOT NULL,
  status INTEGER NOT NULL,
  ms     INTEGER NOT NULL,
  PRIMARY KEY (target, ts)
);
CREATE INDEX IF NOT EXISTS idx_uptime_ts ON uptime_checks (ts);
