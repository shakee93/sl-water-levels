// Current level, flood marks and status for every river gauge, as JSON (feet).
//   /api/levels                     all gauges
//   /api/levels?river=kelani-ganga  one river, upstream to downstream
//   /api/levels?station=hanwella    one gauge (slug as in the page URL)
//   /api/levels?town=wellampitiya   the gauges the town page is based on
// Every station also carries `nextHour`: the next-hour river forecast (expected level, range, direction),
// null when there is none. It comes from the cached forecast and is time-boxed to 1.5 s, so a slow forecast
// never delays the levels (the response then says `nextHourReady: false`).
// Cached at the edge for a minute; the underlying source refreshes about hourly.
import { connection } from "next/server";
import { getNational } from "@/lib/arcgis";
import { orderStations } from "@/lib/basinOrder";
import { API_META, CORS, levelRecord } from "@/lib/apiData";
import { placeBySlug } from "@/lib/places";
import { getNextHourForBasins, timeBox } from "@/lib/nextHour";
import { basinSlug, stationSlug } from "@/lib/slug";

// Per request, not prerendered (a build must not depend on the data sources). Not `dynamic = "force-dynamic"`:
// that also switches off unstable_cache, so every call re-fetched ArcGIS (llms.txt took 3 s on a miss).

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  await connection();
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
  const nh = await timeBox(getNextHourForBasins(list.map((s) => s.basin)));
  const stations = list.map((s) => ({ ...levelRecord(s, now), nextHour: nh?.[s.station] ?? null }));
  const newest = stations.reduce<string | null>((m, s) => (s.observedAt && (!m || s.observedAt > m) ? s.observedAt : m), null);
  return Response.json(
    {
      generatedAt: new Date(now).toISOString(),
      newestReading: newest,
      count: stations.length,
      nextHourReady: nh != null,
      ...API_META,
      nextHourNote:
        "nextHour is a forecast, not an official warning: level_ft is the expected level in about an hour from issuedAt, low_ft to high_ft the range it is expected to stay in (80%; null for a simple trend estimate), direction is rising / falling / steady, crossing names a flood mark the range reaches (else null) and method is model (upstream gauges and rain) or trend, and rainRisk is set when 50 mm or more of rain is forecast over the hills above the gauge in the next 24 hours (kind forecast; level heavy / very-heavy / possible, mm_24h) or when the gauges themselves measured very heavy rain, 25 mm in 1 hour or 40 mm in 3 hours, at this gauge or one upstream (kind measured, or both; measured: {gauge, upstream, hours, mm}; level and mm_24h are null when only measured), meaning the river may rise faster than the forecast shows. rainRisk.line is the plain sentence. null when the gauge is not reporting or has no forecast.",
      stations,
    },
    { headers: CORS },
  );
}
