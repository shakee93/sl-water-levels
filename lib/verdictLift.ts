// The ONE rule for lifting a calm gauge's verdict to "Get ready" (alert) from a forecast crossing. Used by the station
// page verdict (app/Forecast.tsx), /api/forecasts (app/api/forecasts/route.ts) and the town verdict (lib/townRisk.ts, which
// also drives My places, push and the share cards), so they cannot disagree. Pure and dependency-free (node tests import it).
//
// Why it exists (26 Oct 2026, ~12:30): Nagalagam Street at 2.6 ft (alert 4.0) read "Get ready" because the crossing was
// "possible" (45%, ETA ~9 h) and the 3 h rate was positive. That rise was the twice-daily TIDE at Mutwal (the level follows the sea
// with 0-2 h lag, +-0.6-0.8 ft), and the "possible" came from the wide storm band (rain p90), whose top touches alert; the
// central forecast never got within a foot of 4.0 ft. Earlier backtest: only ~35% of storm-mode alert flags saw a real crossing.
//
// Rule (alert-level crossing or higher, gauge currently normal or watch):
//   Get ready  = probability >= LIFT_P_LIKELY (0.6)
//             OR probability >= LIFT_P_CLOSE (0.4) AND the CENTRAL forecast at some horizon <= 12 h is within 15% of the
//                gap to the mark (gap = mark - level now) AND the river is rising on a de-tided basis.
//   Otherwise a "possible" crossing = the calm "Keep an eye on it" tone with a plain small-chance line, no action.
// Real readings win: this never touches a gauge whose own level is already alert or higher, and never goes above alert.
//
// Thresholds: the D1 log (forecast_crossings x observations, alert mark, 26 Oct 2026) holds only ~60 candidate rows in ~29
// 12-hour episodes: p 0.2-0.4 hit 1 of 21 (river) and 0 of 9 (tidal gauges); p 0.4-0.6 hit 1 of 22; p >= 0.6 hit 1 of 7.
// That is too thin to fit anything, so 0.6 / 0.4 / 15% are chosen (not fitted) to be stricter than the old "likely (50%) or
// possible + rising"; re-check them against the archive when more storm events exist.

export const LIFT_P_LIKELY = 0.6;
export const LIFT_P_CLOSE = 0.4;
export const LIFT_CLOSE_FRAC = 0.15;
export const LIFT_CLOSE_HOURS = 12;
/** Non-tidal gauges: "rising" = 3 h rate above this (metres per hour), same as the steady band of the next-hour line. */
export const RISING_M_PER_H = 0.006;
/** Tide repeats every 12.42 h (M2): comparing with the level this long ago compares the same tide phase. */
export const TIDE_PERIOD_H = 12.4;
/** Tidal gauges: a real rise = at least this much (metres, ~0.2 ft) above the level one tide cycle ago. */
export const TIDAL_RISE_M = 0.06;

/**
 * Gauges whose fitted model has a tide term on (lib/model/gauge-model.json, any horizon). Kept inline so the pure rule needs no
 * JSON import; scripts/verdict-lift.test.mts fails if this list and the model ever differ.
 */
export const TIDAL_STATIONS: ReadonlySet<string> = new Set(["Nagalagam Street", "Peradeniya", "Putupaula", "Thalgahagoda"]);
export const isTidalStation = (station: string): boolean => TIDAL_STATIONS.has(station);

type Reading = { ts: number; water_level: number | null };

/**
 * Is the river really rising? Non-tidal gauge: the 3 h rate (metres per hour) above the steady band. Tidal gauge: the level now
 * against the level one tide cycle (12.4 h) earlier, so the tide cancels; no comparable reading = not rising (never guess a rise
 * from the tide). `trend24h` is NationalStation.trend24h (ascending), `mpu` metres per station unit.
 */
export function riverRising(station: string, trend24h: readonly Reading[] | null | undefined, mpu: number, rate3hM: number | null): boolean {
  if (!isTidalStation(station)) return rate3hM != null && rate3hM > RISING_M_PER_H;
  const pts = (trend24h ?? []).filter((r) => r.water_level != null);
  if (pts.length < 2) return false;
  const now = pts[pts.length - 1];
  const target = now.ts - TIDE_PERIOD_H * 3_600_000;
  let best: Reading | null = null;
  for (const p of pts) if (Math.abs(p.ts - target) <= 45 * 60_000 && (best == null || Math.abs(p.ts - target) < Math.abs(best.ts - target))) best = p;
  if (!best) return false;
  return (now.water_level! - best.water_level!) * mpu >= TIDAL_RISE_M;
}

export type LiftCrossing = { threshold: "alert" | "minor" | "major"; level?: number; wording: "likely" | "possible" | "unlikely" | "already"; probability?: number; etaTs: number | null };
export type LiftInput = {
  /** The gauge's own tier. Only normal and watch can be lifted. */
  tier: string;
  crossings: readonly LiftCrossing[];
  /** Central forecast levels (not the band), station units, by hours ahead. */
  horizons?: readonly { h: number; level: number }[] | null;
  currentLevel: number | null;
  /** From riverRising(): de-tided for tidal gauges. */
  rising: boolean;
  /** Now (ms), to turn an ETA into hours. */
  now: number;
};
export type LiftResult = {
  /** "alert" = Get ready; "watch" = Keep an eye on it (small chance); "none" = leave the gauge's own tier. */
  verdict: "alert" | "watch" | "none";
  why: "likely" | "close" | "small" | null;
  /** The crossing the line is about (earliest likely/possible). */
  crossing: LiftCrossing | null;
  /** ETA in whole hours, null when none stated. */
  etaHours: number | null;
};

const pOf = (c: LiftCrossing) => c.probability ?? (c.wording === "likely" ? LIFT_P_LIKELY : c.wording === "possible" ? 0.3 : 0);

export function liftVerdict(i: LiftInput): LiftResult {
  const none: LiftResult = { verdict: "none", why: null, crossing: null, etaHours: null };
  if (i.tier !== "normal" && i.tier !== "watch") return none;
  const cands = i.crossings
    .filter((c) => c.wording === "likely" || c.wording === "possible")
    .sort((a, b) => (a.etaTs ?? Infinity) - (b.etaTs ?? Infinity));
  if (!cands.length) return none;
  const eta = (c: LiftCrossing) => (c.etaTs != null ? Math.max(1, Math.round((c.etaTs - i.now) / 3_600_000)) : null);
  const near = (c: LiftCrossing) => {
    if (i.currentLevel == null || c.level == null || !i.horizons) return false;
    const mark = c.level;
    const gap = mark - i.currentLevel;
    if (gap <= 0) return true;
    return i.horizons.some((h) => h.h <= LIFT_CLOSE_HOURS && h.level >= mark - LIFT_CLOSE_FRAC * gap);
  };
  for (const c of cands) {
    const p = pOf(c);
    if (p >= LIFT_P_LIKELY) return { verdict: "alert", why: "likely", crossing: c, etaHours: eta(c) };
    if (p >= LIFT_P_CLOSE && i.rising && near(c)) return { verdict: "alert", why: "close", crossing: c, etaHours: eta(c) };
  }
  const c = cands[0];
  return { verdict: "watch", why: "small", crossing: c, etaHours: eta(c) };
}

/** "about 4 in 10": a probability as words (never a percentage on the main card). */
export function chanceWords(p: number): { en: string; si: string; ta: string } {
  const n = Math.min(10, Math.max(1, Math.floor(p * 10 + 1e-9))); // rounded down: never overstate
  return { en: `about ${n} in 10`, si: `10 න් ${n}ක් පමණ`, ta: `10 இல் சுமார் ${n}` };
}
