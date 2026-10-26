// "Heavy rain upstream" warning, shown beside the chart, in the next-hour answers, the JSON API, llms.txt and the push text.
//
// Thresholds come from the 11-month backtest (DOCS.md "Storm backtest", scripts/fit-storm-model.mjs `warn`): for every hour, the
// catchment rain forecast for the next 24 h against how far the river rose in those 24 h.
//   under 10 mm: 13% of hours saw a rise of 1 ft or more     25-50 mm: 50%
//   50-100 mm:   65% (mean rise 3.7 ft; 31% saw 4 ft or more)  100 mm or more: 85% (mean 6.6 ft; 61% saw 4 ft or more)
// So the line appears at 50 mm forecast (deterministic, area average over the catchment above the gauge), or when the heavier
// ensemble member (p90) reaches 100 mm, and is stronger from 100 mm. It is a "rain is coming" flag, never a level.
import type { Locale } from "./i18n/config";
import type { MeasuredRain } from "./measuredRain";

export const RAIN_RISK_MM = 50;
export const RAIN_RISK_P90_MM = 100;
export const RAIN_RISK_VERY_MM = 100;

export type RainRisk = {
  /** What fired: the rain forecast, rain the gauges measured (lib/measuredRain.ts), or both (one combined line). Absent = "forecast". */
  kind?: "forecast" | "measured" | "both";
  /** Set when kind is "measured" or "both". */
  measured?: (MeasuredRain & { gaugeName: string }) | null;
  /** "heavy" = 50 mm or more forecast; "very-heavy" = 100 mm or more; "possible" = only the heavier ensemble member reaches 100 mm. For kind "measured" it is "very-heavy" and mm is 0. */
  level: "heavy" | "very-heavy" | "possible";
  /** The number the sentence quotes (mm, rounded to 5): the deterministic forecast, or the p90 for "possible". */
  mm: number;
  /** Deterministic forecast and heavier-scenario (p90) totals for the next 24 h, mm, unrounded. */
  detMm: number | null;
  p90Mm: number | null;
};

const r5 = (v: number) => Math.round(v / 5) * 5;

export function rainRiskOf(n: { det: number | null; p90: number | null } | null | undefined): RainRisk | null {
  if (!n) return null;
  const { det, p90 } = n;
  if (det != null && det >= RAIN_RISK_MM) {
    return { level: det >= RAIN_RISK_VERY_MM ? "very-heavy" : "heavy", mm: r5(det), detMm: det, p90Mm: p90 };
  }
  if (p90 != null && p90 >= RAIN_RISK_P90_MM) return { level: "possible", mm: r5(p90), detMm: det, p90Mm: p90 };
  return null;
}

const LINES: Record<Locale, { heavy: string; possible: string }> = {
  en: {
    heavy: "Heavy rain forecast upstream in the next 24 hours (about {mm} mm). The river may rise faster than the line shows.",
    possible: "Very heavy rain is possible upstream in the next 24 hours (up to about {mm} mm if the heavier forecast comes true). The river may rise faster than the line shows.",
  },
  // si / ta: DRAFT translations, not yet reviewed by a native speaker.
  si: {
    heavy: "ඉදිරි පැය 24 තුළ ඉහළ ප්‍රදේශවල තද වැසි අපේක්ෂිතයි (මි.මී. {mm} පමණ). ගඟ රේඛාවෙන් පෙන්වනවාට වඩා වේගයෙන් ඉහළ යා හැක.",
    possible: "ඉදිරි පැය 24 තුළ ඉහළ ප්‍රදේශවල ඉතා තද වැසි ඇතිවිය හැක (වැඩි අපේක්ෂාව සැබෑ වුවහොත් මි.මී. {mm} දක්වා). ගඟ රේඛාවෙන් පෙන්වනවාට වඩා වේගයෙන් ඉහළ යා හැක.",
  },
  ta: {
    heavy: "அடுத்த 24 மணி நேரத்தில் மேல்பகுதியில் கனமழை எதிர்பார்க்கப்படுகிறது (சுமார் {mm} மி.மீ). ஆறு கோட்டில் காட்டுவதை விட வேகமாக உயரலாம்.",
    possible: "அடுத்த 24 மணி நேரத்தில் மேல்பகுதியில் மிகக் கனமழை பெய்ய வாய்ப்புள்ளது (கனமான முன்னறிவிப்பு நிஜமானால் சுமார் {mm} மி.மீ வரை). ஆறு கோட்டில் காட்டுவதை விட வேகமாக உயரலாம்.",
  },
};

const MLINES: Record<Locale, string> = {
  en: "Very heavy rain was measured at {gauge} in the last {n} {hours} ({mm} mm). The river may rise fast.",
  // si / ta: DRAFT translations, not yet reviewed by a native speaker.
  si: "{gauge} හි පසුගිය {n} {hours} තුළ ඉතා තද වැසි මැනිණි (මි.මී. {mm}). ගඟ වේගයෙන් ඉහළ යා හැක.",
  ta: "{gauge} இல் கடந்த {n} {hours} மிகக் கனமழை அளக்கப்பட்டது ({mm} மி.மீ). ஆறு வேகமாக உயரலாம்.",
};
const HOURS_WORD: Record<Locale, [string, string]> = { en: ["hour", "hours"], si: ["පැය", "පැය"], ta: ["மணி நேரத்தில்", "மணி நேரத்தில்"] };

/** The plain sentence for a measured burst, in the reader's language (si/ta are drafts). `gauge` is the display name. */
export function measuredRainLine(m: Pick<MeasuredRain, "hours" | "mm">, gauge: string, lang: Locale = "en"): string {
  const l = MLINES[lang] ?? MLINES.en;
  const w = (HOURS_WORD[lang] ?? HOURS_WORD.en)[m.hours === 1 ? 0 : 1];
  // "the last 1 hour" reads oddly: say "the last hour"
  const s = l.replace("{gauge}", gauge).replace("{mm}", String(m.mm));
  if (lang === "en" && m.hours === 1) return s.replace("the last {n} {hours}", "the last hour");
  return s.replace("{n}", String(m.hours)).replace("{hours}", w);
}

const MPUSH: Record<Locale, string> = {
  en: "Very heavy rain was just measured upstream, so it may rise fast.",
  si: "ඉහළ ප්‍රදේශවල ඉතා තද වැසි මැනිණි, එබැවින් වේගයෙන් ඉහළ යා හැක.",
  ta: "மேல்பகுதியில் மிகக் கனமழை அளக்கப்பட்டது, எனவே வேகமாக உயரலாம்.",
};
export const measuredRainPush = (lang: Locale = "en") => MPUSH[lang] ?? MPUSH.en;

/** Adds the rain the gauges measured to a forecast warning (or makes one when only the gauges tripped). */
export function withMeasured(forecast: RainRisk | null, m: (MeasuredRain & { gaugeName: string }) | null): RainRisk | null {
  if (!m) return forecast;
  if (!forecast) return { kind: "measured", measured: m, level: "very-heavy", mm: 0, detMm: null, p90Mm: null };
  return { ...forecast, kind: "both", measured: m };
}

/** The plain sentence for a warning, in the reader's language (si/ta are drafts). Measured + forecast give one combined line. */
export function rainRiskLine(risk: Pick<RainRisk, "level" | "mm"> & Partial<Pick<RainRisk, "kind" | "measured">>, lang: Locale = "en"): string {
  const l = LINES[lang] ?? LINES.en;
  if (risk.kind === "measured" && risk.measured) return measuredRainLine(risk.measured, risk.measured.gaugeName, lang);
  if (risk.kind === "both" && risk.measured) {
    // one line: what was measured, what is forecast, then the single "may rise fast" closing
    const sents = (t: string) => t.split(/(?<=\)\.) /) // every line is "<what> (<numbers>). <closing>";
    const m = sents(measuredRainLine(risk.measured, risk.measured.gaugeName, lang));
    const f = sents((risk.level === "possible" ? l.possible : l.heavy).replace("{mm}", String(risk.mm)));
    return [m[0], f[0], m[1] ?? ""].join(" ").trim();
  }
  return (risk.level === "possible" ? l.possible : l.heavy).replace("{mm}", String(risk.mm));
}

/** Short clause for push messages, e.g. "Heavy rain upstream: it may rise faster." */
const PUSH: Record<Locale, string> = {
  en: "Heavy rain is forecast upstream, so it may rise faster than expected.",
  si: "ඉහළ ප්‍රදේශවල තද වැසි අපේක්ෂිතයි, එබැවින් අපේක්ෂාවට වඩා වේගයෙන් ඉහළ යා හැක.",
  ta: "மேல்பகுதியில் கனமழை எதிர்பார்க்கப்படுகிறது, எனவே எதிர்பார்த்ததை விட வேகமாக உயரலாம்.",
};
export const rainRiskPush = (lang: Locale = "en", kind?: RainRisk["kind"]) => (kind === "measured" || kind === "both" ? measuredRainPush(lang) : PUSH[lang] ?? PUSH.en);
