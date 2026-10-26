import type { Tier } from "@/lib/arcgis";
import type { TFn } from "@/lib/i18n/translate";

// Shared tier vocabulary for the home page (list dots, favourites, map).
// Worst first.
export const TIER_ORDER: Tier[] = ["major", "minor", "alert", "watch", "normal", "none", "stale"];
export const tierRank = (t: Tier) => TIER_ORDER.indexOf(t);

/** Localised tier label: tierLabel(t, "major") -> "Major flood" / "ප්‍රධාන ගංවතුර". */
export const tierLabel = (t: TFn, tier: Tier): string => t(`tier.${tier}` as const);

/** Compact one-line status. A near-alert gauge reads "Normal" with the reason as a plain note; never its own step. */
export const tierLine = (t: TFn, tier: Tier): string => (tier === "watch" ? `${t("tier.watch")} · ${t("tier.nearShort")}` : tierLabel(t, tier));

export const TIER_DOT: Record<Tier, string> = {
  major: "bg-red-500",
  minor: "bg-orange-500",
  alert: "bg-amber-500",
  watch: "bg-slate-400 dark:bg-slate-500", // near alert is Normal to look at (owner, 26 Oct 2026)
  normal: "bg-slate-400 dark:bg-slate-500",
  none: "bg-slate-300",
  stale: "bg-slate-300",
};

// Map fills. Normal is a quiet blue-grey so only the gauges that matter pop.
export const TIER_HEX: Record<Tier, string> = {
  major: "#dc2626",
  minor: "#ea580c",
  alert: "#f59e0b",
  watch: "#64748b", // same as normal: near alert is not a step
  normal: "#64748b",
  none: "#cbd5e1",
  stale: "#cbd5e1",
};

// Text colours with AA contrast on white / slate-900.
export const TIER_TEXT_CLASS: Record<Tier, string> = {
  major: "text-red-700 dark:text-red-400",
  minor: "text-orange-700 dark:text-orange-400",
  alert: "text-amber-700 dark:text-amber-400",
  watch: "text-slate-600 dark:text-slate-300",
  normal: "text-slate-600 dark:text-slate-300",
  none: "text-slate-500 dark:text-slate-400",
  stale: "text-slate-500 dark:text-slate-400",
};

/** Compact per-gauge payload handed to client components. */
export type HomeStation = {
  station: string;
  basin: string;
  latitude: number;
  longitude: number;
  href: string;
  tier: Tier;
  level: number | null;
  unit: "ft" | "m" | null;
  ts: number | null;
  rate3hM: number | null;
  /** The gauge page's verdict (tier lifted by the forecast rule, lib/stationVerdict.ts); absent = same as tier. */
  verdict?: Tier;
};

// Same threshold as lib/attention RISING_M_PER_H: below this a gauge is "steady".
export const STEADY_M_PER_H = 0.006;

export { formatAge, clock as colomboTime } from "@/lib/i18n/format";
