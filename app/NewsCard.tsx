import Link from "next/link";
import { ArrowRight, Newspaper } from "lucide-react";
import { getNewsSoon, homeNews, nowMs } from "@/lib/news";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { nwFor } from "@/lib/i18n/news";
import { NewsRow } from "./NewsRow";
import { newsRows, rowLabels } from "./newsRows";

// Home card: the latest 3 to 5 flood-related news reports from the last day or two. Nothing at all (no empty
// card) when there are none or the feeds cannot be read. News reports, never official, and it says so.
export async function NewsCard({ lang }: { lang: Locale }) {
  const data = await getNewsSoon();
  const serverNow = nowMs();
  const items = data ? homeNews(data.items, serverNow) : [];
  if (items.length === 0) return null;
  const { p } = getI18n(lang);
  const nw = nwFor(lang);
  const rows = await newsRows(items, lang, { links: false });
  return (
    <section aria-labelledby="news-title" className="mb-8">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
          <div className="min-w-0">
            <h2 id="news-title" className="flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight">
              <Newspaper className="size-4 text-slate-500 dark:text-slate-400" aria-hidden />
              {nw("homeTitle")}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{nw("notice")}</p>
          </div>
          <Link
            href={p("/news")}
            data-umami-event="news_all_click"
            className="inline-flex shrink-0 items-center gap-1 min-h-11 text-sm text-sky-700 dark:text-sky-300 hover:underline underline-offset-2"
          >
            {nw("homeAll")}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {rows.map((r) => (
            <NewsRow key={r.id} row={r} serverNow={serverNow} labels={rowLabels(lang)} />
          ))}
        </ul>
      </div>
    </section>
  );
}
