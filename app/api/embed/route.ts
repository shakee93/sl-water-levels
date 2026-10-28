// The widgets' own data, as JSON: /api/embed?w=river&id=kalu-ganga&unit=m ... (same settings as the /embed/<widget> address).
// What the embedded widgets re-read every 5 minutes, so the visitor's browser never calls ArcGIS or any other source.
// Cached at the CDN for a minute like /api/levels.
import { connection } from "next/server";
import { buildEmbed } from "@/lib/embedData";
import { isWidget, parseCfg } from "@/lib/embedConfig";

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const w = q.get("w");
  if (!isWidget(w)) return Response.json({ error: "Unknown widget" }, { status: 400 });
  const sp: Record<string, string> = {};
  q.forEach((v, k) => (sp[k] = v));
  try {
    const p = await buildEmbed(w, q.get("id")?.toLowerCase() ?? null, parseCfg(sp));
    if (!p) return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
    return Response.json(p, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch {
    return Response.json({ error: "Source temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
