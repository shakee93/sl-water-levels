"use client";

// Language switch + the small client-side pieces that remember and suggest a language.
//
// One source of truth: the URL (/, /si, /ta). The visitor's choice is remembered in
// localStorage "sl_lang" and a (non-HttpOnly) cookie "sl_lang" for a year. proxy.ts reads the
// cookie to send a returning Sinhala/Tamil reader from an English URL to their language.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { LANG_COOKIE_MAX_AGE, LANG_KEY, isLocale, localePath, splitLocale, type Locale } from "@/lib/i18n/config";
import { useI18n } from "./LocaleProvider";

const SUGGEST_DISMISS = "sl_lang_suggest_dismissed";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

const OPTIONS: { id: Locale; label: string; aria: string; lang: string }[] = [
  { id: "en", label: "EN", aria: "English", lang: "en" },
  { id: "si", label: "සිං", aria: "සිංහල (Sinhala)", lang: "si" },
  { id: "ta", label: "த", aria: "தமிழ் (Tamil)", lang: "ta" },
];

const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked: the cookie still remembers */
    }
  },
};

const readCookie = (): string | null => {
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_KEY}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
};

/** Remember a language choice on this device. */
export function saveLang(lang: Locale) {
  ls.set(LANG_KEY, lang);
  document.cookie = `${LANG_KEY}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`;
  window.dispatchEvent(new Event("sl:lang"));
}

export function LangSwitch() {
  const { lang, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const { path } = splitLocale(pathname);

  function go(target: Locale, e?: React.MouseEvent) {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return; // let the browser open a new tab
    e?.preventDefault();
    saveLang(target);
    if (target === lang) return;
    window.dispatchEvent(new Event("sl:nav-start"));
    router.push(localePath(target, path) + window.location.search + window.location.hash);
  }

  function onKey(e: React.KeyboardEvent, i: number) {
    const n = OPTIONS.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    go(OPTIONS[next].id);
  }

  return (
    <div role="radiogroup" aria-label={t("lang.label")} className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
      {OPTIONS.map((o, i) => (
        <Link
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          href={localePath(o.id, path)}
          role="radio"
          aria-checked={lang === o.id}
          aria-label={o.aria}
          lang={o.lang}
          hrefLang={o.lang}
          prefetch={false}
          tabIndex={lang === o.id ? 0 : -1}
          onClick={(e) => go(o.id, e)}
          onKeyDown={(e) => onKey(e, i)}
          data-umami-event="language_switch"
          data-umami-event-lang={o.id}
          className={`inline-flex items-center justify-center h-10 sm:h-8 min-w-8 sm:min-w-9 px-1 sm:px-2 rounded text-sm sm:text-xs font-medium transition-colors ${ring} ${
            lang === o.id
              ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Mounted once in the layout.
 * - English page, saved Sinhala/Tamil choice in localStorage but no cookie (cookie cleared, or a
 *   pre-existing "sl_lang" from the old verdict-card toggle): restore the cookie and move to the saved
 *   language. When the cookie exists the proxy has already done this.
 * - English page, no saved choice, browser language is Sinhala/Tamil: a one-line dismissible suggestion.
 *   Never an automatic redirect from Accept-Language / navigator.language alone.
 */
export function LangSideEffects() {
  const { lang, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [suggest, setSuggest] = useState<Locale | null>(null);

  useEffect(() => {
    if (lang !== "en") return;
    const cookie = readCookie();
    const saved = ls.get(LANG_KEY);
    if (!cookie && (saved === "si" || saved === "ta")) {
      saveLang(saved);
      router.replace(localePath(saved, splitLocale(pathname).path) + window.location.search + window.location.hash);
      return;
    }
    if (cookie || (saved && isLocale(saved))) return; // already chose (even "en")
    if (ls.get(SUGGEST_DISMISS)) return;
    const nav = (navigator.language || "").toLowerCase();
    const pick: Locale | null = nav.startsWith("si") ? "si" : nav.startsWith("ta") ? "ta" : null;
    if (!pick) return;
    const id = setTimeout(() => setSuggest(pick), 0);
    return () => clearTimeout(id);
  }, [lang, pathname, router]);

  if (!suggest || lang !== "en") return null;
  const path = splitLocale(pathname).path;
  return (
    <div className="border-b border-slate-200 dark:border-slate-800 bg-sky-50/70 dark:bg-sky-950/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-3 text-sm">
        <Link
          href={localePath(suggest, path)}
          lang={suggest}
          onClick={() => saveLang(suggest)}
          className={`flex-1 min-w-0 truncate font-medium text-sky-800 dark:text-sky-200 hover:underline ${ring}`}
        >
          {t(suggest === "si" ? "lang.suggest.si" : "lang.suggest.ta")}
        </Link>
        <button
          type="button"
          aria-label={t("lang.suggest.dismiss")}
          onClick={() => {
            ls.set(SUGGEST_DISMISS, "1");
            setSuggest(null);
          }}
          className={`grid place-items-center size-8 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 ${ring}`}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
