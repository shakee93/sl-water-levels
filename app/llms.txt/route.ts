import { connection } from "next/server";
import { getNational } from "@/lib/arcgis";
import { llmsIntro, nationalSummary } from "@/lib/llms";
import { getNextHourAll, timeBox } from "@/lib/nextHour";

// Not prerendered: building must not depend on the data sources. The CDN caches it for 10 minutes.
// Per request, not prerendered (a build must not depend on the data sources). Not `dynamic = "force-dynamic"`:
// that also switches off unstable_cache, so every call re-fetched ArcGIS (llms.txt took 3 s on a miss).

export async function GET() {
  await connection();
  // The next-hour line is time-boxed (1.5 s) so a slow forecast never delays the file.
  const [national, nh] = await Promise.all([getNational().catch(() => null), timeBox(getNextHourAll())]);
  const summary = national ? nationalSummary(national, Date.now(), nh) : "";
  const body = summary ? `${llmsIntro()}\n${summary}\nFull detail for every gauge, reservoir and town: https://sl-water-levels.vercel.app/llms-full.txt\n` : `${llmsIntro()}\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600", "Access-Control-Allow-Origin": "*" },
  });
}
