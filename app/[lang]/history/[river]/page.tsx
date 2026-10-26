import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHistory, historyPath } from "@/lib/history";
import { basinSlug } from "@/lib/slug";
import { peakGauges, peakGaugesPhrase, scopeIndices, summarize } from "@/lib/historyStats";
import { HistoryUnavailable, HistoryView } from "@/app/history/HistoryView";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { dayRange, riverName } from "@/lib/i18n/format";

export const revalidate = 3600;

import { SITE } from "@/lib/seo";

async function resolve(river: string) {
  const data = await getHistory();
  const basin = data?.stations.find((s) => basinSlug(s.basin) === river)?.basin ?? null;
  return { data, basin };
}

// Built on first visit, not at deploy: pre-building every gauge in three languages on each deploy queried the data
// sources for pages nobody had asked for (26 Oct 2026). ISR (revalidate below) then keeps each one for its window.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; river: string }> }): Promise<Metadata> {
  const { lang, river } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);
  const { data, basin } = await resolve(river);
  if (!data || !basin) return {};
  const idx = scopeIndices(data, { kind: "basin", basin });
  const sum = summarize(data, idx, t);
  const rn = riverName(basin, lang);
  const title = t("hist.riverTitle", { river: rn });
  const description = [
    sum.season && t("hist.riverSeason", { river: rn, season: sum.season }),
    sum.latest && t("hist.riverLatest", { range: dayRange(sum.latest.from, sum.latest.to, t), where: peakGaugesPhrase(peakGauges(data, idx, sum.latest), t) }),
    t("hist.riverEvery"),
  ]
    .filter(Boolean)
    .join(" ");
  const alternates = pageAlternates(lang, historyPath(basin));
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RiverHistoryPage({ params }: { params: Promise<{ lang: string; river: string }> }) {
  const { lang, river } = await params;
  if (!isLocale(lang)) notFound();
  const { data, basin } = await resolve(river);
  if (!data) return <HistoryUnavailable lang={lang} />;
  if (!basin) notFound();
  return <HistoryView lang={lang} data={data} scope={{ kind: "basin", basin }} />;
}
