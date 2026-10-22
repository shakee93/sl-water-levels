import Link from "next/link";
import { ArrowDown, ArrowUp, Clock, Minus, TriangleAlert } from "lucide-react";
import type { NationalStation, Tier } from "@/lib/arcgis";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import { TimeAgo } from "./TimeAgo";
import { STEADY_M_PER_H, tierLabel } from "./tierUi";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";

type Style = { pill: string; bar: string; line: string; dot: string };

// Same palette as NeedsAttention. Pills: dark text on the light fills for AA contrast.
const STYLE: Partial<Record<Tier, Style>> = {
  major: { pill: "bg-red-700 text-white", bar: "bg-red-500", line: "#dc2626", dot: "bg-red-500" },
  minor: { pill: "bg-orange-700 text-white", bar: "bg-orange-500", line: "#ea580c", dot: "bg-orange-500" },
  alert: { pill: "bg-amber-400 text-amber-950", bar: "bg-amber-500", line: "#d97706", dot: "bg-amber-500" },
  watch: { pill: "bg-yellow-300 text-yellow-950", bar: "bg-yellow-400", line: "#ca8a04", dot: "bg-yellow-400" },
};
const QUIET: Style = { pill: "", bar: "bg-sky-500", line: "#64748b", dot: "bg-slate-400 dark:bg-slate-500" };

const ROW_BORDER: Partial<Record<Tier, string>> = {
  major: "border-red-300 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30",
  minor: "border-orange-300 dark:border-orange-900 bg-orange-50/70 dark:bg-orange-950/30",
  alert: "border-amber-300 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30",
  watch: "border-yellow-300 dark:border-yellow-900 bg-yellow-50/60 dark:bg-yellow-950/20",
};

function Sparkline({ t, s, color }: { t: TFn; s: NationalStation; color: string }) {
  const vals = s.trend24h.map((r) => r.water_level).filter((v): v is number => v != null);
  if (vals.length < 3) return <span className="w-16 shrink-0" aria-hidden />;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, 1e-6);
  const W = 64;
  const H = 22;
  const pts = vals
    .map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-16 h-[22px] shrink-0" role="img" aria-label={t("gauges.last24")}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ThresholdBar({ t, s, bar }: { t: TFn; s: NationalStation; bar: string }) {
  const level = s.latest?.water_level;
  const { alert, minor, major } = s.thresholds;
  const top = major ?? minor ?? (alert != null ? alert * 1.5 : null);
  if (level == null || top == null || top <= 0) return null;
  const scaleMax = Math.max(top, level * 1.05);
  const at = (v: number | null) => (v == null ? null : Math.max(0, Math.min(100, (v / scaleMax) * 100)));
  const ticks = ([[t("mark.alert"), alert], [t("mark.minor"), minor], [t("mark.major"), major]] as const)
    .map(([label, v]) => ({ label, v, pos: at(v) }))
    .filter((t) => t.pos != null && t.pos > 0 && t.pos < 100);
  return (
    <div
      className="relative h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
      role="img"
      aria-label={t("bar.aria", { level, alert: alert ?? t("common.na"), minor: minor ?? t("common.na"), major: major ?? t("common.na") })}
    >
      <div className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${at(level)}%` }} />
      {ticks.map((t) => (
        <span
          key={t.label}
          title={`${t.label} ${t.v}`}
          className="absolute inset-y-0 w-px bg-slate-500/60 dark:bg-slate-400/50"
          style={{ left: `${t.pos}%` }}
        />
      ))}
    </div>
  );
}

function Trend({ t, s }: { t: TFn; s: NationalStation }) {
  if (s.rate3hM == null) return null;
  const cm = s.rate3hM * 100;
  if (Math.abs(s.rate3hM) < STEADY_M_PER_H) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        <Minus className="size-3.5" aria-hidden />
        {t("trend.steady")}
      </span>
    );
  }
  const rising = cm > 0;
  const text = `${Math.abs(cm) < 10 ? Math.abs(cm).toFixed(1).replace(/\.0$/, "") : Math.round(Math.abs(cm))} ${t("unit.cmPerH")}`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${
        rising ? "text-orange-700 dark:text-orange-400" : "text-emerald-700 dark:text-emerald-400"
      }`}
    >
      {rising ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
      {rising ? t("trend.rising") : t("trend.falling")} {text}
    </span>
  );
}

function Row({ t, p, s, serverNow }: { t: TFn; p: (path: string) => string; s: NationalStation; serverNow: number }) {
  const notReporting = s.latest == null;
  const stale = !notReporting && s.tier === "stale";
  // Stale readings keep their last-known tier, but muted.
  const tier: Tier = stale ? s.levelTier : s.tier;
  const flagged = tier === "major" || tier === "minor" || tier === "alert" || tier === "watch";
  const st = (flagged && STYLE[tier]) || QUIET;
  const muted = notReporting || stale;
  const name = stationDisplayName(s.station);

  return (
    <Link
      href={p(s.href)}
      className={`block rounded-xl border px-3.5 py-3 min-h-[44px] transition hover:border-sky-400 dark:hover:border-sky-700 ${
        flagged && !muted
          ? ROW_BORDER[tier]
          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
      } ${notReporting ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{name}</span>
          {flagged && !muted && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 ${st.pill}`}>
              {tier !== "watch" && <TriangleAlert className="size-3" aria-hidden />}
              {tierLabel(t, tier)}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] tabular-nums shrink-0 text-slate-500 dark:text-slate-400">
          {s.latest && (
            <>
              {stale && <Clock className="size-3" aria-hidden />}
              <TimeAgo ts={s.latest.ts} serverNow={serverNow} short={stale} />
            </>
          )}
        </span>
      </div>

      {notReporting ? (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("gauges.notReporting")}</p>
      ) : (
        <>
          <div className={`mt-1.5 flex items-center gap-3 ${stale ? "opacity-60" : ""}`}>
            <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {formatLevel(s.latest!.water_level, s.unit)}
            </span>
            <span className="min-w-0 flex-1">{!stale && <Trend t={t} s={s} />}</span>
            <Sparkline t={t} s={s} color={muted ? "#94a3b8" : st.line} />
          </div>
          <div className={`mt-2 ${stale ? "opacity-60" : ""}`}>
            <ThresholdBar t={t} s={s} bar={muted ? "bg-slate-400" : st.bar} />
          </div>
        </>
      )}
    </Link>
  );
}

/** Upstream → downstream list with a thin connector showing flow direction. */
export function RiverGauges({ lang, stations, serverNow }: { lang: Locale; stations: NationalStation[]; serverNow: number }) {
  const { t, p } = getI18n(lang);
  const label = "text-[10px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500 font-medium";
  const multi = stations.length > 1;
  return (
    <section aria-label={t("gauges.aria")}>
      {multi && <p className={`${label} pl-7 mb-1.5`}>{t("gauges.upstream")}</p>}
      <ul>
        {stations.map((s, i) => {
          const muted = s.latest == null || s.tier === "stale";
          const tier = s.tier === "stale" ? s.levelTier : s.tier;
          const dot = !muted && STYLE[tier] ? STYLE[tier]!.dot : "bg-slate-300 dark:bg-slate-600";
          return (
            <li key={s.href} className="relative pl-7 pb-2 last:pb-0">
              {multi && (
                <>
                  <span
                    aria-hidden
                    className={`absolute left-[9px] w-px bg-slate-300 dark:bg-slate-700 ${
                      i === 0 ? "top-1/2" : "top-0"
                    } ${i === stations.length - 1 ? "bottom-1/2" : "bottom-0"}`}
                  />
                  <span
                    aria-hidden
                    className={`absolute left-[4px] top-1/2 -mt-1 size-3 rounded-full ring-2 ring-slate-50 dark:ring-slate-950 ${dot}`}
                  />
                </>
              )}
              <Row t={t} p={p} s={s} serverNow={serverNow} />
            </li>
          );
        })}
      </ul>
      {multi && <p className={`${label} pl-7 mt-1.5`}>{t("gauges.downstream")}</p>}
    </section>
  );
}
