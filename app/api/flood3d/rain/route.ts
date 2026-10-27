// Rain now over the corridor for the unlisted /lab/flood-3d test map (lib/flood3dRain.ts): our own caches only, no browser call to JAXA or HMIS.
import { connection } from "next/server";
import { getFlood3dRain } from "@/lib/flood3dRain";
import { timeBox } from "@/lib/nextHour";

export async function GET() {
  await connection();
  const d = await timeBox(getFlood3dRain(), 8000);
  if (!d) return Response.json({ error: "Rain data temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return Response.json(d, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300", "X-Robots-Tag": "noindex" } });
}
