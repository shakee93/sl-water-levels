"use client";

// Light / Dark / System. Header: an icon button that opens a small radio menu (sm and up).
// Mobile sheet: a 3-way segmented control. Both write localStorage "sl_theme" through useTheme().
import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_CHOICES, type ThemeChoice } from "@/lib/theme";
import { useI18n } from "./LocaleProvider";
import { useTheme } from "./useTheme";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

function useLabels() {
  const { t } = useI18n();
  return {
    group: t("theme.label"),
    of: (c: ThemeChoice) => t(`theme.${c}` as "theme.light"),
  };
}

export function ThemeMenu() {
  const { choice, setChoice } = useTheme();
  const L = useLabels();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const Icon = ICON[choice];

  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, THEME_CHOICES.indexOf(choice));
    items.current[i]?.focus();
    const down = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
    // focus only when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(c: ThemeChoice) {
    setChoice(c);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKey(e: React.KeyboardEvent) {
    const n = THEME_CHOICES.length;
    const cur = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items.current[(cur + (e.key === "ArrowDown" ? 1 : n - 1)) % n]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items.current[n - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className="relative hidden sm:block" onKeyDown={open ? onKey : undefined}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${L.group}: ${L.of(choice)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center justify-center size-11 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition ${ring}`}
      >
        <Icon className="size-[18px]" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={L.group}
          className="absolute right-0 mt-1 w-40 z-50 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg py-1"
        >
          {THEME_CHOICES.map((c, i) => {
            const I = ICON[c];
            const on = c === choice;
            return (
              <button
                key={c}
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => pick(c)}
                data-umami-event="theme_change"
                data-umami-event-theme={c}
                className={`flex w-full items-center gap-2.5 min-h-11 px-3 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${ring} ${
                  on ? "font-semibold text-sky-700 dark:text-sky-300" : "text-slate-700 dark:text-slate-300"
                }`}
              >
                <I className="size-4" aria-hidden />
                {L.of(c)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ThemeSegmented() {
  const { choice, setChoice } = useTheme();
  const L = useLabels();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: React.KeyboardEvent, i: number) {
    const n = THEME_CHOICES.length;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i + n - 1) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    setChoice(THEME_CHOICES[next]);
  }

  return (
    <div>
      <h2 className="mt-3 mb-1 px-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{L.group}</h2>
      <div role="radiogroup" aria-label={L.group} className="grid grid-cols-3 gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
        {THEME_CHOICES.map((c, i) => {
          const I = ICON[c];
          const on = c === choice;
          return (
            <button
              key={c}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => setChoice(c)}
              onKeyDown={(e) => onKey(e, i)}
              data-umami-event="theme_change"
              data-umami-event-theme={c}
              className={`inline-flex items-center justify-center gap-1.5 min-h-11 rounded-md px-1 text-sm font-medium transition-colors ${ring} ${
                on
                  ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <I className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{L.of(c)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
