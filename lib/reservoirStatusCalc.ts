// What we DO know about a reservoir whose gate releases nobody publishes live (the CEB and
// Mahaweli hydropower dams): storage, level against full supply, whether it is filling, the
// Mahaweli weekly plan and the spill-possible window. Pure functions only (no fetching, relative
// imports) so scripts/reservoir-status.test.mts can run them. The data wrapper is lib/reservoirStatus.ts.
//
// Accuracy rules: every number keeps its source and day; a reading older than the freshness rule
// is marked stale, not hidden; a blank is unknown (null), never zero; the weekly plan is an
// average of planned turbine release, never called a spill; "near spill level" says storage is
// high and rising, it never says gates are open.

export type Src = "Irrigation Department" | "Mahaweli Authority";

/**
 * Full supply levels (m above sea level) from the Mahaweli WMS operating rules (SOP.pdf, Jun 2026),
 * keyed by catalogue id (lib/reservoirs.ts). Each was checked on 23 Oct 2026 against the live WMS
 * level and storage % (see fslConsistent and scripts/reservoir-status.test.mts). null = left out
 * on purpose.
 *  - castlereagh: the SOP says 1094.2 but the live level (1094.02 m) is 0.2 m under it while WMS
 *    reports only 90% full (and the level fell 0.19 m while storage fell 1 point, which implies
 *    ~2 m for the last 10%). The two do not reconcile, so no "m below full" is shown for it.
 *  - upper-kotmale: a run-of-river pond held at 1194.00 m / 100%; no full supply level in the SOP.
 */
export const FSL_M: Record<string, number | null> = {
  kotmale: 703,
  victoria: 438,
  randenigala: 232,
  rantambe: 152,
  samanalawewa: 460,
  bowatenna: 251.76,
  maussakele: 1167.4,
  castlereagh: null,
  "upper-kotmale": null,
};
export const FSL_SOURCE_URL = "https://mahaweli.gov.lk/WMS%20DATA/SOP.pdf";

/** Metres below full supply, or null when the figure does not reconcile with the storage % (then it is not shown). */
export function fslConsistent(fslM: number | null | undefined, levelMsl: number | null | undefined, pct: number | null | undefined): number | null {
  if (fslM == null || levelMsl == null) return null;
  const below = Math.round((fslM - levelMsl) * 100) / 100;
  if (below < -0.3) return null; // well above full supply: the constant is wrong
  if (pct != null && pct <= 93 && below < 0.5) return null; // "full" by level but not by storage
  if (pct != null && pct >= 98 && below > 1.5) return null; // full by storage but far down by level
  return below;
}

export type Trend = { kind: "filling" | "emptying" | "steady"; since: string; dLevelM: number | null; dPct: number | null };

const DAY_MS = 86_400_000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Day-on-day change between two daily reports (the archive keeps one reading a day). Null when there is no usable earlier day. */
export function trendOf(now: { day: string; levelMsl: number | null; pct: number | null }, prev: { day: string; levelMsl: number | null; pct: number | null } | null): Trend | null {
  if (!prev) return null;
  const gap = dayDiff(prev.day, now.day);
  if (gap < 1 || gap > 4) return null;
  const dLevel = now.levelMsl != null && prev.levelMsl != null ? r2(now.levelMsl - prev.levelMsl) : null;
  const dPct = now.pct != null && prev.pct != null ? now.pct - prev.pct : null;
  if (dLevel == null && dPct == null) return null;
  let kind: Trend["kind"] = "steady";
  if (dLevel != null && Math.abs(dLevel / gap) >= 0.1) kind = dLevel > 0 ? "filling" : "emptying";
  else if (dPct != null && Math.abs(dPct / gap) >= 2) kind = dPct > 0 ? "filling" : "emptying";
  return { kind, since: prev.day, dLevelM: dLevel, dPct };
}

export type Plan = {
  mcmPerDay: number;
  /** The same volume as a mean flow in cusecs, rounded to 10. An average, not a gate flow. */
  avgCusecs: number;
  lastWeekMcm: number | null;
  meetingDate: string | null;
  from: string | null;
  to: string | null;
  /** The plan week is over (greyed). */
  stale: boolean;
};

const CUSECS_PER_MCM_DAY = (1e6 / 86_400) * 35.3147; // 408.7

export type WeeklyIn = {
  plannedMcmPerDay: number | null;
  lastWeekMcm: number | null;
  spillWindow: { from: string; to: string } | null;
} | null;

export function planOf(item: WeeklyIn, meetingDate: string | null, nextWeek: { from: string; to: string } | null, today: string): Plan | null {
  if (!item || item.plannedMcmPerDay == null) return null;
  const to = nextWeek?.to ?? null;
  if (to && dayDiff(to, today) > 7) return null; // old plan: gone
  return {
    mcmPerDay: item.plannedMcmPerDay,
    avgCusecs: Math.round((item.plannedMcmPerDay * CUSECS_PER_MCM_DAY) / 10) * 10,
    lastWeekMcm: item.lastWeekMcm,
    meetingDate,
    from: nextWeek?.from ?? null,
    to,
    stale: !!to && today > to,
  };
}

export type KnownStatus = {
  storage: { pct: number; source: Src; day: string; fresh: boolean } | null;
  levelMsl: number | null;
  /** Verified full supply level and the metres below it (never when it does not reconcile). */
  fsl: { m: number; below: number } | null;
  trend: Trend | null;
  plan: Plan | null;
  /** Measured release, when a source publishes one (shown by the existing status chips). */
  flow: { kind: "spill" | "downstream" | "outlets"; cusecs: number; source: Src; day: string } | null;
  /** Storage high and rising: a hint, never a claim that gates are open. */
  nearSpill: boolean;
  /** A CEB / Mahaweli hydropower dam: the weekly meeting lists it or we hold its full supply level. Its gate releases are not published live. */
  ceb: boolean;
  /** At least one useful fact beyond a blank. */
  known: boolean;
};

export type KnownInput = {
  today: string;
  storage: KnownStatus["storage"];
  wms: { day: string; fresh: boolean; levelMsl: number | null } | null;
  prev: { day: string; levelMsl: number | null; pct: number | null } | null;
  catalogueId: string | null;
  flow: KnownStatus["flow"];
  weekly: { item: WeeklyIn; meetingDate: string | null; nextWeek: { from: string; to: string } | null } | null;
};

export function computeKnown(i: KnownInput): KnownStatus {
  const wmsFresh = !!i.wms?.fresh;
  const pct = i.storage && i.storage.source === "Mahaweli Authority" ? i.storage.pct : null;
  const levelMsl = i.wms?.levelMsl ?? null;
  const fslM = i.catalogueId ? FSL_M[i.catalogueId] ?? null : null;
  // The level is the Mahaweli day's level, so it is only compared with the storage % of that same day.
  const below = wmsFresh ? fslConsistent(fslM, levelMsl, pct) : null;
  const fsl = below != null && fslM != null ? { m: fslM, below } : null;
  const trend = wmsFresh && i.wms ? trendOf({ day: i.wms.day, levelMsl, pct }, i.prev) : null;
  const plan = i.weekly ? planOf(i.weekly.item, i.weekly.meetingDate, i.weekly.nextWeek, i.today) : null;
  const high = !!i.storage?.fresh && (i.storage.pct >= 95 || (fsl != null && fsl.below < 0.5));
  const nearSpill = high && trend?.kind === "filling";
  return {
    storage: i.storage,
    levelMsl,
    fsl,
    trend,
    plan,
    flow: i.flow,
    nearSpill,
    ceb: !!i.weekly?.item || (!!i.catalogueId && i.catalogueId in FSL_M),
    known: !!(i.storage || plan || i.flow),
  };
}
