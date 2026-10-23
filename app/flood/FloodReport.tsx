"use client";

import { useState, useSyncExternalStore } from "react";
import { CircleCheck, Droplets } from "lucide-react";
import { reportCookieName, colomboDay } from "@/lib/floodReport";
import { ttFor, type TKey } from "@/lib/i18n/town";
import { useI18n } from "../LocaleProvider";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const ANSWERS: { id: "deep" | "little" | "dry"; key: TKey }[] = [
  { id: "deep", key: "fr.deep" },
  { id: "little", key: "fr.little" },
  { id: "dry", key: "fr.dry" },
];
const WHEN: { id: "now" | "earlier"; key: TKey }[] = [
  { id: "now", key: "fr.now" },
  { id: "earlier", key: "fr.earlier" },
];

// "Already answered today" lives in a cookie the route sets; useSyncExternalStore keeps server and client markup equal on first paint.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
const answeredToday = (slug: string) => () => {
  try {
    return document.cookie.split("; ").includes(`${reportCookieName(slug)}=${colomboDay(Date.now())}`);
  } catch {
    return false;
  }
};

/** Milliseconds since this page started loading. */
const sincePageOpen = () => Math.round(performance.now());

type Phase = "idle" | "sending" | "done" | "error" | "limit";

/** "Did the streets near you get water today?" Anonymous: town slug, one of three answers, optional now/earlier. Nothing is shown publicly. */
export function FloodReport({ slug, town }: { slug: string; town: string }) {
  const { lang } = useI18n();
  const tt = ttFor(lang);
  const already = useSyncExternalStore(subscribe, answeredToday(slug), () => false);
  const [when, setWhen] = useState<"now" | "earlier" | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hp, setHp] = useState(""); // honeypot: invisible to people

  async function send(answer: string) {
    if (phase === "sending") return;
    setPhase("sending");
    try {
      const res = await fetch("/api/flood-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ms = time since this page opened (a script that answers instantly is dropped on the server)
        body: JSON.stringify({ town: slug, answer, when, lang, hp, ms: sincePageOpen() }),
      });
      if (res.ok) {
        listeners.forEach((l) => l());
        setPhase("done");
      } else setPhase(res.status === 429 ? "limit" : "error");
    } catch {
      setPhase("error");
    }
  }

  const done = phase === "done" || already;
  const chip = (on: boolean) =>
    `inline-flex items-center min-h-11 rounded-full border px-4 text-sm transition ${ring} ${
      on
        ? "border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-950 dark:text-sky-100"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
    }`;

  return (
    <section aria-label={tt("fr.title")} className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Droplets className="size-4" aria-hidden /> {tt("fr.title")}
      </h2>
      {done ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200" role="status" lang={lang}>
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {phase === "done" ? tt("fr.thanks") : tt("fr.already", { town })}
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400" lang={lang}>{tt("fr.intro")}</p>
          <div className="mt-3" role="group" aria-label={tt("fr.when")}>
            <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400" lang={lang}>{tt("fr.when")}</p>
            <div className="flex flex-wrap gap-2">
              {WHEN.map((w) => (
                <button key={w.id} type="button" aria-pressed={when === w.id} onClick={() => setWhen(when === w.id ? null : w.id)} className={chip(when === w.id)} lang={lang}>
                  {tt(w.key)}
                </button>
              ))}
            </div>
          </div>
          {/* honeypot: people never see or fill this */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
            className="absolute left-[-9999px] h-0 w-0 opacity-0"
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {ANSWERS.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={phase === "sending"}
                onClick={() => send(a.id)}
                lang={lang}
                className={`min-h-11 rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 ${ring}`}
              >
                {tt(a.key)}
              </button>
            ))}
          </div>
          <p className="mt-2 min-h-5 text-sm" role="status" lang={lang}>
            {phase === "sending" && <span className="text-slate-500 dark:text-slate-400">{tt("fr.sending")}</span>}
            {phase === "error" && <span className="text-amber-700 dark:text-amber-300">{tt("fr.error")}</span>}
            {phase === "limit" && <span className="text-slate-600 dark:text-slate-300">{tt("fr.limit")}</span>}
          </p>
        </>
      )}
    </section>
  );
}
