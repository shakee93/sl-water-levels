import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { getHistory, historyPath } from "@/lib/history";
import {
  biggestEvents,
  latestEvents,
  peakGauges,
  peakGaugesPhrase,
  scopeIndices,
  summarize,
} from "@/lib/historyStats";
import { dayRange, monthInitials, monthsLong, riverName } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

/**
 * "When does this river flood?" card for river and station pages: the flood
 * season in one sentence, a 12-month risk strip with this month marked, and
 * the most recent floods, linking to the full /history page. Fails soft.
 */
export async function FloodHistoryCard({ lang, basin, station }: { lang: Locale; basin: string; station?: string }) {
  const { t, p } = getI18n(lang);
  const data = await getHistory();
  if (!data) return null;
  const st = station ? data.stations.find((s) => s.station === station) : undefined;
  if (station && !st) return null;
  const idx = scopeIndices(data, st ? { kind: "station", station: st.station } : { kind: "basin", basin });
  if (!idx.length) return null;

  const sum = summarize(data, idx, t);
  const name = st ? st.name : t("hist.card.nameBasin", { name: riverName(basin, lang) });
  const max = Math.max(...sum.risk, 0.0001);
  const recent = latestEvents(sum.events, 3);
  const biggest = biggestEvents(sum.events, 1)[0];
  // Show the biggest flood too, unless it's already among the recent ones.
  const rows = [
    ...recent.map((e) => ({ e, label: null as string | null })),
    ...(biggest && !recent.includes(biggest) ? [{ e: biggest, label: t("hist.card.biggest", { year: data.model.start.slice(0, 4) }) }] : []),
  ];
  const months = monthsLong(t);
  const initials = monthInitials(t);
  const thisMonth = months[sum.now.month];

  return (
    <section
      aria-labelledby="flood-history-h"
      className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 sm:p-5"
    >
      <h2 id="flood-history-h" className="flex items-center gap-2 font-semibold tracking-tight">
        <CalendarClock className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
        {t("hist.card.title", { name })}
      </h2>
      {sum.season ? (
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          {t("hist.card.comes", { season: sum.season })}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("hist.card.none")}</p>
      )}

      {sum.season && (
        <>
          <div className="mt-3 grid grid-cols-12 gap-1 items-end h-12" aria-hidden>
            {sum.risk.map((r, m) => (
              <div key={m} className="h-full flex items-end">
                <div
                  className={`w-full rounded-sm ${
                    m === sum.now.month
                      ? "bg-sky-500"
                      : sum.main.includes(m)
                        ? "bg-amber-500"
                        : sum.second?.includes(m)
                          ? "bg-amber-400/70"
                          : "bg-slate-200 dark:bg-slate-700"
                  }`}
                  style={{ height: `${Math.max(6, (r / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-12 gap-1 text-center text-[10px] text-slate-500 dark:text-slate-400" aria-hidden>
            {initials.map((m, i) => (
              <span key={i} className={i === sum.now.month ? "font-semibold text-sky-700 dark:text-sky-400" : ""}>
                {m}
              </span>
            ))}
          </div>
          <p
            className={`mt-2 text-xs ${
              sum.now.phase === "quiet" || sum.now.phase === "elevated" ? "text-slate-600 dark:text-slate-400" : "text-amber-800 dark:text-amber-300"
            }`}
          >
            {sum.now.phase === "main"
              ? t("hist.card.main", { month: thisMonth })
              : sum.now.phase === "second"
                ? t("hist.card.second", { month: thisMonth })
                : sum.now.phase === "elevated"
                  ? t("hist.card.elevated", { month: thisMonth, peak: months[sum.now.peakMonth] })
                  : t("hist.card.quiet", { month: thisMonth })}
          </p>
        </>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("hist.card.recent")}</h3>
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {rows.map(({ e, label }) => {
              const g = peakGauges(data, idx, e);
              return (
                <li key={e.from} className="py-1.5 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="tabular-nums">
                    {label && (
                      <span className="mr-1.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {label}:
                      </span>
                    )}
                    {dayRange(e.from, e.to, t)}
                  </span>
                  <span
                    className={`block sm:text-right text-xs ${
                      g[0]?.tier === "major" ? "text-red-700 dark:text-red-400" : "text-orange-700 dark:text-orange-400"
                    }`}
                  >
                    {st ? (g[0]?.tier === "major" ? t("tier.major") : t("tier.minor")) : peakGaugesPhrase(g, t)}
                    {e.source === "model" && <span className="text-slate-400 dark:text-slate-500"> · {t("hist.card.estimated")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Link
        href={p(historyPath(basin, st?.station))}
        data-umami-event="flood_history_card_click"
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline"
      >
        {t("hist.card.link", { year: data.model.start.slice(0, 4) })}
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
