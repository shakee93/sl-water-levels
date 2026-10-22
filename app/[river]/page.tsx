import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { fetchBasinSnapshot, fetchStations, type Station, type Tier } from "@/lib/arcgis";
import { stationDisplayName } from "@/lib/displayName";
import { orderStations } from "@/lib/basinOrder";
import { basinSlug, resolveBasin, stationPath } from "@/lib/slug";
import { BasinFlow } from "../BasinFlow";
import { BasinDams } from "../BasinDams";

export const revalidate = 300;

const SITE = "https://sl-water-levels.vercel.app";

const TIER_RANK: Record<Tier, number> = {
  major: 6, minor: 5, alert: 4, watch: 3, normal: 2, none: 1, stale: 0,
};
const TIER_PHRASE: Record<Tier, string> = {
  major: "major flood level",
  minor: "minor flood level",
  alert: "alert level",
  watch: "approaching alert level",
  normal: "normal",
  none: "no flood levels published",
  stale: "no recent readings",
};

/** Worst current tier across a basin's gauges, as a short phrase; null if unknown. */
async function worstStatus(basin: string): Promise<string | null> {
  try {
    const snap = await fetchBasinSnapshot(basin);
    if (!snap.length) return null;
    const worst = snap.reduce((a, b) => (TIER_RANK[b.tier] > TIER_RANK[a.tier] ? b : a));
    return TIER_PHRASE[worst.tier];
  } catch {
    return null;
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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

  const onBasin = orderStations(
    basin,
    stations.filter((s) => s.basin === basin),
  );
  const names = onBasin.map((s) => stationDisplayName(s.station));
  const worst = await worstStatus(basin);
  const title = `${basin} Water Level Today – Live Gauges & Flood Alerts`;
  const description = `${basin} water level today: ${joinNames(names)} gauges, upstream to downstream.${
    worst ? ` Now: ${worst}.` : ""
  } Flood thresholds and forecast, updated hourly.`;

  return {
    // absolute: the layout template would push this past ~60 characters.
    title: { absolute: title },
    description,
    alternates: { canonical: `/${river}` },
    openGraph: {
      title,
      description,
      url: `${SITE}/${river}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
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
  let outage = false;
  try {
    stations = await fetchStations();
  } catch {
    outage = true;
  }

  if (outage) {
    // Don't 404 on an upstream outage: the URL is valid, the data is not.
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            <Link href="/" className="hover:underline">
              All basins
            </Link>
          </nav>
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <p>
              The Department of Irrigation gauge feed is not responding right now, so live
              readings for this river cannot be shown. Please try again in a few minutes.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const basin = resolveBasin(stations, river);
  if (!basin) notFound();

  const onBasin = orderStations(
    basin,
    stations.filter((s) => s.basin === basin),
  );
  const names = onBasin.map((s) => stationDisplayName(s.station));

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
                name: stationDisplayName(s.station),
                url: `${SITE}${stationPath(s.basin, s.station)}`,
                ...(Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
                  ? {
                      item: {
                        "@type": "Place",
                        name: `${stationDisplayName(s.station)} river gauge`,
                        geo: {
                          "@type": "GeoCoordinates",
                          latitude: s.latitude,
                          longitude: s.longitude,
                        },
                      },
                    }
                  : {}),
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
            {onBasin.length} river gauges on the {basin} basin, upstream → downstream: {joinNames(names)}.
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
                    {stationDisplayName(s.station)}
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
