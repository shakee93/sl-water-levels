// News feeds (RSS) and their parsing. Newswire (a WordPress site) is the main source; Ada Derana and
// Daily Mirror are secondary. Used by the spill-gate detector (lib/releases.ts) and the Flood news
// board (lib/news.ts). Politeness: an identifying User-Agent, one request per feed per refresh (the
// callers cache for 10 minutes) and If-Modified-Since / If-None-Match so an unchanged feed costs a 304.
import { unstable_cache } from "next/cache";
import { plainText } from "./newsText";

export type Outlet = "Newswire" | "Ada Derana" | "Daily Mirror";
export type FeedItem = { guid: string; title: string; desc: string; link: string; pubMs: number | null };
export type OutletItem = FeedItem & { outlet: Outlet };

const SITE_URL = "https://sl-water-levels.vercel.app";
export const NEWSWIRE_UA = `sl-water-levels/1.0 (+${SITE_URL}; shakee.zats@gmail.com)`;
const OLD_UA = "Mozilla/5.0 (compatible; sl-water-levels; +https://github.com/shakee93/sl-water-levels)";

/** Main source first. */
export const NEWS_FEEDS: { outlet: Outlet; url: string; ua: string }[] = [
  { outlet: "Newswire", url: "https://www.newswire.lk/feed/", ua: NEWSWIRE_UA },
  { outlet: "Ada Derana", url: "https://adaderana.lk/rss.php", ua: OLD_UA },
  { outlet: "Daily Mirror", url: "https://www.dailymirror.lk/rss/breaking-news/108", ua: OLD_UA },
];

const TEN_MIN = 600;

// ---------------------------------------------------------------- parsing

function xmlText(block: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m ? plainText(m[1]) : "";
}

export function parseFeed(xml: string): FeedItem[] {
  return (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []).map((b) => {
    const pub = xmlText(b, "pubDate");
    let pubMs: number | null = null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(pub)) pubMs = Date.parse(pub.replace(" ", "T") + (pub.length === 16 ? ":00" : "") + "+05:30"); // Daily Mirror: Colombo local time
    else if (pub) pubMs = Date.parse(pub);
    const link = xmlText(b, "link");
    return { guid: xmlText(b, "guid") || link, title: xmlText(b, "title"), desc: xmlText(b, "description"), link, pubMs: pubMs != null && Number.isFinite(pubMs) ? pubMs : null };
  });
}

// ---------------------------------------------------------------- fetching

const memo = new Map<string, { lm: string | null; etag: string | null; items: FeedItem[] }>();

async function fetchOne(f: (typeof NEWS_FEEDS)[number]): Promise<FeedItem[]> {
  const prev = memo.get(f.url);
  const headers: Record<string, string> = { "User-Agent": f.ua, Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" };
  if (prev?.lm) headers["If-Modified-Since"] = prev.lm;
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  const res = await fetch(f.url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (res.status === 304 && prev) return prev.items;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text());
  memo.set(f.url, { lm: res.headers.get("last-modified"), etag: res.headers.get("etag"), items });
  return items;
}

export type FeedsResult = { items: OutletItem[]; errors: Partial<Record<Outlet, string>> };

/** Every feed, one request each. A feed that fails is reported in `errors`; throws only when none loaded. */
async function loadFeeds(): Promise<FeedsResult> {
  const items: OutletItem[] = [];
  const errors: FeedsResult["errors"] = {};
  let ok = 0;
  await Promise.all(
    NEWS_FEEDS.map(async (f) => {
      try {
        for (const it of await fetchOne(f)) items.push({ ...it, outlet: f.outlet });
        ok++;
      } catch (e) {
        errors[f.outlet] = e instanceof Error ? e.message : "failed";
      }
    }),
  );
  if (!ok) throw new Error(Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join("; ") || "no feed reachable");
  return { items, errors };
}

/** Shared by the gate detector and the news board: one fetch per 10 minutes. */
export const getFeeds = unstable_cache(loadFeeds, ["news-feeds-v1"], { revalidate: TEN_MIN });

/** Ada Derana's feed has no timestamps: the story page carries datePublished. Cached per story. */
export const articleTimeCached = unstable_cache(
  async (url: string): Promise<number> => {
    const res = await fetch(url, { headers: { "User-Agent": OLD_UA }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = /"datePublished":"([^"]+)"/.exec(await res.text());
    const ms = m ? Date.parse(m[1]) : NaN;
    if (!Number.isFinite(ms)) throw new Error("no publish time");
    return ms;
  },
  ["releases-news-time-v1"],
  { revalidate: 30 * 24 * 3600 },
);

// ---------------------------------------------------------------- article body (for the figures in a release story)

export type ArticleInfo = { text: string; publishedMs: number | null; modifiedMs: number | null };

const msOf = (html: string, key: string): number | null => {
  const m = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(html);
  const ms = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** The story's own paragraphs (Ada Derana's prose block, else the <article>, else the page), at most ~4000 characters. */
export function articleText(html: string): string {
  let region = html;
  const prose = html.search(/class="prose[^"]*"/);
  if (prose >= 0) region = html.slice(prose, html.indexOf("</div></div>", prose) > 0 ? html.indexOf("</div></div>", prose) : prose + 20_000);
  else {
    const a = html.search(/<article[\s>]/i);
    if (a >= 0) region = html.slice(a, html.indexOf("</article>", a) > 0 ? html.indexOf("</article>", a) : a + 30_000);
  }
  const paras = (region.match(/<p[\s>][\s\S]*?<\/p>/gi) ?? []).map((p) => plainText(p)).filter((p) => p.length > 20);
  return paras.map((p) => (/[.!?”"')]$/.test(p) ? p : `${p}.`)).join(" ").slice(0, 4000);
}

/** The story page: its text and its publish / last-modified times. Cached 10 minutes (a story is edited as figures come in). */
export const articleCached = unstable_cache(
  async (url: string): Promise<ArticleInfo> => {
    const ua = /newswire\.lk/i.test(url) ? NEWSWIRE_UA : OLD_UA;
    const res = await fetch(url, { headers: { "User-Agent": ua }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { text: articleText(html), publishedMs: msOf(html, "datePublished"), modifiedMs: msOf(html, "dateModified") };
  },
  ["releases-news-article-v1"],
  { revalidate: TEN_MIN },
);
