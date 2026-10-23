import { fetchBasinSnapshot, fetchStationData } from "@/lib/arcgis";
import { loadForecast } from "@/lib/forecast";
import { isStale } from "@/lib/readings";
import { detectUnit } from "@/lib/units";
import { LevelChartLazy } from "./LevelChartLazy";
import type { ChartForecast } from "./LevelChart";
import { RangePicker } from "./RangePicker";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

export async function StationCard({ lang, stationName, basin }: { lang: Locale; stationName: string; basin?: string }) {
  const { t } = getI18n(lang);
  // Always the full 7 days; the client slices to the selected range so the page stays cacheable.
  const data = await fetchStationData(stationName, 7);
  const unit = detectUnit(data.thresholds, stationName);
  const th = data.thresholds;
  const hasT = th.alert != null || th.minor != null || th.major != null;
  const forecast = basin && !isStale(data.latest) ? await chartForecast(basin, stationName) : null;

  return (
    <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t("card.water")}</h2>
        <RangePicker />
      </div>
      <div className="px-2 sm:px-6 pb-4 sm:pb-6">
        <LevelChartLazy station={stationName} readings={data.readings} thresholds={th} unit={unit} forecast={forecast} />
        {!hasT && (
          <p className="mt-3 px-2 sm:px-0 text-sm text-slate-600 dark:text-slate-400">
            {t("card.noLevels")}
          </p>
        )}
      </div>
    </section>
  );
}

/** The model forecast as chart points; null (nothing drawn) unless a fitted model produced one. Never throws. */
async function chartForecast(basin: string, station: string): Promise<ChartForecast | null> {
  try {
    const snapshot = await fetchBasinSnapshot(basin);
    if (!snapshot.length) return null;
    const f = await loadForecast(basin, snapshot, station);
    if (f.method !== "model" || f.status === "unavailable" || !f.horizons.length) return null;
    return { points: f.horizons.map((h) => ({ ts: h.ts, level: h.level, low: h.low, high: h.high })) };
  } catch {
    return null;
  }
}
