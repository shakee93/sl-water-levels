// The Flood news board: news reports about floods, rivers, reservoir releases, heavy rain, cyclones,
// landslides and weather closures in Sri Lanka, from Newswire (main) plus Ada Derana and Daily Mirror.
//
// What we keep of a story: its headline as published, the outlet, its time, a tag, a link, and at most
// the first sentence of the feed's own description cut at 20 words. Never the article. News is a
// report by someone else, never an official warning, and the pages say so.
//
// Newswire's feed holds only the newest ~20 stories (about half a day), so for the 7-day /news page
// Newswire's own WordPress search API (read-only, JSON) fills in the earlier days, one small query per
// topic, cached 10 minutes together with the feeds.
import { unstable_cache } from "next/cache";
import { aiConfigured, decide } from "./openai";
import { articleTimeCached, getFeeds, NEWSWIRE_UA, type Outlet, type OutletItem } from "./newsFeeds";
import { classifyNews, type NewsTag } from "./newsClassify";
import { decodeEntities, plainText, snippetOf } from "./newsText";
import { matchReservoir } from "./reservoirs";
import { PLACES, RIVERS } from "./places";
import { timeBox } from "./nextHour";

export type { NewsTag } from "./newsClassify";
export { NEWS_TAGS } from "./newsClassify";

export type NewsItem = {
  id: string;
  /** As published. */
  title: string;
  /** The outlet's own page. */
  url: string;
  source: Outlet;
  /** Epoch ms. */
  publishedAt: number;
  tag: NewsTag;
  /** First sentence of the feed's description, 20 words at most; null when there is none worth showing. */
  snippet: string | null;
  /** Catalogue reservoir ids (lib/reservoirs.ts), river basins (trimmed gauge basin names) and town slugs named in the story. */
  reservoirs: string[];
  rivers: string[];
  towns: string[];
};

export type NewsData = { items: NewsItem[]; errors: Partial<Record<Outlet, string>>; fetchedAt: number };

const DAY = 86_400_000;
export const NEWS_DAYS = 7;
const MAX_ITEMS = 150;
const MAX_AI_PER_REFRESH = 8;

// ---------------------------------------------------------------- Newswire backfill (earlier days)

const WP = "https://www.newswire.lk/wp-json/wp/v2/posts";
const WP_QUERIES = ["flood", "rain", "reservoir", "spill gates", "landslide", "cyclone", "weather", "evacuat"];

type WpPost = { link?: string; date_gmt?: string; title?: { rendered?: string }; excerpt?: { rendered?: string } };

async function backfill(sinceMs: number): Promise<OutletItem[]> {
  const after = new Date(sinceMs).toISOString().slice(0, 19);
  const out: OutletItem[] = [];
  await Promise.all(
    WP_QUERIES.map(async (q) => {
      try {
        const url = `${WP}?search=${encodeURIComponent(q)}&per_page=40&after=${after}&orderby=date&_fields=link,date_gmt,title,excerpt`;
        const res = await fetch(url, { headers: { "User-Agent": NEWSWIRE_UA, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const posts = (await res.json()) as WpPost[];
        for (const p of Array.isArray(posts) ? posts : []) {
          const link = p.link ?? "";
          const ms = Date.parse(`${p.date_gmt ?? ""}Z`);
          const title = plainText(p.title?.rendered ?? "");
          if (!link.startsWith("https://www.newswire.lk/") || !title || !Number.isFinite(ms)) continue;
          out.push({ guid: link, link, title, desc: plainText(p.excerpt?.rendered ?? ""), pubMs: ms, outlet: "Newswire" });
        }
      } catch {
        /* the feed alone is enough; the backfill only adds earlier days */
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- borderline items (optional model)

const askModel = unstable_cache(
  async (guid: string, title: string, desc: string): Promise<boolean> => {
    void guid;
    const r = await decide(`Headline: ${title}\n\n${desc}`.slice(0, 1500), [
      {
        type: "predicate",
        name: "relevant",
        instructions:
          "Is this Sri Lankan news item useful to someone worried about floods or river and reservoir water: floods, river levels, spill gates or reservoir releases, heavy rain or weather warnings, a cyclone or depression near Sri Lanka, landslide warnings, evacuations or relief after bad weather, or roads and railways closed by weather? Sport, politics, business, crime, celebrities and news from other countries are not.",
      },
    ]);
    if (!r.ok) throw new Error(r.reason);
    const a = r.data.get("relevant");
    return !!a && a.type === "predicate" && a.probability >= 0.8;
  },
  ["news-relevant-v1"],
  { revalidate: 7 * DAY / 1000 },
);

// ---------------------------------------------------------------- names in a story

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const hasName = (haystack: string, name: string) => ` ${haystack} `.includes(` ${name} `);

const RIVER_NAMES = RIVERS.flatMap((r) =>
  [r.basin, ...r.aliases]
    .map(norm)
    .filter((a) => a.length >= 5 || /\b(oya|ganga)\b/.test(a))
    .map((a) => ({ basin: r.basin, name: a })),
);
const TOWN_NAMES = PLACES.flatMap((p) => [p.name, ...p.aliases].map(norm).filter((a) => a.length >= 4 && /^[a-z ]+$/.test(a)).map((a) => ({ slug: p.slug, name: a })));

export function namesIn(title: string, desc: string): Pick<NewsItem, "reservoirs" | "rivers" | "towns"> {
  const head = norm(title);
  const all = norm(`${title} ${desc}`);
  const res = matchReservoir(title, "contains") ?? matchReservoir(`${title}. ${desc}`, "contains");
  const rivers = new Set<string>();
  if (res?.basin) rivers.add(res.basin.trim());
  for (const r of RIVER_NAMES) if (hasName(all, r.name)) rivers.add(r.basin);
  const towns: string[] = [];
  for (const where of [head, all]) for (const t of TOWN_NAMES) if (hasName(where, t.name) && !towns.includes(t.slug)) towns.push(t.slug);
  return { reservoirs: res ? [res.id] : [], rivers: [...rivers].slice(0, 3), towns: towns.slice(0, 3) };
}

// ---------------------------------------------------------------- build

const keyOf = (title: string) => norm(title).replace(/\s+/g, "");

async function build(): Promise<NewsData> {
  const now = Date.now();
  const since = now - NEWS_DAYS * DAY;
  const [feeds, extra] = await Promise.all([getFeeds(), backfill(since)]);

  // Newswire first, so a story that several outlets carry is credited to the main source.
  const rank = (o: Outlet) => (o === "Newswire" ? 0 : o === "Ada Derana" ? 1 : 2);
  const all = [...feeds.items, ...extra].sort((a, b) => rank(a.outlet) - rank(b.outlet));
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  let aiLeft = MAX_AI_PER_REFRESH;

  for (const it of all) {
    if (!it.title || !it.link) continue;
    const k = keyOf(it.title);
    if (seen.has(k)) continue;
    const v = classifyNews({ title: it.title, desc: it.desc });
    if (v.kind === "no") continue;
    if (v.kind === "borderline") {
      if (!aiConfigured() || aiLeft <= 0) continue;
      aiLeft--;
      const yes = await askModel(it.guid, it.title, it.desc).catch(() => false);
      if (!yes) continue;
    }
    // Ada Derana's feed has no times: read the story page (cached per story).
    const ms = it.pubMs ?? (await articleTimeCached(it.link).catch(() => null));
    if (ms == null || ms < since || ms - now > 3_600_000) continue;
    seen.add(k);
    out.push({
      id: k.slice(0, 48) + ms.toString(36),
      title: decodeEntities(it.title),
      url: it.link,
      source: it.outlet,
      publishedAt: ms,
      tag: v.tag,
      snippet: snippetOf(it.desc, it.title),
      ...namesIn(it.title, it.desc),
    });
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt);
  return { items: out.slice(0, MAX_ITEMS), errors: feeds.errors, fetchedAt: now };
}

/** Cached 10 minutes. Throws only when no feed can be read. */
export const getNews = unstable_cache(build, ["news-board-v1"], { revalidate: 600 });

/** For page render: never throws, never waits more than 1.5 s (a slow refresh finishes in the background). */
export async function getNewsSoon(ms = 1500): Promise<NewsData | null> {
  return timeBox(getNews(), ms);
}

// ---------------------------------------------------------------- selections

export const withinHours = (items: NewsItem[], hours: number, now = Date.now()) => items.filter((i) => now - i.publishedAt <= hours * 3_600_000);

/** Home card: the newest items in the last 24 h, widened to 48 h when there are fewer than 3. */
export function homeNews(items: NewsItem[], now = Date.now(), limit = 5): NewsItem[] {
  const day = withinHours(items, 24, now);
  return (day.length >= 3 ? day : withinHours(items, 48, now)).slice(0, limit);
}

export const newsForRiver = (items: NewsItem[], basin: string) => items.filter((i) => i.rivers.includes(basin.trim()));
export function newsForReservoir(items: NewsItem[], catalogueId: string | null, name?: string) {
  const n = name ? norm(name) : "";
  return items.filter((i) => (catalogueId && i.reservoirs.includes(catalogueId)) || (n.length >= 5 && hasName(norm(i.title), n)));
}

/** Date.now() behind a function so server components can call it (react-hooks/purity). */
export const nowMs = () => Date.now();
