// Which rivers need attention right now.
//
// The homepage lede answers one question: "is anything happening?" That is a
// question about basins, not gauges — someone who sees "Kalu Ganga" wants the
// basin page, not one station. So we classify every gauge, then roll up to the
// worst gauge per basin.
//
// Tiers mirror the Dept of Irrigation's own published thresholds
// (alertpull / minorpull / majorpull) with one addition: `approaching`.
// Two reasons for it:
//   1. A gauge at 99% of alert and rising is more actionable than one sitting
//      2% over alert and falling. Ranking purely on threshold crossings buries
//      the first case.
//   2. Sri Lanka's gauges are below alert on the large majority of days. Without
//      a watch tier this section would be empty most of the year and readers
//      would stop looking at it — which is exactly when it needs to be trusted.

import type { Reading, SnapshotStation } from "./arcgis";

export type Thresholds = {
  alert: number | null;
  minor: number | null;
  major: number | null;
};

export type AttentionTier = "major" | "minor" | "alert" | "approaching";

export const TIER_RANK: Record<AttentionTier, number> = {
  approaching: 0,
  alert: 1,
  minor: 2,
  major: 3,
};

export const TIER_LABEL: Record<AttentionTier, string> = {
  major: "Major flood",
  minor: "Minor flood",
  alert: "Alert",
  approaching: "Approaching alert",
};

// A gauge enters the watch tier at 85% of its alert threshold. Empirically that
// pulls in ~1-3 gauges on a quiet day (Kithulgala sits ~99% in normal weather)
// without flooding the section with the whole dry-zone. Tune here, not inline.
export const APPROACHING_RATIO = 0.85;

// Matches the rate at which BasinFlow's arrow stops calling a gauge "steady".
const RISING_RATE = 0.02;

export type StationAttention = {
  station: string;
  basin: string;
  tier: AttentionTier;
  level: number;
  thresholds: Thresholds;
  /** level / alert. Used for ordering within a tier. */
  ratio: number;
  /** Signed distance to the nearest meaningful threshold, and which one. */
  gap: { label: string; amount: number; crossed: boolean } | null;
  ratePerHour: number | null;
  rising: boolean;
  ts: number;
};

export type BasinAttention = {
  basin: string;
  tier: AttentionTier;
  lead: StationAttention;
  stations: StationAttention[];
  risingCount: number;
  /** How many gauges this basin has in total, for "2 of 5 gauges" copy. */
  gaugeCount: number;
};

// Change over the last ~3h, derived from the 12h trend series. We look for the
// reading closest to 3h before the latest one, but only accept it if it falls in
// a 1h-5h window — outside that the rate is too noisy or too stale to quote.
function ratePerHour(latest: Reading, trend: Reading[]): number | null {
  if (latest.water_level == null) return null;
  const target = latest.ts - 3 * 60 * 60 * 1000;
  const minTs = latest.ts - 5 * 60 * 60 * 1000;
  const maxTs = latest.ts - 1 * 60 * 60 * 1000;

  let best: Reading | null = null;
  for (const r of trend) {
    if (r.water_level == null) continue;
    if (r.ts < minTs || r.ts > maxTs) continue;
    if (!best || Math.abs(r.ts - target) < Math.abs(best.ts - target)) best = r;
  }
  if (!best || best.water_level == null) return null;

  const hours = (latest.ts - best.ts) / 3_600_000;
  if (hours <= 0) return null;
  return (latest.water_level - best.water_level) / hours;
}

function tierFor(level: number, t: Thresholds): AttentionTier | null {
  if (t.major != null && level >= t.major) return "major";
  if (t.minor != null && level >= t.minor) return "minor";
  if (t.alert != null && level >= t.alert) return "alert";
  if (t.alert != null && t.alert > 0 && level >= t.alert * APPROACHING_RATIO) {
    return "approaching";
  }
  return null;
}

function gapFor(level: number, t: Thresholds): StationAttention["gap"] {
  if (t.major != null && level >= t.major) {
    return { label: "major flood", amount: level - t.major, crossed: true };
  }
  if (t.minor != null && level >= t.minor) {
    return { label: "minor flood", amount: level - t.minor, crossed: true };
  }
  if (t.alert != null && level >= t.alert) {
    return { label: "alert", amount: level - t.alert, crossed: true };
  }
  // Below alert: quote the distance still to go.
  if (t.alert != null) {
    return { label: "alert", amount: t.alert - level, crossed: false };
  }
  return null;
}

/**
 * Classify one gauge. Returns null when the gauge is comfortably normal, has no
 * reading, or publishes no alert threshold to measure against.
 *
 * `basin` is passed in rather than read off the snapshot row because
 * `hydrostations` is the authoritative source for basin naming and routing —
 * see the trailing-whitespace gotcha in CLAUDE.md.
 */
export function classifyStation(
  s: SnapshotStation,
  basin: string,
): StationAttention | null {
  const level = s.latest?.water_level ?? null;
  if (s.latest == null || level == null) return null;
  if (s.thresholds.alert == null || !(s.thresholds.alert > 0)) return null;

  const tier = tierFor(level, s.thresholds);
  if (!tier) return null;

  const rate = ratePerHour(s.latest, s.trend);

  return {
    station: s.station,
    basin,
    tier,
    level,
    thresholds: s.thresholds,
    ratio: level / s.thresholds.alert,
    gap: gapFor(level, s.thresholds),
    ratePerHour: rate,
    rising: rate != null && rate > RISING_RATE,
    ts: s.latest.ts,
  };
}

// Worst first: tier, then how far past its alert threshold, then rising before
// falling so two equally-high gauges surface the one still climbing.
function bySeverity(a: StationAttention, b: StationAttention): number {
  return (
    TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
    b.ratio - a.ratio ||
    Number(b.rising) - Number(a.rising) ||
    a.station.localeCompare(b.station)
  );
}

export type AttentionSummary = {
  basins: BasinAttention[];
  /** Every flagged gauge, worst first — drives the "N gauges" summary line. */
  flagged: StationAttention[];
  /** Gauges that reported a usable reading, flagged or not. */
  reporting: number;
  /** Highest-standing gauge overall, even when nothing is flagged. */
  highest: StationAttention | null;
};

/**
 * Roll a national snapshot up into per-basin attention cards.
 *
 * `basinOf` resolves a station name to its canonical (hydrostations) basin.
 * Gauges that don't resolve fall back to the basin on the reading row; gauges
 * with neither are dropped rather than rendered under "(no basin)", since the
 * card's whole purpose is to be a working link to a basin page.
 */
export function buildAttention(
  snapshot: SnapshotStation[],
  basinOf: (station: string) => string | undefined,
): AttentionSummary {
  const flagged: StationAttention[] = [];
  const gaugesPerBasin = new Map<string, number>();
  let reporting = 0;
  let highest: StationAttention | null = null;

  for (const s of snapshot) {
    const basin = (basinOf(s.station) ?? s.basin ?? "").trim();
    if (!basin) continue;
    if (s.latest?.water_level != null) {
      reporting += 1;
      gaugesPerBasin.set(basin, (gaugesPerBasin.get(basin) ?? 0) + 1);
    }

    const hit = classifyStation(s, basin);
    if (hit) flagged.push(hit);

    // Track the closest-to-alert gauge nationally so the all-clear state can
    // still point somewhere useful.
    const level = s.latest?.water_level;
    if (level != null && s.thresholds.alert != null && s.thresholds.alert > 0) {
      const ratio = level / s.thresholds.alert;
      if (!highest || ratio > highest.ratio) {
        highest = {
          station: s.station,
          basin,
          tier: "approaching",
          level,
          thresholds: s.thresholds,
          ratio,
          gap: gapFor(level, s.thresholds),
          ratePerHour: ratePerHour(s.latest!, s.trend),
          rising: false,
          ts: s.latest!.ts,
        };
      }
    }
  }

  flagged.sort(bySeverity);

  const byBasin = new Map<string, StationAttention[]>();
  for (const f of flagged) {
    if (!byBasin.has(f.basin)) byBasin.set(f.basin, []);
    byBasin.get(f.basin)!.push(f);
  }

  const basins: BasinAttention[] = [...byBasin.entries()].map(([basin, list]) => {
    const sorted = [...list].sort(bySeverity);
    return {
      basin,
      tier: sorted[0].tier,
      lead: sorted[0],
      stations: sorted,
      risingCount: sorted.filter((s) => s.rising).length,
      gaugeCount: gaugesPerBasin.get(basin) ?? sorted.length,
    };
  });

  // Order cards by their worst gauge, then by how many gauges are involved —
  // a basin with three gauges over alert outranks one with a single gauge.
  basins.sort(
    (a, b) =>
      TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
      b.lead.ratio - a.lead.ratio ||
      b.stations.length - a.stations.length ||
      a.basin.localeCompare(b.basin),
  );

  return { basins, flagged, reporting, highest };
}
