// Posting to the site's Facebook Page through the Pages API (graph.facebook.com): the on/off gate, the two publish calls
// (a photo with a caption; a link or text post) and the Facebook-only error classes. The sibling of lib/igClient.ts and
// stricter in three ways, so scripts/fb-post.test.mts can prove nothing ever reaches graph.facebook.com:
//   - it NEVER uses the global fetch: every call must be handed a `doFetch`, and throws without one;
//   - it refuses any address that is not exactly https://graph.facebook.com/<version>/<numeric page id>/<photos|feed>;
//   - one publish is ONE request. Nothing is retried, whatever came back: a timeout can mean the post is already on the Page.
// The token travels only in the Authorization header: never in the address, the body, an error text or a log.
//
// The gate (the one place that decides whether anything leaves for Facebook). OFF is the default:
//   FB_MODE unset, "off" or anything unknown          -> "off": nothing is read, composed, shown in Slack or sent.
//   FB_MODE=dry                                       -> "dry": each post is shown in the owner's Slack, never sent to Facebook.
//   FB_MODE=live + FB_PAGE_ID + FB_PAGE_TOKEN         -> "live": posts go to the Page.
//   FB_MODE=live with a secret missing, an FB_PAGE_ID that is not a number or an IG_GRAPH_VERSION that is not
//   like v24.0                                        -> "dry", and the reason says which and what to do.
//
// What Meta asks for (read 12 Nov 2026 in the Graph API reference, v27.0 pages; sources in DOCS.md "Facebook Page posting"):
//   - POST /{page-id}/photos with `url` (a picture already on the internet: jpeg, png, gif, bmp or tiff, at most 10 MB) and
//     `caption` (`message` and `name` are deprecated there). Answer: { id (the photo), post_id (the Page post) }.
//   - POST /{page-id}/feed with `message` and / or `link`. Answer: { id (the Page post) }.
//   - Both need a PAGE access token asked for by someone who can do the CREATE_CONTENT task on the Page, with the permissions
//     pages_manage_posts, pages_read_engagement and pages_show_list.
//   - Rate limit with a Page or system-user token: 4,800 calls per engaged user per 24 h; error 80001 when it is reached.
// The Graph version is the one Instagram uses (IG_GRAPH_VERSION in lib/igClient.ts, same repository variable to override it).

// @ts-ignore node strip-types needs explicit extensions
import { IG_GRAPH_VERSION, GRAPH, classifyError } from "./igClient.ts";
// @ts-ignore node strip-types needs explicit extensions
import type { GraphError } from "./igClient.ts";

export const FB_HOST = "graph.facebook.com";
const UA = "sl-water-levels-fb-poster";
const PAGE_ID = /^\d{5,25}$/;
const VERSION = /^v\d{1,3}\.\d{1,2}$/;

type Env = Record<string, string | undefined>;
export type FbKeys = { token: string; pageId: string };
/**
 * `asked` is what FB_MODE said; `mode` is what will happen (live asked with something wrong = dry). `fix` is what the owner
 * has to do before live can work ("" when nothing). Everything that would make a publish impossible is caught HERE, before a
 * post claims its key: a post is never used up by a setting that could not have worked.
 */
export type FbGate = { mode: "off" | "dry" | "live"; asked: "off" | "dry" | "live"; keys: FbKeys | null; reason: string; missing: string[]; fix: string };

export function gate(env: Env): FbGate {
  const want = (env.FB_MODE ?? "").trim().toLowerCase();
  if (want !== "dry" && want !== "live") {
    const reason = !want ? "FB_MODE is not set: off (the default)" : want === "off" ? "FB_MODE=off (kill switch)" : `FB_MODE is "${want.replace(/[^a-z0-9_-]/g, "?").slice(0, 20)}", which is not off, dry or live: off`;
    return { mode: "off", asked: "off", keys: null, missing: [], reason, fix: "" };
  }
  const token = (env.FB_PAGE_TOKEN ?? "").trim();
  const pageId = (env.FB_PAGE_ID ?? "").trim();
  const missing = (["FB_PAGE_ID", "FB_PAGE_TOKEN"] as const).filter((k) => !(env[k] ?? "").trim());
  const version = (env.IG_GRAPH_VERSION ?? "").trim();
  // what stands between here and live, most basic first: [what is wrong, what to do, which secrets it names]
  const wrong: [string, string, string[]] | null = missing.length
    ? [`${missing.join(" and ")} not set`, `add the GitHub secret${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`, missing]
    : !PAGE_ID.test(pageId)
      ? ["FB_PAGE_ID is not a Page id (digits only)", "set the secret FB_PAGE_ID to the Page's id, a number", ["FB_PAGE_ID"]]
      : version && !VERSION.test(version)
        ? ["IG_GRAPH_VERSION is not a version like v24.0", "set the repository variable IG_GRAPH_VERSION to a version like v24.0, or delete it", []]
        : null;
  if (want === "dry") {
    return { mode: "dry", asked: "dry", keys: null, missing, fix: wrong?.[1] ?? "", reason: `FB_MODE=dry: previews only, nothing goes to Facebook${wrong ? ` (${wrong[0]}: needed before FB_MODE=live)` : ""}` };
  }
  if (wrong) return { mode: "dry", asked: "live", keys: null, missing: wrong[2], fix: wrong[1], reason: `FB_MODE=live but ${wrong[0]}: staying in dry-run` };
  return { mode: "live", asked: "live", keys: { token, pageId }, missing: [], fix: "", reason: "FB_MODE=live and both secrets are set" };
}

/** The one address a publish may go to, or null when the Page id or the version would make it anything else. */
export function endpoint(keys: FbKeys, edge: "photos" | "feed", env: Env = {}): string | null {
  const v = (env.IG_GRAPH_VERSION ?? "").trim() || IG_GRAPH_VERSION;
  if (!VERSION.test(v) || !PAGE_ID.test(keys.pageId) || (edge !== "photos" && edge !== "feed")) return null;
  const url = `${GRAPH}/${v}/${keys.pageId}/${edge}`;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  return u.protocol === "https:" && u.hostname === FB_HOST && !u.search && !u.hash && !u.username && u.href === url ? url : null;
}

/**
 * A Graph error body as the poster needs it. The shared classes come from lib/igClient.ts (190 = token expired or revoked and
 * 200-299 = missing permission pause 6 h; 4, 17, 32, 613, 368 = rate limit or temporary block pause 1 h; 5xx pauses 15 min).
 * Facebook adds 80001, the Page rate limit with a Page or system-user token: 1 h. The token itself is cut out of the text.
 */
export function classifyFbError(status: number, body: unknown, now: number, token = ""): GraphError {
  const r = classifyError(status, body, now);
  const detail = token.length >= 8 ? r.detail.split(token).join("[token]") : r.detail;
  return { ...r, detail, pauseUntilMs: r.pauseUntilMs == null && r.code === 80001 ? now + 3_600_000 : r.pauseUntilMs };
}

export type FbOpts = { doFetch: typeof fetch; now?: number; env?: Env };
const refused = (detail: string): GraphError => ({ ok: false, status: 0, code: null, subcode: null, detail, pauseUntilMs: null, auth: false });

async function post(keys: FbKeys, edge: "photos" | "feed", params: Record<string, string>, o: FbOpts): Promise<{ ok: true; data: Record<string, unknown> } | GraphError> {
  if (typeof o?.doFetch !== "function") throw new TypeError("fbClient: a fetch must be handed in (doFetch); this client never uses the global one");
  const now = o.now ?? Date.now();
  const url = endpoint(keys, edge, o.env ?? {});
  if (!url) return refused("nothing was sent: the Page id or the Graph version (IG_GRAPH_VERSION, like v24.0) is not valid");
  let res: Response;
  try {
    res = await o.doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${keys.token}`, "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      redirect: "error", // a redirect would be another host: refuse it
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    // no answer: the post may or may not exist. Never sent again; the caller tells Slack to look at the Page.
    return { ok: false, status: 0, code: null, subcode: null, detail: `network: ${e instanceof Error ? e.name : "error"} (no answer: the post may or may not be on the Page)`, pauseUntilMs: now + 15 * 60_000, auth: false };
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.error) return classifyFbError(res.status, j, now, keys.token);
  return { ok: true, data: j };
}

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
export type FbPublishResult = { ok: true; /** the Page post */ postId: string; /** the photo, for a photo post */ photoId: string | null } | GraphError;

/** A photo post: the picture (a public address Facebook fetches itself) with the caption under it. One request, never retried. */
export async function publishPhoto(keys: FbKeys, p: { imageUrl: string; caption: string }, o: FbOpts): Promise<FbPublishResult> {
  const r = await post(keys, "photos", { url: p.imageUrl, caption: p.caption }, o);
  if (!r.ok) return r;
  const photoId = str(r.data.id);
  const postId = str(r.data.post_id);
  if (!photoId && !postId) return refused("Facebook answered without an id: look at the Page before posting by hand");
  return { ok: true, postId: postId || photoId, photoId: photoId || null };
}

/** A post without a picture of ours: text, and a link Facebook draws a preview card for. One request, never retried. */
export async function publishFeed(keys: FbKeys, p: { message: string; link?: string }, o: FbOpts): Promise<FbPublishResult> {
  const params: Record<string, string> = { message: p.message };
  if (p.link) params.link = p.link;
  const r = await post(keys, "feed", params, o);
  if (!r.ok) return r;
  const postId = str(r.data.id);
  if (!postId) return refused("Facebook answered without an id: look at the Page before posting by hand");
  return { ok: true, postId, photoId: null };
}
