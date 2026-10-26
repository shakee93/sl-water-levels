// Every gauge's current forecast + its recent readings, as JSON.
// Read hourly by .github/workflows/store-forecasts.yml, which stores it in the
// Cloudflare D1 prediction log so forecasts can be checked against what happened.
// Public data only; cached so repeated hits don't re-run 42 forecasts.

import { connection } from "next/server";
import { fetchBasinSnapshot, getNational } from "@/lib/arcgis";
import { loadForecast } from "@/lib/forecast";
import coefficients from "@/lib/model/coefficients.json";
import { getGsmap } from "@/lib/gsmap";
import { getForecastRainAll, measuredAtGauge } from "@/lib/stationRain";
import { liftVerdict, riverRising } from "@/lib/verdictLift";

// Computed per request (no ISR): as an ISR route a failed background regeneration kept serving
// one old copy for ~26 h (24-26 Oct), so the hourly store job saw no new forecasts. The upstream
// data calls are cached in lib/arcgis.ts; the CDN still absorbs repeat hits for 60 s.
export const maxDuration = 60;

export async function GET() {
  await connection();
  const national = await getNational();
  const basins = [...new Set(national.map((s) => s.basin))];
  // Rain logged with each run (d1/0009_forecast_rain.sql): the 6 h figures and p90 from the cached weather fetch, the satellite file, the gauge itself.
  const [fcRain, sat] = await Promise.all([getForecastRainAll().catch(() => ({})), getGsmap().catch(() => null)]);
  const runs: unknown[] = [];
  const errors: { basin: string; station?: string; error: string }[] = [];

  for (const basin of basins) {
    let snapshot;
    try {
      snapshot = await fetchBasinSnapshot(basin);
    } catch (e) {
      errors.push({ basin, error: String(e) });
      continue;
    }
    for (const s of snapshot) {
      if (!s.latest) continue;
      try {
        const f = await loadForecast(basin, snapshot, s.station);
        // Same rule as the station card (lib/verdictLift.ts): likely (>= 60%), or close and rising de-tided; a small chance stays calm.
        const key = `${basin.trim()}/${s.station}`;
        const fr = (fcRain as Record<string, import("@/lib/stationRain").ForecastRain>)[key];
        const g = sat?.stations[key] ?? null;
        const mAt = measuredAtGauge(s.station, s.trend24h);
        const lift =
          s.tier === "stale"
            ? null
            : liftVerdict({
                tier: s.tier,
                crossings: f.crossings,
                horizons: f.horizons,
                currentLevel: f.currentLevel,
                rising: riverRising(s.station, s.trend24h, s.metresPerUnit, s.rate3hM),
                now: f.asOfTs ?? s.latest.ts,
              });
        const verdict = lift?.verdict === "alert" ? "alert" : lift?.verdict === "watch" && s.tier === "normal" ? "watch" : s.tier;
        runs.push({
          station: s.station,
          basin,
          issuedAt: f.asOfTs ?? s.latest.ts,
          method: f.method,
          status: f.status,
          unit: f.unit,
          currentLevel: f.currentLevel,
          tier: s.tier,
          verdict,
          headline: f.headline,
          rainPast6hMm: f.rain?.past6hMm ?? null,
          rainNext24hMm: f.rain?.next24hMm.det ?? null,
          rainNext6hMm: fr?.next6h ?? null,
          rainNext6hP90Mm: fr?.next6hP90 ?? null,
          rainNext24hP90Mm: f.rain?.next24hMm.p90 ?? null,
          rainRiskKind: f.rainRisk ? (f.rainRisk.kind ?? "forecast") : null,
          rainRiskLevel: f.rainRisk && f.rainRisk.kind !== "measured" ? f.rainRisk.level : null,
          stormHorizons: f.stormHorizons,
          storm: f.stormHorizons.length > 0 || f.rainRisk != null,
          measured: mAt ? { mm1h: mAt.mm1h, mm3h: mAt.mm3h, mm24h: mAt.mm24h } : null,
          satellite: g ? { mm6h: g.mm6h, mm24h: g.mm24h } : null,
          outlook: f.outlook,
          horizons: f.horizons,
          crossings: f.crossings,
          observations: s.trend24h.map((r) => ({ ts: r.ts, level: r.water_level, rain: r.rain_fall })),
        });
      } catch (e) {
        errors.push({ basin, station: s.station, error: String(e) });
      }
    }
  }

  return Response.json({
    generatedAt: Date.now(),
    modelVersion: (coefficients as { fittedAt?: string }).fittedAt ?? null,
    runs,
    errors,
  });
}
