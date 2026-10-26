// Rain the gauges themselves MEASURED in the last hours, at a gauge and the gauges upstream of it on the same river.
//
// Why: the "heavy rain" storm warning (lib/rainRisk.ts) only looked at FORECAST catchment rain (Open-Meteo). On 26 Oct 2026
// Holombuwa's own rain sensor read 31.9 mm (08:03 to 09:10) and 34.7 mm (09:10 to 10:06) and the river went from 4.4 ft to
// 15.3 ft in 5 hours, past minor flood, while the warning stayed off because the forecast had missed the local cloudburst.
//
// Reading semantics (gauges_2_view `rain_fall`): mm that fell since the PREVIOUS reading of the same gauge. Blank = this gauge
// did not measure, never zero. So a window sum is a proration of each reading over the interval it covers.
//
// Pure and self-contained (type imports only) so scripts and tests can load it with plain node.

export type RainRow = { ts: number; rain_fall: number | null };

const MIN = 60_000;
const HOUR = 3_600_000;

/** Heavy-rain thresholds (mm). See DOCS.md "Measured heavy rain" for the backtest that set them. */
export const MEASURED_1H_MM = 25;
export const MEASURED_3H_MM = 40;
/** A gauge whose newest reading is older than this is not "now": no claim from it. */
export const MEASURED_MAX_AGE_MIN = 120;
/** A reading covering more than this since the previous one is not attributed to any one hour: ignored. */
export const MEASURED_MAX_GAP_MIN = 180;

const okRain = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v >= 0 && v <= 500;

/**
 * mm measured in the `hours` before `end`, summing each reading's rain pro rata over the interval it covers (previous reading
 * to this one). Exact duplicate timestamps count once (the larger value), blanks add nothing, an interval longer than
 * MEASURED_MAX_GAP_MIN is skipped, and the first reading of a series is taken to cover one hour. null = no reading in the window
 * measured rain at all (not "dry").
 */
export function measuredInWindow(rows: RainRow[], end: number, hours: number): number | null {
  const byTs = new Map<number, number | null>();
  for (const r of rows) {
    if (!Number.isFinite(r.ts) || r.ts > end) continue;
    const v = okRain(r.rain_fall) ? r.rain_fall : null;
    const old = byTs.get(r.ts);
    byTs.set(r.ts, old == null ? v : v == null ? old : Math.max(old, v));
  }
  const ts = [...byTs.keys()].sort((a, b) => a - b);
  const from = end - hours * HOUR;
  let sum = 0;
  let saw = false;
  for (let i = 0; i < ts.length; i++) {
    const v = byTs.get(ts[i]);
    if (v == null) continue;
    const start = i > 0 ? ts[i - 1] : ts[i] - HOUR;
    const len = ts[i] - start;
    if (len <= 0 || len > MEASURED_MAX_GAP_MIN * MIN) continue;
    const overlap = Math.min(ts[i], end) - Math.max(start, from);
    if (overlap <= 0) continue;
    sum += (v * overlap) / len;
    saw = true;
  }
  return saw ? sum : null;
}

export type GaugeRain = { station: string; mm1h: number | null; mm3h: number | null; endTs: number };

/** Rain measured at one gauge, windows ending at its newest reading; null when that reading is missing or older than MEASURED_MAX_AGE_MIN. */
export function gaugeRainNow(station: string, rows: RainRow[], now: number): GaugeRain | null {
  let end = -Infinity;
  for (const r of rows) if (okRain(r.rain_fall) && r.ts <= now + 5 * MIN && r.ts > end) end = r.ts;
  if (!Number.isFinite(end) || now - end > MEASURED_MAX_AGE_MIN * MIN) return null;
  return { station, mm1h: measuredInWindow(rows, end, 1), mm3h: measuredInWindow(rows, end, 3), endTs: end };
}

export type MeasuredRain = {
  /** The gauge with the heaviest measured rain that tripped the threshold. */
  gauge: string;
  /** True when that gauge is not the one being asked about, but upstream of it. */
  upstream: boolean;
  /** The window the sentence quotes: 1 (the 1 h total tripped on its own) or 3. */
  hours: 1 | 3;
  /** mm in that window, rounded to a whole number. */
  mm: number;
  mm1h: number | null;
  mm3h: number | null;
  /** True when the gauge that tripped had its own per-gauge threshold (lib/rainWords.ts), so "heavy for this river" is honest. */
  local?: boolean;
};

/** Thresholds for one gauge: the national ones unless the caller knows better (lib/rainTriggers.ts). */
export type TriggerLookup = (station: string) => { mm1h: number; mm3h: number; local: boolean };

/** Does one gauge's measured rain trip the warning? Returns the window to quote, or null. */
export function tripped(g: GaugeRain, t?: { mm1h: number; mm3h: number }): { hours: 1 | 3; mm: number } | null {
  const a = g.mm1h ?? 0;
  const b = g.mm3h ?? 0;
  const by3 = b >= (t?.mm3h ?? MEASURED_3H_MM);
  const by1 = a >= (t?.mm1h ?? MEASURED_1H_MM);
  if (!by3 && !by1) return null;
  // quote the 3 h total when it tripped (it is always at least the 1 h one); else the 1 h burst
  return by3 ? { hours: 3, mm: Math.round(b) } : { hours: 1, mm: Math.round(a) };
}

/**
 * The measured heavy-rain trigger for `station`: its own gauge and every gauge upstream of it on the same river (`gauges`,
 * already restricted to that). Needs at least one gauge with data; returns null when none tripped. Ties go to the larger
 * 3 h total, own gauge first.
 */
export function measuredRainFor(station: string, gauges: GaugeRain[], triggers?: TriggerLookup): MeasuredRain | null {
  let best: { g: GaugeRain; t: { hours: 1 | 3; mm: number } } | null = null;
  for (const g of gauges) {
    const t = tripped(g, triggers?.(g.station));
    if (!t) continue;
    const score = (g.mm3h ?? 0) + (g.station === station ? 0.001 : 0);
    if (!best || score > (best.g.mm3h ?? 0) + (best.g.station === station ? 0.001 : 0)) best = { g, t };
  }
  if (!best) return null;
  return { gauge: best.g.station, upstream: best.g.station !== station, hours: best.t.hours, mm: best.t.mm, mm1h: best.g.mm1h, mm3h: best.g.mm3h, ...(triggers?.(best.g.station).local ? { local: true } : {}) };
}
