// Dispatches GitHub Actions workflows on Cloudflare's cron (reliable) instead of
// relying on GitHub's best-effort schedule. Needs a GITHUB_TOKEN secret: a
// fine-grained token with "Actions: Read and write" on this repo only.

const BY_CRON = {
  // every 5 min: the 15-min jobs on :00/:15/:30/:45 (filtered in wanted()), plus x-post as soon as a
  // new gauge reading has arrived (see freshReading), so river alerts reach X within ~5 min.
  "*/5 * * * *": ["releases-snapshot.yml", "curw-snapshot.yml", "x-replies.yml"], // x-replies: answers to people who write to the X account; curw: private CUrW canal-level archive, all day (no night filter)
  "25 * * * *": ["store-forecasts.yml"],
  "7,37 * * * *": ["health-check.yml", "gsmap-snapshot.yml", "x-reposts.yml", "hmis-snapshot.yml"], // JAXA publishes at :01/:31
  "17,47 * * * *": ["rain-correct.yml"], // after the :07/:37 snapshots (gsmap, hmis) have pushed
  "30 7,19 * * *": ["snapshot.yml"],
  "0 1 1 * *": ["export-predictions.yml"],
  "50 18 * * *": ["learn-all.yml"], // nightly observations -> models pipeline, 18:50 UTC = 00:20 Colombo, just after the Sri Lanka day ends
};

// Release snapshots: every 15 min 05:30-23:15 Colombo (00-17 UTC), hourly otherwise.
function wanted(file, when) {
  if ((file === "releases-snapshot.yml" || file === "curw-snapshot.yml") && when.getUTCMinutes() % 15 !== 0) return false;
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

export default {
  async scheduled(event, env) {
    if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN secret is not set");
    const when = new Date(event.scheduledTime);
    const files = (BY_CRON[event.cron] ?? []).filter((f) => wanted(f, when));
    if (event.cron === "*/5 * * * *" && (await freshReading(when))) files.push("x-post.yml");
    const results = await Promise.allSettled(files.map((f) => dispatch(env, f)));
    const failed = results.filter((r) => r.status === "rejected").map((r) => String(r.reason));
    if (failed.length) throw new Error(failed.join("; "));
  },
};
