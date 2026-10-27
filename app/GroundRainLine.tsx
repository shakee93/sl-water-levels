import { getHmisRain, nearestRain, HMIS_CREDIT } from "@/lib/hmis";
import { getCorrectedAt } from "@/lib/rainCorrected";
import { getGroundRainAt } from "@/lib/groundRainLive";
import { hmisT } from "@/lib/i18n/hmis";
import type { Locale } from "@/lib/i18n/config";

/**
 * Rain source order (lib/groundRain.ts): a live ground gauge within 5 km (record at most 1 h old) first, then the gauge-corrected satellite,
 * then (the town page's own rain lines) the raw satellite. The note names the source it used. Two notes, either or both:
 *  - "Measured at Kolonnawa rain gauge (Met Department), 3.4 km away: about 18 mm in the last hour, 42 mm in 24 h": the live ground gauge(s)
 *    within 5 km, nearest or inverse-distance mean of two or more (lib/groundRainLive.ts). The hour figure is a lower bound derived from the
 *    gauge's rolling 24 h sum and is left out when the archive cannot give it, then the older note below stands.
 *  - (older, kept as the fallback) "Measured 64 mm in 24 h at Baddegama rain gauge (NBRO)": the nearest live ground rain gauge (record under 3 h old, within 5 km)
 *    from HMIS, shown ahead of the satellite figure when there is one.
 *  - "Satellite rain, corrected with 12 nearby rain gauges: about 64 mm in 24 h (raw satellite 169 mm)": the satellite pixel the point
 *    sits in, adjusted with the live ground gauges (lib/rainCorrection.ts, read from the data branch; shown when either figure is 10 mm or more).
 * Notes only: they never change an official step, and the heavy-rain / street-water rules keep their raw satellite thresholds (those were
 * backtested on GSMaP; the corrected field is logged beside the raw one until it can be backtested too). Nothing when neither is available.
 */
export async function GroundRainLine({ lang, lat, lon, className = "" }: { lang: Locale; lat: number; lon: number; className?: string }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [rain, corrected, ground] = await Promise.all([getHmisRain(), getCorrectedAt(lat, lon), getGroundRainAt(lat, lon)]);
  // the live-gauge line needs the hour figure; without it (a gauge that has just appeared) the 24 h line below is shown as before
  const g0 = ground && ground.mm1h != null && ground.mm24h != null ? ground.gauges[0] : null;
  const near = !g0 && rain ? nearestRain(rain.devices, { lat, lon }, Date.now()) : null;
  const showCorrected = !g0 && !!corrected && Math.max(corrected.raw24, corrected.corr24) >= 10;
  if (!g0 && !near && !showCorrected) return null;
  const h = hmisT(lang);
  const draft = lang !== "en" ? (lang === "si" ? " (කෙටුම්පත් පරිවර්තනය)" : " (வரைவு மொழிபெயர்ப்பு)") : "";
  const vars = near ? { mm: Math.round(near.device.mm24h), name: near.device.name, inst: near.device.institute, km: (Math.round(near.km * 10) / 10).toString() } : null;
  const gv = g0 && ground ? { name: g0.name.replace(/\s+/g, " ").trim(), inst: g0.institute, km: g0.km.toString(), n: ground.gauges.length, h1: Math.round(ground.mm1h ?? 0), mm: Math.round(ground.mm24h ?? 0) } : null;
  return (
    <div className={className}>
      {gv && (
        <p className="text-sm text-slate-700 dark:text-slate-300" data-testid="ground-rain-live">
          <span className="font-medium">{h(gv.n > 1 ? "rainNowMany" : "rainNow", gv)}</span>
        </p>
      )}
      {near && vars && (
        <p className="text-sm text-slate-700 dark:text-slate-300" data-testid="ground-rain">
          <span className="font-medium">{near.km >= 1 ? h("rainKm", vars) : h("rain", vars)}</span>
        </p>
      )}
      {showCorrected && corrected && (
        <p className={`text-sm text-slate-700 dark:text-slate-300 ${near || gv ? "mt-1" : ""}`} data-testid="corrected-rain">
          {corrected.near > 0
            ? h("satCorr", { n: corrected.near, mm: Math.round(corrected.corr24), raw: Math.round(corrected.raw24) })
            : h("satCorrRegion", { n: corrected.pairs, mm: Math.round(corrected.corr24), raw: Math.round(corrected.raw24) })}
        </p>
      )}
      <span className="block text-xs text-slate-500 dark:text-slate-400">{HMIS_CREDIT}.{draft}</span>
    </div>
  );
}
