// Every gauge's current forecast + its recent readings, as JSON.
// Read hourly by .github/workflows/store-forecasts.yml, which stores it in the
// Cloudflare D1 prediction log so forecasts can be checked against what happened.
// Public data only; cached so repeated hits don't re-run 42 forecasts.

import { connection } from "next/server";
import { fetchBasinSnapshot, getNational } from "@/lib/arcgis";
import { loadForecast } from "@/lib/forecast";
import coefficients from "@/lib/model/coefficients.json";

// Computed per request (no ISR): as an ISR route a failed background regeneration kept serving
// one old copy for ~26 h (24-26 Oct), so the hourly store job saw no new forecasts. The upstream
// data calls are cached in lib/arcgis.ts; the CDN still absorbs repeat hits for 60 s.
export const maxDuration = 60;

const RANK = ["normal", "watch", "alert", "minor", "major"] as const;

export async function GET() {
  await connection();
  const national = await getNational();
  const basins = [...new Set(national.map((s) => s.basin))];
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
        // Same rule as the station card: a forecast crossing lifts normal/watch to alert
        // when it's likely, or possible while the river is rising.
        const rising = (s.rate3hM ?? 0) > 0.006;
        const crossing = f.crossings.some(
          (c) => c.wording === "likely" || (c.wording === "possible" && rising),
        );
        const verdict =
          s.tier !== "stale" && crossing && RANK.indexOf(s.tier as (typeof RANK)[number]) <= 1 ? "alert" : s.tier;
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
