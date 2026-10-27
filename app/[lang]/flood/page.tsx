import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ogBase } from "@/lib/seoMeta";
import { seoFor } from "@/lib/i18n/seo";
import { PLACES } from "@/lib/places";
import { loadTownStates } from "@/lib/townData";
import { ttFor, type TKey } from "@/lib/i18n/town";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import TownIndex from "@/app/flood/TownIndex";

export const revalidate = 600;
import { SITE } from "@/lib/seo";

// Rendered on first request, then ISR-cached: not at build time, so a deploy never waits on the gauge feed.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const sf = seoFor(lang);
  const alternates = pageAlternates(lang, "/flood");
  const title = sf("flood.title", { n: PLACES.length });
  const description = sf("flood.desc", { n: PLACES.length });
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { ...ogBase(lang), title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function FloodIndex({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const tt = ttFor(lang);
  const states = await loadTownStates(PLACES).catch(() => null);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: t("crumb.home"), item: SITE + p("/") },
                { "@type": "ListItem", position: 2, name: tt("crumb"), item: SITE + p("/flood") },
              ],
            }),
          }}
        />
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link>{" "}
          <span aria-hidden>›</span> <span className="text-slate-700 dark:text-slate-300">{tt("crumb")}</span>
        </nav>
        <header className="mb-5">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">{seoFor(lang)("flood.h1")}</h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 dark:text-slate-400" lang={lang}>{tt("idx.lead")}</p>
          <p className="mt-1"><Link href={p("/flood-map")} className="inline-flex items-center min-h-11 text-sm text-sky-700 dark:text-sky-300 hover:underline">{seoFor(lang)("map.link")}</Link></p>
          {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
        </header>

        {!states ? (
          <p className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">{tt("idx.empty")}</p>
        ) : (
          <TownIndex states={Object.fromEntries(states)} />
        )}
      </div>
    </main>
  );
}
