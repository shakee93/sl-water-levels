// Answer-first text and a short visible FAQ for the station, river, reservoir and town pages.
// Both are plain server-rendered HTML: nothing here depends on JavaScript or a chart.
import { faqHeading, type Faq } from "@/lib/answers";
import type { Locale } from "@/lib/i18n/config";
import { ldJson } from "@/lib/seo";

/** The one-sentence answer under a page's heading. Marked as the page's speakable text. */
export function AnswerLine({ text, note, className = "mt-1.5" }: { text: string; note?: string; className?: string }) {
  return (
    <p className={`answer-line ${className} text-sm text-slate-600 dark:text-slate-400 max-w-prose`}>
      {text}
      {note ? <span className="text-slate-400 dark:text-slate-500"> ({note})</span> : null}
    </p>
  );
}

/** Questions people ask, answered in the same words the page uses. */
export function FaqList({ lang, items, note }: { lang: Locale; items: Faq[]; note?: string }) {
  if (!items.length) return null;
  return (
    <section className="mt-10 border-t border-slate-200 dark:border-slate-800 pt-6" aria-labelledby="faq-h">
      <h2 id="faq-h" className="text-base font-semibold tracking-tight">{faqHeading(lang)}</h2>
      <dl className="mt-3 space-y-4 text-sm">
        {items.map((x) => (
          <div key={x.q}>
            <dt className="font-medium text-slate-800 dark:text-slate-200">{x.q}</dt>
            <dd className="mt-0.5 text-slate-600 dark:text-slate-400 max-w-prose">{x.a}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">({note})</p> : null}
    </section>
  );
}

/** One JSON-LD block (a @graph) for a page. */
export function JsonLd({ graph }: { graph: unknown[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(graph) }} />;
}
