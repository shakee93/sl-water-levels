// Which rivers need attention right now.
//
// The homepage lede answers one question: "is anything happening?" That is a
// question about basins, not gauges — someone who sees "Kalu Ganga" wants the
// basin page, not one station. So we classify every gauge, then roll up to the
// worst gauge per basin.
//
// Tiers mirror the Dept of Irrigation's own published thresholds
// (alertpull / minorpull / majorpull) with one addition: `watch`.
// Two reasons for it:
//   1. A gauge at 99% of alert and rising is more actionable than one sitting
//      2% over alert and falling. Ranking purely on threshold crossings buries
//      the first case.
//   2. Sri Lanka's gauges are below alert on the large majority of days. Without
//      a watch tier this section would be empty most of the year and readers
//      would stop looking at it — which is exactly when it needs to be trusted.

import type { NationalStation } from "./arcgis";
import { isStale, thresholdGap, type ThresholdGap, type Thresholds } from "./readings";
import { WATCH_RATIO } from "./status";

export type { Thresholds };

export type AttentionTier = "major" | "minor" | "alert" | "watch";

export const TIER_RANK: Record<AttentionTier, number> = {
  watch: 0,
  alert: 1,
  minor: 2,
  major: 3,
};

export const TIER_LABEL: Record<AttentionTier, string> = {
  major: "Major flood",
  minor: "Minor flood",
  alert: "Alert",
  watch: "Approaching alert",
};

// A gauge enters the watch tier at 85% of its alert threshold (shared with
// status.ts so the badge and the homepage agree). Empirically that pulls in
// ~1-3 gauges on a quiet day (Kithulgala sits ~99% in normal weather) without
// flooding the section with the whole dry-zone. Tune it in status.ts.
export const APPROACHING_RATIO = WATCH_RATIO;

// A gauge counts as "rising" above this 3h rate, in METRES per hour so feet and
// metre gauges are treated alike. 0.006 m/h is the old 0.02 ft/h (the point at
// which BasinFlow's arrow stops calling a gauge "steady").
export const RISING_M_PER_H = 0.006;

export type StationAttention = {
  station: string;
  basin: string;
  tier: AttentionTier;
  level: number;
  thresholds: Thresholds;
  /** level / alert. Used for ordering within a tier. */
  ratio: number;
  /** Signed distance to the nearest meaningful threshold, and which one. */
  gap: ThresholdGap | null;
  /** 3h rate in the station's own units; see `rising` for the unit-aware verdict. */
  ratePerHour: number | null;
  rising: boolean;
  ts: number;
  /** Latest reading is older than 3h: still shown (last known) but never "rising". */
  stale: boolean;
  ageMin: number | null;
  href: string;
};

export type BasinAttention = {
  basin: string;
  basinHref: string;
  tier: AttentionTier;
  lead: StationAttention;
  stations: StationAttention[];
  risingCount: number;
  /** How many gauges this basin has in total, for "2 of 5 gauges" copy. */
  gaugeCount: number;
};

function attentionTier(s: NationalStation): AttentionTier | null {
  const t = s.levelTier;
  return t === "major" || t === "minor" || t === "alert" || t === "watch" ? t : null;
}

function toAttention(s: NationalStation, tier: AttentionTier): StationAttention | null {
  const level = s.latest?.water_level;
  const alert = s.thresholds.alert;
  if (!s.latest || level == null || alert == null) return null;
  const stale = isStale(s.latest);
  return {
    station: s.station,
    basin: s.basin,
    tier,
    level,
    thresholds: s.thresholds,
    ratio: level / alert,
    gap: thresholdGap(level, s.thresholds),
    ratePerHour: s.rate3h,
    rising: !stale && s.rate3hM != null && s.rate3hM > RISING_M_PER_H,
    ts: s.latest.ts,
    stale,
    ageMin: s.ageMin,
    href: s.href,
  };
}

/**
 * Classify one gauge. Returns null when the gauge is comfortably normal, has no
 * reading, or publishes no alert threshold to measure against.
 */
export function classifyStation(s: NationalStation): StationAttention | null {
  const tier = attentionTier(s);
  return tier ? toAttention(s, tier) : null;
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
  /** Gauges with a fresh (<=3h) usable reading, flagged or not. */
  reporting: number;
  /** Gauges with no data or a stale reading. */
  notReporting: number;
  /** Closest-to-alert fresh gauge overall, even when nothing is flagged. */
  highest: StationAttention | null;
};

/**
 * Roll the national snapshot up into per-basin attention cards. Every
 * NationalStation already has a canonical, trimmed hydrostations basin, and
 * basin-less stations never reach here, so every card links to a real page.
 */
export function buildAttention(snapshot: NationalStation[]): AttentionSummary {
  const flagged: StationAttention[] = [];
  const gaugesPerBasin = new Map<string, number>();
  let reporting = 0;
  let notReporting = 0;
  let highest: StationAttention | null = null;

  for (const s of snapshot) {
    if (!s.basin) continue;
    const fresh = s.latest?.water_level != null && !isStale(s.latest);
    if (fresh) {
      reporting += 1;
      gaugesPerBasin.set(s.basin, (gaugesPerBasin.get(s.basin) ?? 0) + 1);
    } else {
      notReporting += 1;
    }

    const hit = classifyStation(s);
    if (hit) flagged.push(hit);

    const alert = s.thresholds.alert;
    const level = s.latest?.water_level;
    if (fresh && level != null && alert != null) {
      const ratio = level / alert;
      if (!highest || ratio > highest.ratio) {
        highest = toAttention(s, attentionTier(s) ?? "watch");
        if (highest) highest = { ...highest, tier: "watch", rising: false };
      }
    }
  }

  flagged.sort(bySeverity);

  const byBasin = new Map<string, StationAttention[]>();
  for (const f of flagged) {
    if (!byBasin.has(f.basin)) byBasin.set(f.basin, []);
    byBasin.get(f.basin)!.push(f);
  }
  const hrefByBasin = new Map(snapshot.map((s) => [s.basin, s.basinHref] as const));

  const basins: BasinAttention[] = [...byBasin.entries()].map(([basin, list]) => {
    const sorted = [...list].sort(bySeverity);
    return {
      basin,
      basinHref: hrefByBasin.get(basin) ?? "/",
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

  return { basins, flagged, reporting, notReporting, highest };
}
