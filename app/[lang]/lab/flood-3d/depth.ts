// Water depth on the ground for the tap note ("About X ft of water here"). An ESTIMATE.
// Two regimes, both calibrated on Cyclone Ditwah (private depth table, scripts/flood3d/prep.py):
//  - kind 2, the Kolonnawa / Megoda Kolonnawa / Wellampitiya pool (POOL_ZONE): one flat water surface behind the canals, rising 0.81 m per ft of Nagalagam stage up to
//    7.4 ft and 0.25 m per ft above, so depth = pool surface minus the cell's own fill level. Agrees on 6.25 m at the 1 Dec peak from three independent lines (a bridge-deck
//    reference, the 30 Nov satellite map, a resident's street depth).
//  - elsewhere: rise of the river since the cell's own flood level, plus an offset in settled cells (kind 1: the satellite maps see water in the open before between houses and
//    GLO-30 reads roof height in housing; 1.8 m = mean of four reported depths) or the depth at which a satellite first sees open ground (kind 0). Cells whose level was
//    lowered to the official May 2016 extent (scripts/flood3d/floor2016.py) are marked kind 0 in the grid: their level is a shallow extent edge, not a satellite first sight.
export const FT = 0.3048;
export const SETTLED_OFFSET_M = 1.8;
export const OPEN_OFFSET_M = 0.3;
const RAMP_SETTLED_FT = 1.0, RAMP_OPEN_FT = 0.3;
/** lon0, lon1, lat0, lat1: keep in step with POOL_ZONE in scripts/flood3d/prep.py */
export const POOL_ZONE = [79.885, 79.925, 6.915, 6.955] as const;
export const POOL_FADE_M = 2500; // keep in step with prep.py
/** 1 inside the calibrated box, fading to 0 over POOL_FADE_M beyond it. */
export function poolTaper(lon: number, lat: number): number {
  const dx = Math.max(POOL_ZONE[0] - lon, lon - POOL_ZONE[1], 0) * 111320 * Math.cos((lat * Math.PI) / 180), dy = Math.max(POOL_ZONE[2] - lat, lat - POOL_ZONE[3], 0) * 110574;
  return Math.min(1, Math.max(0, 1 - Math.hypot(dx, dy) / POOL_FADE_M));
}
/** Pool surface (m) at a Nagalagam stage (ft). */
export const poolW = (s: number) => 0.81 * Math.min(s, 7.4) + 0.25 * Math.max(0, s - 7.4);

/** Depth in metres at a cell with flood level L (ft at Nagalagam Street) when the river is at lv (ft). 0 = dry. kind: 0 open, 1 settled, 2 pool. */
export function depthM(lv: number, L: number, kind: 0 | 1 | 2, taper = 1): number {
  const d = lv - L;
  if (!(d > 0) || !Number.isFinite(L)) return 0;
  if (kind === 2) return taper * (poolW(lv) - poolW(L));
  return (kind === 1 ? SETTLED_OFFSET_M * Math.min(1, d / RAMP_SETTLED_FT) : OPEN_OFFSET_M * Math.min(1, d / RAMP_OPEN_FT)) + FT * d;
}
