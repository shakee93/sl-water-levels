// POST /api/flood3d/report  {kind, depth?, event?, lat, lon, acc?, src, mapRight?, cellFt?, lang?, consent: true, hp, ms}
// GET  /api/flood3d/report  public area counts only ("23 reports around Kelaniya"), never a position.
// Reports from the unlisted /lab/flood-3d test map go to Cloudflare D1 (flood3d_reports, d1/0012_flood3d_reports.sql, created here on
// first use). The precise position and GPS accuracy stay private; the live Nagalagam / Hanwella (and 10-minute) levels are stamped
// on the row from the same server cache the page uses. Nothing here touches an official step.
// Needs CLOUDFLARE_API_TOKEN (lib/d1.ts); without it the route answers 503 and the page says "try again later".
import { createHmac } from "node:crypto";
import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { d1Configured, d1Query, D1NotConfigured } from "@/lib/d1";
import { personDay } from "@/lib/personDay";
import { colomboDay } from "@/lib/floodReport";
import { getFlood3dLive } from "@/lib/flood3d";
import { timeBox } from "@/lib/nextHour";
import { AREAS, MAX_PER_PERSON_DAY, MIN_PUBLIC_COUNT, round3, validateReport } from "@/lib/flood3dReports";

export const dynamic = "force-dynamic";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS flood3d_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_ms INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, depth TEXT, event TEXT, lat REAL NOT NULL, lon REAL NOT NULL, lat3 REAL NOT NULL, lon3 REAL NOT NULL, acc_m REAL, src TEXT NOT NULL, map_right TEXT, cell_ft REAL, nag_ft REAL, han_ft REAL, han_fast_ft REAL, person_day TEXT NOT NULL, ip_hash TEXT NOT NULL, lang TEXT, status TEXT NOT NULL DEFAULT 'new')`,
  `CREATE INDEX IF NOT EXISTS idx_f3r_area ON flood3d_reports (lat3, lon3)`,
  `CREATE INDEX IF NOT EXISTS idx_f3r_person ON flood3d_reports (person_day, created_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_f3r_ip ON flood3d_reports (ip_hash, created_ms)`,
];
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const missingTable = (e: unknown) => /no such table/i.test(String(e instanceof Error ? e.message : e));
const ipHash = (ip: string, day: string) => createHmac("sha256", process.env.FLOOD_REPORT_SALT || process.env.CLOUDFLARE_API_TOKEN || "").update(`f3d|${day}|${ip}`).digest("hex").slice(0, 32);

async function areaCount(a: (typeof AREAS)[number]): Promise<number> {
  const rows = await d1Query("SELECT COUNT(*) AS n FROM flood3d_reports WHERE lat3 BETWEEN ? AND ? AND lon3 BETWEEN ? AND ? AND status != 'outlier'", [a.south, a.north, a.west, a.east]);
  return Number(rows[0]?.n ?? 0);
}
/** Public: counts per named area, only when at least MIN_PUBLIC_COUNT. Cached 5 min (a handful of indexed COUNTs). */
const publicCounts = unstable_cache(
  async () => {
    try {
      const n = await Promise.all(AREAS.map(areaCount));
      return AREAS.map((a, i) => ({ name: a.name, n: n[i] >= MIN_PUBLIC_COUNT ? n[i] : null }));
    } catch {
      return AREAS.map((a) => ({ name: a.name, n: null as number | null }));
    }
  },
  ["flood3d-report-counts-v1"],
  { revalidate: 300 },
);

export async function GET() {
  if (!d1Configured()) return reply(200, { areas: [] });
  return NextResponse.json({ areas: await publicCounts() }, { headers: { "Cache-Control": "public, s-maxage=300", "X-Robots-Tag": "noindex" } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  if (raw.length > 2_000) return reply(413, { ok: false, error: "too_large" });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(400, { ok: false, error: "invalid" }); }
  const v = validateReport(body);
  if (!v.ok) return v.reason === "bot" ? reply(200, { ok: true }) : reply(400, { ok: false, error: v.reason });
  if (!d1Configured()) return reply(503, { ok: false, error: "unavailable" });
  const r = v.report;
  const now = Date.now();
  const day = colomboDay(now);
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  const person = personDay(ip, day);
  const hash = ipHash(ip, day);
  const live = await timeBox(getFlood3dLive(), 3000); // levels at this moment, from our cache; the report is stored without them if it is slow
  const insert = async () => {
    const [p, i10] = await Promise.all([
      d1Query("SELECT COUNT(*) AS n FROM flood3d_reports WHERE person_day = ? AND created_ms > ?", [person, now - 86_400_000]),
      d1Query("SELECT COUNT(*) AS n FROM flood3d_reports WHERE ip_hash = ? AND created_ms > ?", [hash, now - 600_000]),
    ]);
    if (Number(p[0]?.n ?? 0) >= MAX_PER_PERSON_DAY || Number(i10[0]?.n ?? 0) >= 5) return false;
    await d1Query(
      "INSERT INTO flood3d_reports (created_ms, day, kind, depth, event, lat, lon, lat3, lon3, acc_m, src, map_right, cell_ft, nag_ft, han_ft, han_fast_ft, person_day, ip_hash, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [now, day, r.kind, r.depth, r.event, r.lat, r.lon, round3(r.lat), round3(r.lon), r.acc, r.src, r.mapRight, r.cellFt, live?.nagalagam?.levelFt ?? null, live?.hanwella?.levelFt ?? null, live?.hanwella?.fastFt ?? null, person, hash, r.lang],
    );
    return true;
  };
  try {
    let stored: boolean;
    try {
      stored = await insert();
    } catch (e) {
      if (!missingTable(e)) throw e;
      for (const s of SCHEMA) await d1Query(s);
      stored = await insert();
    }
    if (!stored) return reply(429, { ok: false, error: "rate_limited" });
  } catch (e) {
    if (!(e instanceof D1NotConfigured)) console.error("flood3d report: D1 write failed:", e instanceof Error ? e.message : e);
    return reply(e instanceof D1NotConfigured ? 503 : 502, { ok: false, error: "unavailable" });
  }
  const areas = await publicCounts();
  const a = AREAS.find((x) => r.lat >= x.south && r.lat <= x.north && r.lon >= x.west && r.lon <= x.east);
  const hit = a ? areas.find((x) => x.name === a.name) : null;
  return reply(200, { ok: true, area: hit?.n != null ? { name: hit.name, n: hit.n } : null });
}
