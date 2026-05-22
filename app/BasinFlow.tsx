import Link from "next/link";
import { fetchBasinSnapshot, statusFor, type BasinStation } from "@/lib/arcgis";
import { orderStations } from "@/lib/basinOrder";

const dotForTone: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  neutral: "bg-slate-400",
};

function pct(level: number | null, threshold: number | null) {
  if (level == null || threshold == null || threshold <= 0) return null;
  return Math.max(0, Math.min(150, (level / threshold) * 100));
}

function trendDelta(s: BasinStation) {
  if (!s.latest || !s.prior) return null;
  if (s.latest.water_level == null || s.prior.water_level == null) return null;
  const dt = (s.latest.ts - s.prior.ts) / 3_600_000;
  if (dt <= 0) return null;
  const delta = s.latest.water_level - s.prior.water_level;
  return { delta, ratePerHour: delta / dt };
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

function Arrow({ rate }: { rate: number }) {
  const abs = Math.abs(rate);
  if (abs < 0.02) {
    return <span className="text-slate-400" aria-label="steady">→</span>;
  }
  const cls = rate > 0 ? "text-orange-500" : "text-emerald-500";
  return <span className={cls} aria-label={rate > 0 ? "rising" : "falling"}>{rate > 0 ? "↑" : "↓"}</span>;
}

function buildWaveInsight(stations: BasinStation[], selectedStation: string) {
  const selectedIdx = stations.findIndex((s) => s.station === selectedStation);
  if (selectedIdx <= 0) return null;
  const upstream = stations.slice(0, selectedIdx);
  const selected = stations[selectedIdx];
  if (!selected) return null;

  const upRising = upstream
    .map((s) => ({ station: s.station, trend: trendDelta(s) }))
    .filter((x): x is { station: string; trend: { delta: number; ratePerHour: number } } => x.trend != null && x.trend.ratePerHour > 0.05);

  if (upRising.length === 0) return null;
  const selTrend = trendDelta(selected);
  const fastestUp = upRising.reduce((a, b) => (a.trend.ratePerHour > b.trend.ratePerHour ? a : b));
  const isCalmHere = !selTrend || selTrend.ratePerHour < fastestUp.trend.ratePerHour * 0.6;
  if (!isCalmHere) return null;

  return {
    upstreamStation: fastestUp.station,
    rate: fastestUp.trend.ratePerHour,
  };
}

export async function BasinFlow({
  basin,
  selectedStation,
}: {
  basin: string;
  selectedStation: string;
}) {
  if (!basin) return null;
  const raw = await fetchBasinSnapshot(basin);
  if (raw.length <= 1) return null;
  const stations = orderStations(basin, raw);
  const insight = buildWaveInsight(stations, selectedStation);

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          {basin} — upstream to downstream
        </h3>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          24h trend
        </span>
      </div>

      {insight && (
        <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-xs sm:text-sm flex items-start gap-2">
          <span className="text-amber-600 dark:text-amber-400 text-base leading-none mt-0.5">▲</span>
          <div className="text-amber-800 dark:text-amber-200">
            <strong>{insight.upstreamStation}</strong> upstream is rising at{" "}
            <span className="tabular-nums">{insight.rate.toFixed(2)}/h</span> — a pulse may reach{" "}
            <strong>{selectedStation}</strong> in the coming hours.
          </div>
        </div>
      )}

      <ol className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {stations.map((s, i) => {
          const status = statusFor(s.latest?.water_level ?? null, s.thresholds);
          const isSelected = s.station === selectedStation;
          const trend = trendDelta(s);
          const alertPct = pct(s.latest?.water_level ?? null, s.thresholds.alert);
          const majorPct = pct(s.thresholds.minor, s.thresholds.alert);

          return (
            <li key={s.station}>
              <Link
                href={`/?station=${encodeURIComponent(s.station)}`}
                className={`flex items-center gap-3 px-3 sm:px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  isSelected ? "bg-sky-50 dark:bg-sky-950/30" : ""
                }`}
              >
                <div className="flex flex-col items-center w-4 shrink-0">
                  <span className={`size-2 rounded-full ${dotForTone[status.tone]}`} />
                  {i < stations.length - 1 && (
                    <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700 mt-1 -mb-3 h-3" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <div className={`text-sm font-medium truncate ${isSelected ? "text-sky-700 dark:text-sky-300" : ""}`}>
                      {s.station}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 hidden sm:block">
                      {i === 0 ? "upstream" : i === stations.length - 1 ? "downstream" : ""}
                    </div>
                  </div>
                  {/* threshold bar */}
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
                          title="minor flood threshold"
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end shrink-0 min-w-[3.5rem]">
                  <div className="text-sm font-semibold tabular-nums flex items-center gap-1">
                    {s.latest?.water_level != null ? s.latest.water_level.toFixed(2) : "—"}
                    {trend && <Arrow rate={trend.ratePerHour} />}
                  </div>
                  {trend && (
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {trend.delta >= 0 ? "+" : ""}
                      {trend.delta.toFixed(2)}/3h
                    </div>
                  )}
                </div>

                <div className="hidden sm:block shrink-0">
                  <Sparkline readings={s.trend24h} />
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        Stations ordered by river flow. Trend = change over last ~3 hours; arrow direction reflects rate.
        {Object.keys({ "Kelani Ganga": true }).includes(basin.trim())
          ? ""
          : " Ordering for this basin is by longitude — may not perfectly match river hydrology."}
      </p>
    </section>
  );
}
