import type { MetadataRoute } from "next";
import { getNational } from "@/lib/arcgis";
import { getHistory, historyPath } from "@/lib/history";
import { getReservoirs } from "@/lib/reservoirData";
import { PLACES } from "@/lib/places";
import { CONTENT_UPDATED } from "@/lib/seo";
import { WF_MODIFIED, WF_PATH } from "@/lib/research";
import { LOCALES, localePath, type Locale } from "@/lib/i18n/config";

import { SITE } from "@/lib/seo";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // No fallback on purpose: if the feed is down this throws, so an empty sitemap is never cached for an hour and the last
  // good one keeps being served. It does retry: during a build every page prerenders at once and ArcGIS answers
  // "Too many requests" (26 Oct 2026 a deploy failed on exactly that), which clears within seconds.
  let stations: Awaited<ReturnType<typeof getNational>> | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      stations = await getNational();
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  // Fails soft: the history archive is a separate source and optional here.
  const history = await getHistory();

  const stamp = (ts: number | null | undefined) =>
    ts != null ? { lastModified: new Date(ts) } : {};

  const basinLatest = new Map<string, { href: string; ts: number | null; count: number }>();
  let newest: number | null = null;
  for (const s of stations) {
    const ts = s.latest?.ts ?? null;
    if (ts != null && (newest == null || ts > newest)) newest = ts;
    const cur = basinLatest.get(s.basin);
    if (!cur) basinLatest.set(s.basin, { href: s.basinHref, ts, count: 1 });
    else {
      cur.count++;
      if (ts != null && (cur.ts == null || ts > cur.ts)) cur.ts = ts;
    }
  }

  // Every URL is listed once per locale (English unprefixed, /si, /ta), each carrying the
  // full hreflang set, so the three versions point at each other.
  const abs = (l: Locale, path: string) => {
    const p = localePath(l, path);
    return SITE + (p === "/" ? "" : p);
  };
  const entry = (path: string, ts?: number | null) =>
    LOCALES.map((l) => ({
      url: abs(l, path),
      ...stamp(ts),
      alternates: {
        languages: {
          en: abs("en", path),
          si: abs("si", path),
          ta: abs("ta", path),
          "x-default": abs("en", path),
        },
      },
    }));

  // Reservoir pages: lastModified is the source date. Fails soft (the sheet is a separate source).
  const rsv = await getReservoirs().catch(() => null);
  const dayMs = (d: string | null) => (d ? Date.parse(`${d}T09:00:00+05:30`) : null);
  const rsvDay = [rsv?.sheetDate, rsv?.wmsDate].filter((d): d is string => !!d).sort().pop() ?? null;

  const contentDay = Date.parse(`${CONTENT_UPDATED}T00:00:00+05:30`);

  return [
    ...entry("/", newest),
    ...(rsv ? entry("/reservoirs", dayMs(rsvDay)) : []),
    ...(rsv?.items ?? []).flatMap((r) => entry(`/reservoirs/${r.slug}`, dayMs(r.latestDay))),
    ...entry("/flood", newest),
    // A town page changes when its gauge reports.
    ...PLACES.flatMap((x) => entry(`/flood/${x.slug}`, stations.find((s) => s.station === x.stations[0])?.latest?.ts)),
    // Recent news changes by the hour; the list is fetched live on the page, so no per-item entries.
    ...entry("/colombo-canals", Date.now()),
    // Rain map: satellite rain hour by hour, refreshed every 30 minutes.
    ...entry("/rain", Date.now()),
    ...entry("/news", Date.now()),
    ...entry("/help", contentDay),
    ...entry("/about", contentDay),
    ...entry("/research", Date.parse(`${WF_MODIFIED}T00:00:00+05:30`)),
    ...entry(WF_PATH, Date.parse(`${WF_MODIFIED}T00:00:00+05:30`)),
    // English only: the page is for developers and is not translated.
    { url: `${SITE}/data`, lastModified: new Date(contentDay) },
    ...entry("/history"),
    ...[...new Set(history?.stations.map((s) => s.basin) ?? [])].flatMap((b) => entry(historyPath(b))),
    ...(history?.stations ?? []).flatMap((s) => entry(historyPath(s.basin, s.station))),
    // One-gauge rivers 308 to their station page, so only list multi-gauge rivers.
    ...[...basinLatest.values()].filter((b) => b.count > 1).flatMap((b) => entry(b.href, b.ts)),
    ...stations.flatMap((s) => entry(s.href, s.latest?.ts)),
  ];
}
