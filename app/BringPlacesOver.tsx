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

export function BringPlacesOver() {
  const { lang } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (Date.now() > UNTIL || location.hostname !== "waterlevels.lk") return;
    try {
      const has = ["sl_favourites", "sl_my_levels", "sl_low_spots"].some((k) => {
        const v = localStorage.getItem(k);
        return v != null && v !== "" && v !== "[]" && v !== "{}";
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only check, read after hydration
      if (!has) setShow(true);
    } catch {
      /* storage blocked: nothing to bring */
    }
  }, []);
  if (!show) return null;
  return (
    <p className="mb-4 text-sm" lang={lang}>
      <a href={OLD} className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300 underline underline-offset-2 hover:no-underline">
        <ArrowRightLeft className="size-4" aria-hidden /> {COPY[lang]}
      </a>
    </p>
  );
}
