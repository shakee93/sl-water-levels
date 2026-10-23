// Data-source health, as JSON. Read by .github/workflows/health-check.yml every 30 minutes
// (?deep=1 bypasses the caches so a stale cache can't hide a dead source) and by /status.
// Always HTTP 200 with the verdict in the body; nothing here is cached.

import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const report = await runHealthChecks(deep);
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
