import { ZoomableImage } from "./ZoomableImage";
import Link from "next/link";
import { ArrowRight, CloudRain, Gauge, Info, LifeBuoy, Phone, TrendingUp, TriangleAlert, Waves } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import type { Key } from "@/lib/i18n/en";

// Home page "How this site works": the illustrated river explainer as the centrepiece (its
// labels are English and too small to read on phones, so the four steps are also listed below
// it in the page language), then six short topic cards. Always open; #how-it-works links here.

const ITEMS: { id: string; Icon: typeof Gauge; t: Key; s: Key; d: Key }[] = [
  { id: "readings", Icon: Gauge, t: "how.readings.t", s: "how.readings.s", d: "how.readings.d" },
  { id: "levels", Icon: TriangleAlert, t: "how.levels.t", s: "how.levels.s", d: "how.levels.d" },
  { id: "forecast", Icon: TrendingUp, t: "how.forecast.t", s: "how.forecast.s", d: "how.forecast.d" },
  { id: "release", Icon: Waves, t: "how.release.t", s: "how.release.s", d: "how.release.d" },
  { id: "official", Icon: Phone, t: "how.official.t", s: "how.official.s", d: "how.official.d" },
  { id: "limits", Icon: Info, t: "how.limits.t", s: "how.limits.s", d: "how.limits.d" },
];

export async function HowItWorks({ lang, className = "mt-10 sm:mt-12" }: { lang: Locale; className?: string }) {
  const { t, p } = getI18n(lang);
  const steps: Key[] = ["how.step1", "how.step2", "how.step3", "how.step4"];
  return (
    <section aria-labelledby="how-title" className={className}>
      <div id="how-it-works" className="scroll-mt-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="px-4 pt-4 pb-2">
          <h2 id="how-title" className="text-base sm:text-lg font-semibold tracking-tight">{t("how.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("how.sub")}</p>
        </div>

        <div className="px-4 pb-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <ZoomableImage
              src="/how-it-works/river-explainer.jpg"
              alt={t("how.diagramAlt")}
              width={1920}
              height={1080}
              sizes="(min-width: 1024px) 960px, 100vw"
            />
          </div>
          <ol className={`${lang === "en" ? "sm:hidden " : ""}mt-2 grid grid-cols-4 gap-1 text-center text-[11px] sm:text-xs leading-tight text-slate-600 dark:text-slate-300`}>
            {steps.map((k, i) => (
              <li key={k} className="min-w-0 break-words">
                <span className="mb-1 mx-auto flex size-5 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-200 font-semibold" aria-hidden>
                  {i === 0 ? <CloudRain className="size-3" /> : i + 1}
                </span>
                {t(k)}
              </li>
            ))}
          </ol>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {ITEMS.map(({ id, Icon, t: title, s, d }) => (
              <li key={id}>
                <div className="flex h-full items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-3 py-2.5">
                  <Icon className="size-4 mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium">{t(title)}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t(s)}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t(d)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-4 flex flex-wrap gap-x-5 text-sm">
            <Link href={p("/about")} className="inline-flex items-center gap-1 min-h-11 sm:min-h-6 text-slate-600 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-300">
              {t("how.about")}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
            <Link href={p("/help")} className="inline-flex items-center gap-1 min-h-11 sm:min-h-6 text-slate-600 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-300">
              <LifeBuoy className="size-3.5" aria-hidden />
              {t("how.help")}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
