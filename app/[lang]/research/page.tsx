import Link from "next/link";
import type { Metadata } from "next";
import { ogBase } from "@/lib/seoMeta";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { JsonLd } from "@/app/Answer";
import { SITE, abs, breadcrumbLd, publisherLd, webPageLd } from "@/lib/seo";
import { WF_DESC, WF_I18N, WF_MODIFIED, WF_PATH, WF_TITLE } from "@/lib/research";

export const revalidate = 86400;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const X = WF_I18N[lang];
  const alternates = pageAlternates(lang, "/research");
  const title = X.indexH;
  return {
    title,
    description: X.indexIntro,
    alternates,
    openGraph: { ...ogBase(lang), title, description: X.indexIntro, url: `${SITE}${alternates.canonical}`, type: "website" },
  };
}

export default async function ResearchIndex({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { t, p } = getI18n(lang);
  const X = WF_I18N[lang];
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <JsonLd
        graph={[
          webPageLd({ lang, path: "/research", name: X.indexH, description: X.indexIntro, modified: Date.parse(`${WF_MODIFIED}T00:00:00+05:30`), type: "CollectionPage" }),
          {
            "@type": "ItemList",
            itemListElement: [{ "@type": "ListItem", position: 1, url: abs(lang, WF_PATH), name: WF_TITLE[lang] }],
          },
          breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: X.crumb, path: "/research" }], lang),
          publisherLd(),
        ]}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{X.crumb}</span>
        </nav>
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">{X.indexH}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">{X.indexIntro}</p>
        </header>
        <ul className="space-y-4">
          <li>
            <Link
              href={p(WF_PATH)}
              className="block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 transition hover:border-sky-300 dark:hover:border-sky-700 active:bg-slate-50 dark:active:bg-slate-800/60"
            >
              <span className="flex items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
                <span>
                  <span className="block text-base sm:text-lg font-semibold tracking-tight">{WF_TITLE[lang]}</span>
                  <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">{WF_DESC[lang]}</span>
                  <span className="mt-2 block text-xs text-slate-500 dark:text-slate-400">{X.updated} {WF_MODIFIED}</span>
                </span>
              </span>
            </Link>
          </li>
        </ul>
      </div>
    </main>
  );
}
