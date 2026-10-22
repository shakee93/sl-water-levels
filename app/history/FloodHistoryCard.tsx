import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { getHistory, historyPath } from "@/lib/history";
import {
  biggestEvents,
  fmtRange,
  latestEvents,
  MONTHS,
  MONTHS_LONG,
  peakGauges,
  peakGaugesPhrase,
  scopeIndices,
  summarize,
} from "@/lib/historyStats";

/**
 * "When does this river flood?" card for river and station pages: the flood
 * season in one sentence, a 12-month risk strip with this month marked, and
 * the most recent floods, linking to the full /history page. Fails soft.
 */
export async function FloodHistoryCard({ basin, station }: { basin: string; station?: string }) {
  const data = await getHistory();
  if (!data) return null;
  const st = station ? data.stations.find((s) => s.station === station) : undefined;
  if (station && !st) return null;
  const idx = scopeIndices(data, st ? { kind: "station", station: st.station } : { kind: "basin", basin });
  if (!idx.length) return null;

  const sum = summarize(data, idx);
  const name = st ? st.name : `the ${basin}`;
  const max = Math.max(...sum.risk, 0.0001);
  const recent = latestEvents(sum.events, 3);
  const biggest = biggestEvents(sum.events, 1)[0];
  // Show the biggest flood too, unless it's already among the recent ones.
  const rows = [
    ...recent.map((e) => ({ e, label: null as string | null })),
    ...(biggest && !recent.includes(biggest) ? [{ e: biggest, label: `Biggest since ${data.model.start.slice(0, 4)}` }] : []),
  ];
  const thisMonth = MONTHS_LONG[sum.now.month];

  return (
    <section
      aria-labelledby="flood-history-h"
      className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 sm:p-5"
    >
      <h2 id="flood-history-h" className="flex items-center gap-2 font-semibold tracking-tight">
        <CalendarClock className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
        When does {name} flood?
      </h2>
      {sum.season ? (
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          Flood warnings come <strong>{sum.season}</strong>.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">No flood warnings on record since 2022.</p>
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
            {MONTHS.map((m, i) => (
              <span key={m} className={i === sum.now.month ? "font-semibold text-sky-700 dark:text-sky-400" : ""}>
                {m[0]}
              </span>
            ))}
          </div>
          <p
            className={`mt-2 text-xs ${
              sum.now.phase === "quiet" || sum.now.phase === "elevated" ? "text-slate-600 dark:text-slate-400" : "text-amber-800 dark:text-amber-300"
            }`}
          >
            {sum.now.phase === "main"
              ? `It's ${thisMonth}: the main flood season here. Worth checking levels daily after heavy rain.`
              : sum.now.phase === "second"
                ? `It's ${thisMonth}: the smaller flood season here. Floods are possible after heavy rain.`
                : sum.now.phase === "elevated"
                  ? `It's ${thisMonth}: floods are less common than in ${MONTHS_LONG[sum.now.peakMonth]}, but they do happen.`
                  : `It's ${thisMonth}: usually a quieter month here, though heavy rain can still bring floods.`}
          </p>
        </>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent floods</h3>
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
                    {fmtRange(e.from, e.to)}
                  </span>
                  <span
                    className={`block sm:text-right text-xs ${
                      g[0]?.tier === "major" ? "text-red-700 dark:text-red-400" : "text-orange-700 dark:text-orange-400"
                    }`}
                  >
                    {st ? (g[0]?.tier === "major" ? "Major flood" : "Minor flood") : peakGaugesPhrase(g)}
                    {e.source === "model" && <span className="text-slate-400 dark:text-slate-500"> · estimated</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Link
        href={historyPath(basin, st?.station)}
        data-umami-event="flood_history_card_click"
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline"
      >
        Every day since {data.model.start.slice(0, 4)}, year by year
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
