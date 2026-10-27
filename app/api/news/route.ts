// GET /api/news?hours=6 : the Flood news board's newest items as small JSON, for the push sender
// (scripts/push-notify.mjs, "Flood news" alert). It reads the same 10-minute cached fetch as the /news page
// (lib/news.ts getNews), so it adds no request to any news site. Headline, outlet, time, tag and the names the
// classifier found; never article text. News is a report by someone else, never an official warning.
import { NextResponse, type NextRequest } from "next/server";
import { getNews } from "@/lib/news";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const hours = Math.min(48, Math.max(1, Number(req.nextUrl.searchParams.get("hours")) || 6));
  try {
    const d = await getNews();
    const now = Date.now();
    const items = d.items
      .filter((i) => now - i.publishedAt <= hours * 3_600_000)
      .map((i) => ({ id: i.id, title: i.title, source: i.source, publishedAt: i.publishedAt, tag: i.tag, sure: i.sure, rivers: i.rivers, towns: i.towns, reservoirs: i.reservoirs }));
    return NextResponse.json({ ok: true, items, fetchedAt: d.fetchedAt }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ ok: false, items: [] }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
