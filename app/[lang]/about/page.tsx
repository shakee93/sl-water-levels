import Link from "next/link";
import type { Metadata } from "next";
import { Activity, AlertTriangle, Database } from "lucide-react";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { AboutTrust } from "@/app/AboutTrust";
import { JsonLd } from "@/app/Answer";
import { breadcrumbLd, publisherLd, webPageLd, CONTENT_UPDATED, REPO } from "@/lib/seo";
import { ACCURACY } from "@/lib/accuracy";
import { getI18n } from "@/lib/i18n/server";

export const revalidate = 86400;

const SITE = "https://sl-water-levels.vercel.app";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);
  const alternates = pageAlternates(lang, "/about");
  return {
    title: t("about.metaTitle"),
    description: t("about.metaDesc"),
    alternates,
    openGraph: {
      title: t("about.ogTitle"),
      description: t("about.ogDesc"),
      url: `${SITE}${alternates.canonical}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: t("about.ogTitle"),
      description: t("about.twDesc"),
    },
  };
}

export default async function AboutPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { t, p } = getI18n(lang);
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <JsonLd
        graph={[
          webPageLd({ lang, path: "/about", name: t("about.metaTitle"), description: t("about.metaDesc"), modified: Date.parse(CONTENT_UPDATED), type: "AboutPage" }),
          breadcrumbLd([{ name: t("crumb.allBasins"), path: "/" }, { name: t("nav.about"), path: "/about" }], lang),
          publisherLd(),
        ]}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">
            {t("crumb.allBasins")}
          </Link>{" "}
          <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{t("nav.about")}</span>
        </nav>

        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">{t("about.h1")}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">{t("about.intro")}</p>
        </header>

        <section className="space-y-5 sm:space-y-8">
          <div id="data-sources" className="scroll-mt-20">
          <Card icon={<Database className="size-5" />} title={t("about.src.h")}>
            <p>{t("about.src.p1")}</p>
            <p>{t("about.src.p2")}</p>
          </Card>
          </div>

          <Card icon={<AlertTriangle className="size-5" />} title={t("about.levels.h")}>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>{t("mark.alert")}</strong>: {t("about.levels.alert")}
              </li>
              <li>
                <strong>{t("mark.minor")}</strong>: {t("about.levels.minor")}
              </li>
              <li>
                <strong>{t("mark.major")}</strong>: {t("about.levels.major")}
              </li>
            </ul>
            <p>{t("about.levels.note")}</p>
          </Card>

          <Card icon={<Activity className="size-5" />} title={t("about.fc.h")}>
            <p>{t("about.fc.p1")}</p>
            <p>{t("about.fc.p2")}</p>
          </Card>

          <div id="next-hour" className="scroll-mt-20">
            <Card icon={<Activity className="size-5" />} title={t("about.nh.h")}>
              <p>{t("about.nh.p1")}</p>
              <p>
                {t("about.nh.p2", {
                  span: `${ACCURACY.from} – ${ACCURACY.to}`,
                  n: ACCURACY.model.checked,
                  g: ACCURACY.model.gauges,
                  mae: ACCURACY.model.maeFt.toFixed(2),
                  base: ACCURACY.model.noChangeMaeFt.toFixed(2),
                  pct: ACCURACY.model.inRangePct,
                  dir: ACCURACY.model.directionPct,
                  dirb: ACCURACY.model.noChangeDirectionPct,
                })}
              </p>
              <p>{t("about.nh.p3", { w: ACCURACY.model.rangeWidthFt })}</p>
              <p>
                <a className="underline" href={`${REPO}/blob/main/DOCS.md`} target="_blank" rel="noreferrer">{t("about.nh.how")}</a>
                {" · "}
                <Link className="underline" href="/data#next-hour">{t("about.nh.data")}</Link>
                {lang !== "en" ? ` (${t("common.machineTranslated")})` : ""}
              </p>
            </Card>
          </div>

          <AboutTrust lang={lang} />

          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 sm:p-5 text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-200 mb-1">{t("about.notOfficial")}</div>
            <p className="text-amber-800 dark:text-amber-300/90">
              {t("about.disc1")}
              <a className="underline" href="https://www.dmc.gov.lk/" target="_blank" rel="noreferrer">
                {t("about.dmc")}
              </a>
              {t("about.disc2")}
              <a className="underline" href="https://www.irrigation.gov.lk/" target="_blank" rel="noreferrer">
                {t("about.irrigation")}
              </a>
              {t("about.disc3")}
            </p>
          </div>

          <div className="text-sm text-slate-600 dark:text-slate-400">
            {t("about.code1")}
            <a
              className="underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300"
              href="https://github.com/shakee93/sl-water-levels"
              target="_blank"
              rel="noreferrer"
            >
              github.com/shakee93/sl-water-levels
            </a>
            {t("about.code2")}
          </div>
        </section>
      </div>
    </main>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
      <header className="flex items-center gap-2.5 mb-3">
        <span className="grid place-items-center size-9 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300">
          {icon}
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </header>
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        {children}
      </div>
    </article>
  );
}
