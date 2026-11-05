// Plain-language helpers for reservoir releases: how big, in litres, and a size word.

// @ts-ignore node strip-types needs explicit extensions
import { RELEASE_ALERT_CUSECS } from "./releaseAlert.ts";

const LITRES_PER_CUSEC = 28.3168; // 1 ft3 = 28.3168 L, so 1 cusec = 28.3168 L/s

export type ReleaseSize = "small" | "moderate" | "large";

/** Bands in cusecs (the Irrigation Department's unit), shared by every size chip, meter and card. */
export const MODERATE_CUSECS = 1500;

/**
 * Size word from the figure alone. Fixed bands, because our archive holds only days of releases,
 * not enough to say "large for this reservoir" (5 Nov 2026: three reservoirs at 9,500, 5,460 and 2,240 cusecs all said
 * "Large", so the word told people nothing):
 *  - under 1,500 cusecs (about 42 m3/s): small, a canal-sized flow, routine for a spilling tank;
 *  - 1,500 to under 5,000: moderate, a clearly raised river flow that low riverside land can notice;
 *  - 5,000 and over (RELEASE_ALERT_CUSECS, about 140 m3/s): large, the size that can lift a downstream gauge to Alert
 *    (Deduru Oya at 5,250 lifted Moragaswewa by 2.7 m on 22 Oct 2026; its 19,600 peak went on to flood).
 */
export function releaseSize(cusecs: number): ReleaseSize {
  if (cusecs < MODERATE_CUSECS) return "small";
  if (cusecs < RELEASE_ALERT_CUSECS) return "moderate";
  return "large";
}

export const SIZE_STEP: Record<ReleaseSize, 1 | 2 | 3> = { small: 1, moderate: 2, large: 3 };

/** Litres a second, rounded to two significant figures so it reads as an estimate ("150,000"). */
export function litresPerSecond(cusecs: number): number {
  const l = cusecs * LITRES_PER_CUSEC;
  if (l < 100) return Math.round(l);
  const mag = 10 ** (Math.floor(Math.log10(l)) - 1);
  return Math.round(l / mag) * mag;
}

/** Nearest ten, as the cusec figure is shown. */
export const roundCusecs = (c: number) => Math.round(c / 10) * 10;
