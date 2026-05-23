import type { BasinStation, Reading } from "./arcgis";
import { orderStations } from "./basinOrder";

export type AnomalyDetection = {
  status: "normal" | "possible_release" | "likely_release";
  observedRatePerH: number | null;
  upstreamMaxRatePerH: number | null;
  upstreamLeader: string | null;
  rain6hTotal: number | null;
  residualPerH: number | null;
  reasons: string[];
  message: string | null;
};

// Reading-to-reading rate over the most recent `hours` window.
// Same shape as forecast.ts recentMomentum, kept local so anomaly logic
// stays self-contained.
function recentRate(readings: Reading[], hours: number): number | null {
  const cutoff = Date.now() - hours * 3_600_000;
  const pts = readings
    .filter(
      (r): r is { ts: number; water_level: number; rain_fall: number | null } =>
        r.water_level != null &&
        Number.isFinite(r.water_level) &&
        r.water_level > -100 &&
        r.water_level < 1000 &&
        r.ts >= cutoff,
    )
    .sort((a, b) => a.ts - b.ts);
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dt = (b.ts - a.ts) / 3_600_000;
  if (dt <= 0) return null;
  return (b.water_level - a.water_level) / dt;
}

function rain6h(readings: Reading[]): number | null {
  const cutoff = Date.now() - 6 * 3_600_000;
  let sum = 0;
  let saw = false;
  for (const r of readings) {
    if (r.ts < cutoff) continue;
    if (r.rain_fall == null) continue;
    sum += r.rain_fall;
    saw = true;
  }
  return saw ? sum : null;
}

// Detect "unexplained rise" — a level climb at the selected station that
// can't be accounted for by upstream level rises or recent basin rainfall.
// The classic signature of a dam release upstream.
//
// Thresholds (calibrated by eye; tune against real events later):
//   observed >= 0.30/h AND no rain (<5mm) AND no upstream rise (<0.10/h)
//     → "likely_release"
//   observed >= 0.20/h AND (no rain OR no upstream rise) (one missing)
//     → "possible_release"
//   otherwise → "normal" (we render nothing)
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
    residualPerH: null,
    reasons: [],
    message: null,
  };
  if (snapshot.length === 0) return empty;
  const ordered = orderStations(basin, snapshot);
  const myIdx = ordered.findIndex((s) => s.station === selectedStation);
  if (myIdx < 0) return empty;
  const me = ordered[myIdx];

  const observed = recentRate(me.trend24h, 2);
  if (observed == null) return empty;

  const upstream = ordered.slice(0, myIdx);
  type UpRate = { station: string; rate: number };
  const upRates: UpRate[] = upstream
    .map((s) => ({ station: s.station, rate: recentRate(s.trend24h, 2) }))
    .filter((x): x is UpRate => x.rate != null);
  const upstreamLeader = upRates.length
    ? upRates.reduce((a, b) => (a.rate > b.rate ? a : b))
    : null;
  const upstreamMax = upstreamLeader?.rate ?? null;

  const atStation = rain6h(me.trend24h);
  const upRainSum = upstream.reduce((acc, s) => {
    const r = rain6h(s.trend24h);
    return acc + (r ?? 0);
  }, 0);
  const total = (atStation ?? 0) + upRainSum;

  // Don't flag anything if local isn't rising meaningfully.
  if (observed < 0.20) {
    return {
      ...empty,
      observedRatePerH: observed,
      upstreamMaxRatePerH: upstreamMax,
      upstreamLeader: upstreamLeader?.station ?? null,
      rain6hTotal: total,
    };
  }

  const noRain = total < 5;
  const upstreamFlat = upstreamMax == null || upstreamMax < 0.10;

  let status: AnomalyDetection["status"] = "normal";
  const reasons: string[] = [];

  if (observed >= 0.30 && noRain && upstreamFlat) {
    status = "likely_release";
    reasons.push(
      `Rising at +${observed.toFixed(2)}/h with no rainfall (${total.toFixed(1)}mm/6h across basin) and no upstream rise.`,
    );
  } else if (observed >= 0.20 && (noRain || upstreamFlat)) {
    status = "possible_release";
    if (noRain) {
      reasons.push(
        `Rising at +${observed.toFixed(2)}/h despite only ${total.toFixed(1)}mm/6h of rain across the basin.`,
      );
    }
    if (upstreamFlat) {
      const leaderInfo = upstreamLeader
        ? `; closest upstream (${upstreamLeader.station}) only ${upstreamLeader.rate >= 0 ? "+" : ""}${upstreamLeader.rate.toFixed(2)}/h`
        : "";
      reasons.push(`Upstream stations are not rising in step${leaderInfo}.`);
    }
  }

  const message =
    status === "likely_release"
      ? "Probable upstream release: rise here isn't explained by rainfall or natural upstream propagation."
      : status === "possible_release"
        ? "Unusual rise here — one or more natural drivers don't fit."
        : null;

  return {
    status,
    observedRatePerH: observed,
    upstreamMaxRatePerH: upstreamMax,
    upstreamLeader: upstreamLeader?.station ?? null,
    rain6hTotal: total,
    residualPerH: observed - (upstreamMax ?? 0),
    reasons,
    message,
  };
}
