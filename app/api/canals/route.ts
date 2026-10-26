// Colombo canal levels, wrapped by us: the data is CUrW / SLLDC's (pub.curwsl.org), archived by scripts/curw-snapshot.mjs into
// our D1 database every 15 minutes. Browsers call THIS route (never their host); it is cached at the CDN like the other APIs.
// Data (c) CUrW / SLLDC, shown with attribution. Not an official warning. Levels are metres above mean sea level.
import { connection } from "next/server";
import { getCanals } from "@/lib/curw";
import { CURW_CREDIT, CURW_URL } from "@/lib/curwStatus";
import { tideEvents } from "@/lib/tide";

export async function GET(req: Request) {
  await connection();
  const group = new URL(req.url).searchParams.get("group");
  const c = await getCanals(4000);
  const now = Date.now();
  const body = {
    ok: !!c,
    credit: CURW_CREDIT,
    source: CURW_URL,
    licence: "Data (c) CUrW / SLLDC, shown with attribution. Not an official warning. Levels are metres above mean sea level (m MSL), Sri Lanka time.",
    generatedAt: new Date(c?.fetchedAt ?? now).toISOString(),
    sea: c ? { level_m: c.sea.level, trend: c.sea.trend, observedAt: c.sea.observedMs ? new Date(c.sea.observedMs).toISOString() : null } : null,
    gauges: (c?.gauges ?? [])
      .filter((g) => !group || g.group === group)
      .map((g) => ({
        name: g.name,
        group: g.group,
        state: g.state, // offline | learning | normal | rising | higher | lower ("usual" = this gauge's own recent range)
        level_m: g.level,
        observedAt: g.observedMs ? new Date(g.observedMs).toISOString() : null,
        last24h: g.series.map((p) => ({ t: new Date(p.ms).toISOString(), level_m: Number(p.m.toFixed(3)) })),
      })),
    predictedTide: {
      note: "Predicted from harmonics fitted to Nagalagam Street's own readings; times can be off by up to an hour.",
      next48h: tideEvents(now, 48).map((e) => ({ kind: e.kind, at: new Date(e.t).toISOString() })),
    },
  };
  return Response.json(body, { status: c ? 200 : 503, headers: { "Cache-Control": c ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store", "Access-Control-Allow-Origin": "*" } });
}
