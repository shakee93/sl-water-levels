// Strings for the Flood news board (/news, the home card and the "In the news" lists). Kept apart from the
// shared dictionaries so this feature touches none of them. Headlines are NOT translated: they are shown as
// the outlet published them. Sinhala and Tamil are drafts that need native review. Placeholders look like {n}.
import type { Locale } from "./config";

const en = {
  nav: "News",
  crumb: "News",
  h1: "News",
  lead: "Recent news reports about floods, rivers, reservoirs, heavy rain, cyclones and landslides in Sri Lanka, from Newswire and other Sri Lankan outlets.",
  notice: "News reports, not official. For warnings check the Disaster Management Centre (hotline 117) and the Irrigation Department.",
  metaTitle: "Flood news Sri Lanka: latest reports on floods, rain, rivers and reservoirs",
  metaDesc: "Links to the latest news reports on floods, river levels, spill gates, heavy rain, cyclones and landslides in Sri Lanka from the last 7 days. News reports, not official warnings.",
  all: "All",
  filters: "Filter by topic",
  count: "{n} reports in the last 7 days",
  countOne: "1 report in the last 7 days",
  countShown: "Showing {a} of {n}",
  empty: "No flood-related news in the last 7 days.",
  emptyTag: "No reports with this tag in the last 7 days.",
  outage: "The news feeds cannot be reached right now. Try again in a few minutes.",
  source: "Source: {src}",
  newTab: "(opens the news site in a new tab)",
  related: "Related:",
  languageNote: "Headlines are shown in the language the outlet published them in.",
  homeTitle: "Flood news",
  homeAll: "All flood news",
  inNews: "In the news",
  inNewsNote: "News reports, not official.",
  "tag.Rain": "Rain",
  "tag.River": "River",
  "tag.Reservoir": "Reservoir",
  "tag.Landslide": "Landslide",
  "tag.Cyclone": "Cyclone",
  "tag.Warning": "Warning",
  "tag.Closure": "Closure",
};
type K = keyof typeof en;

const si: Record<K, string> = {
  nav: "පුවත්", // needs native review
  crumb: "පුවත්", // needs native review
  h1: "පුවත්", // needs native review
  lead: "ශ්‍රී ලංකාවේ ගංවතුර, ගංගා, ජලාශ, තද වැසි, සුළි සුළං සහ නායයෑම් පිළිබඳ මෑත පුවත් වාර්තා.", // needs native review
  notice: "මේවා පුවත් වාර්තා මිස නිල තොරතුරු නොවේ. අනතුරු ඇඟවීම් සඳහා ආපදා කළමනාකරණ මධ්‍යස්ථානය (ඇමතුම් 117) සහ වාරිමාර්ග දෙපාර්තමේන්තුව පරීක්ෂා කරන්න.", // needs native review
  metaTitle: "ශ්‍රී ලංකා ගංවතුර පුවත්: ගංවතුර, වැසි, ගංගා සහ ජලාශ පිළිබඳ නවතම වාර්තා", // needs native review
  metaDesc: "ගිය දින 7 තුළ ශ්‍රී ලංකාවේ ගංවතුර, ගංගා ජල මට්ටම්, වාන් දොරටු, තද වැසි, සුළි සුළං සහ නායයෑම් පිළිබඳ නවතම පුවත් වාර්තා වෙත සබැඳි. පුවත් වාර්තා මිස නිල අනතුරු ඇඟවීම් නොවේ.", // needs native review
  all: "සියල්ල", // needs native review
  filters: "මාතෘකාව අනුව පෙරන්න", // needs native review
  count: "ගිය දින 7 තුළ වාර්තා {n}", // needs native review
  countOne: "ගිය දින 7 තුළ වාර්තා 1", // needs native review
  countShown: "{n} න් {a} ක් පෙන්වයි", // needs native review
  empty: "ගිය දින 7 තුළ ගංවතුර සම්බන්ධ පුවත් නැත.", // needs native review
  emptyTag: "මෙම ටැගය සහිත වාර්තා ගිය දින 7 තුළ නැත.", // needs native review
  outage: "පුවත් ප්‍රභවයන්ට දැන් ළඟා විය නොහැක. මිනිත්තු කිහිපයකින් නැවත උත්සාහ කරන්න.", // needs native review
  source: "මූලාශ්‍රය: {src}", // needs native review
  newTab: "(පුවත් අඩවිය නව ටැබයක විවෘත වේ)", // needs native review
  related: "අදාළ:", // needs native review
  languageNote: "සිරස්තල පෙන්වන්නේ පුවත් ආයතනය පළ කළ භාෂාවෙනි.", // needs native review
  homeTitle: "ගංවතුර පුවත්", // needs native review
  homeAll: "සියලු ගංවතුර පුවත්", // needs native review
  inNews: "පුවත්වල", // needs native review
  inNewsNote: "පුවත් වාර්තා මිස නිල තොරතුරු නොවේ.", // needs native review
  "tag.Rain": "වැසි", // needs native review
  "tag.River": "ගඟ", // needs native review
  "tag.Reservoir": "ජලාශ", // needs native review
  "tag.Landslide": "නායයෑම", // needs native review
  "tag.Cyclone": "සුළි සුළං", // needs native review
  "tag.Warning": "අනතුරු ඇඟවීම", // needs native review
  "tag.Closure": "වසා දැමීම", // needs native review
};

const ta: Record<K, string> = {
  nav: "செய்திகள்", // needs native review
  crumb: "செய்திகள்", // needs native review
  h1: "செய்திகள்", // needs native review
  lead: "இலங்கையில் வெள்ளம், ஆறுகள், நீர்த்தேக்கங்கள், கனமழை, சூறாவளி மற்றும் நிலச்சரிவு பற்றிய சமீபத்திய செய்தி அறிக்கைகள்.", // needs native review
  notice: "இவை செய்தி அறிக்கைகள், அதிகாரப்பூர்வமானவை அல்ல. எச்சரிக்கைகளுக்கு பேரிடர் முகாமைத்துவ நிலையம் (117) மற்றும் நீர்ப்பாசனத் திணைக்களத்தைப் பார்க்கவும்.", // needs native review
  metaTitle: "இலங்கை வெள்ளச் செய்திகள்: வெள்ளம், மழை, ஆறுகள், நீர்த்தேக்கங்கள் பற்றிய சமீபத்திய அறிக்கைகள்", // needs native review
  metaDesc: "கடந்த 7 நாட்களில் இலங்கையில் வெள்ளம், ஆற்று நீர்மட்டம், வான்கதவுகள், கனமழை, சூறாவளி, நிலச்சரிவு பற்றிய செய்தி அறிக்கைகளுக்கான இணைப்புகள். செய்தி அறிக்கைகள், அதிகாரப்பூர்வ எச்சரிக்கைகள் அல்ல.", // needs native review
  all: "அனைத்தும்", // needs native review
  filters: "தலைப்பின்படி வடிகட்டு", // needs native review
  count: "கடந்த 7 நாட்களில் {n} அறிக்கைகள்", // needs native review
  countOne: "கடந்த 7 நாட்களில் 1 அறிக்கை", // needs native review
  countShown: "{n} இல் {a} காட்டப்படுகிறது", // needs native review
  empty: "கடந்த 7 நாட்களில் வெள்ளம் தொடர்பான செய்திகள் இல்லை.", // needs native review
  emptyTag: "இந்தக் குறிச்சொல்லுடன் கடந்த 7 நாட்களில் அறிக்கைகள் இல்லை.", // needs native review
  outage: "செய்தி மூலங்களை இப்போது அணுக முடியவில்லை. சில நிமிடங்களில் மீண்டும் முயலவும்.", // needs native review
  source: "மூலம்: {src}", // needs native review
  newTab: "(செய்தித் தளம் புதிய தாவலில் திறக்கும்)", // needs native review
  related: "தொடர்புடையவை:", // needs native review
  languageNote: "தலைப்புகள் செய்தி நிறுவனம் வெளியிட்ட மொழியிலேயே காட்டப்படுகின்றன.", // needs native review
  homeTitle: "வெள்ளச் செய்திகள்", // needs native review
  homeAll: "அனைத்து வெள்ளச் செய்திகள்", // needs native review
  inNews: "செய்திகளில்", // needs native review
  inNewsNote: "செய்தி அறிக்கைகள், அதிகாரப்பூர்வமானவை அல்ல.", // needs native review
  "tag.Rain": "மழை", // needs native review
  "tag.River": "ஆறு", // needs native review
  "tag.Reservoir": "நீர்த்தேக்கம்", // needs native review
  "tag.Landslide": "நிலச்சரிவு", // needs native review
  "tag.Cyclone": "சூறாவளி", // needs native review
  "tag.Warning": "எச்சரிக்கை", // needs native review
  "tag.Closure": "மூடல்", // needs native review
};

const DICTS: Record<Locale, Record<K, string>> = { en, si, ta };
export type NwKey = K;
export type NW = (key: K, vars?: Record<string, string | number>) => string;
export function nwFor(lang: Locale): NW {
  const d = DICTS[lang];
  return (key, vars) => {
    const s = d[key] ?? en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
