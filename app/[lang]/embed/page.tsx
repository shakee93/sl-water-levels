import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchStations } from "@/lib/arcgis";
import { PLACES } from "@/lib/places";
import { basinSlug, stationSlug } from "@/lib/slug";
import { stationDisplayName } from "@/lib/displayName";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { embedT } from "@/lib/i18n/embed";
import { riverName } from "@/lib/i18n/format";
import { ogBase } from "@/lib/seoMeta";
import { breadcrumbLd, webPageLd, SITE } from "@/lib/seo";
import { JsonLd } from "@/app/Answer";
import { EmbedBuilder, type BuilderLists } from "@/app/EmbedBuilder";

// The embed guide and builder for newsrooms. A normal, indexable page (the widgets themselves are noindex).
export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const e = embedT(lang);
  const alternates = pageAlternates(lang, "/embed");
  return {
    title: { absolute: `${e("e.title")} — Sri Lanka Water Levels` },
    description: e("e.desc"),
    alternates,
    openGraph: { ...ogBase(lang), title: e("e.title"), description: e("e.desc"), url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title: e("e.title"), description: e("e.desc") },
  };
}

export default async function EmbedGuide({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const e = embedT(lang);
  const stations = await fetchStations().catch(() => []);
  const rivers = new Map<string, string>();
  for (const s of stations) if (s.basin?.trim()) rivers.set(basinSlug(s.basin), s.basin.trim());
  const lists: BuilderLists = {
    rivers: [...rivers.entries()].map(([slug, basin]) => ({ slug, name: riverName(basin, lang), count: stations.filter((s) => s.basin.trim() === basin).length })).sort((a, b) => a.name.localeCompare(b.name)),
    gauges: stations
      .filter((s) => s.basin?.trim())
      .filter((s, i, all) => all.findIndex((x) => stationSlug(x.station) === stationSlug(s.station)) === i) // one entry per gauge address
      .map((s) => ({ slug: stationSlug(s.station), name: stationDisplayName(s.station), river: riverName(s.basin, lang) }))
      .sort((a, b) => a.river.localeCompare(b.river) || a.name.localeCompare(b.name)),
    towns: PLACES.map((x) => ({ slug: x.slug, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
  const sec = "mt-8 text-lg font-semibold";
  const li = "text-slate-700 dark:text-slate-300";
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 min-w-0 [overflow-wrap:anywhere]">
        <JsonLd
          graph={[
            webPageLd({ lang, path: "/embed", name: e("e.title"), description: e("e.desc") }),
            breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: e("e.nav"), path: "/embed" }], lang),
          ]}
        />
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{e("e.nav")}</span>
        </nav>
        <header>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{e("e.h1")}</h1>
          <p className="mt-2 max-w-2xl text-slate-600 dark:text-slate-400">{e("e.lead")}</p>
          {lang !== "en" && <p className="mt-1 text-xs text-slate-500">{t("common.machineTranslated")}</p>}
        </header>

        <h2 className={sec}>{e("e.exampleH")}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{e("e.exampleNote")}</p>
        <div className="mt-3 max-w-xl min-w-0">
          <iframe src={`/embed/river/kalu-ganga${lang !== "en" ? `?lang=${lang}` : ""}`} title="Kalu Ganga live river levels" width="100%" height="560" loading="lazy" style={{ border: 0, width: "100%", display: "block" }} />
        </div>

        <h2 id="builder" className={sec}>{e("e.howH")}</h2>
        <ol className="mt-2 list-decimal pl-5 space-y-1 text-sm">
          <li className={li}>{e("e.how1")}</li>
          <li className={li}>{e("e.how2")}</li>
          <li className={li}>{e("e.how3")}</li>
        </ol>
        <EmbedBuilder lists={lists} lang={lang} origin={SITE} />

        <h2 className={sec}>{e("e.widgetsH")}</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          {(["river", "gauge", "town", "now", "reservoirs", "ticker"] as const).map((w) => (
            <li key={w} className={li}>
              <span className="font-medium text-slate-900 dark:text-slate-100">{e(`wd.${w}.name` as "wd.river.name")}</span>
              {": "}
              {e(`wd.${w}.desc` as "wd.river.desc")} <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs break-all">{e(`wd.${w}.url` as "wd.river.url")}</code>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{e("e.addrOpts")}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{e("e.laterMap")}</p>

        <h2 className={sec}>{e("e.termsH")}</h2>
        <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
          <li className={li}>{e("e.terms1")}</li>
          <li className={li}>{e("e.terms2")}</li>
          <li className={li}>{e("e.terms3")}</li>
        </ul>

        <h2 className={sec}>{e("e.helpH")}</h2>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
          {e("e.help")}{" "}
          <a href="https://x.com/shakeeb_x" target="_blank" rel="noopener" className="underline underline-offset-2 text-sky-700 dark:text-sky-300">@shakeeb_x</a>
          {" · "}
          <Link href={p("/about")} className="underline underline-offset-2 text-sky-700 dark:text-sky-300">{e("e.aboutLink")}</Link>
        </p>
      </div>
    </main>
  );
}
