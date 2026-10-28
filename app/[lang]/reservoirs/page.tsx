import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ogBase } from "@/lib/seoMeta";
import { seoFor } from "@/lib/i18n/seo";
import { AlertTriangle } from "lucide-react";
import { getReservoirs, type RV } from "@/lib/reservoirData";
import { getKnownStatuses, type KnownStatus } from "@/lib/reservoirStatus";
import { fetchStations } from "@/lib/arcgis";
import { RESERVOIR_COORDS } from "@/lib/reservoirCoords";
import { basinPath, stationPath } from "@/lib/slug";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { rtFor } from "@/lib/i18n/reservoirs";
import { riverName, shortDay } from "@/lib/i18n/format";
import { compareRelease, searchText } from "@/lib/reservoirSearch";
import { RvCard, localName } from "@/app/reservoirs/RvCard";
import { ReservoirFilter, type FilterItem } from "@/app/reservoirs/ReservoirFilter";

export const revalidate = 600;

import { SITE, webPageLd } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const data = await getReservoirs();
  const title = seoFor(lang)("rsvIndex.title");
  const description = seoFor(lang)("rsvIndex.desc", { n: data?.items.length ?? "" }).replace("  ", " ");
  const alternates = pageAlternates(lang, "/reservoirs");
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { ...ogBase(lang), title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const sortFields = (r: RV) => ({ status: r.status, barrage: r.barrage, cusecs: r.flow?.cusecs ?? 0, pct: r.storage?.pct ?? null, name: r.name });
/** Same order as the filter bar's default sort, so the server HTML and the first client render agree. */
const sortRv = (a: RV, b: RV) => compareRelease(sortFields(a), sortFields(b));

export default async function ReservoirsIndex({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const rt = rtFor(lang);
  const data = await getReservoirs();

  if (!data) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
            <p>{rt("idx.outage")}</p>
          </div>
        </div>
      </main>
    );
  }

  const items = [...data.items].sort(sortRv);
  const active = items.filter((r) => r.status === "spilling" || r.status === "releasing").length;
  const holding = items.filter((r) => r.status === "holding").length;
  const riverCount = new Map<string, number>();
  for (const r of items) if (r.river) riverCount.set(r.river, (riverCount.get(r.river) ?? 0) + 1);
  const rivers = [...riverCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r]) => r);
  const districts = [...new Set(items.map((r) => r.district).filter((d): d is string => !!d))].sort();
  const day = (d: string | null) => (d ? shortDay(d, t) : "—");

  // Rivers that have a map: the river page for a river with several gauges, the gauge page for one with a single gauge.
  const gaugeStations = await fetchStations().catch(() => []);
  const mapLinks: Record<string, string> = {};
  for (const r of rivers) {
    const on = gaugeStations.filter((g) => g.basin.trim().toLowerCase() === r.trim().toLowerCase());
    // A one-gauge river only has a map when a reservoir on it has known coordinates.
    if (on.length === 0 || (on.length === 1 && !items.some((rv) => rv.river === r && RESERVOIR_COORDS[rv.slug]))) continue;
    const path = on.length === 1 ? stationPath(on[0].basin, on[0].station) : basinPath(on[0].basin);
    mapLinks[r] = `${p(path)}#map`;
  }

  const known = await getKnownStatuses(items).catch(() => new Map<string, KnownStatus>());
  const filterItems: FilterItem[] = items.map((rv) => ({
    key: rv.slug,
    name: localName(rv, lang),
    river: rv.river,
    district: rv.district,
    status: rv.status,
    barrage: rv.barrage,
    cusecs: rv.flow?.cusecs ?? 0,
    pct: rv.storage?.pct ?? null,
    search: searchText([rv.name, rv.si, rv.ta, rv.slug.replace(/-/g, " "), rv.river, rv.district]),
    node: <RvCard rv={rv} lang={lang} known={known.get(rv.slug)} />,
  }));
  // Visible chip text uses the localised river name; the filter compares the raw name, so map it back.
  const riverLabels = new Map(rivers.map((r) => [r, riverName(r, lang)]));

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      // dated by the Irrigation Department's sheet (or the Mahaweli report), the readings the page shows
      webPageLd({ lang, path: "/reservoirs", name: seoFor(lang)("rsvIndex.title"), description: seoFor(lang)("rsvIndex.desc", { n: items.length }).replace("  ", " "), modified: data.sheetDate ?? data.wmsDate ?? null, type: "CollectionPage" }),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: t("crumb.home"), item: SITE + p("/") },
          { "@type": "ListItem", position: 2, name: rt("crumb"), item: `${SITE}${p("/reservoirs")}` },
        ],
      },
      {
        "@type": "ItemList",
        name: rt("idx.title"),
        itemListElement: items.slice(0, 100).map((r, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}${p(`/reservoirs/${r.slug}`)}`, name: r.name })),
      },
    ],
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{rt("crumb")}</span>
        </nav>
        <header className="mb-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{seoFor(lang)("rsvIndex.h1")}</h1>
          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">
            {active > 0 ? rt("idx.summary", { a: active, b: holding }) : rt("idx.summaryNone", { b: holding })}
          </p>
          <p className="mt-1"><Link href={p("/reservoirs/spilling")} className="inline-flex items-center min-h-11 text-sm text-sky-700 dark:text-sky-300 hover:underline">{seoFor(lang)("spill.link")}</Link></p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{rt("idx.asOf", { a: day(data.sheetDate), b: day(data.wmsDate) })}</p>
        </header>
        <ReservoirFilter
          items={filterItems}
          rivers={rivers}
          riverLabels={Object.fromEntries(riverLabels)}
          districts={districts}
          mapLinks={mapLinks}
          lang={lang}
          labels={{
            search: rt("f.search"), status: rt("f.status"), all: rt("f.all"), spilling: rt("s.spilling"), releasing: rt("s.releasing"), holding: rt("s.holding"), nodata: rt("noData"),
            river: rt("f.river"), allRivers: rt("f.allRivers"), district: rt("f.district"), allDistricts: rt("f.allDistricts"),
            sort: rt("f.sort"), sortRelease: rt("sort.release"), sortFull: rt("sort.full"), sortName: rt("sort.name"),
            filters: rt("f.filters"), clear: rt("f.clear"), clearAll: rt("f.clearAll"), showing: rt("f.showing"), showN: rt("f.showN"), remove: rt("f.remove"),
            mapLink: rt("f.mapLink"), close: rt("f.close"), clearSearch: rt("f.clearSearch"), empty: rt("f.empty"), active: rt("f.active"),
          }}
        />
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">{rt("src.note")}</p>
      </div>
    </main>
  );
}
