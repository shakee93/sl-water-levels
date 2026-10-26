// "How this river reacts to rain": a few plain sentences per gauge, written from lib/model/river-response.json (scripts/river-rain-response.mjs:
// 11 months of hourly levels against satellite rain over the catchment). Shown only where the pattern is clear enough (>= 3 separate storms behind
// the numbers and a window that separated rises from non-rises); otherwise nothing is shown, never a guess.
// Pure (the JSON is passed in) so a test can load it with plain node. si / ta lines are DRAFT translations.
import type { Locale } from "./i18n/config";

export type RiverResponse = {
  nearLagH: number | null;
  upLagH: number | null;
  upGauges: { gauge: string; hours: number }[];
  windowH: number | null;
  mmFor1ft: number | null;
  ftPer10mm: number | null;
  ftPer10mmWet: number | null;
  ftPer10mmDry: number | null;
  timeToPeakH: number | null;
  confidence: "high" | "medium" | "low" | "none";
  events: number;
  tidal: boolean;
};

const hrs = (n: number, lang: Locale) => (lang === "en" ? `${n} hour${n === 1 ? "" : "s"}` : lang === "si" ? `පැය ${n}` : `${n} மணி நேரம்`);
const num = (v: number) => (v >= 10 ? String(Math.round(v)) : String(+v.toFixed(1)));

/** Sentences, or null when the data is thin. */
export function riverReactionLines(station: string, r: RiverResponse | undefined | null, lang: Locale = "en", displayName: (s: string) => string = (s) => s): string[] | null {
  if (!r || r.mmFor1ft == null || r.windowH == null || r.events < 3 || (r.confidence !== "high" && r.confidence !== "medium")) return null;
  const name = displayName(station);
  const out: string[] = [];
  const mm = num(r.mmFor1ft), w = hrs(r.windowH, lang);
  if (r.nearLagH != null) {
    const n = Math.max(1, r.nearLagH);
    const kind = n <= 3 ? (lang === "en" ? "A fast river." : lang === "si" ? "වේගයෙන් ප්‍රතිචාර දක්වන ගඟකි." : "விரைவாக எதிர்வினை காட்டும் ஆறு.") : n >= 12 ? (lang === "en" ? "A slow river." : lang === "si" ? "සෙමින් ප්‍රතිචාර දක්වන ගඟකි." : "மெதுவாக எதிர்வினை காட்டும் ஆறு.") : "";
    out.push(
      lang === "en" ? `${kind ? `${kind} ` : ""}Rain close to ${name} shows up in the river in about ${hrs(n, lang)}.`
      : lang === "si" ? `${kind ? `${kind} ` : ""}${name} අසල වැසි ගඟට දැනෙන්නේ පැය ${n} ක පමණ කාලයකින්.`
      : `${kind ? `${kind} ` : ""}${name} அருகே பெய்யும் மழை சுமார் ${hrs(n, lang)}ல் ஆற்றில் தெரியும்.`,
    );
  }
  if (r.upLagH != null && r.upLagH >= 4 && r.upGauges.length) {
    const names = r.upGauges.slice(0, 2).map((u) => displayName(u.gauge)).join(lang === "en" ? " and " : ", ");
    out.push(
      lang === "en" ? `Rain on the upper river (above ${names}) reaches here in about ${hrs(r.upLagH, lang)}.`
      : lang === "si" ? `ඉහළ ගඟේ (${names} ඉහළ) වැසි මෙතැනට පැමිණෙන්නේ පැය ${r.upLagH} ක පමණ කාලයකින්.`
      : `மேல் ஆற்றில் (${names}க்கு மேலே) பெய்யும் மழை இங்கு சுமார் ${hrs(r.upLagH, lang)}ல் வந்து சேரும்.`,
    );
  }
  out.push(
    lang === "en" ? `About ${mm} mm of rain over ${w}, averaged over the catchment, has usually come before a rise of 1 ft or more.`
    : lang === "si" ? `${w} තුළ ජලධාරක ප්‍රදේශය පුරා සාමාන්‍යයෙන් මි.මී. ${mm} ක පමණ වැසි වැටුණු විට ගඟ අඩි 1 ක් හෝ ඊට වැඩියෙන් ඉහළ ගොස් ඇත.`
    : `${w}ல் நீர்ப்பிடிப்பு பகுதி முழுவதும் சராசரியாக சுமார் ${mm} மி.மீ மழை பெய்தபோது ஆறு பொதுவாக 1 அடி அல்லது அதற்கு மேல் உயர்ந்துள்ளது.`,
  );
  if (r.ftPer10mm != null && r.ftPer10mm >= 0.3) {
    const wetter = r.ftPer10mmWet != null && r.ftPer10mmDry != null && r.ftPer10mmWet > r.ftPer10mmDry * 1.3;
    out.push(
      lang === "en" ? `Each extra 10 mm has typically lifted it about ${num(r.ftPer10mm)} ft within a day${wetter ? ", and more when the ground is already wet" : ""}.`
      : lang === "si" ? `අමතර මි.මී. 10 බැගින් එක් දිනක් ඇතුළත ගඟ සාමාන්‍යයෙන් අඩි ${num(r.ftPer10mm)} ක් පමණ ඉහළ නංවා ඇත${wetter ? "; භූමිය දැනටමත් තෙත් නම් තවත් වැඩිය" : ""}.`
      : `கூடுதல் ஒவ்வொரு 10 மி.மீக்கும் ஒரு நாளுக்குள் ஆறு சுமார் ${num(r.ftPer10mm)} அடி உயர்ந்துள்ளது${wetter ? "; நிலம் ஏற்கனவே ஈரமாக இருந்தால் இன்னும் அதிகம்" : ""}.`,
    );
  }
  return out;
}
