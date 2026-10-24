import { stationDisplayName } from "@/lib/displayName";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AnswerLine, JsonLd } from "@/app/Answer";
import { NextHourFaq, StationNextHourLine } from "@/app/NextHour";
import { stationAnswer, stationFaq } from "@/lib/answers";
import { breadcrumbLd, placeLd, publisherLd, webPageLd, DATA_BRANCH } from "@/lib/seo";
import {
  fetchStations,
  fetchStationData,
  getNational,
  statusFor,
  type Station,
  type NationalStation,
} from "@/lib/arcgis";
import { basinPath, resolveStation, stationPath, stationSlug } from "@/lib/slug";
import { detectUnit, formatLevel } from "@/lib/units";
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
import { RiverMap } from "@/app/RiverMap";
import { StationNearby } from "@/app/StationNearby";
import { TownsOnGauge } from "@/app/flood/TownsOnGauge";

const SITE = "https://sl-water-levels.vercel.app";

// Rendered per request (see `await connection()` in the page) and cached by the CDN for 60 s with a
// 5 min stale window (proxy.ts sets the header), not prerendered and not ISR: an ISR render waits for
// every Suspense boundary before sending a byte (9-12 s on a cache miss, measured 24 Oct), while a
// dynamic render sends the heading, the answer sentence and the shell as soon as the station list and
// gauge snapshot are in and streams the slow parts. Nothing is prerendered at build either, so a
// deploy never depends on ArcGIS, Google Sheets or the Mahaweli/DMC servers.

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
    const unit = detectUnit(data.thresholds, resolved.station);
    const markText = (v: number | null) => (v == null ? "—" : formatLevel(v, unit));

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
            // Feet like the page itself (metre gauges converted); a gauge of unknown unit stays unitless.
            level: formatLevel(level, unit),
            status: t(tierKey),
            alert: markText(data.thresholds.alert),
            minor: markText(data.thresholds.minor),
            major: markText(data.thresholds.major),
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
  await connection();
  const { lang: rawLang, river, station: stationParam } = await params;
  if (!isLocale(rawLang)) notFound();
  const lang: Locale = rawLang;
  const { t, p } = getI18n(lang);

  // Start the gauge snapshot together with the station list (they used to run one after the other).
  const nationalP = getNational().catch(() => [] as NationalStation[]);
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

  // The one-sentence answer and FAQ come from the same snapshot the chart and verdict use.
  const nat = resolved ? ((await nationalP).find((x) => x.station === resolved.station) ?? null) : null;
  const answer = nat ? stationAnswer(lang, t, nat) : null;
  const mt = lang !== "en" ? t("common.machineTranslated") : undefined;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {resolved && (
          <JsonLd
            graph={[
              webPageLd({
                lang,
                path: `/${river}/${stationParam}`,
                name: heading(t, station, basin, lang),
                description: answer ?? heading(t, station, basin, lang),
                modified: nat?.latest?.ts,
                speakable: [".answer-line"],
              }),
              breadcrumbLd(
                [
                  { name: t("crumb.allBasins"), path: "/" },
                  { name: riverName(basin, lang), path: basinPath(basin) },
                  { name: stationDisplayName(station), path: `/${river}/${stationParam}` },
                ],
                lang,
              ),
              ...(nat && Number.isFinite(nat.latitude) && Number.isFinite(nat.longitude)
                ? [
                    {
                      ...placeLd({
                        name: `${stationDisplayName(station)} river gauge, ${riverName(basin, lang)}`,
                        lat: nat.latitude,
                        lon: nat.longitude,
                        url: `${SITE}${canonical}`,
                        containedIn: `${riverName(basin, lang)}, Sri Lanka`,
                      }),
                      "@id": `${SITE}${canonical}#gauge`,
                    },
                  ]
                : []),
            ]}
          />
        )}

        {resolved && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(datasetLd(resolved.station, basin, stations, canonical, lang, nat?.latest?.ts)),
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
          {answer && <AnswerLine text={answer} note={mt} />}
          {nat && nat.tier !== "stale" && (
            <Suspense key={`nh-${station}`} fallback={null}>
              <StationNextHourLine lang={lang} basin={basin} station={station} />
            </Suspense>
          )}
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
              <StationCard lang={lang} stationName={station} basin={basin} />
            </Suspense>

            {/* A river with one gauge has no river page to hold its map: it lives here, under the water-level chart. */}
            {stations.filter((s) => s.basin === basin).length === 1 && (
              <Suspense key={`map-${station}`} fallback={null}><RiverMap lang={lang} basin={basin} focusStation={station} /></Suspense>
            )}

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

            <Suspense key={`reservoirs-${station}`} fallback={null}><RiverReservoirs lang={lang} basin={basin} station={station} /></Suspense>

            <Suspense key={`dams-${station}`} fallback={null}>
              <BasinDams basin={basin} lang={lang} />
            </Suspense>

            <TownsOnGauge lang={lang} station={station} />

            <Suspense key={`helplink-${station}`} fallback={null}>
              <StationHelpCard lang={lang} basin={basin} station={station} variant="link" />
            </Suspense>

            {nat && answer && (
              <Suspense key={`faq-${station}`} fallback={null}>
                <NextHourFaq lang={lang} basin={basin} build={(m) => stationFaq(lang, nat, answer, m?.[station] ?? null)} note={mt} />
              </Suspense>
            )}
          </>
        )}
      </div>
    </main>
  );
}

const ARCGIS_GAUGES =
  "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0/query";

function datasetLd(station: string, basin: string, stations: Station[], canonical: string, lang: Locale, modified?: number | null) {
  const s = stations.find((x) => x.station === station);
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const name = stationDisplayName(station);
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${name} river gauge water level (${basin.trim()})`,
    description: `Hourly water-level readings at the ${name} gauge on the ${basin.trim()}, Sri Lanka, with alert, minor flood and major flood levels and a next-hour forecast. Last 7 days. Shown in feet.`,
    url: `${SITE}${canonical}`,
    inLanguage: lang,
    isAccessibleForFree: true,
    // Google's Dataset rich result only accepts Organization/Person for creator.
    // license: the agencies publish no licence text; this page states the sources and terms.
    license: "https://sl-water-levels.vercel.app/about#data-sources",
    creator: { "@type": "Organization", name: "Department of Irrigation, Sri Lanka", url: "https://www.irrigation.gov.lk" },
    publisher: publisherLd(),
    isBasedOn: "https://www.irrigation.gov.lk/",
    ...(modified ? { dateModified: new Date(modified).toISOString() } : {}),
    temporalCoverage: `${day(start)}/${day(end)}`,
    variableMeasured: [
      { "@type": "PropertyValue", name: "River water level", unitText: "feet" },
      { "@type": "PropertyValue", name: "Next-hour river level forecast (expected level and range in about one hour)", unitText: "feet" },
      { "@type": "PropertyValue", name: "Alert, minor flood and major flood levels", unitText: "feet" },
    ],
    ...(s && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
      ? {
          spatialCoverage: {
            "@type": "Place",
            name: `${name}, ${basin.trim()}`,
            geo: { "@type": "GeoCoordinates", latitude: s.latitude, longitude: s.longitude },
          },
        }
      : {}),
    distribution: [
      {
        "@type": "DataDownload",
        name: "Current level, flood marks and next-hour forecast (JSON)",
        encodingFormat: "application/json",
        contentUrl: `${SITE}/api/levels?station=${encodeURIComponent(stationSlug(station))}`,
      },
      {
        "@type": "DataDownload",
        name: "Hourly readings, source service (JSON)",
        encodingFormat: "application/json",
        contentUrl: `${ARCGIS_GAUGES}?where=${encodeURIComponent(`gauge='${station}'`)}&outFields=*&orderByFields=CreationDate+DESC&f=json`,
      },
      { "@type": "DataDownload", name: "Archive of past readings", encodingFormat: "application/x-ndjson", contentUrl: DATA_BRANCH },
    ],
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
