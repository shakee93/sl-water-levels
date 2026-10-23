// Answer-first sentences and short FAQs for the station, river, reservoir and town pages.
//
// Each page opens with one plain sentence that stands on its own ("As of ..., the Kelani Ganga at
// Nagalagam Street was 1.8 ft, below the 5 ft alert level, and falling."), which is what a person,
// a screen reader, a search snippet or an AI answer can lift without reading anything else. The
// numbers come from the same data the page draws and are in feet like the rest of the site.
// Labels are inline in en/si/ta (si/ta are drafts that need native review), so the shared i18n
// files stay untouched.
import type { NationalStation } from "./arcgis";
import { stationDisplayName } from "./displayName";
import { fullStamp, riverName } from "./i18n/format";
import type { Locale } from "./i18n/config";
import type { TFn } from "./i18n/translate";
import { shownNumber, type Unit } from "./units";

type L3 = Record<Locale, string>;
type Vars = Record<string, string | number>;

const fill = (s: string, v: Vars) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
const W = (d: L3, lang: Locale, v: Vars = {}) => fill(d[lang], v);

const D = {
  asOf: { en: "As of {stamp} (Sri Lanka time)", si: "{stamp} වන විට (ශ්‍රී ලංකා වේලාවෙන්)", ta: "{stamp} நிலவரப்படி (இலங்கை நேரம்)" },
  // {river} {name} {lv} {rel} {dir}
  sentence: {
    en: "{asOf}, the {river} at {name} was {lv}, {rel}{dir}.",
    si: "{asOf}, {river} හි {name} හි ජල මට්ටම {lv} විය; {rel}{dir}.",
    ta: "{asOf}, {river} ஆற்றின் {name} இல் நீர்மட்டம் {lv}; {rel}{dir}.",
  },
  sentenceNoRiver: {
    en: "{asOf}, the water level at {name} was {lv}, {rel}{dir}.",
    si: "{asOf}, {name} හි ජල මට්ටම {lv} විය; {rel}{dir}.",
    ta: "{asOf}, {name} இல் நீர்மட்டம் {lv}; {rel}{dir}.",
  },
  below: { en: "below the {v} alert level", si: "අනතුරු ඇඟවීමේ මට්ටම ({v}) ට වඩා පහළයි", ta: "எச்சரிக்கை மட்டத்திற்கு ({v}) கீழே உள்ளது" },
  near: { en: "close to the {v} alert level", si: "අනතුරු ඇඟවීමේ මට්ටමට ({v}) ආසන්නයි", ta: "எச்சரிக்கை மட்டத்திற்கு ({v}) அருகில் உள்ளது" },
  alert: { en: "above the {v} alert level", si: "අනතුරු ඇඟවීමේ මට්ටම ({v}) ඉක්මවා ඇත", ta: "எச்சரிக்கை மட்டத்தை ({v}) தாண்டியுள்ளது" },
  minor: { en: "above the {v} minor flood level", si: "සුළු ගංවතුර මට්ටම ({v}) ඉක්මවා ඇත", ta: "சிறிய வெள்ள மட்டத்தை ({v}) தாண்டியுள்ளது" },
  major: { en: "above the {v} major flood level", si: "මහා ගංවතුර මට්ටම ({v}) ඉක්මවා ඇත", ta: "பெரிய வெள்ள மட்டத்தை ({v}) தாண்டியுள்ளது" },
  none: { en: "and this gauge has no published flood levels", si: "මෙම මානයට පළ කළ ගංවතුර මට්ටම් නැත", ta: "இந்த அளவீட்டுக்கு வெள்ள மட்டங்கள் வெளியிடப்படவில்லை" },
  rising: { en: ", and rising", si: "; ඉහළ යමින් තිබේ", ta: "; உயர்ந்து வருகிறது" },
  risingSlow: { en: ", and rising slowly", si: "; සෙමින් ඉහළ යමින් තිබේ", ta: "; மெதுவாக உயர்ந்து வருகிறது" },
  falling: { en: ", and falling", si: "; පහළ යමින් තිබේ", ta: "; குறைந்து வருகிறது" },
  steady: { en: ", and steady", si: "; ස්ථාවරව තිබේ", ta: "; மாற்றமின்றி உள்ளது" },
  stale: {
    en: "{name} is not reporting a current level. Its last reading was {lv}, {stamp} (Sri Lanka time).",
    si: "{name} දැන් මට්ටමක් වාර්තා කරන්නේ නැත. අවසන් කියවීම {lv}, {stamp} (ශ්‍රී ලංකා වේලාවෙන්).",
    ta: "{name} தற்போதைய நிலையைத் தெரிவிக்கவில்லை. கடைசி அளவீடு {lv}, {stamp} (இலங்கை நேரம்).",
  },
  noData: { en: "{name} has no water-level reading available right now.", si: "{name} සඳහා දැන් ජල මට්ටම් කියවීමක් නැත.", ta: "{name} க்கு இப்போது நீர்மட்ட அளவீடு இல்லை." },
} satisfies Record<string, L3>;

const lvText = (v: number, u: Unit, digits = 1) => (u ? `${shownNumber(v, u)} ft` : shownNumber(v, u, digits));

const STEADY = 0.006; // m/h, same as app/verdict.ts
const SLOW = 0.05;

/** One sentence: the level now, against the official marks, and where it is heading. */
export function stationAnswer(lang: Locale, t: TFn, s: NationalStation): string {
  const name = stationDisplayName(s.station);
  const river = riverName(s.basin.trim(), lang);
  if (!s.latest || s.latest.water_level == null) return W(D.noData, lang, { name });
  const lv = lvText(s.latest.water_level, s.unit);
  const stamp = fullStamp(s.latest.ts, t);
  if (s.tier === "stale") return W(D.stale, lang, { name, lv, stamp });
  const th = s.thresholds;
  const mark = (v: number | null) => (v == null ? "" : lvText(v, s.unit));
  let rel: string;
  switch (s.tier) {
    case "major": rel = W(D.major, lang, { v: mark(th.major) }); break;
    case "minor": rel = W(D.minor, lang, { v: mark(th.minor) }); break;
    case "alert": rel = W(D.alert, lang, { v: mark(th.alert) }); break;
    case "watch": rel = W(D.near, lang, { v: mark(th.alert) }); break;
    case "normal": rel = W(D.below, lang, { v: mark(th.alert) }); break;
    default: rel = W(D.none, lang);
  }
  const r = s.rate3hM;
  const dir = r == null ? "" : W(Math.abs(r) < STEADY ? D.steady : r < 0 ? D.falling : r < SLOW ? D.risingSlow : D.rising, lang);
  return W(river ? D.sentence : D.sentenceNoRiver, lang, { asOf: W(D.asOf, lang, { stamp }), river, name, lv, rel, dir });
}

// ---- river ----------------------------------------------------------------------------------------

const R = {
  flagged: {
    en: "{asOf}, {n} of the {m} reporting gauges on the {river} are at or near a flood mark: {names}.",
    si: "{asOf}, {river} හි වාර්තා කරන මාන {m} න් {n} ක් ගංවතුර මට්ටමකට ළඟයි හෝ ඉක්මවා ඇත: {names}.",
    ta: "{asOf}, {river} இல் தகவல் தரும் {m} அளவீடுகளில் {n} வெள்ள மட்டத்தில் அல்லது அருகில் உள்ளன: {names}.",
  },
  calm: {
    en: "{asOf}, all {m} reporting gauges on the {river} are below their alert levels.",
    si: "{asOf}, {river} හි වාර්තා කරන මාන {m} ම අනතුරු ඇඟවීමේ මට්ටමට පහළයි.",
    ta: "{asOf}, {river} இல் தகவல் தரும் {m} அளவீடுகளும் எச்சரிக்கை மட்டத்திற்குக் கீழே உள்ளன.",
  },
  none: {
    en: "None of the {total} gauges on the {river} is reporting a current level right now.",
    si: "{river} හි මාන {total} න් කිසිවක් දැන් වත්මන් මට්ටමක් වාර්තා කරන්නේ නැත.",
    ta: "{river} இல் உள்ள {total} அளவீடுகளில் எதுவும் இப்போது தகவல் தரவில்லை.",
  },
} satisfies Record<string, L3>;

export function riverAnswer(lang: Locale, t: TFn, basin: string, snap: NationalStation[]): string {
  const river = riverName(basin, lang);
  const reporting = snap.filter((s) => s.tier !== "stale" && s.latest);
  const newest = snap.reduce<number | null>((m, s) => (s.latest && (m == null || s.latest.ts > m) ? s.latest.ts : m), null);
  if (!reporting.length || newest == null) return W(R.none, lang, { river, total: snap.length });
  const asOf = W(D.asOf, lang, { stamp: fullStamp(newest, t) });
  const flagged = reporting.filter((s) => ["major", "minor", "alert", "watch"].includes(s.tier));
  if (!flagged.length) return W(R.calm, lang, { asOf, river, m: reporting.length });
  const names = flagged.map((s) => `${stationDisplayName(s.station)} (${lvText(s.latest!.water_level!, s.unit)})`).join(", ");
  return W(R.flagged, lang, { asOf, river, n: flagged.length, m: reporting.length, names });
}

// ---- FAQ ------------------------------------------------------------------------------------------

export type Faq = { q: string; a: string };

const Q = {
  heading: { en: "Common questions", si: "නිතර අසන ප්‍රශ්න", ta: "அடிக்கடி கேட்கப்படும் கேள்விகள்" },
  now: { en: "Is {name} flooding now?", si: "{name} දැන් ගංවතුරට යටවෙලාද?", ta: "{name} இப்போது வெள்ளத்தில் உள்ளதா?" },
  marks: { en: "What is the flood level at {name}?", si: "{name} හි ගංවතුර මට්ටම කීයද?", ta: "{name} இல் வெள்ள மட்டம் என்ன?" },
  marksA: {
    en: "The official marks for this gauge are {list}. Alert means get ready, minor flood means water is spilling over low ground, and major flood means move to safety.",
    si: "මෙම මානයේ නිල මට්ටම්: {list}. අනතුරු ඇඟවීම යනු සූදානම් වීම, සුළු ගංවතුර යනු පහත් බිම්වලට ජලය පැමිණීම, මහා ගංවතුර යනු ආරක්ෂිත ස්ථානයකට යාමයි.",
    ta: "இந்த அளவீட்டின் அதிகாரப்பூர்வ மட்டங்கள்: {list}. எச்சரிக்கை என்பது தயாராக இருப்பது, சிறிய வெள்ளம் என்பது தாழ்ந்த நிலங்களில் நீர் புகுவது, பெரிய வெள்ளம் என்பது பாதுகாப்பான இடத்திற்குச் செல்வது.",
  },
  marksNone: { en: "No flood levels are published for this gauge, so it cannot be compared with an alert level.", si: "මෙම මානය සඳහා ගංවතුර මට්ටම් පළ කර නැත.", ta: "இந்த அளவீட்டுக்கு வெள்ள மட்டங்கள் வெளியிடப்படவில்லை." },
  alertWord: { en: "alert {v}", si: "අනතුරු ඇඟවීම {v}", ta: "எச்சரிக்கை {v}" },
  minorWord: { en: "minor flood {v}", si: "සුළු ගංවතුර {v}", ta: "சிறிய வெள்ளம் {v}" },
  majorWord: { en: "major flood {v}", si: "මහා ගංවතුර {v}", ta: "பெரிய வெள்ளம் {v}" },
  source: { en: "Where does this come from and how often does it update?", si: "මෙය කොහෙන්ද, කොපමණ වාරයක් යාවත්කාලීන වේද?", ta: "இது எங்கிருந்து வருகிறது, எத்தனை முறை புதுப்பிக்கப்படுகிறது?" },
  sourceA: {
    en: "River readings come from the Department of Irrigation's gauges, roughly once an hour, and this page checks for new ones every minute. This site is independent and not an official warning service: follow the Disaster Management Centre and call 117 in an emergency.",
    si: "ගංගා මට්ටම් ජල සම්පාදන දෙපාර්තමේන්තුවේ මානවලින් පැයකට වරක් පමණ ලැබේ; මෙම පිටුව සෑම මිනිත්තුවකටම නව දත්ත පරීක්ෂා කරයි. මෙම වෙබ් අඩවිය ස්වාධීනයි, නිල අනතුරු ඇඟවීමක් නොවේ: ආපදා කළමනාකරණ මධ්‍යස්ථානය අනුගමනය කර හදිසි අවස්ථාවක 117 අමතන්න.",
    ta: "ஆற்று அளவீடுகள் நீர்ப்பாசனத் திணைக்களத்தின் அளவீட்டு நிலையங்களிலிருந்து ஏறக்குறைய ஒவ்வொரு மணி நேரமும் வருகின்றன; இந்தப் பக்கம் ஒவ்வொரு நிமிடமும் புதியவற்றைச் சரிபார்க்கிறது. இந்தத் தளம் சுயாதீனமானது, அதிகாரப்பூர்வ எச்சரிக்கை சேவை அல்ல: அனர்த்த முகாமைத்துவ நிலையத்தைப் பின்பற்றி அவசரத்தில் 117 ஐ அழைக்கவும்.",
  },
  gauges: { en: "Which gauges are on the {river}?", si: "{river} හි මාන මොනවාද?", ta: "{river} இல் எந்த அளவீட்டு நிலையங்கள் உள்ளன?" },
  gaugesA: { en: "From upstream to downstream: {list}.", si: "ඉහළ සිට පහළට: {list}.", ta: "மேலிருந்து கீழ்: {list}." },
  releasing: { en: "Is {name} releasing water?", si: "{name} ජලය මුදාහරිනවාද?", ta: "{name} நீரை வெளியேற்றுகிறதா?" },
  storage: { en: "How full is {name}?", si: "{name} කොපමණ පිරී තිබේද?", ta: "{name} எவ்வளவு நிரம்பியுள்ளது?" },
  rsvSource: {
    en: "Where does the reservoir information come from?",
    si: "වැව් තොරතුරු කොහෙන්ද?",
    ta: "நீர்த்தேக்கத் தகவல் எங்கிருந்து வருகிறது?",
  },
  rsvSourceA: {
    en: "From the Irrigation Department's daily reservoir sheet and the Mahaweli Authority's daily report. Both update about once a day, so check the date shown. This site is independent: for spill-gate warnings follow the Disaster Management Centre and call 117.",
    si: "ජල සම්පාදන දෙපාර්තමේන්තුවේ දෛනික වැව් වාර්තාවෙන් සහ මහවැලි අධිකාරියේ දෛනික වාර්තාවෙන්. දෙකම දිනකට වරක් පමණ යාවත්කාලීන වේ, එබැවින් පෙන්වන දිනය බලන්න. මෙය ස්වාධීන වෙබ් අඩවියකි: වාන් දොරටු අනතුරු ඇඟවීම් සඳහා ආපදා කළමනාකරණ මධ්‍යස්ථානය අනුගමනය කර 117 අමතන්න.",
    ta: "நீர்ப்பாசனத் திணைக்களத்தின் தினசரி நீர்த்தேக்க அறிக்கையிலிருந்தும் மகாவலி அதிகாரசபையின் தினசரி அறிக்கையிலிருந்தும். இரண்டும் நாளுக்கு ஒருமுறை புதுப்பிக்கப்படும், எனவே காட்டப்படும் திகதியைப் பார்க்கவும். இது சுயாதீனத் தளம்: வான் கதவு எச்சரிக்கைகளுக்கு அனர்த்த முகாமைத்துவ நிலையத்தைப் பின்பற்றி 117 ஐ அழைக்கவும்.",
  },
  townHow: { en: "How is the flood risk for {name} worked out?", si: "{name} සඳහා ගංවතුර අවදානම ගණනය කරන්නේ කෙසේද?", ta: "{name} க்கான வெள்ள அபாயம் எப்படிக் கணிக்கப்படுகிறது?" },
  townHowA: {
    en: "From the nearest river gauge ({gauge}, {km} away), recent and expected rain, the gauge's forecast and any official warning. It is an estimate for the town, not an official warning, and streets can flood before the river reaches a flood mark.",
    si: "ළඟම ඇති ගංගා මානයෙන් ({gauge}, {km} දුරින්), මෑත සහ අපේක්ෂිත වර්ෂාවෙන්, මානයේ පුරෝකථනයෙන් සහ නිල අනතුරු ඇඟවීම් වලින්. මෙය නගරය සඳහා ඇස්තමේන්තුවකි, නිල අනතුරු ඇඟවීමක් නොවේ.",
    ta: "அருகிலுள்ள ஆற்று அளவீட்டு நிலையம் ({gauge}, {km} தொலைவில்), சமீபத்திய மற்றும் எதிர்பார்க்கப்படும் மழை, முன்னறிவிப்பு மற்றும் அதிகாரப்பூர்வ எச்சரிக்கைகளிலிருந்து. இது நகரத்திற்கான மதிப்பீடு, அதிகாரப்பூர்வ எச்சரிக்கை அல்ல.",
  },
} satisfies Record<string, L3>;

export const faqHeading = (lang: Locale) => Q.heading[lang];

export function stationFaq(lang: Locale, s: NationalStation, answer: string): Faq[] {
  const name = stationDisplayName(s.station);
  const th = s.thresholds;
  const parts: string[] = [];
  const add = (d: L3, v: number | null) => v != null && parts.push(W(d, lang, { v: lvText(v, s.unit) }));
  add(Q.alertWord, th.alert);
  add(Q.minorWord, th.minor);
  add(Q.majorWord, th.major);
  return [
    { q: W(Q.now, lang, { name }), a: answer },
    { q: W(Q.marks, lang, { name }), a: parts.length ? W(Q.marksA, lang, { list: parts.join(", ") }) : W(Q.marksNone, lang) },
    { q: W(Q.source, lang), a: W(Q.sourceA, lang) },
  ];
}

export function riverFaq(lang: Locale, basin: string, answer: string, orderedStationNames: string[]): Faq[] {
  const river = riverName(basin, lang);
  return [
    { q: W(Q.now, lang, { name: river }), a: answer },
    { q: W(Q.gauges, lang, { river }), a: W(Q.gaugesA, lang, { list: orderedStationNames.join(", ") }) },
    { q: W(Q.source, lang), a: W(Q.sourceA, lang) },
  ];
}

export function reservoirFaq(lang: Locale, name: string, answer: string, storageLine: string | null): Faq[] {
  const out: Faq[] = [{ q: W(Q.releasing, lang, { name }), a: answer }];
  if (storageLine) out.push({ q: W(Q.storage, lang, { name }), a: storageLine });
  out.push({ q: W(Q.rsvSource, lang), a: W(Q.rsvSourceA, lang) });
  return out;
}

export function townFaq(lang: Locale, town: string, answer: string, gauge: { name: string; km: string } | null): Faq[] {
  const out: Faq[] = [{ q: W(Q.now, lang, { name: town }), a: answer }];
  if (gauge) out.push({ q: W(Q.townHow, lang, { name: town }), a: W(Q.townHowA, lang, gauge) });
  out.push({ q: W(Q.source, lang), a: W(Q.sourceA, lang) });
  return out;
}


// ---- town -----------------------------------------------------------------------------------------

const T = {
  withGauge: {
    en: "{town} flood risk right now: {tone}. This is an estimate based on the {gauge} gauge on the {river} ({km} away), which read {lv} {stamp}.",
    si: "{town} හි දැන් ගංවතුර අවදානම: {tone}. මෙය {river} හි {gauge} මානය ({km} දුරින්) මත පදනම් වූ ඇස්තමේන්තුවකි; එහි මට්ටම {lv} ({stamp}).",
    ta: "{town} இல் இப்போதைய வெள்ள அபாயம்: {tone}. இது {river} ஆற்றின் {gauge} அளவீட்டை ({km} தொலைவில்) அடிப்படையாகக் கொண்ட மதிப்பீடு; அதன் அளவு {lv} ({stamp}).",
  },
  noGauge: {
    en: "{town} flood risk right now: {tone}. This is an estimate from rain and official warnings, because no river gauge is close enough to use.",
    si: "{town} හි දැන් ගංවතුර අවදානම: {tone}. ළඟ ගංගා මානයක් නැති බැවින් මෙය වර්ෂාව සහ නිල අනතුරු ඇඟවීම් මත පදනම් වූ ඇස්තමේන්තුවකි.",
    ta: "{town} இல் இப்போதைய வெள்ள அபாயம்: {tone}. அருகில் ஆற்று அளவீட்டு நிலையம் இல்லாததால் இது மழை மற்றும் அதிகாரப்பூர்வ எச்சரிக்கைகளின் மதிப்பீடு.",
  },
  stamp: { en: "as of {s} (Sri Lanka time)", si: "{s} වන විට", ta: "{s} நிலவரப்படி" },
} satisfies Record<string, L3>;

export function townAnswer(
  lang: Locale,
  t: TFn,
  o: { town: string; tone: string; gauge: { name: string; basin: string; km: string; level: number | null; unit: Unit; ts: number | null } | null },
): string {
  const g = o.gauge;
  if (!g || g.level == null || g.ts == null) return W(T.noGauge, lang, { town: o.town, tone: o.tone });
  return W(T.withGauge, lang, {
    town: o.town,
    tone: o.tone,
    gauge: g.name,
    river: riverName(g.basin, lang),
    km: g.km,
    lv: lvText(g.level, g.unit),
    stamp: W(T.stamp, lang, { s: fullStamp(g.ts, t) }),
  });
}
