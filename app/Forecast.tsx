import { releaseAffecting } from "@/lib/releases";
import { officialReleaseAlert, releaseAlertLine } from "@/lib/releaseAlert";
import { TimeAgo } from "./TimeAgo";
import { ClampedText } from "./ClampedText";
import { CloudRain, TriangleAlert } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { loadForecast, type Forecast as ForecastT } from "@/lib/forecast";
import { getAdvisory } from "@/lib/advisory";
import { DISTRICT_BY_STATION } from "@/lib/districts";
import { getGsmapForStation, GSMAP_CREDIT } from "@/lib/gsmap";
import { heaviestUpstream, measuredAtGauge } from "@/lib/stationRain";
import { noRainSensor } from "@/lib/rainSensors";
import { forThisRiver, rainWord, reachesTrigger, satelliteCaveat } from "@/lib/rainWords";
import { rainTriggersFor } from "@/lib/rainTriggers";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";
import { contactsForDistrict } from "@/lib/help";
import { statusFor } from "@/lib/status";
import { formatDelta, formatLevel, publishedAs, shownNumber } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import { stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { clock, riverName, shortStamp } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";
import { AdvisoryText, VerdictCard, type T3, type VerdictTone } from "./ShareButton";
import Link from "next/link";
import { PLACES } from "@/lib/places";
import { fallSummary, heavyRainAround, nearRain24hClipped, riseSummary, townsNear } from "@/lib/levelNotes";
import { CALL, FALL_NOTE, ROSE_NOTE, STEADY_M_PER_H, STREET_RAIN_NOTE, STREET_RAIN_TOWNS, VERDICT, directionFor, hourReason, withReason } from "./verdict";
import { chanceWords, isTidalStation, liftVerdict, riverRising } from "@/lib/verdictLift";
import { fallingOutlook, nextHourRateM } from "@/lib/forecastRules.mjs";

const HOUR = 3_600_000;
const mm = (v: number | null) => (v == null ? "—" : v < 10 ? v.toFixed(1) : String(Math.round(v)));

export const ACTION: Partial<Record<VerdictTone, T3>> = {
  alert: { en: "Move valuables up, charge your phone", si: "ඔබේ භාණ්ඩ ඉහළට ගෙන යන්න, දුරකථනය චාජ් කරන්න", ta: "உடைமைகளை உயரத்தில் வையுங்கள், தொலைபேசியை சார்ஜ் செய்யுங்கள்" },
  minor: { en: "Leave low areas near the river", si: "ගඟ අසල පහත් ප්‍රදේශවලින් ඉවත් වන්න", ta: "ஆற்றருகே தாழ்வான பகுதிகளிலிருந்து வெளியேறுங்கள்" },
  major: { en: "Move to safety. Follow official instructions", si: "ආරක්ෂිත ස්ථානයකට යන්න. නිල උපදෙස් අනුගමනය කරන්න", ta: "பாதுகாப்பான இடத்திற்குச் செல்லுங்கள். அதிகாரப்பூர்வ அறிவுறுத்தல்களைப் பின்பற்றுங்கள்" },
};
const ORDER = ["normal", "watch", "alert", "minor", "major"] as const;

function hoursPhrase(n: number): T3 {
  return n <= 1
    ? { en: "~1 hour", si: "පැයක් පමණ", ta: "சுமார் 1 மணி நேரம்" }
    : { en: `~${n} hours`, si: `පැය ${n}ක් පමණ`, ta: `சுமார் ${n} மணி நேரம்` };
}

/** One forecast fact, or null. Never numbers beyond the ETA, never probabilities. */
// Render time for the live age label (outside the component so render stays pure).
const renderedAt = () => Date.now();

export function forecastFact(f: ForecastT, tier: string, now: number): { fact: T3 | null; target: number; likely?: boolean } {
  const c = f.crossings
    .filter((x) => x.wording === "likely" || x.wording === "possible")
    .sort((a, b) => (a.etaTs ?? Infinity) - (b.etaTs ?? Infinity))[0];
  if (c) {
    const flood = c.threshold !== "alert";
    const lvl = flood
      ? { en: "flood level", si: "ගංවතුර මට්ටම", ta: "வெள்ள மட்டத்தை" }
      : { en: "alert level", si: "අනතුරු ඇඟවීමේ මට්ටම", ta: "எச்சரிக்கை மட்டத்தை" };
    const target = ORDER.indexOf(c.threshold);
    const likely = c.wording === "likely";
    if (c.etaTs != null) {
      const n = Math.max(1, Math.round((c.etaTs - now) / HOUR));
      const h = hoursPhrase(n);
      // Visitors ask "will it go on to minor flood?" (Badalgama, 26 Oct 2026): when the first mark ahead is Alert and the forecast
      // also puts the flood level (minor) within 24 h, say so in the same line, later than the alert time. A note only: the step stays official.
      const m = c.threshold === "alert" ? f.crossings.find((x) => x.threshold === "minor" && (x.wording === "likely" || x.wording === "possible") && x.etaTs != null && x.etaTs > (c.etaTs as number)) : null;
      if (m) {
        const hm = hoursPhrase(Math.max(n, Math.round(((m.etaTs as number) - now) / HOUR)));
        const maybe = m.wording === "possible";
        return {
          target,
          likely,
          fact: {
            en: `Could reach ${lvl.en} in ${h.en} (${maybe ? "possibly " : ""}flood level in ${hm.en})`,
            si: `${h.si} ඇතුළත ${lvl.si}ට ළඟා විය හැක (${maybe ? "සමහරවිට " : ""}${hm.si} ඇතුළත ගංවතුර මට්ටමට)`,
            ta: `${h.ta}ில் ${lvl.ta} எட்டலாம் (${maybe ? "ஒருவேளை " : ""}${hm.ta}ில் வெள்ள மட்டம்)`,
          },
        };
      }
      return {
        target,
        likely,
        fact: {
          en: `Could reach ${lvl.en} in ${h.en}`,
          si: `${h.si} ඇතුළත ${lvl.si}ට ළඟා විය හැක`,
          ta: `${h.ta}ில் ${lvl.ta} எட்டலாம்`,
        },
      };
    }
    return {
      target,
      likely,
      fact: {
        en: `Could reach ${lvl.en} within 24 hours`,
        si: `පැය 24ක් ඇතුළත ${lvl.si}ට ළඟා විය හැක`,
        ta: `24 மணி நேரத்தில் ${lvl.ta} எட்டலாம்`,
      },
    };
  }
  // A fast tributary shows its model only to 6 hours (lib/forecastRules.mjs): no "no flooding expected today" from a 12 / 24 h model step.
  if (f.method === "model" && f.status !== "unavailable" && f.horizonLimitH != null) {
    return { target: -1, fact: noEstimateBeyond(f.horizonLimitH) };
  }
  if (f.method === "model" && f.status === "ok" && (tier === "normal" || tier === "watch")) {
    return {
      target: -1,
      fact: { en: "No flooding expected today", si: "අද ගංවතුර අපේක්ෂා නොකෙරේ", ta: "இன்று வெள்ளம் எதிர்பார்க்கப்படவில்லை" },
    };
  }
  if (f.method === "trend" && tier === "watch") {
    return { target: -1, fact: { en: "Close to alert level", si: "අනතුරු ඇඟවීමේ මට්ටමට ආසන්නයි", ta: "எச்சரிக்கை மட்டத்திற்கு அருகில்" } };
  }
  return { fact: null, target: -1 };
}

/** A gauge whose readings are unusable (lib/forecastRules.mjs NO_FORECAST_GAUGES): the card shows the level and the step and says so. si / ta: DRAFT translations. */
export const NO_FORECAST_FACT: T3 = { en: "No forecast for this gauge", si: "මෙම මානය සඳහා පුරෝකථනයක් නැත", ta: "இந்த அளவிக்கு முன்னறிவிப்பு இல்லை" };

/** "Next 24 hours" for a fast river whose model is only shown to `h` hours. si / ta: DRAFT translations. */
export const noEstimateBeyond = (h: number): T3 => ({
  en: `No estimate beyond ${h} hours for this fast river`,
  si: `මෙම වේගවත් ගඟ සඳහා පැය ${h}ට පසු ඇස්තමේන්තුවක් නැත`,
  ta: `இந்த வேகமான ஆற்றுக்கு ${h} மணி நேரத்துக்கு மேல் மதிப்பீடு இல்லை`,
});

/** "Falling now" / "Falling; expected to keep dropping": the day line for a river that fell over the last 3 h (lib/forecastRules.mjs fallingOutlook). si / ta: DRAFT translations. */
export const FALLING_DAY: Record<"now" | "keeps", T3> = {
  now: { en: "Falling now", si: "දැන් පහළ යයි", ta: "இப்போது குறைகிறது" },
  keeps: { en: "Falling; expected to keep dropping", si: "පහළ යයි; තවදුරටත් පහළ යනු ඇතැයි අපේක්ෂා කෙරේ", ta: "குறைகிறது; தொடர்ந்து குறையும் என எதிர்பார்க்கப்படுகிறது" },
};

/**
 * The "Next 24 hours" line of a gauge's card: the ONE place it is built (the gauge page and the forecast embed both call it).
 * Order: no forecast for this gauge, a small-chance crossing, a crossing the forecast states, then (Alert or above, falling over the last
 * 3 h) "Falling now" instead of any steady wording, then the forecast's own fact, then "No estimate yet".
 */
export function dayFact(o: {
  f: ForecastT;
  /** The gauge's own tier (not lifted). */
  tier: string;
  now: number;
  lift: { why: string | null; crossing: { threshold: string } | null; etaHours: number | null } | null;
  /** Last 3 h rate, metres per hour. */
  rate3hM: number | null;
  mpu: number;
  tidal: boolean;
}): T3 {
  const { f } = o;
  if (f.noForecast) return NO_FORECAST_FACT;
  const heavier = f.rainRisk != null || f.stormHorizons.length > 0;
  if (o.lift?.why === "small" && o.lift.crossing) return smallChanceFact(o.lift.crossing, o.lift.etaHours, heavier);
  const { fact, target } = forecastFact(f, o.tier, o.now);
  const elevated = o.tier === "alert" || o.tier === "minor" || o.tier === "major";
  if (target < 0 && elevated) {
    const fall = fallingOutlook({ rate3hM: o.rate3hM, level: f.currentLevel, horizons: o.tidal ? [] : f.horizons, mpu: o.mpu });
    if (fall) return FALLING_DAY[fall];
  }
  return fact ?? { en: "No estimate yet", si: "තවම ඇස්තමේන්තුවක් නැත", ta: "இன்னும் மதிப்பீடு இல்லை" };
}

export const TIDE_RISE: T3 = {
  en: "Rising with the tide (about the same once the tide is allowed for)",
  si: "වඩින මුහුදු රැළි සමඟ ඉහළ යයි (රැළි සලකා බැලූ විට පාහේ එලෙසමයි)",
  ta: "அலையுடன் உயர்கிறது (அலையைக் கணக்கிட்டால் ஏறக்குறைய அதே அளவு)",
};

/** The calm "small chance" line for a crossing the verdict rule did not lift (lib/verdictLift.ts). */
export function smallChanceFact(c: { threshold: string }, hours: number | null, heavier: boolean): T3 {
  const flood = c.threshold !== "alert";
  const lvl = flood
    ? { en: "flood level", si: "ගංවතුර මට්ටමට", ta: "வெள்ள மட்டத்தை" }
    : { en: "alert level", si: "අනතුරු ඇඟවීමේ මට්ටමට", ta: "எச்சரிக்கை மட்டத்தை" };
  const h = hours != null ? hoursPhrase(hours) : null;
  const rain = heavier
    ? { en: " (if the heavier rain comes)", si: " (වැසි වැඩි වුවහොත්)", ta: " (கனமழை வந்தால்)" }
    : { en: "", si: "", ta: "" };
  return {
    en: `Small chance of ${lvl.en} ${h ? `in ${h.en}` : "within 24 hours"}${rain.en}`,
    si: `${h ? `${h.si} ඇතුළත` : "පැය 24ක් ඇතුළත"} ${lvl.si} ළඟා වීමට ඇත්තේ සුළු ඉඩකි${rain.si}`,
    ta: `${h ? `${h.ta}ில்` : "24 மணி நேரத்தில்"} ${lvl.ta} எட்டுவதற்கான வாய்ப்பு சிறியது${rain.ta}`,
  };
}

export async function Forecast({ lang, basin, selectedStation }: { lang: Locale; basin: string; selectedStation: string }) {
  if (!basin) return null;
  const { t, p } = getI18n(lang);
  const fmtTime = (ts: number) => clock(ts, t);
  const warningsP = getOfficialWarnings(); // fails soft, never throws
  const snapshot = await fetchBasinSnapshot(basin);
  if (snapshot.length === 0) return null;
  const f = await loadForecast(basin, snapshot, selectedStation);
  const me = snapshot.find((s) => s.station === selectedStation);
  const district = DISTRICT_BY_STATION[selectedStation] ?? null;
  const latest = me?.latest ?? null;
  const status = statusFor(latest?.water_level ?? null, me?.thresholds ?? { alert: null, minor: null, major: null }, latest?.ts);
  const realTier = status.tier;
  const [advisory, warnings, release, sat] = await Promise.all([
    getAdvisory({ station: selectedStation, river: basin.trim(), district, tier: realTier, forecast: f }),
    warningsP.then((w) => warningsForBasin(w, basin, [selectedStation])),
    releaseAffecting(selectedStation).catch(() => ({ active: false, confirmed: false, cusecs: null, reservoir: null }) as const),
    getGsmapForStation(basin, selectedStation),
  ]);

  const stale = realTier === "stale";
  const now = f.asOfTs ?? latest?.ts ?? 0;

  // "Next hour": the forecast's 1 h change when there is one (metres, unit-aware),
  // otherwise the recent 3 h rate as a persistence guess.
  const h1 = f.horizons.find((h) => h.h === 1);
  const mpu = me?.metresPerUnit ?? 1;
  // RiverNet / HMIS-only gauges have no model: the tile reads the measured 3 h rate, like the sentence at the top of the page (lib/forecastRules.mjs)
  const r = stale
    ? null
    : nextHourRateM({ h1ChangeM: h1 && f.currentLevel != null ? (h1.level - f.currentLevel) * mpu : null, rate3hM: me?.rate3hM ?? null, source: me?.source, method: f.method });
  // "Rising" means the river is rising: on a tidal gauge (Nagalagam Street...) the twice-daily tide moves the level by
  // 0.6-0.8 ft, so it is judged against the level one tide cycle ago (lib/verdictLift.ts), and a tide-only rise is said so.
  const tidal = isTidalStation(selectedStation);
  const rising = !stale && riverRising(selectedStation, me?.trend24h, mpu, me?.rate3hM ?? null);
  const tideOnly = tidal && !stale && r != null && r > STEADY_M_PER_H && !rising;
  const noFc = !!f.noForecast && !stale;
  const direction: T3 | null = noFc
    ? null
    : stale
    ? latest && me?.ageMin != null
      ? (() => {
          const h = Math.max(1, Math.round(me.ageMin / 60));
          return { en: `Last reading ${h} h ago`, si: `අවසන් කියවීම පැය ${h}කට පෙර`, ta: `கடைசி அளவீடு ${h} மணி நேரத்திற்கு முன்` };
        })()
      : { en: "No recent reading", si: "මෑත කියවීමක් නැත", ta: "சமீபத்திய அளவீடு இல்லை" }
    : r == null
      ? null
      : tideOnly
        ? TIDE_RISE
        : withReason(
            directionFor(r),
            hourReason({
              kind: Math.abs(r) < STEADY_M_PER_H ? "steady" : r < 0 ? "falling" : "rising",
              delta3hM: me?.rate3hM != null ? me.rate3hM * 3 : null,
              unit: me?.unit ?? null,
              upstreamPerH: f.signals.upstreamRatePerH,
              heavyRain: f.rain == null && f.rainRisk == null ? null : f.rainRisk != null || f.stormHorizons.length > 0,
              lowRain: f.rain?.past6hMm != null && f.rain.past6hMm < 10,
              release: release.active,
            }),
          );
  // A confirmed reservoir release upstream counts as an expected crossing only when
  // the gauge is already close to alert (within 1 m, or 20% of the alert level) and
  // rising: a release far below alert, or on a falling river, stays informational
  // (the release card above the verdict still shows it).
  const alertLvl = me?.thresholds.alert ?? null;
  const lvlNow = latest?.water_level ?? null;
  const gapM = alertLvl != null && lvlNow != null ? (alertLvl - lvlNow) * mpu : null;
  const nearAlert = gapM != null && gapM > 0 && (gapM <= 1 || gapM <= alertLvl! * mpu * 0.2);
  const releaseLift = !stale && rising && nearAlert && release.active && release.confirmed;
  // One rule for "Get ready" from a forecast crossing (lib/verdictLift.ts); real readings always win.
  const lift = stale
    ? null
    : liftVerdict({ tier: realTier, crossings: f.crossings, horizons: f.horizons, currentLevel: f.currentLevel, rising, now });
  // A confirmed release of 5,000+ cusecs by the Irrigation Department's own figures, directly above this gauge, is at least Alert
  // (lib/releaseAlert.ts; 26 Oct 2026: Moragaswewa read Normal at 14.9 ft while Deduru Oya spilled 10,400 cusecs through 8 gates).
  const releaseAlert = !stale && (realTier === "normal" || realTier === "watch") ? officialReleaseAlert(release) : null;
  const tone: VerdictTone = stale
    ? "stale"
    : releaseAlert
      ? "alert"
      : lift?.verdict === "alert" && (realTier === "normal" || realTier === "watch")
      ? "alert"
      : // a forecast crossing or a confirmed release upstream: "Keep an eye on it" at most; Get ready is the alert level itself (26 Oct 2026)
        (lift?.verdict === "watch" || releaseLift) && realTier === "normal"
        ? "watch"
        : realTier;
  // "Next 24 hours" always has an answer when the gauge is live, even if it's "no estimate".
  const fact: T3 | null = stale ? null : dayFact({ f, tier: realTier, now, lift, rate3hM: me?.rate3hM ?? null, mpu, tidal });

  const elevated = tone === "alert" || tone === "minor" || tone === "major";
  const dc = elevated ? contactsForDistrict(district) : null;
  const name = stationDisplayName(selectedStation);
  const unit = me?.unit ?? null;
  const level = latest?.water_level ?? null;
  // "Reading at 11:10 am · 55 min ago": the time the gauge measured, plus a live age,
  // so a cached page can't pass off an hour-old reading as fresh.
  const footer = latest ? (
    <>
      {t("common.readingAt", { time: clock(latest.ts, t) })} · <TimeAgo ts={latest.ts} serverNow={renderedAt()} />
    </>
  ) : me?.lastSeenTs ? (
    t("common.lastReadingAt", { when: shortStamp(me.lastSeenTs, t) })
  ) : (
    t("common.noReading")
  );
  const levelText = level != null ? formatLevel(level, unit) : null;
  const rn = riverName(basin, lang);
  // A near-alert gauge, or a calm one the forecast or a release points at, still reads "Normal": the reason is the small note
  // under it (owner, 26 Oct 2026: the verdict ladder is the Department's four steps only).
  const nearNote: string | null = releaseAlert
    ? releaseAlertLine(releaseAlert, lang)
    : tone !== "watch" || !me
      ? null
      : realTier === "watch" && alertLvl != null && lvlNow != null
        ? t("needs.nearNote", { amount: formatDelta(alertLvl - lvlNow, unit) }) + (rising ? `, ${t("trend.rising").toLowerCase()}` : "")
        : fact && lift?.verdict === "watch"
          ? fact[lang]
          : releaseLift
            ? ({ en: "A reservoir release upstream is confirmed", si: "ඉහළ ජලාශයකින් ජලය මුදාහැරීම තහවුරුයි", ta: "மேலே உள்ள நீர்த்தேக்கத்திலிருந்து நீர் திறப்பு உறுதி" } as T3)[lang]
            : null;
  const shareText = stale
    ? t("share.stale", { name, river: rn, last: level != null ? t("share.staleLast", { level: formatLevel(level, unit) }) : "" })
    : t("share.live", {
        name,
        river: rn,
        level: formatLevel(level, unit),
        verdict: VERDICT[tone][lang],
        dir: direction ? `, ${direction[lang].toLowerCase()}` : "",
        time: latest ? clock(latest.ts, t) : "",
      });

  const w = warnings[0];
  const fu = f.unit ? " ft" : "";
  // Metre gauges are shown in feet; the official figures stay one line away so bulletins can be matched.
  const pubLevel = publishedAs(level, unit);
  const pubMarks = me
    ? (["alert", "minor", "major"] as const)
        .filter((k) => me.thresholds[k] != null && me.thresholds[k]! > 0)
        .map((k) => `${t(`mark.${k}` as "mark.alert").toLowerCase()} ${publishedAs(me.thresholds[k], unit, 1)}`)
        .join(", ")
    : "";
  // Rain, three sources kept apart (lib/stationRain.ts): what THIS gauge's sensor measured, the satellite estimate, the weather-model forecast.
  const nowMs = renderedAt();
  const sensor = !noRainSensor(selectedStation);
  const fell = me ? measuredAtGauge(selectedStation, me.trend24h, nowMs) : null;
  const upRain = !sensor && me ? heaviestUpstream(snapshot, basin, selectedStation, nowMs) : null;
  const trig = rainTriggersFor(selectedStation);
  const localHeavy = fell ? forThisRiver(reachesTrigger("3h", fell.mm3h, trig) || reachesTrigger("24h", fell.mm24h, trig), trig, lang) : "";
  const fellWord = fell?.mm24h != null && fell.mm24h >= 0.2 ? rainWord("24h", fell.mm24h, lang) : null;
  const fcMm = f.rain?.next24hMm.det ?? null;
  const fcWord = fcMm != null ? rainWord("24h", fcMm, lang) : null;
  const hasRain = f.signals.rainContributors.length > 0;

  // Three small notes (lib/levelNotes.ts), never part of the step, colour, sticky bar or push. They read the same "next hour" rate `r` as the
  // direction tile, so the page never says rising in one place and falling in another. Tidal gauges: a tide swing is not a river rise.
  const series = me?.trend24h ?? null;
  const moreNotes: React.ReactNode[] = [];
  if (!stale && me && unit != null && !(tidal && !rising)) {
    // 1. "Rose 7.9 ft in the last 9 hours": a big climb, unless the next hour says it is falling now
    const rise = r == null || r > -STEADY_M_PER_H ? riseSummary(series, mpu) : null;
    // 2. "Falling: down 1.2 ft since the peak at 3:40 pm": still Alert or above, clearly falling, and the next hour agrees
    const fall = elevated && r != null && r < -STEADY_M_PER_H ? fallSummary(series, mpu) : null;
    if (rise) moreNotes.push(ROSE_NOTE(formatDelta(rise.riseM / mpu, unit), rise.hours)[lang]);
    if (fall) moreNotes.push(FALL_NOTE(formatDelta(fall.dropM / mpu, unit), clock(fall.peakTs, t))[lang]);
  }
  // 3. "River normal, but street water is possible here": heavy satellite or measured rain around a gauge that is below Alert (Katuneriya,
  // 26 Oct 2026: ~139 mm of satellite rain, river gauge under the alert mark). Same heavy-rain marks as the town pages.
  if (!stale && me && (tone === "normal" || tone === "watch") && (realTier === "normal" || realTier === "watch")) {
    const heavyHere = heavyRainAround({
      catch6h: sat?.mm6h ?? null,
      catch24h: sat?.mm24h ?? null,
      near24hClipped: nearRain24hClipped(sat?.hourlyNear),
      measuredHeavy: !!fell && (reachesTrigger("3h", fell.mm3h, trig) || reachesTrigger("24h", fell.mm24h, trig)),
    });
    if (heavyHere) {
      const towns = townsNear({ lat: me.latitude, lon: me.longitude }, PLACES, 15, 2);
      moreNotes.push(
        <>
          {STREET_RAIN_NOTE[lang]}
          {towns.length > 0 && (
            <>
              . {STREET_RAIN_TOWNS[lang]}{" "}
              {towns.map((x, i) => (
                <span key={x.slug}>
                  {i > 0 && ", "}
                  <Link href={p(`/flood/${x.slug}`)} className="underline underline-offset-2 hover:no-underline">{x.name}</Link>
                </span>
              ))}
            </>
          )}
        </>,
      );
    }
  }
  return (
    <section data-forecast-method={f.method}>
      {w && (
        <div
          data-official-warning
          className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-sm text-amber-950 dark:text-amber-100"
        >
          <TriangleAlert className="size-4 shrink-0 mt-0.5" aria-hidden />
          <span className="min-w-0">
            <span className="block font-semibold">{t("common.officialWarning")}</span>
            <ClampedText
              footer={
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline inline-flex items-center min-h-11 sm:min-h-6 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {w.source}
                </a>
              }
            >
              {w.summary}{lang !== "en" && <span className="opacity-80"> {t("common.englishNote")}</span>}
            </ClampedText>
          </span>
        </div>
      )}

      <VerdictCard
        tone={tone}
        verdict={VERDICT[tone]}
        direction={direction}
        fact={fact}
        tide={tideOnly}
        factKind={!stale && fact && fact.en === "No flooding expected today" ? "ok" : "soon"}
        labels={
          stale || noFc
            ? undefined
            : {
                direction: { en: "Next hour:", si: "ඊළඟ පැය:", ta: "அடுத்த மணி நேரம்:" },
                fact: { en: "Next 24 hours:", si: "ඉදිරි පැය 24:", ta: "அடுத்த 24 மணி நேரம்:" },
              }
        }
        action={stale ? null : (ACTION[tone] ?? null)}
        outlook={
          stale
            ? null
            : {
                trend: r == null ? "unknown" : tideOnly || Math.abs(r) < STEADY_M_PER_H ? "steady" : r < 0 ? "down" : "up",
                text: (
                  <AdvisoryText
                    en={advisory.en}
                    si={advisory.si}
                    ta={advisory.ta}
                    experimental={f.experimental && f.method === "model"}
                    source={advisory.source}
                  />
                ),
              }
        }
        call={elevated ? CALL : null}
        office={dc ? { label: t("common.callDmcOffice", { district: dc.district }), tel: dc.tel } : null}
        footer={footer}
        level={levelText}
        levelInfo={levelText ? t("level.info", { level: levelText, gauge: name }) : null}
        gauge={
          !stale && level != null && me
            ? { tone, level, next24: f.horizons.find((h) => h.h === 24)?.level ?? null, unit, thresholds: me.thresholds }
            : null
        }
        share={{ href: p(stationPath(basin, selectedStation)), name: `${name} (${rn})`, text: shareText }}
        note={nearNote}
        moreNotes={moreNotes}
      >
        <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3 text-xs sm:text-sm text-slate-700 dark:text-slate-300" data-forecast-headline>
          <p className="font-medium">{f.headline}</p>
          {pubLevel && (
            <p data-published-as className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t("unit.publishedAs", { v: pubLevel })}
              {pubMarks ? ` (${pubMarks})` : ""}
            </p>
          )}
          {f.outlook === "elevated" && (
              <p className="mb-2 text-orange-700 dark:text-orange-400">{t("fc.elevated")}</p>
            )}
            {f.horizons.length > 0 && (
              <table className="text-xs tabular-nums w-full max-w-md">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="font-normal pb-1">{t("fc.in")}</th>
                    <th className="font-normal pb-1">{t("fc.level")}</th>
                    <th className="font-normal pb-1">{t("fc.range80")}</th>
                    <th className="font-normal pb-1">{t("fc.at")}</th>
                  </tr>
                </thead>
                <tbody>
                  {f.horizons.map((h) => (
                    <tr key={h.h}>
                      <td className="py-0.5">{h.h}h</td>
                      <td className="py-0.5 font-medium">{shownNumber(h.level, f.unit)}{fu}</td>
                      <td className="py-0.5">{h.low != null && h.high != null ? `${shownNumber(h.low, f.unit)} ${t("fc.to")} ${shownNumber(h.high, f.unit)}` : t("common.na")}</td>
                      <td className="py-0.5">{fmtTime(h.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {f.crossings.some((c) => c.wording !== "already") && (
              <ul className="mt-3 text-xs space-y-0.5">
                {f.crossings.filter((c) => c.wording !== "already").map((c) => (
                  <li key={c.threshold}>
                    {`${t(`mark.${c.threshold}` as "mark.alert")} (${formatLevel(c.level, f.unit)}): ${t(`fc.w.${c.wording}` as "fc.w.likely")}, ${chanceWords(c.probability)[lang]}${c.etaTs ? t("fc.crossingEta", { time: fmtTime(c.etaTs) }) : ""}`}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Cell label={t("fc.localTrend")}>{f.signals.localRatePerH != null ? `${formatDelta(f.signals.localRatePerH, f.unit, { sign: true })}/h` : "—"}</Cell>
              <Cell label={t("fc.upstreamAvg")}>
                {f.signals.upstreamRatePerH != null
                  ? `${formatDelta(f.signals.upstreamRatePerH, f.unit, { sign: true })}/h`
                  : f.signals.upstreamCount === 0 ? t("fc.upstreamTop") : "—"}
              </Cell>
            </div>
            <dl data-rain-rows className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">{t("fc.rainFell")}</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">
                  {!sensor
                    ? t("fc.rainNoSensor")
                    : fell
                      ? t("fc.rainFellGauge", { h3: mm(fell.mm3h), h24: mm(fell.mm24h), word: `${fellWord ? ` (${fellWord})` : ""}${localHeavy}` })
                      : t("fc.rainNoReading")}
                  {upRain && <span className="block font-normal text-slate-600 dark:text-slate-400">{t("fc.rainFellUp", { gauge: stationDisplayName(upRain.gauge), h3: mm(upRain.mm3h), h24: mm(upRain.mm24h) })}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">{t("fc.rainForecast")}</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">
                  {fcMm != null ? t("fc.rainForecastVal", { mm: mm(fcMm), word: fcWord ?? "" }) : <span className="font-normal">{t("fc.rainForecastNone")}</span>}
                </dd>
              </div>
            </dl>
            {sat && sat.mm6h != null && sat.mm24h != null && (
              <p data-satellite-rain className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                {t("fc.satRain", { h6: sat.mm6h.toFixed(1), h24: sat.mm24h.toFixed(1), time: clock(sat.endsAt, t) })}{" "}
                {satelliteCaveat(basin, lang)}{" "}
                <span className="text-slate-500 dark:text-slate-500">{GSMAP_CREDIT}</span>
              </p>
            )}
            {hasRain && f.signals.rainContributors.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <CloudRain className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                <span>{f.signals.rainContributors.slice(0, 4).join(" · ")}</span>
              </div>
            )}
            {f.notes.length > 0 && (
              <ul className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                {f.notes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            )}
            {f.basis.length > 0 && (
              <ul className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                <li className="font-medium">{t("fc.how")}</li>
                {f.basis.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            )}

        </div>
      </VerdictCard>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="tabular-nums font-medium text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  );
}
