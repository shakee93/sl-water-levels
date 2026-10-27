import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getReservoirs, type RV } from "@/lib/reservoirData";
import { stationDisplayName } from "@/lib/displayName";
import { stationPath } from "@/lib/slug";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { rtFor } from "@/lib/i18n/reservoirs";
import { seoFor } from "@/lib/i18n/seo";
import { ogBase } from "@/lib/seoMeta";
import { breadcrumbLd, webPageLd, SITE, abs } from "@/lib/seo";
import { JsonLd } from "@/app/Answer";
import { RvCard } from "@/app/reservoirs/RvCard";

// "Which dam gates are open today": the already-cached reservoir data (Irrigation sheet + Mahaweli report, lib/releases.ts),
// filtered to spilling / releasing. No new request at render time.
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const sf = seoFor(lang);
  const alternates = pageAlternates(lang, "/reservoirs/spilling");
  const title = sf("spill.title");
  const description = sf("spill.desc");
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { ...ogBase(lang), title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const active = (r: RV) => r.status === "spilling" || r.status === "releasing";

export default async function SpillingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const rt = rtFor(lang);
  const sf = seoFor(lang);
  const data = await getReservoirs().catch(() => null);
  const live = (data?.items ?? []).filter(active);
  const byCusecs = (a: RV, b: RV) => (b.flow?.cusecs ?? 0) - (a.flow?.cusecs ?? 0) || a.name.localeCompare(b.name);
  const main = live.filter((r) => !r.barrage).sort(byCusecs);
  const barrages = live.filter((r) => r.barrage).sort(byCusecs);
  const modified = data?.checkedAt ?? null;

  const Item = ({ r }: { r: RV }) => (
    <li>
      <RvCard rv={r} lang={lang} />
      {r.gauges.length > 0 && (
        <p className="mt-1.5 px-1 text-xs text-slate-500 dark:text-slate-400">
          {sf("spill.below")}:{" "}
          {r.gauges.slice(0, 3).map((g, i) => (
            <span key={g.station}>
              {i > 0 && " · "}
              <Link href={p(stationPath(g.basin, g.station))} className="text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center min-h-11 sm:min-h-6">
                {sf("rivers.gaugeLink", { gauge: stationDisplayName(g.station) })}
              </Link>
            </span>
          ))}
        </p>
      )}
    </li>
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <JsonLd
          graph={[
            webPageLd({ lang, path: "/reservoirs/spilling", name: sf("spill.title"), description: sf("spill.desc"), modified, type: "CollectionPage" }),
            breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: rt("crumb"), path: "/reservoirs" }, { name: sf("spill.h1"), path: "/reservoirs/spilling" }], lang),
            { "@type": "ItemList", itemListElement: main.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.name, url: abs(lang, `/reservoirs/${r.slug}`) })) },
          ]}
        />
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <Link href={p("/reservoirs")} className="hover:underline inline-block py-3 -my-3">{rt("crumb")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{sf("spill.h1")}</span>
        </nav>
        <header className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{sf("spill.h1")}</h1>
          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300 max-w-prose">{sf("spill.lead")}</p>
          {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
        </header>

        {!data ? (
          <p className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">{rt("idx.outage")}</p>
        ) : main.length === 0 ? (
          <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm text-slate-700 dark:text-slate-300">{sf("spill.none")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">{main.map((r) => <Item key={r.slug} r={r} />)}</ul>
        )}

        {barrages.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{sf("spill.routine")}</h2>
            <ul className="grid gap-3 sm:grid-cols-2">{barrages.map((r) => <Item key={r.slug} r={r} />)}</ul>
          </section>
        )}

        <p className="mt-8">
          <Link href={p("/reservoirs")} className="inline-flex items-center min-h-11 text-sm text-sky-700 dark:text-sky-300 hover:underline">{sf("spill.all")} ({data?.items.length ?? 0})</Link>
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{rt("src.note")}</p>
      </div>
    </main>
  );
}
