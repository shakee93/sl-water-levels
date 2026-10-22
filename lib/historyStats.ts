// Pure flood-history statistics shared by the /history pages (client calendar)
// and the server-rendered summary cards on river and station pages, so both
// always tell the same story. No server-only imports: safe in client bundles.

import type { HistoryData } from "./history";

// ---- dates (UTC calendar days; history data is already in Colombo days) ----

const DAY_MS = 86_400_000;
export const toMs = (iso: string) => Date.parse(iso + "T00:00:00Z");
export const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => toIso(toMs(iso) + n * DAY_MS);
export const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / DAY_MS);
export const fmtShort = (iso: string) =>
  new Date(toMs(iso)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "21 Oct – 18 Nov 2023", "28 Nov 2025", "28 Dec 2024 – 3 Jan 2025". */
export function fmtRange(from: string, to: string): string {
  if (from === to) return `${fmtShort(from)} ${from.slice(0, 4)}`;
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${fmtShort(from)} ${from.slice(0, 4)} – ${fmtShort(to)} ${to.slice(0, 4)}`;
  return `${fmtShort(from)} – ${fmtShort(to)} ${to.slice(0, 4)}`;
}

// ---- aggregation ----

export type Agg = { alert: number; minor: number; major: number; reporting: number };

/** Per-day counts of gauges (from `idx`) at each tier. */
export function aggregate(codes: string[], idx: number[]): Agg[] {
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

export const warned = (a: Agg | undefined) => !!a && a.alert + a.minor + a.major > 0;
export const score = (a: Agg | undefined) => (a ? a.alert + 2 * a.minor + 3 * a.major : 0);

export type Scope = { kind: "all" } | { kind: "basin"; basin: string } | { kind: "station"; station: string };

export function scopeIndices(data: HistoryData, scope: Scope): number[] {
  return data.stations.flatMap((s, i) =>
    scope.kind === "all" || (scope.kind === "basin" ? s.basin === scope.basin : s.station === scope.station) ? [i] : [],
  );
}

export type ScopeStats = {
  idx: number[];
  modelAgg: Agg[];
  gaugeAgg: Agg[];
  lastDay: string;
};

export function scopeStats(data: HistoryData, idx: number[]): ScopeStats {
  return {
    idx,
    modelAgg: aggregate(data.model.codes, idx),
    gaugeAgg: aggregate(data.gauge.codes, idx),
    lastDay: addDays(data.model.start, (data.model.codes[0]?.length ?? 1) - 1),
  };
}

// ---- events ----

export type FloodEvent = {
  from: string;
  to: string;
  peak: string;
  peakScore: number;
  total: number;
  source: "gauge" | "model";
  /** Gauge counts on the peak day. */
  peakAgg: Agg;
};

/**
 * Runs of flood days, using real gauges where the archive covers the date and
 * the model before that. A day counts when >=10% of the gauges in scope are at
 * minor or major flood (alerts alone don't count, so a routine monsoon doesn't
 * chain into one blob); runs may bridge a single quiet day.
 */
export function findEvents(data: HistoryData, st: ScopeStats): FloodEvent[] {
  const out: FloodEvent[] = [];
  let cur: FloodEvent | null = null;
  let gap = 0;
  const minFlooded = Math.max(1, Math.ceil(st.idx.length * 0.1));
  for (let d = 0; d < st.modelAgg.length; d++) {
    const iso = addDays(data.model.start, d);
    const g = diffDays(iso, data.gauge.start);
    const a = g >= 0 ? st.gaugeAgg[g] : st.modelAgg[d];
    const source = g >= 0 ? "gauge" : "model";
    const s = a && a.minor + a.major >= minFlooded ? score(a) : 0;
    if (s > 0) {
      if (!cur) cur = { from: iso, to: iso, peak: iso, peakScore: s, total: 0, source, peakAgg: a };
      cur.to = iso;
      cur.total += s;
      if (s > cur.peakScore) {
        cur.peak = iso;
        cur.peakScore = s;
        cur.peakAgg = a;
      }
      if (source === "gauge") cur.source = "gauge";
      gap = 0;
    } else if (cur && ++gap > 1) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Worst peak day first (what people remember as "the big flood"), then duration. */
export const biggestEvents = (events: FloodEvent[], n: number) =>
  [...events]
    .sort(
      (a, b) =>
        b.peakScore - a.peakScore ||
        // On a tie, a measured flood beats a modelled one: it's what people saw.
        (a.source === b.source ? 0 : a.source === "gauge" ? -1 : 1) ||
        b.total - a.total,
    )
    .slice(0, n);
export const latestEvents = (events: FloodEvent[], n: number) =>
  [...events].sort((a, b) => (a.from < b.from ? 1 : -1)).slice(0, n);

// ---- seasonality ----

export type MonthStat = { modelDays: number; modelWarn: number; gaugeDays: number; gaugeWarn: number };

/** Per calendar month: days with data, and days with any gauge at alert or worse. */
export function seasonality(data: HistoryData, st: ScopeStats): MonthStat[] {
  const m: MonthStat[] = Array.from({ length: 12 }, () => ({ modelDays: 0, modelWarn: 0, gaugeDays: 0, gaugeWarn: 0 }));
  st.modelAgg.forEach((a, d) => {
    if (!a.reporting) return;
    const mo = Number(addDays(data.model.start, d).slice(5, 7)) - 1;
    m[mo].modelDays++;
    if (warned(a)) m[mo].modelWarn++;
  });
  st.gaugeAgg.forEach((a, d) => {
    if (!a.reporting) return;
    const mo = Number(addDays(data.gauge.start, d).slice(5, 7)) - 1;
    m[mo].gaugeDays++;
    if (warned(a)) m[mo].gaugeWarn++;
  });
  return m;
}

/**
 * One risk number per month (0..1) blending both sources day-for-day: the
 * model gives the multi-year shape, the gauges keep it honest.
 */
export const monthRisk = (m: MonthStat[]) =>
  m.map((x) => (x.modelDays + x.gaugeDays ? (x.modelWarn + x.gaugeWarn) / (x.modelDays + x.gaugeDays) : 0));

/** Months (0-11) of the main and secondary flood season, as contiguous circular runs. */
export function floodSeasons(risk: number[]): { main: number[]; second: number[] | null } {
  const max = Math.max(...risk);
  if (max <= 0) return { main: [], second: null };
  const grow = (seed: number, frac: number, taken: Set<number>) => {
    const run = [seed];
    taken.add(seed);
    for (const dir of [-1, 1]) {
      let m = seed;
      for (;;) {
        m = (m + dir + 12) % 12;
        if (taken.has(m) || risk[m] < max * frac) break;
        taken.add(m);
        if (dir < 0) run.unshift(m);
        else run.push(m);
      }
    }
    return run;
  };
  const taken = new Set<number>();
  const main = grow(risk.indexOf(max), 0.55, taken);
  // A second season must stand apart from the main one (not just its tail).
  const blocked = new Set([...taken, ...main.map((m) => (m + 1) % 12), ...main.map((m) => (m + 11) % 12)]);
  let best = -1;
  risk.forEach((r, m) => {
    if (!blocked.has(m) && r >= max * 0.35 && (best < 0 || r > risk[best])) best = m;
  });
  const second = best >= 0 ? grow(best, 0.7, blocked) : null;
  return { main, second };
}

const monthSpan = (run: number[]) =>
  run.length === 1
    ? `in ${MONTHS_LONG[run[0]]}`
    : `between ${MONTHS_LONG[run[0]]} and ${MONTHS_LONG[run[run.length - 1]]}`;

/** "mostly between October and December, with a smaller peak in May" */
export function seasonPhrase(risk: number[]): string | null {
  const { main, second } = floodSeasons(risk);
  if (!main.length) return null;
  return `mostly ${monthSpan(main)}${second ? `, with a smaller peak ${monthSpan(second)}` : ""}`;
}

/** Days with minor/major flooding per source, for headline counts. */
export function floodDayCounts(st: ScopeStats) {
  const flooded = (a: Agg) => a.minor + a.major > 0;
  return {
    gaugeDays: st.gaugeAgg.filter((a) => a.reporting).length,
    gaugeFloodDays: st.gaugeAgg.filter(flooded).length,
    gaugeAlertDays: st.gaugeAgg.filter(warned).length,
  };
}

// ---- plain-language summary (server cards + /history page intros) ----

export type FloodSummary = {
  scopeSize: number;
  risk: number[];
  main: number[];
  second: number[] | null;
  /** "mostly between October and December, with a smaller peak in May" */
  season: string | null;
  /** Where the current Colombo month falls. */
  /** "elevated": outside the named seasons but still >=30% of the peak month's risk. */
  now: { month: number; phase: "main" | "second" | "elevated" | "quiet"; peakMonth: number };
  gaugeSince: string;
  gaugeFloodDays: number;
  gaugeAlertDays: number;
  latest: FloodEvent | null;
  biggest: FloodEvent | null;
  events: FloodEvent[];
};

export function summarize(data: HistoryData, idx: number[], nowMs = Date.now()): FloodSummary {
  const st = scopeStats(data, idx);
  const risk = monthRisk(seasonality(data, st));
  const { main, second } = floodSeasons(risk);
  const events = findEvents(data, st);
  const month = Number(toIso(nowMs + 5.5 * 3_600_000).slice(5, 7)) - 1;
  const counts = floodDayCounts(st);
  return {
    scopeSize: idx.length,
    risk,
    main,
    second,
    season: seasonPhrase(risk),
    now: {
      month,
      phase: main.includes(month)
        ? "main"
        : second?.includes(month)
          ? "second"
          : risk[month] >= Math.max(...risk) * 0.3 && risk[month] > 0
            ? "elevated"
            : "quiet",
      peakMonth: risk.indexOf(Math.max(...risk)),
    },
    gaugeSince: data.gauge.start,
    gaugeFloodDays: counts.gaugeFloodDays,
    gaugeAlertDays: counts.gaugeAlertDays,
    latest: latestEvents(events, 1)[0] ?? null,
    biggest: biggestEvents(events, 1)[0] ?? null,
    events,
  };
}

/** "5 gauges at major flood, 2 at minor" / "major flood" for a single gauge. */
export function peakPhrase(a: Agg, scopeSize: number): string {
  if (scopeSize === 1) return a.major ? "major flood" : a.minor ? "minor flood" : "alert";
  const parts: string[] = [];
  if (a.major) parts.push(`${a.major} ${a.major === 1 ? "gauge" : "gauges"} at major flood`);
  if (a.minor) parts.push(`${a.minor} at minor flood`);
  if (!parts.length && a.alert) parts.push(`${a.alert} at alert`);
  return parts.join(", ");
}

/** Gauges in scope at minor/major (else alert) on an event's peak day, worst first. */
export function peakGauges(data: HistoryData, idx: number[], e: FloodEvent): { name: string; tier: "alert" | "minor" | "major" }[] {
  const src = e.source === "gauge" ? data.gauge : data.model;
  const d = diffDays(e.peak, src.start);
  const tierOf = { "1": "alert", "2": "minor", "3": "major" } as const;
  const rows = idx
    .map((i) => ({ name: data.stations[i].name, c: src.codes[i]?.[d] ?? "." }))
    .filter((r) => r.c === "1" || r.c === "2" || r.c === "3")
    .sort((a, b) => b.c.localeCompare(a.c));
  const flooded = rows.filter((r) => r.c !== "1");
  return (flooded.length ? flooded : rows).map((r) => ({ name: r.name, tier: tierOf[r.c as "1" | "2" | "3"] }));
}

/** "Hanwella, Glencourse +3 (major flood)" */
export function peakGaugesPhrase(g: { name: string; tier: string }[], max = 2): string {
  if (!g.length) return "";
  const worst = g[0].tier === "major" ? "major flood" : g[0].tier === "minor" ? "minor flood" : "alert";
  const names = g.slice(0, max).map((x) => x.name).join(", ");
  return `${names}${g.length > max ? ` +${g.length - max}` : ""} (${worst})`;
}
