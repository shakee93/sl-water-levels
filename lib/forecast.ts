import type { BasinStation, Reading } from "./arcgis";
import { orderStations } from "./basinOrder";

export type Forecast = {
  currentLevel: number | null;
  predictedLevel: number | null;
  predictedDelta: number | null;
  direction: "rising" | "falling" | "steady" | "unknown";
  confidence: "high" | "medium" | "low" | "none";
  localRatePerH: number | null;
  upstreamRatePerH: number | null;
  upstreamLeader: { station: string; ratePerH: number } | null;
  upstreamCount: number;
  notes: string[];
};

// Linear regression slope (units / hour) on the last `hours` of readings.
function ratePerHour(readings: Reading[], hours: number): number | null {
  const cutoff = Date.now() - hours * 3_600_000;
  const pts = readings.filter(
    (r): r is { ts: number; water_level: number; rain_fall: number | null } =>
      r.water_level != null && r.ts >= cutoff,
  );
  if (pts.length < 2) return null;

  const t0 = pts[0].ts;
  const x = pts.map((p) => (p.ts - t0) / 3_600_000);
  const y = pts.map((p) => p.water_level);
  const n = pts.length;
  const sx = x.reduce((a, b) => a + b, 0);
  const sy = y.reduce((a, b) => a + b, 0);
  const sxy = x.reduce((a, b, i) => a + b * y[i], 0);
  const sxx = x.reduce((a, b) => a + b * b, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

// 1-hour ahead prediction: local persistence + weighted upstream momentum.
//
// - localRate gets 70% weight when upstream exists, 100% otherwise.
// - upstream gets 30% weight, averaged across all upstream stations.
//   Nearer-upstream gets more weight via 1/(1+rank) attenuation.
// - confidence comes from signal agreement + magnitude.
export function makeForecast(
  basin: string,
  snapshot: BasinStation[],
  selectedStation: string,
): Forecast {
  const ordered = orderStations(basin, snapshot);
  const myIdx = ordered.findIndex((s) => s.station === selectedStation);
  if (myIdx < 0) {
    return emptyForecast(["Selected station not in basin snapshot."]);
  }
  const me = ordered[myIdx];
  const upstream = ordered.slice(0, myIdx);

  const localRate = ratePerHour(me.trend24h, 3);
  const currentLevel = me.latest?.water_level ?? null;

  // weighted upstream rate, only counting upstream stations with valid data
  const upstreamSignals: { station: string; rate: number; weight: number }[] = [];
  upstream.forEach((s, i) => {
    const r = ratePerHour(s.trend24h, 3);
    if (r == null) return;
    const rank = upstream.length - i; // i=0 most upstream, larger=further from selected
    const proximity = 1 / Math.max(1, rank); // nearer upstream gets bigger weight
    upstreamSignals.push({ station: s.station, rate: r, weight: proximity });
  });

  const upWeightSum = upstreamSignals.reduce((a, b) => a + b.weight, 0);
  const upstreamRate =
    upWeightSum > 0
      ? upstreamSignals.reduce((a, b) => a + b.rate * b.weight, 0) / upWeightSum
      : null;
  const upstreamLeader =
    upstreamSignals.length > 0
      ? upstreamSignals.reduce((a, b) =>
          Math.abs(a.rate) > Math.abs(b.rate) ? a : b,
        )
      : null;

  if (localRate == null && upstreamRate == null) {
    return emptyForecast(["Not enough recent readings to predict."]);
  }

  const localWeight = upstreamRate != null ? 0.7 : 1;
  const upWeight = upstreamRate != null ? 0.3 : 0;
  const predictedDelta =
    (localRate ?? upstreamRate ?? 0) * localWeight +
    (upstreamRate ?? 0) * upWeight;

  const predictedLevel =
    currentLevel != null ? currentLevel + predictedDelta : null;

  // direction: anything within ±0.02 (units) of zero we call steady
  const direction: Forecast["direction"] =
    predictedDelta > 0.02
      ? "rising"
      : predictedDelta < -0.02
        ? "falling"
        : "steady";

  // confidence
  const notes: string[] = [];
  let confidence: Forecast["confidence"];
  if (localRate == null) {
    confidence = "low";
    notes.push("No recent local readings — relying on upstream only.");
  } else if (upstreamRate == null) {
    confidence = upstream.length === 0 ? "medium" : "low";
    if (upstream.length === 0) notes.push("Topmost station in basin; no upstream signal available.");
    else notes.push("Upstream readings missing; using local trend only.");
  } else {
    const sameDir = Math.sign(localRate) === Math.sign(upstreamRate);
    const magnitude = Math.max(Math.abs(localRate), Math.abs(upstreamRate));
    if (sameDir && magnitude >= 0.05) confidence = "high";
    else if (sameDir) confidence = "medium";
    else {
      confidence = "low";
      notes.push("Upstream and local trends disagree — direction is uncertain.");
    }
  }

  if (upstreamLeader && Math.abs(upstreamLeader.rate) >= 0.1) {
    notes.push(
      `${upstreamLeader.station} is ${upstreamLeader.rate > 0 ? "rising" : "falling"} at ${upstreamLeader.rate.toFixed(2)}/h.`,
    );
  }

  return {
    currentLevel,
    predictedLevel,
    predictedDelta,
    direction,
    confidence,
    localRatePerH: localRate,
    upstreamRatePerH: upstreamRate,
    upstreamLeader,
    upstreamCount: upstream.length,
    notes,
  };
}

function emptyForecast(notes: string[]): Forecast {
  return {
    currentLevel: null,
    predictedLevel: null,
    predictedDelta: null,
    direction: "unknown",
    confidence: "none",
    localRatePerH: null,
    upstreamRatePerH: null,
    upstreamLeader: null,
    upstreamCount: 0,
    notes,
  };
}
