// POST /api/flood3d/photo?report=<id>&tok=<token>[&et=<EXIF capture time>][&eg=<lat,lon from the photo's EXIF GPS>]   body: image/jpeg
// Attaches one private photo to a report the same browser just made (the token comes back from POST /api/flood3d/report and lasts 30 minutes).
// Photos go to a private R2 bucket through our own Worker (workers/flood-photos), after every metadata segment (EXIF incl. GPS) is stripped here.
// Needs FLOOD_PHOTO_URL and FLOOD_PHOTO_SECRET (Vercel env) and CLOUDFLARE_API_TOKEN for D1; without them it answers 503 and the page says photos are unavailable.
// Never public: no route serves a photo. Limits: 3 per report, 6 per person per day, 3.5 MB each.
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { d1Configured, d1Query, D1NotConfigured } from "@/lib/d1";
import { addColumns } from "@/lib/d1Migrate";
import { exifAgree, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_PERSON_DAY, MAX_PHOTOS_PER_REPORT, PHOTO_TOKEN_MAX_AGE_MS, stripJpeg } from "@/lib/flood3dPhoto";
import { photoToken } from "@/lib/flood3dPhotoToken";

export const dynamic = "force-dynamic";

const PHOTO_COLS = [
  "ALTER TABLE flood3d_reports ADD COLUMN photo_key TEXT",
  "ALTER TABLE flood3d_reports ADD COLUMN photo_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE flood3d_reports ADD COLUMN exif_agree INTEGER",
];
const PHOTO_TABLE = [
  "CREATE TABLE IF NOT EXISTS flood3d_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, created_ms INTEGER NOT NULL, r2_key TEXT NOT NULL, bytes INTEGER NOT NULL, exif_time TEXT, exif_agree INTEGER, person_day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')",
  "CREATE INDEX IF NOT EXISTS idx_f3p_report ON flood3d_photos (report_id)",
  "CREATE INDEX IF NOT EXISTS idx_f3p_person ON flood3d_photos (person_day, created_ms)",
];
let ensured = false;
async function ensure() {
  if (ensured) return;
  for (const s of PHOTO_TABLE) await d1Query(s);
  await addColumns(PHOTO_COLS);
  ensured = true;
}
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const base = process.env.FLOOD_PHOTO_URL, secret = process.env.FLOOD_PHOTO_SECRET;
  if (!base || !secret || !d1Configured()) return reply(503, { ok: false, error: "unavailable" });
  const id = Number(url.searchParams.get("report"));
  const tok = url.searchParams.get("tok") ?? "";
  if (!Number.isInteger(id) || id < 1) return reply(400, { ok: false, error: "invalid" });
  if (!(req.headers.get("content-type") ?? "").startsWith("image/jpeg")) return reply(415, { ok: false, error: "jpeg_only" });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_PHOTO_BYTES) return reply(413, { ok: false, error: "too_large" });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > MAX_PHOTO_BYTES || raw.length < 200) return reply(413, { ok: false, error: "too_large" });
  const clean = stripJpeg(raw);
  if (!clean) return reply(400, { ok: false, error: "not_a_jpeg" });
  try {
    await ensure();
    const rows = await d1Query("SELECT id, created_ms, lat, lon, person_day, status, photo_count FROM flood3d_reports WHERE id = ?", [id]);
    const r = rows[0];
    if (!r) return reply(404, { ok: false, error: "no_report" });
    if (photoToken(String(id), Number(r.created_ms)) !== tok || Date.now() - Number(r.created_ms) > PHOTO_TOKEN_MAX_AGE_MS) return reply(403, { ok: false, error: "forbidden" });
    if (Number(r.photo_count) >= MAX_PHOTOS_PER_REPORT) return reply(429, { ok: false, error: "report_limit" });
    const day = await d1Query("SELECT COUNT(*) AS n FROM flood3d_photos WHERE person_day = ? AND created_ms > ?", [String(r.person_day), Date.now() - 86_400_000]);
    if (Number(day[0]?.n ?? 0) >= MAX_PHOTOS_PER_PERSON_DAY) return reply(429, { ok: false, error: "rate_limited" });
    const key = `reports/${id}/${randomBytes(12).toString("hex")}.jpg`;
    const put = await fetch(`${base}/obj/${key}`, { method: "PUT", headers: { "x-photo-secret": secret, "content-type": "image/jpeg" }, body: clean as unknown as BodyInit, signal: AbortSignal.timeout(15_000) });
    if (!put.ok) { console.error("flood3d photo: store failed", put.status); return reply(502, { ok: false, error: "store_failed" }); }
    const agree = exifAgree({ lat: Number(r.lat), lon: Number(r.lon) }, url.searchParams.get("eg"));
    const et = (url.searchParams.get("et") ?? "").slice(0, 40) || null;
    const status = String(r.status) === "test" ? "test" : "pending";
    await d1Query("INSERT INTO flood3d_photos (report_id, created_ms, r2_key, bytes, exif_time, exif_agree, person_day, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, Date.now(), key, clean.length, et, agree, String(r.person_day), status]);
    await d1Query("UPDATE flood3d_reports SET photo_key = COALESCE(photo_key, ?), photo_count = photo_count + 1, exif_agree = CASE WHEN ? IS NULL THEN exif_agree WHEN exif_agree = 0 THEN 0 ELSE ? END WHERE id = ?", [key, agree, agree, id]);
    return reply(200, { ok: true, count: Number(r.photo_count) + 1 });
  } catch (e) {
    if (!(e instanceof D1NotConfigured)) console.error("flood3d photo: failed:", e instanceof Error ? e.message : e);
    return reply(502, { ok: false, error: "unavailable" });
  }
}
