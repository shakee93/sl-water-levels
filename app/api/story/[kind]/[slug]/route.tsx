// /api/story/<gauge|town|river|home>/<slug>.png[?format=story|square|og][&lang=si][&unit=m]
// The picture people post to their Instagram / WhatsApp / Facebook story, and the link-preview image of the pages (format=og).
// Server-rendered from our own caches; the CDN keeps each picture for 5 minutes, so shares cannot load the server.
import { connection } from "next/server";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { buildStory } from "@/lib/story/model";
import { renderFallback, renderStory } from "@/lib/story/render";
import { isStoryKind, type StoryFormat } from "@/lib/story/url";

export async function GET(req: Request, ctx: { params: Promise<{ kind: string; slug: string }> }) {
  await connection();
  const { kind, slug: file } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const fm = q.get("format");
  const format: StoryFormat = fm === "square" ? "square" : fm === "og" ? "og" : "story";
  const lq = q.get("lang");
  const lang: Locale = isLocale(lq) ? lq : "en";
  const unit = q.get("unit") === "m" ? "m" : "ft";
  const slug = decodeURIComponent(file).replace(/\.png$/i, "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!isStoryKind(kind) || !slug) return new Response("Not found", { status: 404 });
  try {
    const m = await buildStory(kind, slug, lang, unit);
    if (!m) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
    return await renderStory(m, format);
  } catch {
    return renderFallback(format, "Sri Lanka Water Levels");
  }
}
