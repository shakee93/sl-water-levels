"use client";

import Link from "next/link";
import { ArrowRight, Compass, MapPin } from "lucide-react";
import { basinPath, stationPath } from "@/lib/slug";
import { riverName } from "@/lib/i18n/format";
import { useI18n } from "../LocaleProvider";

/** The 404 body. Client component only so it can read the page's language from context. */
export function NotFoundBody({
  stations,
  basins,
}: {
  stations: { station: string; basin: string }[];
  basins: string[];
}) {
  const { lang, t, p } = useI18n();
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
          <Compass className="size-3.5" />
          404
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("nf.title")}</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">{t("nf.body")}</p>

        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 font-medium">
            {t("nf.popular")}
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {stations.map((s) => (
              <li key={`${s.basin}|${s.station}`}>
                <Link
                  href={p(stationPath(s.basin, s.station))}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 hover:border-sky-400 dark:hover:border-sky-700 transition"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <MapPin className="size-3.5 text-slate-400 group-hover:text-sky-500 transition shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{s.station}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {riverName(s.basin, lang)}
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="size-3.5 text-slate-400 group-hover:text-sky-500 transition shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {basins.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 font-medium">
              {t("nf.allBasins")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {basins.map((b) => (
                <Link
                  key={b}
                  href={p(basinPath(b))}
                  className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1 text-xs text-slate-700 dark:text-slate-300 hover:border-sky-400 dark:hover:border-sky-700 transition"
                >
                  {riverName(b, lang)}
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="mt-10 text-sm">
          <Link href={p("/")} className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300 hover:underline">
            {t("nf.back")}
          </Link>
        </div>
      </div>
    </main>
  );
}
