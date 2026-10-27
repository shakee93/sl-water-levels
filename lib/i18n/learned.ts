// Strings for "what visitors taught us": the street-water level suggestion on town pages (app/flood/MyStreetLevel.tsx) and the About card
// (app/learned/LearnedCard.tsx). Sinhala and Tamil are DRAFTS that need native-speaker review. Placeholders look like {n}; keep every
// placeholder in every language. No imports except a type.
import type { Locale } from "./config";

const en = {
  "ln.suggest": "People near {gauge} have reported water on roads from about {ft} ft ({n} reports on {days} days). {gauge} is at {now} now.",
  "ln.reached": "{gauge} is at or above that level: water on low streets is possible.",
  "ln.use": "Use {ft} ft",
  "ln.h": "What visitors taught us",
  "ln.intro": "Your answers to \"Does this match what you see?\" and \"Did your street flood?\" are counted every day. A number below appears only when at least {k} different people on at least {d} separate days point the same way, and it can move only a little from the official figure. It tunes small notes (like the street-water note); it never changes the official step: Normal, Alert, Minor flood, Major flood.",
  "ln.none": "Nothing is learned yet. {people} people have answered so far; a number needs {k} reports on {d} days.",
  "ln.street": "{gauge}: water on roads reported from about {ft} ft ({n} reports, {days} days). Official minor flood: {def} ft.",
  "ln.rain": "Colombo's canal towns: street water reported from about {mm} mm of rain in 24 hours ({n} reports, {days} days). Default: {def} mm.",
  "ln.building": "Still building up: {n} places have some reports but not enough yet.",
  "ln.fc": "Forecast check: we also tested whether a correction learned from past forecasts would make the next hours more accurate. It did not help ({base} ft average miss before, {fit} ft after, next hour), so the forecast is unchanged.",
  "ln.counts": "Counts only: no names, notes or places are kept in this file. Updated {date}.",
};
type Dict = typeof en;
export type LKey = keyof Dict;

const si: Dict = {
  "ln.suggest": "{gauge} අසල අය මාර්ග මත ජලය ගැන වාර්තා කර ඇත්තේ ආසන්න වශයෙන් අඩි {ft} සිට ({n} වාර්තා, දින {days}). දැන් {gauge} මට්ටම {now} කි.",
  "ln.reached": "{gauge} එම මට්ටමට හෝ ඉහළින් ඇත: පහත් වීදිවල ජලය පැමිණීමට ඉඩ ඇත.",
  "ln.use": "අඩි {ft} භාවිතා කරන්න",
  "ln.h": "අමුත්තන් අපට ඉගැන්වූ දේ",
  "ln.intro": "\"මෙය ඔබ දකින දෙයට ගැළපෙනවාද?\" සහ \"ඔබේ වීදියට ජලය ආවාද?\" යන ඔබේ පිළිතුරු සෑම දිනකම ගණන් ගනු ලැබේ. පහත අගයක් පෙන්වන්නේ අවම වශයෙන් වෙනස් පුද්ගලයන් {k} දෙනෙකු දින {d} ක් තුළ එකම දිශාවට පෙන්වා දුන් විට පමණි; නිල අගයෙන් එය වෙනස් විය හැක්කේ ටිකක් පමණි. එය කුඩා සටහන් (වීදි ජල සටහන වැනි) සකසයි; නිල මට්ටම්: සාමාන්‍ය, අවවාදය, සුළු ගංවතුර, මහා ගංවතුර කිසිවිටක වෙනස් නොකරයි.",
  "ln.none": "තවම කිසිවක් ඉගෙන ගෙන නැත. මෙතෙක් {people} දෙනෙකු පිළිතුරු දී ඇත; අගයක් සඳහා දින {d} කදී වාර්තා {k} ක් අවශ්‍යයි.",
  "ln.street": "{gauge}: අඩි {ft} පමණ සිට මාර්ග මත ජලය වාර්තා වී ඇත ({n} වාර්තා, දින {days}). නිල සුළු ගංවතුර මට්ටම: අඩි {def}.",
  "ln.rain": "කොළඹ ඇළ මාර්ග නගර: පැය 24 තුළ වර්ෂාව මි.මී. {mm} පමණ සිට වීදි ජලය වාර්තා වී ඇත ({n} වාර්තා, දින {days}). පෙරනිමිය: මි.මී. {def}.",
  "ln.building": "තවමත් ගොඩනැගෙමින්: ස්ථාන {n} ක වාර්තා කිහිපයක් ඇත, නමුත් තවම ප්‍රමාණවත් නැත.",
  "ln.fc": "පුරෝකථන පරීක්ෂාව: අතීත පුරෝකථනවලින් ඉගෙන ගත් නිවැරදි කිරීමක් ඊළඟ පැය වඩා නිවැරදි කරයිදැයි ද අපි පරීක්ෂා කළෙමු. එය උපකාර නොවීය (ඊළඟ පැය: පෙර සාමාන්‍ය වැරැද්ද අඩි {base}, පසු අඩි {fit}), එබැවින් පුරෝකථනය වෙනස් නොවේ.",
  "ln.counts": "ගණන් පමණි: නම්, සටහන් හෝ ස්ථාන මෙම ගොනුවේ නැත. යාවත්කාලීන කළේ {date}.",
};

const ta: Dict = {
  "ln.suggest": "{gauge} அருகிலுள்ளவர்கள் சுமார் {ft} அடி முதல் சாலைகளில் தண்ணீர் இருப்பதாக தெரிவித்துள்ளனர் ({days} நாட்களில் {n} அறிக்கைகள்). {gauge} இப்போது {now}.",
  "ln.reached": "{gauge} அந்த மட்டத்தில் அல்லது அதற்கு மேல் உள்ளது: தாழ்வான தெருக்களில் தண்ணீர் வர வாய்ப்பு உண்டு.",
  "ln.use": "{ft} அடியைப் பயன்படுத்து",
  "ln.h": "பார்வையாளர்கள் எங்களுக்குக் கற்பித்தவை",
  "ln.intro": "\"இது நீங்கள் பார்ப்பதற்கு பொருந்துகிறதா?\" மற்றும் \"உங்கள் தெருவில் தண்ணீர் வந்ததா?\" என்பதற்கான உங்கள் பதில்கள் ஒவ்வொரு நாளும் எண்ணப்படுகின்றன. குறைந்தது {d} தனித்தனி நாட்களில் குறைந்தது {k} வெவ்வேறு நபர்கள் ஒரே திசையில் கூறினால் மட்டுமே கீழே ஒரு எண் தோன்றும்; அது அதிகாரப்பூர்வ எண்ணிலிருந்து சிறிதளவே மாறலாம். இது சிறிய குறிப்புகளை (தெரு நீர் குறிப்பு போன்றவை) சரிசெய்கிறது; அதிகாரப்பூர்வ நிலைகளை: இயல்பு, எச்சரிக்கை, சிறு வெள்ளம், பெரு வெள்ளம் ஒருபோதும் மாற்றாது.",
  "ln.none": "இன்னும் எதுவும் கற்கப்படவில்லை. இதுவரை {people} பேர் பதிலளித்துள்ளனர்; ஒரு எண்ணுக்கு {d} நாட்களில் {k} அறிக்கைகள் தேவை.",
  "ln.street": "{gauge}: சுமார் {ft} அடி முதல் சாலைகளில் தண்ணீர் தெரிவிக்கப்பட்டுள்ளது ({n} அறிக்கைகள், {days} நாட்கள்). அதிகாரப்பூர்வ சிறு வெள்ள மட்டம்: {def} அடி.",
  "ln.rain": "கொழும்பு கால்வாய் நகரங்கள்: 24 மணி நேரத்தில் சுமார் {mm} மி.மீ. மழை முதல் தெரு நீர் தெரிவிக்கப்பட்டுள்ளது ({n} அறிக்கைகள், {days} நாட்கள்). இயல்புநிலை: {def} மி.மீ.",
  "ln.building": "இன்னும் சேர்ந்து வருகிறது: {n} இடங்களில் சில அறிக்கைகள் உள்ளன, ஆனால் இன்னும் போதாது.",
  "ln.fc": "முன்னறிவிப்பு சோதனை: கடந்த முன்னறிவிப்புகளிலிருந்து கற்ற திருத்தம் அடுத்த மணிநேரங்களை மேலும் துல்லியமாக்குமா என்றும் சோதித்தோம். அது உதவவில்லை (அடுத்த மணிநேரம்: முன் சராசரி பிழை {base} அடி, பின் {fit} அடி), எனவே முன்னறிவிப்பு மாறவில்லை.",
  "ln.counts": "எண்ணிக்கை மட்டும்: பெயர்கள், குறிப்புகள் அல்லது இடங்கள் இந்தக் கோப்பில் இல்லை. புதுப்பிக்கப்பட்டது {date}.",
};

const DICTS: Record<Locale, Dict> = { en, si, ta };
export type LT = (key: LKey, vars?: Record<string, string | number>) => string;
export function lnFor(lang: Locale): LT {
  const d = DICTS[lang] ?? DICTS.en;
  return (key, vars) => {
    const s = d[key] ?? en[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
