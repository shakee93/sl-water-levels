import Link from "next/link";
import type { Metadata } from "next";
import { ogBase } from "@/lib/seoMeta";
import { seoFor } from "@/lib/i18n/seo";
import { ChevronDown, ExternalLink, Phone } from "lucide-react";
import {
  DONATING_SAFELY,
  EMERGENCY_CONTACTS,
  FAMILY_ABROAD,
  GUIDANCE,
  HELP_SOURCES,
  RELIEF_STEPS,
  WARNING_CHANNELS,
} from "@/lib/help";
import { DistrictPicker } from "@/app/help/HelpClient";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { shortDay } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";

export const revalidate = 86400;

import { SITE } from "@/lib/seo";
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const alternates = pageAlternates(lang, "/help");
  const title = seoFor(lang)("help.title");
  const description = seoFor(lang)("help.desc");
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { ...ogBase(lang), title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
  };
}

const BIG = ["dmc", "police", "ambulance"].map(
  (id) => EMERGENCY_CONTACTS.find((c) => c.id === id)!,
);
const HELP_CHECKED_ISO = "2026-10-22";
const GROUPS = {
  before: GUIDANCE.before.map((g) => g.id),
  during: GUIDANCE.during.map((g) => g.id),
  after: GUIDANCE.after.map((g) => g.id),
  relief: RELIEF_STEPS.map((g) => g.id),
};
const checkedDate = (t: TFn) => `${shortDay(HELP_CHECKED_ISO, t)} 2026`;

export default async function HelpPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { t, p } = getI18n(lang);
  const checked = checkedDate(t);
  const alternates = pageAlternates(lang, "/help");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: t("help.metaTitle"),
    description: t("help.metaDesc"),
    url: `${SITE}${alternates.canonical}`,
    inLanguage: lang,
    dateModified: HELP_CHECKED_ISO,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: EMERGENCY_CONTACTS.filter((c) => ["dmc", "police", "ambulance", "fire"].includes(c.id)).map(
        (c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.name}: ${c.number}`, url: c.source }),
      ),
    },
  };
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12 space-y-5 sm:space-y-6">
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{t("nav.help")}</span>
        </nav>

        <header>
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">{seoFor(lang)("help.h1")}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">{t("help.danger")}</p>
        </header>

        <section aria-labelledby="emergency-h">
          <h2 id="emergency-h" className="sr-only">{t("help.emergency")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {BIG.map((c, i) => (
              <a
                key={c.id}
                href={c.tel}
                className={
                  "flex items-center gap-3 rounded-xl p-4 transition " +
                  (i === 0
                    ? "sm:col-span-2 bg-sky-700 hover:bg-sky-800 text-white"
                    : "border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60")
                }
              >
                <Phone className="size-6 shrink-0" aria-hidden />
                <span className="flex-1">
                  <span className="block text-2xl font-semibold tabular-nums leading-tight">
                    {i === 0 ? t("help.callN", { n: c.number }) : c.number}
                  </span>
                  <span className={"block text-sm " + (i === 0 ? "text-sky-100" : "text-slate-500 dark:text-slate-400")}>
                    {t(`help.short.${c.id}` as "help.short.dmc")}
                  </span>
                </span>
              </a>
            ))}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{t("help.checked", { date: checked })}</p>
        </section>

        <DistrictPicker />

        <div className="space-y-3">
          <Acc title={t("help.before")} open items={GROUPS.before.map((id) => t(`g.${id}` as "g.b-docs"))} />
          <Acc title={t("help.during")} items={GROUPS.during.map((id) => t(`g.${id}` as "g.b-docs"))} />
          <Acc title={t("help.after")} items={GROUPS.after.map((id) => t(`g.${id}` as "g.b-docs"))} />
          <Acc title={t("help.relief")} items={GROUPS.relief.map((id) => t(`g.${id}` as "g.b-docs"))} note={t("help.reliefNote")} />
          <Acc title={t("help.abroad")} items={FAMILY_ABROAD.map((_, i) => t(`g.abroad${i + 1}` as "g.abroad1"))} />
          <Acc title={t("help.donating")} items={DONATING_SAFELY.map((_, i) => t(`g.donate${i + 1}` as "g.donate1"))} />
        </div>

        <section aria-labelledby="warn-h" className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h2 id="warn-h" className="text-lg font-semibold tracking-tight mb-3">{t("help.warnings")}</h2>
          <ul className="text-sm">
            {WARNING_CHANNELS.map((w) => (
              <li key={w.id}>
                {w.url ? (
                  <a href={w.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-h-11 text-sky-700 dark:text-sky-300 hover:underline">
                    {t(`help.warn.${w.id}` as "help.warn.met")} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  <Link href={p("/")} className="inline-flex items-center min-h-11 text-sky-700 dark:text-sky-300 hover:underline">{t(`help.warn.${w.id}` as "help.warn.met")}</Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <footer className="text-xs text-slate-500 dark:text-slate-400 space-y-2">
          <p>{t("help.footer", { date: checked })}</p>
          <details className="group">
            <summary className="cursor-pointer inline-flex items-center gap-1 min-h-11 hover:text-slate-700 dark:hover:text-slate-200">
              {t("help.sources")} <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              {HELP_SOURCES.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300">{t(`help.src.${s.key}` as "help.src.dmc")}</a>
                </li>
              ))}
            </ul>
            <p className="mt-2">{t("help.sourcesNote")}</p>
          </details>
        </footer>
      </div>
    </main>
  );
}

function Acc({ title, items, note, open }: { title: string; items: string[]; note?: string; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none p-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <ChevronDown className="size-5 text-slate-500 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 sm:px-5 pb-4 -mt-1">
        <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {items.map((t) => <li key={t}>{t}</li>)}
        </ul>
        {note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">{note}</p>}
      </div>
    </details>
  );
}
