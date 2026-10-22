import Link from "next/link";
import type { HistoryData } from "@/lib/history";
import { historyPath } from "@/lib/history";
import {
  type Scope,
  peakGauges,
  peakGaugesPhrase,
  peakPhrase,
  scopeIndices,
  summarize,
} from "@/lib/historyStats";
import { dayRange, monthsLong, monthsShort, riverName, shortDay, shortStamp } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { basinPath } from "@/lib/slug";
import { FloodCalendar } from "./FloodCalendar";
import { YearSummary, type YearSummaryLabels } from "./YearSummary";
import type { TFn } from "@/lib/i18n/translate";

const SITE = "https://sl-water-levels.vercel.app";

function yearLabels(t: TFn): Partial<YearSummaryLabels> {
  return {
    heading: t("yr.heading"),
    headlineRecorded: t("yr.headlineRecorded"),
    headlineAverage: t("yr.headlineAverage"),
    headlineWorst: t("yr.headlineWorst"),
    headlineWorstSoFar: t("yr.headlineWorstSoFar"),
    noWarnings: t("yr.noWarnings"),
    estimateSentence: t("yr.estimateSentence"),
    year: t("yr.year"),
    affectedDays: t("yr.affected"),
    worstDay: t("yr.worstDay"),
    soFar: t("yr.soFar"),
    recorded: t("yr.recorded"),
    estimated: t("yr.estimated"),
    recordedFrom: t("yr.recordedFrom"),
    level: { alert: t("mark.alert"), minor: t("mark.minor"), major: t("mark.major") },
    levelInline: { alert: t("mark.alert").toLowerCase(), minor: t("mark.minor").toLowerCase(), major: t("mark.major").toLowerCase() },
    worstDaySingle: t("yr.worstDaySingle"),
    worstDayMany: t("yr.worstDayMany"),
    worstDayOne: t("yr.worstDayOne"),
    estimatedSuffix: t("yr.estSuffix"),
    noWorstDay: t("yr.noWorst"),
    breakdown: t("yr.breakdown"),
    footnote: t("yr.footnote"),
    myLevelColumn: t("yr.myColumn"),
    myLevelHeadline: t("yr.myHeadline"),
    myLevelNoRecords: t("yr.myNoRecords"),
    myLevelNoRecordsNote: t("yr.myNoRecordsNote"),
    myLevelPartial: t("yr.myPartial"),
  };
}

export function scopeName(data: HistoryData, scope: Scope, lang: Locale = "en"): string {
  if (scope.kind === "all") return "Sri Lanka";
  if (scope.kind === "basin") return riverName(scope.basin, lang);
  return data.stations.find((s) => s.station === scope.station)?.name ?? scope.station;
}

/** Shared body for /history, /history/<river> and /history/<river>/<gauge>. */
export function HistoryView({ lang, data, scope }: { lang: Locale; data: HistoryData; scope: Scope }) {
  const { t, p } = getI18n(lang);
  const idx = scopeIndices(data, scope);
  const sum = summarize(data, idx, t);
  const name = scopeName(data, scope, lang);
  const station = scope.kind === "station" ? data.stations.find((s) => s.station === scope.station) : undefined;
  const basin = scope.kind === "basin" ? scope.basin : station?.basin;
  const where = scope.kind === "all" ? t("hist.whereAll") : scope.kind === "basin" ? t("hist.whereBasin", { name }) : name;
  const path = p(historyPath(basin, station?.station));

  const updated = shortStamp(new Date(data.generatedAt).getTime(), t);
  const months = monthsLong(t);
  const since = `${shortDay(sum.gaugeSince, t)} ${sum.gaugeSince.slice(0, 4)}`;

  // Schema.org Dataset + breadcrumbs: makes the archive eligible for Google
  // Dataset Search and gives the page a proper breadcrumb trail in results.
  const crumbs = [
    { name: t("hist.nav"), url: `${SITE}${p("/history")}` },
    ...(basin ? [{ name: riverName(basin, lang), url: `${SITE}${p(historyPath(basin))}` }] : []),
    ...(station ? [{ name: station.name, url: `${SITE}${path}` }] : []),
  ];
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: t("hist.ldName", { name }),
      inLanguage: lang,
      description: t("hist.ldDesc", { where, since: `${shortDay(data.gauge.start, t)} ${data.gauge.start.slice(0, 4)}`, year: data.model.start.slice(0, 4) }),
      url: `${SITE}${path}`,
      temporalCoverage: `${data.model.start}/..`,
      spatialCoverage: { "@type": "Place", name: scope.kind === "all" ? t("hist.ldPlaceAll") : `${name}, ${t("hist.ldPlaceAll")}` },
      isAccessibleForFree: true,
      license: "https://creativecommons.org/licenses/by/4.0/",
      creator: { "@type": "Organization", name: "Sri Lanka Water Levels", url: SITE },
      distribution: [
        {
          "@type": "DataDownload",
          encodingFormat: "text/csv",
          contentUrl: "https://github.com/shakee93/sl-water-levels/tree/data",
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
    },
  ];

  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex flex-wrap gap-1">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">
            {t("crumb.home")}
          </Link>
          <span aria-hidden>›</span>
          {scope.kind === "all" ? (
            <span className="text-slate-700 dark:text-slate-300">{t("hist.nav")}</span>
          ) : (
            <Link href={p("/history")} className="hover:underline inline-block py-3 -my-3">
              {t("hist.nav")}
            </Link>
          )}
          {basin && (
            <>
              <span aria-hidden>›</span>
              {station ? (
                <Link href={p(historyPath(basin))} className="hover:underline inline-block py-3 -my-3">
                  {riverName(basin, lang)}
                </Link>
              ) : (
                <span className="text-slate-700 dark:text-slate-300">{riverName(basin, lang)}</span>
              )}
            </>
          )}
          {station && (
            <>
              <span aria-hidden>›</span>
              <span className="text-slate-700 dark:text-slate-300">{station.name}</span>
            </>
          )}
        </nav>

        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">
            {scope.kind === "all" ? t("hist.h1All") : t("hist.h1Where", { where })}
          </h1>

          {/* Server-rendered answer: what searchers want, in the first lines of the page. */}
          <div className="text-slate-700 dark:text-slate-300 mt-3 max-w-prose space-y-2">
            {sum.season && (
              <p>
                {t("hist.warningsCome", {
                  on: scope.kind === "all" ? t("hist.onAll") : scope.kind === "basin" ? t("hist.onBasin", { name }) : t("hist.atStation", { name }),
                  season: sum.season,
                })}{" "}
                {sum.now.phase === "main"
                  ? t("hist.nowMain", { month: months[sum.now.month] })
                  : sum.now.phase === "second"
                    ? t("hist.nowSecond", { month: months[sum.now.month] })
                    : ""}
              </p>
            )}
            <p>
              {t(sum.scopeSize === 1 ? "hist.sinceThis" : "hist.sinceMany", {
                date: since,
                n: sum.scopeSize,
                floodDays: t("hist.daysN", { n: sum.gaugeFloodDays }),
                alertDays: sum.gaugeAlertDays,
              })}
              {sum.latest &&
                " " +
                  t("hist.mostRecent", {
                    range: dayRange(sum.latest.from, sum.latest.to, t),
                    at:
                      sum.scopeSize === 1
                        ? t("hist.mostRecentSingle", { peak: peakPhrase(sum.latest.peakAgg, 1, t) })
                        : t("hist.mostRecentMany", { peak: peakGaugesPhrase(peakGauges(data, idx, sum.latest), t, 3) }),
                    est: sum.latest.source === "model" ? t("hist.estimatedSuffix") : "",
                  })}
            </p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
            {t("hist.belowEach", { year: data.model.start.slice(0, 4), updated })}
            {station && (
              <>
                {" "}
                <Link href={p(station.href)} className="text-sky-700 dark:text-sky-400 hover:underline">
                  {t("hist.liveStation", { name: station.name })}
                </Link>
              </>
            )}
            {scope.kind === "basin" && (
              <>
                {" "}
                <Link href={p(basinPath(scope.basin))} className="text-sky-700 dark:text-sky-400 hover:underline">
                  {t("hist.liveBasin", { name })}
                </Link>
              </>
            )}
          </p>
        </header>

        <FloodCalendar data={data} scope={scope} />

        <div className="mt-8">
          <YearSummary
            data={data}
            scope={scope}
            labels={yearLabels(t)}
            locale={lang === "si" ? "si-LK" : lang === "ta" ? "ta-LK" : "en-GB"}
            dateFormat={{ months: monthsShort(t), pattern: t("date.short") }}
            name={
              scope.kind === "station" && station
                ? t("yr.stationName", { river: riverName(station.basin, lang), gauge: station.name })
                : name
            }
          />
        </div>

        {/* Crawlable links to every river and gauge history (the picker is a <select>). */}
        {scope.kind !== "station" && (
          <section className="mt-10 sm:mt-12">
            <h2 className="text-base font-semibold mb-2">
              {scope.kind === "all" ? t("hist.byRiver") : t("hist.byGauge", { name })}
            </h2>
            <ul className="flex flex-wrap gap-x-1 gap-y-0 text-sm">
              {(scope.kind === "all"
                ? [...new Set(data.stations.map((s) => s.basin))].sort().map((b) => ({ key: b, href: historyPath(b), label: riverName(b, lang) }))
                : data.stations
                    .filter((s) => s.basin === scope.basin)
                    .map((s) => ({ key: s.station, href: historyPath(s.basin, s.station), label: s.name }))
              ).map((l) => (
                <li key={l.key}>
                  <Link href={p(l.href)} className="inline-flex items-center min-h-11 px-2 text-sky-700 dark:text-sky-400 hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10 sm:mt-12 text-sm text-slate-600 dark:text-slate-400 space-y-2 max-w-prose">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t("hist.aboutData")}</h2>
          <p>
            <strong>{t("hist.measuredLabel")}</strong> {t("hist.measuredText")}
          </p>
          <p>
            <strong>{t("hist.estimatedLabel")}</strong> {t("hist.estimatedText")}
          </p>
          <p className="text-xs">
            {t("hist.sourcesPre")}
            <a href="https://github.com/nuuuwan/lk_irrigation" className="underline">
              lk_irrigation
            </a>
            {t("hist.sourcesMid")}
            <a href="https://open-meteo.com/" className="underline">
              Open-Meteo
            </a>
            {t("hist.sourcesPost")}
            <a href="https://github.com/shakee93/sl-water-levels/tree/data" className="underline">
              {t("hist.download")}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}

export function HistoryUnavailable({ lang }: { lang: Locale }) {
  const { t } = getI18n(lang);
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <p className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm">
        {t("hist.unavailable")}
      </p>
    </main>
  );
}
