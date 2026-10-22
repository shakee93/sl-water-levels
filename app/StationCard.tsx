import { fetchStationData } from "@/lib/arcgis";
import { detectUnit, formatLevel, type Unit } from "@/lib/units";
import { LevelChart } from "./LevelChart";
import { RangePicker } from "./RangePicker";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

export async function StationCard({ lang, stationName }: { lang: Locale; stationName: string }) {
  const { t } = getI18n(lang);
  // Always the full 7 days; the client slices to the selected range so the page stays cacheable.
  const data = await fetchStationData(stationName, 7);
  const unit = detectUnit(data.thresholds, stationName);
  const th = data.thresholds;
  const hasT = th.alert != null || th.minor != null || th.major != null;

  return (
    <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("card.water")}</h2>
        <RangePicker />
      </div>
      <div className="px-2 sm:px-6 pb-4 sm:pb-6">
        <LevelChart readings={data.readings} thresholds={data.thresholds} unit={unit} />
        {hasT ? (
          <dl className="mt-3 px-2 sm:px-0 grid grid-cols-3 gap-2 text-sm">
            <Mark label={t("mark.alert")} value={th.alert} unit={unit} tone="text-amber-700 dark:text-amber-400" />
            <Mark label={t("mark.minor")} value={th.minor} unit={unit} tone="text-orange-700 dark:text-orange-400" />
            <Mark label={t("mark.major")} value={th.major} unit={unit} tone="text-red-700 dark:text-red-400" />
          </dl>
        ) : (
          <p className="mt-3 px-2 sm:px-0 text-sm text-slate-600 dark:text-slate-400">
            {t("card.noLevels")}
          </p>
        )}
      </div>
    </section>
  );
}

function Mark({ label, value, unit, tone }: { label: string; value: number | null; unit: Unit; tone: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone}`}>{value == null ? "—" : formatLevel(value, unit)}</dd>
    </div>
  );
}
