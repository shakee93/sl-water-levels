import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHistory, historyPath } from "@/lib/history";
import { basinSlug, stationSlug } from "@/lib/slug";
import { fmtRange, scopeIndices, summarize } from "@/lib/historyStats";
import { HistoryUnavailable, HistoryView } from "../../HistoryView";

export const revalidate = 3600;

const SITE = "https://sl-water-levels.vercel.app";

async function resolve(river: string, gauge: string) {
  const data = await getHistory();
  const station = data?.stations.find((s) => basinSlug(s.basin) === river && stationSlug(s.station) === gauge) ?? null;
  return { data, station };
}

export async function generateStaticParams() {
  const data = await getHistory();
  return (data?.stations ?? []).map((s) => ({ river: basinSlug(s.basin), station: stationSlug(s.station) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ river: string; station: string }>;
}): Promise<Metadata> {
  const { river, station: gauge } = await params;
  const { data, station } = await resolve(river, gauge);
  if (!data || !station) return {};
  const sum = summarize(data, scopeIndices(data, { kind: "station", station: station.station }));
  // "Hanwella flood history" is how people search; the river disambiguates.
  const title = `${station.name} flood history (${station.basin}): past flood dates`;
  const description = [
    sum.season && `Flood warnings at ${station.name} come ${sum.season}.`,
    `Flooded on ${sum.gaugeFloodDays} days since Nov 2025.`,
    sum.latest && `Latest: ${fmtRange(sum.latest.from, sum.latest.to)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const path = historyPath(station.basin, station.station);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: `${SITE}${path}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function StationHistoryPage({ params }: { params: Promise<{ river: string; station: string }> }) {
  const { river, station: gauge } = await params;
  const { data, station } = await resolve(river, gauge);
  if (!data) return <HistoryUnavailable />;
  if (!station) notFound();
  return <HistoryView data={data} scope={{ kind: "station", station: station.station }} />;
}
