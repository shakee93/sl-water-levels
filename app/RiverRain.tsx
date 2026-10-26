import { CloudRain } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { stationDisplayName } from "@/lib/displayName";
import { getGsmap } from "@/lib/gsmap";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { noRainSensor } from "@/lib/rainSensors";
import { rainWord, satelliteCaveat } from "@/lib/rainWords";
import { getForecastRainAll, measuredAtGauge } from "@/lib/stationRain";
import { timeBox } from "@/lib/nextHour";

const HEAVY_ENOUGH_MM = 10; // only a river with something worth saying gets the block

const mm = (v: number | null | undefined) => (v == null ? "—" : v < 10 ? v.toFixed(1) : String(Math.round(v)));

/** Compact rain summary on a river page: per gauge, what its sensor recorded, the satellite estimate and the forecast model, apart. Nothing when it is dry. */
export async function RiverRain({ lang, basin }: { lang: Locale; basin: string }) {
  const { t } = getI18n(lang);
  const [snap, sat, fc] = await Promise.all([fetchBasinSnapshot(basin).catch(() => []), timeBox(getGsmap(), 2500), timeBox(getForecastRainAll(), 8000)]);
  const now = Date.now();
  const rows = snap
    .map((s) => {
      const key = `${s.basin.trim()}/${s.station}`;
      const m = measuredAtGauge(s.station, s.trend24h, now);
      return { s, fell: m?.mm24h ?? null, sat: sat?.stations[key]?.mm24h ?? null, fc: fc?.[key]?.next24h ?? null, sensor: !noRainSensor(s.station) };
    })
    .filter((r) => r.fell != null || r.sat != null || r.fc != null);
  const top = Math.max(0, ...rows.map((r) => Math.max(r.fell ?? 0, r.sat ?? 0, r.fc ?? 0)));
  if (rows.length === 0 || top < HEAVY_ENOUGH_MM) return null;
  const cell = "tabular-nums text-right";
  return (
    <section aria-labelledby="river-rain" className="mt-6" data-river-rain>
      <h2 id="river-rain" className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <CloudRain className="size-4 text-sky-500" aria-hidden />
        {t("rr.title")}
      </h2>
      <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
        <div className="grid grid-cols-[minmax(0,1.2fr)_1fr_1fr_1fr] gap-x-2 px-3 py-2 text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
          <span />
          <span className={cell}>{t("rr.fell")}</span>
          <span className={cell}>{t("rr.sat")}</span>
          <span className={cell}>{t("rr.fc")}</span>
        </div>
        {rows.map((r) => (
          <div key={r.s.station} className="grid grid-cols-[minmax(0,1.2fr)_1fr_1fr_1fr] gap-x-2 px-3 py-1.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800">
            <span className="truncate font-medium text-slate-800 dark:text-slate-200">{stationDisplayName(r.s.station)}</span>
            <span className={cell} title={r.fell != null ? rainWord("24h", r.fell, lang) ?? undefined : undefined}>
              {r.sensor ? mm(r.fell) : <span className="text-slate-400 dark:text-slate-500">{t("rr.noSensor")}</span>}
            </span>
            <span className={`${cell} text-slate-600 dark:text-slate-400`}>{mm(r.sat)}</span>
            <span className={`${cell} text-slate-600 dark:text-slate-400`}>{mm(r.fc)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
        {t("rr.note")} {satelliteCaveat(basin, lang)}
      </p>
    </section>
  );
}
