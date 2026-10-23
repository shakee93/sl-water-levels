// Dispatches GitHub Actions workflows on Cloudflare's cron (reliable) instead of
// relying on GitHub's best-effort schedule. Needs a GITHUB_TOKEN secret: a
// fine-grained token with "Actions: Read and write" on this repo only.

const BY_CRON = {
  "*/15 * * * *": ["releases-snapshot.yml"],
  "25 * * * *": ["store-forecasts.yml"],
  "7,37 * * * *": ["health-check.yml"],
  "30 7,19 * * *": ["snapshot.yml"],
  "0 1 1 * *": ["export-predictions.yml"],
};

// Release snapshots: every 15 min 05:30-23:15 Colombo (00-17 UTC), hourly otherwise.
function wanted(file, when) {
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

export default {
  async scheduled(event, env) {
    if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN secret is not set");
    const when = new Date(event.scheduledTime);
    const files = (BY_CRON[event.cron] ?? []).filter((f) => wanted(f, when));
    const results = await Promise.allSettled(files.map((f) => dispatch(env, f)));
    const failed = results.filter((r) => r.status === "rejected").map((r) => String(r.reason));
    if (failed.length) throw new Error(failed.join("; "));
  },
};
