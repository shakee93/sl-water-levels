"use client";

import { usePathname } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { useLocation } from "./useLocation";
import { useI18n } from "./LocaleProvider";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const primary = `inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 font-semibold transition-colors ${ring}`;
const ghost = `inline-flex items-center justify-center rounded-md text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors ${ring}`;

/**
 * Asks (politely, on a tap) for the visitor's location.
 * "card" is the home-page version; "banner" is the slim strip mounted in the layout for every other page.
 */
export function LocationPrompt({ variant }: { variant: "card" | "banner" }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { shouldAsk, requesting, failed, request, dismiss } = useLocation();
  // The home page shows the card instead of the banner.
  if (!shouldAsk || (variant === "banner" && /^\/(?:(?:en|si|ta)\/?)?$/.test(pathname))) return null;

  if (variant === "banner") {
    // Fixed to the bottom of the screen: it appears after the page has loaded, so it must not push
    // the content down. The safe-area padding keeps it clear of the home indicator.
    return (
      <div
        role="region"
        aria-label={t("loc.aria")}
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] sm:bottom-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_-2px_8px_rgba(15,23,42,0.08)] sm:pb-[env(safe-area-inset-bottom)]"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-2.5 sm:py-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-sm">
          <p className="flex min-w-0 flex-1 items-center gap-2 font-medium text-slate-800 dark:text-slate-200 leading-snug">
            <MapPin className="size-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
            {failed ? t("loc.failedBanner") : t("loc.seeRiver")}
          </p>
          <div className="grid grid-cols-[1fr_1.8fr] gap-2 sm:flex sm:shrink-0">
            <button type="button" onClick={dismiss} className={`${ghost} h-11 px-3 text-sm border border-slate-200 dark:border-slate-700 sm:border-0`}>
              {t("loc.notNow")}
            </button>
            <button type="button" onClick={request} disabled={requesting} className={`${primary} h-11 px-4 text-sm leading-tight`}>
              {requesting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("loc.use")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label={t("loc.aria")}
      className="mb-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4"
    >
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-9 shrink-0 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300">
          <MapPin className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{t("loc.seeRiver")}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {failed ? t("loc.failedCard") : t("loc.stays")}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1.8fr] gap-2 sm:flex sm:justify-end">
        <button type="button" onClick={dismiss} className={`${ghost} h-11 sm:h-9 px-4 text-sm border border-slate-200 dark:border-slate-700`}>
          {t("loc.notNow")}
        </button>
        <button type="button" onClick={request} disabled={requesting} className={`${primary} h-11 sm:h-9 px-4 text-sm`}>
          {requesting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
          {t("loc.use")}
        </button>
      </div>
    </section>
  );
}
