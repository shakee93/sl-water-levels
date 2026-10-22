import Link from "next/link";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";

export async function Footer({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    /* degrade gracefully */
  }

  const basins = (() => {
    const set = new Set<string>();
    for (const s of stations) if (s.basin) set.add(s.basin);
    return [...set].sort();
  })();

  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 sm:mt-12 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-8 grid gap-6 sm:gap-8 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            {t("site.name")}
          </h3>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
            {t("footer.blurb")}
          </p>
        </div>

        <div className="space-y-2 order-last sm:order-none">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("footer.basins")}
          </h4>
          <ul className="grid grid-cols-2 gap-x-3 sm:block sm:space-y-1 sm:max-h-44 sm:overflow-y-auto sm:pr-2">
            {basins.length === 0 ? (
              <li className="text-slate-500 dark:text-slate-400 text-xs">
                {t("footer.loading")}
              </li>
            ) : (
              basins.map((b) => (
                <li key={b}>
                  <Link
                    href={p(basinPath(b))}
                    className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
                  >
                    {riverName(b, lang)}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("footer.site")}
          </h4>
          <ul className="sm:space-y-1">
            <li>
              <Link
                href={p("/")}
                className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                {t("footer.allBasinsStations")}
              </Link>
            </li>
            <li>
              <Link
                href={p("/about")}
                className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                {t("footer.aboutMethod")}
              </Link>
            </li>
            <li>
              <Link
                href={p("/help")}
                className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                {t("footer.floodHelp")}
              </Link>
            </li>
            <li>
              <a
                href="https://github.com/shakee93/sl-water-levels"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                {t("footer.source")}
              </a>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("footer.data")}
          </h4>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-xs">
            {t("footer.readingsPre")}
            <a
              className="underline decoration-slate-400/40 hover:text-slate-700 dark:hover:text-slate-200"
              href="https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0"
              target="_blank"
              rel="noreferrer"
            >
              {t("footer.irrigation")}
            </a>
            {t("footer.readingsPost")}
          </p>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-xs">
            {t("footer.notOfficial")}
          </p>
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <p>{t("footer.copyright", { year })}</p>
        </div>
      </div>
    </footer>
  );
}
