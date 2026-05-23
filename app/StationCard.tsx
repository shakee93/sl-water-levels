import { fetchStationData, statusFor } from "@/lib/arcgis";
import { detectUnit } from "@/lib/units";
import { LevelChart } from "./LevelChart";

const toneClass: Record<string, string> = {
  green:
    "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900",
  yellow:
    "bg-yellow-100 text-yellow-800 ring-1 ring-yellow-200 dark:bg-yellow-950/60 dark:text-yellow-300 dark:ring-yellow-900",
  orange:
    "bg-orange-100 text-orange-800 ring-1 ring-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:ring-orange-900",
  red: "bg-red-100 text-red-800 ring-1 ring-red-200 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-900",
  neutral:
    "bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmt(v: number | null | undefined) {
  return v == null ? "—" : Number(v).toFixed(2);
}

export async function StationCard({ stationName }: { stationName: string }) {
  const data = await fetchStationData(stationName);
  const status = statusFor(data.latest?.water_level ?? null, data.thresholds);
  const unit = detectUnit(data.thresholds);

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold truncate">
              {data.station}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {data.basin || "—"}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${toneClass[status.tone]}`}
          >
            <span
              className={`size-1.5 rounded-full ${
                status.tone === "red"
                  ? "bg-red-500"
                  : status.tone === "orange"
                    ? "bg-orange-500"
                    : status.tone === "yellow"
                      ? "bg-yellow-500"
                      : status.tone === "green"
                        ? "bg-emerald-500"
                        : "bg-slate-400"
              }`}
            />
            {status.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100 dark:bg-slate-800">
        <Stat
          label="Latest"
          value={fmtWithUnit(data.latest?.water_level, unit)}
          sub={data.latest ? fmtTime(data.latest.ts) : "No readings"}
        />
        <Stat
          label="Alert"
          value={fmtWithUnit(data.thresholds.alert, unit)}
          accent="text-yellow-600 dark:text-yellow-400"
        />
        <Stat
          label="Minor flood"
          value={fmtWithUnit(data.thresholds.minor, unit)}
          accent="text-orange-600 dark:text-orange-400"
        />
        <Stat
          label="Major flood"
          value={fmtWithUnit(data.thresholds.major, unit)}
          accent="text-red-600 dark:text-red-400"
        />
      </div>

      <div className="p-4 sm:p-6">
        <LevelChart readings={data.readings} thresholds={data.thresholds} unit={unit} />
        <p className="mt-3 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
          Last 4 days · {data.readings.length} readings · Asia/Colombo.{" "}
          <span className="text-slate-400 dark:text-slate-500">
            Unit (ft or m) inferred from the gauge’s flood thresholds; shown only when confident.
          </span>
        </p>
      </div>
    </section>
  );
}

function fmtWithUnit(v: number | null | undefined, unit: import("@/lib/units").Unit) {
  if (v == null) return "—";
  const s = Number(v).toFixed(2);
  return unit ? `${s} ${unit}` : s;
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 px-3 py-3 sm:px-4 sm:py-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-lg sm:text-xl font-semibold tabular-nums mt-1 ${accent ?? ""}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}
