// Reading from X (mentions, our own user, direct messages) and sending a direct message. OAuth 1.0a user context, signed with
// the same helper as posting. No clock or network unless handed one, so scripts/x-replies.test.mts can drive it.
// @ts-ignore node strip-types needs explicit extensions
import { oauthHeader, type XKeys } from "./xClient.ts";

export type XUser = { id: string; username: string; name?: string; description?: string; protected?: boolean };
export type XMention = { id: string; text: string; authorId: string; conversationId: string | null; inReplyToUserId: string | null; createdAt: number | null; lang?: string };
export type ReadResult<T> = { ok: true; data: T; reads: number } | { ok: false; status: number; detail: string; retryAfterMs: number | null };

const API = "https://api.x.com/2";

async function xGet(keys: XKeys, path: string, query: Record<string, string>, doFetch: typeof fetch, now: number): Promise<{ ok: true; json: any } | { ok: false; status: number; detail: string; retryAfterMs: number | null }> {
  const url = `${API}${path}`;
  const qs = new URLSearchParams(query).toString();
  let res: Response;
  try {
    res = await doFetch(qs ? `${url}?${qs}` : url, { headers: { Authorization: oauthHeader("GET", url, keys, { query }), "User-Agent": "sl-water-levels-x-replies" }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    return { ok: false, status: 0, detail: `network: ${e instanceof Error ? e.name : "error"}`, retryAfterMs: now + 15 * 60_000 };
  }
  const j: any = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, json: j };
  const detail = [j.title, j.detail, ...(j.errors ?? []).map((e: any) => e.message)].filter(Boolean).join(": ").slice(0, 300) || `HTTP ${res.status}`;
  let retryAfterMs: number | null = null;
  if (res.status === 429) {
    const reset = Number(res.headers.get("x-rate-limit-reset"));
    retryAfterMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 + 30_000 : now + 15 * 60_000;
  } else if (res.status === 401 || res.status === 402 || res.status === 403) retryAfterMs = now + 6 * 3_600_000;
  else if (res.status >= 500 || res.status === 0) retryAfterMs = now + 15 * 60_000;
  return { ok: false, status: res.status, detail: `HTTP ${res.status} ${detail}`, retryAfterMs };
}

const userOf = (u: any): XUser => ({ id: String(u.id), username: String(u.username ?? ""), name: u.name, description: u.description, protected: !!u.protected });

/** Who we are (one call, remembered by the caller). */
export async function getMe(keys: XKeys, o: { doFetch?: typeof fetch; now?: number } = {}): Promise<ReadResult<XUser>> {
  const r = await xGet(keys, "/users/me", {}, o.doFetch ?? fetch, o.now ?? Date.now());
  if (!r.ok) return r;
  if (!r.json?.data?.id) return { ok: false, status: 200, detail: "no user in the response", retryAfterMs: null };
  return { ok: true, data: userOf(r.json.data), reads: 1 };
}

/**
 * Mentions of us newer than sinceId, newest first, up to `max` posts over at most 3 pages. `reads` is how many posts were
 * returned (what X bills). `newestId` is the highest id seen (the next since_id).
 */
export async function getMentions(keys: XKeys, userId: string, o: { sinceId?: string | null; max?: number; doFetch?: typeof fetch; now?: number } = {}): Promise<ReadResult<{ mentions: XMention[]; users: Record<string, XUser>; newestId: string | null }>> {
  const doFetch = o.doFetch ?? fetch;
  const now = o.now ?? Date.now();
  const max = Math.max(5, Math.min(100, o.max ?? 20));
  const mentions: XMention[] = [];
  const users: Record<string, XUser> = {};
  let token: string | null = null;
  let reads = 0;
  for (let page = 0; page < 3; page++) {
    const q: Record<string, string> = {
      max_results: String(max), "tweet.fields": "created_at,author_id,conversation_id,in_reply_to_user_id,lang", expansions: "author_id", "user.fields": "username,name,description,protected",
    };
    if (o.sinceId) q.since_id = o.sinceId;
    if (token) q.pagination_token = token;
    const r = await xGet(keys, `/users/${userId}/mentions`, q, doFetch, now);
    if (!r.ok) return mentions.length ? { ok: true, data: { mentions, users, newestId: newest(mentions) }, reads } : r;
    for (const u of r.json.includes?.users ?? []) users[String(u.id)] = userOf(u);
    for (const t of r.json.data ?? []) {
      reads++;
      mentions.push({ id: String(t.id), text: String(t.text ?? ""), authorId: String(t.author_id ?? ""), conversationId: t.conversation_id ? String(t.conversation_id) : null, inReplyToUserId: t.in_reply_to_user_id ? String(t.in_reply_to_user_id) : null, createdAt: t.created_at ? Date.parse(t.created_at) : null, lang: t.lang });
    }
    token = r.json.meta?.next_token ?? null;
    if (!token || reads >= max) break;
  }
  return { ok: true, data: { mentions, users, newestId: newest(mentions) }, reads };
}

const newest = (ms: { id: string }[]): string | null => ms.reduce<string | null>((a, m) => (a == null || BigInt(m.id) > BigInt(a) ? m.id : a), null);

export type XDm = { id: string; text: string; senderId: string; conversationId: string; createdAt: number | null };

/** Recent direct messages (newest first, one page). Needs the app's "Read and write and Direct message" permission. */
export async function getDms(keys: XKeys, o: { max?: number; doFetch?: typeof fetch; now?: number } = {}): Promise<ReadResult<{ dms: XDm[]; users: Record<string, XUser> }>> {
  const r = await xGet(keys, "/dm_events", {
    max_results: String(Math.max(1, Math.min(100, o.max ?? 20))), event_types: "MessageCreate", "dm_event.fields": "created_at,sender_id,dm_conversation_id,text,event_type",
    expansions: "sender_id", "user.fields": "username,name,description,protected",
  }, o.doFetch ?? fetch, o.now ?? Date.now());
  if (!r.ok) return r;
  const users: Record<string, XUser> = {};
  for (const u of r.json.includes?.users ?? []) users[String(u.id)] = userOf(u);
  const dms: XDm[] = (r.json.data ?? []).filter((e: any) => e.event_type === "MessageCreate" || !e.event_type).map((e: any) => ({ id: String(e.id), text: String(e.text ?? ""), senderId: String(e.sender_id ?? ""), conversationId: String(e.dm_conversation_id ?? ""), createdAt: e.created_at ? Date.parse(e.created_at) : null }));
  return { ok: true, data: { dms, users }, reads: dms.length };
}

export type SendResult = { ok: true; id: string } | { ok: false; status: number; detail: string; retryAfterMs: number | null; duplicate: boolean };

/** One direct message to one person. Never retries. */
export async function sendDm(keys: XKeys, participantId: string, text: string, o: { doFetch?: typeof fetch; now?: number } = {}): Promise<SendResult> {
  const doFetch = o.doFetch ?? fetch;
  const now = o.now ?? Date.now();
  const url = `${API}/dm_conversations/with/${participantId}/messages`;
  let res: Response;
  try {
    res = await doFetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url, keys), "Content-Type": "application/json", "User-Agent": "sl-water-levels-x-replies" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    return { ok: false, status: 0, detail: `network: ${e instanceof Error ? e.name : "error"}`, retryAfterMs: now + 15 * 60_000, duplicate: false };
  }
  const j: any = await res.json().catch(() => ({}));
  if (res.ok && (j.data?.dm_event_id || j.data?.id)) return { ok: true, id: String(j.data.dm_event_id ?? j.data.id) };
  const detail = [j.title, j.detail, ...(j.errors ?? []).map((e: any) => e.message)].filter(Boolean).join(": ").slice(0, 300) || `HTTP ${res.status}`;
  const retryAfterMs = res.status === 429 ? now + 15 * 60_000 : res.status === 401 ? now + 6 * 3_600_000 : res.status >= 500 ? now + 15 * 60_000 : null;
  return { ok: false, status: res.status, detail: `HTTP ${res.status} ${detail}`, retryAfterMs, duplicate: res.status === 403 && /duplicate/i.test(detail) };
}

export type XFound = { id: string; text: string; authorId: string; username: string; createdAt: number | null; isReply: boolean; isRepost: boolean };

/** Recent search (last 7 days), newest first, one page of at most `max` posts (min 10 for X). `reads` = posts returned (what X bills). */
export async function searchRecent(keys: XKeys, query: string, o: { sinceId?: string | null; startTime?: number; max?: number; doFetch?: typeof fetch; now?: number } = {}): Promise<ReadResult<{ posts: XFound[] }>> {
  const now = o.now ?? Date.now();
  const q: Record<string, string> = {
    query, max_results: String(Math.max(10, Math.min(100, o.max ?? 10))), "tweet.fields": "created_at,author_id,referenced_tweets,lang",
    expansions: "author_id", "user.fields": "username",
  };
  if (o.sinceId) q.since_id = o.sinceId;
  else if (o.startTime) q.start_time = new Date(Math.max(o.startTime, now - 6.9 * 86_400_000)).toISOString().replace(/\.\d+Z$/, "Z");
  const r = await xGet(keys, "/tweets/search/recent", q, o.doFetch ?? fetch, now);
  if (!r.ok) return r;
  const names: Record<string, string> = {};
  for (const u of r.json.includes?.users ?? []) names[String(u.id)] = String(u.username ?? "");
  const posts: XFound[] = (r.json.data ?? []).map((t: any) => ({
    id: String(t.id), text: String(t.text ?? ""), authorId: String(t.author_id ?? ""), username: names[String(t.author_id)] ?? "", createdAt: t.created_at ? Date.parse(t.created_at) : null,
    isReply: (t.referenced_tweets ?? []).some((x: any) => x.type === "replied_to"), isRepost: (t.referenced_tweets ?? []).some((x: any) => x.type === "retweeted"),
  }));
  return { ok: true, data: { posts }, reads: posts.length };
}

/** Repost one post as the given user (POST /2/users/:id/retweets). Never retries. */
export async function repostTweet(keys: XKeys, userId: string, tweetId: string, o: { doFetch?: typeof fetch; now?: number } = {}): Promise<SendResult> {
  const doFetch = o.doFetch ?? fetch;
  const now = o.now ?? Date.now();
  const url = `${API}/users/${userId}/retweets`;
  let res: Response;
  try {
    res = await doFetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url, keys), "Content-Type": "application/json", "User-Agent": "sl-water-levels-x-reposts" }, body: JSON.stringify({ tweet_id: tweetId }), signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    return { ok: false, status: 0, detail: `network: ${e instanceof Error ? e.name : "error"}`, retryAfterMs: now + 15 * 60_000, duplicate: false };
  }
  const j: any = await res.json().catch(() => ({}));
  if (res.ok && j.data?.retweeted) return { ok: true, id: tweetId };
  const detail = [j.title, j.detail, ...(j.errors ?? []).map((e: any) => e.message)].filter(Boolean).join(": ").slice(0, 300) || `HTTP ${res.status}`;
  const retryAfterMs = res.status === 429 ? now + 15 * 60_000 : res.status === 401 ? now + 6 * 3_600_000 : res.status >= 500 ? now + 15 * 60_000 : null;
  return { ok: false, status: res.status, detail: `HTTP ${res.status} ${detail}`, retryAfterMs, duplicate: false };
}
