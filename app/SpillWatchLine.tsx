import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { getWeekly, activeWatches, hoursUntil, WEEKLY_PDF } from "@/lib/wmsWeekly";
import { reservoirById } from "@/lib/reservoirs";
import { getReservoirs } from "@/lib/reservoirData";
import { swFor, windowLabel } from "@/lib/i18n/spillWatch";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

// Home: one quiet line under the release rows when a reservoir with gauges of ours below it has a
// spill window that is open now or starts within 48 hours. Hidden otherwise.

export async function SpillWatchLine({ lang }: { lang: Locale }) {
  const data = await getWeekly();
  const soon = activeWatches(data).filter(
    (w) => (w.state === "now" || (w.state === "upcoming" && hoursUntil(w.spillWindow) <= 48)) && (reservoirById(w.reservoirId ?? "")?.gauges.length ?? 0) > 0,
  );
  if (!data || soon.length === 0) return null;
  const { t, p } = getI18n(lang);
  const sw = swFor(lang);
  const pages = new Set((await getReservoirs().catch(() => null))?.items.map((r) => r.slug) ?? []);
  return (
    <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" role="status">
      <CalendarClock className="size-4 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{sw("home.lead")}</p>
        <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0">
          {soon.map((w) => {
            const text = sw("home.item", { name: w.name, range: windowLabel(w.spillWindow, t) });
            return (
              <li key={w.slug}>
                {pages.has(w.slug) ? (
                  <Link href={p(`/reservoirs/${w.slug}`)} className="underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6">
                    {text}
                  </Link>
                ) : (
                  <a href={WEEKLY_PDF} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6">
                    {text}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
