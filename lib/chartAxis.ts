// Axis maths for the station chart: a y-axis that starts at 0 (or just under the data), has
// "round" ticks, and always carries the flood marks that are worth seeing as tick values.

export type Marks = { alert: number | null; minor: number | null; major: number | null };

const clean = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) && v > 0 ? v : null);
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** 1, 2, 5 x 10^n step that gives roughly `target` ticks over `span`. */
export function niceStep(span: number, target: number): number {
  const raw = Math.max(span, 1e-6) / Math.max(target, 2);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1.4 ? 1 : n <= 3 ? 2 : n <= 7 ? 5 : 10) * mag;
}

export type YScale = {
  domain: [number, number];
  /** Round ticks plus the flood marks that fall inside the domain. */
  ticks: number[];
  /** Which tick values are flood marks. */
  markTicks: Set<number>;
  /** Flood marks inside the domain (those whose band is drawn). */
  marks: { alert: number | null; minor: number | null; major: number | null };
};

export function buildYScale(opts: {
  dataLo: number;
  dataHi: number;
  /** Extra values that must be visible: forecast band, the visitor's own level. */
  extra?: number[];
  marks: Marks;
  targetTicks: number;
}): YScale {
  const { dataLo, dataHi, marks, targetTicks } = opts;
  const extra = (opts.extra ?? []).filter(Number.isFinite);
  let top = Math.max(dataHi, ...extra);
  const bottom = Math.min(dataLo, ...extra);
  // reach is judged from the measured data, so a wide forecast band cannot drag every mark into view
  const span0 = Math.max(dataHi - dataLo, dataHi * 0.1, 0.2);

  // The alert mark is always on the chart. Minor and major only once the river is within reach of
  // them, otherwise they would squash the line flat.
  const alert = clean(marks.alert);
  const minor = clean(marks.minor);
  const major = clean(marks.major);
  const reach = (v: number | null) => v != null && v <= top + 0.7 * span0;
  const shown = {
    alert,
    minor: reach(minor) ? minor : null,
    major: reach(major) ? major : null,
  };
  for (const v of [shown.alert, shown.minor, shown.major]) if (v != null) top = Math.max(top, v);

  const floor = bottom <= 0.45 * top ? 0 : bottom - 0.12 * (top - bottom);
  const span = Math.max(top - floor, 0.5);
  const step = niceStep(span, targetTicks);
  const lo = Math.floor(round(floor / step)) * step;
  const hi = Math.ceil(round((top + 0.025 * span) / step)) * step;

  const markVals = [shown.alert, shown.minor, shown.major].filter((v): v is number => v != null && v >= lo && v <= hi);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) {
    const r = round(v);
    // a round tick that sits right next to a flood mark would only crowd it
    if (markVals.some((m) => Math.abs(m - r) < step * 0.4)) continue;
    ticks.push(r);
  }
  ticks.push(...markVals);
  ticks.sort((a, b) => a - b);
  return { domain: [round(lo), round(hi)], ticks, markTicks: new Set(markVals), marks: shown };
}

/** "3.1", "0.5", "15" - at most two decimals, none trailing. */
export function plain(v: number): string {
  return String(Number(v.toFixed(2)));
}
