"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HistoryData } from "@/lib/history";
import { TIER_HEX } from "../tierUi";

// ---- dates (all UTC calendar days; the data is already in Colombo days) ----

const DAY_MS = 86_400_000;
const toMs = (iso: string) => Date.parse(iso + "T00:00:00Z");
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => toIso(toMs(iso) + n * DAY_MS);
const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / DAY_MS);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInYear = (y: number) => (isLeap(y) ? 366 : 365);
const fmtDay = (iso: string) =>
  new Date(toMs(iso)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const fmtShort = (iso: string) =>
  new Date(toMs(iso)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_START_DOY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; // non-leap

// Sri Lanka's four rainfall seasons, as the Dept of Meteorology defines them.
const SEASONS = [
  { label: "NE monsoon", from: 0, to: 59, tint: "bg-sky-500/10" },
  { label: "Inter-monsoon", from: 59, to: 120, tint: "bg-slate-500/5" },
  { label: "SW monsoon", from: 120, to: 273, tint: "bg-indigo-500/10" },
  { label: "Inter-monsoon", from: 273, to: 334, tint: "bg-slate-500/5" },
  { label: "NE", from: 334, to: 365, tint: "bg-sky-500/10" },
];

// ---- aggregation ----

type Agg = { alert: number; minor: number; major: number; reporting: number };
type Tier3 = "alert" | "minor" | "major";
const TIER_BY_CODE: Record<string, Tier3 | undefined> = { "1": "alert", "2": "minor", "3": "major" };
const TIER_LABEL: Record<Tier3, string> = { alert: "Alert", minor: "Minor flood", major: "Major flood" };

function aggregate(codes: string[], idx: number[]): Agg[] {
  const len = codes[0]?.length ?? 0;
  const out: Agg[] = Array.from({ length: len }, () => ({ alert: 0, minor: 0, major: 0, reporting: 0 }));
  for (const i of idx) {
    const c = codes[i];
    for (let d = 0; d < len; d++) {
      const ch = c[d];
      if (ch === "." || ch === undefined) continue;
      const a = out[d];
      a.reporting++;
      if (ch === "1") a.alert++;
      else if (ch === "2") a.minor++;
      else if (ch === "3") a.major++;
    }
  }
  return out;
}

const warned = (a: Agg | undefined) => !!a && a.alert + a.minor + a.major > 0;
const score = (a: Agg | undefined) => (a ? a.alert + 2 * a.minor + 3 * a.major : 0);

type Scope = { kind: "all" } | { kind: "basin"; basin: string } | { kind: "station"; i: number };
const scopeKey = (s: Scope) => (s.kind === "all" ? "all" : s.kind === "basin" ? `b:${s.basin}` : `s:${s.i}`);

// ---- component ----

export function FloodCalendar({ data, initialScope }: { data: HistoryData; initialScope?: string }) {
  const { stations, gauge, model } = data;
  const basins = useMemo(() => [...new Set(stations.map((s) => s.basin))].sort(), [stations]);

  // Shareable scope via ?scope=, parsed on the server so there's no flash.
  const [scope, setScope] = useState<Scope>(() => {
    if (initialScope?.startsWith("b:") && basins.includes(initialScope.slice(2)))
      return { kind: "basin", basin: initialScope.slice(2) };
    const si = stations.findIndex((s) => `s:${s.station}` === initialScope);
    return si >= 0 ? { kind: "station", i: si } : { kind: "all" };
  });
  const [selected, setSelected] = useState<string | null>(null);

  const changeScope = (s: Scope) => {
    setScope(s);
    const url = new URL(window.location.href);
    if (s.kind === "all") url.searchParams.delete("scope");
    else url.searchParams.set("scope", s.kind === "basin" ? `b:${s.basin}` : `s:${stations[s.i].station}`);
    window.history.replaceState(null, "", url);
  };

  const idx = useMemo(() => {
    if (scope.kind === "all") return stations.map((_, i) => i);
    if (scope.kind === "basin") return stations.flatMap((s, i) => (s.basin === scope.basin ? [i] : []));
    return [scope.i];
  }, [scope, stations]);

  const modelAgg = useMemo(() => aggregate(model.codes, idx), [model.codes, idx]);
  const gaugeAgg = useMemo(() => aggregate(gauge.codes, idx), [gauge.codes, idx]);
  const scopeSize = idx.length;

  const lastDay = addDays(model.start, (model.codes[0]?.length ?? 1) - 1);
  const firstYear = Number(model.start.slice(0, 4));
  const lastYear = Number(lastDay.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i);

  const modelAt = (iso: string) => modelAgg[diffDays(iso, model.start)];
  const gaugeAt = (iso: string) => {
    const d = diffDays(iso, gauge.start);
    return d >= 0 ? gaugeAgg[d] : undefined;
  };

  // Best available per day: real gauges where we have them, else the model.
  const events = useMemo(() => {
    type Ev = { from: string; to: string; peak: string; peakScore: number; total: number; source: "gauge" | "model" };
    const out: Ev[] = [];
    let cur: Ev | null = null;
    let gap = 0;
    const minFlooded = Math.max(1, Math.ceil(idx.length * 0.1));
    for (let d = 0; d < modelAgg.length; d++) {
      const iso = addDays(model.start, d);
      const g = diffDays(iso, gauge.start);
      const a = g >= 0 ? gaugeAgg[g] : modelAgg[d];
      const source = g >= 0 ? "gauge" : "model";
      // An "event" day needs flooding at >=10% of the gauges in scope, not
      // just an alert, so routine alerts don't chain a monsoon into one blob.
      const s = a && a.minor + a.major >= minFlooded ? score(a) : 0;
      if (s > 0) {
        if (!cur) cur = { from: iso, to: iso, peak: iso, peakScore: s, total: 0, source };
        cur.to = iso;
        cur.total += s;
        if (s > cur.peakScore) {
          cur.peak = iso;
          cur.peakScore = s;
        }
        if (source === "gauge") cur.source = "gauge";
        gap = 0;
      } else if (cur && ++gap > 1) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push(cur);
    return out.sort((a, b) => b.total - a.total).slice(0, 6);
  }, [modelAgg, gaugeAgg, model.start, gauge.start, idx.length]);

  // Share of days per month with any alert-or-worse in scope.
  const seasonality = useMemo(() => {
    const m = Array.from({ length: 12 }, () => ({ modelDays: 0, modelWarn: 0, gaugeDays: 0, gaugeWarn: 0 }));
    modelAgg.forEach((a, d) => {
      const iso = addDays(model.start, d);
      if (!a.reporting) return;
      const mo = Number(iso.slice(5, 7)) - 1;
      m[mo].modelDays++;
      if (warned(a)) m[mo].modelWarn++;
    });
    gaugeAgg.forEach((a, d) => {
      if (!a.reporting) return;
      const mo = Number(addDays(gauge.start, d).slice(5, 7)) - 1;
      m[mo].gaugeDays++;
      if (warned(a)) m[mo].gaugeWarn++;
    });
    return m;
  }, [modelAgg, gaugeAgg, model.start, gauge.start]);

  const scopeLabel =
    scope.kind === "all"
      ? "anywhere in Sri Lanka"
      : scope.kind === "basin"
        ? `on the ${scope.basin}`
        : `at ${stations[scope.i].name}`;

  return (
    <div className="space-y-8">
      {/* scope picker */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="scope" className="text-sm text-slate-600 dark:text-slate-400">
          Show
        </label>
        <select
          id="scope"
          value={scopeKey(scope)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "all") changeScope({ kind: "all" });
            else if (v.startsWith("b:")) changeScope({ kind: "basin", basin: v.slice(2) });
            else changeScope({ kind: "station", i: Number(v.slice(2)) });
          }}
          data-umami-event="history_scope_change"
          className="min-w-0 max-w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 shadow-sm"
        >
          <option value="all">All of Sri Lanka ({stations.length} gauges)</option>
          <optgroup label="A river basin">
            {basins.map((b) => (
              <option key={b} value={`b:${b}`}>
                {b}
              </option>
            ))}
          </optgroup>
          {basins.map((b) => (
            <optgroup key={b} label={`${b} gauges`}>
              {stations.flatMap((s, i) =>
                s.basin === b ? [<option key={s.station} value={`s:${i}`}>{s.name}</option>] : [],
              )}
            </optgroup>
          ))}
        </select>
        {scope.kind === "station" && (
          <Link href={stations[scope.i].href} className="text-sm text-sky-700 dark:text-sky-400 hover:underline">
            Live readings →
          </Link>
        )}
      </div>

      {/* calendar */}
      <section aria-labelledby="cal-h">
        <h2 id="cal-h" className="sr-only">
          Flood warnings by day, one row per year
        </h2>
        <Legend />
        <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-3 sm:p-4">
          <div className="grid grid-cols-[2.5rem_1fr] sm:grid-cols-[3.25rem_1fr] gap-x-2">
            <div />
            <MonthHeader />
            {years.map((y) => (
              <YearRow
                key={y}
                year={y}
                lastDay={lastDay}
                scopeSize={scopeSize}
                modelAt={modelAt}
                gaugeAt={gaugeAt}
                gaugeStart={gauge.start}
                selected={selected}
                onSelect={setSelected}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Bar height grows with the share of the {scopeSize === 1 ? "gauge" : `${scopeSize} gauges`} in warning that day. Tap
            or hover a day for details. Gauge archive starts 23 Nov 2025; earlier
            years show the modelled estimate only.
          </p>
        </div>
      </section>

      {selected && (
        <DayDetail
          iso={selected}
          data={data}
          idx={idx}
          lastDay={lastDay}
          onStep={(n) => {
            const next = addDays(selected, n);
            if (next >= model.start && next <= lastDay) setSelected(next);
          }}
          onClose={() => setSelected(null)}
        />
      )}

      {/* seasonality */}
      <section aria-labelledby="season-h" className="space-y-3">
        <div>
          <h2 id="season-h" className="text-lg font-semibold tracking-tight">
            When do flood warnings happen?
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Share of days in each month with at least one gauge at alert or worse {scopeLabel}.
          </p>
        </div>
        <Seasonality months={seasonality} />
      </section>

      {/* events */}
      <section aria-labelledby="events-h" className="space-y-3">
        <div>
          <h2 id="events-h" className="text-lg font-semibold tracking-tight">
            Biggest flood events {scope.kind === "all" ? "since 2022" : scopeLabel}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Runs of days with minor or major flooding, ranked by how many gauges flooded and for how long.
          </p>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No minor or major flooding in this period.</p>
        ) : (
          <ol className="grid sm:grid-cols-2 gap-2">
            {events.map((e, n) => {
              const a = e.source === "gauge" ? gaugeAt(e.peak) : modelAt(e.peak);
              return (
                <li key={e.from}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(e.peak);
                      document.getElementById("day-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }}
                    className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-3 py-2.5 hover:border-sky-400 dark:hover:border-sky-600 transition"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">
                        <span className="text-slate-400 mr-1.5">{n + 1}.</span>
                        {e.from === e.to ? fmtShort(e.from) : `${fmtShort(e.from)} – ${fmtShort(e.to)}`}{" "}
                        {e.to.slice(0, 4)}
                      </span>
                      <SourceTag source={e.source} />
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                      Peak {fmtShort(e.peak)}:{" "}
                      {a && a.major > 0 && <span className="text-red-700 dark:text-red-400">{a.major} major </span>}
                      {a && a.minor > 0 && (
                        <span className="text-orange-700 dark:text-orange-400">{a.minor} minor </span>
                      )}
                      {a && a.alert > 0 && <span className="text-amber-700 dark:text-amber-400">{a.alert} alert</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

// ---- pieces ----

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400">
      {(["alert", "minor", "major"] as const).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: TIER_HEX[t] }} />
          {TIER_LABEL[t]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="text-slate-400">▼</span> below the line: measured at the gauge
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-slate-400">▲</span> above: estimated from modelled river flow
      </span>
    </div>
  );
}

const W = 366 * 2; // svg units: 2 per day
const LANE = 22;
const H = LANE * 2 + 4;

function MonthHeader() {
  // HTML, not SVG text, so labels stay readable when the row scales down on phones.
  const pct = (doy: number) => `${(doy / 365) * 100}%`;
  return (
    <div className="relative h-9 text-[10px] sm:text-xs text-slate-500 dark:text-slate-400" aria-hidden>
      {SEASONS.map((s, i) => (
        <div
          key={i}
          className={`absolute top-0 h-3.5 sm:h-4 flex items-center justify-center overflow-hidden whitespace-nowrap rounded-sm ${s.tint}`}
          style={{ left: pct(s.from), width: pct(s.to - s.from) }}
        >
          <span className={s.to - s.from > 100 ? "" : "hidden sm:inline"}>{s.to - s.from > 40 ? s.label : ""}</span>
        </div>
      ))}
      {MONTHS.map((m, i) => (
        <span key={m} className="absolute bottom-0" style={{ left: pct(MONTH_START_DOY[i]) }}>
          <span className="sm:hidden">{m[0]}</span>
          <span className="hidden sm:inline pl-0.5">{m}</span>
        </span>
      ))}
    </div>
  );
}

function YearRow({
  year,
  lastDay,
  scopeSize,
  modelAt,
  gaugeAt,
  gaugeStart,
  selected,
  onSelect,
}: {
  year: number;
  lastDay: string;
  scopeSize: number;
  modelAt: (iso: string) => Agg | undefined;
  gaugeAt: (iso: string) => Agg | undefined;
  gaugeStart: string;
  selected: string | null;
  onSelect: (iso: string | null) => void;
}) {
  const jan1 = `${year}-01-01`;
  const n = daysInYear(year);
  const mid = LANE + 2;

  const bars: React.ReactNode[] = [];
  let modelFloodDays = 0;
  let gaugeFloodDays = 0;
  for (let d = 0; d < n; d++) {
    const iso = addDays(jan1, d);
    if (iso > lastDay) break;
    const x = d * 2;
    for (const [agg, dir] of [
      [modelAt(iso), -1],
      [gaugeAt(iso), 1],
    ] as const) {
      if (!agg || !warned(agg)) continue;
      if (agg.minor + agg.major > 0) {
        if (dir < 0) modelFloodDays++;
        else gaugeFloodDays++;
      }
      // sqrt scale on the total so one or two gauges in warning still show
      // nationally; the stack is then split by tier in proportion.
      const total = agg.alert + agg.minor + agg.major;
      const barH = Math.min(LANE, Math.max(1.5, Math.sqrt(total / scopeSize) * LANE));
      let off = 1;
      for (const t of ["major", "minor", "alert"] as const) {
        const c = agg[t];
        if (!c) continue;
        const h = (c / total) * barH;
        bars.push(
          <rect
            key={`${d}${dir}${t}`}
            x={x}
            width={1.8}
            y={dir < 0 ? mid - off - h : mid + off}
            height={h}
            fill={TIER_HEX[t]}
            opacity={dir < 0 ? 0.55 : 1}
          />,
        );
        off += h;
      }
    }
  }

  const sel = selected?.startsWith(`${year}-`) ? diffDays(selected, jan1) : null;
  const todayDoy = lastDay.startsWith(`${year}-`) ? diffDays(lastDay, jan1) : null;

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = Math.floor(((e.clientX - r.left) / r.width) * (W / 2));
    const iso = addDays(jan1, Math.max(0, Math.min(n - 1, d)));
    if (iso <= lastDay) onSelect(iso);
  };

  return (
    <>
      <div className="flex flex-col justify-center text-right pr-1">
        <span className="text-sm font-semibold tabular-nums">{year}</span>
        <span className="text-[10px] leading-tight text-slate-500 dark:text-slate-400 tabular-nums" title="Days with minor or major flooding">
          {year > Number(gaugeStart.slice(0, 4))
            ? gaugeFloodDays > 0
              ? `${gaugeFloodDays}d`
              : ""
            : modelFloodDays > 0
              ? `~${modelFloodDays}d`
              : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-14 sm:h-16 cursor-crosshair touch-pan-y border-t border-slate-100 dark:border-slate-800"
        role="img"
        aria-label={`${year}: ${gaugeFloodDays || modelFloodDays} days with flooding`}
        onPointerMove={(e) => e.pointerType === "mouse" && pick(e)}
        onPointerDown={pick}
      >
        {MONTH_START_DOY.slice(1).map((m) => (
          <line
            key={m}
            x1={m * 2}
            x2={m * 2}
            y1={0}
            y2={H}
            className="stroke-slate-200 dark:stroke-slate-800"
            strokeWidth={0.6}
          />
        ))}
        <line x1={0} x2={W} y1={mid} y2={mid} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={0.6} />
        {bars}
        {todayDoy != null && (
          <line x1={todayDoy * 2 + 2} x2={todayDoy * 2 + 2} y1={2} y2={H - 2} className="stroke-sky-500" strokeWidth={1} strokeDasharray="2 2" />
        )}
        {sel != null && (
          <rect x={sel * 2 - 1} y={0} width={4} height={H} className="fill-sky-500/15 stroke-sky-500" strokeWidth={0.8} />
        )}
      </svg>
    </>
  );
}

function SourceTag({ source }: { source: "gauge" | "model" }) {
  return source === "gauge" ? (
    <span className="shrink-0 text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300">
      Measured
    </span>
  ) : (
    <span className="shrink-0 text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
      Modelled
    </span>
  );
}

function DayDetail({
  iso,
  data,
  idx,
  lastDay,
  onStep,
  onClose,
}: {
  iso: string;
  data: HistoryData;
  idx: number[];
  lastDay: string;
  onStep: (n: number) => void;
  onClose: () => void;
}) {
  const g = diffDays(iso, data.gauge.start);
  const m = diffDays(iso, data.model.start);
  const rank = (c: string) => (c === "3" ? 3 : c === "2" ? 2 : c === "1" ? 1 : 0);

  const gaugeRows = g >= 0
    ? idx
        .map((i) => ({ i, c: data.gauge.codes[i][g] ?? ".", level: data.gauge.levels[i]?.[g] ?? null }))
        .filter((r) => rank(r.c) > 0)
        .sort((a, b) => rank(b.c) - rank(a.c))
    : null;
  const gaugeReporting = g >= 0 ? idx.filter((i) => (data.gauge.codes[i][g] ?? ".") !== ".").length : 0;
  const modelRows = idx
    .map((i) => ({ i, c: data.model.codes[i][m] ?? "." }))
    .filter((r) => rank(r.c) > 0)
    .sort((a, b) => rank(b.c) - rank(a.c));

  const Row = ({ i, c, level }: { i: number; c: string; level?: number | null }) => {
    const s = data.stations[i];
    const t = TIER_BY_CODE[c]!;
    return (
      <li className="flex items-baseline justify-between gap-3 py-1">
        <Link href={s.href} className="min-w-0 truncate hover:underline">
          {s.name} <span className="text-slate-500 dark:text-slate-400 text-xs">{s.basin}</span>
        </Link>
        <span className="shrink-0 text-xs tabular-nums" style={{ color: TIER_HEX[t] }}>
          {TIER_LABEL[t]}
          {level != null && (
            <span className="text-slate-500 dark:text-slate-400">
              {" "}
              · peak {level}
              {s.unit ? ` ${s.unit}` : ""}
            </span>
          )}
        </span>
      </li>
    );
  };

  return (
    <section
      id="day-detail"
      aria-live="polite"
      className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onStep(-1)}
            className="p-1.5 rounded-md hover:bg-sky-100 dark:hover:bg-sky-900/50"
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </button>
          <h3 className="font-semibold tabular-nums">{fmtDay(iso)}</h3>
          <button
            type="button"
            onClick={() => onStep(1)}
            disabled={iso >= lastDay}
            className="p-1.5 rounded-md hover:bg-sky-100 dark:hover:bg-sky-900/50 disabled:opacity-30"
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">
          Close
        </button>
      </div>

      <div className="mt-3 grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <SourceTag source="gauge" />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {gaugeRows ? `${gaugeReporting} of ${idx.length} gauges reported` : "no gauge archive for this date"}
            </span>
          </div>
          {gaugeRows &&
            (gaugeRows.length ? (
              <ul className="divide-y divide-slate-200/70 dark:divide-slate-800">
                {gaugeRows.map((r) => (
                  <Row key={r.i} {...r} />
                ))}
              </ul>
            ) : (
              <p className="text-slate-600 dark:text-slate-400">No gauge reached its alert level.</p>
            ))}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <SourceTag source="model" />
            <span className="text-xs text-slate-500 dark:text-slate-400">river-flow estimate</span>
          </div>
          {modelRows.length ? (
            <ul className="divide-y divide-slate-200/70 dark:divide-slate-800">
              {modelRows.map((r) => (
                <Row key={r.i} {...r} />
              ))}
            </ul>
          ) : (
            <p className="text-slate-600 dark:text-slate-400">No unusually high flow estimated.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Seasonality({
  months,
}: {
  months: { modelDays: number; modelWarn: number; gaugeDays: number; gaugeWarn: number }[];
}) {
  const pct = (w: number, d: number) => (d ? Math.round((w / d) * 100) : null);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
      <div className="grid grid-cols-12 gap-1 sm:gap-2 items-end h-36">
        {months.map((m, i) => {
          const mp = pct(m.modelWarn, m.modelDays);
          const gp = pct(m.gaugeWarn, m.gaugeDays);
          return (
            <div key={i} className="h-full flex items-end justify-center gap-0.5" title={`${MONTHS[i]}: ${mp ?? "–"}% modelled, ${gp ?? "–"}% measured`}>
              <div className="w-1/2 max-w-3 rounded-t bg-slate-300 dark:bg-slate-600" style={{ height: `${mp ?? 0}%` }} />
              <div className="w-1/2 max-w-3 rounded-t bg-amber-500" style={{ height: `${gp ?? 0}%` }} />
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-12 gap-1 sm:gap-2 mt-1.5 text-center text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
        {MONTHS.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-300 dark:bg-slate-600" /> Modelled, 2022 to now
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-amber-500" /> Measured at gauges, Nov 2025 to now
        </span>
      </div>
    </div>
  );
}
