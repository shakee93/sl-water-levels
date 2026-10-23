"use client";

// Mounted once in the page shell. (1) Registers the service worker (public/sw.js) for the offline last-known view and
// for alerts. (2) A quiet, dismissible "keep this on your phone" card, shown only after the visitor has come back on
// another day or has pinned a place, never in the installed app, and not again for 30 days once closed.
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { trackEvent } from "@/lib/umami";
import { parsePins, PINS_KEY } from "@/lib/pins";
import { useI18n } from "./LocaleProvider";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const VISITS = "sl_visits";
const VISIT_DAY = "sl_visit_day";
const DISMISSED = "sl_install_dismissed";
const DISMISS_MS = 30 * 86_400_000;
const SHOW_AFTER_MS = 4_000;

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

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
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function ReturnShell() {
  const { lang } = useI18n();
  const rt = rtFor(lang);
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios] = useState(() => typeof navigator !== "undefined" && isIos());
  const [show, setShow] = useState(false);

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
    const eligible = () => (Number(get(VISITS)) || 0) >= 2 || parsePins(get(PINS_KEY)).length > 0;
    const dismissed = () => Date.now() - (Number(get(DISMISSED)) || 0) < DISMISS_MS;
    if (standalone() || dismissed()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => eligible() && !dismissed() && setShow(true), SHOW_AFTER_MS);
    };
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      arm();
    };
    const onInstalled = () => {
      setShow(false);
      set(DISMISSED, String(Date.now() + 10 * 365 * 86_400_000));
      trackEvent("pwa_installed");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (isIos()) arm();
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show || (!event && !ios)) return null;

  function close() {
    set(DISMISSED, String(Date.now()));
    setShow(false);
  }
  async function add() {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice.catch(() => null);
    trackEvent("pwa_prompt", { outcome: choice?.outcome ?? "unknown" });
    setShow(false);
    if (choice?.outcome === "dismissed") set(DISMISSED, String(Date.now()));
  }

  return (
    <div
      role="region"
      aria-label={rt("ins.title")}
      lang={lang}
      className="fixed inset-x-3 bottom-3 z-30 mx-auto max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 shadow-lg sm:left-auto sm:right-4 sm:mx-0 sm:w-96"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{rt("ins.title")}</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{event ? rt("ins.body") : <><Share className="mr-1 inline size-3.5 -mt-0.5" aria-hidden />{rt("ins.ios")}</>}</p>
        </div>
        <button type="button" onClick={close} aria-label={rt("ins.dismiss")} className={`-m-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-2.5 flex gap-2">
        {event && (
          <button type="button" onClick={add} className={`inline-flex min-h-11 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 ${ring}`}>
            <Download className="size-4" aria-hidden /> {rt("ins.add")}
          </button>
        )}
        <button type="button" onClick={close} className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
          {rt("ins.later")}
        </button>
      </div>
    </div>
  );
}
