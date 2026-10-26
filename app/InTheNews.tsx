import { Newspaper } from "lucide-react";
import { getNewsSoon, newsForReservoir, newsForRiver, nowMs } from "@/lib/news";
import type { Locale } from "@/lib/i18n/config";
import { nwFor } from "@/lib/i18n/news";
import { NewsRow } from "./NewsRow";
import { newsRows, rowLabels } from "./newsRows";

// "In the news" on a river or reservoir page: the last few reports that name it. Nothing when there are none.
export async function InTheNews({ lang, basin, reservoir }: { lang: Locale; basin?: string; reservoir?: { catalogueId: string | null; name: string } }) {
  const data = await getNewsSoon();
  if (!data) return null;
  const mine = basin ? newsForRiver(data.items, basin) : reservoir ? newsForReservoir(data.items, reservoir.catalogueId, reservoir.name) : [];
  const items = mine.slice(0, 4);
  if (items.length === 0) return null;
  const nw = nwFor(lang);
  const rows = await newsRows(items, lang, { links: false });
  const serverNow = nowMs();
  return (
    <section aria-labelledby="in-news" className="mt-6">
      <h2 id="in-news" className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <Newspaper className="size-4 text-slate-500 dark:text-slate-400" aria-hidden />
        {nw("inNews")}
        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{nw("inNewsNote")}</span>
      </h2>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {rows.map((r) => (
          <NewsRow key={r.id} row={r} serverNow={serverNow} labels={rowLabels(lang)} />
        ))}
      </ul>
    </section>
  );
}
