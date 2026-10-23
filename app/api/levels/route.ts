// Current level, flood marks and status for every river gauge, as JSON (feet).
//   /api/levels                     all gauges
//   /api/levels?river=kelani-ganga  one river, upstream to downstream
//   /api/levels?station=hanwella    one gauge (slug as in the page URL)
//   /api/levels?town=wellampitiya   the gauges the town page is based on
// Cached at the edge for a minute; the underlying source refreshes about hourly.
import { getNational } from "@/lib/arcgis";
import { orderStations } from "@/lib/basinOrder";
import { API_META, CORS, levelRecord } from "@/lib/apiData";
import { placeBySlug } from "@/lib/places";
import { basinSlug, stationSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  let all;
  try {
    all = await getNational();
  } catch {
    return Response.json({ error: "Source temporarily unavailable" }, { status: 503, headers: { ...CORS, "Cache-Control": "no-store" } });
  }
  const now = Date.now();
  let list = all;
  const river = q.get("river")?.toLowerCase();
  const station = q.get("station")?.toLowerCase();
  const town = q.get("town")?.toLowerCase();
  if (river) {
    const hit = all.filter((s) => basinSlug(s.basin) === river);
    list = hit.length ? orderStations(hit[0].basin, hit) : [];
  }
  if (station) list = list.filter((s) => stationSlug(s.station) === station);
  if (town) {
    const place = placeBySlug(town);
    list = place ? place.stations.map((n) => all.find((s) => s.station === n)).filter((s): s is (typeof all)[number] => !!s) : [];
  }
  if ((river || station || town) && list.length === 0) {
    return Response.json({ error: "Not found", hint: "Use slugs as in the page URLs, e.g. river=kelani-ganga, station=hanwella" }, { status: 404, headers: CORS });
  }
  const stations = list.map((s) => levelRecord(s, now));
  const newest = stations.reduce<string | null>((m, s) => (s.observedAt && (!m || s.observedAt > m) ? s.observedAt : m), null);
  return Response.json(
    { generatedAt: new Date(now).toISOString(), newestReading: newest, count: stations.length, ...API_META, stations },
    { headers: CORS },
  );
}
