import type { BasinStation } from "./arcgis";
import { orderStations } from "./basinOrder";
import { ageMinutes, isStale, rainTotal, rate } from "./readings";

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

// Great-circle distance in km between two lat/lon points.
function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Smoothly decaying proximity weight by distance.
// 0 km → 1.0, 10 km → 0.5, 30 km → 0.25, 100 km → ~0.09.
function proximityWeight(distKm: number): number {
  return 10 / (10 + Math.max(0, distKm));
}

// Rates here are blended and converted to METRES per hour so that upstream
// gauges reporting in a different unit (Norwood is metres on a feet river) are
// comparable, and so the heuristics below mean the same on every gauge.
// Thresholds were calibrated by eye on feet gauges; the metre values keep that
// intent (0.02 ft/h ~ 0.006 m/h, 0.05 ft/h ~ 0.015 m/h, 0.1 ft/h ~ 0.03 m/h,
// 0.5 ft ~ 0.15 m).
const STEADY_M_PER_H = 0.006;
const CONFIDENT_M_PER_H = 0.015;
const LEADER_NOTE_M_PER_H = 0.03;
const MIN_CLAMP_M = 0.15;

// Blend of the 3h least-squares slope (smooth) and the ~2h reading-to-reading
// momentum (catches post-peak descents and sudden rises a regression smooths
// away). Both windows are anchored to the gauge's own latest reading, and a
// gauge that hasn't reported for >3h yields null instead of a stale trend.
function blendedRateM(s: BasinStation): number | null {
  if (!s.latest || isStale(s.latest)) return null;
  const anchor = s.latest.ts;
  const slope = rate(s.trend24h, { hours: 3.25, anchor, method: "slope" });
  const momentum = rate(s.trend24h, { hours: 2.5, anchor });
  const blended =
    slope != null && momentum != null ? momentum * 0.6 + slope * 0.4 : (momentum ?? slope);
  return blended == null ? null : blended * s.metresPerUnit;
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
  const mpu = me.metresPerUnit;

  if (!me.latest) return emptyForecast(["This gauge is not reporting."]);
  if (isStale(me.latest)) {
    const h = Math.round((ageMinutes(me.latest) ?? 0) / 60);
    return emptyForecast([`Latest reading is ${h}h old, too stale to forecast.`]);
  }
  const anchor = me.latest.ts;

  // all rates below are metres/hour until the final conversion back to me's unit
  const localRateM = blendedRateM(me);
  const currentLevel = me.latest.water_level;

  // rain at THIS station over the 6h to its latest reading (often null at downstream/urban gauges)
  const rainAtStation6h = rainTotal(me.trend24h, 6, anchor);

  // upstream rate + upstream rain, weighted by straight-line distance to
  // the selected station (closer upstream gauges count for more).
  type UpSignal = {
    station: string;
    rateM: number | null;
    rain: number | null;
    weight: number;
    distKm: number;
  };
  const upSignals: UpSignal[] = upstream.map((s) => {
    const distKm = haversineKm(me, s);
    return {
      station: s.station,
      rateM: blendedRateM(s),
      rain: s.latest && !isStale(s.latest) ? rainTotal(s.trend24h, 6, s.latest.ts) : null,
      weight: proximityWeight(distKm),
      distKm,
    };
  });

  const upRateSignals = upSignals.filter(
    (s): s is UpSignal & { rateM: number } => s.rateM != null,
  );
  const upRateWeightSum = upRateSignals.reduce((a, b) => a + b.weight, 0);
  const upstreamRateM =
    upRateWeightSum > 0
      ? upRateSignals.reduce((a, b) => a + b.rateM * b.weight, 0) / upRateWeightSum
      : null;
  const leaderRaw =
    upRateSignals.length > 0
      ? upRateSignals.reduce((a, b) => (Math.abs(a.rateM) > Math.abs(b.rateM) ? a : b))
      : null;
  const upstreamLeader: { station: string; ratePerH: number } | null = leaderRaw
    ? { station: leaderRaw.station, ratePerH: leaderRaw.rateM / mpu }
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

  if (localRateM == null && upstreamRateM == null) {
    return emptyForecast(["Not enough recent readings to predict."]);
  }

  const localWeight = upstreamRateM != null ? 0.7 : 1;
  const upWeight = upstreamRateM != null ? 0.3 : 0;
  const baseDeltaM =
    (localRateM ?? upstreamRateM ?? 0) * localWeight +
    (upstreamRateM ?? 0) * upWeight;

  const notes: string[] = [];
  // Rain modulation. Unknown rain (null everywhere) contributes nothing and is
  // never treated as "dry": isDry needs at least one real zero-ish reading.
  const rainTotalMm = (rainAtStation6h ?? 0) + (rainUpstream6h ?? 0);
  // 0 mm => 1.0, 30 mm => 1.15, 80 mm => 1.3 (cap)
  const rainBoost = Math.min(0.3, rainTotalMm / 200);
  const rainKnown = rainAtStation6h != null || rainUpstream6h != null;
  // dry-and-rising means the rise will plateau soon → dampen
  const isRising = baseDeltaM > STEADY_M_PER_H;
  const isDry = rainKnown && (rainAtStation6h ?? 0) < 1 && (rainUpstream6h ?? 0) < 1;

  let magnitudeFactor = 1;
  if (isRising) {
    if (rainTotalMm > 1) magnitudeFactor = 1 + rainBoost;
    else if (isDry) magnitudeFactor = 0.8;
  }
  // Safety clamp: regression noise + tiny time windows can yield absurd
  // rates. Cap |delta| to the greater of 0.15 m or 30% of the current level
  // (so dam levels in the 100s aren't forced into a tiny window, but a 0.05
  // reading can't be predicted to jump by 50).
  const rawDeltaM = baseDeltaM * magnitudeFactor;
  const capM = currentLevel != null
    ? Math.max(MIN_CLAMP_M, Math.abs(currentLevel * mpu) * 0.3)
    : 0.3;
  const clampedM = Math.max(-capM, Math.min(capM, rawDeltaM));
  const predictedDelta = clampedM / mpu;
  if (clampedM !== rawDeltaM) {
    notes.push(
      `Trend slope (${(rawDeltaM / mpu).toFixed(2)}/h) was clamped to ±${(capM / mpu).toFixed(2)} as a sanity bound.`,
    );
  }
  const predictedLevel =
    currentLevel != null ? currentLevel + predictedDelta : null;

  const direction: Forecast["direction"] =
    clampedM > STEADY_M_PER_H
      ? "rising"
      : clampedM < -STEADY_M_PER_H
        ? "falling"
        : "steady";

  // confidence
  let confidence: Forecast["confidence"];
  if (localRateM == null) {
    confidence = "low";
    notes.push("No recent local readings — relying on upstream only.");
  } else if (upstreamRateM == null) {
    confidence = upstream.length === 0 ? "medium" : "low";
    if (upstream.length === 0)
      notes.push("Topmost station in basin; no upstream signal available.");
    else notes.push("Upstream readings missing; using local trend only.");
  } else {
    const sameDir = Math.sign(localRateM) === Math.sign(upstreamRateM);
    const magnitude = Math.max(Math.abs(localRateM), Math.abs(upstreamRateM));
    if (sameDir && magnitude >= CONFIDENT_M_PER_H) confidence = "high";
    else if (sameDir) confidence = "medium";
    else {
      confidence = "low";
      notes.push("Upstream and local trends disagree — direction is uncertain.");
    }
  }

  // rain-based confidence/note overlays
  if (direction === "rising") {
    if (rainTotalMm > 30) {
      if (confidence === "medium") confidence = "high";
      notes.push(
        `Recent rain (${rainTotalMm.toFixed(0)}mm/6h) reinforces the rising trend.`,
      );
    } else if (isDry) {
      if (confidence === "high") confidence = "medium";
      notes.push("No recent rain — rise is likely to plateau soon.");
    }
  } else if (direction === "falling" && rainTotalMm > 30) {
    if (confidence === "high") confidence = "medium";
    notes.push(
      `Recent rain (${rainTotalMm.toFixed(0)}mm/6h) may slow the decline.`,
    );
  }
  if (!rainKnown) notes.push("No rain data reported nearby; rain effects not factored in.");

  if (leaderRaw && Math.abs(leaderRaw.rateM) >= LEADER_NOTE_M_PER_H) {
    const lr = leaderRaw.rateM / mpu;
    notes.push(
      `${leaderRaw.station} ${lr > 0 ? "rising" : "falling"} at ${lr.toFixed(2)}/h.`,
    );
  }

  return {
    currentLevel,
    predictedLevel,
    predictedDelta,
    direction,
    confidence,
    localRatePerH: localRateM == null ? null : localRateM / mpu,
    upstreamRatePerH: upstreamRateM == null ? null : upstreamRateM / mpu,
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
