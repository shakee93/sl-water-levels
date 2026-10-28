import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { SITE } from "@/lib/seo";
import { PLACES } from "@/lib/places";
import { BOUNDS } from "@/lib/flood3dReports";
import Flood3dMap from "../lab/flood-3d/Flood3dMap";

// Shareable flood survey: opens straight into "pin your spot, how deep did it get" on the flood map. Plain on purpose: one heading, two lines,
// the map. Answers go to the same private report pipeline as the map's "Report here" (see DOCS.md, "Flood survey"). si and ta are DRAFTS.
const COPY: Record<Locale, { title: string; desc: string; h1: string; lead: string }> = {
  en: { title: "Flood survey: how deep did the water get at your place?", desc: "Pin your spot on the map and tell us how deep the Cyclone Ditwah flood got. One minute, no name or phone number, and it helps improve the flood map.", h1: "How deep did the flood get at your place?", lead: "Put a pin on your house or street and answer a few questions about Cyclone Ditwah (or another flood). No name or phone number. Your exact spot stays private; answers only help improve the map. It is an estimate of river flooding, not an official flood map." },
  si: { title: "ගංවතුර සමීක්ෂණය: ඔබේ ස්ථානයේ ජලය කොතරම් ගැඹුරු වූවාද?", desc: "සිතියමේ ඔබේ ස්ථානය සලකුණු කර ඩිට්වා චණ්ඩමාරුතයේ ගංවතුර කොතරම් ගැඹුරු වූවාදැයි කියන්න. විනාඩියක්, නම හෝ දුරකථන අංකයක් නැත.", h1: "ඔබේ ස්ථානයේ ගංවතුර කොතරම් ගැඹුරු වූවාද?", lead: "ඔබේ නිවසේ හෝ වීදියේ සලකුණක් තබා ඩිට්වා චණ්ඩමාරුතය (හෝ වෙනත් ගංවතුරක්) ගැන ප්‍රශ්න කිහිපයකට පිළිතුරු දෙන්න. නම හෝ දුරකථන අංකයක් අවශ්‍ය නැත. ඔබේ නියම ස්ථානය රහසිගතව තබයි; පිළිතුරු සිතියම වැඩිදියුණු කිරීමට පමණක් උපකාරී වේ. මෙය ගං ගංවතුරේ ඇස්තමේන්තුවකි, නිල ගංවතුර සිතියමක් නොවේ." },
  ta: { title: "வெள்ள ஆய்வு: உங்கள் இடத்தில் தண்ணீர் எவ்வளவு ஆழம்?", desc: "வரைபடத்தில் உங்கள் இடத்தைக் குறித்து, டிட்வா புயல் வெள்ளம் எவ்வளவு ஆழமாக இருந்தது என்று சொல்லுங்கள். ஒரு நிமிடம், பெயர் அல்லது தொலைபேசி எண் தேவையில்லை.", h1: "உங்கள் இடத்தில் வெள்ளம் எவ்வளவு ஆழம்?", lead: "உங்கள் வீடு அல்லது தெருவில் ஒரு குறி வைத்து, டிட்வா புயல் (அல்லது வேறு வெள்ளம்) பற்றிய சில கேள்விகளுக்குப் பதிலளியுங்கள். பெயர் அல்லது தொலைபேசி எண் இல்லை. உங்கள் சரியான இடம் தனிப்பட்டதாகவே இருக்கும்; பதில்கள் வரைபடத்தை மேம்படுத்த மட்டுமே உதவும். இது ஆற்று வெள்ளத்தின் மதிப்பீடு, அதிகாரப்பூர்வ வெள்ள வரைபடம் அல்ல." },
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
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{c.lead}</p>
      </div>
      <Flood3dMap towns={towns} gauges={gauges} lang={lang} survey />
    </main>
  );
}
