// Every title, H1 and meta description the search engines read, in one file (en / si / ta). Pages never hand-write these:
// lib/seoMeta.ts fills the {placeholders} from live data and the alias tables in lib/seoNames.ts. Rules in DOCS.md "SEO".
//
// Wording follows what people type (Search Console, 26 Oct 2026): "<river> water level today (live)", "<gauge> water level",
// "<town> flood level", never "basin". English titles stay near 60 characters (phones cut at about 55-60).
// si / ta are DRAFTS that need native review: "අද" / "இன்று" (today) come first because that is the typing order, then the
// everyday words (ගඟේ ජල මට්ටම, ගංවතුර / ஆற்றின் நீர் மட்டம், வெள்ளம்).
import type { Locale } from "./config";

type L3 = Record<Locale, string>;

export const SEO = {
  // ---- home
  "home.title": {
    en: "Sri Lanka River Water Levels Today (Live) & Flood Alerts",
    si: "අද ශ්‍රී ලංකා ගංගා ජල මට්ටම් (සජීවී) සහ ගංවතුර අනතුරු ඇඟවීම්",
    ta: "இன்று இலங்கை ஆற்று நீர் மட்டம் (நேரடி) & வெள்ள எச்சரிக்கை",
  },
  "home.desc": {
    en: "Live water level of every river gauge in Sri Lanka, with official flood levels and a next-hour forecast. Kelani, Kalu, Gin, Nilwala, Mahaweli. Updated hourly.",
    si: "අද ශ්‍රී ලංකාවේ සෑම ගංගා මානයකම සජීවී ජල මට්ටම, නිල ගංවතුර මට්ටම් සහ ඊළඟ පැය පුරෝකථනය. කැලණි, කළු, ගිං, නිල්වලා, මහවැලි සහ තවත්. පැයකට වරක් යාවත්කාලීන වේ.",
    ta: "இன்று இலங்கையின் ஒவ்வொரு ஆற்று அளவீட்டு நிலையத்தின் நேரடி நீர் மட்டம், அதிகாரப்பூர்வ வெள்ள மட்டங்கள், அடுத்த மணி நேர முன்னறிவிப்பு. களனி, களு, கின், நில்வளா, மகாவலி மற்றும் பல. ஒவ்வொரு மணி நேரமும் புதுப்பிக்கப்படும்.",
  },
  "home.h1": {
    en: "River water levels in Sri Lanka today",
    si: "අද ශ්‍රී ලංකාවේ ගංගා ජල මට්ටම",
    ta: "இன்று இலங்கை ஆற்று நீர் மட்டம்",
  },

  // ---- /rivers index
  "rivers.title": {
    en: "River Water Levels in Sri Lanka Today (Live)",
    si: "අද ශ්‍රී ලංකා ගංගා ජල මට්ටම් (සජීවී) - සියලු ගංගා",
    ta: "இன்று இலங்கை ஆறுகளின் நீர் மட்டம் (நேரடி) - அனைத்து ஆறுகள்",
  },
  "rivers.desc": {
    en: "Every Sri Lankan river with a live gauge and its official step today (Normal, Alert, Minor flood, Major flood): Kelani, Kalu, Gin, Nilwala, Mahaweli and {n} more.",
    si: "ජල මට්ටම් මානයක් ඇති ශ්‍රී ලංකාවේ සෑම ගඟකම අද නිල මට්ටම (සාමාන්‍ය, අනතුරු ඇඟවීම, සුළු ගංවතුර, ප්‍රධාන ගංවතුර): කැලණි, කළු, ගිං, නිල්වලා, මහවැලි සහ තවත් {n}. වාරිමාර්ග දෙපාර්තමේන්තුවෙන් සජීවී.",
    ta: "நீர் மட்ட அளவீட்டு நிலையம் உள்ள இலங்கையின் ஒவ்வொரு ஆறும், இன்றைய அதிகாரப்பூர்வ நிலையுடன் (இயல்பு, எச்சரிக்கை, சிறிய வெள்ளம், பெரிய வெள்ளம்): களனி, களு, கின், நில்வளா, மகாவலி மற்றும் {n} மேலும். நீர்ப்பாசனத் திணைக்களத்திலிருந்து நேரடி.",
  },
  "rivers.h1": { en: "River water levels in Sri Lanka today", si: "අද ශ්‍රී ලංකාවේ ගංගා ජල මට්ටම", ta: "இன்று இலங்கை ஆறுகளின் நீர் மட்டம்" },
  "rivers.lead": {
    en: "Every river we have a live gauge for, worst first. Tap a river for its gauges, the flood levels and the next-hour forecast.",
    si: "සජීවී මානයක් ඇති සෑම ගඟක්ම, නරකම පළමුව. එහි මාන, ගංවතුර මට්ටම් සහ ඊළඟ පැය පුරෝකථනය සඳහා ගඟක් තට්ටු කරන්න.",
    ta: "நேரடி அளவீட்டு நிலையம் உள்ள ஒவ்வொரு ஆறும், மோசமானது முதலில். அதன் நிலையங்கள், வெள்ள மட்டங்கள், அடுத்த மணி நேர முன்னறிவிப்புக்கு ஆற்றைத் தொடவும்.",
  },
  "rivers.gauges": { en: "{n} gauges", si: "මාන {n}", ta: "{n} நிலையங்கள்" },
  "rivers.gauge1": { en: "1 gauge", si: "මාන 1", ta: "1 நிலையம்" },
  "rivers.worstAt": { en: "{step} at {gauge}", si: "{gauge}: {step}", ta: "{gauge}: {step}" },
  "rivers.gaugeLink": { en: "{gauge} water level", si: "{gauge} ජල මට්ටම", ta: "{gauge} நீர் மட்டம்" },
  "rivers.link": { en: "{river} water level", si: "{river} ජල මට්ටම", ta: "{river} நீர் மட்டம்" },
  "rivers.also": { en: "Also searched as {list}", si: "{list} ලෙසද සොයයි", ta: "{list} என்றும் தேடப்படுகிறது" },
  "rivers.noneReporting": { en: "No gauge reporting right now", si: "මාන කිසිවක් දැන් වාර්තා නොකරයි", ta: "இப்போது எந்த நிலையமும் தகவல் தரவில்லை" },
  "rivers.ldName": { en: "River water levels in Sri Lanka today", si: "අද ශ්‍රී ලංකා ගංගා ජල මට්ටම", ta: "இன்று இலங்கை ஆறுகளின் நீர் மட்டம்" },

  // ---- river page ({lead} = "Kelani River", {alt} = "Kelani Ganga")
  "river.title": {
    en: "{lead} Water Level Today (Live) – {alt}",
    si: "අද {native} ජල මට්ටම (සජීවී) – {alt}",
    ta: "இன்று {native} நீர் மட்டம் (நேரடி) – {alt}",
  },
  "river.titleNoAlt": {
    en: "{lead} Water Level Today (Live)",
    si: "අද {native} ජල මට්ටම (සජීවී)",
    ta: "இன்று {native} நீர் மட்டம் (நேரடி)",
  },
  "river.desc": {
    en: "Live {lead} water level at {gauges}.{now} Alert, minor and major flood levels and a next-hour forecast. Updated hourly.",
    si: "අද {native} ජල මට්ටම: {gauges}.{now} වාරිමාර්ග දෙපාර්තමේන්තුවේ නිල අනතුරු ඇඟවීම, සුළු සහ ප්‍රධාන ගංවතුර මට්ටම් සහ ඊළඟ පැය පුරෝකථනය. {rom}",
    ta: "இன்று {native} நீர் மட்டம்: {gauges}.{now} நீர்ப்பாசனத் திணைக்களத்தின் அதிகாரப்பூர்வ எச்சரிக்கை, சிறிய மற்றும் பெரிய வெள்ள மட்டங்கள், அடுத்த மணி நேர முன்னறிவிப்பு. {rom}",
  },
  "river.h1": { en: "{lead} water level today", si: "අද {native} ජල මට්ටම", ta: "இன்று {native} நீர் மட்டம்" },
  "river.also": {
    en: "Also called {list}. Live gauges, flood levels and the next-hour forecast.",
    si: "{list} ලෙසද හැඳින්වේ. සජීවී මාන, ගංවතුර මට්ටම් සහ ඊළඟ පැය පුරෝකථනය.",
    ta: "{list} என்றும் அழைக்கப்படுகிறது. நேரடி நிலையங்கள், வெள்ள மட்டங்கள், அடுத்த மணி நேர முன்னறிவிப்பு.",
  },

  // ---- gauge page
  "gauge.title": {
    en: "{gauge} Water Level Today – {river} (Live)",
    si: "අද {gauge} ජල මට්ටම – {river} (සජීවී)",
    ta: "இன்று {gauge} நீர் மட்டம் – {river} (நேரடி)",
  },
  // a river with one gauge has no river page (it redirects here), so this page carries the river's own query
  "gauge.titleOne": {
    en: "{river} Water Level Today – {gauge} (Live)",
    si: "අද {river} ජල මට්ටම – {gauge} (සජීවී)",
    ta: "இன்று {river} நீர் மட்டம் – {gauge} (நேரடி)",
  },
  "gauge.desc": {
    en: "Live {gauge} water level on the {river}: {level}, {status}. {gauge} flood level: alert {alert}, minor {minor}, major {major}. Next-hour forecast.",
    si: "අද {gauge} ජල මට්ටම ({river}): {level}, {status}. {gauge} ගංවතුර මට්ටම්: අනතුරු ඇඟවීම {alert}, සුළු ගංවතුර {minor}, ප්‍රධාන ගංවතුර {major}. ඊළඟ පැය පුරෝකථනය සමඟ.",
    ta: "இன்று {gauge} நீர் மட்டம் ({river}): {level}, {status}. {gauge} வெள்ள மட்டங்கள்: எச்சரிக்கை {alert}, சிறிய வெள்ளம் {minor}, பெரிய வெள்ளம் {major}. அடுத்த மணி நேர முன்னறிவிப்புடன்.",
  },
  "gauge.descNone": {
    en: "Live {gauge} water level on the {river}, Sri Lanka, with the Department of Irrigation's alert, minor flood and major flood levels and a next-hour forecast.",
    si: "අද {gauge} ජල මට්ටම ({river}), වාරිමාර්ග දෙපාර්තමේන්තුවේ අනතුරු ඇඟවීම, සුළු සහ ප්‍රධාන ගංවතුර මට්ටම් සහ ඊළඟ පැය පුරෝකථනය සමඟ.",
    ta: "இன்று {gauge} நீர் மட்டம் ({river}), நீர்ப்பாசனத் திணைக்களத்தின் எச்சரிக்கை, சிறிய மற்றும் பெரிய வெள்ள மட்டங்கள், அடுத்த மணி நேர முன்னறிவிப்புடன்.",
  },
  "gauge.h1": { en: "{gauge} water level today", si: "අද {gauge} ජල මට්ටම", ta: "இன்று {gauge} நீர் மட்டம்" },
  "gauge.h1One": { en: "{river} water level today at {gauge}", si: "අද {river} ජල මට්ටම ({gauge})", ta: "இன்று {river} நீர் மட்டம் ({gauge})" },
  "gauge.sub": { en: "{gauge} flood level and live gauge reading", si: "{gauge} ගංවතුර මට්ටම සහ සජීවී මානය", ta: "{gauge} வெள்ள மட்டமும் நேரடி அளவீடும்" },

  // ---- town
  "town.title": {
    en: "Is {town} flooding today? Live flood level",
    si: "අද {town} ගංවතුරද? සජීවී ගං මට්ටම",
    ta: "இன்று {town} வெள்ளமா? நேரடி ஆற்று மட்டம்",
  },
  "town.desc": {
    en: "Is {town} flooding today? Live river level from the {gauge} gauge, rain at the town and official warnings, with a next-hour forecast. Updated every few minutes.",
    si: "අද {town} ගංවතුරට යටද? {gauge} මානයේ සජීවී ගං මට්ටම, නගරයේ වැසි සහ නිල අනතුරු ඇඟවීම්, ඊළඟ පැය පුරෝකථනය සමඟ.",
    ta: "இன்று {town} வெள்ளத்தில் உள்ளதா? {gauge} நிலையத்தின் நேரடி ஆற்று மட்டம், நகரின் மழை, அதிகாரப்பூர்வ எச்சரிக்கைகள், அடுத்த மணி நேர முன்னறிவிப்புடன்.",
  },
  "town.descNoGauge": {
    en: "Is {town} flooding today? Flood estimate from the nearest river gauge, rain at the town and official warnings. Updated every few minutes.",
    si: "අද {town} ගංවතුරට යටද? ආසන්නතම ගං මානය, නගරයේ වැසි සහ නිල අනතුරු ඇඟවීම් අනුව ඇස්තමේන්තුව.",
    ta: "இன்று {town} வெள்ளத்தில் உள்ளதா? அருகிலுள்ள ஆற்று நிலையம், நகரின் மழை, அதிகாரப்பூர்வ எச்சரிக்கைகளின் அடிப்படையில் மதிப்பீடு.",
  },
  "town.h1": { en: "Is {town} flooding today?", si: "අද {town} ගංවතුරට යටද?", ta: "இன்று {town} வெள்ளத்தில் உள்ளதா?" },
  "town.also": { en: "Also searched as {list}.", si: "{list} ලෙසද සොයයි.", ta: "{list} என்றும் தேடப்படுகிறது." },

  // ---- reservoir page and index
  "rsv.title": {
    en: "{name} Reservoir Water Level & Spill Today",
    si: "අද {name} ජලාශයේ ජල මට්ටම සහ වාන් දොරටු",
    ta: "இன்று {name} நீர்த்தேக்க நீர் மட்டமும் வான்கதவுகளும்",
  },
  "rsv.h1": { en: "{name} water level today", si: "අද {name} ජල මට්ටම", ta: "இன்று {name} நீர் மட்டம்" },
  "rsv.also": {
    en: "Also searched as {list}.",
    si: "{list} ලෙසද සොයයි.",
    ta: "{list} என்றும் தேடப்படுகிறது.",
  },
  "rsv.descTail": { en: "Water level, storage and spill gates today.", si: "අද ජල මට්ටම, ගබඩාව සහ වාන් දොරටු.", ta: "இன்றைய நீர் மட்டம், சேமிப்பு, வான்கதவுகள்." },
  "rsvIndex.title": {
    en: "Reservoir & Dam Water Levels Sri Lanka Today",
    si: "අද ශ්‍රී ලංකා ජලාශ ජල මට්ටම් සහ වාන් දොරටු",
    ta: "இன்று இலங்கை நீர்த்தேக்க நீர் மட்டம் & வான்கதவுகள்",
  },
  "rsvIndex.desc": {
    en: "Water level, storage and spill gates today for {n} reservoirs and dams: Kotmale, Victoria, Randenigala, Rantembe, Laxapana, Castlereagh and more.",
    si: "අද ශ්‍රී ලංකාවේ ජලාශ {n}ක ජල මට්ටම, ගබඩාව සහ වාන් දොරටු: කොත්මලේ, වික්ටෝරියා, රන්ඩෙනිගල, රන්තඹේ, ලක්ෂපාන සහ තවත්. දැන් විවෘත දොරටු මොනවාද.",
    ta: "இன்று இலங்கையின் {n} நீர்த்தேக்கங்களின் நீர் மட்டம், சேமிப்பு, வான்கதவுகள்: கொத்மலை, விக்டோரியா, ரந்தெனிகல, ரன்தெம்பே, லக்ஷபான மற்றும் பல. இப்போது திறந்த கதவுகள் எவை.",
  },
  "rsvIndex.h1": { en: "Reservoir and dam water levels today", si: "අද ජලාශ ජල මට්ටම්", ta: "இன்று நீர்த்தேக்க நீர் மட்டங்கள்" },

  // ---- town index
  "flood.title": {
    en: "Is My Town Flooding? Live Flood Check, {n} Towns",
    si: "අද මගේ නගරය ගංවතුරද? ගංවතුර පරීක්ෂාව, නගර {n}",
    ta: "இன்று என் நகரம் வெள்ளமா? நேரடிச் சோதனை, {n} நகரங்கள்",
  },
  "flood.desc": {
    en: "Is your town flooding today? Live flood estimate for {n} Sri Lankan towns from the nearest river gauge, rain and official warnings.",
    si: "අද ඔබේ නගරය ගංවතුරට යටද? ආසන්නතම ගං මානය, වැසි සහ නිල අනතුරු ඇඟවීම් අනුව ශ්‍රී ලංකා නගර {n}ක සජීවී ඇස්තමේන්තුව.",
    ta: "இன்று உங்கள் நகரம் வெள்ளத்தில் உள்ளதா? அருகிலுள்ள ஆற்று நிலையம், மழை, அதிகாரப்பூர்வ எச்சரிக்கைகளின் அடிப்படையில் {n} இலங்கை நகரங்களின் நேரடி மதிப்பீடு.",
  },
  "flood.h1": { en: "Is my town flooding today?", si: "අද මගේ නගරය ගංවතුරට යටද?", ta: "இன்று என் நகரம் வெள்ளத்தில் உள்ளதா?" },

  // ---- rain, news, help, canals, history
  "rain.title": { en: "Sri Lanka Rain Map (Live) – Rainfall Today", si: "අද ශ්‍රී ලංකා වැසි සිතියම (සජීවී)", ta: "இன்று இலங்கை மழை வரைபடம் (நேரடி)" },
  "rain.desc": {
    en: "Live rain map of Sri Lanka: satellite rain over the last 24 hours, the next 24 hours of forecast, and rain at every river gauge.",
    si: "අද ශ්‍රී ලංකාවේ සජීවී වැසි සිතියම: පසුගිය පැය 24 චන්ද්‍රිකා වැසි, ඊළඟ පැය 24 අනාවැකිය, සහ සෑම ගං මානයකම වැසි සහ මට්ටම.",
    ta: "இன்று இலங்கையின் நேரடி மழை வரைபடம்: கடந்த 24 மணி நேர செயற்கைக்கோள் மழை, அடுத்த 24 மணி நேர முன்னறிவிப்பு, ஒவ்வொரு ஆற்று நிலையத்தின் மழையும் மட்டமும்.",
  },
  "rain.h1": { en: "Sri Lanka rain map today", si: "අද ශ්‍රී ලංකා වැසි සිතියම", ta: "இன்று இலங்கை மழை வரைபடம்" },
  "news.title": { en: "Flood News Sri Lanka Today – Latest Reports", si: "අද ශ්‍රී ලංකා ගංවතුර පුවත් – නවතම වාර්තා", ta: "இன்று இலங்கை வெள்ளச் செய்திகள் – சமீபத்திய அறிக்கைகள்" },
  "news.desc": {
    en: "Latest news on floods, river levels, spill gates, heavy rain and landslides in Sri Lanka, last 7 days. News reports, not official warnings.",
    si: "ගිය දින 7 තුළ ශ්‍රී ලංකාවේ ගංවතුර, ගංගා ජල මට්ටම්, වාන් දොරටු, තද වැසි සහ නායයෑම් පිළිබඳ නවතම පුවත් වාර්තා. පුවත් වාර්තා පමණි, නිල අනතුරු ඇඟවීම් නොවේ.",
    ta: "கடந்த 7 நாட்களில் இலங்கையில் வெள்ளம், ஆற்று நீர்மட்டம், வான்கதவுகள், கனமழை, நிலச்சரிவு பற்றிய சமீபத்திய செய்தி அறிக்கைகள். செய்தி அறிக்கைகள் மட்டுமே, அதிகாரப்பூர்வ எச்சரிக்கைகள் அல்ல.",
  },
  "news.h1": { en: "Flood news Sri Lanka today", si: "අද ශ්‍රී ලංකා ගංවතුර පුවත්", ta: "இன்று இலங்கை வெள்ளச் செய்திகள்" },
  "help.title": { en: "Flood Help Sri Lanka: 117 DMC Emergency Number", si: "ශ්‍රී ලංකා ගංවතුර උදව්: 117 හදිසි අංකය", ta: "இலங்கை வெள்ள உதவி: 117 அவசர எண்" },
  "help.desc": {
    en: "Flood help in Sri Lanka: the 117 Disaster Management Centre number, other emergency contacts, and what to do before, during and after a flood.",
    si: "ශ්‍රී ලංකාවේ ගංවතුර උදව්: 117 ආපදා කළමනාකරණ මධ්‍යස්ථානයේ හදිසි අංකය, අනෙකුත් හදිසි අංක, සහ ගංවතුරට පෙර, අතරතුර සහ පසු කළ යුතු දේ.",
    ta: "இலங்கையில் வெள்ள உதவி: 117 பேரிடர் மேலாண்மை மையத்தின் அவசர எண், பிற அவசரத் தொடர்புகள், வெள்ளத்திற்கு முன், போது, பின் செய்ய வேண்டியவை.",
  },
  "help.h1": { en: "Flood help: 117 and what to do", si: "ගංවතුර උදව්: 117 සහ කළ යුතු දේ", ta: "வெள்ள உதவி: 117 மற்றும் செய்ய வேண்டியவை" },
  "canals.title": { en: "Colombo Canal Water Levels Today & Tide", si: "අද කොළඹ ඇළ ජල මට්ටම් සහ උදම", ta: "இன்று கொழும்பு கால்வாய் நீர் மட்டம் & அலை" },
  "canals.desc": {
    en: "Live Colombo canal water levels (CUrW/SLLDC), high and low tide times, and low spots: Kolonnawa, Parliament Lake, Wellawatta, Dehiwala.",
    si: "CUrW/SLLDC වෙතින් කොළඹ ඇළ සජීවී ජල මට්ටම්, උදම් වේලාවන් සහ පහත් ප්‍රදේශ: කොළොන්නාව, පාර්ලිමේන්තු විල, වැල්ලවත්ත, දෙහිවල සහ උතුරු ඇළ.",
    ta: "CUrW/SLLDC இலிருந்து கொழும்பு கால்வாய்களின் நேரடி நீர் மட்டம், அலை நேரங்கள், தாழ்வான பகுதிகள்: கொலன்னாவ, பாராளுமன்ற ஏரி, வெல்லவத்தை, தெஹிவளை மற்றும் வடக்கு கால்வாய்கள்.",
  },
  "canals.h1": { en: "Colombo canal water levels today", si: "අද කොළඹ ඇළ ජල මට්ටම්", ta: "இன்று கொழும்பு கால்வாய் நீர் மட்டங்கள்" },
  "history.title": { en: "Sri Lanka Flood History: When Do Rivers Flood?", si: "ශ්‍රී ලංකා ගංවතුර ඉතිහාසය: ගංගා ගංවතුරට යන්නේ කවදාද?", ta: "இலங்கை வெள்ள வரலாறு: ஆறுகள் எப்போது பெருக்கெடுக்கும்?" },
} satisfies Record<string, L3>;

export type SeoKey = keyof typeof SEO;
type Vars = Record<string, string | number>;

/** Fill {placeholders}; an unknown placeholder is left as written so a typo is visible. */
export const seoFill = (s: string, v: Vars = {}) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

export const seoFor = (lang: Locale) => (k: SeoKey, v: Vars = {}) => seoFill(SEO[k][lang], v);
export type SeoFn = ReturnType<typeof seoFor>;
