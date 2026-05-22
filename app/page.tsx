import { fetchStations, fetchStationData, statusFor } from "@/lib/arcgis";
import { StationPicker } from "./StationPicker";
import { LevelChart } from "./LevelChart";

export const revalidate = 60;

const DEFAULT_STATION = "Nagalagam Street";

const toneClass: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ station?: string }>;
}) {
  const { station: stationParam } = await searchParams;
  const stations = await fetchStations();
  const station =
    stations.find((s) => s.station === stationParam)?.station ??
    stations.find((s) => s.station === DEFAULT_STATION)?.station ??
    stations[0]?.station ??
    DEFAULT_STATION;

  const data = await fetchStationData(station);
  const status = statusFor(data.latest?.water_level ?? null, data.thresholds);

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Sri Lanka Water Levels
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Realtime river-gauge readings from the Department of Irrigation. Updates every minute.
          </p>
        </header>

        <section className="mb-6 flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
          <div className="flex-1">
            <label className="block text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
              Station
            </label>
            <StationPicker stations={stations} current={station} />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 sm:pb-2">
            {stations.length} stations &middot; {new Set(stations.map((s) => s.basin)).size} basins
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-semibold">{data.station}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {data.basin || "—"}
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${toneClass[status.tone]}`}
            >
              {status.label}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Stat
              label="Latest"
              value={data.latest?.water_level != null ? `${data.latest.water_level.toFixed(2)} m` : "—"}
              sub={data.latest ? fmtTime(data.latest.ts) : ""}
            />
            <Stat
              label="Alert"
              value={data.thresholds.alert != null ? `${data.thresholds.alert} m` : "—"}
              accent="text-yellow-600 dark:text-yellow-400"
            />
            <Stat
              label="Minor flood"
              value={data.thresholds.minor != null ? `${data.thresholds.minor} m` : "—"}
              accent="text-orange-600 dark:text-orange-400"
            />
            <Stat
              label="Major flood"
              value={data.thresholds.major != null ? `${data.thresholds.major} m` : "—"}
              accent="text-red-600 dark:text-red-400"
            />
          </div>

          <LevelChart readings={data.readings} thresholds={data.thresholds} />
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Last 4 days, {data.readings.length} readings. Times shown in Asia/Colombo.
          </p>
        </section>

        <footer className="text-xs text-slate-500 dark:text-slate-400">
          Data:{" "}
          <a
            className="underline hover:text-slate-700 dark:hover:text-slate-200"
            href="https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0"
            target="_blank"
            rel="noreferrer"
          >
            Sri Lanka Department of Irrigation ArcGIS feature service
          </a>
          .
        </footer>
      </div>
    </main>
  );
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
    <div className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
