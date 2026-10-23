import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { JsonLd } from "@/app/Answer";
import { CONTENT_UPDATED, DATA_BRANCH, OWNER, REPO, SITE, breadcrumbLd, publisherLd, siteDatasetLd, webPageLd } from "@/lib/seo";

export const revalidate = 86400;

// A developers' page: written in English for every language, and always canonical to the English URL.
const TITLE = "Free data and API for Sri Lanka river levels and reservoirs";
const DESC = "Current river levels in feet, flood marks, reservoir spill and release figures as JSON, an alerts feed and an MCP server for AI tools. Free, no key.";

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
            <p className="mt-2">Each record has <code>level</code>, <code>unit</code> (ft), <code>marks</code> (alert, minor, major), <code>status</code> (normal, watch, alert, minor, major, none, stale), <code>trend</code>, <code>observedAt</code> (ISO 8601, with <code>ageMinutes</code>) and the page <code>url</code>. <code>published</code> keeps the figure exactly as the agency released it.</p>
          </section>

          <section className={card} aria-labelledby="reservoirs">
            <h2 id="reservoirs" className="text-lg font-semibold tracking-tight mb-2">Reservoirs</h2>
            <p className="mb-2">Storage and spill or release for about 170 reservoirs, with the day of the reading and which agency reported it. These sources update daily.</p>
            <code className={code}>GET {SITE}/api/reservoirs</code>
            <code className={`${code} mt-1`}>GET {SITE}/api/reservoirs?status=spilling</code>
          </section>

          <section className={card} aria-labelledby="feed">
            <h2 id="feed" className="text-lg font-semibold tracking-tight mb-2">Alerts feed</h2>
            <p className="mb-2">Atom feed with one entry each time a gauge reaches alert level or above, or a reservoir starts releasing water.</p>
            <code className={code}>{SITE}/feed.xml</code>
          </section>

          <section className={card} aria-labelledby="mcp">
            <h2 id="mcp" className="text-lg font-semibold tracking-tight mb-2">For AI assistants</h2>
            <p className="mb-2">An MCP server (Streamable HTTP) lets an assistant look up stations, read a gauge, walk a river from upstream to downstream and fetch the current official warnings. Tools: <code>list_basins</code>, <code>list_stations</code>, <code>get_station_readings</code>, <code>get_basin_snapshot</code>, <code>get_official_warnings</code>.</p>
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
