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
import type { NextHour } from "./nextHour";
import { rainRiskLine } from "./rainRisk";

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
  sentenceNoMarks: {
    en: "{asOf}, the water level at {name} was {lv}{dir}. No official flood levels are published for this gauge, so there is no flood step.",
    si: "{asOf}, {name} හි ජල මට්ටම {lv} විය{dir}. මෙම මානයට නිල ගංවතුර මට්ටම් පළ කර නැති බැවින් ගංවතුර පියවරක් නැත.",
    ta: "{asOf}, {name} இல் நீர்மட்டம் {lv}{dir}. இந்த அளவிக்கு அதிகாரப்பூர்வ வெள்ள மட்டங்கள் வெளியிடப்படவில்லை, எனவே வெள்ள நிலை இல்லை.",
  },
  // a RiverNet gauge that has stopped reporting: their network, not the Irrigation Department's (si/ta drafts)
  noDataRivernet: {
    en: "{name} has not sent a reading recently. The sensor is not reporting on RiverNet (the Disaster Management Centre's sensor network), so there is no level to show; it will appear here as soon as it reports again.",
    si: "{name} මෑතකදී කියවීමක් එවා නැත. RiverNet (ආපදා කළමනාකරණ මධ්‍යස්ථානයේ සංවේදක ජාලය) හි මෙම සංවේදකය දත්ත නොඑවයි, එබැවින් පෙන්වීමට මට්ටමක් නැත; නැවත දත්ත එවූ විගස මෙහි පෙන්වයි.",
    ta: "{name} சமீபத்தில் அளவீடு அனுப்பவில்லை. RiverNet (அனர்த்த முகாமைத்துவ நிலையத்தின் உணரி வலையமைப்பு) இல் இந்த உணரி தரவு அனுப்பவில்லை, எனவே காட்ட நீர்மட்டம் இல்லை; மீண்டும் அனுப்பியதும் இங்கே தோன்றும்.",
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
  major: { en: "above the {v} major flood level", si: "ප්‍රධාන ගංවතුර මට්ටම ({v}) ඉක්මවා ඇත", ta: "பெரிய வெள்ள மட்டத்தை ({v}) தாண்டியுள்ளது" },
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
  noLevel: { en: "{name} has no water-level reading available right now.", si: "{name} සඳහා දැන් ජල මට්ටම් කියවීමක් නැත.", ta: "{name} க்கு இப்போது நீர்மட்ட அளவீடு இல்லை." },
  // no reading in the Irrigation Department's feed at all: it keeps about 7 days, so the gauge itself has been silent at least that long (si/ta drafts)
  noData: {
    en: "{name} has not sent a reading in the last 7 days. The gauge is not reporting at the Irrigation Department, so there is no level to show; it will appear here as soon as the gauge reports again.",
    si: "{name} පසුගිය දින 7 තුළ කියවීමක් එවා නැත. වාරිමාර්ග දෙපාර්තමේන්තුවේ මෙම මානය දත්ත නොඑවයි, එබැවින් පෙන්වීමට මට්ටමක් නැත; මානය නැවත දත්ත එවූ විගස මෙහි පෙන්වයි.",
    ta: "{name} கடந்த 7 நாட்களில் எந்த அளவீட்டையும் அனுப்பவில்லை. நீர்ப்பாசனத் திணைக்களத்தில் இந்த அளவி தரவு அனுப்பவில்லை, எனவே காட்ட நீர்மட்டம் இல்லை; அளவி மீண்டும் தரவு அனுப்பியதும் இங்கே தோன்றும்.",
  },
} satisfies Record<string, L3>;

const lvText = (v: number, u: Unit, digits = 1) => (u ? `${shownNumber(v, u)} ft` : shownNumber(v, u, digits));

const STEADY = 0.006; // m/h, same as app/verdict.ts
const SLOW = 0.05;

/** One sentence: the level now, against the official marks, and where it is heading. */
export function stationAnswer(lang: Locale, t: TFn, s: NationalStation): string {
  const name = stationDisplayName(s.station);
  const river = riverName(s.basin.trim(), lang);
  if (!s.latest) return W(s.source === "rivernet" ? D.noDataRivernet : D.noData, lang, { name });
  if (s.latest.water_level == null) return W(D.noLevel, lang, { name });
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
  if (!["major", "minor", "alert", "watch", "normal"].includes(s.tier)) return W(D.sentenceNoMarks, lang, { asOf: W(D.asOf, lang, { stamp }), name, lv, dir });
  return W(river ? D.sentence : D.sentenceNoRiver, lang, { asOf: W(D.asOf, lang, { stamp }), river, name, lv, rel, dir });
}


// ---- next hour ------------------------------------------------------------------------------------
// The next-hour forecast, in words. Used for the second sentence under a page's heading and for the
// "Will ... in the next hour?" answers. Shown in feet to one decimal like the rest of the page: a change
// too small to show at that precision reads "stay about the same". Always a forecast, never a warning.

const NH = {
  subjIt: { en: "it", si: "ජල මට්ටම", ta: "நீர்மட்டம்" },
  subjAt: { en: "the {river} at {name}", si: "{river} හි {name} හි ජල මට්ටම", ta: "{river} ஆற்றின் {name} இல் நீர்மட்டம்" },
  subjAtNoRiver: { en: "the water level at {name}", si: "{name} හි ජල මට්ටම", ta: "{name} இல் நீர்மட்டம்" },
  steady: {
    en: "In the next hour {subj} should stay about the same{rng}.",
    si: "ඊළඟ පැය තුළ {subj} පාහේ වෙනස් නොවී පවතිනු ඇතැයි අපේක්ෂා කෙරේ{rng}.",
    ta: "அடுத்த மணி நேரத்தில் {subj} ஏறக்குறைய மாறாமல் இருக்கும் என எதிர்பார்க்கப்படுகிறது{rng}.",
  },
  rise: {
    en: "In the next hour {subj} could rise to about {lv} ft{rng}.",
    si: "ඊළඟ පැය තුළ {subj} ආසන්න වශයෙන් අඩි {lv} දක්වා ඉහළ යනු ඇතැයි අපේක්ෂා කෙරේ{rng}.",
    ta: "அடுத்த மணி நேரத்தில் {subj} சுமார் {lv} அடிக்கு உயரும் என எதிர்பார்க்கப்படுகிறது{rng}.",
  },
  fall: {
    en: "In the next hour {subj} could fall to about {lv} ft{rng}.",
    si: "ඊළඟ පැය තුළ {subj} ආසන්න වශයෙන් අඩි {lv} දක්වා පහළ යනු ඇතැයි අපේක්ෂා කෙරේ{rng}.",
    ta: "அடுத்த மணி நேரத்தில் {subj} சுமார் {lv} அடிக்குக் குறையும் என எதிர்பார்க்கப்படுகிறது{rng}.",
  },
  reachAlert: { en: " It {how} reach the alert level.", si: " එය අනතුරු ඇඟවීමේ මට්ටමට {how}.", ta: " அது எச்சரிக்கை மட்டத்தை {how}." },
  reachMinor: { en: " It {how} reach the minor flood level.", si: " එය සුළු ගංවතුර මට්ටමට {how}.", ta: " அது சிறிய வெள்ள மட்டத்தை {how}." },
  reachMajor: { en: " It {how} reach the major flood level.", si: " එය ප්‍රධාන ගංවතුර මට්ටමට {how}.", ta: " அது பெரிய வெள்ள மட்டத்தை {how}." },
  may: { en: "may", si: "ළඟා විය හැක", ta: "எட்டலாம்" },
  expected: { en: "will likely", si: "ළඟා වනු ඇතැයි අපේක්ෂා කෙරේ", ta: "எட்டும் என எதிர்பார்க்கப்படுகிறது" },
} satisfies Record<string, L3>;

/** The next hour in one sentence, or null when there is no forecast. `subject` names what is forecast (default "it"). */
export function nextHourSentence(lang: Locale, nh: NextHour | null, subject?: string): string | null {
  if (!nh) return null;
  const subj = subject ?? NH.subjIt[lang];
  const dec = (v: number) => v.toFixed(1);
  const lo = nh.low_ft != null ? dec(nh.low_ft) : null;
  const hi = nh.high_ft != null ? dec(nh.high_ft) : null;
  const rng = lo != null && hi != null && lo !== hi ? ` (${lo}–${hi} ft)` : "";
  const lv = dec(nh.level_ft);
  const small = Math.abs(Number(dec(nh.change_ft))) < 0.1;
  const d = small ? NH.steady : nh.change_ft < 0 ? NH.fall : NH.rise;
  let out = W(d, lang, { subj, lv, rng });
  if (nh.crossing) {
    const k = nh.crossing.includes("major") ? NH.reachMajor : nh.crossing.includes("minor") ? NH.reachMinor : NH.reachAlert;
    out += W(k, lang, { how: W(nh.crossing.startsWith("expected") ? NH.expected : NH.may, lang) });
  }
  // Storm warning: heavy rain forecast above the gauge (lib/rainRisk.ts). Same words as the line beside the chart.
  if (nh.rainRisk) out += " " + rainRiskLine(
    { kind: nh.rainRisk.kind, level: nh.rainRisk.level ?? "heavy", mm: nh.rainRisk.mm_24h ?? 0, measured: nh.rainRisk.measured ? { ...nh.rainRisk.measured, gaugeName: nh.rainRisk.measured.gauge, mm1h: null, mm3h: null } : null },
    lang,
  );
  return out;
}

/** "the Kelani Ganga at Hanwella" in the page language, for a sentence about one gauge. */
export function nextHourSubject(lang: Locale, basin: string | null | undefined, station: string): string {
  const name = stationDisplayName(station);
  const river = basin ? riverName(basin.trim(), lang) : "";
  return W(river ? NH.subjAt : NH.subjAtNoRiver, lang, { river, name });
}

// ---- river ----------------------------------------------------------------------------------------

const R = {
  flagged: {
    en: "{asOf}, {n} of the {m} reporting gauges on the {river} are at or above an official mark (Alert, Minor flood or Major flood): {names}.",
    si: "{asOf}, {river} හි වාර්තා කරන මාන {m} න් {n} ක් අනතුරු ඇඟවීමේ හෝ ඉහළ මට්ටමක ඇත: {names}.",
    ta: "{asOf}, {river} இல் தகவல் தரும் {m} அளவீடுகளில் {n} எச்சரிக்கை அல்லது அதற்கு மேல் மட்டத்தில் உள்ளன: {names}.",
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
  const flagged = reporting.filter((s) => ["major", "minor", "alert"].includes(s.tier));
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
    en: "The official marks for this gauge are {list}. Alert means the river has reached the alert mark: move valuables up and charge your phone. Minor flood means water is spilling over low ground, and major flood means move to safety.",
    si: "මෙම මානයේ නිල මට්ටම්: {list}. අනතුරු ඇඟවීම යනු සූදානම් වීම, සුළු ගංවතුර යනු පහත් බිම්වලට ජලය පැමිණීම, ප්‍රධාන ගංවතුර යනු ආරක්ෂිත ස්ථානයකට යාමයි.",
    ta: "இந்த அளவீட்டின் அதிகாரப்பூர்வ மட்டங்கள்: {list}. எச்சரிக்கை என்பது தயாராக இருப்பது, சிறிய வெள்ளம் என்பது தாழ்ந்த நிலங்களில் நீர் புகுவது, பெரிய வெள்ளம் என்பது பாதுகாப்பான இடத்திற்குச் செல்வது.",
  },
  marksNone: { en: "No flood levels are published for this gauge, so it cannot be compared with an alert level.", si: "මෙම මානය සඳහා ගංවතුර මට්ටම් පළ කර නැත.", ta: "இந்த அளவீட்டுக்கு வெள்ள மட்டங்கள் வெளியிடப்படவில்லை." },
  alertWord: { en: "alert {v}", si: "අනතුරු ඇඟවීම {v}", ta: "எச்சரிக்கை {v}" },
  minorWord: { en: "minor flood {v}", si: "සුළු ගංවතුර {v}", ta: "சிறிய வெள்ளம் {v}" },
  majorWord: { en: "major flood {v}", si: "ප්‍රධාන ගංවතුර {v}", ta: "பெரிய வெள்ளம் {v}" },
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
  nhStation: { en: "Will the {river} at {name} rise in the next hour?", si: "{river} හි {name} හි ජල මට්ටම ඊළඟ පැය තුළ ඉහළ යාවිද?", ta: "{river} ஆற்றின் {name} இல் அடுத்த மணி நேரத்தில் நீர்மட்டம் உயருமா?" },
  nhStationNoRiver: { en: "Will the water level at {name} rise in the next hour?", si: "{name} හි ජල මට්ටම ඊළඟ පැය තුළ ඉහළ යාවිද?", ta: "{name} இல் அடுத்த மணி நேரத்தில் நீர்மட்டம் உயருமா?" },
  nhRiver: { en: "Will the {river} rise in the next hour?", si: "{river} ඊළඟ පැය තුළ ඉහළ යාවිද?", ta: "{river} ஆற்றில் அடுத்த மணி நேரத்தில் நீர்மட்டம் உயருமா?" },
  nhTown: { en: "Will {town} flood in the next hour?", si: "{town} ඊළඟ පැය තුළ ගංවතුරට යටවේද?", ta: "அடுத்த மணி நேரத்தில் {town} வெள்ளத்தில் மூழ்குமா?" },
  nhNote: {
    en: "This is a forecast from the recent trend, the gauges upstream and rain, not an official warning.",
    si: "මෙය මෑත ප්‍රවණතාව, ඉහළ මාන සහ වර්ෂාව මත පදනම් වූ පුරෝකථනයකි, නිල අනතුරු ඇඟවීමක් නොවේ.",
    ta: "இது சமீபத்திய போக்கு, மேல்நிலை நிலையங்கள் மற்றும் மழையை அடிப்படையாகக் கொண்ட முன்னறிவிப்பு, அதிகாரப்பூர்வ எச்சரிக்கை அல்ல.",
  },
  nhTownNote: {
    en: "This is a forecast for the river, not an official warning, and streets can flood before the river reaches a flood mark.",
    si: "මෙය ගඟ සඳහා පුරෝකථනයකි, නිල අනතුරු ඇඟවීමක් නොවේ; ගඟ ගංවතුර මට්ටමට පැමිණීමට පෙර වීදි ගංවතුරට යටවිය හැක.",
    ta: "இது ஆற்றுக்கான முன்னறிவிப்பு, அதிகாரப்பூர்வ எச்சரிக்கை அல்ல; ஆறு வெள்ள மட்டத்தை எட்டும் முன்பே தெருக்கள் வெள்ளத்தில் மூழ்கலாம்.",
  },
  nhRiverA: {
    en: "In the next hour, of the {m} gauges on the {river} with a forecast, {parts}.{cross}",
    si: "ඊළඟ පැය තුළ, පුරෝකථනයක් ඇති {river} හි මාන {m} න්: {parts}.{cross}",
    ta: "அடுத்த மணி நேரத்தில், முன்னறிவிப்பு உள்ள {river} இன் {m} நிலையங்களில்: {parts}.{cross}",
  },
  nhUp: { en: "{n} rising", si: "{n} ඉහළ යයි", ta: "{n} உயரும்" },
  nhSame: { en: "{n} about the same", si: "{n} පාහේ වෙනසක් නැත", ta: "{n} ஏறக்குறைய மாற்றமில்லை" },
  nhDown: { en: "{n} falling", si: "{n} පහළ යයි", ta: "{n} குறையும்" },
  rising: { en: "Is the {name} rising today?", si: "{name} අද ඉහළ යනවාද?", ta: "{name} இன்று உயர்கிறதா?" },
  risingStation: { en: "Is the water level at {name} rising today?", si: "{name} හි ජල මට්ටම අද ඉහළ යනවාද?", ta: "{name} இல் நீர்மட்டம் இன்று உயர்கிறதா?" },
  risingStationUp: { en: "Yes. Over the last 3 hours the level at {name} has been rising and is now {lv}.", si: "ඔව්. පසුගිය පැය 3 තුළ {name} හි මට්ටම ඉහළ ගොස් දැන් {lv} වේ.", ta: "ஆம். கடந்த 3 மணி நேரத்தில் {name} இல் மட்டம் உயர்ந்து இப்போது {lv}." },
  risingStationDown: { en: "No. Over the last 3 hours the level at {name} has been falling and is now {lv}.", si: "නැත. පසුගිය පැය 3 තුළ {name} හි මට්ටම පහළ ගොස් දැන් {lv} වේ.", ta: "இல்லை. கடந்த 3 மணி நேரத்தில் {name} இல் மட்டம் குறைந்து இப்போது {lv}." },
  risingStationSame: { en: "No. Over the last 3 hours the level at {name} has been steady at about {lv}.", si: "නැත. පසුගිය පැය 3 තුළ {name} හි මට්ටම {lv} පමණ ස්ථාවරයි.", ta: "இல்லை. கடந்த 3 மணி நேரத்தில் {name} இல் மட்டம் ஏறக்குறைய {lv} இல் நிலையாக உள்ளது." },
  risingRiverA: { en: "Over the last 3 hours, of the {m} gauges on the {river} that are reporting: {parts}.", si: "පසුගිය පැය 3 තුළ, වාර්තා කරන {river} හි මාන {m} න්: {parts}.", ta: "கடந்த 3 மணி நேரத்தில், தகவல் தரும் {river} இன் {m} நிலையங்களில்: {parts}." },
  nhCross: { en: " {names} may reach a flood mark.", si: " {names} ගංවතුර මට්ටමකට ළඟා විය හැක.", ta: " {names} வெள்ள மட்டத்தை எட்டலாம்." },
  townHow: { en: "How is the flood risk for {name} worked out?", si: "{name} සඳහා ගංවතුර අවදානම ගණනය කරන්නේ කෙසේද?", ta: "{name} க்கான வெள்ள அபாயம் எப்படிக் கணிக்கப்படுகிறது?" },
  townHowA: {
    en: "From the nearest river gauge ({gauge}, {km} away), recent and expected rain, the gauge's forecast and any official warning. It is an estimate for the town, not an official warning, and streets can flood before the river reaches a flood mark.",
    si: "ළඟම ඇති ගංගා මානයෙන් ({gauge}, {km} දුරින්), මෑත සහ අපේක්ෂිත වර්ෂාවෙන්, මානයේ පුරෝකථනයෙන් සහ නිල අනතුරු ඇඟවීම් වලින්. මෙය නගරය සඳහා ඇස්තමේන්තුවකි, නිල අනතුරු ඇඟවීමක් නොවේ.",
    ta: "அருகிலுள்ள ஆற்று அளவீட்டு நிலையம் ({gauge}, {km} தொலைவில்), சமீபத்திய மற்றும் எதிர்பார்க்கப்படும் மழை, முன்னறிவிப்பு மற்றும் அதிகாரப்பூர்வ எச்சரிக்கைகளிலிருந்து. இது நகரத்திற்கான மதிப்பீடு, அதிகாரப்பூர்வ எச்சரிக்கை அல்ல.",
  },
} satisfies Record<string, L3>;

export const faqHeading = (lang: Locale) => Q.heading[lang];

export function stationFaq(lang: Locale, s: NationalStation, answer: string, nh: NextHour | null = null): Faq[] {
  const name = stationDisplayName(s.station);
  const th = s.thresholds;
  const parts: string[] = [];
  const add = (d: L3, v: number | null) => v != null && parts.push(W(d, lang, { v: lvText(v, s.unit) }));
  add(Q.alertWord, th.alert);
  add(Q.minorWord, th.minor);
  add(Q.majorWord, th.major);
  const river = s.basin.trim() ? riverName(s.basin.trim(), lang) : "";
  const next = nextHourSentence(lang, nh, nextHourSubject(lang, s.basin, s.station));
  const rate = s.tier !== "stale" && s.latest ? s.rate3hM : null;
  const trendItem: Faq[] =
    rate == null || s.latest == null || s.latest.water_level == null
      ? []
      : [{ q: W(Q.risingStation, lang, { name }), a: W(Math.abs(rate) < STEADY ? Q.risingStationSame : rate > 0 ? Q.risingStationUp : Q.risingStationDown, lang, { name, lv: lvText(s.latest.water_level, s.unit) }) }];
  return [
    { q: W(Q.now, lang, { name }), a: answer },
    ...trendItem,
    ...(next ? [{ q: W(river ? Q.nhStation : Q.nhStationNoRiver, lang, { name, river }), a: `${next} ${W(Q.nhNote, lang)}` }] : []),
    { q: W(Q.marks, lang, { name }), a: parts.length ? W(Q.marksA, lang, { list: parts.join(", ") }) : W(Q.marksNone, lang) },
    { q: W(Q.source, lang), a: W(Q.sourceA, lang) },
  ];
}

export function riverFaq(
  lang: Locale,
  basin: string,
  answer: string,
  orderedStationNames: string[],
  next: { station: string; nh: NextHour | null }[] = [],
  /** Gauges on the river by the 3-hour direction of the level (null when no gauge has a trend). */
  trend: { up: number; down: number; same: number } | null = null,
): Faq[] {
  const river = riverName(basin, lang);
  const tm = trend ? trend.up + trend.down + trend.same : 0;
  const trendItem: Faq[] = trend && tm
    ? [{ q: W(Q.rising, lang, { name: river }), a: W(Q.risingRiverA, lang, { m: tm, river, parts: [trend.up && W(Q.nhUp, lang, { n: trend.up }), trend.same && W(Q.nhSame, lang, { n: trend.same }), trend.down && W(Q.nhDown, lang, { n: trend.down })].filter(Boolean).join(", ") }) }]
    : [];
  const have = next.filter((x): x is { station: string; nh: NextHour } => x.nh != null);
  const flat = (n: NextHour) => Math.abs(Number(n.change_ft.toFixed(1))) < 0.1;
  const up = have.filter((x) => !flat(x.nh) && x.nh.change_ft > 0).length;
  const down = have.filter((x) => !flat(x.nh) && x.nh.change_ft < 0).length;
  const same = have.length - up - down;
  const parts = [up && W(Q.nhUp, lang, { n: up }), same && W(Q.nhSame, lang, { n: same }), down && W(Q.nhDown, lang, { n: down })].filter(Boolean).join(", ");
  const reach = have.filter((x) => x.nh.crossing).map((x) => stationDisplayName(x.station));
  const nhItem: Faq[] = have.length
    ? [{ q: W(Q.nhRiver, lang, { river }), a: `${W(Q.nhRiverA, lang, { m: have.length, river, parts, cross: reach.length ? W(Q.nhCross, lang, { names: reach.join(", ") }) : "" })} ${W(Q.nhNote, lang)}` }]
    : [];
  return [
    { q: W(Q.now, lang, { name: river }), a: answer },
    ...trendItem,
    ...nhItem,
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

export function townFaq(
  lang: Locale,
  town: string,
  answer: string,
  gauge: { name: string; km: string } | null,
  next: { basin: string; station: string; nh: NextHour | null } | null = null,
): Faq[] {
  const out: Faq[] = [{ q: W(Q.now, lang, { name: town }), a: answer }];
  const sentence = next ? nextHourSentence(lang, next.nh, nextHourSubject(lang, next.basin, next.station)) : null;
  if (sentence) out.push({ q: W(Q.nhTown, lang, { town }), a: `${answer} ${sentence} ${W(Q.nhTownNote, lang)}` });
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
