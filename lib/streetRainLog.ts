// Pure logic for the street-rain rule's live log: thresholds, the rule's state, state changes and when to tell
// the owner. No imports on purpose: scripts/street-rain-log.mjs (GitHub Actions, run with
// node --experimental-strip-types) loads this file. The thresholds repeat lib/townRisk.ts; scripts/street-flood.test.mts
// fails if the two drift apart.

/** Satellite (GSMaP_NOW) rain over the area, 24 h total at which street water is "possible" ... */
export const STREET_POSSIBLE_MM_24H = 60;
/** ... and "likely". Calibrated on GSMaP_NOW only (research/wellampitiya-flood-rule-backtest.md). */
export const STREET_LIKELY_MM_24H = 100;

export type StreetState = "none" | "possible" | "likely";

/** The rule's verdict for a 24 h total. null (missing or not a number) = the rule is off: no state, never "none". */
export function streetState(mm24h: number | null | undefined): StreetState | null {
  if (typeof mm24h !== "number" || !Number.isFinite(mm24h)) return null;
  return mm24h >= STREET_LIKELY_MM_24H ? "likely" : mm24h >= STREET_POSSIBLE_MM_24H ? "possible" : "none";
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
