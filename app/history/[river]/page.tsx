import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHistory, historyPath } from "@/lib/history";
import { basinSlug } from "@/lib/slug";
import { fmtRange, peakGauges, peakGaugesPhrase, scopeIndices, summarize } from "@/lib/historyStats";
import { HistoryUnavailable, HistoryView } from "../HistoryView";

export const revalidate = 3600;

const SITE = "https://sl-water-levels.vercel.app";

async function resolve(river: string) {
  const data = await getHistory();
  const basin = data?.stations.find((s) => basinSlug(s.basin) === river)?.basin ?? null;
  return { data, basin };
}

export async function generateStaticParams() {
  const data = await getHistory();
  return [...new Set(data?.stations.map((s) => basinSlug(s.basin)) ?? [])].map((river) => ({ river }));
}

export async function generateMetadata({ params }: { params: Promise<{ river: string }> }): Promise<Metadata> {
  const { river } = await params;
  const { data, basin } = await resolve(river);
  if (!data || !basin) return {};
  const idx = scopeIndices(data, { kind: "basin", basin });
  const sum = summarize(data, idx);
  const title = `${basin} flood history: when it floods & past flood dates`;
  const description = [
    sum.season && `${basin} flood warnings come ${sum.season}.`,
    sum.latest && `Latest flood: ${fmtRange(sum.latest.from, sum.latest.to)} at ${peakGaugesPhrase(peakGauges(data, idx, sum.latest))}.`,
    "Every day since 2022, gauge by gauge.",
  ]
    .filter(Boolean)
    .join(" ");
  const path = historyPath(basin);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: `${SITE}${path}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RiverHistoryPage({ params }: { params: Promise<{ river: string }> }) {
  const { river } = await params;
  const { data, basin } = await resolve(river);
  if (!data) return <HistoryUnavailable />;
  if (!basin) notFound();
  return <HistoryView data={data} scope={{ kind: "basin", basin }} />;
}
