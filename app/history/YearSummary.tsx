// "Year by year" summary for the history pages. Server-safe wrapper: does the
// heavy aggregation and hands plain, serialisable rows to the client view
// (which adds the personal "your level" column from a prop or localStorage).
// All visible strings are templates in `labels` (English defaults in
// YEAR_SUMMARY_EN) so they can be translated.

import type { HistoryData } from "@/lib/history";
import { type Scope, scopeIndices, scopeStats } from "@/lib/historyStats";
import { estimateSummary, recordedLevelsByYear, yearStats } from "@/lib/yearStats";
import { YEAR_SUMMARY_EN, YearSummaryView, type YearSummaryLabels } from "./YearSummaryView";

export { YEAR_SUMMARY_EN, MY_LEVELS_KEY, MY_LEVELS_EVENT, type YearSummaryLabels } from "./YearSummaryView";

function scopeName(data: HistoryData, scope: Scope): string {
  if (scope.kind === "all") return "Sri Lanka";
  if (scope.kind === "basin") return scope.basin;
  const s = data.stations.find((x) => x.station === scope.station);
  return s ? `${s.basin} at ${s.name}` : scope.station;
}

export function YearSummary({
  data,
  scope,
  name,
  myLevel,
  labels,
  locale = "en-GB",
}: {
  data: HistoryData;
  scope: Scope;
  /** Headline subject; defaults to "Sri Lanka" / "<River>" / "<River> at <Gauge>". */
  name?: string;
  /**
   * Station scope only: a personal level in the gauge's own unit. If omitted,
   * the client reads localStorage "sl_my_levels" ({ [station]: number }).
   */
  myLevel?: number | null;
  labels?: Partial<YearSummaryLabels>;
  /** BCP 47 locale for dates, e.g. "en-GB", "si-LK", "ta-LK". */
  locale?: string;
}) {
  const idx = scopeIndices(data, scope);
  if (!idx.length) return null;
  const st = scopeStats(data, idx);
  const stats = yearStats(data, st);
  if (!stats.rows.length) return null;

  const stationIdx = scope.kind === "station" ? idx[0] : -1;
  const recorded = stationIdx >= 0 ? recordedLevelsByYear(data, stationIdx) : [];
  const personal =
    stationIdx >= 0 && recorded.length
      ? {
          station: data.stations[stationIdx].station,
          unit: data.stations[stationIdx].unit,
          recorded,
          since: recorded[0].from,
        }
      : null;

  return (
    <YearSummaryView
      name={name ?? scopeName(data, scope)}
      single={idx.length === 1}
      rows={stats.rows}
      average={stats.average}
      averageSince={stats.averageSince}
      worstYear={
        stats.worstYear
          ? { year: stats.worstYear.year, affected: stats.worstYear.affected, partial: stats.worstYear.partial }
          : null
      }
      recorded={stats.recorded ? { perYear: stats.recorded.perYear, since: stats.recorded.since } : null}
      estimate={estimateSummary(data, st)}
      personal={personal}
      myLevel={myLevel}
      labels={{ ...YEAR_SUMMARY_EN, ...labels }}
      locale={locale}
    />
  );
}
