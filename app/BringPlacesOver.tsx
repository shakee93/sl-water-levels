"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { useI18n } from "./LocaleProvider";

// Until mid-November 2026 only: the site moved from sl-water-levels.vercel.app to waterlevels.lk on 26 Oct. Phones that saved
// places on the old address keep them there. The automatic hand-over (app/api/move) missed some in its first minutes, so a
// phone with nothing saved here gets one quiet link to the old address's hand-over page, which copies them across.
const UNTIL = Date.UTC(2026, 10, 16);
const OLD = "https://sl-water-levels.vercel.app/api/move?to=/";
const COPY = {
  en: "Saved places on the old address (sl-water-levels.vercel.app)? Bring them over",
  si: "පැරණි ලිපිනයේ (sl-water-levels.vercel.app) සුරැකි ස්ථාන තිබේද? ඒවා මෙහි ගෙන එන්න",
  ta: "பழைய முகவரியில் (sl-water-levels.vercel.app) சேமித்த இடங்கள் உள்ளதா? அவற்றை இங்கே கொண்டு வாருங்கள்",
} as const;
const NONE = {
  en: "Nothing was saved on the old address in this browser. If you added the app to your Home Screen, open that app once: it moves your places and alerts by itself.",
  si: "මෙම බ්‍රවුසරයේ පැරණි ලිපිනයේ සුරැකි කිසිවක් නැත. ඔබ යෙදුම Home Screen එකට එක් කළේ නම්, එය වරක් විවෘත කරන්න: ඔබේ ස්ථාන සහ ඇඟවීම් එය විසින්ම ගෙන එයි.",
  ta: "இந்த உலாவியில் பழைய முகவரியில் எதுவும் சேமிக்கப்படவில்லை. செயலியை Home Screen இல் சேர்த்திருந்தால், அதை ஒருமுறை திறக்கவும்: உங்கள் இடங்களையும் எச்சரிக்கைகளையும் அதுவே கொண்டு வரும்.",
} as const;

export function BringPlacesOver() {
  const { lang } = useI18n();
  const [show, setShow] = useState<"link" | "none" | null>(null);
  useEffect(() => {
    if (Date.now() > UNTIL || location.hostname !== "waterlevels.lk") return;
    try {
      const has = ["sl_favourites", "sl_my_levels", "sl_low_spots"].some((k) => {
        const v = localStorage.getItem(k);
        return v != null && v !== "" && v !== "[]" && v !== "{}";
      });
      if (has) return;
      const checked = localStorage.getItem("sl_moved_checked");
      if (!checked) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only check, read after hydration
        setShow("link");
        return;
      }
      // checked already and nothing came: say so once, then never again
      if (!localStorage.getItem("sl_moved_note_seen")) {
        localStorage.setItem("sl_moved_note_seen", "1");
        setShow("none");
      }
    } catch {
      /* storage blocked: nothing to bring */
    }
  }, []);
  if (!show) return null;
  if (show === "none")
    return (
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400" lang={lang}>
        {NONE[lang]}
      </p>
    );
  return (
    <p className="mb-4 text-sm" lang={lang}>
      <a href={OLD} className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300 underline underline-offset-2 hover:no-underline">
        <ArrowRightLeft className="size-4" aria-hidden /> {COPY[lang]}
      </a>
    </p>
  );
}
