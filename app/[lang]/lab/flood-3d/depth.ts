// Water depth on the ground for the 3D water layer and the tap note ("About X ft of water here"). An ESTIMATE, calibrated on a handful of reported depths
// from Cyclone Ditwah (see scripts/flood3d and the private depth table): depth = rise of the river since the cell's own flood level, plus an extra offset in
// settled cells. Why the offset: the satellite flood maps only see water in the open, so in housing a cell is first marked wet when its streets are already
// deep, and the 30 m elevation (GLO-30) reads roof height in housing, so the real ground is lower than the model's. Fitted on reports (Welivita, Kaduwela,
// Biyagama, Malwana: 1.6 / 1.35 / 2.3 / 1.9 m above the model, mean 1.8 m) and checked on a held-out spot (predicted within 0.1 m).
export const FT = 0.3048;
export const SETTLED_OFFSET_M = 1.8;   // extra depth in settled cells once the water is a foot above the cell's flood level
export const OPEN_OFFSET_M = 0.3;      // open ground: the depth at which a satellite first sees it wet
const RAMP_SETTLED_FT = 1.0, RAMP_OPEN_FT = 0.3;

/** Depth in metres at a cell whose flood level is L (ft at Nagalagam Street) when the river is at lv (ft). 0 = dry. */
export function depthM(lv: number, L: number, settled: boolean): number {
  const d = lv - L;
  if (!(d > 0) || !Number.isFinite(L)) return 0;
  return (settled ? SETTLED_OFFSET_M * Math.min(1, d / RAMP_SETTLED_FT) : OPEN_OFFSET_M * Math.min(1, d / RAMP_OPEN_FT)) + FT * d;
}

/** The same formula as a MapLibre expression over the cell properties L (ft) and b (1 = settled), for a given river level. */
export function depthExpr(lv: number): unknown[] {
  const d = ["-", lv, ["get", "L"]];
  return ["case", [">", d, 0],
    ["+", ["*", ["case", ["==", ["get", "b"], 1], SETTLED_OFFSET_M, OPEN_OFFSET_M], ["min", 1, ["/", d, ["case", ["==", ["get", "b"], 1], RAMP_SETTLED_FT, RAMP_OPEN_FT]]]], ["*", FT, d]],
    0];
}
export function wetColorExpr(lv: number): unknown[] {
  return ["case", [">", ["-", lv, ["get", "L"]], 0], "rgba(40,120,210,1)", "rgba(40,120,210,0)"];
}
