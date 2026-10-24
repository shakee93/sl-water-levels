// /api/push/prefs: what one browser wants to be alerted about (lib/pushPrefs.ts). No account: knowing the browser's
// push endpoint is the key, exactly like turning alerts off (DELETE /api/push).
//   POST {endpoint}            -> { ok, prefs, places }   the saved choices, or the defaults when none were saved
//   POST {endpoint, prefs}     -> { ok, prefs }   saves them (sanitised: anything unknown or malformed falls back to the default)
// Editable at any time without subscribing again. Choices only are stored; see d1/0004_push.sql (push_prefs).
import { NextResponse, type NextRequest } from "next/server";
import { d1Configured, d1Query, D1NotConfigured } from "@/lib/d1";
import { PUSH_SCHEMA, endpointOk } from "@/lib/pushSub";
import { baseKey, parsePrefs } from "@/lib/pushPrefs";

export const dynamic = "force-dynamic";

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const anyHost = () => process.env.PUSH_ALLOW_ANY_HOST === "1";

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
  if (raw.length > 3_000) return reply(413, { ok: false, error: "too_large" });
  let body: { endpoint?: unknown; prefs?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: "invalid" });
  }
  if (!body || typeof body !== "object" || !endpointOk(body.endpoint, anyHost())) return reply(400, { ok: false, error: "invalid" });
  if (!d1Configured()) return reply(503, { ok: false, error: "unavailable" });
  const endpoint = body.endpoint;
  try {
    const out = await withSchema(async () => {
      const sub = await d1Query("SELECT morning, places FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
      if (sub.length === 0) return null;
      const legacyMorning = Number(sub[0].morning) === 1;
      // the places this browser is alerted for (the settings sheet lists them so each can be switched off)
      const places = [...new Set(String(sub[0].places).split("|").filter(Boolean).map(baseKey))];
      if (body.prefs === undefined) {
        const row = await d1Query("SELECT prefs FROM push_prefs WHERE endpoint = ?", [endpoint]);
        let stored: unknown = null;
        try {
          stored = row[0]?.prefs ? JSON.parse(String(row[0].prefs)) : null;
        } catch {
          stored = null;
        }
        return { prefs: parsePrefs(stored, legacyMorning), places };
      }
      const prefs = parsePrefs(body.prefs);
      await d1Query(
        "INSERT INTO push_prefs (endpoint, prefs, updated_ms) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET prefs = excluded.prefs, updated_ms = excluded.updated_ms",
        [endpoint, JSON.stringify(prefs), Date.now()],
      );
      await d1Query("UPDATE push_subscriptions SET morning = ? WHERE endpoint = ?", [prefs.morning ? 1 : 0, endpoint]);
      return { prefs, places };
    });
    if (!out) return reply(404, { ok: false, error: "not_subscribed" });
    return reply(200, { ok: true, prefs: out.prefs, places: out.places });
  } catch (e) {
    if (!(e instanceof D1NotConfigured)) console.error("push prefs failed:", e instanceof Error ? e.message : e);
    return reply(e instanceof D1NotConfigured ? 503 : 502, { ok: false, error: "unavailable" });
  }
}
