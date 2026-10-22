import { fetchStationData } from "@/lib/arcgis";
import { detectUnit, formatLevel, type Unit } from "@/lib/units";
import { LevelChart } from "./LevelChart";
import { RangePicker } from "./RangePicker";

export async function StationCard({ stationName }: { stationName: string }) {
  // Always the full 7 days; the client slices to the selected range so the page stays cacheable.
  const data = await fetchStationData(stationName, 7);
  const unit = detectUnit(data.thresholds, stationName);
  const t = data.thresholds;
  const hasT = t.alert != null || t.minor != null || t.major != null;

  return (
    <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Water level</h2>
        <RangePicker />
      </div>
      <div className="px-2 sm:px-6 pb-4 sm:pb-6">
        <LevelChart readings={data.readings} thresholds={data.thresholds} unit={unit} />
        {hasT ? (
          <dl className="mt-3 px-2 sm:px-0 grid grid-cols-3 gap-2 text-sm">
            <Mark label="Alert" value={t.alert} unit={unit} tone="text-amber-700 dark:text-amber-400" />
            <Mark label="Minor flood" value={t.minor} unit={unit} tone="text-orange-700 dark:text-orange-400" />
            <Mark label="Major flood" value={t.major} unit={unit} tone="text-red-700 dark:text-red-400" />
          </dl>
        ) : (
          <p className="mt-3 px-2 sm:px-0 text-sm text-slate-600 dark:text-slate-400">
            No flood levels are published for this gauge.
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
