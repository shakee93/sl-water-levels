import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Map as MapIcon } from "lucide-react";
import { getReservoirs, type RV } from "@/lib/reservoirData";
import { fetchStations } from "@/lib/arcgis";
import { RESERVOIR_COORDS } from "@/lib/reservoirCoords";
import { basinPath, stationPath } from "@/lib/slug";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { rtFor } from "@/lib/i18n/reservoirs";
import { riverName, shortDay } from "@/lib/i18n/format";
import { RvCard } from "@/app/reservoirs/RvCard";
import { ReservoirFilter, type FilterItem } from "@/app/reservoirs/ReservoirFilter";

export const revalidate = 600;

const SITE = "https://sl-water-levels.vercel.app";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const rt = rtFor(lang);
  const data = await getReservoirs();
  const title = rt("idx.title");
  const description = rt("idx.desc", { n: data?.items.length ?? "" }).replace("  ", " ");
  const alternates = pageAlternates(lang, "/reservoirs");
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const ORDER = { spilling: 0, releasing: 1, holding: 2, nodata: 3 } as const;
/** Releasing now first (biggest first; a routine barrage after the rest), then by name. */
const sortRv = (a: RV, b: RV) =>
  ORDER[a.status] - ORDER[b.status] || Number(a.barrage) - Number(b.barrage) || (b.flow?.cusecs ?? 0) - (a.flow?.cusecs ?? 0) || a.name.localeCompare(b.name);

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
  const mapLinks = rivers.flatMap((r) => {
    const on = gaugeStations.filter((g) => g.basin.trim().toLowerCase() === r.trim().toLowerCase());
    // A one-gauge river only has a map when a reservoir on it has known coordinates.
    if (on.length === 0 || (on.length === 1 && !items.some((rv) => rv.river === r && RESERVOIR_COORDS[rv.slug]))) return [];
    const path = on.length === 1 ? stationPath(on[0].basin, on[0].station) : basinPath(on[0].basin);
    return [{ river: r, href: `${p(path)}#map` }];
  });

  const filterItems: FilterItem[] = items.map((rv) => ({
    key: rv.slug,
    river: rv.river,
    district: rv.district,
    releasing: rv.status === "spilling" || rv.status === "releasing",
    node: <RvCard rv={rv} lang={lang} />,
  }));
  // Visible chip text uses the localised river name; the filter compares the raw name, so map it back.
  const riverLabels = new Map(rivers.map((r) => [r, riverName(r, lang)]));

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
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
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{rt("idx.h1")}</h1>
          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">
            {active > 0 ? rt("idx.summary", { a: active, b: holding }) : rt("idx.summaryNone", { b: holding })}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{rt("idx.asOf", { a: day(data.sheetDate), b: day(data.wmsDate) })}</p>
        </header>
        {mapLinks.length > 0 && (
          <nav className="mb-4" aria-label={rt("idx.maps")}>
            <h2 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              <MapIcon className="size-4" aria-hidden /> {rt("idx.maps")}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {mapLinks.map((m) => (
                <li key={m.river}>
                  <Link href={m.href} className="inline-flex items-center min-h-11 sm:min-h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm hover:border-sky-300 dark:hover:border-sky-700 transition">
                    {riverName(m.river, lang)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <ReservoirFilter
          items={filterItems}
          rivers={rivers}
          riverLabels={Object.fromEntries(riverLabels)}
          districts={districts}
          labels={{ all: rt("f.all"), releasing: rt("f.releasing"), allDistricts: rt("f.allDistricts"), district: rt("f.district"), empty: rt("f.empty") }}
        />
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">{rt("src.note")}</p>
      </div>
    </main>
  );
}
