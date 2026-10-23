"use client";

// Language links for the footer: the same page in English, Sinhala and Tamil.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localePath, splitLocale, type Locale } from "@/lib/i18n/config";
import { saveLang } from "./LanguageBar";

const OPTIONS: { id: Locale; label: string; aria: string }[] = [
  { id: "en", label: "EN", aria: "English" },
  { id: "si", label: "සිංහල", aria: "සිංහල (Sinhala)" },
  { id: "ta", label: "தமிழ்", aria: "தமிழ் (Tamil)" },
];

export function FooterLangLinks({ lang, label }: { lang: Locale; label: string }) {
  const { path } = splitLocale(usePathname());
  return (
    <nav aria-label={label} className="flex items-center">
      {OPTIONS.map((o, i) => (
        <span key={o.id} className="flex items-center">
          {i > 0 && <span aria-hidden className="text-slate-300 dark:text-slate-700">·</span>}
          <Link
            href={localePath(o.id, path)}
            lang={o.id}
            hrefLang={o.id}
            aria-label={o.aria}
            aria-current={o.id === lang ? "true" : undefined}
            prefetch={false}
            onClick={() => saveLang(o.id)}
            className={`inline-flex items-center justify-center min-h-11 sm:min-h-8 px-2.5 transition ${
              o.id === lang ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300"
            }`}
          >
            {o.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
