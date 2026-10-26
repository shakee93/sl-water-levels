import { getReservoirs } from "@/lib/reservoirData";
import { placeBySlug } from "@/lib/places";
import { basinPath } from "@/lib/slug";
import { riverName, shortStamp } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { nwFor } from "@/lib/i18n/news";
import type { NewsItem } from "@/lib/news";
import type { NewsRowData, NewsRowLabels } from "./NewsRow";

/** Server side: turn news items into plain rows (translated labels, Sri Lanka time, links to our own pages). */
export async function newsRows(items: NewsItem[], lang: Locale, o: { links?: boolean } = {}): Promise<NewsRowData[]> {
  const { t, p } = getI18n(lang);
  const nw = nwFor(lang);
  const withLinks = o.links !== false;
  // Reservoir pages exist for the reservoirs in the daily sheet / Mahaweli report; link only those.
  const rsv = withLinks ? await getReservoirs().catch(() => null) : null;
  const slugById = new Map<string, { slug: string; name: string }>();
  for (const r of rsv?.items ?? []) if (r.catalogueId) slugById.set(r.catalogueId, { slug: r.slug, name: r.name });
  return items.map((i) => {
    const links: NewsRowData["links"] = [];
    if (withLinks) {
      for (const id of i.reservoirs) {
        const r = slugById.get(id);
        if (r) links.push({ label: r.name, href: p(`/reservoirs/${r.slug}`) });
      }
      for (const b of i.rivers) links.push({ label: riverName(b, lang), href: p(basinPath(b)) });
      for (const s of i.towns) {
        const pl = placeBySlug(s);
        if (pl) links.push({ label: pl.name, href: p(`/flood/${pl.slug}`) });
      }
    }
    return {
      id: i.id,
      title: i.title,
      url: i.url,
      source: i.source,
      publishedAt: i.publishedAt,
      tag: i.tag,
      tagLabel: nw(`tag.${i.tag}` as "tag.Rain"),
      snippet: i.snippet,
      when: shortStamp(i.publishedAt, t),
      links: links.slice(0, 4),
    };
  });
}

export const rowLabels = (lang: Locale): NewsRowLabels => {
  const nw = nwFor(lang);
  return { source: nw("source", { src: "{src}" }), newTab: nw("newTab"), related: nw("related") };
};
