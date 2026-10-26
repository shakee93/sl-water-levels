// Flood-status classification shared by the server pages, MCP and attention.

import {
  ageMinutes,
  hasThresholds,
  sanitizeThresholds,
  STALE_MINUTES,
  type Thresholds,
} from "./readings";

/**
 * The one tier vocabulary for the UI.
 *   normal  below 85% of alert
 *   watch   >= 85% of alert, not yet at alert
 *   alert / minor / major  official Dept of Irrigation marks crossed
 *   none    gauge reports, but no flood levels are published for it (e.g. Ampara)
 *   stale   no reading, or the latest is older than 3h ("Not reporting")
 */
export type Tier = "normal" | "watch" | "alert" | "minor" | "major" | "none" | "stale";

export type StatusTone = "green" | "yellow" | "orange" | "red" | "neutral" | "stale";

/** `note` is only set for the internal "watch" tier: its `label` is "Normal" (the Department's ladder is Normal, Alert, Minor flood, Major flood) and the reason is the note. */
export type Status = { label: string; tone: StatusTone; tier: Tier; note?: string };

/** A gauge enters the watch tier at this fraction of its alert threshold. */
export const WATCH_RATIO = 0.85;

/** Tier from the level alone, ignoring freshness. */
export function levelTier(level: number | null, t: Thresholds): Tier {
  if (level == null) return "stale";
  if (!hasThresholds(t)) return "none";
  const { alert, minor, major } = sanitizeThresholds(t);
  if (major != null && level >= major) return "major";
  if (minor != null && level >= minor) return "minor";
  if (alert != null && level >= alert) return "alert";
  if (alert != null && level >= alert * WATCH_RATIO) return "watch";
  return "normal";
}

const STATUS_BY_TIER: Record<Tier, { label: string; tone: StatusTone; note?: string }> = {
  major: { label: "Major flood", tone: "red" },
  minor: { label: "Minor flood", tone: "orange" },
  alert: { label: "Alert", tone: "yellow" },
  watch: { label: "Normal", tone: "green", note: "Near alert" }, // not a step: owner decision 26 Oct 2026
  normal: { label: "Normal", tone: "green" },
  none: { label: "No flood levels set", tone: "neutral" },
  stale: { label: "Not reporting", tone: "stale" },
};

/**
 * @param ts timestamp of the reading `level` came from. When given and older
 *   than 3h the gauge is classed "stale" (label "Stale reading"); when `level`
 *   is null it is "Not reporting". Omit `ts` to skip the freshness check.
 */
export function statusFor(
  level: number | null,
  t: Thresholds,
  ts?: number | null,
  now = Date.now(),
): Status {
  if (level == null) return { ...STATUS_BY_TIER.stale, tier: "stale" };
  if (ts != null) {
    const age = ageMinutes({ ts }, now);
    if (age != null && age > STALE_MINUTES) return { label: "Stale reading", tone: "stale", tier: "stale" };
  }
  const tier = levelTier(level, t);
  return { ...STATUS_BY_TIER[tier], tier };
}
