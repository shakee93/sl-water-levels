import { Waves } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { clock } from "@/lib/i18n/format";
import { ccFor } from "@/lib/i18n/colombo";
import { colomboDay, tideEvents, tideNow } from "@/lib/tide";
import type { Canals } from "@/lib/curw";

/** "2:36 pm today and 3:06 am tomorrow" for the next two high tides; `null` when none is found. */
export function highTideTimes(lang: Locale, now: number): { times: string; nearHigh: boolean; next: number | null } {
  const { t } = getI18n(lang);
  const cc = ccFor(lang);
  const tn = tideNow(now);
  const highs = tn.highs.slice(0, 2);
  const day = (ms: number) => (colomboDay(ms) === colomboDay(now) ? "tide.today" : "tide.tomorrow");
  const parts = highs.map((h) => cc(day(h.t), { time: clock(h.t, t) }));
  const times = parts.length === 2 ? cc("tide.and", { a: parts[0], b: parts[1] }) : parts[0] ?? "";
  return { times, nearHigh: tn.nearHigh, next: highs[0]?.t ?? null };
}

/**
 * One plain tide line for Nagalagam Street and the Colombo canal pages: next high tides, and that canals drain slowly
 * near high tide. When CUrW's Mutwal Inlet reading is available (Canals.sea) it adds the observed sea direction.
 */
export function TideLine({ lang, now, sea }: { lang: Locale; now: number; sea?: Canals["sea"] | null }) {
  const { t } = getI18n(lang);
  const cc = ccFor(lang);
  const h = highTideTimes(lang, now);
  if (!h.times) return null;
  const nextAfter = tideEvents(now, 30).filter((e) => e.kind === "high" && e.t > now + 90 * 60_000).slice(0, 2);
  const main = h.nearHigh
    ? cc("tide.now") + (nextAfter[0] ? " " + cc("tide.nowNext", { times: clock(nextAfter[0].t, t) }) : "")
    : `${cc("tide.highs", { times: h.times })} ${cc("tide.slow")}`;
  return (
    <section aria-label={cc("tide.title")} className="mt-3 flex items-start gap-2 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-3.5 py-3 text-sm text-sky-950 dark:text-sky-100" lang={lang}>
      <Waves className="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
      <div>
        <p>{main}</p>
        {sea?.trend && sea.observedMs != null && (
          <p className="mt-1 text-xs text-sky-900/80 dark:text-sky-200/80">
            {cc("tide.sea", { trend: cc(`tide.${sea.trend}` as CKeyTide), time: clock(sea.observedMs, t) })} {cc("canal.credit")}
          </p>
        )}
        {!sea?.trend && <p className="mt-1 text-xs text-sky-900/80 dark:text-sky-200/80">{cc("tide.basis")}</p>}
      </div>
    </section>
  );
}
type CKeyTide = "tide.rising" | "tide.falling" | "tide.steady";
