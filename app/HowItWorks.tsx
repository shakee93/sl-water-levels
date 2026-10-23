import Link from "next/link";
import { ArrowRight, CloudRain, Gauge, Info, LifeBuoy, Phone, TrendingUp, TriangleAlert, Waves, ChevronDown } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import type { Key } from "@/lib/i18n/en";
import { OpenOnHash } from "./OpenOnHash";

// Home page "How this site works": one river picture as the centrepiece, six short items, each
// with a one-line caption and the detail folded behind it. Collapsed by default; the
// #how-it-works anchor (linked from the release rows) opens it.

const ITEMS: { id: string; Icon: typeof Gauge; t: Key; s: Key; d: Key }[] = [
  { id: "readings", Icon: Gauge, t: "how.readings.t", s: "how.readings.s", d: "how.readings.d" },
  { id: "levels", Icon: TriangleAlert, t: "how.levels.t", s: "how.levels.s", d: "how.levels.d" },
  { id: "forecast", Icon: TrendingUp, t: "how.forecast.t", s: "how.forecast.s", d: "how.forecast.d" },
  { id: "release", Icon: Waves, t: "how.release.t", s: "how.release.s", d: "how.release.d" },
  { id: "official", Icon: Phone, t: "how.official.t", s: "how.official.s", d: "how.official.d" },
  { id: "limits", Icon: Info, t: "how.limits.t", s: "how.limits.s", d: "how.limits.d" },
];

function RiverDiagram({ alt }: { alt: string }) {
  const water = "fill-sky-400 dark:fill-sky-500";
  const riverLine = "stroke-sky-400 dark:stroke-sky-500";
  const ground = "fill-slate-200 dark:fill-slate-700";
  return (
    <svg viewBox="0 0 400 100" className="w-full h-auto" role="img" aria-label={alt}>
      {/* 1 rain on hills */}
      <path d="M0 80 L25 40 L50 66 L75 30 L100 80 Z" className={ground} />
      <g className="stroke-sky-500 dark:stroke-sky-400" strokeWidth="2" strokeLinecap="round">
        <path d="M18 8 l-3 8 M36 4 l-3 8 M54 8 l-3 8 M72 4 l-3 8 M27 18 l-3 8 M63 18 l-3 8" />
      </g>
      {/* 2 reservoir behind a dam */}
      <path d="M100 80 L100 50 Q125 42 150 50 L150 80 Z" className={water} opacity="0.85" />
      <rect x="146" y="44" width="8" height="38" rx="1" className="fill-slate-500 dark:fill-slate-400" />
      {/* river from the dam to the town */}
      <path d="M154 76 C 180 66, 200 88, 230 76 S 280 66, 310 78 S 360 80, 400 74" fill="none" className={riverLine} strokeWidth="6" strokeLinecap="round" />
      <path d="M100 80 H154" className={riverLine} strokeWidth="2" opacity="0" />
      {/* 3 gauges beside the river */}
      {[205, 262].map((x) => (
        <g key={x}>
          <rect x={x} y="50" width="4" height="24" className="fill-slate-600 dark:fill-slate-300" />
          <circle cx={x + 2} cy="48" r="5" className="fill-amber-500" />
        </g>
      ))}
      {/* 4 town */}
      <g className="fill-slate-500 dark:fill-slate-400">
        <path d="M322 62 l10 -9 l10 9 v14 h-20 Z" />
        <path d="M346 66 l9 -8 l9 8 v10 h-18 Z" />
        <path d="M368 60 l11 -10 l11 10 v16 h-22 Z" />
      </g>
      <rect x="0" y="86" width="400" height="14" className={ground} opacity="0.6" />
    </svg>
  );
}

export async function HowItWorks({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  const steps: Key[] = ["how.step1", "how.step2", "how.step3", "how.step4"];
  return (
    <section aria-labelledby="how-title" className="mt-10 sm:mt-12">
      <details open id="how-it-works" className="group scroll-mt-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <OpenOnHash id="how-it-works" />
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 min-h-11 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-lg">
          <span className="min-w-0">
            <h2 id="how-title" className="text-base sm:text-lg font-semibold tracking-tight">{t("how.title")}</h2>
            <span className="block text-sm text-slate-500 dark:text-slate-400">{t("how.sub")}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden />
        </summary>

        <div className="px-4 pb-4">
          <RiverDiagram alt={t("how.diagramAlt")} />
          <ol className="mt-1 grid grid-cols-4 gap-1 text-center text-[11px] sm:text-xs leading-tight text-slate-600 dark:text-slate-300">
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
                <details className="group/item h-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                  <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 min-h-11 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-lg">
                    <Icon className="size-4 mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t(title)}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t(s)}</span>
                    </span>
                    <ChevronDown className="size-3.5 mt-1 shrink-0 text-slate-400 transition group-open/item:rotate-180" aria-hidden />
                  </summary>
                  <p className="px-3 pb-3 pl-9 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t(d)}</p>
                </details>
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
      </details>
    </section>
  );
}
