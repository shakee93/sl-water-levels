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
import { basinPath, basinSlug, resolveStation, stationSlug } from "@/lib/slug";
import { DEFAULT_DAYS, parseDays } from "@/lib/range";
import { StationPicker } from "../../StationPicker";
import { RangePicker } from "../../RangePicker";
import { StationFinder } from "../../StationFinder";
import { StationCard } from "../../StationCard";
import { StationCardSkeleton } from "../../StationCardSkeleton";
import { BasinFlow } from "../../BasinFlow";
import { BasinDams } from "../../BasinDams";
import { Forecast } from "../../Forecast";
import { Anomaly } from "../../Anomaly";

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
    const status = statusFor(level ?? null, data.thresholds);
    const basin = data.basin || resolved.basin || "Sri Lanka";

    const titleBits =
      level != null
        ? `${resolved.station} water level (${level.toFixed(2)})`
        : `${resolved.station} water level`;
    const descBits =
      level != null
        ? `Live reading at ${resolved.station} on ${basin}: ${level.toFixed(2)} — ${status.label}. Alert ${data.thresholds.alert ?? "—"}, minor flood ${data.thresholds.minor ?? "—"}, major flood ${data.thresholds.major ?? "—"}. Includes next-hour forecast and upstream basin view.`
        : `${resolved.station} river gauge on ${basin}, Sri Lanka. Live water-level readings from the Department of Irrigation with alert / minor-flood / major-flood thresholds and next-hour forecast.`;

    return {
      title: titleBits,
      description: descBits,
      alternates: { canonical },
      openGraph: {
        title: `${resolved.station} — Sri Lanka Water Levels`,
        description: descBits,
        url: `${SITE}${canonical}`,
        type: "website",
      },
      twitter: {
        card: "summary",
        title: `${resolved.station} — Sri Lanka Water Levels`,
        description: descBits,
      },
    };
  } catch {
    return {
      title: `${resolved.station} water level`,
      alternates: { canonical },
    };
  }
}

export default async function StationPage({
  params,
  searchParams,
}: {
  params: Promise<{ river: string; station: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { river, station: stationParam } = await params;
  const { days: daysParam } = await searchParams;

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

  const days = parseDays(daysParam) ?? DEFAULT_DAYS;

  const basinCount = new Set(stations.map((s) => s.basin)).size;
  const canonical = `/${river}/${stationParam}`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {resolved && (
          <script
            type="application/ld+json"
            // eslint-disable-next-line react/no-danger
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
            <span className="text-slate-700 dark:text-slate-300">{station}</span>
          </nav>
        )}

        <header className="mb-5 sm:mb-7">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
            Realtime · {basin || "Sri Lanka"}
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            {station || "Station"} water level
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-prose">
            Live reading from the Department of Irrigation, refreshed every minute.
            Below: alert / minor-flood / major-flood thresholds, recent history,
            next-hour forecast and the upstream → downstream basin view.
          </p>
        </header>

        {stationsError ? (
          <ErrorBanner title="Could not load stations" detail={stationsError} />
        ) : (
          <>
            <section className="mb-4 sm:mb-6">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 font-medium">
                    Station
                  </label>
                  <StationPicker stations={stations} current={station} />
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 sm:pb-2.5 tabular-nums">
                  {stations.length} stations · {basinCount} basins
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <StationFinder stations={stations} />
                <RangePicker current={days} />
              </div>
            </section>

            <Suspense key={`anomaly-${station}`} fallback={null}>
              <Anomaly basin={basin} selectedStation={station} />
            </Suspense>

            <Suspense key={`${station}-${days}`} fallback={<StationCardSkeleton />}>
              <StationCard stationName={station} days={days} />
            </Suspense>

            <Suspense key={`forecast-${station}`} fallback={null}>
              <Forecast basin={basin} selectedStation={station} />
            </Suspense>

            <Suspense key={`flow-${station}`} fallback={null}>
              <BasinFlow basin={basin} selectedStation={station} />
            </Suspense>

            <Suspense key={`dams-${station}`} fallback={null}>
              <BasinDams basin={basin} />
            </Suspense>
          </>
        )}
      </div>
    </main>
  );
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
