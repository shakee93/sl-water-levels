import { BASIN_ORDER } from "@/lib/basinOrder";
import { MapClient } from "./MapClient";
import { TIER_DOT, TIER_TEXT, type HomeStation } from "./tierUi";
import type { Tier } from "@/lib/arcgis";

const LEGEND: Tier[] = ["normal", "watch", "alert", "minor", "major", "stale"];

export function SriLankaMap({ stations }: { stations: HomeStation[] }) {
  const valid = stations.filter(
    (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude),
  );

  // Thin neutral upstream→downstream lines for basins with a curated order.
  const basinChains: Record<string, Array<[number, number]>> = {};
  for (const [basin, order] of Object.entries(BASIN_ORDER)) {
    const lookup = new Map(valid.filter((s) => s.basin === basin).map((s) => [s.station, s] as const));
    const chain = order
      .map((name) => lookup.get(name))
      .filter((s): s is HomeStation => Boolean(s))
      .map((s): [number, number] => [s.latitude, s.longitude]);
    if (chain.length >= 2) basinChains[basin] = chain;
  }

  return (
    <section className="mb-8" aria-labelledby="map-heading">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2
            id="map-heading"
            className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100"
          >
            Map of all gauges
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            {LEGEND.map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <span className={`size-2.5 rounded-full ${TIER_DOT[t]}`} aria-hidden />
                {t === "stale" ? "No recent data" : TIER_TEXT[t]}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative h-[380px] sm:h-[820px] lg:h-[960px]">
          <MapClient stations={valid} basinChains={basinChains} />
        </div>
      </div>
    </section>
  );
}
