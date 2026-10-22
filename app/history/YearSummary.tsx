// "Year by year" summary for the history pages: affected days per year split
// by worst level, the worst day, and a bar so years compare at a glance.
// No hooks, so it renders as a server or client component. Every visible
// string comes from `labels` (English defaults) so it can be translated.

import type { HistoryData } from "@/lib/history";
import { type Scope, scopeIndices, scopeStats } from "@/lib/historyStats";
import { type DayLevel, type YearRow, yearStats } from "@/lib/yearStats";
import { TIER_HEX } from "../tierUi";

export type YearSummaryLabels = {
  heading: string;
  headline: (p: {
    name: string;
    average: number;
    since: number;
    worstYear: number | null;
    worstDays: number;
    worstPartial: boolean;
  }) => string;
  noWarnings: (name: string) => string;
  year: string;
  affectedDays: string;
  worstDay: string;
  soFar: string;
  measured: string;
  estimated: string;
  measuredFrom: (date: string) => string;
  level: Record<DayLevel, string>;
  /** "28 Nov · major flood at 5 gauges" */
  worstDayText: (p: { date: string; level: string; gauges: number; single: boolean; estimated: boolean }) => string;
  noWorstDay: string;
  /** Screen-reader text for a year's breakdown. */
  breakdown: (p: { alert: number; minor: number; major: number }) => string;
  footnote: string;
  formatDate: (iso: string) => string;
};

export const YEAR_SUMMARY_EN: YearSummaryLabels = {
  heading: "Year by year",
  headline: ({ name, average, since, worstYear, worstDays, worstPartial }) =>
    `${name}: ${Math.round(average)} affected ${Math.round(average) === 1 ? "day" : "days"} a year on average since ${since}` +
    (worstYear ? `; ${worstYear} was the worst with ${worstDays}${worstPartial ? " so far" : ""}.` : "."),
  noWarnings: (name) => `${name}: no flood warnings since 2022.`,
  year: "Year",
  affectedDays: "Affected days",
  worstDay: "Worst day",
  soFar: "so far",
  measured: "Measured",
  estimated: "Estimated",
  measuredFrom: (date) => `Measured from ${date}`,
  level: { alert: "Alert", minor: "Minor flood", major: "Major flood" },
  worstDayText: ({ date, level, gauges, single, estimated }) =>
    `${date} · ${level.toLowerCase()}${single ? "" : ` at ${gauges} ${gauges === 1 ? "gauge" : "gauges"}`}${
      estimated ? " (estimated)" : ""
    }`,
  noWorstDay: "No warnings",
  breakdown: ({ alert, minor, major }) => `${alert} alert, ${minor} minor flood, ${major} major flood days`,
  footnote:
    "A day counts once, at the worst level any gauge reached. Years before the gauge records here start are estimates.",
  // Self-contained English default; pass the locale's formatter in `labels`.
  formatDate: (iso) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
};

function scopeName(data: HistoryData, scope: Scope): string {
  if (scope.kind === "all") return "Sri Lanka";
  if (scope.kind === "basin") return scope.basin;
  const s = data.stations.find((x) => x.station === scope.station);
  return s ? `${s.basin} at ${s.name}` : scope.station;
}

const LEVELS: DayLevel[] = ["major", "minor", "alert"];

export function YearSummary({
  data,
  scope,
  name,
  labels: overrides,
}: {
  data: HistoryData;
  scope: Scope;
  /** Display name for the headline; defaults to "Sri Lanka" / river / "River at Gauge". */
  name?: string;
  labels?: Partial<YearSummaryLabels>;
}) {
  const L = { ...YEAR_SUMMARY_EN, ...overrides };
  const idx = scopeIndices(data, scope);
  if (!idx.length) return null;
  const stats = yearStats(data, scopeStats(data, idx));
  if (!stats.rows.length) return null;

  const title = name ?? scopeName(data, scope);
  const single = idx.length === 1;
  const max = Math.max(1, ...stats.rows.map((r) => r.affected));

  const source = (r: YearRow) =>
    r.measuredDays === 0
      ? { text: L.estimated, measured: false }
      : r.measuredDays >= r.days
        ? { text: L.measured, measured: true }
        : { text: L.measuredFrom(L.formatDate(r.measuredFrom!)), measured: true };

  return (
    <section aria-labelledby="year-summary-h" className="space-y-3">
      <div>
        <h2 id="year-summary-h" className="text-lg font-semibold tracking-tight">
          {L.heading}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {stats.average != null && stats.averageSince != null && stats.worstYear
            ? L.headline({
                name: title,
                average: stats.average,
                since: stats.averageSince,
                worstYear: stats.worstYear.year,
                worstDays: stats.worstYear.affected,
                worstPartial: stats.worstYear.partial,
              })
            : L.noWarnings(title)}
        </p>
      </div>

      <div role="table" aria-label={L.heading} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 divide-y divide-slate-100 dark:divide-slate-800">
        {/* Header: only on wide screens; on phones each row stacks into a card. */}
        <div role="row" className="hidden sm:grid grid-cols-[6.5rem_minmax(0,1fr)_repeat(3,4.5rem)_minmax(0,13rem)] gap-3 px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
          <span role="columnheader">{L.year}</span>
          <span role="columnheader">{L.affectedDays}</span>
          {LEVELS.map((lv) => (
            <span key={lv} role="columnheader" className="text-right">
              {L.level[lv]}
            </span>
          ))}
          <span role="columnheader">{L.worstDay}</span>
        </div>

        {stats.rows.map((r) => {
          const src = source(r);
          return (
            <div
              key={r.year}
              role="row"
              className="grid grid-cols-[9.5rem_1fr] sm:grid-cols-[6.5rem_minmax(0,1fr)_repeat(3,4.5rem)_minmax(0,13rem)] gap-x-3 gap-y-1.5 px-4 py-3 items-center"
            >
              {/* Year + source */}
              <div role="cell" className="flex flex-col">
                <span className="font-semibold tabular-nums">
                  {r.year}
                  {r.partial && <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">({L.soFar})</span>}
                </span>
                <span
                  className={`mt-0.5 w-fit text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${
                    src.measured
                      ? "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {src.text}
                </span>
              </div>

              {/* Affected days: number + stacked bar */}
              <div role="cell" className="flex items-center gap-2 min-w-0">
                <span className="w-8 shrink-0 text-right font-semibold tabular-nums">{r.affected}</span>
                <div
                  className="h-2.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex"
                  role="img"
                  aria-label={L.breakdown(r)}
                >
                  {LEVELS.map((lv) =>
                    r[lv] ? (
                      <div key={lv} style={{ width: `${(r[lv] / max) * 100}%`, background: TIER_HEX[lv] }} />
                    ) : null,
                  )}
                </div>
              </div>

              {/* Per-level counts: own columns on wide screens, one line on phones */}
              {LEVELS.map((lv) => (
                <div key={lv} role="cell" className="hidden sm:block text-right tabular-nums text-sm">
                  {r[lv] || <span className="text-slate-300 dark:text-slate-600">–</span>}
                </div>
              ))}
              <div className="col-span-2 sm:hidden flex flex-wrap gap-x-3 text-xs text-slate-600 dark:text-slate-400">
                {LEVELS.map((lv) => (
                  <span key={lv} className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-sm" style={{ background: TIER_HEX[lv] }} />
                    {L.level[lv]} <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">{r[lv]}</span>
                  </span>
                ))}
              </div>

              {/* Worst day */}
              <div role="cell" className="col-span-2 sm:col-span-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                <span className="sm:hidden">{L.worstDay}: </span>
                {r.worst ? (
                  <span style={{ color: TIER_HEX[r.worst.level] }}>
                    {L.worstDayText({
                      date: L.formatDate(r.worst.date),
                      level: L.level[r.worst.level],
                      gauges: r.worst.gauges,
                      single,
                      estimated: !r.worst.measured,
                    })}
                  </span>
                ) : (
                  L.noWorstDay
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{L.footnote}</p>
    </section>
  );
}
