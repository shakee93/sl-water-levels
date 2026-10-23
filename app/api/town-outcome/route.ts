// GET /api/town-outcome?town=<slug>  -> how our street-water warnings did lately, from neighbours' answers.
// Aggregates only, never fewer than 3 answers behind a number (lib/myPlaces.ts K_MIN). See lib/townOutcome.ts.
import { NextResponse, type NextRequest } from "next/server";
import { loadTownOutcome } from "@/lib/townOutcome";
import { placeBySlug } from "@/lib/places";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("town") ?? "";
  if (!placeBySlug(slug)) return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const data = await loadTownOutcome(slug);
  return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" } });
}
