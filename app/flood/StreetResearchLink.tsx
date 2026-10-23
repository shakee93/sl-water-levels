"use client";

import Link from "next/link";
import { useI18n } from "../LocaleProvider";
import { localePath, type Locale } from "@/lib/i18n/config";

// si/ta: drafts, need native review.
const TEXT: Record<Locale, string> = {
  en: "How we built this warning: read the research",
  si: "මෙම අනතුරු ඇඟවීම සකස් කළ ආකාරය: පර්යේෂණය කියවන්න",
  ta: "இந்த எச்சரிக்கை எப்படி உருவானது: ஆய்வைப் படிக்கவும்",
};

/** Link from the street-rain part of a town's Details to the research page behind the rule. */
export function StreetResearchLink() {
  const { lang } = useI18n();
  return (
    <p className="mt-1.5">
      <Link href={localePath(lang, "/research/wellampitiya-street-flooding")} className="underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300">
        {TEXT[lang]}
      </Link>
    </p>
  );
}
