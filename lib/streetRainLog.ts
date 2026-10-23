// Pure logic for the street-rain rule's live log: thresholds, the rule's state, state changes and when to tell
// the owner. No imports on purpose: scripts/street-rain-log.mjs (GitHub Actions, run with
// node --experimental-strip-types) loads this file. The thresholds repeat lib/townRisk.ts; scripts/street-flood.test.mts
// fails if the two drift apart.

/** Satellite (GSMaP_NOW) rain over the area, 24 h total (each hour clipped at 15 mm) at which street water is "possible" ... */
export const STREET_POSSIBLE_MM_24H = 60;
/** ... and "likely". Calibrated on GSMaP_NOW only (research/wellampitiya-flood-rule-backtest.md). */
export const STREET_LIKELY_MM_24H = 100;

/** No single hour counts for more than this in the 24 h sum (repeated as a literal in scripts/gsmap-snapshot.mjs; the test checks both). */
export const STREET_HOURLY_CAP_MM = 15;

/** Nagalagam Street at or above this many feet counts as the Kelani at minor flood level (its own published minor mark is 5 ft). */
export const NAGALAGAM_MINOR_FT = 5;
/** A gauge reading older than this is not used for the river trigger (same limit as "stale" on the site). */
export const RIVER_MAX_AGE_MIN = 180;

export type StreetState = "none" | "possible" | "likely";

/**
 * The rule's verdict. `mm24hClipped` is the 24 h sum of hourly rain with each hour clipped at 15 mm (NOT the raw total);
 * `river` is true when the Kelani is at its minor flood level (riverTrigger). The river alone makes "likely".
 * No rain total and no river trigger = the rule is off: null, never "none".
 */
export function streetState(mm24hClipped: number | null | undefined, river = false): StreetState | null {
  if (river) return "likely";
  if (typeof mm24hClipped !== "number" || !Number.isFinite(mm24hClipped)) return null;
  return mm24hClipped >= STREET_LIKELY_MM_24H ? "likely" : mm24hClipped >= STREET_POSSIBLE_MM_24H ? "possible" : "none";
}

export type RiverReading = {
  station: string;
  /** Latest level in FEET (metre gauges converted); null = no usable reading. */
  levelFt: number | null;
  /** The gauge's own published minor flood mark in FEET; null = none published. */
  minorFt: number | null;
  /** Minutes since the reading; null = unknown (treated as stale). */
  ageMin: number | null;
};

export type RiverTrigger = { triggered: boolean; station: string | null; levelFt: number | null };

/**
 * The river half of the street rule: Nagalagam Street at or above 5 ft, or Hanwella at or above the minor mark the
 * gauge itself publishes (24.6 ft = 7.5 m in 2026; never a hardcoded value). Only fresh readings count. Pure; the
 * site (lib/townData.ts) and the logging job (scripts/street-rain-log.mjs, from /api/levels) both use it.
 */
export function riverTrigger(readings: RiverReading[]): RiverTrigger {
  let best: RiverTrigger = { triggered: false, station: null, levelFt: null };
  for (const r of readings) {
    if (r.levelFt == null || !Number.isFinite(r.levelFt) || r.ageMin == null || r.ageMin > RIVER_MAX_AGE_MIN) continue;
    const mark = r.station === "Nagalagam Street" ? NAGALAGAM_MINOR_FT : r.station === "Hanwella" && r.minorFt != null && r.minorFt > 0 ? r.minorFt : null;
    if (mark == null || r.levelFt < mark) continue;
    if (!best.triggered) best = { triggered: true, station: r.station, levelFt: r.levelFt };
  }
  return best;
}

const RANK: Record<StreetState, number> = { none: 0, possible: 1, likely: 2 };

export type StateChange = { from: StreetState | null; to: StreetState };

/**
 * A change happened when the new state differs from the last KNOWN state. A run with no state (rain total missing)
 * is neither a change nor a reset: the next run with data compares against the last known one.
 */
export function stateChange(lastKnown: StreetState | null, now: StreetState | null): StateChange | null {
  if (now == null || now === lastKnown) return null;
  return { from: lastKnown, to: now };
}

/** The first ever row (no earlier state) only counts as a change when it is not "none". */
export function isReportable(c: StateChange): boolean {
  return !(c.from == null && c.to === "none");
}

/** A rise ping is held back if another rise ping went out less than this long ago (24 h totals wobble near a threshold). */
export const FLAP_GUARD_MS = 3 * 3_600_000;
/** A change nobody was told about within this long is not announced late. */
export const NOTICE_MAX_AGE_MS = 6 * 3_600_000;

export type Notice = "rise" | "clear" | null;

/**
 * Whether a state change deserves one Slack message:
 *  - rising (none -> possible, none -> likely, possible -> likely): "rise", unless a rise was announced < 3 h ago;
 *  - back to none: "clear", always;
 *  - likely -> possible: no message (still wet; the log keeps it).
 */
export function noticeFor(c: StateChange, lastRiseNoticeMs: number | null, changedMs: number, nowMs: number): Notice {
  if (nowMs - changedMs > NOTICE_MAX_AGE_MS) return null;
  if (c.to === "none") return c.from == null ? null : "clear";
  const rising = c.from == null || RANK[c.to] > RANK[c.from];
  if (!rising) return null;
  if (lastRiseNoticeMs != null && changedMs - lastRiseNoticeMs < FLAP_GUARD_MS) return null;
  return "rise";
}
