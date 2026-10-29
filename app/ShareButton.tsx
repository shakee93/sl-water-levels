"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LevelGauge } from "./LevelGauge";
import { useI18n } from "./LocaleProvider";
import { DIR } from "./verdict";
import { ShareControl, type StoryRef } from "./StoryShare";
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleCheck, CircleHelp, Clock, Copy, Info, Minus, MessageCircle, Phone, Share2, Siren, Waves, Sparkles, Star, TriangleAlert, ListChecks } from "lucide-react";

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
export function StationActions({ href, name, text, story }: { href: string; name: string; text: string; story?: StoryRef }) {
  const { t } = useI18n();
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const saved = parse(raw).some((f) => f.href === href);

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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggleSave}
        aria-pressed={saved}
        aria-label={saved ? t("verdict.removeAria", { name }) : t("verdict.saveAria", { name })}
        className={`${iconBtn} ${ring}`}
      >
        <Star className={`size-5 ${saved ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden />
        <span className="hidden sm:inline">{saved ? t("verdict.saved") : t("verdict.save")}</span>
      </button>
      {story && <ShareControl href={href} name={name} text={text} story={story} />}
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
  const { lang: page, t } = useI18n();
  // The page's language; English when the advisory has no validated translation.
  const lang = page === "si" && si ? "si" : page === "ta" && ta ? "ta" : "en";
  const text = lang === "si" ? si : lang === "ta" ? ta : en;
  return (
    <div className="text-sm text-slate-600 dark:text-slate-400" data-advisory data-advisory-source={source}>
      <p lang={lang}>
        {experimental && (
          <span className="mr-2 inline-flex items-center rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            {t("verdict.experimental")}
          </span>
        )}
        {text ?? en}
      </p>
      {lang !== "en" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
    </div>
  );
}

// ---- the verdict card ---------------------------------------------------------------------
export type T3 = { en: string; si: string; ta: string };

/** A tile line "Title (small detail)" shows as a title with a smaller muted sub-line, so long tile texts stay short. */
function splitTile(text: string): { title: string; sub: string | null } {
  const m = /^(.+?) \((.+)\)$/.exec(text);
  if (!m) return { title: text, sub: null };
  const sub = m[2];
  return { title: m[1], sub: sub.charAt(0).toUpperCase() + sub.slice(1) };
}
export type VerdictTone = "normal" | "watch" | "alert" | "minor" | "major" | "none" | "stale";

export const TONE: Record<VerdictTone, { icon: typeof Clock; text: string; bar: string }> = {
  normal: { icon: CircleCheck, text: "text-emerald-700 dark:text-emerald-400", bar: "border-l-emerald-500" },
  watch: { icon: CircleCheck, text: "text-emerald-700 dark:text-emerald-400", bar: "border-l-emerald-500" }, // shown as Normal
  alert: { icon: TriangleAlert, text: "text-amber-700 dark:text-amber-400", bar: "border-l-amber-500" },
  minor: { icon: TriangleAlert, text: "text-orange-700 dark:text-orange-400", bar: "border-l-orange-600" },
  major: { icon: Siren, text: "text-red-700 dark:text-red-400", bar: "border-l-red-600" },
  none: { icon: Info, text: "text-slate-700 dark:text-slate-300", bar: "border-l-slate-300 dark:border-l-slate-600" },
  stale: { icon: Clock, text: "text-slate-600 dark:text-slate-400", bar: "border-l-slate-300 dark:border-l-slate-600" },
};

// Card surfaces per tone: calm states stay neutral; alert and above tint the
// whole card so the danger reads before any word does.
const SURFACE: Record<VerdictTone, { card: string; tile: string; action: string; call: string; divider: string }> = {
  normal: { card: "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900", tile: "bg-slate-50 dark:bg-slate-800/60", action: "bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100", call: "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900", divider: "border-slate-100 dark:border-slate-800" },
  watch: { card: "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900", tile: "bg-slate-50 dark:bg-slate-800/60", action: "bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100", call: "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900", divider: "border-slate-100 dark:border-slate-800" },
  alert: { card: "border-amber-300 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/25", tile: "bg-white/80 dark:bg-slate-900/60", action: "bg-amber-100 dark:bg-amber-900/40 text-amber-950 dark:text-amber-100", call: "bg-amber-500 text-amber-950 hover:bg-amber-400", divider: "border-amber-200 dark:border-amber-800/50" },
  minor: { card: "border-orange-300 dark:border-orange-700/60 bg-orange-50/60 dark:bg-orange-950/25", tile: "bg-white/80 dark:bg-slate-900/60", action: "bg-orange-100 dark:bg-orange-900/40 text-orange-950 dark:text-orange-100", call: "bg-orange-600 text-white hover:bg-orange-500", divider: "border-orange-200 dark:border-orange-800/50" },
  major: { card: "border-red-300 dark:border-red-700/60 bg-red-50/60 dark:bg-red-950/30", tile: "bg-white/80 dark:bg-slate-900/60", action: "bg-red-100 dark:bg-red-900/40 text-red-950 dark:text-red-100", call: "bg-red-600 text-white hover:bg-red-500", divider: "border-red-200 dark:border-red-800/50" },
  none: { card: "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900", tile: "bg-slate-50 dark:bg-slate-800/60", action: "bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100", call: "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900", divider: "border-slate-100 dark:border-slate-800" },
  stale: { card: "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900", tile: "bg-white dark:bg-slate-800/60", action: "bg-white dark:bg-slate-800/60 text-slate-900 dark:text-slate-100", call: "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900", divider: "border-slate-200 dark:border-slate-800" },
};

const TREND = {
  up: { icon: ArrowUp, tone: "text-amber-600 dark:text-amber-400", chip: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  down: { icon: ArrowDown, tone: "text-emerald-600 dark:text-emerald-400", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  steady: { icon: Minus, tone: "text-slate-500 dark:text-slate-400", chip: "bg-slate-200/70 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300" },
  unknown: { icon: CircleHelp, tone: "text-slate-400 dark:text-slate-500", chip: "bg-slate-200/70 text-slate-500 dark:bg-slate-700/60 dark:text-slate-400" },
} as const;

/** One "Next hour" / "Next 24 hours" tile: small label, an icon chip beside a short bold headline, and an optional muted sub-line. */
function Tile({ data, label, text, extra, Icon, chip, className }: { data: string; label: string | null; text: string; extra?: string | null; Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> | null; chip: string; className: string }) {
  const { title, sub } = splitTile(text);
  return (
    <div {...{ [data]: "" }} className={`rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 ${className}`}>
      {label && <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">{label}</p>}
      <div className="mt-1.5 flex flex-col items-start gap-1.5 sm:flex-row sm:gap-2.5">
        {Icon && (
          <span className={`sm:mt-0.5 grid size-7 sm:size-8 shrink-0 place-items-center rounded-lg ${chip}`}>
            <Icon className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-base sm:text-lg font-semibold leading-snug text-slate-900 dark:text-slate-50">{title}</p>
          {sub && <p className="mt-0.5 text-xs sm:text-sm leading-snug text-slate-500 dark:text-slate-400">{sub}</p>}
          {extra && <p data-minor-line className="mt-1 text-xs sm:text-sm leading-snug text-slate-600 dark:text-slate-300">{extra}</p>}
        </div>
      </div>
    </div>
  );
}

/** (i) beside the big level: tap or click opens a short plain explanation under the number; outside tap or Escape closes it. */
function LevelInfo({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={box} className="relative inline-flex">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${ring}`}>
        <Info className="size-5" aria-hidden />
      </button>
      {open && (
        <span role="note" className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-left text-sm font-normal leading-snug text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {text}
        </span>
      )}
    </span>
  );
}

export function VerdictCard({
  tone,
  verdict,
  direction,
  fact,
  factExtra,
  labels,
  factKind,
  tide,
  action,
  outlook,
  call,
  office,
  footer,
  level,
  levelInfo,
  gauge,
  share,
  note,
  moreNotes,
  children,
}: {
  tone: VerdictTone;
  verdict: T3;
  direction: T3 | null;
  fact: T3 | null;
  /** One more plain line under the Next 24 hours text ("Minor flood not expected in the next 24 hours"). Words only. */
  factExtra?: T3 | null;
  /** Optional muted labels shown before direction and fact ("Next hour:", "Next 24 hours:"). */
  labels?: { direction: T3 | null; fact: T3 | null };
  /** "ok" gives the Next 24 hours tile a green check (calm day); otherwise a clock. */
  factKind?: "ok" | "soon";
  /** Next hour is the tide, not the river: Waves icon instead of the steady dash. */
  tide?: boolean;
  action: T3 | null;
  /** The AI sentence with a round trend badge, shown by default under the forecast lines. */
  outlook?: { trend: "up" | "down" | "steady" | "unknown"; text: React.ReactNode } | null;
  /** Label for the 117 button; null hides the call buttons. */
  call: T3 | null;
  office: { label: string; tel: string } | null;
  footer: React.ReactNode;
  /** Current level with unit, shown large beside the verdict. */
  level?: string | null;
  /** What the big number is, in plain words (an (i) button beside it opens it): most visitors do not know a gauge reading. */
  levelInfo?: string | null;
  /** Horizontal gauge data; omitted when the gauge has no flood levels or no reading. */
  gauge?: React.ComponentProps<typeof LevelGauge> | null;
  share: { href: string; name: string; text: string; story?: StoryRef };
  /** The reason a near-alert gauge or town still reads Normal ("Near alert: 1.4 ft below the alert mark, rising"); small, under the verdict. */
  note?: string | null;
  /** Further small notes under the first (rose / falling since the peak / street water): same look, never change the tone. */
  moreNotes?: React.ReactNode[];
  children: React.ReactNode;
}) {
  const { lang, t } = useI18n();
  const look = SURFACE[tone];
  const btn =
    "inline-flex items-center justify-center gap-2 h-12 w-full rounded-lg px-4 text-base font-semibold transition-colors";
  const trend = outlook ? TREND[outlook.trend] : null;
  const TrendIcon = trend?.icon ?? null;
  // A gauge with no published flood levels (tone "none") has a level but no step: the headline is its direction ("Falling"), or "Level only",
  // with one plain line under it, instead of "No flood levels published" with an info icon (owner, 28 Oct 2026).
  const levelOnly = tone === "none" && level != null;
  const Icon = levelOnly && TrendIcon ? TrendIcon : TONE[tone].icon;
  const text = TONE[tone].text;
  const headline = levelOnly && outlook && outlook.trend !== "unknown" ? DIR[outlook.trend === "up" ? "rising" : outlook.trend === "down" ? "falling" : "steady"][lang] : verdict[lang];
  return (
    <section aria-label={t("verdict.aria")} data-tier={tone} className={`rounded-xl border ${look.card} shadow-sm`}>
      <div className="p-4 sm:p-6">
        {/* Freshness on the left, save / share on the right: one row, so the verdict starts high. */}
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-slate-500 dark:text-slate-400 tabular-nums">{footer}</p>
          <StationActions {...share} />
        </div>

        {/* The answer: verdict on the left, the number on the right. */}
        <div className="mt-3 sm:mt-4 flex items-end justify-between gap-3 sm:gap-4" lang={lang}>
          <h2 className={`flex min-w-0 items-center gap-2 text-2xl sm:text-3xl font-semibold tracking-tight ${text}`}>
            <Icon className="size-7 shrink-0" aria-hidden />
            {headline}
          </h2>
          {level && (
            <div className="relative shrink-0 text-right leading-tight">
              <p className="flex items-center justify-end gap-1.5">
                <span className="text-2xl sm:text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{level}</span>
                {levelInfo && <LevelInfo text={levelInfo} label={t("level.infoAria")} />}
              </p>
            </div>
          )}
        </div>

        {levelOnly && (
          <p data-verdict-note className="mt-1 text-sm text-slate-600 dark:text-slate-400" lang={lang}>
            {t("card.noLevels")}
          </p>
        )}

        {note && (
          <p data-verdict-note className="mt-1 text-sm text-slate-600 dark:text-slate-400" lang={lang}>
            {note}
          </p>
        )}

        {moreNotes?.map((n, i) => (
          <p key={i} data-verdict-note className="mt-1 text-sm text-slate-600 dark:text-slate-400" lang={lang}>
            {n}
          </p>
        ))}

        {gauge && <LevelGauge {...gauge} />}

        {(direction || fact) && (
          <div className={`mt-4 grid gap-2 sm:gap-3 ${lang === "en" ? "grid-cols-2" : "grid-cols-1 min-[430px]:grid-cols-2"}`} lang={lang}>
            {direction && (
              <Tile
                data="data-direction"
                label={labels?.direction ? labels.direction[lang].replace(/:$/, "") : null}
                text={direction[lang]}
                Icon={tide ? Waves : TrendIcon}
                chip={trend?.chip ?? ""}
                className={look.tile}
              />
            )}
            {fact && (
              <Tile
                data="data-fact"
                label={labels?.fact ? labels.fact[lang].replace(/:$/, "") : null}
                text={fact[lang]}
                extra={factExtra?.[lang] ?? null}
                Icon={factKind === "ok" ? CircleCheck : Clock}
                chip={factKind === "ok" ? TREND.down.chip : tone === "alert" || tone === "minor" || tone === "major" ? TREND.up.chip : TREND.steady.chip}
                className={look.tile}
              />
            )}
          </div>
        )}

        {action && (
          <p
            className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 sm:px-4 text-base font-medium ${look.action}`}
            lang={lang}
          >
            <ListChecks className="size-5 shrink-0" aria-hidden />
            {action[lang]}
          </p>
        )}

        {outlook && (
          <div className="mt-4 flex items-start gap-3 text-slate-600 dark:text-slate-400">
            <Sparkles className="size-4 shrink-0 mt-1 text-slate-400 dark:text-slate-500" aria-hidden />
            <div className="flex-1 min-w-0">{outlook.text}</div>
          </div>
        )}
        {/* The advisory sentence carries its own "machine-translated" note. */}
        {lang !== "en" && !outlook && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}

        {call && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a href="tel:117" className={`${btn} ${look.call} ${ring}`}>
              <Phone className="size-5" aria-hidden /> {call[lang]}
            </a>
            {office && (
              <a
                href={office.tel}
                className={`${btn} border border-slate-300 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 text-slate-900 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-800 ${ring}`}
              >
                <Phone className="size-5" aria-hidden /> {office.label}
              </a>
            )}
          </div>
        )}
      </div>
      <details className={`group border-t ${look.divider}`}>
        <summary
          className={`flex items-center justify-between gap-3 min-h-11 px-4 sm:px-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-b-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500`}
        >
          <span className="font-medium">{t("verdict.details")}</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="px-4 sm:px-6 pb-4 pt-2 space-y-3">{children}</div>
      </details>
    </section>
  );
}
