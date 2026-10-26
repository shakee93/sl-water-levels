// Colombo tide timing, predicted from harmonic constituents fitted to Nagalagam Street's own readings.
//
// WHY: the gauge sits in the tidal reach of the Kelani. Its twice-daily swing (about 1 to 1.5 ft) is the sea tide,
// delayed and damped by the river mouth, and it is the same tide that holds back the canals that drain into the
// river (Kolonnawa, Mutwal, Kotte). Tide times are astronomical, so they can be told two days ahead with no live data.
//
// SOURCE (documented, reproducible): scripts/fit-tide.mjs fits M2, S2, N2, K1 and O1 by least squares to about 11
// months of hourly Nagalagam Street readings (this repo's `data` branch + the nuuuwan/lk_irrigation hourly feed),
// using only hours when the river was low and steady (49 h window under 4.2 ft, mean under 3.2 ft) so the tide is the
// only thing moving. Out of sample (fit without the last 60 days, scored on them): 78% of the dry-period variance,
// 0.22 ft rms, and the predicted high-tide time within 60 minutes of the observed high for 80% of highs
// (median miss 30 minutes; the readings are hourly, so that is about the resolution limit).
// NO CUrW data went into this. A published Colombo constituent table was not used: the gauge's own tide, which
// includes the river mouth's delay, is what the canals feel.
//
// The phases are fitted at the gauge, so they already contain the lag from the open sea (CUrW's Mutwal Inlet sea
// level leads Nagalagam's highs by 0 to 2 h). Heights are the tide's contribution at Nagalagam in feet around its
// mean; they are NOT a river level and never enter a verdict. Use for timing, not for how high the water will be.
//
// Pure functions, no dependencies, safe on server and client.

const H = 3_600_000;

type Constituent = { name: string; periodH: number; ampFt: number; phaseDeg: number };
/** y(t) = sum A cos(2 pi t_h / period - phase), t_h = hours since the Unix epoch. Refit with scripts/fit-tide.mjs. */
export const TIDE_CONSTITUENTS: Constituent[] = [
  { name: "M2", periodH: 12.4206012, ampFt: 0.4136, phaseDeg: 86 },
  { name: "S2", periodH: 12, ampFt: 0.3497, phaseDeg: 305 },
  { name: "N2", periodH: 12.6583475, ampFt: 0.0486, phaseDeg: 308 },
  { name: "K1", periodH: 23.9344697, ampFt: 0.1709, phaseDeg: 309.9 },
  { name: "O1", periodH: 25.8193417, ampFt: 0.0925, phaseDeg: 176 },
];

/** Tide height at Nagalagam Street around its mean, in feet, at time t (ms). */
export function tideFt(t: number): number {
  const th = t / H;
  let y = 0;
  for (const c of TIDE_CONSTITUENTS) y += c.ampFt * Math.cos((2 * Math.PI * th) / c.periodH - (c.phaseDeg * Math.PI) / 180);
  return y;
}

export type TideEvent = { t: number; kind: "high" | "low"; ft: number };

/**
 * High and low tides in [from, from + hours]. Sampled every 5 minutes, refined to the minute with a parabola.
 * A bump smaller than 0.12 ft against its neighbours (a "stand" between the two daily highs) is not reported, and
 * highs and lows always alternate.
 */
export function tideEvents(from: number, hours = 48): TideEvent[] {
  const STEP = 5 * 60_000;
  const pad = 6 * H; // look a little outside so the window's edges are judged against real neighbours
  const t0 = from - pad, t1 = from + hours * H + pad;
  const raw: TideEvent[] = [];
  let a = tideFt(t0), b = tideFt(t0 + STEP);
  for (let t = t0 + STEP; t < t1; t += STEP) {
    const c = tideFt(t + STEP);
    if ((b > a && b >= c) || (b < a && b <= c)) {
      // parabola through (t-STEP, a), (t, b), (t+STEP, c)
      const d = a - 2 * b + c;
      const off = d !== 0 ? (0.5 * (a - c)) / d : 0;
      const tt = t + off * STEP;
      raw.push({ t: Math.round(tt / 60_000) * 60_000, kind: b > a ? "high" : "low", ft: tideFt(tt) });
    }
    a = b; b = c;
  }
  // drop tiny wiggles, then force alternation (keep the more extreme of two of the same kind)
  const out: TideEvent[] = [];
  for (const e of raw) {
    const last = out[out.length - 1];
    if (last && last.kind === e.kind) {
      if ((e.kind === "high" && e.ft > last.ft) || (e.kind === "low" && e.ft < last.ft)) out[out.length - 1] = e;
      continue;
    }
    if (last && Math.abs(e.ft - last.ft) < 0.12) { out.pop(); continue; }
    out.push(e);
  }
  return out.filter((e) => e.t >= from && e.t <= from + hours * H);
}

export type TideNow = {
  /** Where the tide is relative to its highs. */
  phase: "near-high" | "rising" | "falling" | "near-low";
  nextHigh: TideEvent | null;
  nextLow: TideEvent | null;
  /** Minutes to the next high (or since the last one when it is near-high and just passed: negative). */
  minToHigh: number | null;
  /** Next highs in the next 48 h (at least two when available). */
  highs: TideEvent[];
  /** Within 90 minutes either side of a high: canals drain slowest. */
  nearHigh: boolean;
};

const NEAR_HIGH_MIN = 90;

export function tideNow(now: number): TideNow {
  const ev = tideEvents(now - 2 * H, 52);
  const prevHigh = [...ev].reverse().find((e) => e.kind === "high" && e.t <= now) ?? null;
  const highs = ev.filter((e) => e.kind === "high" && e.t >= now - NEAR_HIGH_MIN * 60_000);
  const nextHigh = ev.find((e) => e.kind === "high" && e.t > now) ?? null;
  const nextLow = ev.find((e) => e.kind === "low" && e.t > now) ?? null;
  const sinceHigh = prevHigh ? (now - prevHigh.t) / 60_000 : Infinity;
  const toHigh = nextHigh ? (nextHigh.t - now) / 60_000 : Infinity;
  const nearHigh = sinceHigh <= NEAR_HIGH_MIN || toHigh <= NEAR_HIGH_MIN;
  const nearLow = !!nextLow && (nextLow.t - now) / 60_000 <= 60;
  const phase: TideNow["phase"] = nearHigh ? "near-high" : nearLow ? "near-low" : nextHigh && (!nextLow || nextHigh.t < nextLow.t) ? "rising" : "falling";
  return { phase, nextHigh, nextLow, minToHigh: nextHigh ? Math.round(toHigh) : null, highs, nearHigh };
}

/** Does a high tide fall between `now` and `now + hours` (or was one in the last 90 minutes)? Returns it. */
export function highTideWithin(now: number, hours: number): TideEvent | null {
  const ev = tideEvents(now - NEAR_HIGH_MIN * 60_000, hours + NEAR_HIGH_MIN / 60);
  return ev.find((e) => e.kind === "high") ?? null;
}

/** Colombo (UTC+5:30, no daylight saving) calendar-day number of a timestamp. */
export const colomboDay = (t: number): number => Math.floor((t + 5.5 * H) / (24 * H));
