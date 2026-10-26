// Town flood estimate: "is <town> flooding / will it flood?" for places with NO river gauge of their
// own (Wellampitiya sits on a canal that backs up from the Kelani Ganga; the nearest gauge is Nagalagam
// Street). Pure and deterministic: no fetching, no clock, no strings. The page (lib/townData.ts)
// gathers the inputs, this file decides, app/flood/TownVerdict.tsx words it (lib/i18n/town.ts).
//
// The verdict uses the same scale as a gauge page:
//   normal -> watch ("Keep an eye on it") -> alert ("Get ready") -> minor ("Flooding likely") -> major ("Move to safety")
// plus "stale" = we cannot estimate (no usable gauge). It is an ESTIMATE: it never claims "Flooding now",
// because only a measurement can show that, so the gauge's minor-flood level reads "Flooding likely" here.
//
// HOW IT DECIDES (read top to bottom; each step only ever raises the tone):
//  1. River tone ("gauge tone"). Start from the freshness-aware tier of the town's primary gauge (the
//     secondary one if the primary has no fresh reading). Then, exactly as on the gauge page:
//       - a forecast crossing of alert or above within 24 h that is "likely" (>= 50%), or "possible"
//         while the river is rising, lifts normal/watch to alert;
//       - a confirmed reservoir release upstream while the river is rising and already "watch" or
//         higher lifts it to alert (not for upland towns, whose streets are not fed by the river).
//     Canal-backwater towns get one extra rule, CANAL_EARLY: a river that is "near alert" AND rising
//     lifts them to alert, because canals stop draining into a high river well before the gauge's
//     alert mark is reached.
//  2. Personal level. If the visitor saved the gauge reading at which THEIR street floods (localStorage
//     sl_my_levels, in the gauge's own unit), the river is compared with it and wins over the official
//     tiers: at/above it -> minor ("Flooding likely"); the 24 h forecast reaches it while rising, or the
//     river is within 15% of it and rising -> alert; within 15% -> watch (same 0.85 ratio as the gauge
//     "watch" tier, lib/status.ts WATCH_RATIO). Not applied to upland towns' rain step below.
//  3. Local rain, evaluated at the town's own coordinates (Open-Meteo): HEAVY when 50 mm fall (or are
//     forecast) in 6 h, or 100 mm in 24 h. This is an assumption, not a calibration: ~50 mm/6 h is about
//     8 mm/h, above the 7.6 mm/h that meteorologists (AMS/WMO usage) call "heavy" rain, and 100 mm/24 h
//     is the level at which the Sri Lanka Met Department issues heavy-rain advisories (their "about 100 mm"
//     wording). Heavy rain raises the tone by exactly ONE step from the river/personal tone, never two:
//       normal -> watch (any town); watch/alert -> next tone for canal-backwater and riverbank towns
//       (their streets back up when the river is already high); upland towns stop at watch.
//     Rain alone never reaches "major" (Move to safety): the rain step is capped at minor.
//     The ensemble's 90th percentile is shown as "up to N mm possible" but never changes the tone.
//  4. Official warnings. A current DMC/Irrigation warning naming the gauge's river basin or the town's
//     district sets a FLOOR: advisory -> watch, alert -> alert, minor flood -> alert, major flood /
//     evacuation -> minor. (A basin-wide warning does not say this street is under water, so even a
//     "major flood" warning only floors the town at "Flooding likely"; the Move-to-safety tone comes
//     from a measured major level at the gauge.)
//  5. No usable gauge (none fresh, none within FAR_GAUGE_KM, or no flood levels published): tone "stale"
//     ("no estimate") unless heavy rain or an official warning gives a reason, in which case the same
//     rules start from normal. One exception: a fresh gauge that publishes no flood levels (Ampara) still
//     works for a visitor who has saved their street's level, because that comparison needs no official marks.
//  Missing data is never zero: no rain feed means no rain lines and no "no heavy rain expected" claim.
//
//  6. Kelani at its minor flood level (canal-backwater towns it was backtested on, lib/places.ts rainZone). This is a
//     RIVER level: Nagalagam Street at 5 ft or Hanwella at its own published minor mark (input.streetRiver.triggered,
//     decided in lib/streetRainLog.ts riverTrigger). Canals back up then, so it lifts the tone to minor ("Flooding
//     likely") like any other river reading, and it is part of baseTone.
//
//  Low-spot rain heads-up (NOT part of the verdict). Satellite rain over the town (24 h SUM of hourly GSMaP_NOW means over
//     the 4-pixel box, each hour clipped at 15 mm, scripts/gsmap-snapshot.mjs mm24hClipped) is reported as `lowSpot`:
//     "possible" at 60 mm, "likely" at 100 mm (research/wellampitiya-flood-rule-backtest.md). It never changes the tone,
//     the reasons or the next-24-hours line, and it is never shown to the public as a flood claim: only about 2% of a
//     town's streets (the lowest ground beside a canal) ever get water, and the rule is often wrong. It exists for the
//     visitor who has switched on "My spot floods in heavy rain" for this place (lib/lowSpots.ts): their Your places row
//     shows a quiet note, and only "likely" can send them a push (lib/pushPrefs.ts lowSpots). Missing or stale satellite
//     data (input.streetRain === null) switches it off silently (no calm claim).
// Constants below are the only tuning knobs.
import type { Tier } from "./status";
// @ts-ignore node strip-types needs explicit extensions
import { isTidalStation, liftVerdict } from "./verdictLift.ts";
import type { Unit } from "./units";

/** Owner decision 26 Oct 2026: "Get ready" is the gauge's official alert level. Releases and rising canals no longer lift a town to it early. */
const PRE_ALERT_LIFTS = false;

export type Tone = "normal" | "watch" | "alert" | "minor" | "major" | "stale";
export const TONES: Tone[] = ["normal", "watch", "alert", "minor", "major"];
const rank = (t: Tone) => TONES.indexOf(t);
const at = (i: number): Tone => TONES[Math.max(0, Math.min(TONES.length - 1, i))];
const maxTone = (...ts: (Tone | null)[]): Tone | null => {
  let best: Tone | null = null;
  for (const t of ts) if (t && t !== "stale" && (best == null || rank(t) > rank(best))) best = t;
  return best;
};

export type Drainage = "canal-backwater" | "riverbank" | "upland";

/** Satellite (GSMaP_NOW) rain over the area, 24 h total (each hour clipped at STREET_HOURLY_CAP_MM) at which the personal low-spot note appears ("may get water"). */
export const STREET_POSSIBLE_MM_24H = 60;
/** ... and "likely". Calibrated on GSMaP_NOW only. */
export const STREET_LIKELY_MM_24H = 100;
/** No single hour counts for more than this many mm in the 24 h sum (scripts/gsmap-snapshot.mjs STREET_HOURLY_CAP_MM). */
export const STREET_HOURLY_CAP_MM = 15;

/** Heavy rain: this many mm within 6 hours ... */
export const HEAVY_MM_6H = 50;
/** ... or within 24 hours. */
export const HEAVY_MM_24H = 100;
/** A river rising by more than this (metres per hour) counts as rising; same as the gauge page. */
export const RISING_M_PER_H = 0.006;
/** Personal level: within this fraction below the street's level counts as "close" (0.85, the same ratio as lib/status.ts WATCH_RATIO; kept literal so this file stays dependency-free). */
export const PERSONAL_NEAR = 0.85;
/** Rain below these totals is not worth a line in the reasons. */
export const NOTABLE_MM_6H = 10;
export const NOTABLE_MM_24H = 25;
/** A gauge farther than this from the town says too little about it to base an estimate on. */
export const FAR_GAUGE_KM = 40;

export type GaugeIn = {
  station: string;
  /** Display name, e.g. "Nagalagam Street". */
  name: string;
  basin: string;
  /** Freshness-aware tier from lib/arcgis (stale/none = unusable). */
  tier: Tier;
  level: number | null;
  unit: Unit;
  /** Timestamp of that reading. */
  ts: number | null;
  /** Change in metres per hour (3 h window); null = unknown. */
  rate3hM: number | null;
  /** River really rising, de-tided for tidal gauges (riverRising in lib/verdictLift.ts). Missing = from rate3hM, never true for a tidal gauge. */
  rising?: boolean | null;
  km: number;
};

export type ForecastIn = {
  status: "ok" | "degraded" | "unavailable";
  /** Forecast level 1 h and 24 h ahead, in the gauge's unit; null = none. */
  h1Level: number | null;
  h24Level: number | null;
  /** Highest forecast level over all horizons (the upper 80% band where there is one), gauge unit. */
  maxLevel: number | null;
  currentLevel: number | null;
  /** Metres per gauge unit, to turn the 1 h change into metres. */
  metresPerUnit: number;
  crossings: { threshold: "alert" | "minor" | "major"; wording: "likely" | "possible" | "unlikely" | "already"; etaTs: number | null; level?: number; probability?: number }[];
  /** Central forecast levels by hours ahead (not the band): the "close to the mark" test of lib/verdictLift.ts. */
  horizons?: { h: number; level: number }[];
};

export type RainIn = {
  past6hMm: number;
  past24hMm: number;
  next6hMm: number;
  next24hMm: number;
  next24hP90Mm: number | null;
  next6hP90Mm: number | null;
};

export type ReleaseIn = { confirmed: boolean; reservoir: string; cusecs: number | null; etaHours: number | null };
export type WarningIn = { severity: "none" | "advisory" | "alert" | "minor flood" | "major flood" | "evacuation"; source: string; area: string };

export type StreetRainIn = {
  /** The number the rule uses: 24 h sum of hourly means, each hour clipped at 15 mm. */
  mm24h: number;
  /** The same 24 h total without the clip (display only). */
  mm24hRaw: number | null;
  mm6h: number | null;
  mm1h: number | null;
  /** end of the newest hour, ms */
  endsAt: number;
};

/** The Kelani at its minor flood level, from the live gauges (lib/streetRainLog.ts riverTrigger). */
export type StreetRiverIn = { triggered: boolean; /** display name of the gauge that triggered, e.g. "Hanwella" */ gauge: string; /** formatted level, e.g. "25.1 ft" */ level: string };

export type TownRiskInput = {
  drainage: Drainage;
  primary: GaugeIn | null;
  secondary: GaugeIn | null;
  forecast: ForecastIn | null;
  rain: RainIn | null;
  release: ReleaseIn | null;
  warning: WarningIn | null;
  /** Satellite rain for the street-rain rule. undefined = the rule does not apply to this town; null = it does, but the data is missing or stale (rule off). */
  streetRain?: StreetRainIn | null;
  /** River half of the street rule (Kelani at its minor flood level). Same convention: undefined = rule not applicable; null = gauges unreadable. */
  streetRiver?: StreetRiverIn | null;
  /**
   * Heavy rain the river gauges MEASURED at or above this town's gauge (lib/measuredRain.ts). Used only as a reason line and, at most,
   * the "keep an eye" tone (watch) for a town that would otherwise read calm: rain alone never makes a town look flooded.
   */
  measured?: { gaugeName: string; hours: 1 | 3; mm: number; local?: boolean } | null;
  now: number;
};

export type ReasonKind = "official" | "personal" | "river" | "forecast" | "rain" | "canal" | "release" | "calm" | "nogauge";
export type Reason = {
  kind: ReasonKind;
  /** Key in lib/i18n/town.ts, with its variables (already formatted). */
  key: string;
  vars: Record<string, string | number>;
  /** True for the lines that pushed the tone up: drawn with an amber icon. */
  warn: boolean;
};

export type TownRisk = {
  tone: Tone;
  /** The tone before any rain-only input is added (no longer different from `tone`, kept for the push rules): "stale" when none. */
  baseTone: Tone;
  /** Tone from the river alone (steps 1-2), before rain and warnings. */
  riverTone: Tone | null;
  /** The gauge actually used (primary, else secondary), or null. */
  gauge: GaugeIn | null;
  heavyRain: boolean;
  /** True when heavy rain lifted the tone. */
  rainRaised: boolean;
  /** The satellite low-spot rain level (null when below 60 mm, data missing, or the rule does not apply). Never part of `tone`. */
  lowSpot: { level: "possible" | "likely"; /** clipped 24 h rain, mm */ mm: number } | null;
  trend: "up" | "down" | "steady" | "unknown";
  reasons: Reason[];
  /** Next-hour line: key into the dictionary. */
  hourKey: "dir.tide" | "dir.rising" | "dir.slow" | "dir.falling" | "dir.steady" | "dir.unknown";
  /** Next-24-hours line. */
  day: { key: string; vars: Record<string, string | number> };
  /** Action sentence key, or null. */
  actionKey: "a.alert" | "a.minor" | "a.major" | null;
};

const tierTone = (t: Tier): Tone | null => (t === "stale" || t === "none" ? null : t);
/** A fresh reading against published flood levels, close enough to the town to mean something. */
export const usableGauge = (g: GaugeIn | null): g is GaugeIn => !!g && tierTone(g.tier) != null && g.level != null && g.km <= FAR_GAUGE_KM;
/** A fresh reading from a gauge with no published flood levels: usable only against the visitor's own street level. */
const marksless = (g: GaugeIn | null): g is GaugeIn => !!g && g.tier === "none" && g.level != null && Number.isFinite(g.level) && g.km <= FAR_GAUGE_KM;

export function isHeavyRain(r: RainIn | null): boolean {
  if (!r) return false;
  return Math.max(r.past6hMm, r.next6hMm) >= HEAVY_MM_6H || Math.max(r.past24hMm, r.next24hMm) >= HEAVY_MM_24H;
}

const WARN_FLOOR: Record<WarningIn["severity"], Tone | null> = {
  none: null,
  advisory: "watch",
  alert: "alert",
  "minor flood": "alert",
  "major flood": "minor",
  evacuation: "minor",
};

// Same display as formatLevel in lib/units.ts (kept inline: this module is type-import only so the
// node test runner can load it): feet to 1 decimal, metre gauges converted, unknown unit bare.
const fmtLevel = (v: number, unit: Unit) =>
  unit == null
    ? `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, "")}`
    : `${(unit === "m" ? v / 0.3048 : v).toFixed(1)} ft`;
const r1 = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

export function assessTown(input: TownRiskInput, rawMyLevel: number | null = null): TownRisk {
  const { drainage, forecast, rain, release, warning } = input;
  // a street level only means something as a positive number
  const myLevel = rawMyLevel != null && Number.isFinite(rawMyLevel) && rawMyLevel > 0 ? rawMyLevel : null;
  let gauge = usableGauge(input.primary) ? input.primary : usableGauge(input.secondary) ? input.secondary : null;
  const noMarks = gauge == null && myLevel != null;
  if (noMarks) gauge = marksless(input.primary) ? input.primary : marksless(input.secondary) ? input.secondary : null;
  const reasons: Reason[] = [];

  // ---- 1. river tone
  const rate = gauge?.rate3hM ?? null;
  const rising = rate != null && rate > RISING_M_PER_H;
  // the forecast lift asks for the river rising with the tide taken out (Nagalagam Street's rate is mostly tide); the personal-level and
  // canal rules above keep the raw rate on purpose: a street floods from the tide's water too
  const liftRising = gauge ? (gauge.rising ?? (isTidalStation(gauge.station) ? false : rising)) : false;
  const trend: TownRisk["trend"] = rate == null ? "unknown" : Math.abs(rate) < RISING_M_PER_H ? "steady" : rate < 0 ? "down" : "up";

  let river: Tone | null = null;
  // "watch" that only comes from a small-chance forecast crossing: the raw-rate rules below must not turn it into "alert" (tide rise)
  let smallChanceWatch = false;
  let forecastReason: Reason | null = null;
  let personalReason: Reason | null = null;
  if (gauge) {
    // a gauge with no published marks starts from "normal": only the street's own level can raise it
    river = tierTone(gauge.tier) ?? "normal";
    // forecast crossing of alert or above within 24 h
    // forecast crossing of alert or above within 24 h: one shared rule (lib/verdictLift.ts)
    const lift = forecast && forecast.status !== "unavailable"
      ? liftVerdict({ tier: river ?? "normal", crossings: forecast.crossings, horizons: forecast.horizons, currentLevel: forecast.currentLevel, rising: liftRising, now: input.now })
      : null;
    const cross = lift?.crossing ?? undefined;
    if (cross && lift) {
      const flood = cross.threshold !== "alert";
      const h = lift.etaHours;
      const small = lift.why === "small";
      const key = `r.forecast${small ? "Small" : ""}${flood ? "Flood" : "Alert"}${h == null ? "Day" : ""}`;
      forecastReason = { kind: "forecast", key, vars: h == null ? { gauge: gauge.name } : { gauge: gauge.name, h }, warn: false };
      if ((river === "normal" || river === "watch") && lift.verdict === "alert") {
        river = "alert";
        forecastReason.warn = true;
      } else if (river === "normal" && lift.verdict === "watch") {
        // forecast only (likely or small chance): Keep an eye on it, and the rules below must not turn it into Get ready
        river = "watch";
        smallChanceWatch = true;
        forecastReason.warn = !small;
      }
    }
    // confirmed release upstream, river rising and already near/at alert
    // (26 Oct 2026: a release or rising canals no longer make "Get ready" before the gauge's alert level; they stay reasons/notes)
    if (PRE_ALERT_LIFTS && release?.confirmed && drainage !== "upland" && rising && !smallChanceWatch && rank(river) >= rank("watch") && rank(river) < rank("alert")) river = "alert";
    // canals back up before the gauge reaches alert
    if (PRE_ALERT_LIFTS && drainage === "canal-backwater" && river === "watch" && rising && !smallChanceWatch) river = "alert";

    // ---- 2. personal level
    if (myLevel != null && gauge.level != null) {
      const lvl = gauge.level;
      let p: Tone | null = null;
      const fMax = forecast && forecast.status !== "unavailable" ? forecast.maxLevel : null;
      if (lvl >= myLevel) p = "minor";
      else if (fMax != null && fMax >= myLevel && rising) p = "alert";
      else if (lvl >= myLevel * PERSONAL_NEAR) p = rising ? "alert" : "watch";
      if (p) {
        // the street's own level is stronger evidence than the gauge's official marks
        const before = river;
        river = maxTone(river, p);
        personalReason = {
          kind: "personal",
          key: lvl >= myLevel ? "r.personalAt" : "r.personalNear",
          vars: { gauge: gauge.name, level: fmtLevel(lvl, gauge.unit), mine: fmtLevel(myLevel, gauge.unit) },
          warn: before == null || rank(river!) > rank(before),
        };
      }
    }
  }

  // ---- 3. rain
  const heavy = isHeavyRain(rain);
  let tone: Tone | null = river;
  let rainRaised = false;
  if (heavy) {
    if (tone == null) {
      // no usable gauge: heavy rain alone is a reason to keep an eye on it
      if (gauge == null) { tone = "watch"; rainRaised = true; }
    } else if (tone === "normal") {
      tone = "watch";
      rainRaised = true;
    } else if (drainage !== "upland" && rank(tone) < rank("minor")) {
      tone = at(rank(tone) + 1);
      rainRaised = true;
    }
  }

  // Heavy rain measured by the river gauges on this town's river: a heads-up, never more than "watch" and never on top of a river tone
  // that is already at watch or above.
  const mh = input.measured ?? null;
  let measuredRaised = false;
  if (mh && !heavy) {
    if (tone == null) {
      if (gauge == null) { tone = "watch"; measuredRaised = true; }
    } else if (tone === "normal") {
      tone = "watch";
      measuredRaised = true;
    }
  }

  // ---- 4. official warning floor
  const floor = warning ? WARN_FLOOR[warning.severity] : null;
  const warnRaised = floor != null && (tone == null || rank(floor) > rank(tone));
  if (floor) tone = maxTone(tone, floor);

  // ---- 6. the Kelani at its minor flood level (a river reading), then the low-spot rain level (kept apart from the tone)
  const sr = input.streetRain;
  const sriver = input.streetRiver?.triggered ? input.streetRiver : null;
  const lowSpot: TownRisk["lowSpot"] = sr && sr.mm24h >= STREET_POSSIBLE_MM_24H ? { level: sr.mm24h >= STREET_LIKELY_MM_24H ? "likely" : "possible", mm: r1(sr.mm24h) } : null;
  const riverStreetDrives = !!sriver && (tone == null || rank("minor") > rank(tone));
  if (sriver) tone = maxTone(tone, "minor");
  // Street-flood "likely" (24 h satellite rain, clipped at 15 mm/h, >= 100 mm) raises a canal-flood town to "Get ready".
  // Owner decision 26 Oct 2026, after water stood in Wellampitiya's streets at ~131 mm with Nagalagam Street at 3.0 ft (below
  // alert) while the town read "Keep an eye on it". Backtest of the rule: "likely" caught 11 of 16 recorded floods with ~1.3
  // unmatched alarms a year. Only towns with a satellite rain zone have streetRain, so river towns are unaffected.
  const streetLikely = lowSpot?.level === "likely";
  const streetRaised = streetLikely && (tone == null || rank("alert") > rank(tone));
  if (streetLikely) tone = maxTone(tone, "alert");
  const baseTone: Tone = tone ?? "stale";

  // ---- reasons (most important first)
  if (warning && floor) {
    reasons.push({ kind: "official", key: "r.official", vars: { source: warning.source, area: warning.area }, warn: warnRaised });
  }
  if (personalReason) reasons.push(personalReason);
  if (sriver) {
    reasons.push({ kind: "river", key: "r.streetRiver", vars: { gauge: sriver.gauge, level: sriver.level }, warn: true });
  }
  if (streetLikely && lowSpot) {
    reasons.push({ kind: "rain", key: "r.streetLikely", vars: { mm: lowSpot.mm }, warn: streetRaised });
  }
  if (gauge) {
    const tt = tierTone(gauge.tier);
    reasons.push({
      kind: "river",
      key: tt ? "r.river" : "r.riverNoMarks",
      vars: {
        river: gauge.basin.trim(),
        gauge: gauge.name,
        level: fmtLevel(gauge.level!, gauge.unit),
        dir: `w.${trend === "up" ? (rate! >= 0.05 ? "rising" : "slow") : trend === "down" ? "falling" : "steady"}`,
        ...(tt ? { tier: `t.${tt}` } : {}),
      },
      warn: tt != null && rank(tt) >= rank("watch"),
    });
  } else {
    const ref = [input.primary, input.secondary].find((x) => x && x.km <= FAR_GAUGE_KM) ?? null;
    if (ref) reasons.push({ kind: "nogauge", key: ref.tier === "none" ? "r.noMarks" : "r.noGauge", vars: { gauge: ref.name }, warn: false });
  }
  if (forecastReason) reasons.push(forecastReason);
  if (rain) {
    const r6p = rain.past6hMm, r6n = rain.next6hMm, r24p = rain.past24hMm, r24n = rain.next24hMm;
    // the single most telling rain line: a heavy one if there is one, else the biggest notable one
    const cands: { key: string; mm: number; h: number; heavy: boolean }[] = [
      { key: "Past", mm: r6p, h: 6, heavy: r6p >= HEAVY_MM_6H },
      { key: "Next", mm: r6n, h: 6, heavy: r6n >= HEAVY_MM_6H },
      { key: "Past", mm: r24p, h: 24, heavy: r24p >= HEAVY_MM_24H },
      { key: "Next", mm: r24n, h: 24, heavy: r24n >= HEAVY_MM_24H },
    ];
    const heavies = cands.filter((c) => c.heavy).sort((a, b) => b.mm - a.mm);
    const notable = cands.filter((c) => c.mm >= (c.h === 6 ? NOTABLE_MM_6H : NOTABLE_MM_24H)).sort((a, b) => b.mm - a.mm);
    const pick = heavies[0] ?? notable[0];
    if (pick) {
      reasons.push({
        kind: "rain",
        key: `r.rain${pick.key}${pick.heavy ? "Heavy" : ""}`,
        vars: { mm: r1(pick.mm), h: pick.h },
        warn: pick.heavy,
      });
    }
    // when the headline is a 24 h total, also say what the other half of the day looks like (fell AND more coming)
    if (pick && pick.h === 24) {
      const other = cands.find((c) => c.h === 24 && c.key !== pick.key && c.mm >= NOTABLE_MM_24H);
      if (other) reasons.push({ kind: "rain", key: `r.rain${other.key}${other.heavy ? "Heavy" : ""}`, vars: { mm: r1(other.mm), h: 24 }, warn: other.heavy });
    }
    const p90 = rain.next24hP90Mm;
    if (!heavy && p90 != null && p90 >= HEAVY_MM_24H) {
      reasons.push({ kind: "rain", key: "r.rainP90", vars: { mm: r1(p90) }, warn: false });
    }
    if (rainRaised) reasons.push({ kind: "rain", key: "r.rainRaised", vars: {}, warn: true });
  }
  if (mh) reasons.push({ kind: "rain", key: mh.local ? "r.rainMeasuredLocal" : "r.rainMeasured", vars: { mm: mh.mm, h: mh.hours, gauge: mh.gaugeName }, warn: measuredRaised });
  if (drainage === "canal-backwater" && tone != null && rank(tone) >= rank("watch")) {
    reasons.push({ kind: "canal", key: "r.canal", vars: {}, warn: false });
  }
  if (release && drainage !== "upland") {
    if (release.confirmed && release.cusecs == null) {
      reasons.push({ kind: "release", key: "r.releaseNoFigure", vars: { res: release.reservoir }, warn: rising });
    } else if (release.confirmed && release.cusecs != null) {
      const withEta = release.etaHours != null && gauge;
      reasons.push({
        kind: "release",
        key: withEta ? "r.releaseEta" : "r.release",
        vars: { res: release.reservoir, cusecs: Math.round(release.cusecs).toLocaleString("en-US"), ...(withEta ? { gauge: gauge!.name, h: Math.max(1, Math.round(release.etaHours!)) } : {}) },
        warn: rising,
      });
    } else if (!release.confirmed) {
      reasons.push({ kind: "release", key: "r.releaseNews", vars: { res: release.reservoir }, warn: false });
    }
  }
  if (reasons.length === 0 || (tone === "normal" && !reasons.some((r) => r.warn))) {
    if (gauge && tone === "normal") {
      // replace the lone river line with the calmer sentence only when nothing else is notable
      if (rain && reasons.every((r) => r.kind === "river")) {
        reasons.splice(0, reasons.length, { kind: "calm", key: "r.calm", vars: { river: gauge.basin.trim() }, warn: false });
      }
    }
  }

  // ---- next hour / next 24 hours
  let hourM: number | null = null;
  if (gauge && forecast && forecast.h1Level != null && forecast.currentLevel != null) hourM = (forecast.h1Level - forecast.currentLevel) * forecast.metresPerUnit;
  else if (rate != null) hourM = rate;
  const hourKey: TownRisk["hourKey"] =
    hourM == null ? "dir.unknown" : Math.abs(hourM) < RISING_M_PER_H ? "dir.steady" : hourM < 0 ? "dir.falling" : gauge && isTidalStation(gauge.station) && !liftRising ? "dir.tide" : hourM < 0.05 ? "dir.slow" : "dir.rising";

  let day: TownRisk["day"] = { key: "n24.unknown", vars: {} };
  if (gauge || tone != null) {
    // heavy rain still to come (not merely fallen): the headline for the day ahead
    const heavyAhead = !!rain && (rain.next6hMm >= HEAVY_MM_6H || rain.next24hMm >= HEAVY_MM_24H);
    if (riverStreetDrives && !(forecastReason && forecastReason.key.startsWith("r.forecast"))) {
      day = { key: "n24.street", vars: {} };
    } else if (forecastReason && forecastReason.key.startsWith("r.forecast")) {
      day = { key: forecastReason.key.replace("r.forecast", "n24.reach"), vars: "h" in forecastReason.vars ? { h: forecastReason.vars.h } : {} };
    } else if (heavyAhead && rain) {
      day = { key: "n24.rain", vars: { mm: r1(rain.next24hMm) } };
    } else if (rain && rain.next24hP90Mm != null && rain.next24hP90Mm >= HEAVY_MM_24H) {
      day = { key: "n24.rainPossible", vars: { mm: r1(rain.next24hP90Mm) } };
    } else if (tone && rank(tone) >= rank("alert")) {
      day = { key: "n24.stay", vars: {} };
    } else if (tone === "watch") {
      day = { key: "n24.watch", vars: {} };
    } else if (tone === "normal") {
      // no rain feed: say so rather than promise a dry day
      day = rain ? { key: "n24.none", vars: {} } : { key: "n24.riverOnly", vars: {} };
    }
  }

  const final: Tone = tone ?? "stale";
  return {
    tone: final,
    baseTone,
    riverTone: river,
    gauge,
    heavyRain: heavy,
    rainRaised,
    lowSpot,
    trend,
    reasons,
    hourKey: gauge ? hourKey : "dir.unknown",
    day,
    actionKey: final === "alert" ? "a.alert" : final === "minor" ? "a.minor" : final === "major" ? "a.major" : null,
  };
}
