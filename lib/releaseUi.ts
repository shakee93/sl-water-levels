// Plain-language helpers for reservoir releases: how big, in litres, and a size word.

const LITRES_PER_CUSEC = 28.3168; // 1 ft3 = 28.3168 L, so 1 cusec = 28.3168 L/s

export type ReleaseSize = "small" | "large" | "veryLarge";

/**
 * Size word from the figure alone. Fixed bands, because our archive holds only days of releases,
 * not enough to say "large for this reservoir":
 *  - under 1,000 cusecs (about 28,000 L/s, 28 m3/s): a canal-sized flow, routine for a spilling tank;
 *  - 1,000 to 10,000 (up to ~283 m3/s): a river carrying a clearly raised flow, enough to lift a
 *    downstream gauge (Deduru Oya at 5,250 lifted Moragaswewa by 2.7 m on 22 Oct 2026);
 *  - above 10,000: flood-scale (the 22 Oct 2026 Deduru Oya peak was 19,600 and went on to flood).
 */
export function releaseSize(cusecs: number): ReleaseSize {
  if (cusecs < 1000) return "small";
  if (cusecs <= 10_000) return "large";
  return "veryLarge";
}

export const SIZE_STEP: Record<ReleaseSize, 1 | 2 | 3> = { small: 1, large: 2, veryLarge: 3 };

/** Litres a second, rounded to two significant figures so it reads as an estimate ("150,000"). */
export function litresPerSecond(cusecs: number): number {
  const l = cusecs * LITRES_PER_CUSEC;
  if (l < 100) return Math.round(l);
  const mag = 10 ** (Math.floor(Math.log10(l)) - 1);
  return Math.round(l / mag) * mag;
}

/** Nearest ten, as the cusec figure is shown. */
export const roundCusecs = (c: number) => Math.round(c / 10) * 10;
