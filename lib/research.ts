// Text and constants for the research pages (/research and /research/wellampitiya-street-flooding).
// The long article is English only; Sinhala and Tamil get the answer and the key findings (machine-drafted,
// flagged for native review) and the rest links back to the English text. Numbers come from
// research/wellampitiya-flood-rule-backtest.md, "Validation (complete)": change them there first.
import { abs, OWNER, SITE, publisherLd } from "./seo";
import type { Locale } from "./i18n/config";

export const WF_PATH = "/research/wellampitiya-street-flooding";
export const WF_PUBLISHED = "2026-10-24";
export const WF_MODIFIED = "2026-10-24";
export const WF_IMG = "/research/wellampitiya";
export const WF_CSV = "/research/wellampitiya-flood-events.csv";
export const GSMAP_CREDIT = "GSMaP data by Japan Aerospace Exploration Agency (JAXA).";

type L3 = Record<Locale, string>;

export const WF_TITLE: L3 = {
  en: "Street flooding in Wellampitiya and Kolonnawa: what the data shows",
  si: "වෙල්ලම්පිටිය සහ කොළොන්නාවේ වීදි ගංවතුර: දත්ත පෙන්වන දේ",
  ta: "வெல்லம்பிட்டி மற்றும் கொலன்னாவ தெரு வெள்ளம்: தரவு காட்டுவது",
};

export const WF_DESC: L3 = {
  en: "16 documented floods since 2018: 9 came with the Kelani at minor flood level, 6 with a normal river. How satellite rain warns of street water here, how well it works, and what does not help.",
  si: "2018 සිට වාර්තා වූ ගංවතුර 16ක්: 9ක් කැලණි ගඟ සුළු ගංවතුර මට්ටමේ තිබියදී, 6ක් ගඟ සාමාන්‍ය මට්ටමේ තිබියදී. චන්ද්‍රිකා වැසි දත්ත මගින් වීදි ජලය ගැන අනතුරු ඇඟවිය හැකි ආකාරය.",
  ta: "2018 முதல் பதிவான 16 வெள்ளங்கள்: 9 இல் களனி கங்கை சிறு வெள்ள மட்டத்தில், 6 இல் ஆறு இயல்பாக இருந்தது. செயற்கைக்கோள் மழை தரவு தெரு நீர் பற்றி எச்சரிப்பது எப்படி.",
};

export const WF_ANSWER: L3 = {
  en: "Streets in Wellampitiya and Kolonnawa often fill with water after heavy local rain even when the Kelani Ganga is well below its flood levels. Of 16 documented floods since 2018, the river was at its minor flood level in 9 and normal in 6 (one has no river record). We tested a simple rule on more than nine years of satellite rain and river readings: street water is possible when 24 hours of satellite rain reach 60 mm, and likely at 100 mm or when the river reaches its minor level. On 22 October 2026 the rule fired about 15 hours before a resident reported water on a street.",
  si: "වෙල්ලම්පිටිය සහ කොළොන්නාවේ වීදිවලට වතුර පිරෙන්නේ බොහෝ විට, කැලණි ගඟ ගංවතුර මට්ටම්වලට වඩා බොහෝ පහළින් තිබියදී ඇති වන තද ප්‍රාදේශීය වැසි නිසාය. 2018 සිට වාර්තා වූ ගංවතුර 16න් 9කදී ගඟ සුළු ගංවතුර මට්ටමේ තිබූ අතර 6කදී සාමාන්‍ය මට්ටමේ තිබුණි. චන්ද්‍රිකා වැසි දත්ත සහ ගංගා මට්ටම් වසර නවයකට වඩා පරීක්ෂා කර සරල රීතියක් සකස් කළෙමු: පැය 24ක චන්ද්‍රිකා වැසි මිලිමීටර් 60ට ළඟා වූ විට වීදිවලට වතුර පිරිය හැක; මිලිමීටර් 100ට හෝ ගඟ සුළු ගංවතුර මට්ටමට ළඟා වූ විට පිරීමට ඉඩ වැඩිය. 2026 ඔක්තෝබර් 22 දා ප්‍රදේශවාසියෙක් වීදියේ වතුර ගැන වාර්තා කිරීමට පැය 15කට පමණ පෙර මෙම රීතිය අනතුරු අඟවා තිබුණි.",
  ta: "வெல்லம்பிட்டி மற்றும் கொலன்னாவ தெருக்களில், களனி கங்கை வெள்ள மட்டங்களுக்குக் கணிசமாகக் கீழே இருக்கும்போதும், உள்ளூரில் பெய்யும் கனமழைக்குப் பின் அடிக்கடி நீர் தேங்குகிறது. 2018 முதல் பதிவான 16 வெள்ளங்களில் 9 இல் ஆறு சிறு வெள்ள மட்டத்திலும், 6 இல் இயல்பான மட்டத்திலும் இருந்தது. ஒன்பது ஆண்டுகளுக்கு மேலான செயற்கைக்கோள் மழை மற்றும் ஆற்று மட்டத் தரவில் ஒரு எளிய விதியைச் சோதித்தோம்: 24 மணி நேர செயற்கைக்கோள் மழை 60 மிமீ ஆனால் தெருவில் நீர் தேங்கக்கூடும்; 100 மிமீ ஆனால், அல்லது ஆறு சிறு வெள்ள மட்டத்தை அடைந்தால், தேங்க வாய்ப்பு அதிகம். 2026 அக்டோபர் 22 அன்று ஒரு குடியிருப்பாளர் தெருவில் நீர் இருப்பதாகத் தெரிவிப்பதற்குச் சுமார் 15 மணி நேரம் முன்பே இந்த விதி எச்சரித்தது.",
};

export const WF_FINDINGS: Record<Locale, { h: string; p: string }[]> = {
  en: [], // the English findings are written out in the page, with links and figures
  si: [
    { h: "ගංවතුර වර්ග දෙකක්", p: "ගංවතුර 16න් 9කදී කැලණි ගඟ සුළු ගංවතුර මට්ටමේ තිබුණි. 6ක් ඇති වූයේ ගඟ සාමාන්‍ය මට්ටමේ තිබියදීය (ගඟ මානයන් දෙකම සුළු ගංවතුර මට්ටමෙන් 11% සිට 84% අතර). එවැනි ගංවතුර ගඟ මානයන් මගින් පෙන්වන්නේ නැත; ඒවා ප්‍රාදේශීය වැසි සහ කාණු ජලය නිසාය." },
    { h: "රීතිය", p: "පැය 24ක චන්ද්‍රිකා වැසි (JAXA GSMaP) මිලිමීටර් 60: \"වීදි ජලය සිදුවිය හැක\". මිලිමීටර් 100 හෝ කැලණි ගඟ සුළු ගංවතුර මට්ටමට: \"සිදුවීමට ඉඩ වැඩිය\". එක් පැයක වැස්ස මිලිමීටර් 15කට සීමා කර එකතු කරයි." },
    { h: "එය කෙතරම් හොඳින් ක්‍රියා කරයිද", p: "\"ඉඩ වැඩිය\": ගංවතුර 16න් 11ක් අල්ලා ගනී (95% විශ්වාස පරාසය 7-14), වසරකට වාර්තාගත ගංවතුරක් නොමැති අවස්ථා 1.3ක්. \"සිදුවිය හැක\": 16න් 12ක්, නමුත් වසරකට 8ක් පමණ වාර්තාගත ගංවතුරක් නොමැති ඇඟවීම්; එය කලින් දෙන සටහනක් පමණි. වාර්තා නොවූ කුඩා ගංවතුර බොහෝ ඇති බැවින් ඇත්ත අසත්‍ය ඇඟවීම් මීට අඩුය." },
    { h: "අනතුරු ඇඟවීමේ කාලය", p: "2026 ඔක්තෝබර් 22: වැස්ස ඔක්තෝබර් 21 රාත්‍රියේ පටන් ගත් අතර රීතිය පැය 15කට පමණ පෙර අනතුරු ඇඟවීය. මෙය නිරීක්ෂිත වැස්සකි, පුරෝකථනයක් නොවේ; අනෙක් ගංවතුරවලදී කාලය කෙටිය." },
    { h: "ප්‍රයෝජනයක් නැති දේ", p: "මුහුදු උදම් (±12 සෙ.මී.), කෙටි කාලීන වැසි පිපිරීම්, කාලගුණ ආකෘති වැස්ස, උස් බිම් සිතියම් (1-1.6 මීටර් දෝෂය) සහ ඝන නාගරික ප්‍රදේශවල රේඩාර් චන්ද්‍රිකා රූප ප්‍රයෝජනවත් නොවීය." },
    { h: "සීමා", p: "ගංවතුර 16ක් කුඩා නියැදියකි. චන්ද්‍රිකා වැස්ස මැනුම් ආමානයකට වඩා දුර්වලය. මෙය නිල අනතුරු ඇඟවීමක් නොවේ; හදිසි අවස්ථාවක 117 අමතන්න." },
  ],
  ta: [
    { h: "இரண்டு வகை வெள்ளங்கள்", p: "16 வெள்ளங்களில் 9 இல் களனி கங்கை சிறு வெள்ள மட்டத்தில் இருந்தது. 6 இல் ஆறு இயல்பாக இருந்தது (இரு அளவீட்டு நிலையங்களும் சிறு வெள்ள மட்டத்தில் 11% முதல் 84% வரை). அவற்றை ஆற்று அளவீடுகள் காட்டாது; அவை உள்ளூர் மழை மற்றும் வடிகால் நீரால் ஏற்பட்டவை." },
    { h: "விதி", p: "24 மணி நேர செயற்கைக்கோள் மழை (JAXA GSMaP) 60 மிமீ: \"தெருவில் நீர் தேங்கலாம்\". 100 மிமீ அல்லது களனி கங்கை சிறு வெள்ள மட்டத்தில்: \"தேங்க வாய்ப்பு அதிகம்\". ஒரு மணி நேர மழை 15 மிமீக்கு மேல் கணக்கிடப்படாது." },
    { h: "எவ்வளவு நன்றாக வேலை செய்கிறது", p: "\"வாய்ப்பு அதிகம்\": 16 வெள்ளங்களில் 11 ஐப் பிடிக்கிறது (95% நம்பகத்தன்மை வரம்பு 7-14), ஆண்டுக்கு பதிவான வெள்ளம் இல்லாத எச்சரிக்கைகள் சுமார் 1.3. \"தேங்கலாம்\": 16 இல் 12, ஆனால் ஆண்டுக்கு சுமார் 8 பதிவில்லா எச்சரிக்கைகள்; இது முன்கூட்டிய குறிப்பு மட்டுமே. பதிவாகாத சிறு வெள்ளங்கள் பல என்பதால் உண்மையான தவறான எச்சரிக்கைகள் இதைவிடக் குறைவு." },
    { h: "எச்சரிக்கை நேரம்", p: "2026 அக்டோபர் 22: மழை அக்டோபர் 21 இரவு தொடங்கியது; விதி சுமார் 15 மணி நேரம் முன்பே எச்சரித்தது. இது கவனிக்கப்பட்ட மழை, முன்னறிவிப்பு அல்ல; பிற வெள்ளங்களில் நேரம் குறைவு." },
    { h: "உதவாதவை", p: "கடல் அலை (±12 செ.மீ), குறுகிய கால மழை உச்சங்கள், வானிலை மாதிரி மழை, உயர வரைபடங்கள் (1-1.6 மீ பிழை), அடர்ந்த நகரப் பகுதிகளில் ரேடார் செயற்கைக்கோள் படங்கள்." },
    { h: "வரம்புகள்", p: "16 வெள்ளங்கள் சிறிய மாதிரி. செயற்கைக்கோள் மழை மழைமானியைவிட பலவீனமான அளவீடு. இது அதிகாரப்பூர்வ எச்சரிக்கை அல்ல; அவசரத்தில் 117 ஐ அழைக்கவும்." },
  ],
};

export const WF_I18N: Record<Locale, { note: string; findings: string; english: string; read: string; indexH: string; indexIntro: string; crumb: string; updated: string }> = {
  en: { note: "", findings: "Key findings", english: "", read: "Read the full research", indexH: "Research", indexIntro: "Independent studies behind the warnings on this site: how they were made, the numbers, and where they can be wrong.", crumb: "Research", updated: "Last updated" },
  si: { note: "සිංහල සාරාංශය යන්ත්‍ර පරිවර්තන කෙටුම්පතකි; දේශීය භාෂා සමාලෝචනයක් බලාපොරොත්තුවෙන් සිටී. සම්පූර්ණ පර්යේෂණය ඉංග්‍රීසියෙන් පහත ඇත.", findings: "ප්‍රධාන සොයාගැනීම්", english: "සම්පූර්ණ පර්යේෂණය (ඉංග්‍රීසියෙන්)", read: "සම්පූර්ණ පර්යේෂණය කියවන්න", indexH: "පර්යේෂණ", indexIntro: "මෙම අඩවියේ අනතුරු ඇඟවීම් පිටුපස ඇති ස්වාධීන අධ්‍යයන.", crumb: "පර්යේෂණ", updated: "අවසන් යාවත්කාලීනය" },
  ta: { note: "தமிழ் சுருக்கம் இயந்திர மொழிபெயர்ப்பு வரைவு; தாய்மொழி மதிப்பாய்வு நிலுவையில் உள்ளது. முழு ஆய்வு கீழே ஆங்கிலத்தில் உள்ளது.", findings: "முக்கிய கண்டுபிடிப்புகள்", english: "முழு ஆய்வு (ஆங்கிலத்தில்)", read: "முழு ஆய்வைப் படிக்கவும்", indexH: "ஆய்வுகள்", indexIntro: "இந்தத் தளத்தின் எச்சரிக்கைகளுக்குப் பின்னால் உள்ள சுயாதீன ஆய்வுகள்.", crumb: "ஆய்வுகள்", updated: "கடைசியாகப் புதுப்பிக்கப்பட்டது" },
};

export const WF_CITE = `${OWNER.name} (${WF_PUBLISHED}). ${WF_TITLE.en}. Sri Lanka Water Levels. ${SITE}${WF_PATH}`;

/** Article + Dataset nodes for the research page. */
export function wfArticleLd(lang: Locale, _publisherId?: string) {
  const url = abs(lang, WF_PATH);
  const place = { "@type": "Place", name: "Wellampitiya and Kolonnawa, Colombo, Sri Lanka", geo: { "@type": "GeoCoordinates", latitude: 6.9, longitude: 79.9 } };
  return [
    {
      "@type": "ScholarlyArticle",
      "@id": `${url}#article`,
      headline: WF_TITLE[lang],
      description: WF_DESC[lang],
      url,
      mainEntityOfPage: url,
      inLanguage: lang,
      datePublished: WF_PUBLISHED,
      dateModified: WF_MODIFIED,
      author: { "@type": "Person", name: OWNER.name, url: OWNER.x, sameAs: [OWNER.x, OWNER.github] },
      publisher: publisherLd(),
      image: `${SITE}${WF_IMG}/22-oct-2026-timeline.png`,
      about: ["Pluvial flooding", "Urban flood warning", "Kelani Ganga", "Wellampitiya", "Kolonnawa", "Sri Lanka"],
      keywords: ["Wellampitiya flood", "Kolonnawa flood", "street flooding", "satellite rainfall", "GSMaP", "Kelani Ganga", "Sri Lanka"],
      spatialCoverage: place,
      temporalCoverage: "2017-03-29/2026-10-22",
      isBasedOn: { "@id": `${url}#dataset` },
      isAccessibleForFree: true,
      citation: [
        "Japan Aerospace Exploration Agency (JAXA), GSMaP_NOW and GSMaP_NRT global satellite rainfall, https://sharaku.eorc.jaxa.jp/GSMaP/",
        "Disaster Management Centre, Sri Lanka, situation reports and river water level reports, https://www.dmc.gov.lk/",
        "Department of Irrigation, Sri Lanka, river gauge readings, https://www.irrigation.gov.lk/",
        "Copernicus Emergency Management Service, rapid mapping EMSR851, https://rapidmapping.emergency.copernicus.eu/",
        "Sri Lanka Meteorological Department synoptic rainfall via OGIMET and NOAA GHCN-Daily",
      ],
    },
    {
      "@type": "Dataset",
      "@id": `${url}#dataset`,
      name: "Documented street floods in Wellampitiya and Kolonnawa, 2018-2026, with satellite rain, rain gauge and river readings",
      description:
        "Sixteen documented floods with the date they began, the highest Nagalagam Street and Hanwella readings around them, 24-hour GSMaP_NOW satellite rain and the heaviest of three Colombo-area rain gauges. Compiled by the site owner from Disaster Management Centre reports, news and public gauge archives. Rain: GSMaP data by Japan Aerospace Exploration Agency (JAXA).",
      url,
      inLanguage: "en",
      isAccessibleForFree: true,
      license: `${SITE}/about#data-sources`,
      creator: publisherLd(),
      publisher: publisherLd(),
      isBasedOn: ["https://www.dmc.gov.lk/", "https://www.irrigation.gov.lk/", "https://sharaku.eorc.jaxa.jp/GSMaP/"],
      keywords: ["flood", "Wellampitiya", "Kolonnawa", "Kelani Ganga", "GSMaP", "Sri Lanka"],
      temporalCoverage: "2018-10-06/2026-10-22",
      spatialCoverage: place,
      variableMeasured: [
        { "@type": "PropertyValue", name: "Satellite rain in 24 hours", unitText: "mm" },
        { "@type": "PropertyValue", name: "Heaviest rain gauge in 24 hours", unitText: "mm" },
        { "@type": "PropertyValue", name: "Nagalagam Street river level", unitText: "feet" },
        { "@type": "PropertyValue", name: "Hanwella river level", unitText: "metres" },
      ],
      distribution: [{ "@type": "DataDownload", name: "Flood events table (CSV)", encodingFormat: "text/csv", contentUrl: `${SITE}${WF_CSV}` }],
    },
  ];
}
