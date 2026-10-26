import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { clock } from "@/lib/i18n/format";
import { ccFor } from "@/lib/i18n/colombo";
import type { CanalGauge, Canals } from "@/lib/curw";
import { CURW_URL } from "@/lib/curwStatus";

const TONE: Record<string, string> = {
  higher: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border-amber-300 dark:border-amber-800",
  rising: "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border-amber-200 dark:border-amber-900",
  normal: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900",
  lower: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700",
  learning: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700",
  offline: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-300 dark:border-slate-700",
};

function Spark({ g, label }: { g: CanalGauge; label: string }) {
  const s = g.series;
  if (s.length < 3) return null;
  const lo = Math.min(...s.map((p) => p.m)), hi = Math.max(...s.map((p) => p.m));
  const span = Math.max(hi - lo, 0.2);
  const t0 = s[0].ms, t1 = s[s.length - 1].ms;
  const pts = s.map((p) => `${(((p.ms - t0) / Math.max(1, t1 - t0)) * 100).toFixed(1)},${(22 - ((p.m - lo) / span) * 20).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" className="mt-1.5 h-6 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" className="text-sky-700 dark:text-sky-300" />
    </svg>
  );
}

/** Live canal gauges for a list of CUrW gauge names (silently skips unknown ones). Credit line always shown. */
export function CanalLevels({ lang, canals, names, title, showSea = true, notes = true }: { lang: Locale; canals: Canals; names: string[]; title?: string; showSea?: boolean; /** credit and "usual" lines; the canals page shows them once at the end instead */ notes?: boolean }) {
  const { t } = getI18n(lang);
  const cc = ccFor(lang);
  const list = [...(showSea ? ["Mutwal Inlet"] : []), ...names].map((n) => canals.gauges.find((g) => g.name === n)).filter((g): g is CanalGauge => !!g);
  if (!list.length) return null;
  return (
    <section aria-label={title ?? cc("canal.title")} className="mt-4" lang={lang}>
      <h2 className="text-base font-semibold">{title ?? cc("canal.title")}</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {list.map((g) => {
          const sea = g.name === "Mutwal Inlet";
          const state = sea ? null : g.state;
          return (
            <li key={g.name} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{sea ? cc("canal.sea") : g.name}</span>
                {state && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[state]}`}>{cc(`state.${state}` as `state.${string}` as never)}</span>}
              </div>
              {g.state === "offline" ? (
                g.observedMs ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("canal.read", { time: clock(g.observedMs, t) })}</p> : null
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{g.level != null && cc("canal.m", { m: g.level.toFixed(2) })}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{g.observedMs ? cc("canal.read", { time: clock(g.observedMs, t) }) : ""}</p>
                  <Spark g={g} label={`${g.name}: ${cc("canal.spark")}`} />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {notes && <><p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        {cc("canal.credit")} · <a href={CURW_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">{cc("canal.chart")}</a>
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("canal.usual")}</p></>}
    </section>
  );
}
