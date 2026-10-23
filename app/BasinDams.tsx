import { Droplet, Zap, ArrowRightLeft, Sprout } from "lucide-react";
import { DAMS_BY_BASIN, type Dam } from "@/lib/dams";
import { soft } from "@/lib/soft";
import { fetchHydroGeneration, currentByPlant, peakInLast } from "@/lib/ceb";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";

const typeStyle: Record<Dam["type"], { label: "dams.hydroReservoir" | "dams.hydroStation" | "dams.diversion" | "dams.irrigation"; cls: string; Icon: typeof Droplet }> = {
  "hydropower-reservoir": {
    label: "dams.hydroReservoir",
    cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
    Icon: Droplet,
  },
  "hydropower-station": {
    label: "dams.hydroStation",
    cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
    Icon: Zap,
  },
  diversion: {
    label: "dams.diversion",
    cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
    Icon: ArrowRightLeft,
  },
  irrigation: {
    label: "dams.irrigation",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
    Icon: Sprout,
  },
};

export async function BasinDams({ basin, lang }: { basin: string; lang: Locale }) {
  const { t } = getI18n(lang);
  const dams = DAMS_BY_BASIN[basin];
  if (!dams || dams.length === 0) return null;

  // The feed is days late today (the badges are hidden), so it must never hold the page up: 1.5 s, then render without.
  const dispatch = await soft(fetchHydroGeneration(24), 1500, []);
  const live = currentByPlant(dispatch);
  const anyLiveMW = [...live.values()].some((p) => p.powerMW > 0);
  // No live MW (PUCSL feed is all-null today): nothing worth showing, render nothing.
  if (!anyLiveMW) return null;

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {t("dams.heading", { basin: riverName(basin, lang) })}
        </h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {t("dams.known", { n: dams.length })}
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
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t(style.label)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {d.capacityMCM != null && (
                      <span className="tabular-nums">
                        {d.capacityMCM} MCM
                      </span>
                    )}
                    {d.pucslPlantId != null && (
                      <span>
                        {liveRec && liveRec.powerMW > 0 ? (
                          <span className="text-amber-700 dark:text-amber-300 tabular-nums">
                            {t("dams.mwNow", { mw: liveRec.powerMW })}
                          </span>
                        ) : (
                          <span className="text-slate-400">{t("dams.mwNa")}</span>
                        )}
                        {peak6h > 0 && (
                          <span className="text-slate-500 ml-2 tabular-nums">
                            {t("dams.peak", { mw: peak6h })}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {d.note && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {d.note}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
