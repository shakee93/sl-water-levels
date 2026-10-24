// How well the next-hour forecast has done so far, measured from the prediction log (Cloudflare D1:
// forecast_verification joined to forecast_runs, horizon 1 h, each forecast checked against the gauge
// reading closest to the target time, within 40 minutes). Levels converted to feet; "steady" means a
// change under 0.02 ft in the hour. Gauges whose unit is unknown are left out.
//
// These are numbers we measured, not targets. Update them (and `measuredOn`) when the log has grown:
//   scripts/export-predictions.sh YYYY-MM <dir>  ->  verification.json
// The sample is small (a day and a half), so every page that shows them says so.
export const ACCURACY = {
  /** Sri Lanka time, first and last forecast in the sample. */
  from: "2026-10-22",
  to: "2026-10-24",
  measuredOn: "2026-10-24",
  /** All 1-hour forecasts checked, fitted-model and trend-only gauges together. */
  checked: 516,
  gauges: 39,
  /** Gauges with a fitted model (the main forecast). */
  model: {
    checked: 420,
    gauges: 30,
    /** Average miss, feet. */
    maeFt: 0.1,
    /** The same average if we had simply said "no change", feet. */
    noChangeMaeFt: 0.12,
    /** Share of forecasts where the real level landed inside the stated range. */
    inRangePct: 98,
    /** Typical width of that range, feet. It is wide on purpose while the forecast is new. */
    rangeWidthFt: 0.8,
    /** Share where rising / falling / steady was called correctly. */
    directionPct: 52,
    /** Same, if we had always said "steady". */
    noChangeDirectionPct: 24,
  },
  /** Gauges without a fitted model get a simple trend estimate; it has not beaten "no change" yet. */
  trendOnly: { checked: 96, gauges: 9, maeFt: 0.38, noChangeMaeFt: 0.32 },
} as const;

/** One plain sentence for pages and llms.txt. */
export const accuracyLine = () =>
  `Checked against what the gauges then read, ${ACCURACY.model.checked} one-hour forecasts at ${ACCURACY.model.gauges} gauges (${ACCURACY.from} to ${ACCURACY.to}, Sri Lanka time) missed by about ${ACCURACY.model.maeFt.toFixed(2)} ft on average, against ${ACCURACY.model.noChangeMaeFt.toFixed(2)} ft if we had said "no change". The real level was inside the stated range ${ACCURACY.model.inRangePct}% of the time (the range is about ${ACCURACY.model.rangeWidthFt} ft wide), and rising, falling or steady was called correctly ${ACCURACY.model.directionPct}% of the time, against ${ACCURACY.model.noChangeDirectionPct}% for always saying steady. That is only about a day and a half of data, so treat it as an early result, not a guarantee.`;
