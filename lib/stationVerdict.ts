// The verdict a gauge's own page shows, for every gauge at once: its tier, lifted to "Get ready" (alert) or "Keep an eye on it"
// (watch) by the shared forecast rule (lib/verdictLift.ts), exactly as app/Forecast.tsx and /api/forecasts do. The home
// "Near you" card and saved gauges (My places, push) read this so they cannot say "Normal" while the gauge page says
// "Get ready" (26 Oct 2026: Nagalagam Street 3.0 ft, 65% chance of alert in ~11 h, home card said Normal).
import { unstable_cache } from "next/cache";
import { fetchBasinSnapshot, getNational, type NationalStation } from "./arcgis";
import { loadForecast } from "./forecast";
import { liftVerdict, riverRising } from "./verdictLift";
import { getReleases, releaseAffectingFrom, type ReleasesResult } from "./releases";
import { officialReleaseAlert } from "./releaseAlert";

type Tier = NationalStation["tier"];
/** v = the page's verdict tier; th / h = the forecast crossing behind a lift (mark and hours ahead), when there is one. */
export type StationVerdict = { v: Tier; th?: "alert" | "minor" | "major"; h?: number | null; /** set when v is Alert because of a confirmed big release above the gauge (lib/releaseAlert.ts) */ release?: { reservoir: string; cusecs: number; gates: number | null } };

async function liftOne(s: NationalStation, rel: ReleasesResult | null): Promise<StationVerdict> {
  const base = await liftForecast(s);
  // A confirmed release of 5,000+ cusecs from the Irrigation Department's own figures, directly above this gauge, is at least Alert
  // (26 Oct 2026: Moragaswewa read Normal at 14.9 ft while Deduru Oya spilled 10,400 cusecs). Only calm gauges move; a real Alert or worse stays.
  const ra = rel && s.latest && (base.v === "normal" || base.v === "watch") ? officialReleaseAlert(releaseAffectingFrom(rel, s.station)) : null;
  return ra ? { ...base, v: "alert", release: ra } : base;
}

async function liftForecast(s: NationalStation): Promise<StationVerdict> {
  // real readings win: only calm gauges can be lifted, and a stale gauge is never guessed at
  if (!s.latest || (s.tier !== "normal" && s.tier !== "watch")) return { v: s.tier };
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
  const v: Tier = lift?.verdict === "alert" ? "alert" : lift?.verdict === "watch" && s.tier === "normal" ? "watch" : s.tier;
  // th / h whenever the forecast says a crossing is likely (or close), even when the tier stays the same: the home page lists them
  // Minor / Major are never "likely" (lib/forecastRules.mjs caps their chance at 30% / 10%): only an Alert crossing is listed as "Likely to reach".
  const strong = lift?.crossing && lift.crossing.threshold === "alert" && (lift.why === "likely" || lift.why === "close");
  return strong ? { v, th: lift.crossing!.threshold, h: lift.etaHours } : { v };
}

/** Station name -> verdict tier. Cached 2 min (forecasts change only with a new hourly reading); a failed gauge keeps its own tier. */
export const getStationVerdicts = unstable_cache(
  async (): Promise<Record<string, StationVerdict>> => {
    const national = await getNational();
    const out: Record<string, StationVerdict> = {};
    const rel = await getReleases().catch(() => null); // fails soft: no answer = no release claimed
    await Promise.all(national.map(async (s) => (out[s.station] = await liftOne(s, rel).catch(() => ({ v: s.tier })))));
    return out;
  },
  ["station-verdicts-v4"],
  { revalidate: 120 },
);
