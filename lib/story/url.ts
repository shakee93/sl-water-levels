// Addresses of the story images (/api/story/<kind>/<slug>.png). Pure: used by the pages' og:image tags and by the share button.
import { isLocale, type Locale } from "@/lib/i18n/config";

// rain and reservoirs are the keep-alive pictures of the Instagram account (scripts/ig-post.mjs); their slug is always "now".
export const STORY_KINDS = ["gauge", "town", "river", "home", "rain", "reservoirs"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];
export type StoryFormat = "story" | "square" | "og";
/** png for pages and X; jpg for Instagram (it accepts JPEG only). */
export type StoryExt = "png" | "jpg";
export const isStoryKind = (v: unknown): v is StoryKind => typeof v === "string" && (STORY_KINDS as readonly string[]).includes(v);
export const SIZES: Record<StoryFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  og: { width: 1200, height: 630 },
};

/** 10-minute bucket: WhatsApp and Facebook keep link previews per address, so the og:image address changes every 10 minutes. */
export const timeBucket = (now = Date.now()) => Math.floor(now / 600_000);

export function storyPath(kind: StoryKind, slug: string, o: { format?: StoryFormat; lang?: Locale; unit?: "ft" | "m"; t?: number; ext?: StoryExt } = {}): string {
  const q = new URLSearchParams();
  if (o.format && o.format !== "story") q.set("format", o.format);
  if (o.lang && isLocale(o.lang) && o.lang !== "en") q.set("lang", o.lang);
  if (o.unit === "m") q.set("unit", "m");
  if (o.t != null) q.set("t", String(o.t));
  const s = q.toString();
  return `/api/story/${kind}/${encodeURIComponent(slug)}.${o.ext === "jpg" ? "jpg" : "png"}${s ? `?${s}` : ""}`;
}
