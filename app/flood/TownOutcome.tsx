"use client";

// "How our warnings did" on a town page that has the street-rain rule: what we said recently and what neighbours
// reported, plus an honest running score. Aggregates only, never fewer than 3 answers behind a number
// (app/api/town-outcome/route.ts). Always the same height, so nothing below it moves when the numbers arrive.
import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { useI18n } from "../LocaleProvider";

type Outcome = { day: string; said: "possible" | "likely"; result: "wet" | "dry" | "mixed"; total: number };
type Data = { today: string; outcomes: Outcome[]; score: { warnedDays: number; confirmedDays: number; checkedDays: number } | null; river: { pct: number; n: number } | null };

const dayBefore = (day: string) => new Date(Date.parse(day + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);

export function TownOutcome({ slug }: { slug: string }) {
  const { lang } = useI18n();
  const rt = rtFor(lang);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/town-outcome?town=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Data & { ok: boolean }>) : Promise.reject(new Error("bad"))))
      .then((j) => alive && setData(j))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  const when = (day: string) => (data && day === data.today ? rt("cl.today") : data && day === dayBefore(data.today) ? rt("cl.yesterday") : day);
  const empty = data != null && data.outcomes.length === 0 && !data.score && !data.river;
  if (failed) return null;

  return (
    <section aria-label={rt("cl.title")} lang={lang} className="mt-4 min-h-[8.5rem] sm:min-h-[7rem] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <ClipboardCheck className="size-4" aria-hidden /> {rt("cl.title")}
      </h2>
      <div className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-300" aria-live="polite">
        {data == null && <p className="text-slate-500 dark:text-slate-400">…</p>}
        {data?.outcomes.map((o) => (
          <p key={o.day}>
            {rt(o.said === "likely" ? "cl.said.likely" : "cl.said.possible", { when: when(o.day) })}{" "}
            <span className="text-slate-600 dark:text-slate-400">{rt(o.result === "wet" ? "cl.wet" : o.result === "dry" ? "cl.dry" : "cl.mixed", { n: o.total })}</span>
          </p>
        ))}
        {data?.score && <p className="text-slate-600 dark:text-slate-400">{rt("cl.score", { c: data.score.confirmedDays, k: data.score.checkedDays })}</p>}
        {data?.river && <p className="text-slate-600 dark:text-slate-400">{rt("cl.river", { pct: data.river.pct, n: data.river.n })}</p>}
        {empty && <p className="text-slate-600 dark:text-slate-400">{rt("cl.empty")}</p>}
        {data != null && <p className="text-slate-500 dark:text-slate-400">{rt("cl.help")}</p>}
      </div>
    </section>
  );
}
