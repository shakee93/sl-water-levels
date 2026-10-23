import Link from "next/link";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath, stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { rtFor } from "@/lib/i18n/reservoirs";
import { FooterLangLinks } from "./FooterLangLinks";
import { statusT } from "@/lib/i18n/status";

export async function Footer({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    /* degrade gracefully */
  }

  // Rivers that have a page: a river with a single gauge goes straight to its station page.
  const rivers = (() => {
    const by = new Map<string, Station[]>();
    for (const s of stations) if (s.basin?.trim()) by.set(s.basin.trim(), [...(by.get(s.basin.trim()) ?? []), s]);
    return [...by.entries()]
      .map(([basin, list]) => {
        const names = new Set(list.map((x) => x.station));
        return { basin, href: names.size === 1 ? stationPath(basin, [...names][0]) : basinPath(basin) };
      })
      .sort((x, y) => x.basin.localeCompare(y.basin));
  })();

  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 sm:mt-12 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-8 grid gap-7 sm:gap-8 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            {t("site.name")}
          </h3>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
            {t("footer.blurb")}
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("footer.basins")}</h4>
          <ul className="grid grid-cols-2 gap-x-3 sm:block sm:space-y-1">
            {rivers.map((r) => (
              <li key={r.basin}>
                <Link href={p(r.href)} className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
                  {riverName(r.basin, lang)}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("footer.site")}</h4>
          <ul className="grid grid-cols-2 gap-x-3 sm:block sm:space-y-1">
            {[
              ["/", t("footer.home")],
              ["/reservoirs", rtFor(lang)("nav")],
              ["/history", t("footer.floodHistory")],
              ["/help", t("footer.floodHelp")],
              ["/about", t("footer.aboutMethod")],
              ["/status", statusT(lang)("footer")],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={p(href)} className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <a href="https://github.com/shakee93/sl-water-levels" target="_blank" rel="noreferrer" className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
                {t("footer.source")}
              </a>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("footer.data")}</h4>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-xs">{t("footer.credits")}</p>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs font-medium">{t("footer.notOfficial")}</p>
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2 text-xs text-slate-500 dark:text-slate-400">
          <p>{t("footer.copyright", { year })}</p>
          <FooterLangLinks lang={lang} label={t("lang.label")} />
        </div>
      </div>
    </footer>
  );
}
