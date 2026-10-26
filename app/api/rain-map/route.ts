// The rain map's data (/rain): satellite rain that fell hour by hour (JAXA GSMaP, last 24 h, 0.1 degree), the weather model's
// forecast for the next 24 h (Open-Meteo), river areas and the gauges with their level and measured rain. The page's map is the
// only browser client; nothing in the browser calls JAXA, Open-Meteo or ArcGIS. See lib/rainMap.ts for the encoding.
import { connection } from "next/server";
import { getRainMap } from "@/lib/rainMap";

export const maxDuration = 30;

export async function GET() {
  await connection();
  const d = await getRainMap();
  return Response.json(d, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
}
