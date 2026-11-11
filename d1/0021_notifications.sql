-- In-house log of every message the jobs send to Slack (lib/notify.mjs), and the triage state that turns recurring
-- ones into one tracked GitHub issue each (scripts/ops-triage.mjs). lib/notify.mjs creates these on first use as well
-- (CREATE ... IF NOT EXISTS), so applying this file is optional; it is here for the record. See DOCS.md "Notification log".
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,          -- epoch ms
  source TEXT NOT NULL,         -- x-post, x-replies, health-alert, workflow:<name>, ...
  kind TEXT NOT NULL,           -- post-failed, paused, data-source-down, workflow-failed, held, budget, digest, dry-run ...
  severity TEXT NOT NULL,       -- info | warn | error | critical
  text TEXT NOT NULL,           -- as sent to Slack, secrets scrubbed, at most 4,000 characters
  fingerprint TEXT NOT NULL,    -- identifies the PROBLEM, stable across repeats (lib/notify.mjs fingerprint())
  run_url TEXT,                 -- GitHub Actions run, when running there
  slack_ok INTEGER,             -- 1 delivered, 0 failed, NULL not attempted
  meta TEXT                     -- small JSON, optional
);
CREATE INDEX IF NOT EXISTS idx_notifications_ts ON notifications (ts);
CREATE INDEX IF NOT EXISTS idx_notifications_fp_ts ON notifications (fingerprint, ts);

CREATE TABLE IF NOT EXISTS ops_issues (
  fingerprint TEXT PRIMARY KEY,
  title TEXT, source TEXT, kind TEXT, severity TEXT,
  first_ts INTEGER, last_ts INTEGER, count INTEGER,
  status TEXT,                  -- open | resolved | ignored
  github_issue INTEGER, opened_ts INTEGER, resolved_ts INTEGER, note TEXT
);
