import { Droplet, Zap, ArrowRightLeft, Sprout } from "lucide-react";
import { DAMS_BY_BASIN, type Dam } from "@/lib/dams";
import { fetchHydroGeneration, currentByPlant, peakInLast } from "@/lib/ceb";

const typeStyle: Record<Dam["type"], { label: string; cls: string; Icon: typeof Droplet }> = {
  "hydropower-reservoir": {
    label: "Hydropower reservoir",
    cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
    Icon: Droplet,
  },
  "hydropower-station": {
    label: "Hydropower station",
    cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
    Icon: Zap,
  },
  diversion: {
    label: "Diversion",
    cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
    Icon: ArrowRightLeft,
  },
  irrigation: {
    label: "Irrigation reservoir",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
    Icon: Sprout,
  },
};

export async function BasinDams({ basin }: { basin: string }) {
  const dams = DAMS_BY_BASIN[basin];
  if (!dams || dams.length === 0) return null;

  const dispatch = await fetchHydroGeneration(24);
  const live = currentByPlant(dispatch);
  const anyLiveMW = [...live.values()].some((p) => p.powerMW > 0);

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          {basin} — connected dams &amp; power stations
        </h3>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {dams.length} known
        </span>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {dams.map((d) => {
          const style = typeStyle[d.type];
          const Icon = style.Icon;
          const liveRec = d.pucslPlantId != null ? live.get(d.pucslPlantId) : null;
          const peak6h = d.pucslPlantId != null ? peakInLast(dispatch, d.pucslPlantId, 6) : 0;

          return (
            <li
              key={d.name}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
            >
              <div className="flex items-start gap-3">
                <div className={`shrink-0 size-8 rounded-md ring-1 flex items-center justify-center ${style.cls}`}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium truncate">{d.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {style.label}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                    {d.capacityMCM != null && (
                      <span className="tabular-nums">
                        {d.capacityMCM} MCM
                      </span>
                    )}
                    {d.pucslPlantId != null && (
                      <span>
                        {liveRec && liveRec.powerMW > 0 ? (
                          <span className="text-amber-700 dark:text-amber-300 tabular-nums">
                            ⚡ {liveRec.powerMW} MW now
                          </span>
                        ) : (
                          <span className="text-slate-400">live MW: n/a</span>
                        )}
                        {peak6h > 0 && (
                          <span className="text-slate-500 ml-2 tabular-nums">
                            (peak 6h: {peak6h} MW)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {d.note && (
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                      {d.note}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Static catalogue hand-curated from Mahaweli Authority and CEB sources.
        {anyLiveMW
          ? " Live MW values come from the PUCSL GenData API (15-min cadence)."
          : " Live MW values are sourced from the PUCSL GenData API but the endpoint currently returns empty values across all plants — the table is a published stub. Real release data should appear here automatically when CEB starts populating it."}
      </p>
    </section>
  );
}
