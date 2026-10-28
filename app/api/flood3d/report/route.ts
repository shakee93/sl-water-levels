// POST /api/flood3d/report  {kind, depth?, event?, survey?: true + streetLevel/streetFt/inside/insideLevel/insideFt/steps/peakDay/peakPart/floodMonth (see lib/flood3dReports.ts), lat, lon, acc?, src, mapRight?, cellFt?, lang?, consent: true, hp, ms}
// GET  /api/flood3d/report  public area counts only ("23 reports around Kelaniya"), never a position.
// Reports from the unlisted /lab/flood-3d test map go to Cloudflare D1 (flood3d_reports, d1/0012_flood3d_reports.sql, created here on
// first use). The precise position and GPS accuracy stay private; the live Nagalagam / Hanwella (and 10-minute) levels are stamped
// on the row from the same server cache the page uses. Nothing here touches an official step.
// Since 28 Oct 2026 survey answers are accepted from anywhere in Sri Lanka (the corridor is only for the flood map's own learning) and each row is stamped
// with its page / target, the district and the nearest river gauge and ground rain gauge (d1/0017, lib/reportContext.ts), read from caches the pages already use.
// Needs CLOUDFLARE_API_TOKEN (lib/d1.ts); without it the route answers 503 and the page says "try again later".
import { createHmac } from "node:crypto";
import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { d1Configured, d1Query, D1NotConfigured } from "@/lib/d1";
import { personDay } from "@/lib/personDay";
import { colomboDay } from "@/lib/floodReport";
import { getFlood3dLiveSafe } from "@/lib/flood3d";
import { getNational } from "@/lib/arcgis";
import { getHmisRain, nearestRain } from "@/lib/hmis";
import { PLACES } from "@/lib/places";
import { districtAt, nearestGauge } from "@/lib/reportContext";
import { timeBox } from "@/lib/nextHour";
import { addColumns, isMissingColumn } from "@/lib/d1Migrate";
import { photoToken } from "@/lib/flood3dPhotoToken";
import { AREAS, MAX_PER_PERSON_DAY, MIN_PUBLIC_COUNT, round3, validateReport } from "@/lib/flood3dReports";

export const dynamic = "force-dynamic";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS flood3d_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_ms INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, depth TEXT, event TEXT, lat REAL NOT NULL, lon REAL NOT NULL, lat3 REAL NOT NULL, lon3 REAL NOT NULL, acc_m REAL, src TEXT NOT NULL, map_right TEXT, cell_ft REAL, nag_ft REAL, han_ft REAL, han_fast_ft REAL, person_day TEXT NOT NULL, ip_hash TEXT NOT NULL, lang TEXT, status TEXT NOT NULL DEFAULT 'new')`,
  `CREATE INDEX IF NOT EXISTS idx_f3r_area ON flood3d_reports (lat3, lon3)`,
  `CREATE INDEX IF NOT EXISTS idx_f3r_person ON flood3d_reports (person_day, created_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_f3r_ip ON flood3d_reports (ip_hash, created_ms)`,
];
// d1/0014_flood3d_survey.sql: survey answers (added on first use, like the photo columns)
const SURVEY_COLS = [
  "ALTER TABLE flood3d_reports ADD COLUMN survey INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE flood3d_reports ADD COLUMN street_level TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN street_ft REAL",
  "ALTER TABLE flood3d_reports ADD COLUMN inside TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN inside_level TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN inside_ft REAL",
  "ALTER TABLE flood3d_reports ADD COLUMN steps_above_road INTEGER",
  "ALTER TABLE flood3d_reports ADD COLUMN peak_day TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN peak_part TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN flood_month TEXT", // d1/0015
];
// d1/0017_report_context.sql: where the answer came from and the context at the pinned point (added on first use, like the survey columns)
const CONTEXT_COLS = [
  "ALTER TABLE flood3d_reports ADD COLUMN page TEXT", "ALTER TABLE flood3d_reports ADD COLUMN target TEXT", "ALTER TABLE flood3d_reports ADD COLUMN district TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN gauge_name TEXT", "ALTER TABLE flood3d_reports ADD COLUMN gauge_km REAL", "ALTER TABLE flood3d_reports ADD COLUMN gauge_level REAL",
  "ALTER TABLE flood3d_reports ADD COLUMN gauge_unit TEXT", "ALTER TABLE flood3d_reports ADD COLUMN gauge_tier TEXT", "ALTER TABLE flood3d_reports ADD COLUMN gauge_ts INTEGER",
  "ALTER TABLE flood3d_reports ADD COLUMN gauge_rate3h REAL", "ALTER TABLE flood3d_reports ADD COLUMN gauge_rain6h REAL", "ALTER TABLE flood3d_reports ADD COLUMN rain_gauge TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN rain_km REAL", "ALTER TABLE flood3d_reports ADD COLUMN rain_mm24 REAL",
  "CREATE INDEX IF NOT EXISTS idx_f3r_district ON flood3d_reports (district)",
];
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const missingTable = (e: unknown) => /no such table/i.test(String(e instanceof Error ? e.message : e));
const ipHash = (ip: string, day: string) => createHmac("sha256", process.env.FLOOD_REPORT_SALT || process.env.CLOUDFLARE_API_TOKEN || "").update(`f3d|${day}|${ip}`).digest("hex").slice(0, 32);

async function areaCount(a: (typeof AREAS)[number]): Promise<number> {
  const rows = await d1Query("SELECT COUNT(*) AS n FROM flood3d_reports WHERE lat3 BETWEEN ? AND ? AND lon3 BETWEEN ? AND ? AND status NOT IN ('outlier', 'test')", [a.south, a.north, a.west, a.east]);
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

/** Public: reports per district (of the nearest gazetteer town), only when at least MIN_PUBLIC_COUNT. One GROUP BY over a small table, cached 5 min; a missing column (nothing stamped yet) gives none. */
const districtCounts = unstable_cache(
  async () => {
    try {
      const rows = await d1Query("SELECT district, COUNT(*) AS n FROM flood3d_reports WHERE district IS NOT NULL AND status NOT IN ('outlier', 'test') GROUP BY district");
      return rows.map((r) => ({ name: String(r.district), n: Number(r.n) })).filter((x) => x.n >= MIN_PUBLIC_COUNT);
    } catch {
      return [] as { name: string; n: number }[];
    }
  },
  ["flood3d-district-counts-v1"],
  { revalidate: 300 },
);

export async function GET(req: NextRequest) {
  void req.url; // keeps the route dynamic: otherwise the build-time (empty) answer is served
  const photosEnabled = !!(process.env.FLOOD_PHOTO_URL && process.env.FLOOD_PHOTO_SECRET);
  if (!d1Configured()) return reply(200, { areas: [], districts: [], photosEnabled });
  return NextResponse.json({ areas: await publicCounts(), districts: await districtCounts(), photosEnabled }, { headers: { "Cache-Control": "public, s-maxage=300", "X-Robots-Tag": "noindex" } });
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
  const sv = r.survey;
  const now = Date.now();
  const day = colomboDay(now);
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  const person = personDay(ip, day);
  const hash = ipHash(ip, day);
  const live = await timeBox(getFlood3dLiveSafe(), 3000); // levels at this moment, from our cache; the report is stored without them if it is slow
  // context at the pinned point, from our own caches (the national snapshot is the 60 s ArcGIS cache the pages use; HMIS rain is its 10 min cache): no extra upstream request, stored without it when slow
  const context = await timeBox(
    Promise.all([getNational(), getHmisRain(1200)]).then(([nat, rain]) => ({ gauge: nearestGauge(nat, r), rain: rain ? nearestRain(rain.devices, r, now) : null })),
    1500,
  );
  const district = districtAt(PLACES, r);
  const gauge = context?.gauge ?? null, rain = context?.rain ?? null;
  const insert = async () => {
    const [p, i10] = await Promise.all([
      d1Query("SELECT COUNT(*) AS n FROM flood3d_reports WHERE person_day = ? AND created_ms > ?", [person, now - 86_400_000]),
      d1Query("SELECT COUNT(*) AS n FROM flood3d_reports WHERE ip_hash = ? AND created_ms > ?", [hash, now - 600_000]),
    ]);
    if (Number(p[0]?.n ?? 0) >= MAX_PER_PERSON_DAY || Number(i10[0]?.n ?? 0) >= 5) return false;
    const cols: [string, unknown][] = [
      ["created_ms", now], ["day", day], ["kind", r.kind], ["depth", r.depth], ["event", r.event], ["lat", r.lat], ["lon", r.lon], ["lat3", round3(r.lat)], ["lon3", round3(r.lon)], ["acc_m", r.acc],
      ["src", r.src], ["map_right", r.mapRight], ["cell_ft", r.cellFt], ["nag_ft", live?.nagalagam?.levelFt ?? null], ["han_ft", live?.hanwella?.levelFt ?? null], ["han_fast_ft", live?.hanwella?.fastFt ?? null],
      ["person_day", person], ["ip_hash", hash], ["lang", r.lang], ["status", r.test ? "test" : "new"], ["survey", sv ? 1 : 0], ["street_level", sv?.streetLevel ?? null], ["street_ft", sv?.streetFt ?? null],
      ["inside", sv?.inside ?? null], ["inside_level", sv?.insideLevel ?? null], ["inside_ft", sv?.insideFt ?? null], ["steps_above_road", sv?.steps ?? null], ["peak_day", sv?.peakDay ?? null],
      ["peak_part", sv?.peakPart ?? null], ["flood_month", sv?.floodMonth ?? null],
      ["page", r.page], ["target", r.target], ["district", district],
      ["gauge_name", gauge?.name ?? null], ["gauge_km", gauge?.km ?? null], ["gauge_level", gauge?.level ?? null], ["gauge_unit", gauge?.unit ?? null], ["gauge_tier", gauge?.tier ?? null],
      ["gauge_ts", gauge?.ts ?? null], ["gauge_rate3h", gauge?.rate3h ?? null], ["gauge_rain6h", gauge?.rain6h ?? null],
      ["rain_gauge", rain?.device.name ?? null], ["rain_km", rain ? Math.round(rain.km * 10) / 10 : null], ["rain_mm24", rain?.device.mm24h ?? null],
    ];
    await d1Query(`INSERT INTO flood3d_reports (${cols.map((c) => c[0]).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => c[1] as never));
    return true;
  };
  try {
    let stored: boolean;
    try {
      stored = await insert();
    } catch (e) {
      if (!missingTable(e) && !isMissingColumn(e)) throw e;
      for (const s of SCHEMA) await d1Query(s);
      await addColumns([...SURVEY_COLS, ...CONTEXT_COLS]);
      stored = await insert();
    }
    if (!stored) return reply(429, { ok: false, error: "rate_limited" });
  } catch (e) {
    if (!(e instanceof D1NotConfigured)) console.error("flood3d report: D1 write failed:", e instanceof Error ? e.message : e);
    return reply(e instanceof D1NotConfigured ? 503 : 502, { ok: false, error: "unavailable" });
  }
  // the id and a 30-minute token let this browser attach photos to this report (see app/api/flood3d/photo/route.ts)
  let photo: { id: number; token: string } | null = null;
  try {
    const row = (await d1Query("SELECT id FROM flood3d_reports WHERE person_day = ? AND created_ms = ? ORDER BY id DESC LIMIT 1", [person, now]))[0];
    if (row) photo = { id: Number(row.id), token: photoToken(String(row.id), now) };
  } catch { /* photos are optional */ }
  const areas = await publicCounts();
  const a = AREAS.find((x) => r.lat >= x.south && r.lat <= x.north && r.lon >= x.west && r.lon <= x.east);
  const hit = a ? areas.find((x) => x.name === a.name) : null;
  // outside the named Kelani areas: the district's count (3 or more), never a position
  const dHit = !hit && district && !r.test ? (await districtCounts()).find((x) => x.name === district) : null;
  return reply(200, { ok: true, area: hit?.n != null ? { name: hit.name, n: hit.n } : dHit ? { name: dHit.name, n: dHit.n } : null, photo, photosEnabled: !!(process.env.FLOOD_PHOTO_URL && process.env.FLOOD_PHOTO_SECRET) });
}
