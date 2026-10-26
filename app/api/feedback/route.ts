// POST /api/feedback  "Is this right?" on station and town pages. Two steps, one row:
//   {op:"answer", page, station?, town?, answer, tone, lang, hp, ms}  -> stores the answer and what the page showed; returns {token, impact}
//   {op:"details", token, river?, rain?, note?, lat?, lon?, hp}       -> adds what they see, a note and a rounded location, once
// Table forecast_feedback (d1/0008_feedback.sql, created here when missing). What the page showed is read on the server
// (gauge snapshot + next-hour forecast, both cached), never trusted from the browser, except the verdict tier, which is a
// fixed list of words. Location arrives at full precision from the phone, is rounded to 0.01 degree (about 1 km) here and
// only the rounded point is stored. The IP address is never stored: only a salted hash that changes every day (rate limits).
// Same limits as the flood report: one answer per browser per page per day (cookie), per-day IP-hash caps, honeypot, minimum time on page.
// Slack: an immediate ping for "worse than shown" + "water on roads or homes" when SLACK_WEBHOOK_URL is set here; if it is not,
// scripts/feedback-digest.mjs (GitHub Actions) sends it from the rows marked notified = 2.
import { createHmac, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { placeBySlug } from "@/lib/places";
import { d1Configured, d1Query, D1NotConfigured } from "@/lib/d1";
import { fetchStations, getNational } from "@/lib/arcgis";
import { getNextHourForBasin, timeBox } from "@/lib/nextHour";
import { toShown } from "@/lib/units";
import { weeklyImpact } from "@/lib/feedbackStats";
import {
  LIMIT_PER_IP_PER_10_MIN, LIMIT_PER_IP_PER_DAY, LIMIT_PER_IP_PER_TARGET_DAY,
  colomboDay, deviceOf, distKm, fbCookieName, isUrgent, noteTags, validateAnswer, validateDetails,
} from "@/lib/feedback";

export const dynamic = "force-dynamic";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forecast_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, created_ms INTEGER NOT NULL, day TEXT NOT NULL, page TEXT NOT NULL, station TEXT, town TEXT, answer TEXT NOT NULL, river_obs TEXT, rain_obs TEXT, note TEXT, note_tags TEXT, lat_r REAL, lon_r REAL, dist_km REAL, shown_tier TEXT, shown_level REAL, shown_issued_at INTEGER, shown_next_ft REAL, shown_low_ft REAL, shown_high_ft REAL, shown_dir TEXT, shown_method TEXT, shown_rain TEXT, lang TEXT, device TEXT, ip_hash TEXT NOT NULL, details_ms INTEGER, notified INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_ff_target_day ON forecast_feedback (page, station, town, day)`,
  `CREATE INDEX IF NOT EXISTS idx_ff_ip ON forecast_feedback (ip_hash, created_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_ff_token ON forecast_feedback (token)`,
  `CREATE TABLE IF NOT EXISTS feedback_digest (day TEXT PRIMARY KEY, sent_ms INTEGER NOT NULL)`,
];

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function ipHash(ip: string, day: string): string {
  const key = process.env.FLOOD_REPORT_SALT || process.env.CLOUDFLARE_API_TOKEN || "";
  return createHmac("sha256", key).update(`fb|${day}|${ip}`).digest("hex").slice(0, 32);
}
async function count(sql: string, params: (string | number)[]): Promise<number> {
  return Number((await d1Query(sql, params))[0]?.n ?? 0);
}
/** Runs `fn`; when the table does not exist yet, creates it once and runs `fn` again. */
async function withSchema<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!/no such table/i.test(String(e instanceof Error ? e.message : e))) throw e;
    for (const s of SCHEMA) await d1Query(s);
    return fn();
  }
}

async function slack(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  if (raw.length > 4_000) return reply(413, { ok: false, error: "too_large" });
  let body: Record<string, unknown>;
  try {
    const j = JSON.parse(raw);
    if (typeof j !== "object" || j === null || Array.isArray(j)) throw new Error("shape");
    body = j;
  } catch {
    return reply(400, { ok: false, error: "invalid" });
  }
  if (!d1Configured()) return reply(503, { ok: false, error: "unavailable" });
  try {
    return body.op === "details" ? await details(body) : body.op === "answer" ? await answer(req, body) : reply(400, { ok: false, error: "invalid" });
  } catch (e) {
    if (!(e instanceof D1NotConfigured)) console.error("feedback: failed:", e instanceof Error ? e.message : e);
    return reply(e instanceof D1NotConfigured ? 503 : 502, { ok: false, error: "unavailable" });
  }
}

async function answer(req: NextRequest, body: Record<string, unknown>) {
  const stations = await fetchStations().catch(() => []);
  const byName = new Map(stations.map((s) => [s.station, s]));
  const v = validateAnswer(body, (s) => !!placeBySlug(s), (s) => byName.has(s));
  if (!v.ok) return v.reason === "bot" ? reply(200, { ok: true }) : reply(400, { ok: false, error: "invalid" });
  const r = v.value;
  const now = Date.now();
  const day = colomboDay(now);
  const target = r.page === "station" ? (r.station as string) : (r.town as string);
  const cookie = fbCookieName(r.page, target);
  if (req.cookies.get(cookie)?.value === day) return reply(200, { ok: true, already: true });

  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  const hash = ipHash(ip, day);
  const col = r.page === "station" ? "station" : "town";

  // What the page showed, read here: gauge snapshot (level, tier) and the cached next-hour forecast for this gauge.
  let shown: Record<string, string | number | null> = { tier: r.tone, level: null, issued: null, next: null, low: null, high: null, dir: null, method: null, rain: null };
  if (r.station) {
    const nat = (await getNational().catch(() => [])).find((s) => s.station === r.station);
    if (nat) {
      if (nat.latest?.water_level != null) shown.level = Math.round(toShown(nat.latest.water_level, nat.unit) * 100) / 100;
      if (r.page === "station") shown.tier = nat.tier;
      const nh = (await timeBox(getNextHourForBasin(nat.basin)))?.[r.station] ?? null;
      if (nh) shown = { ...shown, issued: Date.parse(nh.issuedAt), next: nh.level_ft, low: nh.low_ft, high: nh.high_ft, dir: nh.direction, method: nh.method, rain: nh.rainRisk?.kind ?? null };
    }
  }

  const token = randomBytes(12).toString("hex");
  const stored = await withSchema(async () => {
    const [n10, nDay, nTarget] = await Promise.all([
      count("SELECT COUNT(*) AS n FROM forecast_feedback WHERE ip_hash = ? AND created_ms > ?", [hash, now - 600_000]),
      count("SELECT COUNT(*) AS n FROM forecast_feedback WHERE ip_hash = ? AND day = ?", [hash, day]),
      count(`SELECT COUNT(*) AS n FROM forecast_feedback WHERE ip_hash = ? AND day = ? AND page = ? AND ${col} = ?`, [hash, day, r.page, target]),
    ]);
    if (n10 >= LIMIT_PER_IP_PER_10_MIN || nDay >= LIMIT_PER_IP_PER_DAY || nTarget >= LIMIT_PER_IP_PER_TARGET_DAY) return false;
    await d1Query(
      `INSERT INTO forecast_feedback (token, created_ms, day, page, station, town, answer, shown_tier, shown_level, shown_issued_at, shown_next_ft, shown_low_ft, shown_high_ft, shown_dir, shown_method, shown_rain, lang, device, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [token, now, day, r.page, r.station, r.town, r.answer, shown.tier, shown.level, shown.issued, shown.next, shown.low, shown.high, shown.dir, shown.method, shown.rain, r.lang, deviceOf(req.headers.get("user-agent")), hash],
    );
    return true;
  });
  if (!stored) return reply(429, { ok: false, error: "rate_limited" });

  const impact = await weeklyImpact(r.page, target, now);
  const res = reply(200, { ok: true, token, impact });
  res.cookies.set(cookie, day, { path: "/", maxAge: 86_400, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}

async function details(body: Record<string, unknown>) {
  const v = validateDetails(body);
  if (!v.ok) return v.reason === "bot" ? reply(200, { ok: true }) : reply(400, { ok: false, error: "invalid" });
  const d = v.value;
  const now = Date.now();
  const rows = await withSchema(() =>
    d1Query("SELECT page, station, town, answer, details_ms, created_ms FROM forecast_feedback WHERE token = ?", [d.token]),
  );
  const row = rows[0];
  // unknown token, already completed, or older than two hours: a quiet "thanks", nothing changes
  if (!row || row.details_ms != null || now - Number(row.created_ms) > 2 * 3_600_000) return reply(200, { ok: true });

  let lat: number | null = null, lon: number | null = null, dist: number | null = null;
  if (d.loc && row.station) {
    const g = (await fetchStations().catch(() => [])).find((s) => s.station === row.station);
    if (g) {
      lat = d.loc.lat; lon = d.loc.lon;
      dist = distKm(d.loc, { lat: g.latitude, lon: g.longitude });
    }
  }
  const tags = noteTags(d.note);
  await d1Query(
    "UPDATE forecast_feedback SET river_obs = ?, rain_obs = ?, note = ?, note_tags = ?, lat_r = ?, lon_r = ?, dist_km = ?, details_ms = ? WHERE token = ? AND details_ms IS NULL",
    [d.river, d.rain, d.note, tags.length ? tags.join(",") : null, lat, lon, dist, now, d.token],
  );
  if (isUrgent(String(row.answer), d.river)) {
    const name = row.page === "town" ? `${row.town}${row.station ? ` (gauge ${row.station})` : ""}` : String(row.station);
    const link = `https://sl-water-levels.vercel.app${row.page === "town" ? `/flood/${row.town}` : "/"}`;
    const text = `*Feedback: our verdict looks too mild.* Someone at ${name} says it is worse than shown and water is on roads or in homes${dist != null ? ` (about ${dist} km from the gauge)` : ""}.${d.note ? ` They wrote: ${d.note}` : ""} ${link}`;
    // 1 = sent now; 2 = ping still to send (no Slack webhook on this host): scripts/feedback-digest.mjs sends it
    await d1Query("UPDATE forecast_feedback SET notified = ? WHERE token = ?", [(await slack(text)) ? 1 : 2, d.token]);
  }
  return reply(200, { ok: true, noteDropped: !!d.noteReason && d.noteReason !== "empty" });
}
