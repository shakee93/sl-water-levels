import type { Tier } from "@/lib/arcgis";

// Shared tier vocabulary for the home page (list dots, favourites, map).
// Worst first.
export const TIER_ORDER: Tier[] = ["major", "minor", "alert", "watch", "normal", "none", "stale"];
export const tierRank = (t: Tier) => TIER_ORDER.indexOf(t);

export const TIER_TEXT: Record<Tier, string> = {
  major: "Major flood",
  minor: "Minor flood",
  alert: "Alert",
  watch: "Near alert",
  normal: "Normal",
  none: "No flood levels",
  stale: "Not reporting",
};

export const TIER_DOT: Record<Tier, string> = {
  major: "bg-red-500",
  minor: "bg-orange-500",
  alert: "bg-amber-500",
  watch: "bg-yellow-400",
  normal: "bg-slate-400 dark:bg-slate-500",
  none: "bg-slate-300",
  stale: "bg-slate-300",
};

// Map fills. Normal is a quiet blue-grey so only the gauges that matter pop.
export const TIER_HEX: Record<Tier, string> = {
  major: "#dc2626",
  minor: "#ea580c",
  alert: "#f59e0b",
  watch: "#facc15",
  normal: "#64748b",
  none: "#cbd5e1",
  stale: "#cbd5e1",
};

// Text colours with AA contrast on white / slate-900.
export const TIER_TEXT_CLASS: Record<Tier, string> = {
  major: "text-red-700 dark:text-red-400",
  minor: "text-orange-700 dark:text-orange-400",
  alert: "text-amber-700 dark:text-amber-400",
  watch: "text-yellow-700 dark:text-yellow-400",
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
};

// Same threshold as lib/attention RISING_M_PER_H: below this a gauge is "steady".
export const STEADY_M_PER_H = 0.006;

export function formatAge(ts: number, now: number): string {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatAgeShort(ts: number, now: number): string {
  return formatAge(ts, now).replace(" ago", " old");
}

export function colomboTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Colombo",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(ts))
    .replace(" AM", " am")
    .replace(" PM", " pm");
}
