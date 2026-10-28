// Pictures for X posts: which image goes with which post, how it is fetched from the live site (the story images,
// /api/story/..., CDN-cached 5 min), uploaded to X (lib/xClient.ts uploadMedia: v2 /2/media/upload, v1.1 fallback, the same
// OAuth 1.0a user keys as the posts) and described (alt text). Everything here fails soft: a missing picture never blocks a post.
//
// X_MEDIA=off|alerts|all (default alerts):
//   off     never a picture
//   alerts  Alert / Minor / Major rises of a river gauge (gauge picture) and the morning summary (home "right now" picture)
//   all     also all-clears (gauge), storm updates and official warnings (river), national "rivers rising" and the evening
//           summary (home)
// Format: SQUARE (1080x1080). X shows a single 1:1 image whole in the timeline, on phone and web; the 1200x630 "og" card is
// shown smaller, so the names and the chart become hard to read, and 9:16 story images are cropped in the feed.
import { uploadMedia, setAltText } from "../lib/xClient.ts";

export const MAX_IMAGE_BYTES = 5_000_000;

export function mediaMode(env) {
  const v = (env.X_MEDIA ?? "").trim().toLowerCase();
  return v === "off" || v === "all" ? v : "alerts";
}

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "numeric", minute: "2-digit", hour12: true }).format(ms).replace(/\s?([ap]m)/i, (_, m) => ` ${m.toLowerCase()}`);
const ft = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} ft`;
const WORD = { normal: "normal", watch: "watch", alert: "Alert", minor: "Minor flood", major: "Major flood" };
const trendOf = (t) => (/rising/.test(t ?? "") ? "rising" : /falling/.test(t ?? "") ? "falling" : /steady|stable/.test(t ?? "") ? "steady" : null);

/** { base, slug } from a gauge page address: https://site/<basin>/<station> -> river slug and gauge slug. */
function slugsOf(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? { basin: parts[parts.length - 2], station: parts[parts.length - 1] } : { basin: parts[0] ?? null, station: null };
  } catch {
    return { basin: null, station: null };
  }
}

const gaugeAlt = (g) => [`${g.station}${g.river ? `, ${g.river}` : ""}: ${ft(g.level)}`, WORD[g.tier], trendOf(g.trend), g.at ? clock(g.at) : null].filter(Boolean).join(", ");

/** The picture an event wants in `mode`: { kind, slug, alt } or null. */
export function mediaFor(ev, mode) {
  if (mode === "off") return null;
  const all = mode === "all";
  switch (ev.type) {
    case "gauge_rise": {
      const g = ev.gauges.slice().sort((a, b) => ["normal", "watch", "alert", "minor", "major"].indexOf(b.tier) - ["normal", "watch", "alert", "minor", "major"].indexOf(a.tier))[0];
      const { station } = slugsOf(g.url);
      return station ? { kind: "gauge", slug: station, alt: gaugeAlt(g) } : null;
    }
    case "gauge_clear": {
      const g = ev.gauges[0];
      const { station } = slugsOf(g.url);
      return all && station ? { kind: "gauge", slug: station, alt: gaugeAlt(g) } : null;
    }
    case "storm": {
      const { basin } = slugsOf(ev.storm.url);
      const gs = ev.storm.gauges.slice(0, 3).map((g) => `${g.station} ${ft(g.level)}`).join(", ");
      return all && basin ? { kind: "river", slug: basin, alt: `${ev.storm.river} update, ${clock(ev.storm.at)}: ${gs}` } : null;
    }
    case "warning": {
      const { basin } = slugsOf(ev.warning.url);
      return all && basin ? { kind: "river", slug: basin, alt: `${ev.warning.basins[0]} river levels, ${clock(ev.warning.issuedAt)}: ${ev.warning.severity} bulletin passed on` } : null;
    }
    case "rivers_rising":
      return all ? { kind: "home", slug: "now", alt: `Rivers rising across Sri Lanka, ${clock(ev.rivers.at)}: ${ev.rivers.gauges.map((g) => `${g.station} ${ft(g.level)}`).join(", ")}` } : null;
    case "summary": {
      const s = ev.summary;
      if (s.period !== "morning" && !all) return null;
      const n = s.atAlert.length;
      return { kind: "home", slug: "now", alt: `River levels in Sri Lanka, ${clock(s.at)}: ${n ? `${n} gauge${n === 1 ? "" : "s"} at Alert or higher${s.nearAlert ? `, ${s.nearAlert} near it` : ""}` : "no gauge at Alert or higher"}` };
    }
    default:
      return null;
  }
}

/** The picture for a post made of `events` (most important first): the first event that wants one. Adds the image address. */
export function pickMedia(events, mode, site) {
  for (const ev of events) {
    const m = mediaFor(ev, mode);
    if (m) return { ...m, url: `${site.replace(/\/$/, "")}/api/story/${m.kind}/${encodeURIComponent(m.slug)}.png?format=square` };
  }
  return null;
}

/** Estimated extra cost of one picture: the upload (not priced separately by X today, X_COST_MEDIA) plus the alt-text call (X_COST_MEDIA_ALT). */
export const mediaCost = (rates) => (rates.media ?? 0) + (rates.alt ?? 0);

/** Downloads the picture. { ok, bytes } or { ok: false, why }. */
export async function fetchImage(url, doFetch = fetch) {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "sl-water-levels-x-poster" } });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    if (!/image\/png/i.test(res.headers.get("content-type") ?? "")) return { ok: false, why: "not a PNG" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 2000) return { ok: false, why: "image too small (a blank or error picture)" };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, why: "image over 5 MB" };
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.name : "error" };
  }
}

/** Fetch, upload and describe. { mediaIds } on success; { why } when the post must go out text-only. Never throws. */
export async function attachMedia(keys, media, { doFetch = fetch } = {}) {
  const img = await fetchImage(media.url, doFetch);
  if (!img.ok) return { why: `image not fetched (${img.why})` };
  let id;
  try {
    id = await uploadMedia(keys, img.bytes, "image/png", doFetch);
  } catch (e) {
    return { why: `upload failed (${e instanceof Error ? e.message.slice(0, 160) : "error"})` };
  }
  const alt = await setAltText(keys, id, media.alt, doFetch);
  return { mediaIds: [id], altSet: alt };
}
