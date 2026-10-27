import { getHmisRain, nearestRain, HMIS_CREDIT } from "@/lib/hmis";
import { getCorrectedAt } from "@/lib/rainCorrected";
import { hmisT } from "@/lib/i18n/hmis";
import type { Locale } from "@/lib/i18n/config";

/**
 * Two notes, either or both:
 *  - "Measured 64 mm in 24 h at Baddegama rain gauge (NBRO)": the nearest live ground rain gauge (record under 3 h old, within 5 km)
 *    from HMIS, shown ahead of the satellite figure when there is one.
 *  - "Satellite rain, corrected with 12 nearby rain gauges: about 64 mm in 24 h (raw satellite 169 mm)": the satellite pixel the point
 *    sits in, adjusted with the live ground gauges (lib/rainCorrection.ts, read from the data branch; shown when either figure is 10 mm or more).
 * Notes only: they never change an official step, and the heavy-rain / street-water rules keep their raw satellite thresholds (those were
 * backtested on GSMaP; the corrected field is logged beside the raw one until it can be backtested too). Nothing when neither is available.
 */
export async function GroundRainLine({ lang, lat, lon, className = "" }: { lang: Locale; lat: number; lon: number; className?: string }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [rain, corrected] = await Promise.all([getHmisRain(), getCorrectedAt(lat, lon)]);
  const near = rain ? nearestRain(rain.devices, { lat, lon }, Date.now()) : null;
  const showCorrected = !!corrected && Math.max(corrected.raw24, corrected.corr24) >= 10;
  if (!near && !showCorrected) return null;
  const h = hmisT(lang);
  const draft = lang !== "en" ? (lang === "si" ? " (කෙටුම්පත් පරිවර්තනය)" : " (வரைவு மொழிபெயர்ப்பு)") : "";
  const vars = near ? { mm: Math.round(near.device.mm24h), name: near.device.name, inst: near.device.institute, km: (Math.round(near.km * 10) / 10).toString() } : null;
  return (
    <div className={className}>
      {near && vars && (
        <p className="text-sm text-slate-700 dark:text-slate-300" data-testid="ground-rain">
          <span className="font-medium">{near.km >= 1 ? h("rainKm", vars) : h("rain", vars)}</span>
        </p>
      )}
      {showCorrected && corrected && (
        <p className={`text-sm text-slate-700 dark:text-slate-300 ${near ? "mt-1" : ""}`} data-testid="corrected-rain">
          {corrected.near > 0
            ? h("satCorr", { n: corrected.near, mm: Math.round(corrected.corr24), raw: Math.round(corrected.raw24) })
            : h("satCorrRegion", { n: corrected.pairs, mm: Math.round(corrected.corr24), raw: Math.round(corrected.raw24) })}
        </p>
      )}
      <span className="block text-xs text-slate-500 dark:text-slate-400">{HMIS_CREDIT}.{draft}</span>
    </div>
  );
}
