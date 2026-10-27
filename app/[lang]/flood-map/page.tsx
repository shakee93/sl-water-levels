import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getNational, type NationalStation } from "@/lib/arcgis";
import { PLACES } from "@/lib/places";
import { loadTownStates } from "@/lib/townData";
import { allFloodEvents } from "@/lib/floodMap";
import { basinPath } from "@/lib/slug";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { seoFor } from "@/lib/i18n/seo";
import { riverName } from "@/lib/i18n/format";
import { ogBase } from "@/lib/seoMeta";
import { breadcrumbLd, webPageLd, SITE } from "@/lib/seo";
import { JsonLd } from "@/app/Answer";
import { SriLankaMap } from "@/app/SriLankaMap";
import { TierPill, type PillTier } from "@/app/TierPill";
import { tierLabel, type HomeStation } from "@/app/tierUi";

// "Sri Lanka flood map": what we can honestly show on a map today. The live part is the home map's data (every gauge coloured
// by its official step, spilling dams); towns to watch come from the cheap gauge-only town states already cached for /flood;
// past floods are the Irrigation Department's static Flood_Map list (names only, never today's flood). Nothing new is fetched.
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const sf = seoFor(lang);
  const alternates = pageAlternates(lang, "/flood-map");
  return {
    title: { absolute: sf("map.title") },
    description: sf("map.desc"),
    alternates,
    openGraph: { ...ogBase(lang), title: sf("map.title"), description: sf("map.desc"), url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title: sf("map.title"), description: sf("map.desc") },
  };
}

const compact = (s: NationalStation): HomeStation => ({
  station: s.station, basin: s.basin.trim(), latitude: s.latitude, longitude: s.longitude, href: s.href,
  tier: s.tier, level: s.latest?.water_level ?? null, unit: s.unit, ts: s.latest?.ts ?? null, rate3hM: s.rate3hM,
});

export default async function FloodMapPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const sf = seoFor(lang);

  const national = await getNational().catch(() => [] as NationalStation[]);
  const states = await loadTownStates(PLACES).catch(() => null);
  const watch = states
    ? PLACES.map((pl) => ({ pl, st: states.get(pl.slug) })).filter((x) => x.st && ["alert", "minor", "major"].includes(x.st.tone))
        .sort((a, b) => ["major", "minor", "alert"].indexOf(a.st!.tone) - ["major", "minor", "alert"].indexOf(b.st!.tone) || a.pl.name.localeCompare(b.pl.name))
    : [];
  const gaugeBasins = new Set(national.map((s) => s.basin.trim()));
  const past = allFloodEvents();
  const riversWithMap = [...new Set(past.map((e) => e.basin))].filter((b) => gaugeBasins.has(b)).sort();
  const newest = national.reduce<number | null>((m, s) => (s.latest && (m == null || s.latest.ts > m) ? s.latest.ts : m), null);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <JsonLd
          graph={[
            webPageLd({ lang, path: "/flood-map", name: sf("map.ldName"), description: sf("map.desc"), modified: newest, type: "CollectionPage" }),
            breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: sf("map.ldName"), path: "/flood-map" }], lang),
          ]}
        />
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{sf("map.ldName")}</span>
        </nav>
        <header className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{sf("map.h1")}</h1>
          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300 max-w-prose">{sf("map.lead")}</p>
          {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
        </header>

        {national.length > 0 && <SriLankaMap lang={lang} stations={national.map(compact)} />}

        <section className="mb-8" aria-labelledby="towns-h">
          <h2 id="towns-h" className="mb-2 text-base font-semibold tracking-tight">{sf("map.towns")}</h2>
          {watch.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">{sf("map.townsNone")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {watch.map(({ pl, st }) => (
                <li key={pl.slug}>
                  <Link href={p(`/flood/${pl.slug}`)} className="inline-flex items-center gap-2 min-h-11 sm:min-h-9 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm hover:border-sky-300 dark:hover:border-sky-700">
                    {sf("map.townLink", { town: pl.name })}
                    <TierPill label={tierLabel(t, st!.tone as "alert")} tier={st!.tone as PillTier} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2"><Link href={p("/flood")} className="inline-flex items-center min-h-11 text-sm text-sky-700 dark:text-sky-300 hover:underline">{sf("flood.h1")}</Link></p>
        </section>

        <section className="mb-8" aria-labelledby="past-h">
          <h2 id="past-h" className="mb-1 text-base font-semibold tracking-tight">{sf("map.past")}</h2>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400 max-w-prose">{sf("map.pastNote", { n: past.length })}</p>
          <ul className="flex flex-wrap gap-2">
            {riversWithMap.map((b) => (
              <li key={b}>
                <Link href={p(basinPath(b))} className="inline-flex items-center min-h-11 sm:min-h-9 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm hover:border-sky-300 dark:hover:border-sky-700">
                  {sf("map.rivers", { river: riverName(b, lang) })}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            {past.slice(0, 12).map((e) => sf("map.pastRow", { river: e.basin, year: e.year })).join(" · ")}
          </p>
        </section>

        <p className="text-xs text-slate-500 dark:text-slate-400">{t("footer.notOfficial")}</p>
      </div>
    </main>
  );
}
