// What the embed widgets draw. Built on the server (lib/embedData.ts) with every string already in the widget's language, so the
// browser needs no dictionaries: the page renders it, and the 5-minute refresh just swaps in a new one from /api/embed.
import type { PillTier } from "@/app/TierPill";
import type { EmbedCfg, Widget } from "./embedConfig";

export type Arrow = "up" | "down" | "steady" | null;
export type MarkInfo = { key: "alert" | "minor" | "major"; label: string; value: string; pct: number };

export type EmbedRow = {
  key: string;
  name: string;
  river: string | null;
  href: string;
  tier: PillTier;
  step: string;
  level: string | null;
  arrow: Arrow;
  trend: string | null;
  /** "7:00 pm" in Sri Lanka time, with the day when it is not today. */
  time: string | null;
  age: string | null;
  next: string | null;
  nextArrow: Arrow;
  cross: string | null;
  /** "Alert 5.2 m · Minor flood 7.5 m · Major flood 9.5 m" */
  marks: string | null;
  /** "3.2 ft below the alert level" */
  outcome: string | null;
  stale: boolean;
  /** Reading comes from RiverNet (DMC / Leecom SCADA), not the Irrigation Department feed. */
  rivernet: boolean;
  /** A tributary of the river (RiverNet): listed apart from the main stem. */
  tributary: boolean;
  /** "Not reporting since 26 Oct, 4:25 pm" for a gauge with no recent reading and a known last reading; shown once, in place of the time and the pill. */
  since: string | null;
};

/** What the gauge page's own chart (app/LevelChart.tsx) needs, in the shown unit. Readings cover 72 h when the gauge allows it; the widget draws the last 24 or 72. */
export type LChart = {
  readings: [number, number][];
  /** From "now": the forecast line and its 80% band. Empty when the widget shows no forecast. */
  forecast: { ts: number; level: number; low: number | null; high: number | null }[];
  marks: { alert: number | null; minor: number | null; major: number | null };
  unit: "ft" | "m" | "";
  /** Hours drawn first (24 or 72). */
  hours: 24 | 72;
  /** True when 72 h of readings are present, so the 24 h / 72 h buttons make sense. */
  has72: boolean;
  titles: { 24: string; 72: string };
  /** The few site dictionary entries the chart reads (chart.*, range.*, date.*, tier.*), already in the widget's language. */
  dict: Record<string, string>;
};

export type Credit = { live: string; linkText: string; href: string; /** " · RiverNet data", linking to rivernet.lk, when a shown gauge is a RiverNet gauge. */ extra?: { text: string; href: string } };

type Base = {
  widget: Widget;
  cfg: EmbedCfg;
  generatedAt: number;
  credit: Credit;
  /** The matching page on waterlevels.lk, and the words for the link. */
  open: { href: string; label: string };
  /** Shown when the sources could not be read. */
  unavailable?: string;
};

export type RiverPayload = Base & { kind: "river"; title: string; summary: string; rows: EmbedRow[]; upstream: string; downstream: string; /** Heading over the tributary rows. */ tributaries: string };
export type GaugePayload = Base & {
  kind: "gauge";
  title: string;
  river: string;
  row: EmbedRow;
  bar: { tier: PillTier; now: number; ahead: number | null; marks: MarkInfo[] } | null;
  chart: LChart | null;
};
/** The simple card: one gauge, verdict first. Same data as the gauge widget. */
export type CardPayload = Omit<GaugePayload, "kind"> & { kind: "card" };
export type TownPayload = Base & {
  kind: "town";
  title: string;
  tier: PillTier;
  step: string;
  level: string | null;
  gaugeLine: string | null;
  hourLabel: string;
  hour: string | null;
  hourArrow: Arrow;
  dayLabel: string;
  day: string | null;
  action: string | null;
  note: string;
  time: string | null;
  marks: string | null;
};
export type ForecastPayload = Base & {
  kind: "forecast";
  title: string;
  river: string;
  row: EmbedRow;
  verdict: string;
  tone: PillTier;
  hour: { label: string; title: string; sub: string | null; arrow: Arrow } | null;
  day: { label: string; text: string; ok: boolean } | null;
  action: string | null;
  note: string | null;
  chart: LChart | null;
  /** "Forecast, not an official warning" label, or "No forecast for this gauge". */
  forecastLabel: string;
  noForecast: boolean;
};
export type NowGroup = { river: string; href: string; rows: EmbedRow[] };
export type NowPayload = Base & { kind: "now"; title: string; calm: boolean; summary: string; groups: NowGroup[]; checked: string };
export type ResRow = { key: string; name: string; river: string | null; href: string; status: string; official: boolean; figure: string | null; source: string; when: string | null; reported: string | null; reportedUrl: string | null };
export type ReservoirsPayload = Base & { kind: "reservoirs"; title: string; summary: string; items: ResRow[]; officialNote: string;
  /** Official spilling / releasing reservoirs beyond the rows shown (the summary counts all of them). */
  more: number };
export type TickerPayload = Base & { kind: "ticker"; segments: string[]; tier: PillTier; href: string; label: string };

export type EmbedPayload = RiverPayload | CardPayload | GaugePayload | ForecastPayload | TownPayload | NowPayload | ReservoirsPayload | TickerPayload;
