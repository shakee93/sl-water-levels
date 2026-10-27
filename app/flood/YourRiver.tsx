// "Your river": the gauge(s) a town's verdict rests on, as a tappable card right under the verdict. Plain facts only:
// river, gauge, distance, level in feet, the gauge's own official step, trend and reading time. Server component, data
// comes from the page (the national snapshot is already cached by loadTown).
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, Minus } from "lucide-react";
import type { GaugeIn } from "@/lib/townRisk";
import type { NationalStation } from "@/lib/arcgis";
import { stationPath } from "@/lib/slug";
import { formatDelta, formatLevel } from "@/lib/units";
import { fallSummary, riseSummary } from "@/lib/levelNotes";
import { isTidalStation } from "@/lib/verdictLift";
import { clock, riverName } from "@/lib/i18n/format";
import { FALL_NOTE, ROSE_NOTE } from "@/app/verdict";
import { formatKm } from "@/lib/nearby";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";
import type { TT } from "@/lib/i18n/town";
import { colomboTime, STEADY_M_PER_H, tierLabel } from "@/app/tierUi";
import { TierPill, type PillTier } from "@/app/TierPill";

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 3) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts), r = hi - lo || 1;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * 100).toFixed(1)} ${(22 - ((v - lo) / r) * 20).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-16 shrink-0 text-sky-500" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Row({ g, nat, lang, t, tt, p, small }: { g: GaugeIn; nat: NationalStation | undefined; lang: Locale; t: TFn; tt: TT; p: (x: string) => string; small?: boolean }) {
  const tier: PillTier = g.tier === "watch" ? "normal" : (g.tier as PillTier);
  const rate = g.rate3hM;
  const Trend = rate == null || tier === "stale" ? null : Math.abs(rate) < STEADY_M_PER_H ? Minus : rate > 0 ? ArrowUp : ArrowDown;
  const trendWord = rate == null ? "" : Math.abs(rate) < STEADY_M_PER_H ? t("trend.steady") : rate > 0 ? t("trend.rising") : t("trend.falling");
  const spark = nat && !small ? nat.trend24h.filter((r) => r.water_level != null).map((r) => r.water_level as number) : [];
  const href = nat ? p(stationPath(nat.basin, nat.station)) : null;
  // Small notes, as on the gauge page (lib/levelNotes.ts): "Rose 7.9 ft in the last 9 hours", or at Alert and above "Falling: down 1.2 ft since the
  // peak at 3:40 pm". Same 3 h rate as the arrow beside the level, so the two never disagree. Notes only: the step above is the official one.
  const notes: string[] = [];
  if (nat && !small && g.unit != null && g.level != null && g.tier !== "stale" && !isTidalStation(nat.station) && rate != null) {
    const mpu = nat.metresPerUnit;
    const rise = rate > -STEADY_M_PER_H ? riseSummary(nat.trend24h, mpu) : null;
    const fall = ["alert", "minor", "major"].includes(g.tier) && rate < -STEADY_M_PER_H ? fallSummary(nat.trend24h, mpu) : null;
    if (rise) notes.push(ROSE_NOTE(formatDelta(rise.riseM / mpu, g.unit), rise.hours)[lang]);
    if (fall) notes.push(FALL_NOTE(formatDelta(fall.dropM / mpu, g.unit), clock(fall.peakTs, t))[lang]);
  }
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className={`truncate font-semibold text-slate-900 dark:text-slate-100 ${small ? "text-sm" : "text-base"}`}>{g.name}</div>
        <div className="truncate text-xs text-slate-600 dark:text-slate-400">{riverName(g.basin, lang)} · {tt("yr.km", { km: formatKm(g.km, t) })}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <TierPill label={tierLabel(t, g.tier === "watch" ? "normal" : g.tier)} tier={tier} />
          {g.level != null ? (
            <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {formatLevel(g.level, g.unit)}
              {Trend && <Trend className="size-4 text-slate-500 dark:text-slate-400" aria-label={trendWord} />}
            </span>
          ) : (
            <span className="text-xs text-slate-600 dark:text-slate-400">{tt("yr.noReading")}</span>
          )}
          {g.ts != null && <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{colomboTime(g.ts, t)}</span>}
        </div>
        {notes.map((n) => (
          <div key={n} className="mt-1 text-xs text-slate-600 dark:text-slate-400">{n}</div>
        ))}
      </div>
      <Spark pts={spark} />
      <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
    </>
  );
  const cls = `flex items-center gap-3 ${small ? "px-4 py-2.5 border-t border-slate-100 dark:border-slate-800" : "px-4 py-3"} min-h-11 hover:bg-slate-50 dark:hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500`;
  return href ? (
    <Link href={href} aria-label={tt("yr.open", { gauge: g.name })} className={cls}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function YourRiver({ primary, secondary, national, lang, t, tt, p }: { primary: GaugeIn | null; secondary: GaugeIn | null; national: NationalStation[]; lang: Locale; t: TFn; tt: TT; p: (x: string) => string }) {
  const rows = [primary, secondary].filter((g): g is GaugeIn => !!g);
  if (rows.length === 0) return null;
  const by = new Map(national.map((s) => [s.station, s]));
  return (
    <section aria-label={tt("yr.title")} className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <h2 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tt("yr.title")}</h2>
      {rows.map((g, i) => (
        <Row key={g.station} g={g} nat={by.get(g.station)} lang={lang} t={t} tt={tt} p={p} small={i > 0} />
      ))}
    </section>
  );
}
