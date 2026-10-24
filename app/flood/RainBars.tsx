"use client";
// The bars of the town rain chart. All words are made on the server (app/flood/TownRain.tsx); this part only
// handles pointing, touching and arrow keys, and shows the picked hour in a fixed-height line under the chart
// (so nothing moves and nothing is clipped at 375 px).
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type RainBarView = {
  key: number;
  /** 0..1 of the chart height */
  frac: number;
  /** tailwind colour classes for the fill */
  color: string;
  fut: boolean;
  /** e.g. "7–8 pm: 3.7 mm (moderate)" */
  label: string;
  /** e.g. "measured by satellite" */
  source: string;
};

const STRIPES = "repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 2px, transparent 2px 4px)";

export function RainBars({
  bars, ticks, times, nowIndex, nowLabel, unitLabel, hint, groupLabel, describedBy,
}: {
  bars: RainBarView[];
  ticks: { label: string; frac: number }[];
  times: { i: number; text: string }[];
  nowIndex: number;
  nowLabel: string;
  unitLabel: string;
  hint: string;
  groupLabel: string;
  describedBy: string;
}) {
  const n = bars.length;
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);

  const at = (e: PointerEvent) => {
    const r = plot.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setActive(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? nowIndex - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") { setActive(null); return; }
    if (next == null) return;
    e.preventDefault();
    setActive(next);
  };
  const pick = active != null ? bars[active] : null;

  return (
    <div>
      <div className="mt-3 flex h-6 items-start text-[11px] leading-none text-slate-500 dark:text-slate-400">
        <span>{unitLabel}</span>
      </div>
      <div className="relative pl-8">
        <div
          ref={plot}
          tabIndex={0}
          role="group"
          aria-label={groupLabel}
          aria-describedby={describedBy}
          onPointerDown={at}
          onPointerMove={at}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? nowIndex - 1)}
          onBlur={() => setActive(null)}
          className="relative h-32 touch-pan-y select-none rounded-sm border-b border-slate-300 dark:border-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          {ticks.map((t) => (
            <div key={t.label} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-slate-200 dark:border-slate-700/70" style={{ bottom: `${t.frac * 100}%` }}>
              <span className="absolute -left-8 w-7 -translate-y-1/2 text-right text-[11px] leading-none tabular-nums text-slate-500 dark:text-slate-400">{t.label}</span>
            </div>
          ))}
          <div className="absolute inset-0 flex items-end gap-px">
            {bars.map((b, i) => (
              <div key={b.key} aria-hidden className={`flex h-full flex-1 items-end ${i === active ? "bg-slate-200/70 dark:bg-slate-700/60" : ""}`}>
                <div
                  className={`w-full rounded-t-[1px] ${b.color}`}
                  style={{ height: `${b.frac * 100}%`, backgroundImage: b.fut ? STRIPES : undefined }}
                />
              </div>
            ))}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-dashed border-slate-500 dark:border-slate-400" style={{ left: `${(nowIndex / n) * 100}%` }}>
            <span className="absolute -top-4 left-0 -translate-x-1/2 rounded bg-slate-100 px-1 text-[11px] font-medium leading-4 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{nowLabel}</span>
          </div>
        </div>
        <div className="relative h-5" aria-hidden>
          {times.map((t) => (
            <span
              key={t.i}
              className="absolute top-1 whitespace-nowrap text-[11px] leading-none text-slate-500 dark:text-slate-400"
              style={{ left: `${(t.i / n) * 100}%`, transform: t.i === 0 ? undefined : "translateX(-50%)" }}
            >
              {t.text}
            </span>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="mt-1 min-h-10 text-sm tabular-nums text-slate-800 dark:text-slate-200 sm:min-h-5">
        {pick ? (
          <>
            {pick.label}
            <span className="text-slate-500 dark:text-slate-400"> · {pick.source}</span>
          </>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">{hint}</span>
        )}
      </p>
    </div>
  );
}
