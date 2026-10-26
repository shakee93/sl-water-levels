"use client";

import { useState } from "react";
import { NEWS_TAGS, type NewsTag } from "@/lib/newsClassify";
import { NewsRow, type NewsRowData, type NewsRowLabels } from "./NewsRow";

// The /news list with filter chips by tag. Everything is rendered on the server first (all rows are in the
// HTML), the chips only hide rows in the browser.
export function NewsBoard({
  rows,
  serverNow,
  labels,
  text,
}: {
  rows: NewsRowData[];
  serverNow: number;
  labels: NewsRowLabels;
  text: { all: string; filters: string; emptyTag: string; countShown: string; tags: Record<NewsTag, string> };
}) {
  const [tag, setTag] = useState<NewsTag | null>(null);
  const counts = new Map<NewsTag, number>();
  for (const r of rows) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
  const shown = tag ? rows.filter((r) => r.tag === tag) : rows;
  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 rounded-full border px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
      on
        ? "border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-600"
        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-sky-400"
    }`;
  return (
    <div>
      <div role="group" aria-label={text.filters} className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setTag(null)} aria-pressed={tag === null} className={chip(tag === null)}>
          {text.all} <span className="tabular-nums opacity-80">{rows.length}</span>
        </button>
        {NEWS_TAGS.filter((x) => counts.has(x)).map((x) => (
          <button key={x} type="button" onClick={() => setTag(tag === x ? null : x)} aria-pressed={tag === x} className={chip(tag === x)}>
            {text.tags[x]} <span className="tabular-nums opacity-80">{counts.get(x)}</span>
          </button>
        ))}
      </div>
      {tag && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">{text.countShown.replace("{a}", String(shown.length)).replace("{n}", String(rows.length))}</p>}
      {shown.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{text.emptyTag}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {shown.map((r) => (
            <NewsRow key={r.id} row={r} serverNow={serverNow} labels={labels} />
          ))}
        </ul>
      )}
    </div>
  );
}
