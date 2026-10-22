import { stationDisplayName, stationHeading } from "@/lib/displayName";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  fetchStations,
  fetchStationData,
  statusFor,
  type Station,
} from "@/lib/arcgis";
import { basinPath, basinSlug, resolveStation, stationPath, stationSlug } from "@/lib/slug";
import { StationPicker } from "../../StationPicker";
import { StationFinder } from "../../StationFinder";
import { StationCard } from "../../StationCard";
import { StationCardSkeleton, VerdictSkeleton } from "../../StationCardSkeleton";
import { StationHelpCard } from "../../StationHelpCard";
import { BasinFlow } from "../../BasinFlow";
import { BasinDams } from "../../BasinDams";
import { Forecast } from "../../Forecast";
import { Anomaly } from "../../Anomaly";
import { StationNearby } from "../../StationNearby";

export const revalidate = 60;

const SITE = "https://sl-water-levels.vercel.app";

export async function generateStaticParams() {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    return [];
  }
  return stations.map((s) => ({
    river: basinSlug(s.basin),
    station: stationSlug(s.station),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ river: string; station: string }>;
}): Promise<Metadata> {
  const { river, station: stationParam } = await params;

  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    return {};
  }

  const resolved = resolveStation(stations, river, stationParam);
  if (!resolved) return {};

  const canonical = `/${river}/${stationParam}`;

  try {
    const data = await fetchStationData(resolved.station, 1);
    const level = data.latest?.water_level;
    const status = statusFor(level ?? null, data.thresholds, data.latest?.ts);
    const basin = data.basin || resolved.basin || "Sri Lanka";

    const name = stationDisplayName(resolved.station);
    const heading = stationHeading(resolved.station, basin);
    // No live number in the title: it goes stale in search snippets.
    const titleBits = `${heading} today (live)`;
    const descBits =
      level != null
        ? `Live reading at ${name} on ${basin}: ${level.toFixed(2)} — ${status.label}. Alert ${data.thresholds.alert ?? "—"}, minor flood ${data.thresholds.minor ?? "—"}, major flood ${data.thresholds.major ?? "—"}. Includes next-hour forecast and upstream basin view.`
        : `${name} river gauge on ${basin}, Sri Lanka. Live water-level readings from the Department of Irrigation with alert / minor-flood / major-flood thresholds and next-hour forecast.`;

    return {
      title: titleBits,
      description: descBits,
      alternates: { canonical },
      openGraph: {
        title: `${heading} — Sri Lanka Water Levels`,
        description: descBits,
        url: `${SITE}${canonical}`,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: `${heading} — Sri Lanka Water Levels`,
        description: descBits,
      },
    };
  } catch {
    return {
      title: `${stationHeading(resolved.station, resolved.basin)} today (live)`,
      alternates: { canonical },
    };
  }
}

// No searchParams / cookies here: that would make the page dynamic (no-store). The chart range
// (?days) is read on the client, so this route stays ISR-cached (revalidate = 60).
export default async function StationPage({
  params,
}: {
  params: Promise<{ river: string; station: string }>;
}) {
  const { river, station: stationParam } = await params;

  let stations: Station[] = [];
  let stationsError: string | null = null;
  try {
    stations = await fetchStations();
  } catch (err) {
    stationsError = err instanceof Error ? err.message : "Could not load stations";
  }

  const resolved = stationsError
    ? null
    : resolveStation(stations, river, stationParam);
  if (!stationsError && !resolved) notFound();

  const station = resolved?.station ?? "";
  const basin = resolved?.basin ?? "";

  const canonical = `/${river}/${stationParam}`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {resolved && (
          <>
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "BreadcrumbList",
                  itemListElement: [
                    { "@type": "ListItem", position: 1, name: "All basins", item: SITE + "/" },
                    { "@type": "ListItem", position: 2, name: basin, item: `${SITE}${basinPath(basin)}` },
                    { "@type": "ListItem", position: 3, name: station, item: `${SITE}${canonical}` },
                  ],
                }),
              }}
            />
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "Place",
                  name: `${station} river gauge`,
                  containedInPlace: {
                    "@type": "Place",
                    name: basin || "Sri Lanka",
                  },
                  url: `${SITE}${canonical}`,
                }),
              }}
            />
          </>
        )}

        {resolved && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(datasetLd(resolved.station, basin, stations, canonical)),
            }}
          />
        )}

        {resolved && (
          <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            <Link href="/" className="hover:underline">
              All basins
            </Link>{" "}
            <span aria-hidden>›</span>{" "}
            <Link href={basinPath(basin)} className="hover:underline">
              {basin}
            </Link>{" "}
            <span aria-hidden>›</span>{" "}
            <span className="text-slate-700 dark:text-slate-300">{station ? stationDisplayName(station) : ""}</span>
          </nav>
        )}

        <header className="mb-4 sm:mb-5">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">
            {station ? stationHeading(station, basin) : "Station water level"}
          </h1>
        </header>

        {stationsError ? (
          <ErrorBanner title="Could not load stations" detail={stationsError} />
        ) : (
          <>
            <Suspense key={`forecast-${station}`} fallback={<VerdictSkeleton />}>
              <Forecast basin={basin} selectedStation={station} />
            </Suspense>

            <StationNearby
              current={station}
              gauges={stations.map((s) => ({
                station: s.station,
                basin: s.basin.trim(),
                latitude: s.latitude,
                longitude: s.longitude,
                href: stationPath(s.basin, s.station),
              }))}
            />

            <Suspense key={`anomaly-${station}`} fallback={null}>
              <Anomaly basin={basin} selectedStation={station} />
            </Suspense>

            <Suspense key={`chart-${station}`} fallback={<StationCardSkeleton />}>
              <StationCard stationName={station} />
            </Suspense>

            <section className="mt-6">
              <label htmlFor="station-picker" className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5 font-medium">
                Other stations
              </label>
              <StationPicker stations={stations} current={station} id="station-picker" />
              <div className="mt-3">
                <StationFinder stations={stations} />
              </div>
            </section>

            <Suspense key={`flow-${station}`} fallback={null}>
              <BasinFlow basin={basin} selectedStation={station} />
            </Suspense>

            <Suspense key={`dams-${station}`} fallback={null}>
              <BasinDams basin={basin} />
            </Suspense>

            <Suspense key={`helplink-${station}`} fallback={null}>
              <StationHelpCard basin={basin} station={station} variant="link" />
            </Suspense>
          </>
        )}
      </div>
    </main>
  );
}

const ARCGIS_GAUGES =
  "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0/query";

function datasetLd(station: string, basin: string, stations: Station[], canonical: string) {
  const s = stations.find((x) => x.station === station);
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const name = stationDisplayName(station);
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${name} river gauge water level (${basin.trim()})`,
    description: `Hourly water-level readings at the ${name} gauge on the ${basin.trim()}, Sri Lanka, with alert, minor flood and major flood levels. Last 7 days.`,
    url: `${SITE}${canonical}`,
    isAccessibleForFree: true,
    creator: {
      "@type": "GovernmentOrganization",
      name: "Department of Irrigation, Sri Lanka",
      url: "https://www.irrigation.gov.lk",
    },
    temporalCoverage: `${day(start)}/${day(end)}`,
    ...(s && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
      ? {
          spatialCoverage: {
            "@type": "Place",
            name: `${name}, ${basin.trim()}`,
            geo: { "@type": "GeoCoordinates", latitude: s.latitude, longitude: s.longitude },
          },
        }
      : {}),
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: `${ARCGIS_GAUGES}?where=${encodeURIComponent(`gauge='${station}'`)}&outFields=*&orderByFields=CreationDate+DESC&f=json`,
    },
  };
}

function ErrorBanner({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm">
      <div className="font-semibold text-red-800 dark:text-red-300">{title}</div>
      <div className="mt-1 text-red-700 dark:text-red-400 font-mono text-xs break-all">
        {detail}
      </div>
      <p className="mt-2 text-red-700/80 dark:text-red-400/80">
        The source feature service may be rate-limited or temporarily down. Refresh in a minute.
      </p>
    </div>
  );
}
