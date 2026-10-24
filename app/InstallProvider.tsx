"use client";

// One place that knows whether this phone or browser can put the site on the Home Screen, so the floating card
// (ReturnShell), the header / phone-menu button, the home page card and the alerts hint all agree.
//  - Chrome / Edge / Android: the browser's own install prompt, saved from "beforeinstallprompt".
//  - iPhone / iPad: there is no prompt, so a small sheet shows the three taps (Safari) or says where to look (other browsers).
//  - Already running from the Home Screen: nothing is offered.
// Umami: pwa_prompt (outcome), pwa_installed, install_button (source, how).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Share, SquarePlus, X } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { trackEvent } from "@/lib/umami";
import { useI18n } from "./LocaleProvider";

const DISMISSED = "sl_install_dismissed"; // shared by the floating card and the home page card
const DISMISS_MS = 30 * 86_400_000;
const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

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

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
// iPadOS 13+ says "Macintosh" but has a touch screen
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// Chrome, Firefox, Edge, Opera and Google app on iOS; in-app browsers (Instagram, Facebook...) count as "not Safari" too
// Install prompts are for phones and tablets only; desktop browsers never see the card or button.
const isPhone = () =>
  isIos() || /android|mobile/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse) and (hover: none)").matches;
const isIosSafari = () => isIos() && !/crios|fxios|edgios|opios|gsa\/|fban|fbav|instagram|line\/|twitter/i.test(navigator.userAgent);

type Install = {
  /** can this visitor install right now (not installed, and a prompt or the iPhone steps exist) */
  canInstall: boolean;
  /** iPhone / iPad in Safari or another browser, not yet installed */
  iosNeedsInstall: boolean;
  /** the home page / floating card has not been closed in the last 30 days */
  cardWanted: boolean;
  hasPrompt: boolean;
  /** run the install: the browser prompt, or the iPhone sheet. `source` says which button it was. */
  install: (source: string) => void;
  dismissCard: () => void;
  /** from the saved prompt only, for the floating card's own button */
  installed: boolean;
};

const NONE: Install = { canInstall: false, iosNeedsInstall: false, cardWanted: false, hasPrompt: false, install: () => {}, dismissCard: () => {}, installed: false };
const Ctx = createContext<Install>(NONE);
/** The server HTML never has an install button, so a component that streams in late (the header) must also render
 *  nothing during its own hydration: it only sees the real state after its own first effect. */
export function useInstall(): Install {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read after hydration
    setMounted(true);
  }, []);
  const v = useContext(Ctx);
  return mounted ? v : NONE;
}

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [env, setEnv] = useState<{ ios: boolean; phone: boolean; safari: boolean; installed: boolean; dismissed: boolean } | null>(null);
  const [sheet, setSheet] = useState(false);
  const eventRef = useRef<InstallEvent | null>(null);

  useEffect(() => {
    const read = () => ({ ios: isIos(), phone: isPhone(), safari: isIosSafari(), installed: isStandalone(), dismissed: Date.now() - (Number(get(DISMISSED)) || 0) < DISMISS_MS });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read after hydration
    setEnv(read());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      eventRef.current = e as InstallEvent;
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => {
      set(DISMISSED, String(Date.now() + 10 * 365 * 86_400_000));
      setEvent(null);
      setSheet(false);
      setEnv((v) => (v ? { ...v, installed: true, dismissed: true } : v));
      trackEvent("pwa_installed");
    };
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => setEnv(read());
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    mq.addEventListener?.("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onMode);
    };
  }, []);

  const install = useCallback(async (source: string) => {
    const ev = eventRef.current;
    trackEvent("install_button", { source, how: ev ? "prompt" : "ios_sheet" });
    if (!ev) return setSheet(true);
    try {
      await ev.prompt();
      const choice = await ev.userChoice.catch(() => null);
      trackEvent("pwa_prompt", { outcome: choice?.outcome ?? "unknown", source });
      eventRef.current = null; // a prompt can only be used once
      setEvent(null);
      if (choice?.outcome === "dismissed") set(DISMISSED, String(Date.now()));
    } catch {
      /* the browser refused: nothing to do */
    }
  }, []);

  const dismissCard = useCallback(() => {
    set(DISMISSED, String(Date.now()));
    setEnv((v) => (v ? { ...v, dismissed: true } : v));
  }, []);

  const value = useMemo<Install>(() => {
    if (!env || env.installed) return { ...NONE, installed: !!env?.installed };
    const iosNeedsInstall = env.ios;
    return {
      canInstall: env.phone && (!!event || iosNeedsInstall),
      iosNeedsInstall,
      cardWanted: !env.dismissed,
      hasPrompt: !!event,
      install,
      dismissCard,
      installed: false,
    };
  }, [env, event, install, dismissCard]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {sheet && env && <IosSheet safari={env.safari} onClose={() => setSheet(false)} />}
    </Ctx.Provider>
  );
}

function IosSheet({ safari, onClose }: { safari: boolean; onClose: () => void }) {
  const { lang, t } = useI18n();
  const rt = rtFor(lang);
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      before?.focus?.();
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab" && panel.current) {
      const f = [...panel.current.querySelectorAll<HTMLElement>("button, a[href]")];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };

  const steps = [
    { icon: Share, title: rt("ins.s1"), body: rt("ins.s1b") },
    { icon: SquarePlus, title: rt("ins.s2"), body: rt("ins.s2b") },
    { icon: CircleCheck, title: rt("ins.s3"), body: rt("ins.s3b") },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" onKeyDown={onKey} lang={lang}>
      <div className="absolute inset-0 bg-slate-950/50" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ins-sheet-title"
        className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl text-slate-900 dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ins-sheet-title" className="text-lg font-semibold tracking-tight">{rt("ins.sheetTitle")}</h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{rt("ins.sheetIntro")}</p>
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label={rt("ins.dismiss")} className={`-mr-1.5 -mt-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <ol className="mt-3 space-y-2.5">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sky-600 dark:text-sky-300">
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-snug"><span className="text-slate-500 dark:text-slate-400">{i + 1}. </span>{title}</span>
                <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-400">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        {!safari && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{rt("ins.otherIos")}</p>}
        {lang !== "en" && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
        <button type="button" onClick={onClose} className={`mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 ${ring}`}>
          {rt("ins.dismiss")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
