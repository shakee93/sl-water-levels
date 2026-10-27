// Live gauge inputs for the unlisted /lab/flood-3d test map, from our own caches only (see lib/flood3d.ts).
import { connection } from "next/server";
import { getFlood3dLiveSafe } from "@/lib/flood3d";

export async function GET(req: Request) {
  await connection();
  void req.url; // reading the request keeps this route dynamic: a no-argument handler is prerendered at build and the build-time answer would be served forever
  const d = await getFlood3dLiveSafe(); // stale or partial instead of 503; the client retries a partial one in 20 s
  const ok = !d.partial;
  return Response.json(d, { headers: { "Cache-Control": ok ? "public, s-maxage=120, stale-while-revalidate=300" : "no-store", "X-Robots-Tag": "noindex" } });
}
