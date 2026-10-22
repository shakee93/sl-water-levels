"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, CircleCheck, Clock, Copy, Eye, Info, MessageCircle, Phone, Share2, Siren, Star, TriangleAlert } from "lucide-react";

const KEY = "sl_favourites";
const EVT = "sl:favourites";
type Fav = { href: string; name: string };

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const iconBtn =
  "inline-flex items-center justify-center gap-1.5 h-11 sm:h-9 min-w-11 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}
function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function parse(raw: string): Fav[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((f) => f && typeof f.href === "string") : [];
  } catch {
    return [];
  }
}

/** Share + save-as-favourite buttons for the status block. `text` is the share line without the URL. */
export function StationActions({ href, name, text }: { href: string; name: string; text: string }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const saved = parse(raw).some((f) => f.href === href);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const url = () => window.location.origin + href;
  const full = () => `${text} ${url()}`;

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: name, text, url: url() });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    setOpen((o) => !o);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(full());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the WhatsApp link still works */
    }
  }

  function toggleSave() {
    const list = parse(readRaw());
    const next = saved ? list.filter((f) => f.href !== href) : [...list, { href, name }];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(EVT));
  }

  return (
    <div className="flex items-center gap-2" ref={box}>
      <button
        type="button"
        onClick={toggleSave}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${name} from saved stations` : `Save ${name}`}
        className={`${iconBtn} ${ring}`}
      >
        <Star className={`size-5 ${saved ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden />
        <span className="hidden sm:inline">{saved ? "Saved" : "Save"}</span>
      </button>
      <div className="relative">
        <button type="button" onClick={share} aria-expanded={open} className={`${iconBtn} ${ring}`}>
          <Share2 className="size-5" aria-hidden />
          <span className="hidden sm:inline">Share</span>
          <span className="sm:hidden sr-only">Share</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 z-20 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(open ? full() : "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 min-h-11 px-3 rounded-md text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${ring}`}
            >
              <MessageCircle className="size-4" aria-hidden /> WhatsApp
            </a>
            <button
              type="button"
              onClick={copy}
              className={`flex w-full items-center gap-2 min-h-11 px-3 rounded-md text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${ring}`}
            >
              {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copied" : "Copy link and text"}
            </button>
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

// ---- advisory language toggle (EN | සිං | த) -------------------------------------------------
const LANG_KEY = "sl_lang";
const LANG_EVT = "sl:lang";
type Lang = "en" | "si" | "ta";

function langSub(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(LANG_EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(LANG_EVT, cb);
  };
}
function langSnap(): string {
  try {
    return localStorage.getItem(LANG_KEY) ?? "en";
  } catch {
    return "en";
  }
}

function useLang(avail: Lang[] = ["en", "si", "ta"]): [Lang, (l: Lang) => void] {
  const stored = useSyncExternalStore(langSub, langSnap, () => "en");
  const lang = (avail as string[]).includes(stored) ? (stored as Lang) : "en";
  const pick = (l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(LANG_EVT));
  };
  return [lang, pick];
}

const LANGS: { id: Lang; label: string; aria: string }[] = [
  { id: "en", label: "EN", aria: "English" },
  { id: "si", label: "සිං", aria: "Sinhala" },
  { id: "ta", label: "த", aria: "Tamil" },
];

function LangToggle({ lang, pick }: { lang: Lang; pick: (l: Lang) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: React.KeyboardEvent, i: number) {
    const n = LANGS.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    pick(LANGS[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div role="radiogroup" aria-label="Language" className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
      {LANGS.map((a, i) => (
        <button
          key={a.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={lang === a.id}
          aria-label={a.aria}
          tabIndex={lang === a.id ? 0 : -1}
          onClick={() => pick(a.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={`h-11 sm:h-8 min-w-11 sm:min-w-9 px-2.5 rounded text-xs font-medium transition-colors ${ring} ${
            lang === a.id
              ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** The AI advisory sentence (Details section). Follows the card's language choice; English when no translation. */
export function AdvisoryText({
  en,
  si,
  ta,
  experimental,
  source,
}: {
  en: string;
  si: string | null;
  ta: string | null;
  experimental: boolean;
  source: string;
}) {
  const [stored] = useLang();
  const lang: Lang = stored === "si" && si ? "si" : stored === "ta" && ta ? "ta" : "en";
  const text = lang === "si" ? si : lang === "ta" ? ta : en;
  return (
    <div className="text-sm text-slate-600 dark:text-slate-400" data-advisory data-advisory-source={source}>
      <p lang={lang}>
        {experimental && (
          <span className="mr-2 inline-flex items-center rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            Experimental
          </span>
        )}
        {text ?? en}
      </p>
      {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">machine-translated</p>}
    </div>
  );
}

// ---- the verdict card ---------------------------------------------------------------------
export type T3 = { en: string; si: string; ta: string };
export type VerdictTone = "normal" | "watch" | "alert" | "minor" | "major" | "none" | "stale";

const TONE: Record<VerdictTone, { icon: typeof Clock; text: string; bar: string }> = {
  normal: { icon: CircleCheck, text: "text-emerald-700 dark:text-emerald-400", bar: "border-l-emerald-500" },
  watch: { icon: Eye, text: "text-slate-900 dark:text-slate-100", bar: "border-l-slate-300 dark:border-l-slate-600" },
  alert: { icon: TriangleAlert, text: "text-amber-700 dark:text-amber-400", bar: "border-l-amber-500" },
  minor: { icon: TriangleAlert, text: "text-orange-700 dark:text-orange-400", bar: "border-l-orange-600" },
  major: { icon: Siren, text: "text-red-700 dark:text-red-400", bar: "border-l-red-600" },
  none: { icon: Info, text: "text-slate-700 dark:text-slate-300", bar: "border-l-slate-300 dark:border-l-slate-600" },
  stale: { icon: Clock, text: "text-slate-600 dark:text-slate-400", bar: "border-l-slate-300 dark:border-l-slate-600" },
};

export function VerdictCard({
  tone,
  verdict,
  direction,
  fact,
  labels,
  action,
  call,
  office,
  footer,
  share,
  children,
}: {
  tone: VerdictTone;
  verdict: T3;
  direction: T3 | null;
  fact: T3 | null;
  /** Optional muted labels shown before direction and fact ("Next hour:", "Next 24 hours:"). */
  labels?: { direction: T3 | null; fact: T3 | null };
  action: T3 | null;
  /** Label for the 117 button; null hides the call buttons. */
  call: T3 | null;
  office: { label: string; tel: string } | null;
  footer: string;
  share: { href: string; name: string; text: string };
  children: React.ReactNode;
}) {
  const [lang, pick] = useLang();
  const { icon: Icon, text, bar } = TONE[tone];
  const btn =
    "inline-flex items-center justify-center gap-2 h-11 w-full rounded-md px-4 text-sm font-semibold transition-colors";
  return (
    <section
      aria-label="Current status"
      data-tier={tone}
      className={`rounded-xl border border-l-4 ${bar} border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm`}
    >
      <div className="p-4 sm:p-5">
        {/* Controls sit above the verdict so the verdict, direction and forecast
            read as one block. */}
        <div className="flex items-center justify-between gap-2">
          <LangToggle lang={lang} pick={pick} />
          <StationActions {...share} />
        </div>
        <h2 className={`mt-3 flex items-center gap-2 text-xl font-semibold ${text}`} lang={lang}>
          <Icon className="size-6 shrink-0" aria-hidden />
          {verdict[lang]}
        </h2>
        <div className="mt-2 space-y-1 text-base text-slate-700 dark:text-slate-300" lang={lang}>
          {direction && (
            <p data-direction>
              {labels?.direction && <span className="text-slate-500 dark:text-slate-400">{labels.direction[lang]} </span>}
              {direction[lang]}
            </p>
          )}
          {fact && (
            <p data-fact>
              {labels?.fact && <span className="text-slate-500 dark:text-slate-400">{labels.fact[lang]} </span>}
              {fact[lang]}
            </p>
          )}
          {action && <p className="font-medium text-slate-900 dark:text-slate-100">{action[lang]}</p>}
        </div>
        {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">machine-translated</p>}
        {call && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <a
              href="tel:117"
              className={`${btn} bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 ${ring}`}
            >
              <Phone className="size-4" aria-hidden /> {call[lang]}
            </a>
            {office && (
              <a
                href={office.tel}
                className={`${btn} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}
              >
                <Phone className="size-4" aria-hidden /> {office.label}
              </a>
            )}
          </div>
        )}
      </div>
      <details className="group border-t border-slate-100 dark:border-slate-800">
        <summary
          className={`flex items-center justify-between gap-3 min-h-11 px-4 sm:px-5 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-b-xl ${ring}`}
        >
          <span className="tabular-nums">{footer}</span>
          <span className="inline-flex items-center gap-1 font-medium">
            Details
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        <div className="px-4 sm:px-5 pb-4 pt-2 space-y-3">{children}</div>
      </details>
    </section>
  );
}
