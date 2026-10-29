// Dispatches GitHub Actions workflows on Cloudflare's cron (reliable) instead of
// relying on GitHub's best-effort schedule. Needs a GITHUB_TOKEN secret: a
// fine-grained token with "Actions: Read and write" on this repo only.

const BY_CRON = {
  // every 5 min: the 15-min jobs on :00/:15/:30/:45 (filtered in wanted()), plus x-post as soon as a
  // new gauge reading has arrived (see freshReading), so river alerts reach X within ~5 min.
  "*/5 * * * *": ["releases-snapshot.yml", "curw-snapshot.yml", "x-replies.yml"], // x-replies: answers to people who write to the X account; curw: private CUrW canal-level archive, all day (no night filter)
  "25 * * * *": ["store-forecasts.yml", "rivernet-snapshot.yml"], // rivernet: 1-minute sensor archive, every 2 h (filtered in wanted()); GitHub's own cron ran it 3 times in 2 days
  "7,37 * * * *": ["health-check.yml", "gsmap-snapshot.yml", "x-reposts.yml", "hmis-snapshot.yml"], // JAXA publishes at :01/:31
  "17,47 * * * *": ["rain-correct.yml"], // after the :07/:37 snapshots (gsmap, hmis) have pushed
  "30 7,19 * * *": ["snapshot.yml"],
  "0 1 1 * *": ["export-predictions.yml"],
  "10 20 * * *": ["forecast-scoreboard.yml"], // nightly forecast archive + scoreboard + KPIs, 20:10 UTC = 01:40 Colombo (GitHub's cron skipped runs)
  "50 18 * * *": ["learn-all.yml"], // nightly observations -> models pipeline, 18:50 UTC = 00:20 Colombo, just after the Sri Lanka day ends
};

// Release snapshots: every 15 min 05:30-23:15 Colombo (00-17 UTC), hourly otherwise.
function wanted(file, when) {
  if ((file === "releases-snapshot.yml" || file === "curw-snapshot.yml") && when.getUTCMinutes() % 15 !== 0) return false;
  if (file === "rivernet-snapshot.yml") return when.getUTCHours() % 2 === 0;
  if (file !== "releases-snapshot.yml") return true;
  const h = when.getUTCHours();
  return h <= 17 || when.getUTCMinutes() === 0;
}

async function dispatch(env, file) {
  const inputs = file === "health-check.yml" ? { slack_test: "false" } : undefined;
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/${file}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "sl-water-levels-scheduler",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(inputs ? { ref: "main", inputs } : { ref: "main" }),
  });
  if (res.status !== 204) throw new Error(`${file}: HTTP ${res.status} ${await res.text()}`);
}

// True when the gauge layer got a reading in the last 5 minutes (one tiny ArcGIS statistics query).
// Readings arrive hourly at scattered minutes per gauge, so this starts the X job right after new data.
async function freshReading(when) {
  const q = new URLSearchParams({
    where: "1=1",
    outStatistics: JSON.stringify([{ statisticType: "max", onStatisticField: "CreationDate", outStatisticFieldName: "m" }]),
    f: "json",
  });
  try {
    const r = await fetch(`https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0/query?${q}`);
    const j = await r.json();
    const m = j?.features?.[0]?.attributes?.m;
    return typeof m === "number" && when.getTime() - m < 5 * 60_000;
  } catch {
    return false;
  }
}

// --- Uptime probe (every 5 min, written to D1 table uptime_checks, see d1/0020_uptime.sql; read by lib/uptime.ts for /status) ---
// WHAT IT MEASURES: what a visitor gets. "/" and "/embed/now" are fetched exactly as a browser would (no cache-busting), so a
// CDN-served page counts as up, which is true for the visitor. /api/levels gets a throwaway query string, because that endpoint is
// the one that runs real code against the upstream sources: it must be answered by the origin to prove the data path works.
// "ok" = HTTP 2xx AND a sane body (page: real HTML of plausible size; API: JSON with a station list). A failure is retried once after
// 3 s and the retry's result is recorded, so a single dropped packet is not an outage. A run where this worker or D1 is down writes
// nothing: a missing row is "not measured", never "down".
const SITE = "https://waterlevels.lk";
const PROBE_UA = "sl-water-levels-uptime-probe (+https://waterlevels.lk/status)";
const PROBES = [
  { target: "site", url: `${SITE}/`, check: (t) => t.length > 20_000 && /<\/html>/i.test(t) },
  { target: "embed", url: `${SITE}/embed/now`, check: (t) => t.length > 2_000 && /<\/html>/i.test(t) },
  {
    target: "api",
    url: (now) => `${SITE}/api/levels?probe=${now}`,
    check: (t) => {
      const j = JSON.parse(t);
      return Array.isArray(j?.stations) && j.stations.length > 0;
    },
  },
];

async function probeOnce(p, now) {
  const t0 = Date.now();
  let status = 0;
  let ok = 0;
  try {
    const res = await fetch(typeof p.url === "function" ? p.url(now) : p.url, {
      headers: { "User-Agent": PROBE_UA, Accept: "*/*" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    status = res.status;
    const body = await res.text();
    ok = res.status >= 200 && res.status < 300 && p.check(body) ? 1 : 0;
  } catch {
    ok = 0; // timeout, network error or unparsable body
  }
  return { target: p.target, ok, status, ms: Date.now() - t0 };
}

async function probeOne(p, now) {
  const first = await probeOnce(p, now);
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, 3_000));
  return probeOnce(p, now);
}

let tableReady = false;
async function ensureUptimeTable(db) {
  if (tableReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS uptime_checks (ts INTEGER NOT NULL, target TEXT NOT NULL, ok INTEGER NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL, PRIMARY KEY (target, ts))"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_uptime_ts ON uptime_checks (ts)"),
  ]);
  tableReady = true;
}

async function probeUptime(env, when) {
  if (!env.DB) return; // binding missing: nothing recorded
  const ts = Math.floor(when.getTime() / 300_000) * 300_000; // the slot, so a re-run overwrites instead of duplicating
  const rows = await Promise.all(PROBES.map((p) => probeOne(p, ts)));
  await ensureUptimeTable(env.DB);
  const stmts = rows.map((r) =>
    env.DB.prepare("INSERT OR REPLACE INTO uptime_checks (ts, target, ok, status, ms) VALUES (?1, ?2, ?3, ?4, ?5)").bind(ts, r.target, r.ok, r.status, r.ms),
  );
  // once a day (01:00-01:04 Colombo) drop rows older than 90 days
  if (when.getUTCHours() === 19 && when.getUTCMinutes() < 5) stmts.push(env.DB.prepare("DELETE FROM uptime_checks WHERE ts < ?1").bind(ts - 90 * 86_400_000));
  await env.DB.batch(stmts);
}

export default {
  async scheduled(event, env) {
    // the probe first and on its own: a missing GitHub token or a failed dispatch must never stop the uptime record
    // (started first, awaited last, so a slow site never delays the workflow dispatches)
    const probe =
      event.cron === "*/5 * * * *"
        ? probeUptime(env, new Date(event.scheduledTime)).catch((e) => console.error("uptime probe failed", String(e)))
        : Promise.resolve();
    if (!env.GITHUB_TOKEN) {
      await probe;
      throw new Error("GITHUB_TOKEN secret is not set");
    }
    const when = new Date(event.scheduledTime);
    const files = (BY_CRON[event.cron] ?? []).filter((f) => wanted(f, when));
    if (event.cron === "*/5 * * * *" && (await freshReading(when))) files.push("x-post.yml");
    const results = await Promise.allSettled(files.map((f) => dispatch(env, f)));
    await probe;
    const failed = results.filter((r) => r.status === "rejected").map((r) => String(r.reason));
    if (failed.length) throw new Error(failed.join("; "));
  },
};
