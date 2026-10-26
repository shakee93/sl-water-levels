import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { getWeekly, activeWatches, hoursUntil, WEEKLY_PDF } from "@/lib/wmsWeekly";
import { reservoirById } from "@/lib/reservoirs";
import { getReservoirs, reservoirPath } from "@/lib/reservoirData";
import { swFor, windowLabel } from "@/lib/i18n/spillWatch";
import { getSpillWarnings } from "@/lib/spillWarnings";
import { warnWhen } from "./SpillWarningNote";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

// Home: one quiet line under the release rows when a reservoir with gauges of ours below it has a
// spill window that is open now or starts within 48 hours. Hidden otherwise.

export async function SpillWatchLine({ lang }: { lang: Locale }) {
  const data = await getWeekly();
  const soon = activeWatches(data).filter(
    (w) => (w.state === "now" || (w.state === "upcoming" && hoursUntil(w.spillWindow) <= 48)) && (reservoirById(w.reservoirId ?? "")?.gauges.length ?? 0) > 0,
  );
  const reported = [...(await getSpillWarnings().catch(() => new Map())).values()];
  if (soon.length === 0 && reported.length === 0) return null;
  const { t, p } = getI18n(lang);
  const sw = swFor(lang);
  const pages = new Set((await getReservoirs().catch(() => null))?.items.map((r) => r.slug) ?? []);
  return (
    <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" role="status">
      <CalendarClock className="size-4 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {soon.length > 0 && <p className="font-medium">{sw("home.lead")}</p>}
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
        {reported.length > 0 && (
          <>
            <p className={`font-medium ${soon.length > 0 ? "mt-1" : ""}`}>{sw("warn.lead")}</p>
            <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0">
              {reported.map((w) => {
                const res = reservoirById(w.reservoirId);
                const path = reservoirPath(w.reservoirId);
                if (!res) return null;
                return (
                  <li key={w.reservoirId} className="inline-flex flex-wrap items-center gap-x-1">
                    {path ? <Link href={p(path)} className="font-medium underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6">{res.name}</Link> : <span className="font-medium">{res.name}</span>}
                    <a href={w.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6">
                      {w.outlet}, {warnWhen(t, w.publishedAt)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
