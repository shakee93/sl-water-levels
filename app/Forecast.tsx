import { ArrowDown, ArrowUp, Minus, HelpCircle } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { makeForecast } from "@/lib/forecast";

const directionConfig = {
  rising: {
    label: "Rising",
    Icon: ArrowUp,
    tone: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900",
  },
  falling: {
    label: "Falling",
    Icon: ArrowDown,
    tone: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900",
  },
  steady: {
    label: "Steady",
    Icon: Minus,
    tone: "text-slate-600 dark:text-slate-300",
    bg: "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800",
  },
  unknown: {
    label: "Unknown",
    Icon: HelpCircle,
    tone: "text-slate-400 dark:text-slate-500",
    bg: "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800",
  },
} as const;

const confidenceLabel: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  none: "No signal",
};

export async function Forecast({
  basin,
  selectedStation,
}: {
  basin: string;
  selectedStation: string;
}) {
  if (!basin) return null;
  const snapshot = await fetchBasinSnapshot(basin);
  if (snapshot.length === 0) return null;
  const f = makeForecast(basin, snapshot, selectedStation);

  const cfg = directionConfig[f.direction];
  const Icon = cfg.Icon;
  const deltaStr =
    f.predictedDelta == null
      ? "—"
      : `${f.predictedDelta >= 0 ? "+" : ""}${f.predictedDelta.toFixed(2)}`;
  const predictedStr =
    f.predictedLevel != null ? f.predictedLevel.toFixed(2) : "—";

  return (
    <section className={`mt-6 rounded-xl border ${cfg.bg} p-4 sm:p-5`}>
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 size-10 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center ${cfg.tone}`}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Next hour
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {confidenceLabel[f.confidence]}
            </span>
          </div>
          <div className={`mt-1 text-2xl sm:text-3xl font-semibold tabular-nums ${cfg.tone}`}>
            {cfg.label}
            <span className="text-base text-slate-600 dark:text-slate-300 font-normal ml-2">
              {deltaStr} → {predictedStr}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <span>
              Local trend:{" "}
              <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
                {f.localRatePerH != null
                  ? `${f.localRatePerH >= 0 ? "+" : ""}${f.localRatePerH.toFixed(2)}/h`
                  : "—"}
              </span>
            </span>
            <span>
              Upstream avg:{" "}
              <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
                {f.upstreamRatePerH != null
                  ? `${f.upstreamRatePerH >= 0 ? "+" : ""}${f.upstreamRatePerH.toFixed(2)}/h`
                  : f.upstreamCount === 0
                    ? "n/a (top)"
                    : "—"}
              </span>
            </span>
          </div>
          {f.notes.length > 0 && (
            <ul className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
              {f.notes.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
