"use client";

// A slim context bar under the site header. Hidden while the page's own heading is on screen; once the heading has
// scrolled up out of view it slides in with the (shortened) breadcrumb and the one thing that matters on this page
// (verdict, level, storage...). The server page passes every string in as a prop: no fetching here. It is position:fixed,
// so showing or hiding it never moves the page. One IntersectionObserver on the page header, no scroll listeners.
// Anchors clear it through `html:has([data-sticky-context])` in globals.css.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp } from "lucide-react";

export type StickyTier = "normal" | "alert" | "minor" | "major" | "none" | "stale";
const PILL: Record<StickyTier, { dot: string; box: string }> = {
  normal: { dot: "bg-emerald-500", box: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
  alert: { dot: "bg-amber-500", box: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  minor: { dot: "bg-orange-500", box: "bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300" },
  major: { dot: "bg-red-500", box: "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300" },
  none: { dot: "bg-slate-400", box: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  stale: { dot: "bg-slate-400", box: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

export function StickyContext({
  crumbs,
  pill,
  bits = [],
  chip,
  backLabel,
  label,
}: {
  /** Shortened breadcrumb; the last one is the current page (no link). */
  crumbs: { label: string; href?: string }[];
  pill?: { label: string; tier: StickyTier };
  /** Plain facts after the pill: "5.42 ft", "5:04 pm", "62% full". */
  bits?: string[];
  /** Small amber chip, e.g. "Street water likely". */
  chip?: string;
  backLabel: string;
  label: string;
}) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h1 = document.querySelector("main h1");
    const target = h1?.closest("header") ?? h1;
    if (!target) return;
    const io = new IntersectionObserver(
      ([e]) => setShown(!e.isIntersecting && e.boundingClientRect.top < 0),
      { rootMargin: "-56px 0px 0px 0px" }, // the sticky site header is 56 px
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  const toTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const pd = pill ? PILL[pill.tier] : null;

  return (
    <div
      ref={ref}
      data-sticky-context
      aria-hidden={!shown}
      className={`fixed inset-x-0 top-14 z-30 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur transition-[transform,opacity,visibility] duration-200 motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100 visible" : "-translate-y-full opacity-0 invisible pointer-events-none"
      }`}
    >
      <div className="mx-auto flex h-9 max-w-4xl items-center gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
        <nav aria-label={label} className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={i} className={last ? "text-slate-700 dark:text-slate-300" : ""}>
                {i > 0 && <span aria-hidden> › </span>}
                {c.href && !last ? (
                  <Link href={c.href} tabIndex={shown ? 0 : -1} className="hover:underline">{c.label}</Link>
                ) : (
                  c.label
                )}
              </span>
            );
          })}
        </nav>
        {pill && pd && (
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${pd.box}`}>
            <span className={`size-2 rounded-full ${pd.dot}`} aria-hidden />
            {pill.label}
          </span>
        )}
        {chip && <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 ">{chip}</span>}
        {bits.length > 0 && (
          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-600 dark:text-slate-300">
            {bits.map((b, i) => (
              <span key={i}>{i > 0 && <span aria-hidden> · </span>}{b}</span>
            ))}
          </span>
        )}
        <button
          type="button"
          onClick={toTop}
          tabIndex={shown ? 0 : -1}
          aria-label={backLabel}
          title={backLabel}
          className="-mr-2 grid size-9 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
