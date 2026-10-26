import responseJson from "@/lib/model/river-response.json";
import { riverReactionLines, type RiverResponse } from "@/lib/riverReaction";
import { stationDisplayName } from "@/lib/displayName";
import type { Locale } from "@/lib/i18n/config";

const RESPONSE = (responseJson as unknown as { gauges: Record<string, RiverResponse> }).gauges;
const TITLE: Record<Locale, string> = { en: "How this river reacts to rain", si: "මෙම ගඟ වැසිවලට ප්‍රතිචාර දක්වන ආකාරය", ta: "இந்த ஆறு மழைக்கு எப்படி எதிர்வினை காட்டுகிறது" };
const FOOT: Record<Locale, string> = {
  en: "Learned from 11 months of readings and satellite rain. A guide, not a forecast.",
  si: "මාස 11 ක කියවීම් සහ චන්ද්‍රිකා වැසි දත්ත මත පදනම්. මාර්ගෝපදේශයක් පමණි, අනාවැකියක් නොවේ. (කෙටුම්පත් පරිවර්තනය)",
  ta: "11 மாத அளவீடுகள் மற்றும் செயற்கைக்கோள் மழைத் தரவிலிருந்து. வழிகாட்டி மட்டுமே, முன்னறிவிப்பு அல்ல. (வரைவு மொழிபெயர்ப்பு)",
};

/** A short, collapsed note on how fast and how strongly this river answers rain. Renders nothing where the history is too thin. */
export function RiverReaction({ station, lang }: { station: string; lang: Locale }) {
  const lines = riverReactionLines(station, RESPONSE[station], lang, stationDisplayName);
  if (!lines) return null;
  return (
    <details className="mt-3 mx-2 sm:mx-0 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300" data-testid="river-reaction">
      <summary className="cursor-pointer font-medium">{TITLE[lang]}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{FOOT[lang]}</p>
    </details>
  );
}
