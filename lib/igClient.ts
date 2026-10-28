// Posting to Instagram through the Instagram Graph API with Facebook Login (graph.facebook.com): the on/off gate, the two-step
// publish (create a media container, wait until it is FINISHED, media_publish) and the error classes. No imports; no clock or
// network unless handed one, so scripts/ig-post.test.mts drives it with a fake fetch and nothing ever reaches graph.facebook.com.
//
// The gate (the one place that decides whether anything leaves for Instagram):
//   IG_MODE=off                         -> "off": the kill switch. Nothing is composed, nothing goes to Slack.
//   IG_MODE=live + IG_ACCESS_TOKEN + IG_USER_ID -> "live": posts go to Instagram.
//   anything else (the default)         -> "dry": posts go to the owner's Slack for review, never to Instagram. A missing secret
//                                          always lands here, whatever IG_MODE says, and the reason says which one is missing.
//
// Publishing rules (developers.facebook.com/docs/instagram-platform/content-publishing): images must be JPEG at a public URL the
// Instagram servers can fetch; a story is a container with media_type=STORIES (no caption is shown on a story); a feed picture is a
// container with a caption; about 50 API-published posts per account per 24 h. The token goes in an Authorization header, never in a URL.

/** Graph API version. Override with IG_GRAPH_VERSION when Meta retires this one (versions live about two years). */
export const IG_GRAPH_VERSION = "v24.0";
export const GRAPH = "https://graph.facebook.com";
/** Instagram's own limit is about 50 API posts per 24 h; we stop a little earlier. */
export const IG_LIMIT_24H = 45;
export const MAX_JPEG_BYTES = 8_000_000;

export type IgKeys = { token: string; userId: string };
export type Gate = { mode: "off" | "dry" | "live"; keys: IgKeys | null; reason: string; missing: string[] };

export function gate(env: Record<string, string | undefined>): Gate {
  const want = (env.IG_MODE ?? "").trim().toLowerCase();
  if (want === "off") return { mode: "off", keys: null, reason: "IG_MODE=off (kill switch)", missing: [] };
  const token = (env.IG_ACCESS_TOKEN ?? "").trim();
  const userId = (env.IG_USER_ID ?? "").trim();
  const missing = (["IG_ACCESS_TOKEN", "IG_USER_ID"] as const).filter((k) => !(env[k] ?? "").trim());
  if (missing.length) {
    return { mode: "dry", keys: null, missing, reason: want === "live" ? `IG_MODE=live but ${missing.join(" and ")} not set: staying in dry-run` : `${missing.join(" and ")} not set: dry-run only` };
  }
  if (want === "live") return { mode: "live", keys: { token, userId }, missing: [], reason: "IG_MODE=live and both secrets are set" };
  return { mode: "dry", keys: null, missing: [], reason: want ? `IG_MODE=${want}: dry-run` : "IG_MODE is not set: dry-run (set IG_MODE=live to post)" };
}

const version = (env: Record<string, string | undefined>) => (env.IG_GRAPH_VERSION ?? "").trim() || IG_GRAPH_VERSION;

export type GraphError = { ok: false; status: number; code: number | null; subcode: number | null; detail: string; /** epoch ms before which nothing more is posted, or null */ pauseUntilMs: number | null; auth: boolean };
export type GraphOk<T> = { ok: true; data: T };

/** Turns a Graph error body into what the poster needs: a readable detail (never the token) and how long to stop. */
export function classifyError(status: number, body: unknown, now: number): GraphError {
  const e = ((body as { error?: { message?: string; type?: string; code?: number; error_subcode?: number } } | null)?.error ?? {}) as { message?: string; type?: string; code?: number; error_subcode?: number };
  const code = typeof e.code === "number" ? e.code : null;
  const subcode = typeof e.error_subcode === "number" ? e.error_subcode : null;
  const detail = [e.type, code != null ? `code ${code}${subcode != null ? `/${subcode}` : ""}` : null, e.message].filter(Boolean).join(": ").replace(/EAA[A-Za-z0-9]{20,}/g, "[token]").slice(0, 300) || `HTTP ${status}`;
  const auth = code === 190 || code === 102 || status === 401;
  // 4, 17, 32, 613 and 9 = rate limits; 368 = temporarily blocked; 190 = token expired or revoked; 200-299 = missing permission
  const rate = code != null && [4, 9, 17, 32, 613, 368].includes(code);
  const perm = code != null && code >= 200 && code < 300;
  let pause: number | null = null;
  if (auth || perm) pause = now + 6 * 3_600_000;
  else if (rate) pause = now + 3_600_000;
  else if (status >= 500 || status === 0) pause = now + 15 * 60_000;
  return { ok: false, status, code, subcode, detail, pauseUntilMs: pause, auth };
}

async function call<T>(keys: IgKeys, method: "GET" | "POST", path: string, params: Record<string, string>, o: { doFetch?: typeof fetch; now?: number; env?: Record<string, string | undefined> } = {}): Promise<GraphOk<T> | GraphError> {
  const doFetch = o.doFetch ?? fetch;
  const now = o.now ?? Date.now();
  const url = `${GRAPH}/${version(o.env ?? {})}/${path}${method === "GET" && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method,
      headers: { Authorization: `Bearer ${keys.token}`, "User-Agent": "sl-water-levels-ig-poster", ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: method === "POST" ? new URLSearchParams(params) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, status: 0, code: null, subcode: null, detail: `network: ${e instanceof Error ? e.name : "error"}`, pauseUntilMs: now + 15 * 60_000, auth: false };
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j as { error?: unknown }).error) return classifyError(res.status, j, now);
  return { ok: true, data: j as T };
}

export type PublishResult = { ok: true; mediaId: string; containerId: string } | (GraphError & { containerId: string | null; stage: "container" | "wait" | "publish" });

/**
 * One post: create the container, wait for it, publish it. Never retries: the caller skips and tells Slack.
 * `format` story -> media_type=STORIES (no caption); feed -> a caption. The picture must be a JPEG at a public URL.
 * Waiting is bounded: `waits` polls `waitMs` apart (defaults 8 x 4 s); a container that is not FINISHED by then is abandoned (it expires by itself).
 */
export async function publishImage(
  keys: IgKeys,
  p: { imageUrl: string; format: "story" | "feed"; caption?: string },
  o: { doFetch?: typeof fetch; now?: number; env?: Record<string, string | undefined>; waits?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PublishResult> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const params: Record<string, string> = { image_url: p.imageUrl };
  if (p.format === "story") params.media_type = "STORIES";
  else params.caption = p.caption ?? "";
  const made = await call<{ id?: string }>(keys, "POST", `${keys.userId}/media`, params, o);
  if (!made.ok) return { ...made, containerId: null, stage: "container" };
  const containerId = String(made.data.id ?? "");
  if (!containerId) return { ok: false, status: 200, code: null, subcode: null, detail: "container created but no id returned", pauseUntilMs: null, auth: false, containerId: null, stage: "container" };
  const waits = o.waits ?? 8;
  let finished = false;
  let last = "";
  for (let i = 0; i < waits; i++) {
    const s = await call<{ status_code?: string; status?: string }>(keys, "GET", containerId, { fields: "status_code,status" }, o);
    if (!s.ok) return { ...s, containerId, stage: "wait" };
    last = String(s.data.status_code ?? "");
    if (last === "FINISHED") { finished = true; break; }
    if (last === "ERROR" || last === "EXPIRED") return { ok: false, status: 200, code: null, subcode: null, detail: `container ${last}${s.data.status ? `: ${String(s.data.status).slice(0, 200)}` : ""}`, pauseUntilMs: null, auth: false, containerId, stage: "wait" };
    if (i < waits - 1) await sleep(o.waitMs ?? 4000);
  }
  if (!finished) return { ok: false, status: 200, code: null, subcode: null, detail: `container not ready after ${waits} checks (last status ${last || "unknown"})`, pauseUntilMs: null, auth: false, containerId, stage: "wait" };
  const pub = await call<{ id?: string }>(keys, "POST", `${keys.userId}/media_publish`, { creation_id: containerId }, o);
  if (!pub.ok) return { ...pub, containerId, stage: "publish" };
  return { ok: true, mediaId: String(pub.data.id ?? ""), containerId };
}

/** Posts made through the API in the last 24 h as Instagram counts them (quota_usage of content_publishing_limit); null when it cannot be read. */
export async function publishingUsage(keys: IgKeys, o: { doFetch?: typeof fetch; now?: number; env?: Record<string, string | undefined> } = {}): Promise<number | null> {
  const r = await call<{ data?: { quota_usage?: number }[] }>(keys, "GET", `${keys.userId}/content_publishing_limit`, { fields: "quota_usage" }, o);
  const n = r.ok ? r.data.data?.[0]?.quota_usage : null;
  return typeof n === "number" ? n : null;
}

/** Downloads a picture from our own site and checks it is a real JPEG Instagram will take. { ok, bytes } or { ok: false, why }. */
export async function fetchJpeg(url: string, doFetch: typeof fetch = fetch): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; why: string }> {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "sl-water-levels-ig-poster" } });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    if (!/image\/jpeg/i.test(res.headers.get("content-type") ?? "")) return { ok: false, why: "not a JPEG" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 5000) return { ok: false, why: "image too small (a blank or error picture)" };
    if (bytes.length > MAX_JPEG_BYTES) return { ok: false, why: "image over 8 MB" };
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { ok: false, why: "bytes are not a JPEG" };
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.name : "error" };
  }
}
