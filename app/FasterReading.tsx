import { getNational } from "@/lib/arcgis";
import { getHmisLevels, HMIS_CREDIT, HMIS_FAST, fasterReading } from "@/lib/hmis";
import { formatLevel } from "@/lib/units";
import { getI18n } from "@/lib/i18n/server";
import { hmisT } from "@/lib/i18n/hmis";
import type { Locale } from "@/lib/i18n/config";
import { colomboTime } from "@/app/tierUi";

/**
 * "Latest: 18.4 ft at 4:40 pm (10-min sensor)" for the gauges HMIS also reads with its own 10-minute sensor, when that sensor is
 * newer than the hourly reading. Offset-corrected by the median (hourly - sensor) over the last 24 h (lib/hmisCalc.ts). A note
 * only: the official step, the pill and the forecast all stay on the hourly ArcGIS gauge. Renders nothing when HMIS is slow.
 */
export async function FasterReading({ lang, station }: { lang: Locale; station: string }) {
  const def = HMIS_FAST.find((f) => f.station === station);
  if (!def) return null;
  const [levels, national] = await Promise.all([getHmisLevels(), getNational().catch(() => [])]);
  const dev = levels?.devices.find((d) => d.device === def.device);
  const nat = national.find((s) => s.station === station);
  if (!dev || !nat?.latest || nat.latest.water_level == null) return null;
  const hourly = nat.trend24h.filter((r) => r.water_level != null).map((r) => ({ ts: r.ts, m: r.water_level as number }));
  const fr = fasterReading(dev.series, hourly, Date.now());
  if (!fr) return null;
  const { t } = getI18n(lang);
  const h = hmisT(lang);
  return (
    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300" data-testid="faster-reading" title={h("fastNote")}>
      <span className="font-medium">
        {h("fast", { level: formatLevel(fr.m, "m"), time: colomboTime(fr.ts, t), n: fr.cadenceMin ?? 10 })}
      </span>
      <span className="block text-xs text-slate-500 dark:text-slate-400">
        {h("fastNote")} {HMIS_CREDIT}.
      </span>
    </p>
  );
}
