import { CalendarClock, Waves } from "lucide-react";
import { getWeekly, activeWatches, WEEKLY_PDF } from "@/lib/wmsWeekly";
import { swFor, windowLabel } from "@/lib/i18n/spillWatch";
import { getI18n } from "@/lib/i18n/server";
import { shortDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";

// "Spill possible 20-22 Oct": Mahaweli water managers' weekly plan says this reservoir may spill.
// A plan, not an event and not a flood warning, so it is an outlined amber chip (no fill, no alarm
// icon) with a plain tooltip. Renders nothing when there is no window for the reservoir or the
// weekly PDF cannot be read.

const base = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const tone = {
  upcoming: "border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300",
  now: "border-amber-500 dark:border-amber-500 text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40",
  ended: "border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400",
} as const;

export async function SpillWatchChip({
  lang,
  slug,
  catalogueId,
  detail = false,
  className = "",
}: {
  lang: Locale;
  slug: string;
  catalogueId?: string | null;
  /** Reservoir page: also show the source line (meeting date + link to the PDF) under the chip. */
  detail?: boolean;
  className?: string;
}) {
  const data = await getWeekly();
  const watch = activeWatches(data).find((w) => w.slug === slug || (!!catalogueId && w.reservoirId === catalogueId));
  if (!data || !watch) return null;
  const { t } = getI18n(lang);
  const sw = swFor(lang);
  const range = windowLabel(watch.spillWindow, t);
  const label = watch.state === "upcoming" ? sw("chip.upcoming", { range }) : watch.state === "now" ? sw("chip.now") : sw("chip.ended");
  const tip = `${sw("tip")} ${sw("tip.range", { range })}`;
  const Icon = watch.state === "now" ? Waves : CalendarClock;
  return (
    <span className={`${detail ? "block" : "flex"} ${className}`}>
      <span className={`${base} ${tone[watch.state]}`} title={tip}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
        <span className="sr-only">. {tip}</span>
      </span>
      {detail && (
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
          {sw("tip.range", { range })} {sw("tip")}{" "}
          <a href={WEEKLY_PDF} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6">
            {data.meetingDate ? sw("source", { date: shortDay(data.meetingDate, t) }) : sw("pdf")}
          </a>
        </span>
      )}
    </span>
  );
}
