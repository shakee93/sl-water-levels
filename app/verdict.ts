// Verdict phrases shared by the station verdict card (Forecast.tsx) and the home "Near you" card.
// Sinhala and Tamil are machine translations (the cards say so when they are shown).
import type { T3, VerdictTone } from "./ShareButton";

export const VERDICT: Record<VerdictTone, T3> = {
  normal: { en: "Normal", si: "සාමාන්‍යයි", ta: "இயல்பு" },
  watch: { en: "Normal", si: "සාමාන්‍යයි", ta: "இயல்பு" }, // internal tone only: shown as Normal, the reason goes in a note (owner, 26 Oct 2026)
  alert: { en: "Alert", si: "අනතුරු ඇඟවීම", ta: "எச்சரிக்கை" }, // the official Alert level's own word (owner, 26 Oct 2026; was "Get ready")
  minor: { en: "Minor flood", si: "සුළු ගංවතුර", ta: "சிறு வெள்ளம்" },
  major: { en: "Major flood", si: "ප්‍රධාන ගංවතුර", ta: "பெரு வெள்ளம்" },
  none: { en: "No flood levels published", si: "ගංවතුර මට්ටම් පළ කර නැත", ta: "வெள்ள மட்டங்கள் வெளியிடப்படவில்லை" },
  stale: { en: "Data delayed", si: "දත්ත ප්‍රමාදයි", ta: "தரவு தாமதம்" },
};

export const CALL: T3 = { en: "Call 117", si: "117 අමතන්න", ta: "117 ஐ அழைக்கவும்" };

export const DIR: Record<"rising" | "slow" | "falling" | "steady", T3> = {
  rising: { en: "Rising", si: "ඉහළ යයි", ta: "உயர்கிறது" },
  slow: { en: "Rising slowly", si: "සෙමින් ඉහළ යයි", ta: "மெதுவாக உயர்கிறது" },
  falling: { en: "Falling", si: "පහළ යයි", ta: "குறைகிறது" },
  steady: { en: "Steady", si: "ස්ථාවරයි", ta: "மாற்றமில்லை" },
};

export const NEXT_HOUR: T3 = { en: "Next hour:", si: "ඊළඟ පැය:", ta: "அடுத்த மணி நேரம்:" };

export const STEADY_M_PER_H = 0.006;
export const SLOW_M_PER_H = 0.05;

/** Direction phrase from a rate in metres per hour. */
export function directionFor(rateMPerH: number): T3 {
  return Math.abs(rateMPerH) < STEADY_M_PER_H
    ? DIR.steady
    : rateMPerH < 0
      ? DIR.falling
      : rateMPerH < SLOW_M_PER_H
        ? DIR.slow
        : DIR.rising;
}
