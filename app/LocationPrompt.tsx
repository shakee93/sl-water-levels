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
    return (
      <div className="border-b border-slate-200 dark:border-slate-800 bg-sky-50/70 dark:bg-sky-950/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-2 sm:gap-3 text-sm">
          <MapPin className="size-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-200">
            {failed ? t("loc.failedBanner") : t("loc.seeRiver")}
          </span>
          <button type="button" onClick={request} disabled={requesting} className={`${primary} h-9 px-3 text-sm shrink-0`}>
            {requesting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("loc.use")}
          </button>
          <button type="button" onClick={dismiss} className={`${ghost} h-9 px-2.5 text-sm shrink-0`}>
            {t("loc.notNow")}
          </button>
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
      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
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
