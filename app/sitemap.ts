import type { MetadataRoute } from "next";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath, stationPath } from "@/lib/slug";

const SITE = "https://sl-water-levels.vercel.app";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    /* fall through to empty list */
  }

  const now = new Date();

  const basinSet = new Set<string>();
  for (const s of stations) if (s.basin) basinSet.add(s.basin);

  const basinEntries: MetadataRoute.Sitemap = [...basinSet].map((b) => ({
    url: `${SITE}${basinPath(b)}`,
    lastModified: now,
    changeFrequency: "hourly",
    priority: 0.7,
  }));

  const stationEntries: MetadataRoute.Sitemap = stations.map((s) => ({
    url: `${SITE}${stationPath(s.basin, s.station)}`,
    lastModified: now,
    changeFrequency: "hourly",
    priority: 0.8,
  }));

  return [
    {
      url: SITE,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1.0,
    },
    ...basinEntries,
    ...stationEntries,
  ];
}
