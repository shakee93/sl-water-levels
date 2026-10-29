// Data-source health, as JSON. Read by .github/workflows/health-check.yml every 30 minutes
// (?deep=1 bypasses the caches so a stale cache can't hide a dead source) and by /status.
// Always HTTP 200 with the verdict in the body; nothing here is cached.

import { runHealthChecks } from "@/lib/health";
import { getUptime } from "@/lib/uptime";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const [report, uptime] = await Promise.all([runHealthChecks(deep), getUptime()]);
  // `uptime` is measured by the scheduler worker (null until the first checks are stored); it never changes `ok`
  return Response.json({ ...report, uptime }, { headers: { "Cache-Control": "no-store" } });
}
