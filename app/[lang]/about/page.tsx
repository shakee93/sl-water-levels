import Link from "next/link";
import type { Metadata } from "next";
import { Activity, AlertTriangle, Database, Lock } from "lucide-react";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { AboutTrust } from "@/app/AboutTrust";
import { FeedbackPrivacy } from "@/app/feedback/FeedbackPrivacy";
import { JsonLd } from "@/app/Answer";
import { breadcrumbLd, publisherLd, webPageLd, CONTENT_UPDATED, REPO } from "@/lib/seo";
import { MIN_CHECKS, bestWindow, figure, getAccuracy, newModelFigure, spanText } from "@/lib/accuracy";
import { getI18n } from "@/lib/i18n/server";

// Visitor statistics and privacy (Google Analytics added 27 Oct 2026). si/ta reviewed with the rest of the site's strings.
const PRIVACY = {
  en: {
    h: "Privacy and visitor statistics",
    p1: "No account, no sign-in. Your saved places, street level and location stay on your phone; alerts store only your browser's push address and the places you chose.",
    p2: "We count visits with Umami (no cookies) and Google Analytics (cookies; Google signals and ad features off) to see which pages help people. Nothing about you is sold or used for ads.",
  },
  si: {
    h: "පෞද්ගලිකත්වය සහ පැමිණීම් සංඛ්‍යාලේඛන",
    p1: "ගිණුමක් හෝ පුරනය වීමක් නැත. ඔබ සුරැකි ස්ථාන, වීදි මට්ටම සහ ස්ථානය ඔබේ දුරකථනයේ පමණක් රැඳේ; ඇඟවීම් සඳහා ඔබේ බ්‍රවුසරයේ push ලිපිනය සහ ඔබ තෝරාගත් ස්ථාන පමණක් ගබඩා වේ.",
    p2: "කුමන පිටු මිනිසුන්ට උදව් වේදැයි දැනගැනීමට අපි Umami (කුකීස් නැත) සහ Google Analytics (කුකීස්; Google signals සහ දැන්වීම් විශේෂාංග අක්‍රියයි) මගින් පැමිණීම් ගණන් කරමු. ඔබ ගැන කිසිවක් විකුණනු හෝ දැන්වීම් සඳහා භාවිත කරනු නොලැබේ.",
  },
  ta: {
    h: "தனியுரிமை மற்றும் வருகை புள்ளிவிவரம்",
    p1: "கணக்கு இல்லை, உள்நுழைவு இல்லை. நீங்கள் சேமித்த இடங்கள், தெரு மட்டம் மற்றும் இருப்பிடம் உங்கள் தொலைபேசியிலேயே இருக்கும்; எச்சரிக்கைகளுக்கு உங்கள் உலாவியின் push முகவரியும் நீங்கள் தேர்ந்த இடங்களும் மட்டுமே சேமிக்கப்படும்.",
    p2: "எந்தப் பக்கங்கள் மக்களுக்கு உதவுகின்றன என்பதை அறிய Umami (குக்கீகள் இல்லை) மற்றும் Google Analytics (குக்கீகள்; Google signals, விளம்பர அம்சங்கள் அணைக்கப்பட்டுள்ளன) மூலம் வருகைகளைக் கணக்கிடுகிறோம். உங்களைப் பற்றி எதுவும் விற்கப்படுவதில்லை, விளம்பரங்களுக்குப் பயன்படுத்தப்படுவதில்லை.",
  },
} as const;

export const revalidate = 3600;

import { SITE } from "@/lib/seo";

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
  const acc = await getAccuracy();
  const win = acc ? bestWindow(acc) : "all";
  const f1 = acc ? figure(acc.overall, 1, win) : null;
  const nm1 = acc ? newModelFigure(acc.overall, 1, win) : null;
  const nh =
    acc && f1
      ? {
          asOf: new Date(acc.asOf + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
          span: spanText(acc, win),
          f1,
          m: (h: number) => (figure(acc.overall, h, win)?.maeFt ?? 0).toFixed(1),
          b24: (figure(acc.overall, 24, win)?.bandFt ?? 0).toFixed(1),
          nm: nm1 && nm1.n >= MIN_CHECKS ? nm1 : null,
          since: new Date(acc.gaugeModelSince + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
        }
      : null;
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

          <div id="privacy" className="scroll-mt-20">
          <Card icon={<Lock className="size-5" />} title={PRIVACY[lang].h}>
            <p>{PRIVACY[lang].p1}</p>
            <p>{PRIVACY[lang].p2}</p>
          </Card>
          </div>

          <Card icon={<AlertTriangle className="size-5" />} title={t("about.levels.h")}>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>{t("tier.normal")}</strong>: {t("about.levels.normal")}
              </li>
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
              {nh ? (
                <>
                  <p>
                    {t("about.nh.p2", {
                      asOf: nh.asOf,
                      span: nh.span,
                      n: nh.f1.n,
                      g: nh.f1.gauges,
                      mae: (nh.f1.maeFt ?? 0).toFixed(2),
                      base: (nh.f1.baseMaeFt ?? 0).toFixed(2),
                      pct: nh.f1.inBandPct ?? 0,
                      dir: nh.f1.dirPct ?? 0,
                      dirb: nh.f1.dirSteadyPct ?? 0,
                    })}
                  </p>
                  <p>{t("about.nh.p3", { m3: nh.m(3), m6: nh.m(6), m12: nh.m(12), m24: nh.m(24), b24: nh.b24 })}</p>
                  {nh.nm && <p>{t("about.nh.p4", { since: nh.since, n: nh.nm.n, mae: (nh.nm.maeFt ?? 0).toFixed(2), base: (nh.nm.baseMaeFt ?? 0).toFixed(2) })}</p>}
                </>
              ) : (
                <p>{t("about.nh.unavail")}</p>
              )}
              <p>
                <a className="underline" href={`${REPO}/blob/main/DOCS.md`} target="_blank" rel="noreferrer">{t("about.nh.how")}</a>
                {" · "}
                <Link className="underline" href="/data#next-hour">{t("about.nh.data")}</Link>
                {lang !== "en" ? ` (${t("common.machineTranslated")})` : ""}
              </p>
            </Card>
          </div>

          <AboutTrust lang={lang} />
          <FeedbackPrivacy lang={lang} />

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
