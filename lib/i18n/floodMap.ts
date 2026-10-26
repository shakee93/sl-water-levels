// Strings for the "Official flood map" sections (town and river pages; data in lib/floodMap.ts). Kept apart from en.ts so this
// feature adds no keys to the shared dictionaries. Sinhala and Tamil are drafts that need native review.
// Placeholders look like {n}; keep every placeholder in every language.
import type { Locale } from "./config";

const en = {
  "title": "Official flood map",
  "town.lead": "In the Irrigation Department's maps of past floods ({events}), these Grama Niladhari divisions around {town} were partly or fully under water:",
  "town.more": "and {n} more nearby",
  "town.none": "None of the Grama Niladhari divisions around {town} is in the Irrigation Department's maps of past floods on the {river} ({events}). Low spots can still flood.",
  "river.lead": "The Irrigation Department has mapped where past floods on the {river} reached:",
  "river.event": "{n} Grama Niladhari divisions in {m} divisional secretariat areas: {dsds}",
  "river.more": "and {n} more",
  "ev": "{year}",
  "ev.river": "{river} {year}",
  "grade.major": "major flood",
  "grade.minor": "minor flood",
  "grade.critical": "critical flood",
  "note": "This shows where a past flood reached, not a flood now. A bigger flood can go further.",
  "credit": "Flood maps: Irrigation Department of Sri Lanka",
} as const;

export type FKey = keyof typeof en;
type D = Record<FKey, string>;

const si: D = {
  "title": "නිල ගංවතුර සිතියම",
  "town.lead": "වාරිමාර්ග දෙපාර්තමේන්තුවේ පෙර ගංවතුර සිතියම්වලට ({events}) අනුව, {town} අවට මෙම ග්‍රාම නිලධාරී වසම් අර්ධ වශයෙන් හෝ සම්පූර්ණයෙන් ජලයෙන් යට විය:",
  "town.more": "සහ අවට තවත් {n}ක්",
  "town.none": "{town} අවට කිසිදු ග්‍රාම නිලධාරී වසමක් {river} පෙර ගංවතුර සඳහා වාරිමාර්ග දෙපාර්තමේන්තුවේ සිතියම්වල ({events}) නැත. පහත් ස්ථාන තවමත් ජලයෙන් යට විය හැක.",
  "river.lead": "{river} පෙර ගංවතුර ළඟා වූ ප්‍රදේශ වාරිමාර්ග දෙපාර්තමේන්තුව සිතියම් ගත කර ඇත:",
  "river.event": "ප්‍රාදේශීය ලේකම් කොට්ඨාස {m}ක ග්‍රාම නිලධාරී වසම් {n}ක්: {dsds}",
  "river.more": "සහ තවත් {n}ක්",
  "ev": "{year}",
  "ev.river": "{river} {year}",
  "grade.major": "විශාල ගංවතුර",
  "grade.minor": "සුළු ගංවතුර",
  "grade.critical": "බරපතළ ගංවතුර",
  "note": "මෙය පෙර ගංවතුරක් ළඟා වූ තැන පෙන්වයි, දැන් ගංවතුරක් නොවේ. විශාල ගංවතුරක් ඊටත් වඩා දුර යා හැක.",
  "credit": "ගංවතුර සිතියම්: ශ්‍රී ලංකා වාරිමාර්ග දෙපාර්තමේන්තුව",
};

const ta: D = {
  "title": "அதிகாரப்பூர்வ வெள்ள வரைபடம்",
  "town.lead": "நீர்ப்பாசனத் திணைக்களத்தின் முந்தைய வெள்ள வரைபடங்களின்படி ({events}), {town} சுற்றியுள்ள இந்தக் கிராம அலுவலர் பிரிவுகள் பகுதியாகவோ முழுமையாகவோ நீரில் மூழ்கின:",
  "town.more": "மேலும் அருகில் {n}",
  "town.none": "{town} சுற்றியுள்ள எந்தக் கிராம அலுவலர் பிரிவும் {river} முந்தைய வெள்ளங்களுக்கான நீர்ப்பாசனத் திணைக்கள வரைபடங்களில் ({events}) இல்லை. தாழ்வான இடங்களில் இன்னும் வெள்ளம் வரலாம்.",
  "river.lead": "{river} முந்தைய வெள்ளங்கள் எட்டிய இடங்களை நீர்ப்பாசனத் திணைக்களம் வரைபடமாக்கியுள்ளது:",
  "river.event": "{m} பிரதேச செயலாளர் பிரிவுகளில் {n} கிராம அலுவலர் பிரிவுகள்: {dsds}",
  "river.more": "மேலும் {n}",
  "ev": "{year}",
  "ev.river": "{river} {year}",
  "grade.major": "பெரும் வெள்ளம்",
  "grade.minor": "சிறு வெள்ளம்",
  "grade.critical": "கடும் வெள்ளம்",
  "note": "இது முந்தைய வெள்ளம் எட்டிய இடத்தைக் காட்டுகிறது, இப்போதைய வெள்ளத்தை அல்ல. பெரிய வெள்ளம் இன்னும் தூரம் செல்லலாம்.",
  "credit": "வெள்ள வரைபடங்கள்: இலங்கை நீர்ப்பாசனத் திணைக்களம்",
};

const DICTS: Record<Locale, D> = { en, si, ta };

export type FT = (key: FKey, vars?: Record<string, string | number>) => string;
export function ftFor(lang: Locale): FT {
  const d = DICTS[lang];
  return (key, vars) => {
    const s = d[key] ?? en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
