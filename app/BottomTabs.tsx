"use client";

// Phone navigation like a native app: five tabs pinned to the bottom, clear of the home indicator. Hidden from sm up,
// where the header carries the same links. "More" opens the menu sheet (Help, About, rivers, theme, install) in
// MobileMenu through the "sl:open-menu" event. The page keeps its own bottom padding in app/[lang]/layout.tsx.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, MapPin, Waves, History, Menu } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { rtFor as resFor } from "@/lib/i18n/reservoirs";
import { splitLocale } from "@/lib/i18n/config";
import { useI18n } from "./LocaleProvider";

export const OPEN_MENU_EVENT = "sl:open-menu";
const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

export function BottomTabs() {
  const { lang, t, p } = useI18n();
  const rt = rtFor(lang);
  const path = splitLocale(usePathname() || "/").path;
  const on = (base: string) => (base === "/" ? path === "/" : path === base || path.startsWith(base + "/"));

  const tabs = [
    { href: p("/"), label: rt("tab.home"), icon: House, active: path === "/", event: "tab_home" },
    { href: p("/flood"), label: rt("tab.towns"), icon: MapPin, active: on("/flood"), event: "tab_towns" },
    { href: p("/reservoirs"), label: resFor(lang)("nav"), icon: Waves, active: on("/reservoirs"), event: "tab_reservoirs" },
    { href: p("/history"), label: t("nav.history"), icon: History, active: on("/history"), event: "tab_history" },
  ];
  const item = "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[11px] font-medium leading-tight";

  return (
    <nav
      aria-label={rt("tab.label")}
      className="tabbar sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <ul className="flex">
        {tabs.map(({ href, label, icon: Icon, active, event }) => (
          <li key={href} className="flex min-w-0 flex-1">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              data-umami-event={event}
              className={`${item} ${ring} ${active ? "text-sky-700 dark:text-sky-300" : "text-slate-500 dark:text-slate-400"}`}
            >
              <Icon className="size-6" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
              <span className="max-w-full truncate">{label}</span>
            </Link>
          </li>
        ))}
        <li className="flex min-w-0 flex-1">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => window.dispatchEvent(new Event(OPEN_MENU_EVENT))}
            className={`${item} ${ring} text-slate-500 dark:text-slate-400`}
          >
            <Menu className="size-6" strokeWidth={1.75} aria-hidden />
            <span className="max-w-full truncate">{rt("tab.more")}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
