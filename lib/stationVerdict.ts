// The verdict a gauge's own page shows, for every gauge at once: its tier, lifted to "Get ready" (alert) or "Keep an eye on it"
// (watch) by the shared forecast rule (lib/verdictLift.ts), exactly as app/Forecast.tsx and /api/forecasts do. The home
// "Near you" card and saved gauges (My places, push) read this so they cannot say "Normal" while the gauge page says
// "Get ready" (26 Oct 2026: Nagalagam Street 3.0 ft, 65% chance of alert in ~11 h, home card said Normal).
import { unstable_cache } from "next/cache";
import { fetchBasinSnapshot, getNational, type NationalStation } from "./arcgis";
import { loadForecast } from "./forecast";
import { liftVerdict, riverRising } from "./verdictLift";

type Tier = NationalStation["tier"];

async function liftOne(s: NationalStation): Promise<Tier> {
  // real readings win: only calm gauges can be lifted, and a stale gauge is never guessed at
  if (!s.latest || (s.tier !== "normal" && s.tier !== "watch")) return s.tier;
  const snapshot = await fetchBasinSnapshot(s.basin);
  const f = await loadForecast(s.basin, snapshot, s.station);
  const lift = liftVerdict({
    tier: s.tier,
    crossings: f.crossings,
    horizons: f.horizons,
    currentLevel: f.currentLevel,
    rising: riverRising(s.station, s.trend24h, s.metresPerUnit, s.rate3hM),
    now: f.asOfTs ?? s.latest.ts,
  });
  return lift?.verdict === "alert" ? "alert" : lift?.verdict === "watch" && s.tier === "normal" ? "watch" : s.tier;
}

/** Station name -> verdict tier. Cached 2 min (forecasts change only with a new hourly reading); a failed gauge keeps its own tier. */
export const getStationVerdicts = unstable_cache(
  async (): Promise<Record<string, Tier>> => {
    const national = await getNational();
    const out: Record<string, Tier> = {};
    await Promise.all(national.map(async (s) => (out[s.station] = await liftOne(s).catch(() => s.tier))));
    return out;
  },
  ["station-verdicts-v1"],
  { revalidate: 120 },
);
