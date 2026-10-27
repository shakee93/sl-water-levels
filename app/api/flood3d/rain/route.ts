// Rain now over the corridor for the unlisted /lab/flood-3d test map (lib/flood3dRain.ts): our own caches only, no browser call to JAXA or HMIS.
import { connection } from "next/server";
import { headers } from "next/headers";
import { getFlood3dRain } from "@/lib/flood3dRain";
import { timeBox } from "@/lib/nextHour";

export async function GET() {
  await connection();
  await headers(); // reading request headers makes this route dynamic: otherwise it is prerendered at build and the build-time (empty) answer is served from the CDN forever
  const d = await timeBox(getFlood3dRain(), 8000);
  if (!d) return Response.json({ error: "Rain data temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return Response.json(d, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300", "X-Robots-Tag": "noindex" } });
}
