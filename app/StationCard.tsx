import { fetchBasinSnapshot, fetchStationData } from "@/lib/arcgis";
import { loadForecast } from "@/lib/forecast";
import { rainRiskLine, type RainRisk } from "@/lib/rainRisk";
import { CloudRain } from "lucide-react";
import { getAccuracy, stationSummary } from "@/lib/accuracy";
import { isStale } from "@/lib/readings";
import { detectUnit } from "@/lib/units";
import { LevelChartLazy } from "./LevelChartLazy";
import type { ChartForecast } from "./LevelChart";
import { RangePicker } from "./RangePicker";
import { RiverReaction } from "./RiverReaction";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

export async function StationCard({ lang, stationName, basin }: { lang: Locale; stationName: string; basin?: string }) {
  const { t } = getI18n(lang);
  // Always the full 7 days; the client slices to the selected range so the page stays cacheable.
  const data = await fetchStationData(stationName, 7);
  const unit = detectUnit(data.thresholds, stationName);
  const th = data.thresholds;
  const hasT = th.alert != null || th.minor != null || th.major != null;
  const [fc, acc] = await Promise.all([basin && !isStale(data.latest) ? chartForecast(basin, stationName) : null, getAccuracy()]);
  const forecast = fc?.chart ?? null;
  const risk = fc?.rainRisk ?? null;
  // One honest line about how this gauge's own forecasts have done (hidden below ~10 checks).
  const sum = stationSummary(acc, stationName);
  const fmt = (v: number) => (v < 0.095 ? v.toFixed(2) : v.toFixed(1));
  const accLine = sum
    ? t("acc.station", {
        h1: fmt(sum.h1),
        h24: sum.h24 != null ? t("acc.station24", { h24: fmt(sum.h24) }) : "",
        span: sum.since ? t("acc.spanSince", { d: sum.since }) : t("acc.spanDays"),
        n: sum.n,
      })
    : null;

  return (
    <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t("card.water")}</h2>
        <RangePicker />
      </div>
      <div className="px-2 sm:px-6 pb-4 sm:pb-6">
        <LevelChartLazy station={stationName} readings={data.readings} thresholds={th} unit={unit} forecast={forecast} />
        {risk && (
          <p className="mt-2 mx-2 sm:mx-0 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100" data-testid="rain-risk">
            <CloudRain className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {rainRiskLine(risk, lang)}
              {lang !== "en" ? <span className="ml-1 text-xs opacity-70">{lang === "si" ? "(කෙටුම්පත් පරිවර්තනය)" : "(வரைவு மொழிபெயர்ப்பு)"}</span> : null}
            </span>
          </p>
        )}
        <RiverReaction station={stationName} lang={lang} />
        {accLine && <p className="mt-2 px-2 sm:px-0 text-xs text-slate-500 dark:text-slate-400">{accLine}</p>}
        {!hasT && (
          <p className="mt-3 px-2 sm:px-0 text-sm text-slate-600 dark:text-slate-400">
            {t("card.noLevels")}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The model forecast as chart points (null = nothing drawn unless a fitted model produced one) and the heavy-rain warning
 * (shown for every gauge with a rain forecast, model or trend). Never throws.
 */
async function chartForecast(basin: string, station: string): Promise<{ chart: ChartForecast | null; rainRisk: RainRisk | null } | null> {
  try {
    const snapshot = await fetchBasinSnapshot(basin);
    if (!snapshot.length) return null;
    const f = await loadForecast(basin, snapshot, station);
    const ok = f.method === "model" && f.status !== "unavailable" && f.horizons.length > 0;
    return {
      chart: ok ? { points: f.horizons.map((h) => ({ ts: h.ts, level: h.level, low: h.low, high: h.high })) } : null,
      rainRisk: f.status === "unavailable" ? null : f.rainRisk,
    };
  } catch {
    return null;
  }
}
