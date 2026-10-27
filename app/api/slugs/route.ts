// The slugs that exist, read by proxy.ts so an unknown address gets a real HTTP 404.
// Why not decide inside the pages: the river, gauge, town and reservoir pages stream (loading.tsx sends the
// shell, status 200, before the page has looked anything up), so a notFound() thrown later can only change
// the body, never the status code. Google then sees a "soft 404". Here the lists come from the same cached
// sources the pages use (fetchStations 60 s, reservoir sheet, history archive), so this adds no new upstream calls.
import { fetchStations } from "@/lib/arcgis";
import { getHistory } from "@/lib/history";
import { getReservoirs } from "@/lib/reservoirData";
import { basinSlug, stationSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";

export type SlugList = {
  rivers: string[];
  /** "river/gauge" */
  gauges: string[];
  reservoirs: string[];
  historyRivers: string[];
  /** "river/gauge" */
  historyGauges: string[];
};

export async function GET() {
  // Each source fails soft to an empty list; proxy.ts treats an empty list as "unknown, let the page decide".
  const [stations, rsv, history] = await Promise.all([
    fetchStations().catch(() => []),
    getReservoirs().catch(() => null),
    getHistory().catch(() => null),
  ]);
  const body: SlugList = {
    rivers: [...new Set(stations.map((s) => basinSlug(s.basin)))],
    gauges: stations.map((s) => `${basinSlug(s.basin)}/${stationSlug(s.station)}`),
    reservoirs: (rsv?.items ?? []).map((r) => r.slug),
    historyRivers: [...new Set((history?.stations ?? []).map((s) => basinSlug(s.basin)))],
    historyGauges: (history?.stations ?? []).map((s) => `${basinSlug(s.basin)}/${stationSlug(s.station)}`),
  };
  const complete = body.rivers.length > 0 && body.reservoirs.length > 0 && body.historyRivers.length > 0;
  return Response.json(body, {
    // never cache a partial list (a source was down)
    headers: { "Cache-Control": complete ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store" },
  });
}
