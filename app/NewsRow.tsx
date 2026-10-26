import { Ban, CloudRain, Droplets, ExternalLink, Mountain, TriangleAlert, Waves, Wind } from "lucide-react";
import Link from "next/link";
import type { NewsTag } from "@/lib/newsClassify";
import { TimeAgo } from "./TimeAgo";

// One news report: tag, outlet, time, the headline exactly as published (links out to the outlet), at most a
// 20-word first sentence from the outlet's own feed, and links to the rivers / reservoirs / towns it names.
// Plain data in, so it renders in server components and in the client filter board alike.

export type NewsRowData = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  tag: NewsTag;
  tagLabel: string;
  snippet: string | null;
  /** "26 Oct, 8:12 am", Sri Lanka time. */
  when: string;
  links: { label: string; href: string }[];
};

export type NewsRowLabels = { source: string; newTab: string; related: string };

const TAG_ICON: Record<NewsTag, typeof CloudRain> = {
  Rain: CloudRain,
  River: Waves,
  Reservoir: Droplets,
  Landslide: Mountain,
  Cyclone: Wind,
  Warning: TriangleAlert,
  Closure: Ban,
};

// Tags are labels, not alarms: one calm colour for most, amber for the two that tell people to act.
const TAG_CLS: Record<NewsTag, string> = {
  Rain: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900",
  River: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900",
  Reservoir: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900",
  Landslide: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  Cyclone: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  Warning: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
  Closure: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
};

export function TagChip({ tag, label }: { tag: NewsTag; label: string }) {
  const Icon = TAG_ICON[tag];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TAG_CLS[tag]}`}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function NewsRow({ row, serverNow, labels }: { row: NewsRowData; serverNow: number; labels: NewsRowLabels }) {
  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <TagChip tag={row.tag} label={row.tagLabel} />
        <span>{labels.source.replace("{src}", row.source)}</span>
        <span aria-hidden>·</span>
        <time dateTime={new Date(row.publishedAt).toISOString()} title={row.when}>
          {row.when} (<TimeAgo ts={row.publishedAt} serverNow={serverNow} />)
        </time>
      </div>
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-start gap-1.5 py-1 text-[15px] font-medium leading-snug text-slate-900 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-300 hover:underline underline-offset-2"
      >
        <span>{row.title}</span>
        <ExternalLink className="size-3.5 mt-1 shrink-0 text-slate-400" aria-hidden />
        <span className="sr-only">{labels.newTab}</span>
      </a>
      {row.snippet && <p className="text-sm text-slate-600 dark:text-slate-300">{row.snippet}</p>}
      {row.links.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500 dark:text-slate-400">
          <span>{labels.related}</span>
          {row.links.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex items-center min-h-11 sm:min-h-6 text-sky-700 dark:text-sky-300 underline underline-offset-2">
              {l.label}
            </Link>
          ))}
        </p>
      )}
    </li>
  );
}
