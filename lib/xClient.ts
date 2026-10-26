// Posting to X: the on/off gate and the API call. No imports except node:crypto; no clock or network unless handed one,
// so scripts/x-post.test.mts can drive it.
//
// The gate (the one place that decides whether anything leaves for X):
//   X_POSTING=off              -> "off": the kill switch. Nothing is composed, nothing goes to Slack.
//   X_POSTING=live + 4 secrets -> "live": posts go to X.
//   anything else              -> "dry": posts go to the owner's Slack for review, never to X. (live without all four
//                                 keys also lands here, so a half-finished setup cannot post and says why.)
// Auth is OAuth 1.0a user context (HMAC-SHA1), signed here; the JSON body is not part of the signature.
import { createHmac, randomBytes } from "node:crypto";

export type XKeys = { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };
export type Gate = { mode: "off" | "dry" | "live"; keys: XKeys | null; reason: string };

export function gate(env: Record<string, string | undefined>): Gate {
  const want = (env.X_POSTING ?? "").trim().toLowerCase();
  if (want === "off") return { mode: "off", keys: null, reason: "X_POSTING=off (kill switch)" };
  const keys: XKeys = { apiKey: env.X_API_KEY ?? "", apiSecret: env.X_API_SECRET ?? "", accessToken: env.X_ACCESS_TOKEN ?? "", accessSecret: env.X_ACCESS_SECRET ?? "" };
  const have = Object.values(keys).every((v) => v.trim() !== "");
  if (want === "live") {
    if (have) return { mode: "live", keys, reason: "X_POSTING=live and all four keys are set" };
    const missing = (["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"] as const).filter((k) => !(env[k] ?? "").trim());
    return { mode: "dry", keys: null, reason: `X_POSTING=live but ${missing.join(", ")} not set: staying in dry-run` };
  }
  return { mode: "dry", keys: null, reason: want ? `X_POSTING=${want}: dry-run` : "X_POSTING is not set: dry-run" };
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The Authorization header for one request (OAuth 1.0a, HMAC-SHA1). nonce and timestamp are injectable for tests. */
export function oauthHeader(method: string, url: string, keys: XKeys, opts: { nonce?: string; timestamp?: string; query?: Record<string, string> } = {}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...oauth, ...(opts.query ?? {}) };
  const param = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&");
  const base = [method.toUpperCase(), enc(url), enc(param)].join("&");
  const key = `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", ");
}

export type PostResult =
  | { ok: true; id: string }
  | { ok: false; status: number; detail: string; /** epoch ms before which we must not try again, or null */ retryAfterMs: number | null; duplicate: boolean };

export const TWEETS_URL = "https://api.x.com/2/tweets";

/** One POST /2/tweets. Never retries: the caller decides (a 429 or 403 pauses the whole pipeline). */
export async function postTweet(keys: XKeys, text: string, opts: { replyTo?: string; doFetch?: typeof fetch; now?: number } = {}): Promise<PostResult> {
  const doFetch = opts.doFetch ?? fetch;
  const now = opts.now ?? Date.now();
  const body: Record<string, unknown> = { text };
  if (opts.replyTo) body.reply = { in_reply_to_tweet_id: opts.replyTo };
  let res: Response;
  try {
    res = await doFetch(TWEETS_URL, {
      method: "POST",
      headers: { Authorization: oauthHeader("POST", TWEETS_URL, keys), "Content-Type": "application/json", "User-Agent": "sl-water-levels-x-poster" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { ok: false, status: 0, detail: `network: ${e instanceof Error ? e.name : "error"}`, retryAfterMs: now + 15 * 60_000, duplicate: false };
  }
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string; errors?: { message?: string }[] };
  if (res.ok && j.data?.id) return { ok: true, id: String(j.data.id) };
  const detail = [j.title, j.detail, ...(j.errors ?? []).map((e) => e.message)].filter(Boolean).join(": ").slice(0, 300) || `HTTP ${res.status}`;
  let retryAfterMs: number | null = null;
  if (res.status === 429) {
    const reset = Number(res.headers.get("x-rate-limit-reset") ?? res.headers.get("x-user-limit-24hour-reset"));
    retryAfterMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 + 30_000 : now + 60 * 60_000;
  } else if (res.status === 401 || res.status === 403) retryAfterMs = now + 6 * 3_600_000;
  else if (res.status >= 500 || res.status === 0) retryAfterMs = now + 15 * 60_000;
  const duplicate = res.status === 403 && /duplicate/i.test(detail);
  return { ok: false, status: res.status, detail: `HTTP ${res.status} ${detail}`, retryAfterMs: duplicate ? null : retryAfterMs, duplicate };
}
