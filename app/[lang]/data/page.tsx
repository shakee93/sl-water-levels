import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { JsonLd } from "@/app/Answer";
import { bestWindow, figure, getAccuracy, newModelFigure, spanText } from "@/lib/accuracy";
import { CONTENT_UPDATED, DATA_BRANCH, OWNER, REPO, SITE, breadcrumbLd, publisherLd, siteDatasetLd, webPageLd } from "@/lib/seo";

export const revalidate = 3600;

// A developers' page: written in English for every language, and always canonical to the English URL.
const TITLE = "Free data and API for Sri Lanka river levels and reservoirs";
const DESC = "Current river levels in feet, a next-hour river forecast for every gauge, flood marks, reservoir spill and release figures as JSON, an alerts feed and an MCP server for AI tools. Free, no key.";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return {
    title: TITLE,
    description: DESC,
    alternates: { canonical: "/data" },
    openGraph: { title: TITLE, description: DESC, url: `${SITE}/data`, type: "website" },
  };
}

const code = "block overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200";
const card = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6";

export default async function DataPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { t, p } = getI18n(lang);
  const acc = await getAccuracy();
  const win = acc ? bestWindow(acc) : "all";
  const accRows = acc ? [1, 3, 6, 12, 24].map((h) => ({ h, f: figure(acc.overall, h, win) })).filter((r) => r.f) : [];
  const nm1 = acc ? newModelFigure(acc.overall, 1, win) : null;
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <JsonLd
        graph={[
          webPageLd({ lang: "en", path: "/data", name: TITLE, description: DESC, modified: Date.parse(CONTENT_UPDATED), type: "WebPage" }),
          breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: "Data", path: "/data" }], "en"),
          publisherLd(),
          siteDatasetLd(),
        ]}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">Data</span>
        </nav>
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">{TITLE}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">
            Everything on this site is also available as plain data. It is free, needs no key and allows any website to read it. Levels are in feet; a missing figure is empty, never zero. Last updated {CONTENT_UPDATED}.
          </p>
        </header>

        <div className="space-y-5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <section className={card} aria-labelledby="levels">
            <h2 id="levels" className="text-lg font-semibold tracking-tight mb-2">River levels</h2>
            <p className="mb-2">Level now, the three official flood marks, status, trend and time of reading for every gauge. Refreshed every minute; the gauges themselves report about once an hour.</p>
            <code className={code}>GET {SITE}/api/levels</code>
            <code className={`${code} mt-1`}>GET {SITE}/api/levels?station=hanwella</code>
            <code className={`${code} mt-1`}>GET {SITE}/api/levels?river=kelani-ganga</code>
            <code className={`${code} mt-1`}>GET {SITE}/api/levels?town=wellampitiya</code>
            <p className="mt-2">Each record has <code>level</code>, <code>nextHour</code> (below), <code>unit</code> (ft), <code>marks</code> (alert, minor, major), <code>status</code> (normal, watch, alert, minor, major, none, stale), <code>trend</code>, <code>observedAt</code> (ISO 8601, with <code>ageMinutes</code>) and the page <code>url</code>. <code>published</code> keeps the figure exactly as the agency released it.</p>
          </section>

          <section className={card} aria-labelledby="next-hour-h" id="next-hour">
            <h2 id="next-hour-h" className="text-lg font-semibold tracking-tight mb-2">Next-hour river forecast</h2>
            <p className="mb-2">Every gauge in <code>/api/levels</code> carries <code>nextHour</code>: where the river is expected to be in about an hour, with a range, refreshed hourly. As far as we know it is the only public next-hour river forecast for Sri Lanka. It is a forecast, not an official warning.</p>
            <code className={code}>GET {SITE}/api/levels?station=hanwella</code>
            <p className="mt-2">Fields: <code>level_ft</code> (expected level), <code>low_ft</code> and <code>high_ft</code> (the range it should stay inside; null for a simple trend estimate), <code>change_ft</code>, <code>direction</code> (rising, falling, steady), <code>crossing</code> (for example &ldquo;may reach alert level&rdquo;, else null), <code>issuedAt</code> (the reading it starts from, ISO 8601), <code>method</code> (<code>model</code>: upstream gauges and rain; <code>trend</code>: recent change carried forward) <code>experimental</code> and <code>rainRisk</code> (null, or <code>level</code> heavy / very-heavy / possible with <code>mm_24h</code> when 50 mm or more of rain is forecast over the hills above the gauge in the next 24 hours; <code>kind</code> is <code>forecast</code>, <code>measured</code> or <code>both</code>, and <code>measured</code> names the gauge that recorded 25 mm in 1 hour or 40 mm in 3 hours; the river may then rise faster than the forecast shows). The whole <code>nextHour</code> is null when the gauge is not reporting or has no forecast. How well it has done: <Link className="underline" href={p("/about#next-hour")}>{t("nav.about")}</Link>.</p>
            <p className="mt-2">Every station also has a <code>rain</code> block with the three rain sources kept apart: <code>fallen_1h_mm</code>, <code>fallen_3h_mm</code> and <code>fallen_24h_mm</code> are what the gauge&rsquo;s own sensor recorded (null when it has no sensor, such as Nagalagam Street, or no reading in 2 hours; never 0 for &ldquo;not measured&rdquo;); <code>satellite_6h_mm</code> and <code>satellite_24h_mm</code> are the JAXA GSMaP estimate over the catchment above the gauge (an estimate that can read far higher than the gauges in the dry zone); <code>forecast_6h_mm</code>, <code>forecast_24h_mm</code> and <code>forecast_24h_heavier_mm</code> are the weather model&rsquo;s rain over that catchment (the heavier one is the wetter ensemble scenario). The <code>_word</code> fields use one set of bands: for 24 hours light under 10 mm, moderate 10 to 50, heavy 50 to 100, very heavy 100 or more; for 1 hour heavy from 10 mm and very heavy from 25 mm. <code>sources</code> lists what was available.</p>
            <h3 className="mt-4 mb-1 font-semibold">How well it has done (live)</h3>
            {acc && accRows.length ? (
              <>
                <p className="mb-2">Scored automatically from our prediction log every few hours: each forecast is checked against the gauge reading closest to its target time. As of {acc.asOf}, over {spanText(acc, win)}. Misses are in feet; &ldquo;no change&rdquo; means saying the level stays where it is. Further ahead is much less certain.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead><tr className="text-slate-500"><th className="py-1 pr-3 font-medium">Ahead</th><th className="pr-3 font-medium">Checks</th><th className="pr-3 font-medium">Average miss</th><th className="pr-3 font-medium">&ldquo;No change&rdquo; miss</th><th className="pr-3 font-medium">Inside range</th><th className="pr-3 font-medium">Range width</th><th className="font-medium">Direction right</th></tr></thead>
                    <tbody>
                      {accRows.map(({ h, f }) => (
                        <tr key={h} className="border-t border-slate-200 dark:border-slate-800"><td className="py-1 pr-3">{h} h</td><td className="pr-3">{f!.n}</td><td className="pr-3">{f!.maeFt?.toFixed(2)} ft</td><td className="pr-3">{f!.baseMaeFt?.toFixed(2)} ft</td><td className="pr-3">{f!.inBandPct}%</td><td className="pr-3">{f!.bandFt?.toFixed(2)} ft</td><td>{f!.dirPct}% (always &ldquo;steady&rdquo;: {f!.dirSteadyPct}%)</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2">{nm1 && nm1.n >= 10 ? `The gauge-only model (next hour, 3 h, 6 h) has run since ${acc.gaugeModelSince}: ${nm1.n} next-hour checks, average miss ${nm1.maeFt?.toFixed(2)} ft against ${nm1.baseMaeFt?.toFixed(2)} ft for "no change".` : `The gauge-only model (live since ${acc.gaugeModelSince}) has only ${nm1?.n ?? 0} next-hour checks so far, too few to report separately.`} The raw file is <code>https://raw.githubusercontent.com/shakee93/sl-water-levels/data/accuracy/latest.json</code> (per gauge too).</p>
              </>
            ) : (
              <p>The live accuracy figures are temporarily unavailable.</p>
            )}
          </section>

          <section className={card} aria-labelledby="reservoirs">
            <h2 id="reservoirs" className="text-lg font-semibold tracking-tight mb-2">Reservoirs</h2>
            <p className="mb-2">Storage and spill or release for about 170 reservoirs, with the day of the reading and which agency reported it. These sources update daily.</p>
            <code className={code}>GET {SITE}/api/reservoirs</code>
            <code className={`${code} mt-1`}>GET {SITE}/api/reservoirs?status=spilling</code>
          </section>

          <section className={card} aria-labelledby="canals">
            <h2 id="canals" className="text-lg font-semibold tracking-tight mb-2">Colombo canals</h2>
            <p className="mb-2">Canal levels for Colombo (metres above sea level, every 15 minutes), a plain state per gauge (normal, rising, higher than usual, not reporting), the last 24 hours, the sea level at the Kelani mouth and the predicted tide for the next 48 hours. Data &copy; CUrW / SLLDC (<a href="http://pub.curwsl.org/" className="underline">pub.curwsl.org</a>), shown with attribution: please credit them if you use it. It is context, not a flood warning.</p>
            <code className={code}>GET {SITE}/api/canals</code>
            <code className={`${code} mt-1`}>GET {SITE}/api/canals?group=Kolonnawa</code>
          </section>

          <section className={card} aria-labelledby="feed">
            <h2 id="feed" className="text-lg font-semibold tracking-tight mb-2">Alerts feed</h2>
            <p className="mb-2">Atom feed with one entry each time a gauge reaches alert level or above, or a reservoir starts releasing water.</p>
            <code className={code}>{SITE}/feed.xml</code>
          </section>

          <section className={card} aria-labelledby="mcp">
            <h2 id="mcp" className="text-lg font-semibold tracking-tight mb-2">For AI assistants</h2>
            <p className="mb-2">An MCP server (Streamable HTTP) lets an assistant look up stations, read a gauge, walk a river from upstream to downstream and fetch the current official warnings. Tools: <code>get_next_hour_forecast</code>, <code>list_basins</code>, <code>list_stations</code>, <code>get_station_readings</code>, <code>get_basin_snapshot</code>, <code>get_official_warnings</code>, <code>get_reservoir_releases</code>, <code>get_spill_watch</code>. The station and river tools include the next-hour forecast.</p>
            <code className={code}>{SITE}/mcp</code>
            <p className="mt-2">A plain-text summary written for language models is at <a className="underline" href="/llms.txt">/llms.txt</a>, with every gauge, reservoir and town in <a className="underline" href="/llms-full.txt">/llms-full.txt</a>.</p>
          </section>

          <section className={card} aria-labelledby="archive">
            <h2 id="archive" className="text-lg font-semibold tracking-tight mb-2">Archive and code</h2>
            <p>Past gauge readings and reservoir snapshots are saved to the <a className="underline" href={DATA_BRANCH} target="_blank" rel="noreferrer">data branch</a> on GitHub as newline-delimited JSON. The code is open: <a className="underline" href={REPO} target="_blank" rel="noreferrer">{REPO.replace("https://", "")}</a>.</p>
          </section>

          <section className={card} aria-labelledby="cite">
            <h2 id="cite" className="text-lg font-semibold tracking-tight mb-2">Using and citing it</h2>
            <p>Please link the specific page you used and name the source: &ldquo;Sri Lanka Water Levels ({OWNER.name}), data from the Department of Irrigation, Sri Lanka&rdquo;. Quote the time of the reading, not the time you fetched it.</p>
            <p className="mt-2">This is an independent project, not an official warning service. In an emergency call 117 and follow the <a className="underline" href="https://www.dmc.gov.lk/" target="_blank" rel="noreferrer">Disaster Management Centre</a>. How the numbers are made and their limits: <Link className="underline" href={p("/about")}>{t("nav.about")}</Link>.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
