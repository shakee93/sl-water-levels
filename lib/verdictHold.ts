// Headline hold ("hysteresis") for a gauge whose near-alert / keep-an-eye-on-it headline flips back and forth (owner decision, 28 Oct 2026).
// Pure and dependency-free (node tests import it). The server side (readings + the stored forecast log) is lib/verdictHoldData.ts.
//
// Why: Nagalagam Street's headline changed between normal / watch / alert within hours. The audit (22-28 Oct 2026): its alert chance was
// over 50% 14 h ahead, yet the headline said "watch" only ~2 h and "alert" only ~1-2 h before, and it moved up and down around the
// mark with the twice-daily tide (+-0.6-0.8 ft). A headline that drops back to "all clear" for an hour and returns is worse than one that stays.
//
// What it does: once the gauge has been at "watch" or above (reading near alert, or the stored forecast verdict was watch / alert / minor /
// major), a gauge that now reads Normal keeps the "watch" tone and its near-alert note for `hours` more hours.
// What it NEVER does: change the official step. The step is read from the reading alone (a reading at or above the alert mark is
// "Alert" whatever happened before; a reading below it is never shown as Alert). The hold only keeps the calm "watch" tone (shown as
// "Normal" plus a note) from dropping back to plain "normal"; it cannot raise a gauge to Alert, Minor or Major.
// It ends early when the level has fallen clearly away (more than `releaseFt` below the level where "watch" starts).

export type HoldCfg = {
  /** Hours the watch tone is kept after the condition clears. */
  hours: number;
  /** The hold ends when the level is this many feet below the level at which "watch" starts (0.85 x alert): the river has really gone away. */
  releaseFt: number;
};

/** Gauges with a headline hold, and its settings. Add a gauge here to turn it on for that gauge. Default on for Nagalagam Street (tidal, flips around the mark). */
export const HOLD_GAUGES: Readonly<Record<string, HoldCfg>> = {
  "Nagalagam Street": { hours: 3, releaseFt: 1 },
};
export const holdFor = (station: string): HoldCfg | null => HOLD_GAUGES[station] ?? null;

export type HoldTier = "watch" | "alert" | "minor" | "major" | "normal" | string;
const UP = new Set(["watch", "alert", "minor", "major"]);
const H = 3_600_000;

export type HoldInput = {
  station: string;
  /** The gauge's own tier now, from its reading (lib/status.ts). Only "normal" can be held. */
  tier: string;
  /** Level now and the level at which "watch" starts (station units), and metres per unit. */
  level: number | null;
  watchFrom: number | null;
  mpu: number;
  now: number;
  /** The gauge's tier at each recent reading (from the stored readings): the near-alert wording that has already been shown. */
  pastTiers: readonly { ts: number; tier: string }[];
  /** Verdicts the forecast log stored for this gauge (the forecast-driven watch), raw, never held ones. */
  logged: readonly { ts: number; verdict: string }[];
};
export type HoldResult = { held: boolean; /** When the hold ends (ms) */ until: number | null; why: "reading" | "forecast" | "cleared" | null };
export const NO_HOLD: HoldResult = { held: false, until: null, why: null };

export function holdWatch(i: HoldInput): HoldResult {
  const cfg = holdFor(i.station);
  if (!cfg || i.tier !== "normal") return NO_HOLD;
  // the river has clearly gone away: no hold
  if (i.level != null && i.watchFrom != null && ((i.watchFrom - i.level) * i.mpu) / 0.3048 > cfg.releaseFt) return { held: false, until: null, why: "cleared" };
  const since = i.now - cfg.hours * H;
  const r = i.pastTiers.filter((p) => p.ts >= since && p.ts <= i.now && UP.has(p.tier)).map((p) => p.ts);
  const l = i.logged.filter((p) => p.ts >= since && p.ts <= i.now && UP.has(p.verdict)).map((p) => p.ts);
  const lastR = r.length ? Math.max(...r) : null;
  const lastL = l.length ? Math.max(...l) : null;
  const last = Math.max(lastR ?? -Infinity, lastL ?? -Infinity);
  if (!Number.isFinite(last)) return NO_HOLD;
  return { held: true, until: last + cfg.hours * H, why: lastR != null && lastR >= (lastL ?? -Infinity) ? "reading" : "forecast" };
}

/** The calm tone to show: a held gauge that would read plain "normal" keeps "watch". Everything else (incl. every real step) is untouched. */
export function heldTone<T extends string>(tone: T, hold: HoldResult): T | "watch" {
  return tone === "normal" && hold.held ? "watch" : tone;
}
