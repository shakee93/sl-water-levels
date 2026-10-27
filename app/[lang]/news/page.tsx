import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { ogBase } from "@/lib/seoMeta";
import { seoFor } from "@/lib/i18n/seo";
import { AlertTriangle, Info } from "lucide-react";
import { getNews, nowMs } from "@/lib/news";
import { NEWS_TAGS, type NewsTag } from "@/lib/newsClassify";
import { JsonLd } from "@/app/Answer";
import { NewsBoard } from "@/app/NewsBoard";
import { newsRows, rowLabels } from "@/app/newsRows";
import { breadcrumbLd, webPageLd, SITE } from "@/lib/seo";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { nwFor } from "@/lib/i18n/news";

// Rendered per request and cached by the CDN (next.config.ts), like the river and reservoir pages: the heading
// goes out at once and the list streams in behind it. The list itself comes from a 10-minute cache.

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const sf = seoFor(lang);
  const alternates = pageAlternates(lang, "/news");
  return {
    title: { absolute: sf("news.title") },
    description: sf("news.desc"),
    alternates,
    openGraph: { ...ogBase(lang), title: sf("news.title"), description: sf("news.desc"), url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary", title: sf("news.title"), description: sf("news.desc") },
  };
}

export default async function NewsPage({ params }: { params: Promise<{ lang: string }> }) {
  await connection();
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const nw = nwFor(lang);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{nw("crumb")}</span>
        </nav>
        <header className="mb-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{seoFor(lang)("news.h1")}</h1>
          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{nw("lead")}</p>
        </header>
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300" role="note">
          <Info className="size-4 mt-0.5 shrink-0 text-slate-500" aria-hidden />
          <p>{nw("notice")}</p>
        </div>
        <Suspense fallback={<div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 animate-pulse" aria-hidden />}>
          <NewsList lang={lang} />
        </Suspense>
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">{nw("languageNote")}</p>
      </div>
    </main>
  );
}

async function NewsList({ lang }: { lang: Locale }) {
  const nw = nwFor(lang);
  const data = await getNews().catch(() => null);
  if (!data) {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
        <p>{nw("outage")}</p>
      </div>
    );
  }
  const items = data.items;
  const serverNow = nowMs();
  const rows = await newsRows(items, lang);
  const tags = Object.fromEntries(NEWS_TAGS.map((x) => [x, nw(`tag.${x}` as "tag.Rain")])) as Record<NewsTag, string>;

  // An ItemList of links to the outlets' own pages: these are not our articles, so no NewsArticle markup.
  const graph = [
    webPageLd({ lang, path: "/news", name: nw("metaTitle"), description: nw("metaDesc"), modified: data.fetchedAt, type: "CollectionPage" }),
    breadcrumbLd([{ name: nw("crumb"), path: "/news" }], lang),
    {
      "@type": "ItemList",
      name: nw("h1"),
      numberOfItems: items.length,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: items.slice(0, 50).map((i, n) => ({ "@type": "ListItem", position: n + 1, url: i.url, name: i.title })),
    },
  ];

  return (
    <>
      <JsonLd graph={graph} />
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {items.length === 0 ? nw("empty") : items.length === 1 ? nw("countOne") : nw("count", { n: items.length })}
      </p>
      {items.length > 0 && (
        <NewsBoard
          rows={rows}
          serverNow={serverNow}
          labels={rowLabels(lang)}
          text={{ all: nw("all"), filters: nw("filters"), emptyTag: nw("emptyTag"), countShown: nw("countShown"), tags }}
        />
      )}
    </>
  );
}

