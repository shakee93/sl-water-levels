// What we know about a reservoir whose gate releases are not published live (CEB / Mahaweli
// dams), as one compact chip: "92% full · 0.2 m below full · filling", with the source and day in
// the tooltip. Greyed when the reading is older than two days. Server component, no JavaScript.
import { ArrowUpToLine, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { MiniBar } from "./bits";
import type { KnownStatus } from "@/lib/reservoirStatusCalc";
import type { RT } from "@/lib/i18n/reservoirs";
import type { TFn } from "@/lib/i18n/translate";
import { shortDay } from "@/lib/i18n/format";

const srcName = (t: TFn, s: "Irrigation Department" | "Mahaweli Authority") => t(s === "Irrigation Department" ? "release.src.irrigation" : "release.src.mahaweli");

/** Plain-text explanation for the tooltip and screen readers: what is shown, where it comes from, and what is not published. */
export function knownTip(st: KnownStatus, rt: RT, t: TFn): string {
  const bits: string[] = st.ceb ? [rt("known.tip")] : [];
  if (st.storage) bits.push(rt("known.stor", { source: srcName(t, st.storage.source), date: shortDay(st.storage.day, t) }));
  if (st.trend && st.trend.dLevelM != null) bits.push(rt("known.moved", { n: `${st.trend.dLevelM > 0 ? "+" : ""}${st.trend.dLevelM.toFixed(2)}`, date: shortDay(st.trend.since, t) }));
  if (st.fsl) bits.push(rt("known.fsl", { m: st.fsl.m }));
  if (st.nearSpill) bits.push(rt("known.nearTip"));
  return bits.join(" ");
}

const TREND_ICON = { filling: TrendingUp, emptying: TrendingDown, steady: Minus } as const;

export function KnownChip({ st, rt, t, showPct = true, className = "" }: { st: KnownStatus; rt: RT; t: TFn; showPct?: boolean; className?: string }) {
  const stor = st.storage;
  const stale = !!stor && !stor.fresh;
  const trend = st.trend;
  const Icon = trend ? TREND_ICON[trend.kind] : null;
  const parts: string[] = [];
  if (showPct && stor) parts.push(rt("full", { n: Math.round(stor.pct) }));
  if (st.fsl) parts.push(st.fsl.below < 0.05 ? rt("known.atFull") : rt("known.below", { n: st.fsl.below.toFixed(1) }));
  const tip = knownTip(st, rt, t);
  if (parts.length === 0 && !trend) return null;
  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-2xl border px-2.5 py-0.5 text-xs font-medium tabular-nums ${stale ? "border-dashed border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500" : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200"} ${className}`}
      title={tip}
    >
      {showPct && stor && <span className="w-7"><MiniBar pct={stor.pct} stale={stale} /></span>}
      {parts.map((x, i) => <span key={i} className="whitespace-nowrap">{i > 0 && <span aria-hidden>· </span>}{x}</span>)}
      {stale && stor && <span className="whitespace-nowrap">({shortDay(stor.day, t)})</span>}
      {Icon && trend && !stale && (
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
          {parts.length > 0 && <span aria-hidden>· </span>}
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {rt(`known.${trend.kind}` as "known.filling")}
        </span>
      )}
      <span className="sr-only">. {tip}</span>
    </span>
  );
}

/** Amber outlined hint: storage is high and rising. Never says gates are open. */
export function NearSpillChip({ rt, className = "" }: { rt: RT; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-900 dark:text-amber-200 ${className}`}
      title={rt("known.nearTip")}
    >
      <ArrowUpToLine className="size-3.5 shrink-0" aria-hidden />
      {rt("known.near")}
      <span className="sr-only">. {rt("known.nearTip")}</span>
    </span>
  );
}
