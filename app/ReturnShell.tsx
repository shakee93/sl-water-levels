"use client";

// Mounted once in the page shell. (1) Registers the service worker (public/sw.js) for the offline last-known view and
// for alerts. (2) A quiet, dismissible "keep this on your phone" card, shown only after the visitor has come back on
// another day or has pinned a place, never in the installed app, and not again for 30 days once closed. The install
// state itself (browser prompt, iPhone steps, already installed) lives in InstallProvider; on the home page the card
// sits next to "Your places" instead (HomeInstallCard), so this floating one stays away from there.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Share, X } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { parsePins, PINS_KEY } from "@/lib/pins";
import { useI18n } from "./LocaleProvider";
import { useInstall } from "./InstallProvider";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const VISITS = "sl_visits";
const VISIT_DAY = "sl_visit_day";
const SHOW_AFTER_MS = 4_000;

const get = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
};

export function ReturnShell() {
  const { lang, p } = useI18n();
  const rt = rtFor(lang);
  const pathname = usePathname();
  const { canInstall, cardWanted, hasPrompt, install, dismissCard } = useInstall();
  const [eligible, setEligible] = useState(false);
  const [late, setLate] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // after load, so it never competes with the page itself
      const reg = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
      if (document.readyState === "complete") reg();
      else window.addEventListener("load", reg, { once: true });
    }
    // visits on different days
    const today = new Date().toISOString().slice(0, 10);
    if (get(VISIT_DAY) !== today) {
      set(VISIT_DAY, today);
      set(VISITS, String((Number(get(VISITS)) || 0) + 1));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read after hydration
    setEligible((Number(get(VISITS)) || 0) >= 2 || parsePins(get(PINS_KEY)).length > 0);
    const timer = setTimeout(() => setLate(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const onHome = pathname === p("/");
  if (!late || !eligible || !canInstall || !cardWanted || onHome) return null;

  return (
    <div
      role="region"
      aria-label={rt("ins.title")}
      lang={lang}
      className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 shadow-lg sm:bottom-3 sm:left-auto sm:right-4 sm:mx-0 sm:w-96"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{rt("ins.title")}</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{hasPrompt ? rt("ins.body") : <><Share className="mr-1 inline size-3.5 -mt-0.5" aria-hidden />{rt("ins.ios")}</>}</p>
        </div>
        <button type="button" onClick={dismissCard} aria-label={rt("ins.dismiss")} className={`-m-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => install("card")} className={`inline-flex min-h-11 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 ${ring}`}>
          <Download className="size-4" aria-hidden /> {hasPrompt ? rt("ins.add") : rt("ins.btn")}
        </button>
        <button type="button" onClick={dismissCard} className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
          {rt("ins.later")}
        </button>
      </div>
    </div>
  );
}
