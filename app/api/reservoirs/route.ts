// Reservoir storage and spill/release for every reservoir on the site, as JSON.
//   /api/reservoirs                  all reservoirs
//   /api/reservoirs?slug=deduru-oya  one reservoir (slug as in the page URL)
//   /api/reservoirs?status=spilling  only spilling | releasing | holding | nodata
// The sources (Irrigation Department sheet, Mahaweli Authority report) update about once a day:
// every record carries the day of the reading, and a missing figure is null, never zero.
import { connection } from "next/server";
import { getReservoirs } from "@/lib/reservoirData";
import { CORS } from "@/lib/apiData";
import { SITE } from "@/lib/seo";

// Per request, not prerendered (a build must not depend on the data sources). Not `dynamic = "force-dynamic"`:
// that also switches off unstable_cache, so every call re-fetched ArcGIS (llms.txt took 3 s on a miss).

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const data = await getReservoirs().catch(() => null);
  if (!data) return Response.json({ error: "Source temporarily unavailable" }, { status: 503, headers: { ...CORS, "Cache-Control": "no-store" } });
  const slug = q.get("slug");
  const status = q.get("status");
  const items = data.items
    .filter((r) => (!slug || r.slug === slug) && (!status || r.status === status))
    .map((r) => ({
      id: r.slug,
      name: r.name,
      river: r.river,
      district: r.district,
      type: r.kind,
      status: r.status,
      storagePercent: r.storage ? Math.round(r.storage.pct * 10) / 10 : null,
      storageFresh: r.storage?.fresh ?? null,
      flow: r.flow ? { kind: r.flow.kind, cusecs: r.flow.cusecs, source: r.flow.source, day: r.flow.day } : null,
      readingDay: r.latestDay,
      source: r.storage?.source ?? r.flow?.source ?? null,
      url: `${SITE}/reservoirs/${r.slug}`,
    }));
  if (slug && items.length === 0) return Response.json({ error: "Not found" }, { status: 404, headers: CORS });
  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      irrigationSheetDay: data.sheetDate,
      mahaweliReportDay: data.wmsDate,
      count: items.length,
      source: "Department of Irrigation reservoir sheet; Mahaweli Authority daily report; compiled by Sri Lanka Water Levels",
      license: `${SITE}/about#data-sources`,
      notes: [
        "flow.cusecs is cubic feet per second over the spillway or outlets. null means unknown, never zero.",
        "status: spilling (over the spillway), releasing (through gates or outlets), holding, nodata.",
        "Not an official warning service. In an emergency call 117.",
      ],
      reservoirs: items,
    },
    { headers: CORS },
  );
}
