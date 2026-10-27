import type { Metadata } from "next";
import { ogBase } from "@/lib/seoMeta";
import { seoFor } from "@/lib/i18n/seo";
import { notFound } from "next/navigation";
import { getHistory } from "@/lib/history";
import { HistoryUnavailable, HistoryView } from "@/app/history/HistoryView";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

// history.json on the data branch is rebuilt twice a day; re-render hourly.
// No searchParams here: old /history?scope=... links are redirected by proxy.ts, so this stays static.
export const revalidate = 3600;

import { SITE } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);
  const alternates = pageAlternates(lang, "/history");
  return {
    title: { absolute: seoFor(lang)("history.title") },
    description: t("hist.metaDesc"),
    alternates,
    openGraph: { ...ogBase(lang),
      title: t("hist.ogTitle"),
      description: t("hist.ogDesc"),
      url: `${SITE}${alternates.canonical}`,
      type: "website",
    },
  };
}

export default async function HistoryPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const data = await getHistory();
  if (!data) return <HistoryUnavailable lang={lang} />;
  return <HistoryView lang={lang} data={data} scope={{ kind: "all" }} />;
}
