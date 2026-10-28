import { getNational } from "@/lib/arcgis";
import { getHmisLevels, HMIS_CREDIT, HMIS_FAST, fasterReading } from "@/lib/hmis";
import { formatLevel } from "@/lib/units";
import { getI18n } from "@/lib/i18n/server";
import { hmisT } from "@/lib/i18n/hmis";
import { getRivernetLevels, RIVERNET_FAST_BY_STATION, fasterThanOfficial } from "@/lib/rivernet";
import { rivernetT } from "@/lib/i18n/rivernet";
import { RivernetCredit } from "@/app/RivernetNote";
import type { Locale } from "@/lib/i18n/config";
import { colomboTime } from "@/app/tierUi";

/**
 * "Latest: 18.4 ft at 4:40 pm (10-min sensor)" for the gauges HMIS also reads with its own 10-minute sensor, when that sensor is
 * newer than the hourly reading. Offset-corrected by the median (hourly - sensor) over the last 24 h (lib/hmisCalc.ts). A note
 * only: the official step, the pill and the forecast all stay on the hourly ArcGIS gauge. Renders nothing when HMIS is slow.
 */
export async function FasterReading({ lang, station }: { lang: Locale; station: string }) {
  const def = HMIS_FAST.find((f) => f.station === station);
  if (!def) return RIVERNET_FAST_BY_STATION.has(station) ? <RivernetFaster lang={lang} station={station} /> : null;
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

/**
 * The same note for a gauge we already have whose official reading is hourly (ArcGIS) or 30-minute (HMIS), when RiverNet's own 1-minute
 * sensor for that gauge is at least 10 minutes newer: "Latest: 19.2 ft at 4:40 pm (1-minute sensor)", moved onto the official scale by
 * the median offset (lib/rivernetCalc.ts fasterThanOfficial). The official step, pill and forecast stay with the official reading; one
 * number per place: this is labelled a note, the headline never changes. Renders nothing when RiverNet is slow, off or not newer.
 */
async function RivernetFaster({ lang, station }: { lang: Locale; station: string }) {
  const def = RIVERNET_FAST_BY_STATION.get(station);
  if (!def) return null;
  const [levels, national] = await Promise.all([getRivernetLevels(), getNational().catch(() => [])]);
  const dev = levels?.devices.find((d) => d.key === def.key);
  const nat = national.find((x) => x.station === station);
  if (!dev || !nat?.latest || nat.latest.water_level == null) return null;
  const official = nat.trend24h.filter((r) => r.water_level != null).map((r) => ({ ts: r.ts, m: (r.water_level as number) * (nat.metresPerUnit ?? 1) }));
  const fr = fasterThanOfficial(dev.series, official, Date.now());
  if (!fr) return null;
  const { t } = getI18n(lang);
  const r = rivernetT(lang);
  const unit = nat.unit;
  return (
    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300" data-testid="rivernet-faster">
      <span className="font-medium">{r("fast", { level: formatLevel(unit === "ft" ? fr.m / 0.3048 : fr.m, unit === "ft" ? "ft" : "m"), time: colomboTime(fr.ts, t) })}</span>
      <span className="block text-xs text-slate-500 dark:text-slate-400">
        {r("fastNote", { official: nat.source === "hmis" ? r("official.hmis") : r("official.hourly") })} <RivernetCredit lang={lang} />
      </span>
    </p>
  );
}
