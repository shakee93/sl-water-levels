import Link from "next/link";
import { Waves } from "lucide-react";
import { basinPath, basinSlug } from "@/lib/slug";
import { PlaceSearch } from "./PlaceSearch";
import { LangSwitch } from "./LanguageBar";
import { MobileMenu } from "./MobileMenu";
import { ThemeMenu } from "./ThemeSwitch";
import { HeaderInstall } from "./HeaderInstall";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { rtFor } from "@/lib/i18n/reservoirs";
import { nwFor } from "@/lib/i18n/news";
import { HeaderNavLink } from "./HeaderNavLink";
import { ttFor } from "@/lib/i18n/town";
import { getSearchStations, type SearchStation } from "./PlaceSearchData";
import { X_HANDLE } from "@/lib/seo";
import { XLogo } from "./XLogo";
import { BasinsMenu, type BasinItem } from "./BasinsMenu";
import { RIVERS } from "@/lib/places";
import { tierRank } from "./tierUi";
import type { Tier } from "@/lib/arcgis";

export async function Header({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  // Never throws: an empty list just means no basin menu / empty search.
  const stations: SearchStation[] = await getSearchStations();

  const basins = (() => {
    const set = new Set<string>();
    for (const s of stations) if (s.basin) set.add(s.basin);
    return [...set].sort();
  })();

  // Worst official step and gauge count per basin, from the same cached national fetch as the search list (no new request).
  const basinItems: BasinItem[] = basins.map((b) => {
    const g = stations.filter((s) => s.basin === b);
    const worst = g.reduce<Tier>((w, s) => (tierRank(s.tier) < tierRank(w) ? s.tier : w), "stale");
    const aliases = RIVERS.find((r) => r.basin === b)?.aliases ?? [];
    return {
      basin: b,
      slug: basinSlug(b),
      label: riverName(b, lang),
      href: p(basinPath(b)),
      tier: worst === "watch" ? "normal" : worst,
      n: g.length,
      search: [b, riverName(b, lang), ...aliases].join(" "),
    };
  });

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-950/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-slate-950/70">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] h-14 flex items-center justify-between gap-2 sm:gap-3">
        <Link
          href={p("/")}
          className="group flex items-center gap-2 min-w-0 sm:shrink-0 min-h-11 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          aria-label={t("site.homeAria")}
        >
          <span className="grid place-items-center size-7 shrink-0 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm group-hover:shadow transition">
            <Waves className="size-4" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-xs sm:text-[13px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 line-clamp-2 sm:line-clamp-none sm:whitespace-nowrap">
              {t("site.name")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 -mt-0.5 hidden sm:block whitespace-nowrap">
              {t("site.tagline")}
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2 text-sm shrink-0">
          <PlaceSearch variant="header" stations={stations} />

          {basinItems.length > 0 && <BasinsMenu items={basinItems} label={t("nav.basins")} />}

          <HeaderNavLink href={p("/flood")} label={ttFor(lang)("crumb")} section="towns" event="towns_nav_click" />
          <HeaderNavLink href={p("/reservoirs")} label={rtFor(lang)("nav")} section="reservoirs" event="reservoirs_nav_click" />
          <HeaderNavLink href={p("/news")} label={nwFor(lang)("nav")} section="news" event="news_nav_click" />
          <HeaderNavLink href={p("/help")} label={t("nav.help")} section="help" event="help_nav_click" />

          {X_HANDLE && (
            <a
              href={`https://x.com/${X_HANDLE}`}
              target="_blank"
              rel="noreferrer me"
              data-umami-event="x_click"
              aria-label={`Live updates on X: @${X_HANDLE}`}
              title={`Live updates on X: @${X_HANDLE}`}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition"
            >
              <XLogo className="size-3.5" />
              <span>@{X_HANDLE}</span>
            </a>
          )}

          <HeaderInstall />

          {/* on phones the theme choice lives in the More sheet (bottom tab bar) */}
          <div className="hidden sm:block"><ThemeMenu /></div>

          <LangSwitch />

          <MobileMenu
            xHandle={X_HANDLE}
            rivers={basins.map((b) => ({ href: p(basinPath(b)), label: riverName(b, lang), slug: b.trim(), urlSlug: basinSlug(b) }))}
          />
        </nav>
      </div>
    </header>
  );
}
