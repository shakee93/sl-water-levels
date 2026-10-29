// Live sensor-glitch filter for FORECAST INPUTS ONLY (owner request, 29 Oct 2026, from scoring the forecasts of 28 Oct).
// Pure and dependency-free (lib/forecast.ts and the node tests import this one file).
//
// What it touches: the gauge series the forecast models read (own gauge and upstream gauges, `trend24h`). It never touches the level
// shown, the official step, verdicts, the sticky bar or push: official steps alone drive those, and readings are shown as reported.
//
// Evidence, 28 Oct 2026 (research/forecast-audit-*): Ellagawa read 21.78 ft for ONE hour between readings of about 34.3 ft (a fake 12.5 ft
// dip); one-reading spikes at Hanwella (18.86 ft between about 15.7), Wellawaya (0 between about 4.17) and Katharagama; a two-reading
// spike at Pitabeddara (2.95 between about 9.7); stuck sensors: Ampara 35 h, Mapitigama 29 h, Baddegama 13 h at 13.88 ft, Mullamunai Bridge.
// A forecast made from those is wrong, and a glitch inside the last 24 h also distorts the rates and lagged inputs the models use.

export const FT_PER_M = 1 / 0.3048;
const HOUR_MS = 3_600_000;

/**
 * A reading (or two in a row) this far from BOTH neighbours is a spike. 2 ft: the glitches above were 3.5 to 12.5 ft; real gauges here
 * move well under 2 ft in an hour except in a flash flood, and a flash rise does not come back down within 1-2 readings.
 */
export const SPIKE_FT = 2;
/** The two neighbours of a spike must agree with each other within this (1 ft): the river was at one level before and after. */
export const SPIKE_AGREE_FT = 1;
/** Hours per step allowed between the neighbours (~1.6 h; gauges report hourly with jitter). A spike across a gap is not judged. */
export const SPIKE_STEP_H = 1.6;
/** Longest run of consecutive readings called a spike (Pitabeddara: 2). */
export const SPIKE_MAX_RUN = 2;
/**
 * The same value repeated for this long (and see STUCK_MOVING_FT / STUCK_LONG_H below) is a stuck sensor (Ampara 35 h, Mapitigama 29 h, Baddegama 13 h at 13.88 ft). A river does not hold
 * a level to the last digit for 12 h. The first reading of the run is kept, the repeats are dropped.
 */
export const STUCK_H = 12;
/**
 * A run of repeats is only called stuck if the gauge was MOVING just before it: the range over the STUCK_BEFORE_H hours before the run is
 * at least STUCK_MOVING_FT (0.3 ft). Evidence: Baddegama on 28 Oct was moving at Minor, then froze at 13.88 ft for 13 h. Calm low-flow rivers
 * (Padiyathalawa 23 h, Siyambalanduwa, Thalgahagoda, Yaka Wewa, Katharagama flats) repeat a value because the water really is still at the
 * sensor's resolution; nulling them would starve the forecast of history.
 */
export const STUCK_BEFORE_H = 12;
export const STUCK_MOVING_FT = 0.15;
/** ...or the run is so long that no river holds a level that long whatever it did before (Ampara 179 h; Mapitigama froze at 4.22 m for 29.8 h). */
export const STUCK_LONG_H = 36;
/**
 * The LATEST reading is only ever FLAGGED, never removed (it has no next neighbour; a sudden real rise must never be hidden). It "looks odd"
 * when it jumped more than this from the previous one while the one before agrees with the previous (within SPIKE_AGREE_FT). 3 ft: above the
 * largest ordinary one-step move on these gauges, below every glitch seen on 28 Oct (3.5 to 12.5 ft). A real flash rise will trip it too, which
 * is why it only widens the forecast and caps its wording at "possible" and never changes a level or a step.
 */
export const JUMP_FT = 3;

/** Feet per native unit; unknown unit is treated as feet (so metre gauges of unknown unit are judged more leniently, never harshly). */
const perUnit = (unit) => (unit === "m" ? FT_PER_M : 1);

const valid = (p) => p != null && typeof p.water_level === "number" && Number.isFinite(p.water_level);

/**
 * Clean a time-sorted series [{ts, water_level}] (native unit; unit "ft" | "m" | null).
 * Returns { points: the series without spikes and stuck repeats, flags: [{ts, kind: "spike"|"stuck", ...}] }.
 * The latest reading is never removed as a spike. Points with a null level are passed through untouched.
 */
/** @param {any[]} points
 * @param {{ unit?: "ft" | "m" | null }} [opts] */
export function cleanSeries(points, { unit = null } = {}) {
  const k = perUnit(unit);
  const src = points.filter(valid);
  const drop = new Map(); // ts -> flag
  const n = src.length;

  // ---- spikes (judged against the last kept reading before and the next reading after; never the latest reading)
  let prevIdx = -1;
  for (let a = 0; a < n; a++) {
    if (drop.has(src[a].ts)) continue;
    if (prevIdx < 0) { prevIdx = a; continue; }
    let found = 0;
    for (let run = 1; run <= SPIKE_MAX_RUN; run++) {
      const b = a + run; // index of the next neighbour; must exist, so the latest reading can never be a spike
      if (b >= n) break;
      const p = src[prevIdx].water_level, q = src[b].water_level;
      if (Math.abs(p - q) * k >= SPIKE_AGREE_FT) continue;
      if ((src[b].ts - src[prevIdx].ts) / HOUR_MS > SPIKE_STEP_H * (run + 1)) continue;
      let ok = true;
      for (let m = a; m < a + run && ok; m++) {
        const v = src[m].water_level;
        if (drop.has(src[m].ts)) { ok = false; break; }
        const dp = v - p, dq = v - q;
        ok = Math.abs(dp) * k > SPIKE_FT && Math.abs(dq) * k > SPIKE_FT && Math.sign(dp) === Math.sign(dq);
      }
      if (ok) { found = run; break; }
    }
    if (found) {
      for (let m = a; m < a + found; m++) drop.set(src[m].ts, { ts: src[m].ts, kind: "spike", level: src[m].water_level, between: [src[prevIdx].water_level, src[a + found].water_level] });
      a += found - 1;
    } else prevIdx = a;
  }

  // ---- stuck runs (exact repeats), judged on the series AFTER spikes are removed (a spike next to a run must not fake "moving before")
  const kept = src.filter((p) => !drop.has(p.ts));
  const n2 = kept.length;
  let i = 0;
  while (i < n2) {
    let j = i;
    while (j + 1 < n2 && kept[j + 1].water_level === kept[i].water_level) j++;
    const runH = (kept[j].ts - kept[i].ts) / HOUR_MS;
    if (j > i && runH >= STUCK_H) {
      let lo = Infinity, hi = -Infinity;
      for (let m = i - 1; m >= 0 && kept[i].ts - kept[m].ts <= STUCK_BEFORE_H * HOUR_MS; m--) {
        lo = Math.min(lo, kept[m].water_level); hi = Math.max(hi, kept[m].water_level);
      }
      const movedBefore = hi - lo >= 0 && Number.isFinite(hi - lo) && (hi - lo) * k >= STUCK_MOVING_FT;
      if (movedBefore || runH >= STUCK_LONG_H) {
      const hours = Math.round(runH * 10) / 10;
      for (let m = i + 1; m <= j; m++) drop.set(kept[m].ts, { ts: kept[m].ts, kind: "stuck", level: kept[m].water_level, hours, since: kept[i].ts, rangeBeforeFt: Number.isFinite(hi - lo) ? (hi - lo) * k : null });
      }
    }
    i = j + 1;
  }

  const flags = [...drop.values()].sort((x, y) => x.ts - y.ts);
  return { points: points.filter((p) => !(valid(p) && drop.has(p.ts))), flags };
}

/**
 * True when the latest reading jumped more than JUMP_FT from the previous one while the reading before that agrees with the previous
 * (so the river looked settled). A FLAG only: the reading is never removed or hidden.
 */
/** @param {any[]} points
 * @param {{ unit?: "ft" | "m" | null }} [opts] */
export function latestLooksOdd(points, { unit = null } = {}) {
  const k = perUnit(unit);
  const s = points.filter(valid);
  if (s.length < 3) return false;
  const [a, b, c] = [s[s.length - 3].water_level, s[s.length - 2].water_level, s[s.length - 1].water_level];
  return Math.abs(c - b) * k > JUMP_FT && Math.abs(b - a) * k < SPIKE_AGREE_FT;
}

/**
 * For Reading[] ({ts, water_level|null, rain_fall}): the same readings with the glitched LEVELS set to null (rain kept, so rain totals
 * are unchanged), plus the flags and whether the latest looks odd. Used by lib/forecast.ts for its inputs.
 */
/** @param {any[]} readings
 * @param {{ unit?: "ft" | "m" | null }} [opts] */
export function cleanReadings(readings, { unit = null } = {}) {
  const { flags } = cleanSeries(readings, { unit });
  const bad = new Set(flags.map((f) => f.ts));
  const odd = latestLooksOdd(readings.filter((r) => !bad.has(r.ts)), { unit });
  return { readings: bad.size ? readings.map((r) => (bad.has(r.ts) ? { ...r, water_level: null } : r)) : readings, flags, odd };
}
