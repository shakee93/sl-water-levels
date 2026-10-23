import Link from "next/link";
import { Waves, ChevronDown } from "lucide-react";
import { basinPath } from "@/lib/slug";
import { PlaceSearch } from "./PlaceSearch";
import { LangSwitch } from "./LanguageBar";
import { MobileMenu } from "./MobileMenu";
import { ThemeMenu } from "./ThemeSwitch";
import { HeaderInstall } from "./HeaderInstall";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { rtFor } from "@/lib/i18n/reservoirs";
import { getSearchStations, type SearchStation } from "./PlaceSearchData";

export async function Header({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  // Never throws: an empty list just means no basin menu / empty search.
  const stations: SearchStation[] = await getSearchStations();

  const basins = (() => {
    const set = new Set<string>();
    for (const s of stations) if (s.basin) set.add(s.basin);
    return [...set].sort();
  })();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-950/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-slate-950/70">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] h-14 flex items-center justify-between gap-2 sm:gap-3">
        <Link
          href={p("/")}
          className="group flex items-center gap-2 min-w-0 min-h-11 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          aria-label={t("site.homeAria")}
        >
          <span className="grid place-items-center size-7 shrink-0 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm group-hover:shadow transition">
            <Waves className="size-4" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-xs sm:text-[13px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 line-clamp-2 sm:truncate">
              {t("site.name")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 -mt-0.5 hidden sm:block">
              {t("site.tagline")}
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2 text-sm shrink-0">
          <PlaceSearch variant="header" stations={stations} />

          {basins.length > 0 && (
            <details className="relative group hidden sm:block">
              <summary
                className="list-none cursor-pointer select-none inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                {t("nav.basins")}
                <ChevronDown className="size-3.5 text-slate-400 group-open:rotate-180 transition" aria-hidden />
              </summary>
              <div className="absolute right-0 mt-1 w-56 z-50 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
                <ul className="py-1 max-h-80 overflow-y-auto">
                  {basins.map((b) => (
                    <li key={b}>
                      <Link
                        href={p(basinPath(b))}
                        data-umami-event="basin_nav_click"
                        data-umami-event-basin={b.trim()}
                        className="block px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-sky-700 dark:hover:text-sky-300 transition"
                      >
                        {riverName(b, lang)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

          <Link
            href={p("/reservoirs")}
            data-umami-event="reservoirs_nav_click"
            className="hidden sm:inline-block rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {rtFor(lang)("nav")}
          </Link>

          <Link
            href={p("/history")}
            data-umami-event="history_nav_click"
            className="hidden sm:inline-block rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {t("nav.history")}
          </Link>

          <Link
            href={p("/about")}
            data-umami-event="about_nav_click"
            className="hidden sm:inline-block rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {t("nav.about")}
          </Link>

          <Link
            href={p("/help")}
            data-umami-event="help_nav_click"
            className="hidden sm:inline-block rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {t("nav.help")}
          </Link>

          <a
            href="https://github.com/shakee93/sl-water-levels"
            target="_blank"
            rel="noreferrer"
            data-umami-event="github_click"
            className="hidden sm:inline-block rounded-md px-2.5 py-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition"
          >
            {t("nav.github")}
          </a>

          <HeaderInstall />

          {/* on phones the theme choice lives in the More sheet (bottom tab bar) */}
          <div className="hidden sm:block"><ThemeMenu /></div>

          <LangSwitch />

          <MobileMenu
            rivers={basins.map((b) => ({ href: p(basinPath(b)), label: riverName(b, lang), slug: b.trim() }))}
          />
        </nav>
      </div>
    </header>
  );
}
