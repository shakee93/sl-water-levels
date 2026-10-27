"use client";
// Small building blocks for the flood test map panel: segmented control, switch row, section title. Calm, compact, 8px grid.
import type { ReactNode } from "react";

export function Seg<T extends string | number>({ value, onChange, items, label, tone = "sky" }: { value: T; onChange: (v: T) => void; items: { v: T; t: string; disabled?: boolean }[]; label: string; tone?: "sky" | "amber" }) {
  const on = tone === "sky" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-600 dark:text-white dark:ring-slate-500" : "bg-white text-amber-900 shadow-sm ring-1 ring-amber-200 dark:bg-slate-600 dark:text-amber-100 dark:ring-amber-700";
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-800">
      {items.map((it) => (
        <button
          key={String(it.v)}
          type="button"
          role="radio"
          aria-checked={value === it.v}
          disabled={it.disabled}
          onClick={() => onChange(it.v)}
          className={`min-h-8 flex-1 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 ${value === it.v ? on : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}
        >
          {it.t}
        </button>
      ))}
    </div>
  );
}

export function SwitchRow({ icon, label, on, onChange, disabled, hint }: { icon: ReactNode; label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={hint}
      onClick={() => onChange(!on)}
      className="flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:text-slate-100 dark:hover:bg-slate-800"
    >
      <span className="text-slate-500 dark:text-slate-400" aria-hidden>{icon}</span>
      <span className="flex-1">{label}</span>
      <span aria-hidden className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-sky-600" : "bg-slate-300 dark:bg-slate-600"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="px-1.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</p>;
}

/** Frosted panel surface. */
export const GLASS = "border border-slate-200/80 bg-white/90 text-slate-900 shadow-lg backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/85 dark:text-slate-100";
export const ICON_BTN = `flex size-9 items-center justify-center rounded-lg ${GLASS} text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-200 dark:hover:bg-slate-800`;
