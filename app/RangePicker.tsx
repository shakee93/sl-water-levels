"use client";

import { useRef, useSyncExternalStore } from "react";
import { DAYS_OPTIONS, DEFAULT_DAYS, parseDays } from "@/lib/range";
import { trackEvent } from "@/lib/umami";

// The range lives in the URL (?days=) but is read on the client only, so the
// station page itself stays statically cacheable (ISR) and never touches
// searchParams. The server renders the default; the client corrects after hydration.
const EVENT = "sl:days";

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function snapshot(): number {
  return parseDays(new URLSearchParams(window.location.search).get("days")) ?? DEFAULT_DAYS;
}

export function useDays(): number {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_DAYS);
}

function setDays(value: number) {
  const url = new URL(window.location.href);
  if (value === DEFAULT_DAYS) url.searchParams.delete("days");
  else url.searchParams.set("days", String(value));
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(EVENT));
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

export function RangePicker() {
  const current = useDays();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(value: number) {
    if (value === current) return;
    trackEvent("range_change", { days: value });
    setDays(value);
  }

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const n = DAYS_OPTIONS.length;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    select(DAYS_OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="History range"
      className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 p-0.5"
    >
      {DAYS_OPTIONS.map((opt, i) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${opt.value} ${opt.value === 1 ? "day" : "days"}`}
            tabIndex={active ? 0 : -1}
            onClick={() => select(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`h-11 sm:h-9 min-w-12 px-3 text-sm font-medium tabular-nums rounded transition-colors ${focusRing} ${
              active
                ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
          >
            {opt.value}d
          </button>
        );
      })}
    </div>
  );
}
