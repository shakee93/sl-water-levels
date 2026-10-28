// The few words the story image adds to what the embed payloads already carry (step names, trend words, "Next hour: about ..."
// all come from the embed dictionaries). Sinhala and Tamil are drafts.
import type { Locale } from "@/lib/i18n/config";

type S = { live: string; updated: string; last24: string; forecast: string; now: string; liveAt: string; official: string; notReporting: string; marksHint: string; gauges: string; worstFirst: string };
export const STORY_STRINGS: Record<Locale, S> = {
  en: { live: "Live levels", updated: "Updated {t}", last24: "Last 24 h", forecast: "Forecast", now: "Now", liveAt: "Live levels:", official: "Official step", notReporting: "Not reporting", marksHint: "", gauges: "gauges", worstFirst: "Highest first" },
  si: { live: "සජීවී මට්ටම්", updated: "යාවත්කාලීන {t}", last24: "පැය 24", forecast: "අනාවැකිය", now: "දැන්", liveAt: "සජීවී මට්ටම්:", official: "නිල මට්ටම", notReporting: "වාර්තා නොකරයි", marksHint: "", gauges: "මානයන්", worstFirst: "ඉහළම මුලින්" },
  ta: { live: "நேரடி நீர்மட்டம்", updated: "புதுப்பிப்பு {t}", last24: "கடந்த 24 ம.நே.", forecast: "முன்னறிவிப்பு", now: "இப்போது", liveAt: "நேரடி நீர்மட்டம்:", official: "அதிகாரப்பூர்வ நிலை", notReporting: "தகவல் இல்லை", marksHint: "", gauges: "நிலையங்கள்", worstFirst: "அதிகமானவை முதலில்" },
};
