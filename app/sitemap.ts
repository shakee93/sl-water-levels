import type { MetadataRoute } from "next";
import { fetchStations, type Station } from "@/lib/arcgis";

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
  const stationEntries: MetadataRoute.Sitemap = stations.map((s) => ({
    url: `${SITE}/?station=${encodeURIComponent(s.station)}`,
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
    ...stationEntries,
  ];
}
