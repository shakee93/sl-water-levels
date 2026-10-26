"use client";

import Link from "next/link";
import { useI18n } from "../LocaleProvider";
import { localePath, type Locale } from "@/lib/i18n/config";

// si/ta: drafts, need native review.
const TEXT: Record<Locale, string> = {
  en: "Where the rain numbers come from: read the research",
  si: "වැසි සංඛ්‍යා ලැබෙන ආකාරය: පර්යේෂණය කියවන්න",
  ta: "மழை எண்கள் எங்கிருந்து வருகின்றன: ஆய்வைப் படிக்கவும்",
};

/** Link from the low-ground panel to the research page behind the rain numbers. */
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
