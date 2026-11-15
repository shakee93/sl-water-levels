// Cover thumbnails for the Flood news board (owner decision 15 Nov 2026: a small cover image beside each
// headline, linked to the article; this widens the old "headline + link + 20-word sentence" rule).
// Pure: no imports, so scripts/news.test.mts can load it. The image URL comes from data we already fetch
// (the RSS item, Newswire's WordPress API, or the Ada Derana story page's og:image) and is kept only when it
// is https, on a host and path we have listed here AND in next.config.ts (images.remotePatterns), and does not
// look like a tracking pixel or an icon. The browser never loads the outlet's file: next/image serves it.

/** Exact hosts and path prefixes. Keep in step with next.config.ts (scripts/news.test.mts checks it). */
export const NEWS_IMAGE_HOSTS: { hostname: string; pathPrefix: string }[] = [
  { hostname: "www.newswire.lk", pathPrefix: "/wp-content/uploads/" }, // Newswire (feed, WordPress API)
  { hostname: "bmkltsly13vb.compat.objectstorage.ap-singapore-1.oraclecloud.com", pathPrefix: "/cdn.sg.dailymirror.lk/assets/uploads/" }, // Daily Mirror feed
  { hostname: "media.adaderanaenglish.lk", pathPrefix: "/articles/" }, // Ada Derana story page og:image
];

const MIN_SIDE = 100;
const BAD_NAME = /(pixel|tracking|tracker|beacon|spacer|blank|1x1|favicon|sprite|avatar|gravatar|emoji|\/icons?\/|[-_/]icon[-_.]|logo)/i;

const unescapeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?38;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The URL when it is an acceptable thumbnail source, else null. width/height are the page's own attributes, when it gave them. */
export function cleanImageUrl(raw: string | null | undefined, width?: number | null, height?: number | null): string | null {
  if (!raw) return null;
  const s = unescapeXml(raw.trim());
  if (s.length > 500 || /^data:/i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
  if (!NEWS_IMAGE_HOSTS.some((h) => u.hostname === h.hostname && u.pathname.startsWith(h.pathPrefix))) return null;
  if (!/\.(jpe?g|png|webp)$/i.test(u.pathname) || BAD_NAME.test(u.pathname)) return null;
  if ((width != null && width > 0 && width < MIN_SIDE) || (height != null && height > 0 && height < MIN_SIDE)) return null;
  return u.toString();
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? null) : null;
};
const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

/** The image of one raw RSS <item> block: enclosure / media:*, then <image><url>, then the first usable <img> (description or content:encoded). */
export function feedImage(block: string): string | null {
  const raw = unescapeXml(block);
  for (const m of raw.matchAll(/<(?:enclosure|media:content|media:thumbnail)\b[^>]*>/gi)) {
    const type = attr(m[0], "type");
    if (type && !/^image\//i.test(type)) continue;
    const u = cleanImageUrl(attr(m[0], "url"), num(attr(m[0], "width")), num(attr(m[0], "height")));
    if (u) return u;
  }
  for (const m of raw.matchAll(/<image>\s*<url>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)) {
    const u = cleanImageUrl(m[1]);
    if (u) return u;
  }
  for (const m of raw.matchAll(/<img\b[^>]*>/gi)) {
    const u = cleanImageUrl(attr(m[0], "src"), num(attr(m[0], "width")), num(attr(m[0], "height")));
    if (u) return u;
  }
  return null;
}

type WpMedia = { source_url?: string; media_details?: { width?: number; height?: number; sizes?: Record<string, { source_url?: string; width?: number; height?: number }> } };

/** Newswire WordPress API post fetched with `_embed=wp:featuredmedia`: the medium-sized file when there is one (about 425 px wide), else the original. */
export function wpImage(post: { _embedded?: Record<string, unknown> } | null | undefined): string | null {
  const list = post?._embedded?.["wp:featuredmedia"];
  const m = (Array.isArray(list) ? list[0] : null) as WpMedia | null;
  if (!m || typeof m !== "object") return null;
  const med = m.media_details?.sizes?.medium;
  return cleanImageUrl(med?.source_url, med?.width, med?.height) ?? cleanImageUrl(m.source_url, m.media_details?.width, m.media_details?.height);
}

/** og:image (else twitter:image) of a story page. */
export function ogImage(html: string): string | null {
  for (const prop of ["og:image", "twitter:image"]) {
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
      const t = m[0];
      if ((attr(t, "property") ?? attr(t, "name"))?.toLowerCase() !== prop) continue;
      const u = cleanImageUrl(attr(t, "content"));
      if (u) return u;
    }
  }
  return null;
}
