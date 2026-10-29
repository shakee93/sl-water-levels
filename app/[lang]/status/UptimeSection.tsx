import { statusT } from "@/lib/i18n/status";
import type { Locale } from "@/lib/i18n/config";
import { getUptime, type UptimeTarget, type UptimeWindow, type WindowKey } from "@/lib/uptime";
import { fmtPct, minutesOf } from "@/lib/uptimeCalc.mjs";

// Measured uptime at the top of /status: the website, the embed and the data API, from the 5-minute probe in the scheduler worker.
// Server component; getUptime() is cached 5 minutes and returns null when nothing is measured yet (shows the "measuring" state).

const TZ = "Asia/Colombo";
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const ROWS: UptimeTarget[] = ["site", "embed", "api"];
const WINS: WindowKey[] = ["24h", "7d", "30d"];

export default async function UptimeSection({ lang }: { lang: Locale }) {
  const s = statusT(lang);
  const u = await getUptime();

  const shell = (children: React.ReactNode) => (
    <section aria-labelledby="uptime-h" className="mb-8">
      <h2 id="uptime-h" className="sr-only">{s("up.h")}</h2>
      {children}
    </section>
  );
  if (!u) {
    return shell(
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
        <p className="font-medium">{s("up.h")}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{s("up.empty")}</p>
      </div>,
    );
  }

  const pctText = (w: UptimeWindow, digits = 2) => (w ? `${fmtPct(w.pct, digits)}%` : null);
  const site30 = u.targets.site.windows["30d"];
  const dur = (ms: number) => {
    const m = minutesOf(ms);
    return m < 120 ? s("up.dur.min", { n: m }) : s("up.dur.hour", { h: Math.floor(m / 60), m: m % 60 });
  };
  const speed = (ms: number | null) => (ms == null ? "–" : ms < 1000 ? s("up.ms", { n: Math.round(ms) }) : s("up.s", { n: (ms / 1000).toFixed(1) }));
  const what = { site: s("up.what.site"), embed: s("up.what.embed"), api: s("up.what.api") } as const;

  return shell(
    <>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <p className="text-lg sm:text-xl font-semibold tracking-tight">
          {site30
            ? site30.since
              ? s("up.headSince", { pct: fmtPct(site30.pct, 2) ?? "", date: day(site30.since) })
              : s("up.head", { pct: fmtPct(site30.pct, 2) ?? "" })
            : s("up.h")}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{s("up.sub")}</p>
        {site30?.since ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s("up.sinceNote", { date: day(site30.since) })}</p> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                <th scope="col" className="font-normal pb-1 pr-3" />
                {WINS.map((w) => (
                  <th key={w} scope="col" className="font-normal pb-1 pr-3 whitespace-nowrap">{s(`up.w${w}` as "up.w24h")}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ROWS.map((t) => (
                <tr key={t}>
                  <th scope="row" className="font-medium text-left py-2 pr-3">{s(`up.${t}` as "up.site")}</th>
                  {WINS.map((w) => (
                    <td key={w} className="py-2 pr-3 tabular-nums whitespace-nowrap">{pctText(u.targets[t].windows[w]) ?? <span className="text-slate-400">{s("up.notyet")}</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-sm mt-3">{s("up.load", { p50: speed(u.targets.site.p50), p95: speed(u.targets.site.p95) })}</p>
      </div>

      <div className="mt-4">
        <h3 className="font-medium mb-1">{s("up.out")}</h3>
        {u.outages.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{s("up.none")}</p>
        ) : (
          <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
            {u.outages.slice(0, 8).map((o) => (
              <li key={`${o.target}-${o.start}`}>
                {o.ongoing
                  ? s("up.o.now", { date: day(o.start), from: clock(o.start), dur: dur(o.durationMs), what: what[o.target] })
                  : s("up.o.done", { date: day(o.start), from: clock(o.start), to: clock(o.end ?? o.start), dur: dur(o.durationMs), what: what[o.target] })}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{s("up.note")}</p>
      </div>
    </>,
  );
}
