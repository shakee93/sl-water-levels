// GET /api/places-state?keys=t:wellampitiya|s:Hanwella&lv=Nagalagam Street:3.4
// The one-glance answer for each pinned place (lib/placeGlance.ts): the home page's "Your places" card, the offline
// copy in the service worker and the push sender (scripts/push-notify.mjs) all read this. Public data only: the
// keys are place names, nothing about the visitor is stored or logged. `lv` is the visitor's own street level per
// gauge (their localStorage sl_my_levels), used only to answer this request.
import { NextResponse, type NextRequest } from "next/server";
import { loadGlances } from "@/lib/placeGlance";
import { parseKeys } from "@/lib/myPlaces";

export const dynamic = "force-dynamic";

function parseLv(raw: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const part of raw.split("|").slice(0, 12)) {
    const i = part.lastIndexOf(":");
    if (i <= 0) continue;
    const n = Number(part.slice(i + 1));
    const name = part.slice(0, i).trim();
    if (name && name.length <= 60 && Number.isFinite(n) && n > 0 && n < 1000) out[name] = n;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const keys = parseKeys(req.nextUrl.searchParams.get("keys"));
  const lv = parseLv(req.nextUrl.searchParams.get("lv"));
  if (keys.length === 0) return NextResponse.json({ ok: true, places: [], at: Date.now() }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  try {
    const places = await loadGlances(keys, lv);
    return NextResponse.json(
      { ok: true, places, at: Date.now() },
      // the same keys from many phones share one answer for 5 minutes; gauges and rain move slower than that
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return NextResponse.json({ ok: false, places: [], at: Date.now() }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
