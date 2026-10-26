import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHistory, historyPath } from "@/lib/history";
import { basinSlug, stationSlug } from "@/lib/slug";
import { scopeIndices, summarize } from "@/lib/historyStats";
import { HistoryUnavailable, HistoryView } from "@/app/history/HistoryView";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { dayRange, riverName } from "@/lib/i18n/format";

export const revalidate = 3600;

import { SITE } from "@/lib/seo";

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
  params: Promise<{ lang: string; river: string; station: string }>;
}): Promise<Metadata> {
  const { lang, river, station: gauge } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);
  const { data, station } = await resolve(river, gauge);
  if (!data || !station) return {};
  const sum = summarize(data, scopeIndices(data, { kind: "station", station: station.station }), t);
  // "Hanwella flood history" is how people search; the river disambiguates.
  const title = t("hist.stationTitle", { name: station.name, river: riverName(station.basin, lang) });
  const description = [
    sum.season && t("hist.stationSeason", { name: station.name, season: sum.season }),
    t("hist.stationDays", { n: sum.gaugeFloodDays }),
    sum.latest && t("hist.stationLatest", { range: dayRange(sum.latest.from, sum.latest.to, t) }),
  ]
    .filter(Boolean)
    .join(" ");
  const alternates = pageAlternates(lang, historyPath(station.basin, station.station));
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function StationHistoryPage({ params }: { params: Promise<{ lang: string; river: string; station: string }> }) {
  const { lang, river, station: gauge } = await params;
  if (!isLocale(lang)) notFound();
  const { data, station } = await resolve(river, gauge);
  if (!data) return <HistoryUnavailable lang={lang} />;
  if (!station) notFound();
  return <HistoryView lang={lang} data={data} scope={{ kind: "station", station: station.station }} />;
}
