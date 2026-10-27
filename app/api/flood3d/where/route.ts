// Approximate visitor city from Vercel's own request headers, for the flood test map's "Locate me" fallback when the device gives no position.
// Per visitor, so never cached; not stored or logged; no third-party IP service. Mobile IPs in Sri Lanka often resolve to Colombo.
import { connection } from "next/server";
import { headers } from "next/headers";

export async function GET() {
  await connection();
  const h = await headers();
  const dec = (s: string | null) => { try { return s ? decodeURIComponent(s) : null; } catch { return s; } };
  const lat = Number(h.get("x-vercel-ip-latitude")), lon = Number(h.get("x-vercel-ip-longitude"));
  const city = dec(h.get("x-vercel-ip-city"));
  const body = city && Number.isFinite(lat) && Number.isFinite(lon) && h.get("x-vercel-ip-latitude") ? { city, lat, lon } : { city: null };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
