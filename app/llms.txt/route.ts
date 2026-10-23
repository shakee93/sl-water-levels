import { getNational } from "@/lib/arcgis";
import { llmsIntro, nationalSummary } from "@/lib/llms";

// Not prerendered: building must not depend on the data sources. The CDN caches it for 10 minutes.
export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getNational().then((n) => nationalSummary(n)).catch(() => "");
  const body = summary ? `${llmsIntro()}\n${summary}\nFull detail for every gauge, reservoir and town: https://sl-water-levels.vercel.app/llms-full.txt\n` : `${llmsIntro()}\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600", "Access-Control-Allow-Origin": "*" },
  });
}
