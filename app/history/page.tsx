import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { getHistory, historyPath } from "@/lib/history";
import { HistoryUnavailable, HistoryView } from "./HistoryView";

// history.json on the data branch is rebuilt twice a day; re-render hourly.
export const revalidate = 3600;

const SITE = "https://sl-water-levels.vercel.app";

export const metadata: Metadata = {
  title: "Sri Lanka flood history: when do the rivers flood?",
  description:
    "Every day since 2022, years stacked so the monsoon seasons line up: which river gauges hit alert, minor-flood and major-flood levels, when, and the biggest floods.",
  alternates: { canonical: "/history" },
  openGraph: {
    title: "Sri Lanka flood history",
    description: "Years of river flood warnings stacked by season, river by river.",
    url: `${SITE}/history`,
    type: "website",
  },
};

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  // The first version used ?scope=b:<basin> / s:<gauge>; keep those links working.
  const { scope } = await searchParams;
  const data = await getHistory();
  if (!data) return <HistoryUnavailable />;
  if (scope?.startsWith("b:")) {
    const basin = data.stations.find((s) => s.basin === scope.slice(2))?.basin;
    if (basin) permanentRedirect(historyPath(basin));
  }
  if (scope?.startsWith("s:")) {
    const s = data.stations.find((x) => x.station === scope.slice(2));
    if (s) permanentRedirect(historyPath(s.basin, s.station));
  }
  return <HistoryView data={data} scope={{ kind: "all" }} />;
}
