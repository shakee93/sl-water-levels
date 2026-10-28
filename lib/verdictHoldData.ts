// Server side of the headline hold (lib/verdictHold.ts): works out, for one gauge, whether its calm "watch" headline is still being held.
// Evidence, never client state: (1) the gauge's own stored readings of the last 24 h (the tier each reading had), and (2) the forecast log
// in D1 (forecast_runs.verdict, written hourly by /api/forecasts with the RAW verdict, so a held headline can never hold itself).
// Only gauges listed in HOLD_GAUGES ever touch D1. Fails soft: no D1, a slow D1 or no rows = the readings alone decide.
import { unstable_cache } from "next/cache";
import { d1Configured, d1Query } from "./d1";
import { soft } from "./soft";
import { levelTier, WATCH_RATIO } from "./status";
import type { Thresholds } from "./readings";
import { holdFor, holdWatch, NO_HOLD, type HoldResult } from "./verdictHold";

/** Time the page waits for the forecast-log read before going on with the readings alone. */
export const HOLD_BUDGET_MS = 1500;

type Logged = { ts: number; verdict: string }[];
const loggedVerdicts = unstable_cache(
  async (station: string): Promise<Logged> => {
    const rows = await d1Query("SELECT issued_at, verdict FROM forecast_runs WHERE station = ? AND issued_at > ? ORDER BY issued_at", [station, Date.now() - 6 * 3_600_000]);
    return rows.filter((r) => r.verdict != null).map((r) => ({ ts: Number(r.issued_at), verdict: String(r.verdict) }));
  },
  ["verdict-hold-log-v1"],
  { revalidate: 300 },
);

export type HoldStation = {
  station: string;
  /** The gauge's own tier from its reading. */
  tier: string;
  latest: { ts: number; water_level: number | null } | null;
  thresholds: Thresholds;
  metresPerUnit: number;
  trend24h: readonly { ts: number; water_level: number | null }[];
};

/** Is this gauge's calm headline being held right now? Always NO_HOLD for a gauge that is not in HOLD_GAUGES or is not reading Normal. */
export async function getHold(s: HoldStation): Promise<HoldResult> {
  if (!holdFor(s.station) || s.tier !== "normal" || !s.latest) return NO_HOLD;
  const alert = s.thresholds.alert;
  const input = {
    station: s.station,
    tier: s.tier,
    level: s.latest.water_level,
    watchFrom: alert != null && alert > 0 ? alert * WATCH_RATIO : null,
    mpu: s.metresPerUnit,
    now: s.latest.ts,
    pastTiers: s.trend24h.filter((r) => r.water_level != null).map((r) => ({ ts: r.ts, tier: levelTier(r.water_level, s.thresholds) as string })),
    logged: [] as Logged,
  };
  const fromReadings = holdWatch(input);
  if (fromReadings.held || fromReadings.why === "cleared" || !d1Configured()) return fromReadings;
  const logged = await soft(loggedVerdicts(s.station).catch(() => [] as Logged), HOLD_BUDGET_MS, [] as Logged);
  return holdWatch({ ...input, logged });
}
