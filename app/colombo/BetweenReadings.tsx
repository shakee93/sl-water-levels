"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { ccFor } from "@/lib/i18n/colombo";
import { clock } from "@/lib/i18n/format";
import { useI18n } from "../LocaleProvider";

type G = { name: string; state: string; change3h_m: number | null; observedAt: string | null };

/**
 * Nagalagam Street is read once an hour. CUrW's Ranwala gauge, upstream on the Kelani, is read every 15 minutes, so it
 * shows a rise coming down the river before the next official reading. Context only: never changes the verdict.
 * Read from OUR /api/canals (D1 archive), never from CUrW's host. Shown in feet like every level on the site.
 */
export function BetweenReadings() {
  const { lang, t } = useI18n();
  const cc = ccFor(lang);
  const [g, setG] = useState<G | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/canals?group=Kelani%20River", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setG((j?.gauges as G[] | undefined)?.find((x) => x.name === "Ranwala N") ?? null))
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  if (!g || g.state === "offline" || g.change3h_m == null || !g.observedAt) return null;
  const ft = g.change3h_m * 3.28084;
  // 0.15 ft (about 5 cm) in 3 h: below that the river is effectively steady at this gauge
  const trend = ft >= 0.15 ? "rising" : ft <= -0.15 ? "falling" : "steady";
  const delta = `${ft >= 0 ? "+" : "−"}${Math.abs(ft).toFixed(1)} ft`;
  return (
    <section aria-label={cc("between.title")} className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200">
      <Activity className="mt-0.5 size-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
      <div>
        <p className="font-medium">{cc("between.title")}</p>
        <p className="mt-0.5">{cc("between.line", { trend: cc(`tide.${trend}`), delta, time: clock(Date.parse(g.observedAt), t) })}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{cc("between.note")} {cc("canal.credit")}</p>
      </div>
    </section>
  );
}
