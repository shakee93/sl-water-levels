import { stationDisplayName } from "@/lib/displayName";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
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
import { StationPicker } from "@/app/StationPicker";
import { StationFinder } from "@/app/StationFinder";
import { StationCard } from "@/app/StationCard";
import { StationCardSkeleton, VerdictSkeleton } from "@/app/StationCardSkeleton";
import { StationHelpCard } from "@/app/StationHelpCard";
import { BasinFlow } from "@/app/BasinFlow";
import { BasinDams } from "@/app/BasinDams";
import { Forecast } from "@/app/Forecast";
import { FloodHistoryCard } from "@/app/history/FloodHistoryCard";
import { Anomaly } from "@/app/Anomaly";
import { ReleaseCard } from "@/app/ReleaseCard";
import { RiverReservoirs } from "@/app/reservoirs/RiverReservoirs";
import { StationNearby } from "@/app/StationNearby";

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

/** "Hanwella Kelani Ganga water level": the river is in the heading because people search town + river. */
function heading(t: TFn, station: string, basin: string | null | undefined, lang: Locale): string {
  const name = stationDisplayName(station);
  const rv = (basin ?? "").trim();
  return rv ? t("station.heading", { name, river: riverName(rv, lang) }) : t("station.headingNoRiver", { name });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; river: string; station: string }>;
}): Promise<Metadata> {
  const { lang, river, station: stationParam } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);

  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    return {};
  }

  const resolved = resolveStation(stations, river, stationParam);
  if (!resolved) return {};

  const alternates = pageAlternates(lang, `/${river}/${stationParam}`);
  const canonical = alternates.canonical;

  try {
    const data = await fetchStationData(resolved.station, 1);
    const level = data.latest?.water_level;
    const status = statusFor(level ?? null, data.thresholds, data.latest?.ts);
    const basin = riverName(data.basin || resolved.basin || "Sri Lanka", lang);

    const name = stationDisplayName(resolved.station);
    const head = heading(t, resolved.station, data.basin || resolved.basin, lang);
    // No live number in the title: it goes stale in search snippets.
    const titleBits = t("station.metaTitle", { heading: head });
    const tierKey = `tier.${status.tier}` as "tier.alert";
    const descBits =
      level != null
        ? t("station.metaDescLevel", {
            name,
            basin,
            level: level.toFixed(2),
            status: t(tierKey),
            alert: data.thresholds.alert ?? "—",
            minor: data.thresholds.minor ?? "—",
            major: data.thresholds.major ?? "—",
          })
        : t("station.metaDescNone", { name, basin });

    return {
      title: titleBits,
      description: descBits,
      alternates,
      openGraph: {
        title: t("station.ogTitle", { heading: head }),
        description: descBits,
        url: `${SITE}${canonical}`,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: t("station.ogTitle", { heading: head }),
        description: descBits,
      },
    };
  } catch {
    return {
      title: t("station.metaTitle", { heading: heading(t, resolved.station, resolved.basin, lang) }),
      alternates,
    };
  }
}

// No searchParams / cookies here: that would make the page dynamic (no-store). The chart range
// (?days) is read on the client, so this route stays ISR-cached (revalidate = 60).
export default async function StationPage({
  params,
}: {
  params: Promise<{ lang: string; river: string; station: string }>;
}) {
  const { lang: rawLang, river, station: stationParam } = await params;
  if (!isLocale(rawLang)) notFound();
  const lang: Locale = rawLang;
  const { t, p } = getI18n(lang);

  let stations: Station[] = [];
  let stationsError: string | null = null;
  try {
    stations = await fetchStations();
  } catch (err) {
    stationsError = err instanceof Error ? err.message : t("err.stationsTitle");
  }

  const resolved = stationsError
    ? null
    : resolveStation(stations, river, stationParam);
  if (!stationsError && !resolved) notFound();

  const station = resolved?.station ?? "";
  const basin = resolved?.basin ?? "";

  const canonical = p(`/${river}/${stationParam}`);

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
                    { "@type": "ListItem", position: 1, name: t("crumb.allBasins"), item: SITE + p("/") },
                    { "@type": "ListItem", position: 2, name: riverName(basin, lang), item: `${SITE}${p(basinPath(basin))}` },
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
              __html: JSON.stringify(datasetLd(resolved.station, basin, stations, canonical, lang)),
            }}
          />
        )}

        {resolved && (
          <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">
              {t("crumb.allBasins")}
            </Link>{" "}
            <span aria-hidden>›</span>{" "}
            <Link href={p(basinPath(basin))} className="hover:underline inline-block py-3 -my-3">
              {riverName(basin, lang)}
            </Link>{" "}
            <span aria-hidden>›</span>{" "}
            <span className="text-slate-700 dark:text-slate-300">{station ? stationDisplayName(station) : ""}</span>
          </nav>
        )}

        <header className="mb-4 sm:mb-5">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">
            {station ? heading(t, station, basin, lang) : t("station.fallbackHeading")}
          </h1>
        </header>

        {stationsError ? (
          <ErrorBanner t={t} title={t("err.stationsTitle")} detail={stationsError} />
        ) : (
          <>
            <Suspense key={`release-${station}`} fallback={null}><ReleaseCard lang={lang} station={station} basin={basin} /></Suspense>

            <Suspense key={`forecast-${station}`} fallback={<VerdictSkeleton />}>
              <Forecast lang={lang} basin={basin} selectedStation={station} />
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
              <Anomaly lang={lang} basin={basin} selectedStation={station} />
            </Suspense>

            <Suspense key={`chart-${station}`} fallback={<StationCardSkeleton />}>
              <StationCard lang={lang} stationName={station} />
            </Suspense>

            <Suspense key={`history-${station}`} fallback={null}>
              <FloodHistoryCard lang={lang} basin={basin} station={station} />
            </Suspense>

            <section className="mt-6">
              <label htmlFor="station-picker" className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5 font-medium">
                {t("station.other")}
              </label>
              <StationPicker stations={stations} current={station} id="station-picker" />
              <div className="mt-3">
                <StationFinder stations={stations} />
              </div>
            </section>

            <Suspense key={`flow-${station}`} fallback={null}>
              <BasinFlow lang={lang} basin={basin} selectedStation={station} />
            </Suspense>

            <Suspense key={`reservoirs-${station}`} fallback={null}><RiverReservoirs lang={lang} station={station} /></Suspense>

            <Suspense key={`dams-${station}`} fallback={null}>
              <BasinDams basin={basin} lang={lang} />
            </Suspense>

            <Suspense key={`helplink-${station}`} fallback={null}>
              <StationHelpCard lang={lang} basin={basin} station={station} variant="link" />
            </Suspense>
          </>
        )}
      </div>
    </main>
  );
}

const ARCGIS_GAUGES =
  "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0/query";

function datasetLd(station: string, basin: string, stations: Station[], canonical: string, lang: Locale) {
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
    inLanguage: lang,
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

function ErrorBanner({ t, title, detail }: { t: TFn; title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm">
      <div className="font-semibold text-red-800 dark:text-red-300">{title}</div>
      <div className="mt-1 text-red-700 dark:text-red-400 font-mono text-xs break-all">
        {detail}
      </div>
      <p className="mt-2 text-red-700/80 dark:text-red-400/80">
        {t("err.stationsHelp")}
      </p>
    </div>
  );
}
