import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { SITE } from "@/lib/seo";
import { PLACES } from "@/lib/places";
import { BOUNDS } from "@/lib/flood3dReports";
import { SurveyEntry } from "./SurveyEntry";

// Shareable flood survey: opens straight into "is your area flooded now?" (past floods as the second option) on the flood map. Plain on purpose: one heading, two lines,
// the map. Answers go to the same private report pipeline as the map's "Report here" (see DOCS.md, "Flood survey"). si and ta are DRAFTS.
const COPY: Record<Locale, { title: string; desc: string; h1: string; lead: string; leadHere: string; mapNote: string }> = {
  en: { title: "Is your area flooded? Report flood water on your street", desc: "Pin your spot on the map and say how deep the flood water is right now, or tell us about a past flood like Cyclone Ditwah. One minute, no name or phone number.", h1: "Is your area flooded now?", lead: "Put a pin on your house or street and say how deep the water is right now. Not flooded? Tell us about a past flood like Cyclone Ditwah. No name or phone number; your exact spot stays private.", leadHere: "Put a pin on your house or street and say how deep the water is right now. No name or phone number; your exact spot stays private.", mapNote: "On the map, flood levels are an estimate of river flooding, not an official flood map." },
  si: { title: "ඔබේ ප්‍රදේශය ගංවතුරෙන් යටවී තිබේද? ඔබේ වීදියේ ගංවතුර වාර්තා කරන්න", desc: "සිතියමේ ඔබේ ස්ථානය සලකුණු කර දැන් ගංවතුර ජලය කොතරම් ගැඹුරුදැයි කියන්න, නැතහොත් ඩිට්වා වැනි පසුගිය ගංවතුරක් ගැන කියන්න. විනාඩියක්, නම හෝ දුරකථන අංකයක් නැත.", h1: "ඔබේ ප්‍රදේශය දැන් ගංවතුරෙන් යටවී තිබේද?", lead: "ඔබේ නිවසේ හෝ වීදියේ සලකුණක් තබා දැන් ජලය කොතරම් ගැඹුරුදැයි කියන්න. ගංවතුර නැද්ද? ඩිට්වා වැනි පසුගිය ගංවතුරක් ගැන කියන්න. නම හෝ දුරකථන අංකයක් නැත; ඔබේ නියම ස්ථානය රහසිගතව තබයි.", leadHere: "ඔබේ නිවසේ හෝ වීදියේ සලකුණක් තබා දැන් ජලය කොතරම් ගැඹුරුදැයි කියන්න. නම හෝ දුරකථන අංකයක් නැත; ඔබේ නියම ස්ථානය රහසිගතව තබයි.", mapNote: "සිතියමේ ගංවතුර මට්ටම් ගං ගංවතුරේ ඇස්තමේන්තුවකි, නිල ගංවතුර සිතියමක් නොවේ." },
  ta: { title: "உங்கள் பகுதி வெள்ளத்தில் உள்ளதா? உங்கள் தெருவின் வெள்ளத்தைத் தெரிவியுங்கள்", desc: "வரைபடத்தில் உங்கள் இடத்தைக் குறித்து இப்போது வெள்ள நீர் எவ்வளவு ஆழம் என்று சொல்லுங்கள், அல்லது டிட்வா போன்ற முந்தைய வெள்ளம் பற்றிச் சொல்லுங்கள். ஒரு நிமிடம், பெயர் அல்லது தொலைபேசி எண் தேவையில்லை.", h1: "உங்கள் பகுதி இப்போது வெள்ளத்தில் உள்ளதா?", lead: "உங்கள் வீடு அல்லது தெருவில் ஒரு குறி வைத்து இப்போது தண்ணீர் எவ்வளவு ஆழம் என்று சொல்லுங்கள். வெள்ளம் இல்லையா? டிட்வா போன்ற முந்தைய வெள்ளம் பற்றிச் சொல்லுங்கள். பெயர் அல்லது தொலைபேசி எண் இல்லை; உங்கள் சரியான இடம் தனிப்பட்டதாகவே இருக்கும்.", leadHere: "உங்கள் வீடு அல்லது தெருவில் ஒரு குறி வைத்து இப்போது தண்ணீர் எவ்வளவு ஆழம் என்று சொல்லுங்கள். பெயர் அல்லது தொலைபேசி எண் இல்லை; உங்கள் சரியான இடம் தனிப்பட்டதாகவே இருக்கும்.", mapNote: "வரைபடத்தில் உள்ள வெள்ள நிலைகள் ஆற்று வெள்ளத்தின் மதிப்பீடு, அதிகாரப்பூர்வ வெள்ள வரைபடம் அல்ல." },
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const c = COPY[lang], alternates = pageAlternates(lang, "/flood-survey");
  return { title: { absolute: c.title }, description: c.desc, alternates, openGraph: { title: c.title, description: c.desc, url: `${SITE}${alternates.canonical}`, type: "website" }, twitter: { card: "summary", title: c.title, description: c.desc } };
}

export default async function FloodSurveyPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = COPY[lang];
  const inside = (p: { lat: number; lon: number }) => p.lat >= BOUNDS.south && p.lat <= BOUNDS.north && p.lon >= BOUNDS.west && p.lon <= BOUNDS.east;
  const towns = PLACES.filter(inside).map((p) => ({ n: p.name, lat: p.lat, lon: p.lon, al: p.aliases }));
  const gauges = [{ n: "Nagalagam Street", lat: 6.958265, lon: 79.878642 }, { n: "Hanwella", lat: 6.9097, lon: 80.083126 }];
  return (
    <main className="w-full">
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-2">
        <h1 className="text-lg font-semibold tracking-tight">{c.h1}</h1>
      </div>
      <SurveyEntry towns={towns} gauges={gauges} lang={lang} lead={c.lead} leadHere={c.leadHere} mapNote={c.mapNote} />
    </main>
  );
}
