import type { BasinStation } from "./arcgis";
import { orderStations } from "./basinOrder";
import { formatDelta } from "./units";
import { isStale, rainTotal, rate } from "./readings";

export type AnomalyDetection = {
  status: "normal" | "possible_release" | "likely_release";
  /** Rates are in the SELECTED station's units per hour (see `unit`). */
  observedRatePerH: number | null;
  upstreamMaxRatePerH: number | null;
  upstreamLeader: string | null;
  /** Rain over 6h across the basin's reporting gauges; null when none report rain. */
  rain6hTotal: number | null;
  /** false when no gauge in the basin has rain data: a release is never "likely" then. */
  rainKnown: boolean;
  residualPerH: number | null;
  unit: "ft" | "m" | null;
  reasons: string[];
  message: string | null;
};

// Rate thresholds are in METRES per hour so gauges reporting in feet and metres
// are judged alike (each station's rate is converted with its own unit). The
// values are the original by-eye calibration for feet gauges (Kelani) expressed
// in metres: 0.30 ft/h, 0.20 ft/h, 0.10 ft/h.
const LIKELY_RISE_M_PER_H = 0.09; // ~0.30 ft/h
const POSSIBLE_RISE_M_PER_H = 0.06; // ~0.20 ft/h
const UPSTREAM_FLAT_M_PER_H = 0.03; // ~0.10 ft/h
const NO_RAIN_MM_6H = 5;
const RATE_WINDOW_H = 2.25; // 2h + cadence jitter, anchored to each gauge's latest reading

// Detect "unexplained rise" — a level climb at the selected station that
// can't be accounted for by upstream level rises or recent basin rainfall.
// The classic signature of a dam release upstream.
//
//   observed >= 0.09 m/h AND no rain (<5mm) AND no upstream rise (<0.03 m/h)
//     → "likely_release"   (requires rain data to exist somewhere in the basin)
//   observed >= 0.06 m/h AND (no rain OR no upstream rise)
//     → "possible_release" (unknown rain counts as "not no-rain")
//   otherwise → "normal" (we render nothing)
//
// Windows are anchored to each gauge's latest reading, and stale gauges (>3h)
// are ignored, so a lagging gauge neither hides nor fakes a signal.
/** Basin rain over 6 h (mm) that is enough to explain a rise on its own: no "Unusual rise" then (unless it is extreme). */
const RAIN_EXPLAINS_MM_6H = 15;

export function detectAnomaly(
  basin: string,
  snapshot: BasinStation[],
  selectedStation: string,
): AnomalyDetection {
  const empty: AnomalyDetection = {
    status: "normal",
    observedRatePerH: null,
    upstreamMaxRatePerH: null,
    upstreamLeader: null,
    rain6hTotal: null,
    rainKnown: false,
    residualPerH: null,
    unit: null,
    reasons: [],
    message: null,
  };
  if (snapshot.length === 0) return empty;
  const ordered = orderStations(basin, snapshot.filter((s) => s.source !== "hmis" || s.station === selectedStation));
  const myIdx = ordered.findIndex((s) => s.station === selectedStation);
  if (myIdx < 0) return empty;
  const me = ordered[myIdx];
  const unit = me.unit;
  const mpu = me.metresPerUnit;
  const fmt = (v: number) => `${formatDelta(v, unit, { sign: true, digits: 2 })}/h`;

  // Basin-wide 6h rain, only from gauges that actually report rain.
  const rains = ordered
    .filter((s) => !isStale(s.latest))
    .map((s) => rainTotal(s.trend24h, 6, s.latest?.ts ?? null))
    .filter((v): v is number => v != null);
  const rainKnown = rains.length > 0;
  const rainSum = rainKnown ? rains.reduce((a, b) => a + b, 0) : null;
  const base = { ...empty, rainKnown, rain6hTotal: rainSum, unit };

  if (!me.latest || isStale(me.latest)) return base;
  const observedM = rate(me.trend24h, { hours: RATE_WINDOW_H, anchor: me.latest.ts });
  if (observedM == null) return base;
  const observedMetres = observedM * mpu;
  const observed = observedM; // station units

  const upstream = ordered.slice(0, myIdx).filter((s) => s.latest && !isStale(s.latest));
  type UpRate = { station: string; metres: number };
  const upRates: UpRate[] = [];
  for (const s of upstream) {
    const r = rate(s.trend24h, { hours: RATE_WINDOW_H, anchor: s.latest!.ts });
    if (r != null) upRates.push({ station: s.station, metres: r * s.metresPerUnit });
  }
  const leader = upRates.length ? upRates.reduce((a, b) => (a.metres > b.metres ? a : b)) : null;
  const upstreamMaxM = leader?.metres ?? null;
  const upstreamMax = upstreamMaxM == null ? null : upstreamMaxM / mpu;

  const partial = {
    ...base,
    observedRatePerH: observed,
    upstreamMaxRatePerH: upstreamMax,
    upstreamLeader: leader?.station ?? null,
  };

  if (observedMetres < POSSIBLE_RISE_M_PER_H) return partial;

  // With no rain data anywhere we can't say it didn't rain.
  const noRain = rainKnown && (rainSum ?? 0) < NO_RAIN_MM_6H;
  // "Upstream not rising" needs an upstream gauge to look at. A top-of-river gauge (Thawalama on the Gin Ganga, 26 Oct 2026)
  // has none, and used to read as "upstream flat", so ordinary rain rises there were called "Unusual rise".
  const upstreamFlat = upstream.length > 0 && (upstreamMaxM == null || upstreamMaxM < UPSTREAM_FLAT_M_PER_H);
  // Real rain on the basin explains a rise even when the upstream gauge lags (rain can fall between the gauges).
  const rainExplains = rainKnown && (rainSum ?? 0) >= RAIN_EXPLAINS_MM_6H;
  if (rainExplains && !noRain && observedMetres < LIKELY_RISE_M_PER_H * 3) return partial;

  let status: AnomalyDetection["status"] = "normal";
  const reasons: string[] = [];

  if (observedMetres >= LIKELY_RISE_M_PER_H && noRain && upstreamFlat) {
    status = "likely_release";
    reasons.push(
      `Rising at ${fmt(observed)} with no rainfall (${(rainSum ?? 0).toFixed(1)}mm/6h across the basin) and no upstream rise.`,
    );
  } else if (noRain || upstreamFlat) {
    status = "possible_release";
    if (noRain) {
      reasons.push(
        `Rising at ${fmt(observed)} despite only ${(rainSum ?? 0).toFixed(1)}mm/6h of rain across the basin.`,
      );
    }
    if (upstreamFlat) {
      const leaderInfo = leader ? `; closest upstream (${leader.station}) only ${fmt(leader.metres / mpu)}` : "";
      reasons.push(`Upstream stations are not rising in step${leaderInfo}.`);
    }
    if (!rainKnown) {
      reasons.push("No rain gauge in this basin is reporting, so rainfall can't be ruled out.");
    }
  }

  const message =
    status === "likely_release"
      ? "Probable upstream release: rise here isn't explained by rainfall or natural upstream propagation."
      : status === "possible_release"
        ? rainKnown
          ? "Unusual rise here — one or more natural drivers don't fit."
          : "Unusual rise here — upstream isn't rising in step, but no rain data is available to confirm a release."
        : null;

  return {
    ...partial,
    status,
    residualPerH: observed - (upstream.length ? (upstreamMax ?? 0) : 0),
    reasons,
    message,
  };
}
