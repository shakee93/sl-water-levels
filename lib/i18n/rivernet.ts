// Strings for the RiverNet (rivernet.lk) notes: credit, gauge note, the "Latest" line on duplicates.
// Sinhala and Tamil are drafts that need native review. Keep every {placeholder}.
import type { Locale } from "./config";

const en = {
  "credit": "RiverNet – DMC / Leecom SCADA (rivernet.lk)",
  "gauge.note": "Readings from RiverNet, the Disaster Management Centre's sensors, shown in feet. This page refreshes about every 10 minutes.",
  "gauge.noMarks": "RiverNet publishes no alert levels for this gauge, so no flood step is shown here.",
  "gauge.last": "No recent reading: this sensor last reported on {when} (Sri Lanka time).",
  "fast": "Latest: {level} at {time} (1-minute sensor)",
  "fastNote": "A newer reading from a second sensor, matched to this gauge. The official step stays with the {official} reading.",
  "official.hourly": "hourly",
  "official.hmis": "HMIS",
};
type K = keyof typeof en;
const si: Record<K, string> = {
  "credit": "RiverNet – ආපදා කළමනාකරණ මධ්‍යස්ථානය / Leecom SCADA (rivernet.lk)",
  "gauge.note": "ආපදා කළමනාකරණ මධ්‍යස්ථානයේ සංවේදක ජාලය වන RiverNet වෙතින් ලැබෙන කියවීම්, අඩි වලින්. මෙම පිටුව මිනිත්තු 10 කට වරක් පමණ අලුත් වේ.",
  "gauge.noMarks": "RiverNet මෙම මානය සඳහා අනතුරු මට්ටම් පළ කර නැත, එබැවින් මෙහි ගංවතුර මට්ටමක් නොපෙන්වයි.",
  "gauge.last": "මෑත කියවීමක් නැත: මෙම සංවේදකය අවසන් වරට වාර්තා කළේ {when} (ශ්‍රී ලංකා වේලාව).",
  "fast": "නවතම: {level}, {time} ට (මිනිත්තු 1 සංවේදකය)",
  "fastNote": "මෙම මානයට ගැළපෙන දෙවන සංවේදකයකින් ලැබුණු අලුත් කියවීමක්. නිල මට්ටම තීරණය වන්නේ {official} කියවීමෙනි.",
  "official.hourly": "පැයෙන් පැයට",
  "official.hmis": "HMIS",
};
const ta: Record<K, string> = {
  "credit": "RiverNet – பேரிடர் மேலாண்மை மையம் / Leecom SCADA (rivernet.lk)",
  "gauge.note": "பேரிடர் மேலாண்மை மையத்தின் உணரி வலையமைப்பான RiverNet தரும் அளவீடுகள், அடிகளில். இந்தப் பக்கம் சுமார் 10 நிமிடங்களுக்கு ஒருமுறை புதுப்பிக்கப்படும்.",
  "gauge.noMarks": "இந்த அளவீட்டு நிலையத்துக்கு RiverNet எச்சரிக்கை மட்டங்களை வெளியிடவில்லை, எனவே இங்கு வெள்ள நிலை காட்டப்படவில்லை.",
  "gauge.last": "சமீபத்திய அளவீடு இல்லை: இந்த உணரி கடைசியாக {when} (இலங்கை நேரம்) அன்று அனுப்பியது.",
  "fast": "சமீபத்தியது: {level}, {time} (1 நிமிட உணரி)",
  "fastNote": "இந்த அளவீட்டு நிலையத்துக்குப் பொருந்தும் இரண்டாவது உணரியின் புதிய அளவீடு. அதிகாரப்பூர்வ நிலை {official} அளவீட்டிலிருந்தே வரும்.",
  "official.hourly": "மணிநேர",
  "official.hmis": "HMIS",
};
const D: Record<Locale, Record<K, string>> = { en, si, ta };
export function rivernetT(lang: Locale) {
  const d = D[lang];
  return (key: K, vars?: Record<string, string | number>) => {
    const s = d[key] ?? en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
