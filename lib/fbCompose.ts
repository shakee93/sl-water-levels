// Words for the Facebook Page: the Instagram caption (lib/igCompose.ts: English first, then Sinhala and Tamil, then place
// hashtags) with ONE difference. Instagram captions cannot carry a clickable link, so they end with the bare address
// "Live levels: waterlevels.lk"; a Facebook post can, so that line becomes the link of the page that matches the picture.
// Pure (no I/O, no clock): scripts/fb-post.mjs and scripts/fb-post.test.mts share it.

// @ts-ignore node strip-types needs explicit extensions
import { composeCaption, LIVE_LINE, MAX_CAPTION, MAX_TAGS } from "./igCompose.ts";
// @ts-ignore node strip-types needs explicit extensions
import type { Item, Lang } from "./igCompose.ts";

export type PageLink = { url: string; label: string };
type Post = { cap?: { type?: string } | null; media?: { kind?: string; slug?: string } | null };

/**
 * The page of the site that matches a post, with the few words that go in front of it. Null when there is none (the post is
 * then not sent). scripts/fb-post.test.mts checks every path here is a real route under app/[lang]/.
 */
export function pageLink(site: string, item: Post): PageLink | null {
  const base = site.replace(/\/+$/, "");
  const type = item.cap?.type;
  if (type === "survey") return { url: `${base}/flood-survey`, label: "Add your spot" };
  if (type === "embed") return { url: `${base}/embed`, label: "Get the widget" };
  const slug = item.media?.slug ?? "";
  switch (item.media?.kind) {
    case "river":
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? { url: `${base}/${slug}`, label: "Live levels" } : null;
    case "home":
      return { url: base, label: "Live levels" };
    case "rain":
      return { url: `${base}/rain`, label: "Rain map" };
    case "reservoirs":
      return { url: `${base}/reservoirs/spilling`, label: "Reservoirs" };
    default:
      return null;
  }
}

/** The feed caption for Facebook: the Instagram feed caption with its address line replaced by "<label>: <link>". */
export function composeFbCaption(it: Item, o: { link: PageLink; langs?: Lang[] }): { text: string; en: string; tags: string[] } {
  const c = composeCaption(it, { feed: true, langs: o.langs });
  return { text: c.text.split(LIVE_LINE.en).join(`${o.link.label}: ${o.link.url}`), en: c.en, tags: c.tags };
}

/**
 * Problems with a finished Facebook caption (empty = fine): exactly one link and it is the expected page of our own site
 * (https, no query, no fragment), no @mention, at most MAX_TAGS hashtags, English first, not too long.
 */
export function validateFbCaption(text: string, o: { link: string; site: string }): string[] {
  const bad: string[] = [];
  let ours = false;
  try {
    const l = new URL(o.link);
    ours = l.protocol === "https:" && l.origin === new URL(o.site).origin && !l.search && !l.hash;
  } catch { /* not a link at all */ }
  if (!ours) bad.push("the link is not a plain https page of our own site");
  const links = text.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? [];
  if (links.length !== 1 || links[0] !== o.link) bad.push(links.length ? "contains a link other than the one page link" : "missing the page link");
  if (text.includes(LIVE_LINE.en)) bad.push("still has the Instagram address line");
  if (text.length > MAX_CAPTION) bad.push(`longer than ${MAX_CAPTION} characters`);
  if ((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > MAX_TAGS) bad.push(`more than ${MAX_TAGS} hashtags`);
  if (/@\w|@\[/.test(text)) bad.push("contains an @mention");
  if (!/[A-Za-z]/.test(text.split("\n")[0] ?? "")) bad.push("first line is not English");
  return bad;
}
