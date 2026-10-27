import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { getNational, type NationalStation, type Tier } from "@/lib/arcgis";
import { stationDisplayName } from "@/lib/displayName";
import { basinPath, basinSlug } from "@/lib/slug";
import { formatLevel } from "@/lib/units";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { seoFor } from "@/lib/i18n/seo";
import { ogBase, riverNameParts } from "@/lib/seoMeta";
import { breadcrumbLd, webPageLd, SITE, abs } from "@/lib/seo";
import { JsonLd } from "@/app/Answer";
import { TierPill, type PillTier } from "@/app/TierPill";
import { tierLabel, tierRank } from "@/app/tierUi";

// The generic head-term page: "river water levels Sri Lanka today". Server-rendered from the already-cached national fetch
// (no new ArcGIS calls), every river with its worst official step and a plain link, plus a link to each of its gauges.
export const revalidate = 300;
export async function generateStaticParams() {
  return []; // rendered on first request, then cached: a deploy never waits on the gauge feed
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const sf = seoFor(lang);
  let n = 0;
  try {
    n = new Set((await getNational()).map((s) => s.basin.trim())).size;
  } catch {
    /* the description then omits the count */
  }
  const alternates = pageAlternates(lang, "/rivers");
  const title = sf("rivers.title");
  const description = n > 5 ? sf("rivers.desc", { n: n - 5 }) : sf("home.desc");
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { ...ogBase(lang), title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const pill = (t: Tier): PillTier => (t === "watch" ? "normal" : (t as PillTier));

export default async function RiversPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const sf = seoFor(lang);

  let national: NationalStation[] = [];
  try {
    national = await getNational();
  } catch {
    national = [];
  }

  const by = new Map<string, NationalStation[]>();
  for (const s of national) {
    const b = s.basin.trim();
    by.set(b, [...(by.get(b) ?? []), s]);
  }
  const rivers = [...by.entries()]
    .map(([basin, list]) => {
      const live = list.filter((s) => s.tier !== "stale");
      const sorted = [...(live.length ? live : list)].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.station.localeCompare(b.station));
      const worst = sorted[0];
      return { basin, list: [...list].sort((a, b) => a.station.localeCompare(b.station)), worst, reporting: live.length > 0 };
    })
    .sort((a, b) => Number(b.reporting) - Number(a.reporting) || tierRank(a.worst.tier) - tierRank(b.worst.tier) || a.basin.localeCompare(b.basin));

  const newest = national.reduce<number | null>((m, s) => (s.latest && (m == null || s.latest.ts > m) ? s.latest.ts : m), null);
  const nameOf = (basin: string) => riverNameParts(basin, lang);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <JsonLd
          graph={[
            webPageLd({ lang, path: "/rivers", name: sf("rivers.ldName"), description: sf("rivers.lead"), modified: newest, type: "CollectionPage" }),
            breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: t("crumb.allBasins"), path: "/rivers" }], lang),
            {
              "@type": "ItemList",
              itemListElement: rivers.map((r, i) => {
                const single = r.list.length === 1;
                return { "@type": "ListItem", position: i + 1, name: riverNameParts(r.basin, "en").lead, url: abs(lang, single ? r.list[0].href : basinPath(r.basin)) };
              }),
            },
          ]}
        />
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link>{" "}
          <span aria-hidden>›</span> <span className="text-slate-700 dark:text-slate-300">{t("crumb.allBasins")}</span>
        </nav>
        <header className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{sf("rivers.h1")}</h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 dark:text-slate-400">{sf("rivers.lead")}</p>
          {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
        </header>

        {rivers.length === 0 ? (
          <p className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">{t("river.unavailable")}</p>
        ) : (
          <ul className="space-y-3">
            {rivers.map((r) => {
              const n = nameOf(r.basin);
              const single = r.list.length === 1;
              const href = single ? r.list[0].href : basinPath(r.basin);
              const w = r.worst;
              const label = lang === "en" ? n.lead : n.native;
              const hot = ["alert", "minor", "major"].includes(w.tier) && r.reporting;
              return (
                <li key={r.basin} id={basinSlug(r.basin)} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold tracking-tight">
                        <Link href={p(href)} className="hover:text-sky-700 dark:hover:text-sky-300 inline-flex items-center gap-1 min-h-11 sm:min-h-0">
                          {sf("rivers.link", { river: label })}
                          <ChevronRight className="size-4 text-slate-400" aria-hidden />
                        </Link>
                      </h2>
                      {lang === "en" && n.alt && <p className="text-xs text-slate-500 dark:text-slate-400">{n.alt}</p>}
                    </div>
                    <TierPill label={r.reporting ? tierLabel(t, w.tier === "watch" ? "normal" : w.tier) : t("tier.stale")} tier={r.reporting ? pill(w.tier) : "stale"} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 tabular-nums">
                    {r.reporting && hot && w.latest
                      ? `${sf("rivers.worstAt", { step: tierLabel(t, w.tier), gauge: stationDisplayName(w.station) })} · ${formatLevel(w.latest.water_level, w.unit)}`
                      : r.reporting
                        ? sf(single ? "rivers.gauge1" : "rivers.gauges", { n: r.list.length })
                        : sf("rivers.noneReporting")}
                    {r.reporting && hot && !single ? ` · ${sf("rivers.gauges", { n: r.list.length })}` : ""}
                  </p>
                  {/* one link per gauge, in the words people search: "<town> water level" */}
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0 text-sm">
                    {r.list.map((s) => (
                      <Link key={s.href} href={p(s.href)} className="inline-flex items-center min-h-11 sm:min-h-8 text-sky-700 dark:text-sky-300 hover:underline">
                        {sf("rivers.gaugeLink", { gauge: stationDisplayName(s.station) })}
                      </Link>
                    ))}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">{t("footer.notOfficial")}</p>
      </div>
    </main>
  );
}
