"use client";

// Client half of YearSummary: renders precomputed rows, and adds the
// personal "days at or above your level" column, from the `myLevel` prop or
// else localStorage "sl_my_levels" ({ [station]: number }, gauge's own unit).
// Props are plain data (labels are string templates) so a server component
// can render this.

import { useSyncExternalStore } from "react";
import { type DayLevel, type RecordedYear, type YearRow, myLevelStats } from "@/lib/yearStats";
import { TIER_HEX } from "../tierUi";

export const MY_LEVELS_KEY = "sl_my_levels";
/** Dispatch this on window after writing MY_LEVELS_KEY so open pages update in the same tab. */
export const MY_LEVELS_EVENT = "sl_my_levels_change";

/** "{name}"-style templates; every visible string. */
export type YearSummaryLabels = {
  heading: string;
  /** {name} {days} {since} — from gauge records */
  headlineRecorded: string;
  /** {name} {average} {since} — when there are no gauge records (all estimated) */
  headlineAverage: string;
  /** {worstYear} {worstDays} — appended to headlineAverage */
  headlineWorst: string;
  /** appended after {worstDays} when the worst year is the current one */
  headlineWorstSoFar: string;
  /** {name} */
  noWarnings: string;
  /** {from} {firstYear} {lastYear} {days} */
  estimateSentence: string;
  year: string;
  affectedDays: string;
  worstDay: string;
  soFar: string;
  recorded: string;
  estimated: string;
  /** {date} */
  recordedFrom: string;
  level: Record<DayLevel, string>;
  levelInline: Record<DayLevel, string>;
  /** {date} {level} */
  worstDaySingle: string;
  /** {date} {level} {gauges} */
  worstDayMany: string;
  /** {date} {level} — one gauge in a multi-gauge scope */
  worstDayOne: string;
  estimatedSuffix: string;
  noWorstDay: string;
  /** {alert} {minor} {major} */
  breakdown: string;
  footnote: string;
  /** {level} e.g. "4.5 ft" */
  myLevelColumn: string;
  /** {days} {level} {since} */
  myLevelHeadline: string;
  /** shown in the column for years with no gauge records */
  myLevelNoRecords: string;
  /** {since} — explains the "—" */
  myLevelNoRecordsNote: string;
  /** marker for a year only partly recorded */
  myLevelPartial: string;
};

export const YEAR_SUMMARY_EN: YearSummaryLabels = {
  heading: "Year by year",
  headlineRecorded: "{name}: about {days} affected days a year in gauge records since {since}.",
  headlineAverage: "{name}: about {average} affected days a year since {since} (estimated)",
  headlineWorst: "; {worstYear} was the worst with {worstDays}",
  headlineWorstSoFar: " so far",
  noWarnings: "{name}: no flood warnings since 2022.",
  estimateSentence:
    "Before {from} there are no gauge records here; estimates suggest about {days} affected days a year in {firstYear}–{lastYear}.",
  year: "Year",
  affectedDays: "Affected days",
  worstDay: "Worst day",
  soFar: "so far",
  recorded: "Recorded",
  estimated: "Estimated",
  recordedFrom: "Recorded from {date}",
  level: { alert: "Alert", minor: "Minor flood", major: "Major flood" },
  levelInline: { alert: "alert", minor: "minor flood", major: "major flood" },
  worstDaySingle: "{date} · {level}",
  worstDayMany: "{date} · {level} at {gauges} gauges",
  worstDayOne: "{date} · {level} at 1 gauge",
  estimatedSuffix: " (estimated)",
  noWorstDay: "No warnings",
  breakdown: "{alert} alert, {minor} minor flood, {major} major flood days",
  footnote:
    "Affected means at least alert level. A day counts once, at the worst level any gauge reached. Years before the gauge records start are estimates.",
  myLevelColumn: "Days at or above your level ({level})",
  myLevelHeadline: "Your area: about {days} days a year at or above {level} (from gauge records since {since}).",
  myLevelNoRecords: "—",
  myLevelNoRecordsNote:
    "— no gauge records before {since}, so only the official warning levels can be estimated for those years.",
  myLevelPartial: "recorded days only",
};

export const fill = (t: string, v: Record<string, string | number>) =>
  t.replace(/\{(\w+)\}/g, (_, k) => (k in v ? String(v[k]) : `{${k}}`));

const LEVELS: DayLevel[] = ["major", "minor", "alert"];

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(MY_LEVELS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(MY_LEVELS_EVENT, cb);
  };
}
function readStored(): string | null {
  try {
    return window.localStorage.getItem(MY_LEVELS_KEY);
  } catch {
    return null;
  }
}

/** The saved level for `station`, or null. Server render and first paint: null. */
function useStoredLevel(station: string | null): number | null {
  const raw = useSyncExternalStore(subscribe, readStored, () => null);
  if (!station || !raw) return null;
  try {
    const v = (JSON.parse(raw) as Record<string, unknown>)[station];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export type YearSummaryViewProps = {
  name: string;
  single: boolean;
  rows: YearRow[];
  average: number | null;
  averageSince: number | null;
  worstYear: { year: number; affected: number; partial: boolean } | null;
  recorded: { perYear: number; since: string } | null;
  estimate: { recordsFrom: string; firstYear: number; lastYear: number; affectedDaysPerYear: number } | null;
  /** Station scope only: recorded daily maxima, for the personal level. */
  personal: { station: string; unit: string | null; recorded: RecordedYear[]; since: string } | null;
  myLevel?: number | null;
  labels: YearSummaryLabels;
  locale: string;
  /** Deterministic dates (no Intl, so server and browser always agree): month names + "{d} {mon}"-style pattern. */
  dateFormat?: { months: string[]; pattern: string };
};

export function YearSummaryView(p: YearSummaryViewProps) {
  const L = p.labels;
  const stored = useStoredLevel(p.myLevel == null ? (p.personal?.station ?? null) : null);
  const myLevel = p.personal ? (p.myLevel ?? stored) : null;
  const mine = myLevel != null && p.personal ? myLevelStats(p.personal.recorded, myLevel) : null;
  const levelText = myLevel != null ? `${myLevel}${p.personal?.unit ? ` ${p.personal.unit}` : ""}` : "";
  const recordedYears = new Map(p.personal?.recorded.map((y) => [y.year, y]) ?? []);

  const manual = (iso: string) =>
    p.dateFormat!.pattern.replace("{d}", String(Number(iso.slice(8, 10)))).replace("{mon}", p.dateFormat!.months[Number(iso.slice(5, 7)) - 1]);
  const date = (iso: string) =>
    p.dateFormat
      ? manual(iso)
      : new Date(iso + "T00:00:00Z").toLocaleDateString(p.locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const dateY = (iso: string) =>
    p.dateFormat
      ? `${manual(iso)} ${iso.slice(0, 4)}`
      : new Date(iso + "T00:00:00Z").toLocaleDateString(p.locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const max = Math.max(1, ...p.rows.map((r) => r.affected));
  const cols = mine
    ? "sm:grid-cols-[7rem_minmax(0,1fr)_repeat(3,4rem)_6.5rem_minmax(0,12rem)]"
    : "sm:grid-cols-[7rem_minmax(0,1fr)_repeat(3,4.5rem)_minmax(0,13rem)]";

  const source = (r: YearRow) =>
    r.measuredDays === 0
      ? { text: L.estimated, recorded: false }
      : r.measuredDays >= r.days
        ? { text: L.recorded, recorded: true }
        : { text: fill(L.recordedFrom, { date: date(r.measuredFrom!) }), recorded: true };

  const headline = p.recorded
    ? fill(L.headlineRecorded, { name: p.name, days: Math.round(p.recorded.perYear), since: dateY(p.recorded.since) })
    : p.average != null && p.averageSince != null && p.worstYear
      ? fill(L.headlineAverage, { name: p.name, average: Math.round(p.average), since: p.averageSince }) +
        fill(L.headlineWorst, { worstYear: p.worstYear.year, worstDays: p.worstYear.affected }) +
        (p.worstYear.partial ? L.headlineWorstSoFar : "") +
        "."
      : fill(L.noWarnings, { name: p.name });

  return (
    <section aria-labelledby="year-summary-h" className="space-y-3">
      <div className="space-y-1">
        <h2 id="year-summary-h" className="text-lg font-semibold tracking-tight">
          {L.heading}
        </h2>
        {mine && mine.perYearRate != null && (
          <p className="text-sm font-medium text-sky-800 dark:text-sky-300">
            {fill(L.myLevelHeadline, {
              days: Math.round(mine.perYearRate),
              level: levelText,
              since: dateY(p.personal!.since),
            })}
          </p>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-400">{headline}</p>
        {p.estimate && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {fill(L.estimateSentence, {
              from: dateY(p.estimate.recordsFrom),
              days: Math.round(p.estimate.affectedDaysPerYear),
              firstYear: p.estimate.firstYear,
              lastYear: p.estimate.lastYear,
            })}
          </p>
        )}
      </div>

      <div
        role="table"
        aria-label={L.heading}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 divide-y divide-slate-100 dark:divide-slate-800"
      >
        <div role="row" className={`hidden sm:grid ${cols} gap-3 px-4 py-2 text-xs text-slate-500 dark:text-slate-400`}>
          <span role="columnheader">{L.year}</span>
          <span role="columnheader">{L.affectedDays}</span>
          {LEVELS.map((lv) => (
            <span key={lv} role="columnheader" className="text-right">
              {L.level[lv]}
            </span>
          ))}
          {mine && (
            <span role="columnheader" className="text-right text-sky-700 dark:text-sky-400">
              {fill(L.myLevelColumn, { level: levelText })}
            </span>
          )}
          <span role="columnheader">{L.worstDay}</span>
        </div>

        {p.rows.map((r) => {
          const src = source(r);
          const rec = recordedYears.get(r.year);
          const myCount = mine?.perYear.get(r.year);
          const partial = rec != null && rec.levels.length < r.days;
          const myCell =
            myCount == null ? L.myLevelNoRecords : `${myCount}${partial ? "*" : ""}`;
          return (
            <div
              key={r.year}
              role="row"
              className={`grid grid-cols-[9.5rem_1fr] ${cols} gap-x-3 gap-y-1.5 px-4 py-3 items-center`}
            >
              <div role="cell" className="flex flex-col">
                <span className="font-semibold tabular-nums">
                  {r.year}
                  {r.partial && (
                    <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">({L.soFar})</span>
                  )}
                </span>
                <span
                  className={`mt-0.5 w-fit text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${
                    src.recorded
                      ? "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {src.text}
                </span>
              </div>

              <div role="cell" className="flex items-center gap-2 min-w-0">
                <span className="w-8 shrink-0 text-right font-semibold tabular-nums">{r.affected}</span>
                <div
                  className={`h-2.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex ${
                    src.recorded ? "" : "opacity-60"
                  }`}
                  role="img"
                  aria-label={fill(L.breakdown, { alert: r.alert, minor: r.minor, major: r.major })}
                >
                  {LEVELS.map((lv) =>
                    r[lv] ? (
                      <div key={lv} style={{ width: `${(r[lv] / max) * 100}%`, background: TIER_HEX[lv] }} />
                    ) : null,
                  )}
                </div>
              </div>

              {LEVELS.map((lv) => (
                <div key={lv} role="cell" className="hidden sm:block text-right tabular-nums text-sm">
                  {r[lv] || <span className="text-slate-300 dark:text-slate-600">–</span>}
                </div>
              ))}
              {mine && (
                <div
                  role="cell"
                  className="hidden sm:block text-right tabular-nums text-sm font-semibold text-sky-800 dark:text-sky-300"
                >
                  {myCell}
                </div>
              )}
              <div className="col-span-2 sm:hidden flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                {LEVELS.map((lv) => (
                  <span key={lv} className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-sm" style={{ background: TIER_HEX[lv] }} />
                    {L.level[lv]}{" "}
                    <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">{r[lv]}</span>
                  </span>
                ))}
                {mine && (
                  <span className="w-full text-sky-800 dark:text-sky-300">
                    {fill(L.myLevelColumn, { level: levelText })}:{" "}
                    <span className="tabular-nums font-semibold">{myCell}</span>
                  </span>
                )}
              </div>

              <div role="cell" className="col-span-2 sm:col-span-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                <span className="sm:hidden">{L.worstDay}: </span>
                {r.worst ? (
                  <span style={{ color: TIER_HEX[r.worst.level] }}>
                    {fill(p.single ? L.worstDaySingle : r.worst.gauges === 1 ? L.worstDayOne : L.worstDayMany, {
                      date: date(r.worst.date),
                      level: L.levelInline[r.worst.level],
                      gauges: r.worst.gauges,
                    })}
                    {!r.worst.measured && L.estimatedSuffix}
                  </span>
                ) : (
                  L.noWorstDay
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {L.footnote}
        {mine && (
          <>
            {" "}
            {fill(L.myLevelNoRecordsNote, { since: dateY(p.personal!.since) })}
            {p.rows.some((r) => {
              const rec = recordedYears.get(r.year);
              return rec != null && rec.levels.length < r.days;
            }) && ` * ${L.myLevelPartial}.`}
          </>
        )}
      </p>
    </section>
  );
}
