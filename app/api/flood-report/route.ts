// POST /api/flood-report  {town, answer, when?, lang?, hp, ms}
// "Did the streets near you get water today?" Stores one anonymous row in Cloudflare D1 (table
// street_flood_reports, d1/0003_street_flood.sql). Nothing public reads it.
//
// Needs, in the Vercel project's environment variables:
//   CLOUDFLARE_API_TOKEN   token with "D1: Edit" (lib/d1.ts). Without it the route answers 503 and the page says
//                          "try again later"; nothing else breaks.
//   FLOOD_REPORT_SALT      optional, any long random string: key for the IP hash (falls back to the token).
// Abuse limits: one answer per browser per town per day (cookie sl_fr_<town>), per-day IP-hash caps, a hidden
// honeypot field and a minimum time on the page (bots get a quiet "thanks" and nothing is stored).
import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { placeBySlug } from "@/lib/places";
import { monthlyAnswers } from "@/lib/townOutcome";
import { d1Configured, d1Query, D1NotConfigured } from "@/lib/d1";
import {
  LIMIT_PER_IP_PER_10_MIN,
  LIMIT_PER_IP_PER_DAY,
  LIMIT_PER_IP_PER_TOWN_DAY,
  colomboDay,
  reportCookieName,
  validateReport,
} from "@/lib/floodReport";

export const dynamic = "force-dynamic";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS street_flood_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_ms INTEGER NOT NULL, day TEXT NOT NULL, town TEXT NOT NULL, answer TEXT NOT NULL, when_hint TEXT, lang TEXT, ip_hash TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sfr_town_day ON street_flood_reports (town, day)`,
  `CREATE INDEX IF NOT EXISTS idx_sfr_ip ON street_flood_reports (ip_hash, created_ms)`,
];

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Per-day hash of the address: rotates daily, so it rate-limits today and links nobody tomorrow. */
function ipHash(ip: string, day: string): string {
  const key = process.env.FLOOD_REPORT_SALT || process.env.CLOUDFLARE_API_TOKEN || "";
  return createHmac("sha256", key).update(`${day}|${ip}`).digest("hex").slice(0, 32);
}

async function count(sql: string, params: (string | number)[]): Promise<number> {
  const rows = await d1Query(sql, params);
  return Number(rows[0]?.n ?? 0);
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  if (raw.length > 2_000) return reply(413, { ok: false, error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: "invalid" });
  }
  const v = validateReport(body, (s) => !!placeBySlug(s));
  if (!v.ok) {
    // bots get the same friendly answer as people and nothing is stored
    return v.reason === "bot" ? reply(200, { ok: true }) : reply(400, { ok: false, error: "invalid" });
  }
  const r = v.report;
  const now = Date.now();
  const day = colomboDay(now);
  const cookie = reportCookieName(r.town);

  // one answer per browser per town per day
  if (req.cookies.get(cookie)?.value === day) return reply(200, { ok: true, already: true });

  if (!d1Configured()) return reply(503, { ok: false, error: "unavailable" });

  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  const hash = ipHash(ip, day);
  try {
    const attempt = async () => {
      const [n10, nDay, nTown] = await Promise.all([
        count("SELECT COUNT(*) AS n FROM street_flood_reports WHERE ip_hash = ? AND created_ms > ?", [hash, now - 600_000]),
        count("SELECT COUNT(*) AS n FROM street_flood_reports WHERE ip_hash = ? AND day = ?", [hash, day]),
        count("SELECT COUNT(*) AS n FROM street_flood_reports WHERE ip_hash = ? AND day = ? AND town = ?", [hash, day, r.town]),
      ]);
      if (n10 >= LIMIT_PER_IP_PER_10_MIN || nDay >= LIMIT_PER_IP_PER_DAY || nTown >= LIMIT_PER_IP_PER_TOWN_DAY) return false;
      await d1Query("INSERT INTO street_flood_reports (created_ms, day, town, answer, when_hint, lang, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        now, day, r.town, r.answer, r.when, r.lang, hash,
      ]);
      return true;
    };
    let stored: boolean;
    try {
      stored = await attempt();
    } catch (e) {
      // first ever report before the migration ran: create the table, once, and retry
      if (!/no such table/i.test(String(e instanceof Error ? e.message : e))) throw e;
      for (const s of SCHEMA) await d1Query(s);
      stored = await attempt();
    }
    if (!stored) return reply(429, { ok: false, error: "rate_limited" });
  } catch (e) {
    if (!(e instanceof D1NotConfigured)) console.error("flood-report: D1 write failed:", e instanceof Error ? e.message : e);
    return reply(e instanceof D1NotConfigured ? 503 : 502, { ok: false, error: "unavailable" });
  }

  // The thank-you shows what the answer joined: this month's answers for the town, only when at least 3 (k-anonymity).
  // The street-rain rule's own threshold is named only for the towns it covers.
  const n = await monthlyAnswers(r.town, now);
  const res = reply(200, { ok: true, impact: { n, tuneMm: placeBySlug(r.town)?.rainZone ? 100 : null } });
  // readable by the page (not httpOnly) so it can show "thank you" on a later visit the same day
  res.cookies.set(cookie, day, { path: "/", maxAge: 86_400, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
