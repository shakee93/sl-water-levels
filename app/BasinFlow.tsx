import Link from "next/link";
import { ArrowDown, ArrowUp, Minus, TrendingUp } from "lucide-react";
import { fetchBasinSnapshot, statusFor, type BasinStation } from "@/lib/arcgis";
import { orderStations } from "@/lib/basinOrder";
import { stationPath } from "@/lib/slug";
import { formatLevel, type Unit } from "@/lib/units";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";

const dotForTone: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  neutral: "bg-slate-400",
  stale: "bg-slate-300 dark:bg-slate-600",
};

function pct(level: number | null, threshold: number | null) {
  if (level == null || threshold == null || threshold <= 0) return null;
  return Math.max(0, Math.min(150, (level / threshold) * 100));
}

const STEADY_M_PER_H = 0.006;

function fmtRate(rateM: number, t: TFn) {
  const cm = Math.abs(rateM) * 100;
  const v = cm >= 100 ? `${(cm / 100).toFixed(1)} ${t("unit.mPerH")}` : `${Math.max(1, Math.round(cm))} ${t("unit.cmPerH")}`;
  return `${rateM > 0 ? "+" : "-"}${v}`;
}

function Sparkline({ readings }: { readings: BasinStation["trend24h"] }) {
  const pts = readings.filter((r): r is { ts: number; water_level: number; rain_fall: number | null } => r.water_level != null);
  if (pts.length < 2) {
    return (
      <svg viewBox="0 0 100 24" className="w-24 h-6 text-slate-300 dark:text-slate-700" preserveAspectRatio="none">
        <line x1="0" y1="12" x2="100" y2="12" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    );
  }
  const xs = pts.map((p) => p.ts);
  const ys = pts.map((p) => p.water_level);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xR = xMax - xMin || 1;
  const yR = yMax - yMin || 1;
  const path = pts
    .map((p, i) => {
      const x = ((p.ts - xMin) / xR) * 100;
      const y = 24 - ((p.water_level - yMin) / yR) * 22 - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" className="w-24 h-6 text-sky-500" preserveAspectRatio="none">
      <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow({ t, rate }: { t: TFn; rate: number }) {
  if (Math.abs(rate) < STEADY_M_PER_H) {
    return <Minus className="size-4 text-slate-500" aria-label={t("trend.steady")} />;
  }
  if (rate > 0) {
    return <ArrowUp className="size-4 text-orange-600 dark:text-orange-400" aria-label={t("trend.rising")} />;
  }
  return <ArrowDown className="size-4 text-emerald-600 dark:text-emerald-400" aria-label={t("trend.falling")} />;
}

function buildWaveInsight(stations: BasinStation[], selectedStation: string) {
  const selectedIdx = stations.findIndex((s) => s.station === selectedStation);
  if (selectedIdx <= 0) return null;
  const selected = stations[selectedIdx];
  if (selected.tier === "stale") return null;
  const upRising = stations
    .slice(0, selectedIdx)
    .filter((s) => s.tier !== "stale" && s.rate3hM != null && s.rate3hM > 0.05);
  if (upRising.length === 0) return null;
  const fastest = upRising.reduce((a, b) => ((a.rate3hM ?? 0) > (b.rate3hM ?? 0) ? a : b));
  const selRate = selected.rate3hM;
  if (selRate != null && selRate >= (fastest.rate3hM ?? 0) * 0.6) return null;
  return { upstreamStation: fastest.station, rateM: fastest.rate3hM ?? 0 };
}

type RelToneClass = {
  red: string;
  orange: string;
  yellow: string;
  neutral: string;
};
const relToneText: RelToneClass = {
  red: "text-red-600 dark:text-red-400",
  orange: "text-orange-600 dark:text-orange-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  neutral: "text-slate-600 dark:text-slate-400",
};

function relativeToThreshold(
  tt: TFn,
  level: number | null | undefined,
  unit: Unit,
  t: { alert: number | null; minor: number | null; major: number | null },
): { label: string; tone: keyof RelToneClass } | null {
  if (level == null) return null;
  if (t.major != null && level >= t.major) {
    return { label: tt("flow.aboveMajor", { amount: `${(level - t.major).toFixed(2)}${unit ? ` ${unit}` : ""}` }), tone: "red" };
  }
  if (t.minor != null && level >= t.minor) {
    return { label: tt("flow.aboveMinor", { amount: `${(level - t.minor).toFixed(2)}${unit ? ` ${unit}` : ""}` }), tone: "orange" };
  }
  if (t.alert != null && level >= t.alert) {
    return { label: tt("flow.aboveAlert", { amount: `${(level - t.alert).toFixed(2)}${unit ? ` ${unit}` : ""}` }), tone: "yellow" };
  }
  if (t.alert != null) {
    return {
      label: tt("flow.belowAlert", { amount: `${(t.alert - level).toFixed(2)}${unit ? ` ${unit}` : ""}` }),
      tone: "neutral",
    };
  }
  return null;
}

export async function BasinFlow({
  lang,
  basin,
  selectedStation,
}: {
  lang: Locale;
  basin: string;
  selectedStation: string;
}) {
  if (!basin) return null;
  const { t, p } = getI18n(lang);
  const raw = await fetchBasinSnapshot(basin);
  if (raw.length <= 1) return null;
  const stations = orderStations(basin, raw);
  const insight = buildWaveInsight(stations, selectedStation);

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
          {t("flow.along", { river: riverName(basin, lang) })}
        </h3>
      </div>

      {insight && (
        <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-sm flex items-start gap-2">
          <TrendingUp className="size-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" aria-hidden />
          <div className="text-amber-950 dark:text-amber-100">
            {t("flow.insight", { upstream: insight.upstreamStation, rate: fmtRate(insight.rateM, t).replace("+", ""), station: selectedStation })}
          </div>
        </div>
      )}

      <ol className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {stations.map((s, i) => {
          const status = statusFor(s.latest?.water_level ?? null, s.thresholds, s.latest?.ts);
          const isSelected = s.station === selectedStation;
          const stale = status.tier === "stale";
          const rate = !stale ? s.rate3hM : null;
          const alertPct = stale ? null : pct(s.latest?.water_level ?? null, s.thresholds.alert);
          const majorPct = pct(s.thresholds.minor, s.thresholds.alert);
          const rel = stale ? null : relativeToThreshold(t, s.latest?.water_level, s.unit, s.thresholds);

          return (
            <li key={s.station}>
              <Link
                href={p(stationPath(s.basin, s.station))}
                aria-current={isSelected ? "page" : undefined}
                className={`flex items-center gap-3 px-3 sm:px-4 py-3 min-h-14 border-l-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${
                  isSelected ? "bg-sky-50 dark:bg-sky-950/30 border-sky-500" : "border-transparent"
                } ${stale ? "opacity-60" : ""}`}
              >
                <div className="flex flex-col items-center w-4 shrink-0">
                  <span className={`size-2 rounded-full ${dotForTone[status.tone]}`} />
                  {i < stations.length - 1 && (
                    <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700 mt-1 -mb-3 h-3" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${isSelected ? "text-sky-800 dark:text-sky-300 font-semibold" : ""}`}>
                    {s.station}
                    {isSelected && <span className="ml-2 text-xs font-normal">{t("station.thisStation")}</span>}
                  </div>
                  {stale ? (
                    <div className="text-xs mt-0.5 text-slate-600 dark:text-slate-400">
                      {s.ageMin != null ? t("flow.lastReading", { h: Math.round(s.ageMin / 60) }) : t("gauges.notReporting")}
                    </div>
                  ) : (
                    rel && (
                      <div className={`text-xs mt-0.5 tabular-nums ${relToneText[rel.tone]}`}>{rel.label}</div>
                    )
                  )}
                  {alertPct != null && (
                    <div className="relative mt-1.5 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full ${
                          status.tone === "red"
                            ? "bg-red-500"
                            : status.tone === "orange"
                              ? "bg-orange-500"
                              : status.tone === "yellow"
                                ? "bg-yellow-500"
                                : "bg-sky-500"
                        }`}
                        style={{ width: `${Math.min(100, alertPct)}%` }}
                      />
                      {majorPct != null && majorPct > 0 && majorPct < 100 && (
                        <div
                          className="absolute inset-y-0 w-px bg-slate-400 dark:bg-slate-500"
                          style={{ left: `${majorPct}%` }}
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end shrink-0 min-w-[4.5rem]">
                  <div className={`text-sm font-semibold tabular-nums flex items-center gap-1 ${stale ? "text-slate-500 dark:text-slate-400" : ""}`}>
                    {formatLevel(s.latest?.water_level, s.unit)}
                    {rate != null && <Arrow t={t} rate={rate} />}
                  </div>
                  {rate != null && Math.abs(rate) >= STEADY_M_PER_H && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">{fmtRate(rate, t)}</div>
                  )}
                </div>

                {!stale && (
                  <div className="hidden sm:block shrink-0">
                    <Sparkline readings={s.trend24h} />
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{t("flow.arrows")}</p>
    </section>
  );
}
