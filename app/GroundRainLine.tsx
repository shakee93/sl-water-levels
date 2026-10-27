import { getHmisRain, nearestRain, HMIS_CREDIT } from "@/lib/hmis";
import { hmisT } from "@/lib/i18n/hmis";
import type { Locale } from "@/lib/i18n/config";

/**
 * "Measured 64 mm in 24 h at Baddegama rain gauge (NBRO)": the nearest live ground rain gauge (record under 3 h old, within 5 km)
 * from HMIS, shown ahead of the satellite figure when there is one. A note only: it never changes an official step, and the
 * heavy-rain rules keep their satellite thresholds (those were backtested on GSMaP, not on ground gauges). Nothing when none is near.
 */
export async function GroundRainLine({ lang, lat, lon, className = "" }: { lang: Locale; lat: number; lon: number; className?: string }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rain = await getHmisRain();
  if (!rain) return null;
  const near = nearestRain(rain.devices, { lat, lon }, Date.now());
  if (!near) return null;
  const h = hmisT(lang);
  const vars = { mm: Math.round(near.device.mm24h), name: near.device.name, inst: near.device.institute, km: (Math.round(near.km * 10) / 10).toString() };
  const draft = lang !== "en" ? (lang === "si" ? " (කෙටුම්පත් පරිවර්තනය)" : " (வரைவு மொழிபெயர்ப்பு)") : "";
  return (
    <p className={`text-sm text-slate-700 dark:text-slate-300 ${className}`} data-testid="ground-rain">
      <span className="font-medium">{near.km >= 1 ? h("rainKm", vars) : h("rain", vars)}</span>
      <span className="block text-xs text-slate-500 dark:text-slate-400">{HMIS_CREDIT}.{draft}</span>
    </p>
  );
}
