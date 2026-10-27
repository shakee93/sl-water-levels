// Strings for the HMIS (hmis.gov.lk) notes: the 10-minute sensor line, ground-rain line, warnings and credit.
// Sinhala and Tamil are drafts that need native review. Keep every {placeholder}.
import type { Locale } from "./config";

const en = {
  "credit": "HMIS – Irrigation Department (hmis.gov.lk)",
  "creditWith": "HMIS – Irrigation Department (hmis.gov.lk), {inst}",
  "fast": "Latest: {level} at {time} ({n}-min sensor)",
  "fastNote": "A newer reading from a second sensor, matched to this gauge. The official step stays with the hourly gauge.",
  "rain": "Measured {mm} mm in 24 h at {name} rain gauge ({inst})",
  "rainKm": "Measured {mm} mm in 24 h at {name} rain gauge ({inst}), {km} km away",
  "warn.h": "Official warning (HMIS)",
  "map.ground": "Diamonds: ground rain gauges, last 24 h (HMIS – Irrigation Department: NBRO, Met Department)",
  "gauge.note": "Readings from the Irrigation Department's HMIS sensor network, shown in feet. Levels come every {n} minutes.",
  "gauge.upstream": "Karawanella is upstream of Glencourse and Hanwella on the Kelani Ganga: a rise here is an early sign for them.",
};
type K = keyof typeof en;
const si: Record<K, string> = {
  "credit": "HMIS – වාරිමාර්ග දෙපාර්තමේන්තුව (hmis.gov.lk)",
  "creditWith": "HMIS – වාරිමාර්ග දෙපාර්තමේන්තුව (hmis.gov.lk), {inst}",
  "fast": "නවතම: {level}, {time} ට (මිනිත්තු {n} සංවේදකය)",
  "fastNote": "මෙම මානයට ගැළපෙන දෙවන සංවේදකයකින් ලැබුණු අලුත් කියවීමක්. නිල මට්ටම තීරණය වන්නේ පැයෙන් පැයට මානයෙනි.",
  "rain": "පැය 24 තුළ {mm} මි.මී. මනිනු ලැබිණි, {name} වර්ෂාමානය ({inst})",
  "rainKm": "පැය 24 තුළ {mm} මි.මී. මනිනු ලැබිණි, {name} වර්ෂාමානය ({inst}), කි.මී. {km} ක් ඈතින්",
  "warn.h": "නිල අනතුරු ඇඟවීම (HMIS)",
  "map.ground": "දියමන්ති: බිම් වර්ෂාමාන, පසුගිය පැය 24 (HMIS – වාරිමාර්ග දෙපාර්තමේන්තුව: NBRO, කාලගුණ දෙපාර්තමේන්තුව)",
  "gauge.note": "වාරිමාර්ග දෙපාර්තමේන්තුවේ HMIS සංවේදක ජාලයෙන් ලැබෙන කියවීම්, අඩි වලින්. මිනිත්තු {n} කට වරක් ලැබේ.",
  "gauge.upstream": "කැලණි ගඟේ ග්ලෙන්කෝස් සහ හංවැල්ලට ඉහළින් කරවනැල්ල පිහිටා ඇත: මෙහි ඉහළ යාමක් ඔවුන්ට මුල් ඇඟවීමකි.",
};
const ta: Record<K, string> = {
  "credit": "HMIS – நீர்ப்பாசனத் திணைக்களம் (hmis.gov.lk)",
  "creditWith": "HMIS – நீர்ப்பாசனத் திணைக்களம் (hmis.gov.lk), {inst}",
  "fast": "சமீபத்தியது: {level}, {time} ({n} நிமிட உணரி)",
  "fastNote": "இந்த அளவீட்டு நிலையத்துக்குப் பொருந்தும் இரண்டாவது உணரியின் புதிய அளவீடு. அதிகாரப்பூர்வ நிலை மணிநேர அளவீட்டிலிருந்தே வரும்.",
  "rain": "24 மணி நேரத்தில் {mm} மி.மீ. அளக்கப்பட்டது, {name} மழைமானி ({inst})",
  "rainKm": "24 மணி நேரத்தில் {mm} மி.மீ. அளக்கப்பட்டது, {name} மழைமானி ({inst}), {km} கி.மீ. தொலைவில்",
  "warn.h": "அதிகாரப்பூர்வ எச்சரிக்கை (HMIS)",
  "map.ground": "வைரங்கள்: நிலமட்ட மழைமானிகள், கடந்த 24 மணி (HMIS – நீர்ப்பாசனத் திணைக்களம்: NBRO, வானிலை திணைக்களம்)",
  "gauge.note": "நீர்ப்பாசனத் திணைக்களத்தின் HMIS உணரி வலையமைப்பிலிருந்து அளவீடுகள், அடிகளில். ஒவ்வொரு {n} நிமிடமும் வரும்.",
  "gauge.upstream": "களனி கங்கையில் கிளென்கோர்ஸ், ஹன்வெல்லவுக்கு மேலே கரவனெல்ல உள்ளது: இங்கு உயர்வு அவர்களுக்கு முன்னறிகுறி.",
};
const D: Record<Locale, Record<K, string>> = { en, si, ta };
export function hmisT(lang: Locale) {
  const d = D[lang];
  return (key: K, vars?: Record<string, string | number>) => {
    const s = d[key] ?? en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
export type HmisT = ReturnType<typeof hmisT>;
