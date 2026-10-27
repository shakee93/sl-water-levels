// Live gauge inputs for the unlisted /lab/flood-3d test map, from our own caches only (see lib/flood3d.ts).
import { connection } from "next/server";
import { getFlood3dLive } from "@/lib/flood3d";
import { timeBox } from "@/lib/nextHour";

export async function GET() {
  await connection();
  const d = await timeBox(getFlood3dLive(), 6000);
  if (!d) return Response.json({ error: "Source temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return Response.json(d, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300", "X-Robots-Tag": "noindex" } });
}
