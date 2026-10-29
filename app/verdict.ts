// Verdict phrases shared by the station verdict card (Forecast.tsx) and the home "Near you" card.
// Sinhala and Tamil are machine translations (the cards say so when they are shown).
import type { T3, VerdictTone } from "./ShareButton";
import type { Unit } from "@/lib/units";
import type { Forecast as ForecastT } from "@/lib/forecast";
import { STEADY_M_PER_H } from "../lib/forecastRules.mjs";

export const VERDICT: Record<VerdictTone, T3> = {
  normal: { en: "Normal", si: "සාමාන්‍යයි", ta: "இயல்பு" },
  watch: { en: "Normal", si: "සාමාන්‍යයි", ta: "இயல்பு" }, // internal tone only: shown as Normal, the reason goes in a note (owner, 26 Oct 2026)
  alert: { en: "Alert", si: "අනතුරු ඇඟවීම", ta: "எச்சரிக்கை" }, // the official Alert level's own word (owner, 26 Oct 2026; was "Get ready")
  minor: { en: "Minor flood", si: "සුළු ගංවතුර", ta: "சிறு வெள்ளம்" },
  major: { en: "Major flood", si: "ප්‍රධාන ගංවතුර", ta: "பெரு வெள்ளம்" },
  none: { en: "Level only", si: "මට්ටම පමණි", ta: "மட்டம் மட்டும்" }, // no flood marks published: the level and trend are shown, no step (28 Oct 2026)
  stale: { en: "Data delayed", si: "දත්ත ප්‍රමාදයි", ta: "தரவு தாமதம்" },
};

/** Official step Normal (or Watch shown as Normal) while the river is rising: the headline says so plainly (owner, 29 Oct 2026: Hanwella visitors answered "worse" 7 times on 26 Oct while the card said Normal as the river climbed). Words only: the step, tone and colour stay. si / ta: DRAFT translations. */
export const NORMAL_RISING: T3 = { en: "Normal now, rising", si: "දැන් සාමාන්‍යයි, ඉහළ යයි", ta: "இப்போது இயல்பு, உயர்கிறது" };
/** The line under NORMAL_RISING: how far the level is from Alert, already formatted in the gauge's unit ("1.5 ft"). si / ta: DRAFT translations. */
export const BELOW_ALERT_LEVEL = (amount: string): T3 => ({
  en: `${amount} below the alert level`,
  si: `අනතුරු ඇඟවීමේ මට්ටමට වඩා ${amount} පහළයි`,
  ta: `எச்சரிக்கை மட்டத்தை விட ${amount} கீழே`,
});

/** "Normal now, rising" only when the river is rising by the existing rule AND the card's own Next hour line says rising too (r = the tile's rate, metres per hour; a tide-only rise does not count): a headline never says rising beside a "steady" tile. */
export const headlineRising = (o: { rising: boolean; nextHourM: number | null; tideOnly?: boolean }): boolean =>
  o.rising && !o.tideOnly && o.nextHourM != null && o.nextHourM > STEADY_M_PER_H;

export const CALL: T3 = { en: "Call 117", si: "117 අමතන්න", ta: "117 ஐ அழைக்கவும்" };

export const DIR: Record<"fast" | "rising" | "slow" | "falling" | "steady", T3> = {
  fast: { en: "Rising fast", si: "වේගයෙන් ඉහළ යයි", ta: "வேகமாக உயர்கிறது" },
  rising: { en: "Rising", si: "ඉහළ යයි", ta: "உயர்கிறது" },
  slow: { en: "Rising slowly", si: "සෙමින් ඉහළ යයි", ta: "மெதுவாக உயர்கிறது" },
  falling: { en: "Falling", si: "පහළ යයි", ta: "குறைகிறது" },
  steady: { en: "Steady", si: "ස්ථාවරයි", ta: "மாற்றமில்லை" },
};

export const NEXT_HOUR: T3 = { en: "Next hour:", si: "ඊළඟ පැය:", ta: "அடுத்த மணி நேரம்:" };

// one threshold for the whole site: lib/forecastRules.mjs
export { STEADY_M_PER_H };
export const SLOW_M_PER_H = 0.05;
/** About 0.8 ft an hour: Hanwella climbed 14 -> 22 ft in 9 h and Deraniyagala 8 -> 13 ft in 2 h on 26 Oct 2026 while the card only said "Rising". */
export const FAST_M_PER_H = 0.25;

/** Direction phrase from a rate in metres per hour. */
export function directionFor(rateMPerH: number): T3 {
  return Math.abs(rateMPerH) < STEADY_M_PER_H
    ? DIR.steady
    : rateMPerH < 0
      ? DIR.falling
      : rateMPerH < SLOW_M_PER_H
        ? DIR.slow
        : rateMPerH >= FAST_M_PER_H
          ? DIR.fast
          : DIR.rising;
}

/**
 * The short reason under "Next hour" ("Down 0.4 ft in 3 hours; upstream is falling too"): the 3 h change plus the single strongest
 * driver we already hold. Same rate source as the tile, so it never contradicts the headline; a change that points the other way
 * from the headline (the forecast turns) is not quoted. A note only: never changes the step. si / ta: DRAFT translations.
 */
export function hourReason(o: {
  kind: "rising" | "falling" | "steady";
  /** Change over the last 3 h in metres (signed); null = unknown. */
  delta3hM: number | null;
  unit: Unit;
  /** Upstream gauges' rate, metres per hour (signed); null = none. */
  upstreamPerH?: number | null;
  /** true = heavy rain upstream or at the catchment; false = rain known and not heavy; null = unknown. */
  heavyRain: boolean | null;
  /** Rain measured over the last 6 h was light (only then may "little rain" be said). */
  lowRain?: boolean;
  release?: boolean;
}): T3 | null {
  const { kind, delta3hM: d, unit } = o;
  const ft = d != null && unit != null ? Math.abs(d) / 0.3048 : null;
  const sameWay = d == null || (kind === "rising" ? d > 0 : kind === "falling" ? d < 0 : true);
  const num = ft != null && ft >= 0.05 && sameWay ? `${ft.toFixed(ft < 0.1 ? 2 : 1)} ft` : null;
  const up = o.upstreamPerH ?? null;
  let lead: T3;
  if (kind === "steady") lead = { en: "Little change in the last 3 hours", si: "පසුගිය පැය 3 තුළ වෙනසක් අල්පයි", ta: "கடந்த 3 மணி நேரத்தில் சிறிய மாற்றம்" };
  else if (!sameWay) return null;
  else if (kind === "rising")
    lead = num
      ? { en: `Up ${num} in 3 hours`, si: `පැය 3කින් ${num}කින් ඉහළ ගොස් ඇත`, ta: `3 மணி நேரத்தில் ${num} உயர்ந்தது` }
      : { en: "Rising over the last 3 hours", si: "පසුගිය පැය 3 තුළ ඉහළ ගොස් ඇත", ta: "கடந்த 3 மணி நேரத்தில் உயர்ந்தது" };
  else
    lead = num
      ? { en: `Down ${num} in 3 hours`, si: `පැය 3කින් ${num}කින් පහත වැටී ඇත`, ta: `3 மணி நேரத்தில் ${num} குறைந்தது` }
      : { en: "Falling over the last 3 hours", si: "පසුගිය පැය 3 තුළ පහළ ගොස් ඇත", ta: "கடந்த 3 மணி நேரத்தில் குறைந்தது" };
  let clause: T3 | null = null;
  if (kind === "rising") {
    if (o.release) clause = { en: "reservoir release upstream", si: "උඩුගං ජලාශ මුදා හැරීම", ta: "மேலே நீர்த்தேக்க வெளியேற்றம்" };
    else if (o.heavyRain) clause = { en: "heavy rain upstream", si: "උඩුගං අධික වැසි", ta: "மேலே கனமழை" };
    else if (up != null && up > 0.03) clause = { en: "upstream gauges rising", si: "උඩුගං මාපක ඉහළ යයි", ta: "மேல்நிலை அளவீடுகள் உயர்கின்றன" };
  } else if (kind === "falling") {
    if (up != null && up < -0.03) clause = { en: "upstream is falling too", si: "උඩුගං ද පහළ යයි", ta: "மேல்நிலையும் குறைகிறது" };
    else if (o.heavyRain === false && o.lowRain) clause = { en: "little rain upstream", si: "උඩුගං වැසි අඩුයි", ta: "மேலே மழை குறைவு" };
  } else if (o.heavyRain === false && o.lowRain) clause = { en: "no heavy rain nearby", si: "අවට අධික වැසි නැත", ta: "அருகில் கனமழை இல்லை" };
  if (!clause) return lead;
  return { en: `${lead.en}; ${clause.en}`, si: `${lead.si}; ${clause.si}`, ta: `${lead.ta}; ${clause.ta}` };
}

/** Appends a reason as the tile's "(sub-line)" unless the text already has one (the tide line keeps its own). */
export function withReason(t: T3, reason: T3 | null): T3 {
  if (!reason) return t;
  const f = (x: string, r: string) => (/\)$/.test(x) ? x : `${x} (${r})`);
  return { en: f(t.en, reason.en), si: f(t.si, reason.si), ta: f(t.ta, reason.ta) };
}

// ---- Notes under the verdict (lib/levelNotes.ts). Notes only: they never change the step, colour, sticky bar or push.
// si / ta: DRAFT translations, not yet reviewed by a native speaker.
export const ROSE_NOTE = (delta: string, hours: number): T3 =>
  hours <= 1
    ? { en: `Rose ${delta} in the last hour`, si: `පසුගිය පැයේ ${delta}කින් ඉහළ ගියේය`, ta: `கடந்த 1 மணி நேரத்தில் ${delta} உயர்ந்தது` }
    : { en: `Rose ${delta} in the last ${hours} hours`, si: `පසුගිය පැය ${hours} තුළ ${delta}කින් ඉහළ ගියේය`, ta: `கடந்த ${hours} மணி நேரத்தில் ${delta} உயர்ந்தது` };
export const FALL_NOTE = (delta: string, time: string): T3 => ({
  en: `Falling: down ${delta} since the peak at ${time}`,
  si: `පහළ යයි: ${time} හි උච්චයේ සිට ${delta}කින් අඩු විය`,
  ta: `குறைகிறது: ${time} உச்சத்திலிருந்து ${delta} குறைந்தது`,
});
export const STREET_RAIN_NOTE: T3 = {
  en: "River is normal, but street water is possible here after the heavy rain nearby",
  si: "ගඟ සාමාන්‍යයි, නමුත් අවට අධික වැසි නිසා මෙහි වීදිවලට වතුර ඒමට ඉඩ ඇත",
  ta: "ஆறு இயல்பாக உள்ளது, ஆனால் அருகில் பெய்த கனமழையால் இங்கு தெருக்களில் நீர் தேங்கலாம்",
};
export const STREET_RAIN_TOWNS: T3 = { en: "Nearby towns:", si: "අවට නගර:", ta: "அருகிலுள்ள நகரங்கள்:" };

/** "Next 24 hours" for a fast river whose model is only shown to `h` hours. si / ta: DRAFT translations. */
export const noEstimateBeyond = (h: number): T3 => ({
  en: `No estimate beyond ${h} hours for this fast river`,
  si: `මෙම වේගවත් ගඟ සඳහා පැය ${h}ට පසු ඇස්තමේන්තුවක් නැත`,
  ta: `இந்த வேகமான ஆற்றுக்கு ${h} மணி நேரத்துக்கு மேல் மதிப்பீடு இல்லை`,
});


/** "Will it reach Minor flood?" one-line answers. si / ta: DRAFT translations. */
const MINOR_ALREADY: T3 = { en: "Already at Minor flood level", si: "දැනටමත් සුළු ගංවතුර මට්ටමේ", ta: "ஏற்கனவே சிறு வெள்ள மட்டத்தில்" };
const MINOR_NOT_EXPECTED: T3 = { en: "Minor flood not expected in the next 24 hours", si: "ඉදිරි පැය 24 තුළ සුළු ගංවතුරක් අපේක්ෂා නොකෙරේ", ta: "அடுத்த 24 மணி நேரத்தில் சிறு வெள்ளம் எதிர்பார்க்கப்படவில்லை" };
const minorPossible = (n: number): T3 => ({
  en: `Minor flood possible in the next 24 hours (up to ${n} in 10)`,
  si: `ඉදිරි පැය 24 තුළ සුළු ගංවතුරක් ඇතිවිය හැක (10 න් ${n}ක් දක්වා)`,
  ta: `அடுத்த 24 மணி நேரத்தில் சிறு வெள்ளம் ஏற்படலாம் (10 இல் ${n} வரை)`,
});

/**
 * The one-line answer to "Will it reach Minor flood?" under the "Next 24 hours" text of a gauge card, or null. Built only from the crossings the
 * page already shows (lib/forecastRules.mjs: minor capped at 30%, never "likely"). Words only: no step, tone, verdict or push depends on it.
 * Left out when the step already says it (Minor / Major), when there is no model forecast, and when `fact` (the Next 24 hours text, dayFact) already
 * names the flood level or says no flooding is expected. A fast river says "No estimate beyond 6 hours" only if `fact` does not.
 */
export function minorFact(o: { f: ForecastT; tier: string; fact: T3 | null }): T3 | null {
  const { f, tier, fact } = o;
  if (f.noForecast || tier === "minor" || tier === "major" || tier === "stale") return null;
  const m = f.crossings.find((c) => c.threshold === "minor");
  if (m?.wording === "already") return MINOR_ALREADY;
  if (f.method !== "model" || f.status === "unavailable") return null;
  if (f.horizonLimitH != null) {
    const w = noEstimateBeyond(f.horizonLimitH);
    return fact?.en === w.en ? null : w;
  }
  if (!m || (fact && (/flood level/i.test(fact.en) || fact.en === "No flooding expected today"))) return null;
  if ((m.wording === "possible" || m.wording === "likely") && m.probability >= 0.2) return minorPossible(Math.min(10, Math.max(1, Math.floor(m.probability * 10 + 1e-9))));
  return m.wording === "unlikely" ? MINOR_NOT_EXPECTED : null;
}

