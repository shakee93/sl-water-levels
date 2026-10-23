// "Who runs this, and how to check it" for the About page: the part a reader (or an answer engine)
// uses to decide whether the numbers can be trusted. Labels are inline in en/si/ta (si/ta drafts).
import Link from "next/link";
import { localePath, type Locale } from "@/lib/i18n/config";
import { CONTENT_UPDATED, OWNER, REPO, RESEARCH_PAGE_LIVE } from "@/lib/seo";

type L3 = Record<Locale, string>;
const X: Record<string, L3> = {
  h: { en: "Who runs this site", si: "මෙම වෙබ් අඩවිය පවත්වාගෙන යන්නේ කවුද", ta: "இந்தத் தளத்தை நடத்துபவர்" },
  who: {
    en: "Sri Lanka Water Levels is an independent project by {name}, a person, not a company or a government body. It collects the Department of Irrigation's river-gauge readings and daily reservoir report, and the Mahaweli Authority's daily report, and shows them in plain language in English, Sinhala and Tamil.",
    si: "ශ්‍රී ලංකා ජල මට්ටම් යනු {name} විසින් ස්වාධීනව පවත්වාගෙන යන ව්‍යාපෘතියකි; එය සමාගමක් හෝ රජයේ ආයතනයක් නොවේ. ජල සම්පාදන දෙපාර්තමේන්තුවේ ගංගා මාන කියවීම්, දෛනික වැව් වාර්තාව සහ මහවැලි අධිකාරියේ දෛනික වාර්තාව එක්රැස් කර සරල භාෂාවෙන් සිංහල, දෙමළ සහ ඉංග්‍රීසියෙන් පෙන්වයි.",
    ta: "இலங்கை நீர்மட்டங்கள் என்பது {name} நடத்தும் சுயாதீனத் திட்டம்; இது நிறுவனமோ அரசு அமைப்போ அல்ல. நீர்ப்பாசனத் திணைக்களத்தின் ஆற்று அளவீடுகள், தினசரி நீர்த்தேக்க அறிக்கை மற்றும் மகாவலி அதிகாரசபையின் தினசரி அறிக்கையைச் சேகரித்து எளிய மொழியில் தமிழ், சிங்களம், ஆங்கிலத்தில் காட்டுகிறது.",
  },
  check: {
    en: "Every figure is shown with the time it was read and links to where it came from. Nothing here is an official warning. The source code is public, so anyone can check how a number is made.",
    si: "සෑම අගයක්ම කියවූ වේලාව සමඟ සහ එය ලැබුණු තැනට සබැඳියක් සමඟ පෙන්වයි. මෙහි කිසිවක් නිල අනතුරු ඇඟවීමක් නොවේ. මූලාශ්‍ර කේතය ප්‍රසිද්ධ බැවින් ඕනෑම කෙනෙකුට අගයක් ගණනය කරන ආකාරය පරීක්ෂා කළ හැක.",
    ta: "ஒவ்வொரு எண்ணும் அளவிடப்பட்ட நேரத்துடனும் மூலத்திற்கான இணைப்புடனும் காட்டப்படுகிறது. இங்குள்ளது அதிகாரப்பூர்வ எச்சரிக்கை அல்ல. மூலக் குறியீடு பொதுவானது, எனவே எவரும் ஓர் எண் எப்படி உருவாகிறது என்பதைச் சரிபார்க்கலாம்.",
  },
  updated: { en: "Page last reviewed: {date}", si: "පිටුව අවසන් වරට සමාලෝචනය: {date}", ta: "பக்கம் கடைசியாகப் பார்க்கப்பட்டது: {date}" },
  contact: { en: "Corrections and questions", si: "නිවැරදි කිරීම් සහ ප්‍රශ්න", ta: "திருத்தங்கள் மற்றும் கேள்விகள்" },
  issues: { en: "report an issue on GitHub", si: "GitHub හි ගැටලුවක් වාර්තා කරන්න", ta: "GitHub இல் சிக்கலைப் பதிவு செய்யவும்" },
  research: { en: "Research behind the flood estimates", si: "ගංවතුර ඇස්තමේන්තු පිටුපස පර්යේෂණ", ta: "வெள்ள மதிப்பீடுகளின் ஆய்வு" },
  data: { en: "Data and API for developers and AI tools", si: "සංවර්ධකයන් සහ AI මෙවලම් සඳහා දත්ත සහ API", ta: "உருவாக்குநர்கள் மற்றும் AI கருவிகளுக்கான தரவு மற்றும் API" },
};

export function AboutTrust({ lang }: { lang: Locale }) {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${CONTENT_UPDATED}T00:00:00Z`));
  const link = "underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300";
  return (
    <article id="who" className="scroll-mt-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight mb-3">{X.h[lang]}</h2>
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        <p>{X.who[lang].replace("{name}", OWNER.name)}</p>
        <p>{X.check[lang]}</p>
        <p>
          {X.contact[lang]}:{" "}
          <a className={link} href={OWNER.x} target="_blank" rel="noreferrer me">x.com/shakeeb_x</a>,{" "}
          <a className={link} href={`${REPO}/issues`} target="_blank" rel="noreferrer">{X.issues[lang]}</a>.
        </p>
        <p className="flex flex-col gap-1.5">
          <Link className={link} href={localePath(lang, "/data")}>{X.data[lang]}</Link>
          {RESEARCH_PAGE_LIVE && <Link className={link} href={localePath(lang, "/research")}>{X.research[lang]}</Link>}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{X.updated[lang].replace("{date}", date)}</p>
      </div>
    </article>
  );
}
