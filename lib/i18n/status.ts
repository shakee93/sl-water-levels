// Strings for the /status page and the footer link. Kept apart from en.ts so this feature adds no
// keys to the shared dictionaries. Sinhala and Tamil are drafts that need native review.
// Placeholders look like {n}; keep every placeholder in every language.
import type { Locale } from "./config";

const en = {
  "footer": "Data status",
  "title": "Data status | Sri Lanka Water Levels",
  "desc": "Is the data behind this site up to date? A plain status for each source.",
  "h1": "Data status",
  "intro": "This site depends on several public data sources. Here is whether each one is working right now.",
  "all.ok": "Everything is working.",
  "all.delayed": "Some data is delayed. The rest is working.",
  "all.down": "Some data is down right now. Water levels may be out of date.",
  "s.ok": "OK",
  "s.delayed": "Delayed",
  "s.down": "Down",
  "upd": "Updated {ago}",
  "upd.none": "Update time unknown",
  "ago.now": "just now",
  "ago.min": "{n} min ago",
  "ago.hour": "{n} h ago",
  "ago.day": "{n} days ago",
  "checked": "Checked at {time} Sri Lanka time. This page refreshes every few minutes.",
  "back": "Back to the map",
  "g.gauges": "River water levels",
  "g.sheet": "Reservoir releases (Irrigation Department)",
  "g.wms": "Mahaweli reservoir report",
  "g.dmc": "Official flood warnings (DMC)",
  "g.openai": "Reading of official bulletins",
  "g.weather": "Rain forecast and river outlook",
  "g.news": "News reports on opened gates",
  "g.archive": "History and forecast records",
  "g.hmis": "HMIS: Irrigation Department hydro-met system (10-minute sensors, ground rain)",
} as const;

export type StatusKey = keyof typeof en;

const si: Record<StatusKey, string> = {
  "footer": "දත්ත තත්ත්වය",
  "title": "දත්ත තත්ත්වය | Sri Lanka Water Levels",
  "desc": "මෙම අඩවියේ දත්ත යාවත්කාලීනද? සෑම මූලාශ්‍රයකටම සරල තත්ත්වයක්.",
  "h1": "දත්ත තත්ත්වය",
  "intro": "මෙම අඩවිය පොදු දත්ත මූලාශ්‍ර කිහිපයක් මත රඳා පවතී. ඒ සෑම එකක්ම දැන් ක්‍රියාත්මකදැයි මෙහි දැක්වේ.",
  "all.ok": "සියල්ල ක්‍රියාත්මකයි.",
  "all.delayed": "සමහර දත්ත ප්‍රමාදයි. ඉතිරිය ක්‍රියාත්මකයි.",
  "all.down": "සමහර දත්ත දැන් ක්‍රියා නොකරයි. ජල මට්ටම් යල්පිළිගත් විය හැක.",
  "s.ok": "හරි",
  "s.delayed": "ප්‍රමාදයි",
  "s.down": "ක්‍රියා නොකරයි",
  "upd": "යාවත්කාලීන කළේ {ago}",
  "upd.none": "යාවත්කාලීන වේලාව නොදනී",
  "ago.now": "මේ දැන්",
  "ago.min": "මිනිත්තු {n} කට පෙර",
  "ago.hour": "පැය {n} කට පෙර",
  "ago.day": "දින {n} කට පෙර",
  "checked": "පරීක්ෂා කළ වේලාව {time} (ශ්‍රී ලංකා වේලාව). මෙම පිටුව මිනිත්තු කිහිපයකට වරක් යාවත්කාලීන වේ.",
  "back": "සිතියමට ආපසු",
  "g.gauges": "ගංගා ජල මට්ටම්",
  "g.sheet": "ජලාශ මුදාහැරීම් (වාරිමාර්ග දෙපාර්තමේන්තුව)",
  "g.wms": "මහවැලි ජලාශ වාර්තාව",
  "g.dmc": "නිල ගංවතුර අනතුරු ඇඟවීම් (ආපදා කළමනාකරණ මධ්‍යස්ථානය)",
  "g.openai": "නිල නිවේදන කියවීම",
  "g.weather": "වැසි පුරෝකථනය සහ ගං දැක්ම",
  "g.news": "දොරටු විවෘත කිරීම් පිළිබඳ ප්‍රවෘත්ති",
  "g.archive": "ඉතිහාසය සහ පුරෝකථන වාර්තා",
  "g.hmis": "HMIS: වාරිමාර්ග දෙපාර්තමේන්තුවේ ජල-කාලගුණ පද්ධතිය (මිනිත්තු 10 සංවේදක, බිම් වර්ෂාව)",
};

const ta: Record<StatusKey, string> = {
  "footer": "தரவு நிலை",
  "title": "தரவு நிலை | Sri Lanka Water Levels",
  "desc": "இந்தத் தளத்தின் தரவு புதியதா? ஒவ்வொரு மூலத்திற்கும் எளிய நிலை.",
  "h1": "தரவு நிலை",
  "intro": "இந்தத் தளம் பல பொதுத் தரவு மூலங்களைச் சார்ந்துள்ளது. ஒவ்வொன்றும் இப்போது செயல்படுகிறதா என்பது இங்கே.",
  "all.ok": "எல்லாம் செயல்படுகிறது.",
  "all.delayed": "சில தரவு தாமதமாகியுள்ளது. மற்றவை செயல்படுகின்றன.",
  "all.down": "சில தரவு இப்போது செயல்படவில்லை. நீர்மட்டங்கள் பழையவையாக இருக்கலாம்.",
  "s.ok": "சரி",
  "s.delayed": "தாமதம்",
  "s.down": "செயலிழப்பு",
  "upd": "புதுப்பிக்கப்பட்டது {ago}",
  "upd.none": "புதுப்பித்த நேரம் தெரியவில்லை",
  "ago.now": "இப்போதுதான்",
  "ago.min": "{n} நிமிடங்களுக்கு முன்",
  "ago.hour": "{n} மணிநேரத்திற்கு முன்",
  "ago.day": "{n} நாட்களுக்கு முன்",
  "checked": "சோதித்த நேரம் {time} (இலங்கை நேரம்). இந்தப் பக்கம் சில நிமிடங்களுக்கு ஒருமுறை புதுப்பிக்கப்படும்.",
  "back": "வரைபடத்திற்குத் திரும்பு",
  "g.gauges": "ஆற்று நீர்மட்டங்கள்",
  "g.sheet": "நீர்த்தேக்க வெளியேற்றங்கள் (நீர்ப்பாசனத் திணைக்களம்)",
  "g.wms": "மகாவலி நீர்த்தேக்க அறிக்கை",
  "g.dmc": "அதிகாரப்பூர்வ வெள்ள எச்சரிக்கைகள் (இடர் முகாமைத்துவ மையம்)",
  "g.openai": "அதிகாரப்பூர்வ அறிவிப்புகளை வாசித்தல்",
  "g.weather": "மழை முன்னறிவிப்பு மற்றும் ஆற்றுப் பார்வை",
  "g.news": "மதகு திறப்பு குறித்த செய்திகள்",
  "g.archive": "வரலாறு மற்றும் முன்னறிவிப்புப் பதிவுகள்",
  "g.hmis": "HMIS: நீர்ப்பாசனத் திணைக்கள நீர்-வானிலைத் தகவல் அமைப்பு (10 நிமிட உணரிகள், நிலமட்ட மழை)",
};

const DICTS: Record<Locale, Record<StatusKey, string>> = { en, si, ta };

export function statusT(lang: Locale) {
  const d = DICTS[lang];
  return (key: StatusKey, vars?: Record<string, string | number>) => {
    const s = d[key] ?? en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
