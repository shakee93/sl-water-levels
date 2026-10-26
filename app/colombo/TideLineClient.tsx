"use client";

import { useEffect, useState } from "react";
import { Waves } from "lucide-react";
import { ccFor } from "@/lib/i18n/colombo";
import { clock } from "@/lib/i18n/format";
import { colomboDay, tideEvents, tideNow } from "@/lib/tide";
import { useI18n } from "../LocaleProvider";

/**
 * The tide line for ISR-cached pages (Nagalagam Street): computed in the browser from the tide model, so it is never an
 * hour out of date, plus the observed sea direction from OUR /api/canals (never from CUrW's own host).
 */
export function TideLineClient() {
  const { lang, t, p } = useI18n();
  const cc = ccFor(lang);
  const [now, setNow] = useState<number | null>(null);
  const [sea, setSea] = useState<{ trend: string | null; observedAt: string | null } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state (the clock), read after hydration
    setNow(Date.now());
    const ctl = new AbortController();
    fetch("/api/canals?group=North%20Canal", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.sea && setSea(j.sea))
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  if (now == null) return null;
  const tn = tideNow(now);
  const highs = tn.highs.slice(0, 2);
  if (!highs.length) return null;
  const day = (ms: number) => (colomboDay(ms) === colomboDay(now) ? "tide.today" : "tide.tomorrow");
  const parts = highs.map((h) => cc(day(h.t), { time: clock(h.t, t) }));
  const times = parts.length === 2 ? cc("tide.and", { a: parts[0], b: parts[1] }) : parts[0];
  const after = tideEvents(now, 30).find((e) => e.kind === "high" && e.t > now + 90 * 60_000);
  const main = tn.nearHigh ? cc("tide.now") + (after ? " " + cc("tide.nowNext", { times: clock(after.t, t) }) : "") : `${cc("tide.highs", { times })} ${cc("tide.slow")}`;
  const trend = sea?.trend && ["rising", "falling", "steady"].includes(sea.trend) ? (sea.trend as "rising" | "falling" | "steady") : null;
  return (
    <section aria-label={cc("tide.title")} className="mt-3 flex items-start gap-2 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-3.5 py-3 text-sm text-sky-950 dark:text-sky-100">
      <Waves className="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
      <div>
        <p>{main}</p>
        <p className="mt-1 text-xs text-sky-900/80 dark:text-sky-200/80">
          {trend && sea?.observedAt ? `${cc("tide.sea", { trend: cc(`tide.${trend}`), time: clock(Date.parse(sea.observedAt), t) })} ${cc("canal.credit")} · ` : `${cc("tide.basis")} `}
          <a href={p("/colombo-canals")} className="underline underline-offset-2 hover:no-underline">{cc("drain.more")}</a>
        </p>
      </div>
    </section>
  );
}
