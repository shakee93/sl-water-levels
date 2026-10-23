import { connection } from "next/server";
import { getNational } from "@/lib/arcgis";
import { getReservoirs } from "@/lib/reservoirData";
import { fullListing, llmsIntro } from "@/lib/llms";

// Per request, not prerendered (a build must not depend on the data sources). Not `dynamic = "force-dynamic"`:
// that also switches off unstable_cache, so every call re-fetched ArcGIS (llms.txt took 3 s on a miss).

export async function GET() {
  await connection();
  const [national, rsv] = await Promise.all([getNational().catch(() => null), getReservoirs().catch(() => null)]);
  const body = national ? fullListing(national, rsv) : `${llmsIntro()}\nLive detail is temporarily unavailable; see https://sl-water-levels.vercel.app/api/levels.\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600", "Access-Control-Allow-Origin": "*" },
  });
}
