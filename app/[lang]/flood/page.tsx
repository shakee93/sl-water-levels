import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PLACES } from "@/lib/places";
import { loadTownStates } from "@/lib/townData";
import { TONES, type Tone } from "@/lib/townRisk";
import { ttFor, type TKey } from "@/lib/i18n/town";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { TIER_DOT } from "@/app/tierUi";

export const revalidate = 600;
const SITE = "https://sl-water-levels.vercel.app";

// Rendered on first request, then ISR-cached: not at build time, so a deploy never waits on the gauge feed.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const tt = ttFor(lang);
  const alternates = pageAlternates(lang, "/flood");
  const title = tt("idx.title", { n: PLACES.length });
  const description = tt("idx.desc");
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const rank = (t: Tone) => TONES.indexOf(t);

export default async function FloodIndex({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const tt = ttFor(lang);
  const states = await loadTownStates(PLACES).catch(() => null);

  const districts = [...new Set(PLACES.map((x) => x.district))].sort();
  const watch = states
    ? PLACES.filter((x) => rank(states.get(x.slug)?.tone ?? "stale") >= rank("watch")).sort((a, b) => rank(states.get(b.slug)!.tone) - rank(states.get(a.slug)!.tone) || a.name.localeCompare(b.name))
    : [];

  const row = (x: (typeof PLACES)[number]) => {
    const tone = states?.get(x.slug)?.tone ?? "stale";
    return (
      <li key={x.slug}>
        <Link
          href={p(`/flood/${x.slug}`)}
          className="flex items-center gap-2.5 min-h-11 rounded-lg px-2 -mx-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span className={`size-2.5 shrink-0 rounded-full ${TIER_DOT[tone]}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-slate-900 dark:text-slate-100">{x.name}</span>
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400" lang={lang}>{tt(`tone.${tone}` as TKey)}</span>
        </Link>
      </li>
    );
  };

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
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">{tt("idx.h1")}</h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 dark:text-slate-400" lang={lang}>{tt("idx.lead")}</p>
          {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
        </header>

        {!states ? (
          <p className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">{tt("idx.empty")}</p>
        ) : (
          <>
            {watch.length > 0 && (
              <section className="mb-6 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/25 p-4" aria-label={tt("idx.watch")}>
                <h2 className="text-base font-semibold">{tt("idx.watch")}</h2>
                <ul className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{watch.map(row)}</ul>
              </section>
            )}
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{tt("idx.basis")}</p>
            <div className="grid gap-5">
              {districts.map((d) => {
                const list = PLACES.filter((x) => x.district === d).sort((a, b) => a.name.localeCompare(b.name));
                return (
                  <section key={d} aria-label={d} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <h2 className="flex items-baseline justify-between gap-2 text-base font-semibold">
                      {d}
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{tt("idx.count", { n: list.length })}</span>
                    </h2>
                    <ul className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{list.map(row)}</ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
