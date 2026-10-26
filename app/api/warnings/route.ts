// Current official flood bulletins (DMC / Irrigation Department / Met Department) as JSON, newest first.
// Read by the X poster (scripts/x-post.mjs) so an official warning can be passed on once; public data, the same
// list the river pages show (lib/warnings.ts). Only warnings issued in the last 24 hours are returned.
import { connection } from "next/server";
import { getOfficialWarnings } from "@/lib/warnings";
import { CORS } from "@/lib/apiData";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  await connection();
  const r = await getOfficialWarnings().catch(() => null);
  if (!r) return Response.json({ error: "Source temporarily unavailable" }, { status: 503, headers: { ...CORS, "Cache-Control": "no-store" } });
  const warnings = r.warnings
    .filter((w) => w.current)
    .map((w) => ({
      source: w.source,
      url: w.url,
      title: w.title,
      issuedAt: w.issuedAt,
      basins: w.basins,
      severity: w.severity,
      releaseCusecs: w.releaseCusecs ?? null,
    }))
    .sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""));
  return Response.json(
    { generatedAt: new Date().toISOString(), count: warnings.length, reason: r.reason ?? null, notes: ["Not an official warning service: these are the bulletins as published by the agencies. In an emergency call 117."], warnings },
    { headers: { ...CORS, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
