import { AlertTriangle, Siren } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { detectAnomaly } from "@/lib/anomaly";

export async function Anomaly({
  basin,
  selectedStation,
}: {
  basin: string;
  selectedStation: string;
}) {
  if (!basin) return null;
  const snapshot = await fetchBasinSnapshot(basin);
  if (snapshot.length === 0) return null;
  const a = detectAnomaly(basin, snapshot, selectedStation);

  if (a.status === "normal" || !a.message) return null;

  const isLikely = a.status === "likely_release";
  const Icon = isLikely ? Siren : AlertTriangle;
  const bg = isLikely
    ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900"
    : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900";
  const iconColor = isLikely
    ? "text-red-600 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400";
  const titleColor = isLikely
    ? "text-red-900 dark:text-red-200"
    : "text-amber-900 dark:text-amber-200";
  const bodyColor = isLikely
    ? "text-red-800 dark:text-red-300"
    : "text-amber-800 dark:text-amber-300";

  return (
    <section className={`mb-6 rounded-xl border ${bg} p-4 sm:p-5`}>
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 size-10 rounded-full bg-white dark:bg-slate-900 border border-current/20 flex items-center justify-center ${iconColor}`}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h3 className={`text-base font-semibold ${titleColor}`}>
              {isLikely ? "Likely upstream release" : "Unusual rise"}
            </h3>
            <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Detected by anomaly
            </span>
          </div>
          <p className={`mt-1.5 text-sm ${bodyColor}`}>{a.message}</p>
          {a.reasons.length > 0 && (
            <ul className={`mt-2 text-xs space-y-1 ${bodyColor}`}>
              {a.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Inferred from gauge data alone — no direct release feed used.
            Rising water with no rainfall and no matching upstream rise is the
            signature of a dam opening upstream.
          </p>
        </div>
      </div>
    </section>
  );
}
