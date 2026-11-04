// The forecast panel's headline in the page language. lib/forecast.ts builds the English sentence and, beside it, the same sentence as
// plain data (Forecast.headlineParts); this turns the data into si / ta. Words only: every figure, mark and chance comes from the forecast
// unchanged. si / ta are DRAFT translations (the card says "machine-translated" next to them). English pages keep the original sentence.
import type { Forecast, HeadlineParts, HeadlineReach, ThresholdName } from "./forecast";
import type { Locale } from "./i18n/config";

type L = { en: string; si: string; ta: string };

const MARK: Record<ThresholdName, L> = {
  alert: { en: "alert level", si: "අනතුරු ඇඟවීමේ මට්ටම", ta: "எச்சரிக்கை மட்டம்" },
  minor: { en: "minor flood level", si: "සුළු ගංවතුර මට්ටම", ta: "சிறிய வெள்ள மட்டம்" },
  major: { en: "major flood level", si: "ප්‍රධාන ගංවතුර මට්ටම", ta: "பெரிய வெள்ள மட்டம்" },
};
// Tamil case forms of the same marks (accusative "reach the ...", dative "above / below the ...")
const TA_ACC: Record<ThresholdName, string> = { alert: "எச்சரிக்கை மட்டத்தை", minor: "சிறிய வெள்ள மட்டத்தை", major: "பெரிய வெள்ள மட்டத்தை" };
const TA_DAT: Record<ThresholdName, string> = { alert: "எச்சரிக்கை மட்டத்துக்கு", minor: "சிறிய வெள்ள மட்டத்துக்கு", major: "பெரிய வெள்ள மட்டத்துக்கு" };
const span = (h: number, lang: Locale) => (lang === "si" ? `පැය ${h}` : `${h} மணி நேரம்`);
const reachText = (r: HeadlineReach, lang: Locale): string => {
  const m = MARK[r.mark][lang];
  if (lang === "si") {
    const when = r.etaH != null ? `පැය ${r.etaH}ක් පමණ ඇතුළත` : `ඉදිරි පැය ${r.spanH} තුළ`;
    return `${when} ${m}ට ${r.likely ? "බොහෝ විට ළඟා වේ" : "ළඟා විය හැක"} (අවස්ථාව ආසන්න වශයෙන් ${r.pct}%)`;
  }
  const when = r.etaH != null ? `சுமார் ${r.etaH} மணி நேரத்தில்` : `அடுத்த ${r.spanH} மணி நேரத்தில்`;
  return `${when} ${TA_ACC[r.mark]} ${r.likely ? "எட்டும் வாய்ப்பு அதிகம்" : "எட்டலாம்"} (வாய்ப்பு சுமார் ${r.pct}%)`;
};

/** The panel headline: English as built, or the si / ta version of the same facts (English when the run carries no parts). */
export function forecastHeadline(f: Pick<Forecast, "headline" | "headlineParts">, lang: Locale): string {
  const p: HeadlineParts | undefined = f.headlineParts;
  if (lang === "en" || !p) return f.headline;
  const si = lang === "si";
  switch (p.k) {
    case "unclear":
      return si ? "පැහැදිලි නැත: ගඟ යන දිශාව කීමට මෑත කියවීම් ප්‍රමාණවත් නැත." : "தெளிவில்லை: ஆறு எந்தப் பக்கம் செல்கிறது என்று சொல்ல போதுமான சமீபத்திய அளவீடுகள் இல்லை.";
    case "trend": {
      const word = { rising: si ? "ඉහළ යයි" : "உயர்கிறது", falling: si ? "පහළ යයි" : "குறைகிறது", steady: si ? "ස්ථාවරයි" : "மாற்றமில்லை" }[p.dir];
      if (p.rate == null) return si ? `${word}: පැයකින් පසු මට්ටම ආසන්න වශයෙන් ${p.pred} වනු ඇතැයි අපේක්ෂා කෙරේ.` : `${word}: ஒரு மணி நேரத்தில் நீர்மட்டம் சுமார் ${p.pred} ஆக இருக்கும் என எதிர்பார்க்கப்படுகிறது.`;
      return si
        ? `${word}: දැන් ආසන්න වශයෙන් ${p.level}; පසුගිය පැය 3 තුළ පැයකට ආසන්න වශයෙන් ${p.rate}කින් ${p.dir === "rising" ? "ඉහළ" : "පහළ"} ගොස් ඇත.`
        : `${word}: இப்போது சுமார் ${p.level}; கடந்த 3 மணி நேரத்தில் மணிக்கு சுமார் ${p.rate} ${p.dir === "rising" ? "உயர்ந்துள்ளது" : "குறைந்துள்ளது"}.`;
    }
    case "reach":
      return `${reachText(p.r, lang)}.`.replace(/^./, (c) => c.toUpperCase());
    case "above": {
      const m = MARK[p.mark].si;
      const head = si ? `දැන් ${m}ට ඉහළින් ඇත` : `இப்போது ${TA_DAT[p.mark]} மேல் உள்ளது`;
      if (p.reach) return `${head}; ${reachText(p.reach, lang)}.`;
      const tail = {
        falling: si ? "පහළ යමින් තිබේ" : "குறைந்து வருகிறது",
        keeps: si ? "පහළ යමින් තිබේ; තවදුරටත් පහළ යනු ඇතැයි අපේක්ෂා කෙරේ" : "குறைந்து வருகிறது; தொடர்ந்து குறையும் என எதிர்பார்க்கப்படுகிறது",
        stay: si ? `ඉදිරි ${span(p.spanH, lang)} තුළ එසේම පවතිනු ඇතැයි අපේක්ෂා කෙරේ` : `அடுத்த ${span(p.spanH, lang)} அப்படியே இருக்கும் என எதிர்பார்க்கப்படுகிறது`,
        ease: si ? `${span(p.spanH, lang)} ඇතුළත ඊට පහළට බසිනු ඇතැයි අපේක්ෂා කෙරේ` : `${span(p.spanH, lang)} க்குள் அதற்குக் கீழே இறங்கும் என எதிர்பார்க்கப்படுகிறது`,
      }[p.then];
      return `${head}; ${tail}.`;
    }
    case "below": {
      return si
        ? `ඉදිරි ${span(p.spanH, lang)} තුළ ${MARK[p.mark].si}ට පහළින් ${p.hedge ? "බොහෝ විට පවතිනු ඇත" : "පවතිනු ඇතැයි අපේක්ෂා කෙරේ"}.`
        : `அடுத்த ${span(p.spanH, lang)} ${TA_DAT[p.mark]} கீழேயே ${p.hedge ? "இருக்க வாய்ப்புள்ளது" : "இருக்கும் என எதிர்பார்க்கப்படுகிறது"}.`;
    }
    case "about":
      return si ? `ඉදිරි ${span(p.spanH, lang)} තුළ ආසන්න වශයෙන් ${p.level} වනු ඇතැයි අපේක්ෂා කෙරේ.` : `அடுத்த ${span(p.spanH, lang)} சுமார் ${p.level} ஆக இருக்கும் என எதிர்பார்க்கப்படுகிறது.`;
    case "none":
      return p.why === "unreliable"
        ? (si ? "මෙම මානය සඳහා පුරෝකථනයක් නැත." : "இந்த அளவீட்டுக்கு முன்னறிவிப்பு இல்லை.")
        : p.why === "stale"
          ? (si ? "පුරෝකථනයක් නැත: මානය දැන් දත්ත නොඑවයි හෝ අවසන් කියවීම පැරණියි." : "முன்னறிவிப்பு இல்லை: அளவீடு தற்போது தரவு அனுப்பவில்லை அல்லது கடைசி அளவீடு பழையது.")
          : (si ? "පුරෝකථනයක් නැත." : "முன்னறிவிப்பு இல்லை.");
  }
}
