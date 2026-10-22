import Link from "next/link";
import type { Metadata } from "next";
import { getHistory } from "@/lib/history";
import { FloodCalendar } from "./FloodCalendar";

// history.json on the data branch is rebuilt twice a day; re-render hourly.
export const revalidate = 3600;

const SITE = "https://sl-water-levels.vercel.app";

export const metadata: Metadata = {
  title: "Flood history: when Sri Lanka's rivers flood",
  description:
    "Every day since 2022, years stacked so the monsoon seasons line up: which river gauges hit alert, minor-flood and major-flood levels, and when.",
  alternates: { canonical: "/history" },
  openGraph: {
    title: "Flood history — Sri Lanka Water Levels",
    description: "Years of river flood warnings stacked by season, gauge by gauge.",
    url: `${SITE}/history`,
    type: "website",
  },
};

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  const data = await getHistory();
  const updated = data
    ? new Date(data.generatedAt).toLocaleString("en-GB", {
        timeZone: "Asia/Colombo",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href="/" className="hover:underline">
            All basins
          </Link>{" "}
          <span aria-hidden>›</span> <span className="text-slate-700 dark:text-slate-300">Flood history</span>
        </nav>

        <header className="mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500" />
            Flood history
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">When do our rivers flood?</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">
            One row per year, stacked so the seasons line up. Below each line is what the Department of
            Irrigation&apos;s gauges actually measured (archived since November 2025). Above it is an estimate
            from modelled river flow, which lets us look back to 2022.
          </p>
          {updated && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Updated {updated} (Sri Lanka time)</p>
          )}
        </header>

        {data ? (
          <FloodCalendar data={data} initialScope={scope} />
        ) : (
          <p className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm">
            The history archive couldn&apos;t be loaded right now. Please try again in a few minutes.
          </p>
        )}

        <section className="mt-12 text-sm text-slate-600 dark:text-slate-400 space-y-2 max-w-prose">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">About this data</h2>
          <p>
            <strong>Measured</strong> days use each gauge&apos;s highest reading that day (Sri Lanka time) against
            its current official alert, minor-flood and major-flood levels. Readings before our own archive began
            come from{" "}
            <a href="https://github.com/nuuuwan/lk_irrigation" className="underline">
              nuuuwan/lk_irrigation
            </a>
            , which has recorded the same feed hourly since 23 Nov 2025.
          </p>
          <p>
            <strong>Modelled</strong> days are not official warnings. They come from GloFAS river-discharge
            estimates (via{" "}
            <a href="https://open-meteo.com/en/docs/flood-api" className="underline">
              Open-Meteo
            </a>
            ) at each gauge&apos;s location. A day counts as alert, minor or major when flow is in the top 3.9%,
            1.6% or 0.55% of 1995–2021 days, which matches how often real gauges hit those levels. They get the
            season and the big events right, but not always the exact day or gauge, especially on small rivers.
          </p>
          <p>
            Raw daily files are public on the{" "}
            <a href="https://github.com/shakee93/sl-water-levels/tree/data" className="underline">
              data branch
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
