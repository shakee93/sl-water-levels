// The official step as a small coloured pill (Normal / Alert / Minor flood / Major flood). Near alert reads Normal.
export type PillTier = "normal" | "alert" | "minor" | "major" | "none" | "stale";
export const PILL: Record<PillTier, { dot: string; box: string }> = {
  normal: { dot: "bg-emerald-500", box: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
  alert: { dot: "bg-amber-500", box: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  minor: { dot: "bg-orange-500", box: "bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300" },
  major: { dot: "bg-red-500", box: "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300" },
  none: { dot: "bg-slate-400", box: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  stale: { dot: "bg-slate-400", box: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

export function TierPill({ label, tier }: { label: string; tier: PillTier }) {
  const pd = PILL[tier];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${pd.box}`}>
      <span className={`size-2 rounded-full ${pd.dot}`} aria-hidden />
      {label}
    </span>
  );
}
