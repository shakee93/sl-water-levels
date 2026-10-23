// Strings for the spill-watch chips (Mahaweli weekly meeting) and the "Reservoir watch" wording.
// Kept apart from the shared dictionaries so this feature touches none of them. Sinhala and Tamil
// are drafts that need native review. Placeholders look like {n}; keep every one in every language.
import type { Locale } from "./config";
import { shortDay } from "./format";
import type { TFn } from "./translate";

const en = {
  "chip.upcoming": "Spill possible {range}",
  "chip.now": "Spill window now",
  "chip.ended": "Spill window ended",
  "tip": "Mahaweli water managers expect this reservoir may spill in this window. Not a flood warning.",
  "tip.range": "Window: {range}.",
  "source": "Mahaweli Authority weekly meeting, {date}",
  "pdf": "Open the weekly PDF",
  "home.lead": "May spill soon (Mahaweli water managers' weekly plan, not a flood warning)",
  "home.item": "{name}: {range}",
  "watch.lead": "{name}: reservoir watch",
  "watch.note": "Gates reported open. Its water goes into another reservoir, not straight into a river. Not a flood warning.",
};
type K = keyof typeof en;

const si: Record<K, string> = {
  "chip.upcoming": "පිටාර ගැලීමට ඉඩ: {range}", // needs native review
  "chip.now": "පිටාර ගැලීමට ඉඩ ඇති කාලය දැන්", // needs native review
  "chip.ended": "පිටාර ගැලීමට ඉඩ තිබූ කාලය අවසන්", // needs native review
  "tip": "මෙම කාලය තුළ මේ ජලාශය පිටාර ගැලිය හැකි බව මහවැලි ජල කළමනාකරුවන් අපේක්ෂා කරයි. ගංවතුර අනතුරු ඇඟවීමක් නොවේ.", // needs native review
  "tip.range": "කාලය: {range}.", // needs native review
  "source": "මහවැලි අධිකාරියේ සතිපතා රැස්වීම, {date}", // needs native review
  "pdf": "සතිපතා PDF එක විවෘත කරන්න", // needs native review
  "home.lead": "ඉක්මනින් පිටාර ගැලිය හැක (මහවැලි ජල කළමනාකරුවන්ගේ සතිපතා සැලසුම, ගංවතුර අනතුරු ඇඟවීමක් නොවේ)", // needs native review
  "home.item": "{name}: {range}", // needs native review
  "watch.lead": "{name}: ජලාශ නිරීක්ෂණය", // needs native review
  "watch.note": "වාන් දොරටු විවෘත වූ බව වාර්තා වේ. එහි ජලය ගංගාවකට නොව වෙනත් ජලාශයකට ගලා යයි. ගංවතුර අනතුරු ඇඟවීමක් නොවේ.", // needs native review
};

const ta: Record<K, string> = {
  "chip.upcoming": "நிரம்பி வழிய வாய்ப்பு: {range}", // needs native review
  "chip.now": "நிரம்பி வழிய வாய்ப்புள்ள காலம் இப்போது", // needs native review
  "chip.ended": "நிரம்பி வழிய வாய்ப்புள்ள காலம் முடிந்தது", // needs native review
  "tip": "இந்தக் காலத்தில் இந்த நீர்த்தேக்கம் நிரம்பி வழியக்கூடும் என மகாவலி நீர் மேலாளர்கள் எதிர்பார்க்கிறார்கள். இது வெள்ள எச்சரிக்கை அல்ல.", // needs native review
  "tip.range": "காலம்: {range}.", // needs native review
  "source": "மகாவலி அதிகாரசபையின் வாராந்தரக் கூட்டம், {date}", // needs native review
  "pdf": "வாராந்தர PDF ஐத் திறக்கவும்", // needs native review
  "home.lead": "விரைவில் நிரம்பி வழியக்கூடும் (மகாவலி நீர் மேலாளர்களின் வாராந்தரத் திட்டம், வெள்ள எச்சரிக்கை அல்ல)", // needs native review
  "home.item": "{name}: {range}", // needs native review
  "watch.lead": "{name}: நீர்த்தேக்க கண்காணிப்பு", // needs native review
  "watch.note": "வான்கதவுகள் திறக்கப்பட்டதாக அறிவிக்கப்பட்டுள்ளது. இதன் நீர் ஆற்றுக்கு அல்ல, மற்றொரு நீர்த்தேக்கத்துக்குச் செல்கிறது. இது வெள்ள எச்சரிக்கை அல்ல.", // needs native review
};

const DICTS: Record<Locale, Record<K, string>> = { en, si, ta };
export type SwKey = K;
export type SW = (key: K, vars?: Record<string, string | number>) => string;
export function swFor(lang: Locale): SW {
  const d = DICTS[lang];
  return (key, vars) => {
    const s = d[key] ?? en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

/** "21 Oct", "20–22 Oct" (same month), "30 Oct – 2 Nov". Month names come from the shared date strings. */
export function windowLabel(w: { from: string; to: string }, t: TFn): string {
  if (w.from === w.to) return shortDay(w.from, t);
  if (w.from.slice(0, 7) === w.to.slice(0, 7)) {
    const first = shortDay(w.from, t);
    const last = shortDay(w.to, t);
    const d1 = String(Number(w.from.slice(8)));
    const d2 = String(Number(w.to.slice(8)));
    // Keep the language's own order (day month / month day): put "20–22" where the day goes.
    return last.replace(d2, `${d1}–${d2}`) || first;
  }
  return t("date.range", { a: shortDay(w.from, t), b: shortDay(w.to, t) });
}
