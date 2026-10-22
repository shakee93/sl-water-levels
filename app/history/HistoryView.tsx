import Link from "next/link";
import type { HistoryData } from "@/lib/history";
import { historyPath } from "@/lib/history";
import {
  type Scope,
  fmtRange,
  MONTHS_LONG,
  peakGauges,
  peakGaugesPhrase,
  peakPhrase,
  scopeIndices,
  summarize,
  fmtShort,
} from "@/lib/historyStats";
import { basinPath } from "@/lib/slug";
import { FloodCalendar } from "./FloodCalendar";

const SITE = "https://sl-water-levels.vercel.app";

export function scopeName(data: HistoryData, scope: Scope): string {
  if (scope.kind === "all") return "Sri Lanka";
  if (scope.kind === "basin") return scope.basin;
  return data.stations.find((s) => s.station === scope.station)?.name ?? scope.station;
}

/** Shared body for /history, /history/<river> and /history/<river>/<gauge>. */
export function HistoryView({ data, scope }: { data: HistoryData; scope: Scope }) {
  const idx = scopeIndices(data, scope);
  const sum = summarize(data, idx);
  const name = scopeName(data, scope);
  const station = scope.kind === "station" ? data.stations.find((s) => s.station === scope.station) : undefined;
  const basin = scope.kind === "basin" ? scope.basin : station?.basin;
  const where = scope.kind === "all" ? "Sri Lanka's rivers" : scope.kind === "basin" ? `the ${name}` : name;
  const path = historyPath(basin, station?.station);

  const updated = new Date(data.generatedAt).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  // Schema.org Dataset + breadcrumbs: makes the archive eligible for Google
  // Dataset Search and gives the page a proper breadcrumb trail in results.
  const crumbs = [
    { name: "Flood history", url: `${SITE}/history` },
    ...(basin ? [{ name: basin, url: `${SITE}${historyPath(basin)}` }] : []),
    ...(station ? [{ name: station.name, url: `${SITE}${path}` }] : []),
  ];
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${name} river flood history`,
      description: `Daily river flood warnings (alert, minor flood, major flood) for ${where}: measured at Department of Irrigation gauges since ${fmtShort(data.gauge.start)} ${data.gauge.start.slice(0, 4)}, and estimated from GloFAS modelled river flow since ${data.model.start.slice(0, 4)}.`,
      url: `${SITE}${path}`,
      temporalCoverage: `${data.model.start}/..`,
      spatialCoverage: { "@type": "Place", name: scope.kind === "all" ? "Sri Lanka" : `${name}, Sri Lanka` },
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex flex-wrap gap-1">
          <Link href="/" className="hover:underline">
            Home
          </Link>
          <span aria-hidden>›</span>
          {scope.kind === "all" ? (
            <span className="text-slate-700 dark:text-slate-300">Flood history</span>
          ) : (
            <Link href="/history" className="hover:underline">
              Flood history
            </Link>
          )}
          {basin && (
            <>
              <span aria-hidden>›</span>
              {station ? (
                <Link href={historyPath(basin)} className="hover:underline">
                  {basin}
                </Link>
              ) : (
                <span className="text-slate-700 dark:text-slate-300">{basin}</span>
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

        <header className="mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500" />
            Flood history
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            {scope.kind === "all" ? "When do our rivers flood?" : `When does ${where} flood?`}
          </h1>

          {/* Server-rendered answer: what searchers want, in the first lines of the page. */}
          <div className="text-slate-700 dark:text-slate-300 mt-3 max-w-prose space-y-2">
            {sum.season && (
              <p>
                Flood warnings {scope.kind === "all" ? "on Sri Lanka's rivers" : scope.kind === "basin" ? `on the ${name}` : `at ${name}`} come{" "}
                <strong>{sum.season}</strong>.{" "}
                {sum.now.phase === "main"
                  ? `It's ${MONTHS_LONG[sum.now.month]} now, the main flood season.`
                  : sum.now.phase === "second"
                    ? `It's ${MONTHS_LONG[sum.now.month]} now, the smaller flood season.`
                    : ""}
              </p>
            )}
            <p>
              Since {fmtShort(sum.gaugeSince)} {sum.gaugeSince.slice(0, 4)},{" "}
              {sum.scopeSize === 1 ? "this gauge has" : `its ${sum.scopeSize} gauges have`} recorded flooding on{" "}
              <strong>{sum.gaugeFloodDays} days</strong> and alert levels on {sum.gaugeAlertDays} days.
              {sum.latest && (
                <>
                  {" "}
                  The most recent flood was <strong>{fmtRange(sum.latest.from, sum.latest.to)}</strong>
                  {sum.scopeSize === 1 ? " (" : ", at "}
                  {sum.scopeSize === 1
                    ? peakPhrase(sum.latest.peakAgg, 1)
                    : peakGaugesPhrase(peakGauges(data, idx, sum.latest), 3)}
                  {sum.latest.source === "model" ? ", modelled" : ""}
                  {sum.scopeSize === 1 ? ")." : "."}
                </>
              )}
            </p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
            Below each line is what the gauges measured; above it, an estimate from modelled river flow back to{" "}
            {data.model.start.slice(0, 4)}. Updated {updated} (Sri Lanka time).
            {station && (
              <>
                {" "}
                <Link href={station.href} className="text-sky-700 dark:text-sky-400 hover:underline">
                  Live {station.name} water level →
                </Link>
              </>
            )}
            {scope.kind === "basin" && (
              <>
                {" "}
                <Link href={basinPath(name)} className="text-sky-700 dark:text-sky-400 hover:underline">
                  Live {name} levels →
                </Link>
              </>
            )}
          </p>
        </header>

        <FloodCalendar data={data} scope={scope} />

        {/* Crawlable links to every river and gauge history (the picker is a <select>). */}
        {scope.kind !== "station" && (
          <section className="mt-12">
            <h2 className="text-base font-semibold mb-2">
              {scope.kind === "all" ? "Flood history by river" : `Flood history by gauge on the ${name}`}
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {(scope.kind === "all"
                ? [...new Set(data.stations.map((s) => s.basin))].sort().map((b) => ({ key: b, href: historyPath(b), label: b }))
                : data.stations
                    .filter((s) => s.basin === scope.basin)
                    .map((s) => ({ key: s.station, href: historyPath(s.basin, s.station), label: s.name }))
              ).map((l) => (
                <li key={l.key}>
                  <Link href={l.href} className="text-sky-700 dark:text-sky-400 hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-12 text-sm text-slate-600 dark:text-slate-400 space-y-2 max-w-prose">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">About this data</h2>
          <p>
            <strong>Measured:</strong>{" "}each gauge&apos;s highest reading that day (Sri Lanka time) against its
            current official alert, minor-flood and major-flood levels. Readings before our own archive began come
            from{" "}
            <a href="https://github.com/nuuuwan/lk_irrigation" className="underline">
              nuuuwan/lk_irrigation
            </a>
            , which has recorded the same Department of Irrigation feed hourly since 23 Nov 2025.
          </p>
          <p>
            <strong>Modelled:</strong>{" "}not official warnings. GloFAS river-discharge estimates (via{" "}
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

export function HistoryUnavailable() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <p className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm">
        The flood history archive couldn&apos;t be loaded right now. Please try again in a few minutes.
      </p>
    </main>
  );
}
