import { fbFor } from "@/lib/i18n/feedback";
import type { Locale } from "@/lib/i18n/config";

/** About page: what the "Is this right?" answers keep, in plain words. */
export function FeedbackPrivacy({ lang }: { lang: Locale }) {
  const ft = fbFor(lang);
  return (
    <article id="feedback-privacy" className="mt-4 scroll-mt-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight mb-3">{ft("fb.aboutTitle")}</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed" lang={lang}>{ft("fb.about")}</p>
    </article>
  );
}
