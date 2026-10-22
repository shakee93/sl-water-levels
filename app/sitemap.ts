import type { MetadataRoute } from "next";
import { getNational } from "@/lib/arcgis";
import { getHistory, historyPath } from "@/lib/history";

const SITE = "https://sl-water-levels.vercel.app";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // No try/catch on purpose: if the feed is down this throws, so an empty
  // sitemap is never cached for an hour. The last good one keeps being served.
  const stations = await getNational();
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

  return [
    { url: SITE, ...stamp(newest) },
    { url: `${SITE}/help` },
    { url: `${SITE}/about` },
    { url: `${SITE}/history` },
    ...[...new Set(history?.stations.map((s) => s.basin) ?? [])].map((b) => ({ url: `${SITE}${historyPath(b)}` })),
    ...(history?.stations ?? []).map((s) => ({ url: `${SITE}${historyPath(s.basin, s.station)}` })),
    // One-gauge rivers 308 to their station page, so only list multi-gauge rivers.
    ...[...basinLatest.values()].filter((b) => b.count > 1).map((b) => ({ url: `${SITE}${b.href}`, ...stamp(b.ts) })),
    ...stations.map((s) => ({ url: `${SITE}${s.href}`, ...stamp(s.latest?.ts) })),
  ];
}
