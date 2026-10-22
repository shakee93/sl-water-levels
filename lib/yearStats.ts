// Per-year flood summary for the history pages: how many days each year a
// river (or gauge, or the whole country) was affected, split by worst level,
// plus the worst day. Pure, no server-only imports: safe in client bundles.
//
// Each day uses the best source available: measured gauge records where they
// cover the date, the river-flow estimate before that (same rule as
// findEvents in historyStats.ts). A day's level is the worst level of any
// gauge in scope that day, so alert + minor + major = affected days.

import type { HistoryData } from "./history";
import { type Agg, type ScopeStats, addDays, diffDays, score } from "./historyStats";

export type DayLevel = "alert" | "minor" | "major";

export type YearRow = {
  year: number;
  /** True for the current, incomplete year. */
  partial: boolean;
  alert: number;
  minor: number;
  major: number;
  /** alert + minor + major */
  affected: number;
  /** Days in the year with any data. */
  days: number;
  /** How many of those days come from gauge records (the rest are estimates). */
  measuredDays: number;
  /** First measured date in the year, if any. */
  measuredFrom: string | null;
  worst: { date: string; level: DayLevel; gauges: number; measured: boolean } | null;
};

export type YearSummaryStats = {
  rows: YearRow[]; // newest first
  /** Mean affected days per complete year (all years if none is complete). */
  average: number | null;
  averageSince: number | null;
  worstYear: YearRow | null;
};

const levelOf = (a: Agg): DayLevel | null => (a.major ? "major" : a.minor ? "minor" : a.alert ? "alert" : null);

export function yearStats(data: HistoryData, st: ScopeStats): YearSummaryStats {
  const byYear = new Map<number, YearRow>();
  const worstScore = new Map<number, number>(); // severity of each year's current worst day
  const lastYear = Number(st.lastDay.slice(0, 4));

  for (let d = 0; d < st.modelAgg.length; d++) {
    const iso = addDays(data.model.start, d);
    const g = diffDays(iso, data.gauge.start);
    const measured = g >= 0 && (st.gaugeAgg[g]?.reporting ?? 0) > 0;
    const a = measured ? st.gaugeAgg[g] : st.modelAgg[d];
    if (!a || !a.reporting) continue;

    const year = Number(iso.slice(0, 4));
    let row = byYear.get(year);
    if (!row) {
      row = {
        year,
        partial: year === lastYear && !st.lastDay.endsWith("-12-31"),
        alert: 0,
        minor: 0,
        major: 0,
        affected: 0,
        days: 0,
        measuredDays: 0,
        measuredFrom: null,
        worst: null,
      };
      byYear.set(year, row);
    }
    row.days++;
    if (measured) {
      row.measuredDays++;
      row.measuredFrom ??= iso;
    }

    const level = levelOf(a);
    if (!level) continue;
    row[level]++;
    row.affected++;
    const gauges = a[level];
    const s = score(a);
    const w = row.worst;
    // Worst day: highest level first, then most gauges at it, then overall
    // severity; a measured day wins a tie with an estimated one.
    const rank = (lv: DayLevel) => (lv === "major" ? 3 : lv === "minor" ? 2 : 1);
    const better =
      !w ||
      rank(level) > rank(w.level) ||
      (rank(level) === rank(w.level) &&
        (gauges > w.gauges || (gauges === w.gauges && (s > worstScore.get(year)! || (measured && !w.measured)))));
    if (better) {
      row.worst = { date: iso, level, gauges, measured };
      worstScore.set(year, s);
    }
  }

  const rows = [...byYear.values()].sort((a, b) => b.year - a.year);
  const complete = rows.filter((r) => !r.partial);
  const basis = complete.length ? complete : rows;
  const average = basis.length ? basis.reduce((n, r) => n + r.affected, 0) / basis.length : null;
  const worstYear = rows.reduce<YearRow | null>((w, r) => (!w || r.affected > w.affected ? r : w), null);
  return {
    rows,
    average,
    averageSince: basis.length ? Math.min(...basis.map((r) => r.year)) : null,
    worstYear: worstYear && worstYear.affected > 0 ? worstYear : null,
  };
}
