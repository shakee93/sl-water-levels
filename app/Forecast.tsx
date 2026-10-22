import { ArrowDown, ArrowUp, Minus, HelpCircle, CloudRain } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { loadForecast } from "@/lib/forecast";
import { getAdvisory } from "@/lib/advisory";
import { DISTRICT_BY_STATION } from "@/lib/districts";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";

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

function fmtRain(v: number | null) {
  return v == null ? "n/a" : `${v.toFixed(1)}mm`;
}

function fmtTime(ts: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(ts);
}

export async function Forecast({
  basin,
  selectedStation,
}: {
  basin: string;
  selectedStation: string;
}) {
  if (!basin) return null;
  const warningsP = getOfficialWarnings(); // fails soft, never throws
  const snapshot = await fetchBasinSnapshot(basin);
  if (snapshot.length === 0) return null;
  const f = await loadForecast(basin, snapshot, selectedStation);
  const me = snapshot.find((s) => s.station === selectedStation);
  const [advisory, warnings] = await Promise.all([
    getAdvisory({ station: selectedStation, river: basin.trim(), district: DISTRICT_BY_STATION[selectedStation] ?? null, tier: me?.tier ?? "stale", forecast: f }),
    warningsP.then((w) => warningsForBasin(w, basin)),
  ]);

  const cfg = directionConfig[f.direction];
  const Icon = cfg.Icon;
  const unit = f.unit ? ` ${f.unit}` : "";
  const hasRain = (f.signals.rainAtStation6h ?? 0) + (f.signals.rainUpstream6h ?? 0) > 1;
  const caution = f.status === "degraded" || f.outlook === "elevated";

  return (
    <section
      data-forecast-method={f.method}
      className={`mt-6 rounded-xl border ${cfg.bg} p-4 sm:p-5`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 size-10 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center ${cfg.tone}`}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Forecast
            </h3>
            {f.experimental && f.method === "model" && (
              <span className="text-[11px] rounded border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 px-1.5">
                Experimental
              </span>
            )}
            {f.outlook === "elevated" && (
              <span className="text-[11px] rounded border border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-400 px-1.5">
                Elevated river-flow outlook this week
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-slate-700 dark:text-slate-200" data-advisory data-advisory-source={advisory.source}>
            <p>{advisory.en}</p>
            {(advisory.si || advisory.ta) && (
              <details className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer">සිංහල / தமிழ் (machine-translated)</summary>
                {advisory.si && <p lang="si" className="mt-1">{advisory.si}</p>}
                {advisory.ta && <p lang="ta" className="mt-1">{advisory.ta}</p>}
              </details>
            )}
          </div>
          {warnings.map((w) => (
            <p key={w.url} data-official-warning className="mt-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-semibold">Official warning ({w.severity}):</span> {w.summary}{" "}
              <a href={w.url} target="_blank" rel="noopener noreferrer" className="underline">
                {w.source}
              </a>
            </p>
          ))}
          <div className={`mt-1 text-lg sm:text-xl font-semibold ${caution ? "" : cfg.tone}`} data-forecast-headline>
            {f.headline}
          </div>

          {f.horizons.length > 0 && (
            <table className="mt-3 text-xs tabular-nums w-full max-w-md">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="font-normal pb-1">In</th>
                  <th className="font-normal pb-1">Level</th>
                  <th className="font-normal pb-1">80% range</th>
                  <th className="font-normal pb-1">At</th>
                </tr>
              </thead>
              <tbody className="text-slate-800 dark:text-slate-200">
                {f.horizons.map((h) => (
                  <tr key={h.h}>
                    <td className="py-0.5">{h.h}h</td>
                    <td className="py-0.5 font-medium">
                      {h.level.toFixed(2)}
                      {unit}
                    </td>
                    <td className="py-0.5">
                      {h.low != null && h.high != null ? `${h.low.toFixed(2)} to ${h.high.toFixed(2)}` : "n/a"}
                    </td>
                    <td className="py-0.5">{fmtTime(h.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {f.crossings.some((c) => c.wording !== "already") && (
            <ul className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
              {f.crossings
                .filter((c) => c.wording !== "already")
                .map((c) => (
                  <li key={c.threshold}>
                    {c.threshold} ({c.level}
                    {unit}): {c.wording}, {Math.round(c.probability * 100)}% peak chance
                    {c.etaTs ? `, from about ${fmtTime(c.etaTs)}` : ""}
                  </li>
                ))}
            </ul>
          )}

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
            <Cell label="Local trend">
              {f.signals.localRatePerH != null
                ? `${f.signals.localRatePerH >= 0 ? "+" : ""}${f.signals.localRatePerH.toFixed(2)}/h`
                : "—"}
            </Cell>
            <Cell label="Upstream avg">
              {f.signals.upstreamRatePerH != null
                ? `${f.signals.upstreamRatePerH >= 0 ? "+" : ""}${f.signals.upstreamRatePerH.toFixed(2)}/h`
                : f.signals.upstreamCount === 0
                  ? "n/a (top)"
                  : "—"}
            </Cell>
            <Cell label="Rain here (6h)">{fmtRain(f.signals.rainAtStation6h)}</Cell>
            <Cell label="Rain upstream (6h)">{fmtRain(f.signals.rainUpstream6h)}</Cell>
          </div>

          {hasRain && f.signals.rainContributors.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
              <CloudRain className="size-3.5 shrink-0 text-sky-500" />
              <span className="truncate">
                {f.signals.rainContributors.slice(0, 4).join(" · ")}
              </span>
            </div>
          )}

          {f.notes.length > 0 && (
            <ul className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
              {f.notes.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
          {f.basis.length > 0 && (
            <details className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer">How this is worked out</summary>
              <ul className="mt-1 space-y-0.5">
                {f.basis.map((n, i) => (
                  <li key={i}>· {n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
        {children}
      </div>
    </div>
  );
}
