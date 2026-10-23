// /api/push: alerts for pinned places (Web Push). No account.
//   GET     -> { enabled, key }   enabled only when the site has a VAPID public key AND can save (D1); the page
//                                 shows the "Tell me when it changes" button only then, so nobody meets an error.
//   POST    {subscription, places[], lang, morning}  -> saves / updates this browser's subscription.
//   DELETE  {endpoint}            -> deletes it (the "Turn off alerts" button). Knowing the endpoint is the key.
// Needs, in the Vercel project's environment variables:
//   VAPID_PUBLIC_KEY      the public half of the VAPID pair (not secret; the browser needs it to subscribe)
//   CLOUDFLARE_API_TOKEN  already set (lib/d1.ts)
// The private half, VAPID_PRIVATE_KEY, lives ONLY in the GitHub Actions secrets: the sender (scripts/push-notify.mjs)
// is the only thing that signs messages. See DOCS.md "Reasons to come back".
import { NextResponse, type NextRequest } from "next/server";
import { d1Configured, d1Query, D1NotConfigured } from "@/lib/d1";
import { parseKey } from "@/lib/myPlaces";
import { MAX_SUBSCRIPTIONS, PUSH_SCHEMA, endpointOk, validateSubscription } from "@/lib/pushSub";

export const dynamic = "force-dynamic";

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const publicKey = () => (process.env.VAPID_PUBLIC_KEY || "").trim();
// tests may point the sender at a local mock push service
const anyHost = () => process.env.PUSH_ALLOW_ANY_HOST === "1";

export async function GET() {
  const key = publicKey();
  return reply(200, { enabled: !!key && d1Configured(), key: key || null });
}

async function withSchema<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!/no such table/i.test(String(e instanceof Error ? e.message : e))) throw e;
    for (const s of PUSH_SCHEMA) await d1Query(s);
    return fn();
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  if (raw.length > 4_000) return reply(413, { ok: false, error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: "invalid" });
  }
  const sub = validateSubscription(body, parseKey, anyHost());
  if (!sub) return reply(400, { ok: false, error: "invalid" });
  if (!publicKey() || !d1Configured()) return reply(503, { ok: false, error: "unavailable" });
  const now = Date.now();
  try {
    await withSchema(async () => {
      const known = await d1Query("SELECT 1 AS n FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint]);
      if (known.length === 0) {
        const c = await d1Query("SELECT COUNT(*) AS n FROM push_subscriptions");
        if (Number(c[0]?.n ?? 0) >= MAX_SUBSCRIPTIONS) throw new Error("full");
      }
      await d1Query(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth, places, lang, morning, created_ms, updated_ms, fail_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) " +
          "ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, places = excluded.places, lang = excluded.lang, morning = excluded.morning, updated_ms = excluded.updated_ms, fail_count = 0",
        [sub.endpoint, sub.p256dh, sub.auth, sub.places.join("|"), sub.lang, sub.morning ? 1 : 0, now, now],
      );
    });
  } catch (e) {
    if (!(e instanceof D1NotConfigured)) console.error("push: save failed:", e instanceof Error ? e.message : e);
    return reply(e instanceof D1NotConfigured ? 503 : 502, { ok: false, error: "unavailable" });
  }
  return reply(200, { ok: true });
}

export async function DELETE(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  let endpoint: unknown;
  try {
    endpoint = (JSON.parse(raw) as { endpoint?: unknown }).endpoint;
  } catch {
    return reply(400, { ok: false, error: "invalid" });
  }
  if (!endpointOk(endpoint, anyHost())) return reply(400, { ok: false, error: "invalid" });
  if (!d1Configured()) return reply(200, { ok: true }); // nothing could have been saved
  try {
    await withSchema(() => d1Query("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint as string]));
  } catch (e) {
    console.error("push: delete failed:", e instanceof Error ? e.message : e);
    return reply(502, { ok: false, error: "unavailable" });
  }
  return reply(200, { ok: true });
}
