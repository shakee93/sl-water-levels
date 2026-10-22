import { BASIN_ORDER } from "@/lib/basinOrder";
import { MapClient } from "./MapClient";
import { TIER_DOT, tierLabel, type HomeStation } from "./tierUi";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import type { Tier } from "@/lib/arcgis";

const LEGEND: Tier[] = ["normal", "watch", "alert", "minor", "major", "stale"];

export function SriLankaMap({ lang, stations }: { lang: Locale; stations: HomeStation[] }) {
  const { t } = getI18n(lang);
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
            {t("map.heading")}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            {LEGEND.map((k) => (
              <li key={k} className="inline-flex items-center gap-1.5">
                <span className={`size-2.5 rounded-full ${TIER_DOT[k]}`} aria-hidden />
                {k === "stale" ? t("tier.noData") : tierLabel(t, k)}
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
