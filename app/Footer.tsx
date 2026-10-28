import { Suspense } from "react";
import Link from "next/link";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath, stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { FooterLangLinks } from "./FooterLangLinks";
import { navGroups } from "@/lib/navGroups";

import { MADE_BY, STRIP } from "@/lib/i18n/footer";
import { IG_HANDLE, IG_URL, X_HANDLE } from "@/lib/seo";

// Phones (below sm) get a one-line strip instead of the big footer: apps do not have footers, and the links live in the
// More sheet. Both are plain server HTML switched by CSS, so crawlers still get the full footer's internal links.
// The strip needs no data, so it sits outside the Suspense that waits for the station list: nothing jumps in later.
export function Footer({ lang }: { lang: Locale }) {
  const s = STRIP[lang];
  return (
    <>
      {/* Phone strip only in the installed app; browsers (and crawlers) keep the full footer. */}
      <div className="app-footer-strip border-t border-slate-200 dark:border-slate-800 px-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-3 text-center text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        <p className="font-medium text-slate-600 dark:text-slate-300">{s.warn}</p>
        <p>
          {s.data}
          <span aria-hidden> · </span>
          {MADE_BY[lang]}{" "}
          <a href="https://x.com/shakeeb_x" target="_blank" rel="noreferrer" className="font-medium">@shakeeb_x</a>
        </p>
      </div>
      <div className="app-footer-full">
        <Suspense fallback={null}>
          <FullFooter lang={lang} />
        </Suspense>
      </div>
    </>
  );
}

async function FullFooter({ lang }: { lang: Locale }) {
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

        <div className="space-y-4">
          {navGroups(lang, t).map((g) => (
            <div key={g.id} className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{g.heading}</h4>
              <ul className="grid grid-cols-2 gap-x-3 sm:block sm:space-y-1">
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link href={p(it.href)} className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
                      {it.label}
                    </Link>
                  </li>
                ))}
                {g.id === "about" && (
                  <>
                    {X_HANDLE && (
                      <li>
                        <a href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer me" className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
                          X @{X_HANDLE}
                        </a>
                      </li>
                    )}
                    <li>
                      <a href={IG_URL} target="_blank" rel="noreferrer me" className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
                        Instagram @{IG_HANDLE}
                      </a>
                    </li>
                    <li>
                      <a href="https://github.com/shakee93/sl-water-levels" target="_blank" rel="noreferrer" className="inline-flex items-center min-h-11 sm:min-h-0 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
                        {t("footer.source")}
                      </a>
                    </li>
                  </>
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("footer.data")}</h4>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-xs">{t("footer.credits")}</p>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs font-medium">{t("footer.notOfficial")}</p>
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2 text-xs text-slate-500 dark:text-slate-400">
          <p>
            {t("footer.copyright", { year })}
            <span aria-hidden> · </span>
            {MADE_BY[lang]}{" "}
            <a href="https://x.com/shakeeb_x" target="_blank" rel="noreferrer" className="font-medium text-slate-600 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-300 transition">
              @shakeeb_x
            </a>
            {X_HANDLE && (
              <>
                <span aria-hidden> · </span>
                Automated updates:{" "}
                <a href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer me" className="font-medium text-slate-600 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-300 transition">
                  @{X_HANDLE}
                </a>
              </>
            )}
            <span aria-hidden> · </span>
            Instagram:{" "}
            <a href={IG_URL} target="_blank" rel="noreferrer me" className="font-medium text-slate-600 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-300 transition">
              @{IG_HANDLE}
            </a>
          </p>
          <FooterLangLinks lang={lang} label={t("lang.label")} />
        </div>
      </div>
    </footer>
  );
}
