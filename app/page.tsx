import { Suspense } from "react";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { fetchStations, fetchStationData, statusFor, type Station } from "@/lib/arcgis";
import { StationPicker } from "./StationPicker";
import { StationFinder } from "./StationFinder";
import { StationCard } from "./StationCard";
import { StationCardSkeleton } from "./StationCardSkeleton";
import { BasinFlow } from "./BasinFlow";
import { Forecast } from "./Forecast";
import { Anomaly } from "./Anomaly";

export const revalidate = 60;

const DEFAULT_STATION = "Nagalagam Street";
const STATION_COOKIE = "sl_station";

const SITE = "https://sl-water-levels.vercel.app";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ station?: string }>;
}): Promise<Metadata> {
  const { station } = await searchParams;
  if (!station) {
    return {
      alternates: { canonical: "/" },
    };
  }

  try {
    const data = await fetchStationData(station, 1);
    const level = data.latest?.water_level;
    const status = statusFor(level ?? null, data.thresholds);
    const basin = data.basin || "Sri Lanka";

    const titleBits = level != null ? `${station} water level (${level.toFixed(2)})` : `${station} water level`;
    const descBits = level != null
      ? `Live reading at ${station} on ${basin}: ${level.toFixed(2)} — ${status.label}. Alert ${data.thresholds.alert ?? "—"}, minor flood ${data.thresholds.minor ?? "—"}, major flood ${data.thresholds.major ?? "—"}. Includes next-hour forecast and upstream basin view.`
      : `${station} river gauge on ${basin}, Sri Lanka. Live water-level readings from the Department of Irrigation with alert / minor-flood / major-flood thresholds and next-hour forecast.`;

    const canonical = `/?station=${encodeURIComponent(station)}`;

    return {
      title: titleBits,
      description: descBits,
      alternates: { canonical },
      openGraph: {
        title: `${station} — Sri Lanka Water Levels`,
        description: descBits,
        url: `${SITE}${canonical}`,
        type: "website",
      },
      twitter: {
        card: "summary",
        title: `${station} — Sri Lanka Water Levels`,
        description: descBits,
      },
    };
  } catch {
    return {
      title: `${station} water level`,
      alternates: { canonical: `/?station=${encodeURIComponent(station)}` },
    };
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ station?: string }>;
}) {
  const { station: stationParam } = await searchParams;
  const cookieStore = await cookies();
  const lastStation = cookieStore.get(STATION_COOKIE)?.value;

  let stations: Station[] = [];
  let stationsError: string | null = null;
  try {
    stations = await fetchStations();
  } catch (err) {
    stationsError = err instanceof Error ? err.message : "Could not load stations";
  }

  const candidate = stationParam ?? lastStation ?? DEFAULT_STATION;
  const station =
    stations.find((s) => s.station === candidate)?.station ??
    stations.find((s) => s.station === DEFAULT_STATION)?.station ??
    stations[0]?.station ??
    DEFAULT_STATION;

  const basinCount = new Set(stations.map((s) => s.basin)).size;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Sri Lanka Water Levels",
              url: SITE,
              description: "Live Sri Lanka river-gauge readings + next-hour flood forecast.",
              potentialAction: {
                "@type": "SearchAction",
                target: `${SITE}/?station={station}`,
                "query-input": "required name=station",
              },
            }),
          }}
        />
        
        <header className="mb-6 sm:mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
            Realtime
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            Sri Lanka Water Levels
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-prose">
            River-gauge readings from the Department of Irrigation, updated every minute.
          </p>
        </header>

        {stationsError ? (
          <ErrorBanner
            title="Could not load stations"
            detail={stationsError}
          />
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
              <div className="mt-3">
                <StationFinder stations={stations} />
              </div>
            </section>

            <Suspense key={`anomaly-${station}`} fallback={null}>
              <Anomaly
                basin={stations.find((s) => s.station === station)?.basin ?? ""}
                selectedStation={station}
              />
            </Suspense>

            <Suspense key={station} fallback={<StationCardSkeleton />}>
              <StationCard stationName={station} />
            </Suspense>

            <Suspense key={`forecast-${station}`} fallback={null}>
              <Forecast
                basin={stations.find((s) => s.station === station)?.basin ?? ""}
                selectedStation={station}
              />
            </Suspense>

            <Suspense key={`flow-${station}`} fallback={null}>
              <BasinFlow
                basin={stations.find((s) => s.station === station)?.basin ?? ""}
                selectedStation={station}
              />
            </Suspense>
          </>
        )}

        <footer className="mt-8 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Source:{" "}
          <a
            className="underline decoration-slate-400/40 hover:text-slate-700 dark:hover:text-slate-200"
            href="https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0"
            target="_blank"
            rel="noreferrer"
          >
            Sri Lanka Department of Irrigation ArcGIS feature service
          </a>
          .
        </footer>
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
