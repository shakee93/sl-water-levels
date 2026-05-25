import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { fetchStations, type Station } from "@/lib/arcgis";
import { orderStations } from "@/lib/basinOrder";
import { basinSlug, resolveBasin, stationPath } from "@/lib/slug";
import { BasinFlow } from "../BasinFlow";
import { BasinDams } from "../BasinDams";

export const revalidate = 300;

const SITE = "https://sl-water-levels.vercel.app";

export async function generateStaticParams() {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    return [];
  }
  const slugs = new Set<string>();
  for (const s of stations) {
    const slug = basinSlug(s.basin);
    if (slug) slugs.add(slug);
  }
  return [...slugs].map((river) => ({ river }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ river: string }>;
}): Promise<Metadata> {
  const { river } = await params;

  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    return {};
  }
  const basin = resolveBasin(stations, river);
  if (!basin) return {};

  const onBasin = stations.filter((s) => s.basin === basin);
  const title = `${basin} water levels`;
  const description = `Live water-level readings for every river gauge on the ${basin} basin in Sri Lanka — ${onBasin.length} stations from upstream to downstream, with alert and flood thresholds, next-hour forecast, and connected dams.`;

  return {
    title,
    description,
    alternates: { canonical: `/${river}` },
    openGraph: {
      title: `${basin} — Sri Lanka Water Levels`,
      description,
      url: `${SITE}/${river}`,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${basin} — Sri Lanka Water Levels`,
      description,
    },
  };
}

export default async function BasinPage({
  params,
}: {
  params: Promise<{ river: string }>;
}) {
  const { river } = await params;

  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    notFound();
  }

  const basin = resolveBasin(stations, river);
  if (!basin) notFound();

  const onBasin = orderStations(
    basin,
    stations.filter((s) => s.basin === basin),
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "All basins", item: SITE + "/" },
                { "@type": "ListItem", position: 2, name: basin, item: `${SITE}/${river}` },
              ],
            }),
          }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "ItemList",
              name: `${basin} river gauges`,
              numberOfItems: onBasin.length,
              itemListElement: onBasin.map((s, i) => ({
                "@type": "ListItem",
                position: i + 1,
                name: s.station,
                url: `${SITE}${stationPath(s.basin, s.station)}`,
              })),
            }),
          }}
        />

        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href="/" className="hover:underline">
            All basins
          </Link>{" "}
          <span aria-hidden>›</span> <span className="text-slate-700 dark:text-slate-300">{basin}</span>
        </nav>

        <header className="mb-6 sm:mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
            Basin
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            {basin}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-prose">
            {onBasin.length} river gauges on the {basin} basin, ordered upstream → downstream.
            Tap a station for live readings, thresholds, and a next-hour forecast.
          </p>
        </header>

        <section className="mb-6">
          <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 font-medium">
            Stations on this basin
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {onBasin.map((s) => (
              <li key={`${s.basin}|${s.station}`}>
                <Link
                  href={stationPath(s.basin, s.station)}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 hover:border-sky-400 dark:hover:border-sky-700 transition"
                >
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {s.station}
                  </span>
                  <ArrowRight className="size-3.5 text-slate-400 group-hover:text-sky-500 transition" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <Suspense key={`flow-${basin}`} fallback={null}>
          <BasinFlow basin={basin} selectedStation="" />
        </Suspense>

        <Suspense key={`dams-${basin}`} fallback={null}>
          <BasinDams basin={basin} />
        </Suspense>
      </div>
    </main>
  );
}
