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
  // rain signals (mm over the last 6 hours)
  rainAtStation6h: number | null;
  rainUpstream6h: number | null;
  rainContributors: string[];
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

// Total rainfall in the last `hours` hours. Returns null if no rain_fall
// values were ever reported (gauge has no rain sensor); 0 if the gauge
// reports but it didn't rain.
function totalRain(readings: Reading[], hours: number): number | null {
  const cutoff = Date.now() - hours * 3_600_000;
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

// 1-hour ahead prediction: local persistence + weighted upstream momentum,
// modulated by recent rainfall.
//
// Trend math:
//   localRate gets 70% weight when upstream exists, 100% otherwise.
//   upstream gets 30% weight, averaged across upstream stations,
//   nearer-upstream weighted higher via 1/(1+rank).
//
// Rain modulation:
//   - rainAtStation6h: rain in the gauge's own catchment in the last 6h.
//     Reinforces a near-term rise (small magnitude boost).
//   - rainUpstream6h: rain at upstream stations, weighted by the same
//     proximity weights. Already showing up in upstream water-level
//     trends, but reinforces confidence that the current trend has
//     fuel behind it.
//   - When the predicted direction is rising AND rain agrees, magnitude
//     gets up to +30%. When rising but no rain anywhere, magnitude
//     gets ×0.8 (rise will plateau soon).
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

  // rain at THIS station over the last 6h (often null at downstream/urban gauges)
  const rainAtStation6h = totalRain(me.trend24h, 6);

  // upstream rate + upstream rain, both proximity-weighted
  type UpSignal = { station: string; rate: number | null; rain: number | null; weight: number };
  const upSignals: UpSignal[] = upstream.map((s, i) => {
    const rank = upstream.length - i; // larger = further from selected
    const weight = 1 / Math.max(1, rank);
    return {
      station: s.station,
      rate: ratePerHour(s.trend24h, 3),
      rain: totalRain(s.trend24h, 6),
      weight,
    };
  });

  const upRateSignals = upSignals.filter(
    (s): s is UpSignal & { rate: number } => s.rate != null,
  );
  const upRateWeightSum = upRateSignals.reduce((a, b) => a + b.weight, 0);
  const upstreamRate =
    upRateWeightSum > 0
      ? upRateSignals.reduce((a, b) => a + b.rate * b.weight, 0) / upRateWeightSum
      : null;
  const leaderRaw =
    upRateSignals.length > 0
      ? upRateSignals.reduce((a, b) => (Math.abs(a.rate) > Math.abs(b.rate) ? a : b))
      : null;
  const upstreamLeader: { station: string; ratePerH: number } | null = leaderRaw
    ? { station: leaderRaw.station, ratePerH: leaderRaw.rate }
    : null;

  const upRainSignals = upSignals.filter(
    (s): s is UpSignal & { rain: number } => s.rain != null,
  );
  const upRainWeightSum = upRainSignals.reduce((a, b) => a + b.weight, 0);
  const rainUpstream6h =
    upRainWeightSum > 0
      ? upRainSignals.reduce((a, b) => a + b.rain * b.weight, 0) / upRainWeightSum
      : null;
  const rainContributors = upRainSignals
    .filter((s) => s.rain > 1)
    .map((s) => `${s.station} ${s.rain.toFixed(1)}mm`);

  if (localRate == null && upstreamRate == null) {
    return emptyForecast(["Not enough recent readings to predict."]);
  }

  const localWeight = upstreamRate != null ? 0.7 : 1;
  const upWeight = upstreamRate != null ? 0.3 : 0;
  const baseDelta =
    (localRate ?? upstreamRate ?? 0) * localWeight +
    (upstreamRate ?? 0) * upWeight;

  // rain modulation
  // total "rain signal" for modulating magnitude
  const rainTotal = (rainAtStation6h ?? 0) + (rainUpstream6h ?? 0);
  // 0 mm => 1.0, 30 mm => 1.15, 80 mm => 1.3 (cap)
  const rainBoost = Math.min(0.3, rainTotal / 200);
  // dry-and-rising means the rise will plateau soon → dampen
  const isRising = baseDelta > 0.02;
  const isDry = rainAtStation6h != null && rainAtStation6h < 1 &&
                (rainUpstream6h == null || rainUpstream6h < 1);

  let magnitudeFactor = 1;
  if (isRising) {
    if (rainTotal > 1) magnitudeFactor = 1 + rainBoost;
    else if (isDry) magnitudeFactor = 0.8;
  }
  const predictedDelta = baseDelta * magnitudeFactor;
  const predictedLevel =
    currentLevel != null ? currentLevel + predictedDelta : null;

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
    if (upstream.length === 0)
      notes.push("Topmost station in basin; no upstream signal available.");
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

  // rain-based confidence/note overlays
  if (direction === "rising") {
    if (rainTotal > 30) {
      if (confidence === "medium") confidence = "high";
      notes.push(
        `Recent rain (${rainTotal.toFixed(0)}mm/6h) reinforces the rising trend.`,
      );
    } else if (isDry) {
      if (confidence === "high") confidence = "medium";
      notes.push("No recent rain — rise is likely to plateau soon.");
    }
  } else if (direction === "falling" && rainTotal > 30) {
    if (confidence === "high") confidence = "medium";
    notes.push(
      `Recent rain (${rainTotal.toFixed(0)}mm/6h) may slow the decline.`,
    );
  }

  if (upstreamLeader && Math.abs(upstreamLeader.ratePerH) >= 0.1) {
    notes.push(
      `${upstreamLeader.station} ${upstreamLeader.ratePerH > 0 ? "rising" : "falling"} at ${upstreamLeader.ratePerH.toFixed(2)}/h.`,
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
    rainAtStation6h,
    rainUpstream6h,
    rainContributors,
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
    rainAtStation6h: null,
    rainUpstream6h: null,
    rainContributors: [],
    notes,
  };
}
