// Pure helpers for the "Rain in <town>" chart (app/flood/TownRain.tsx): rain intensity words, the y-axis scale, Sri Lanka
// clock hours, and the plain-language lead line. No fetching, no strings: the component turns keys into words.

/** Standard hourly rain rates (WMO / AMS): light < 2.5 mm/h, moderate 2.5-7.6, heavy 7.6-50, violent > 50. */
export const LIGHT_MAX_MM_H = 2.5;
export const MODERATE_MAX_MM_H = 7.6;
export const HEAVY_MAX_MM_H = 50;

export type RainClass = "light" | "moderate" | "heavy" | "violent";

/** Intensity of one hour's rain; null when it is too little to count (under 0.1 mm). */
export function rainClass(mmPerHour: number): RainClass | null {
  if (!(mmPerHour >= 0.1)) return null;
  if (mmPerHour < LIGHT_MAX_MM_H) return "light";
  if (mmPerHour < MODERATE_MAX_MM_H) return "moderate";
  if (mmPerHour <= HEAVY_MAX_MM_H) return "heavy";
  return "violent";
}

/** Gridline values for the y-axis: a round step so there are 2-4 lines, and the top of the scale (at least 2.5 mm so a drizzle does not look like a storm). */
export function yScale(peakMm: number): { max: number; ticks: number[] } {
  const peak = Math.max(peakMm, 2.5);
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find((s) => peak / s <= 4) ?? 100;
  const max = Math.ceil(peak / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max, ticks };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Sri Lanka is UTC+5:30 all year. */
const OFFSET = 5.5 * HOUR;

/** Local (Sri Lanka) clock hour 0-23 at an instant, and its day number. */
export function localHour(ms: number): { hour: number; day: number } {
  const l = ms + OFFSET;
  return { hour: Math.floor((l % DAY) / HOUR), day: Math.floor(l / DAY) };
}

/** 12-hour clock: 0 -> 12 am, 13 -> 1 pm. */
export function h12(hour: number): { h: number; pm: boolean } {
  return { h: hour % 12 === 0 ? 12 : hour % 12, pm: hour >= 12 };
}

export type WhenKey = "early" | "late" | "morn0" | "morn1" | "aft0" | "aft1" | "eve0" | "eve1" | "night0" | "night1";

/** "this evening" / "tomorrow morning" for an hour that starts at startMs, seen from nowMs. */
export function whenKey(startMs: number, nowMs: number): WhenKey {
  const { hour, day } = localHour(startMs);
  const d = day === localHour(nowMs).day ? 0 : 1;
  if (hour < 5) return d === 0 ? "early" : "late";
  if (hour < 12) return `morn${d}` as WhenKey;
  if (hour < 17) return `aft${d}` as WhenKey;
  if (hour < 21) return `eve${d}` as WhenKey;
  return `night${d}` as WhenKey;
}

export type RainBar = { /** end of the hour, ms */ end: number; /** mm, null = no data */ mm: number | null };

export type LeadLine = {
  past: { key: "rain.lead.pastNA" | "rain.lead.pastNone" | "rain.lead.past"; cls?: RainClass; mm?: number };
  next: { key: "rain.lead.nextNone" | "rain.lead.next"; cls?: RainClass; mm?: number; when?: WhenKey };
};

/** Totals under this are "no rain" in words (a trace the gauges would not catch). */
const DRY_MM = 1;

/**
 * Plain-words summary: how much has fallen, how much is coming and when. The intensity word is the heaviest HOUR in the
 * window (so a short downpour is not called "light" because it was spread over a dry day).
 * @param pastMm24 total for the past 24 h (null = not known); the bars give the heaviest hour.
 */
export function leadLine(past: RainBar[], pastMm24: number | null, next: RainBar[], nowMs: number): LeadLine {
  const peakOf = (bars: RainBar[]) => bars.reduce<RainBar | null>((b, x) => (x.mm != null && (b == null || x.mm > (b.mm ?? 0)) ? x : b), null);
  let pastPart: LeadLine["past"];
  const pp = peakOf(past);
  if (pastMm24 == null) pastPart = { key: "rain.lead.pastNA" };
  else if (pastMm24 < DRY_MM) pastPart = { key: "rain.lead.pastNone" };
  else pastPart = { key: "rain.lead.past", cls: rainClass(pp?.mm ?? 0) ?? "light", mm: Math.round(pastMm24) };

  const total = next.reduce((s, x) => s + (x.mm ?? 0), 0);
  const np = peakOf(next);
  let nextPart: LeadLine["next"];
  if (total < DRY_MM || !np) nextPart = { key: "rain.lead.nextNone" };
  else nextPart = { key: "rain.lead.next", cls: rainClass(np.mm ?? 0) ?? "light", mm: Math.max(1, Math.round(total)), when: whenKey(np.end - HOUR, nowMs) };
  return { past: pastPart, next: nextPart };
}
