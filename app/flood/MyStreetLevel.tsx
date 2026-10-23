"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import { writeMyLevel } from "@/lib/myLevels";
import { ttFor } from "@/lib/i18n/town";
import { formatLevel, type Unit } from "@/lib/units";
import { useI18n } from "../LocaleProvider";
import { useMyLevel } from "./useMyLevel";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

/** "Set your street's flood level": the gauge reading at which water reaches the visitor's street. Browser-only (sl_my_levels). */
export function MyStreetLevel({ station, name, unit, level }: { station: string; name: string; unit: Unit; level: number | null }) {
  const { lang } = useI18n();
  const tt = ttFor(lang);
  const saved = useMyLevel(station);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(draft.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0 || v > 1000) {
      setBad(true);
      return;
    }
    setBad(false);
    writeMyLevel(station, Math.round(v * 100) / 100);
    setDraft("");
  }

  const input = "h-11 w-32 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-base tabular-nums text-slate-900 dark:text-slate-100 placeholder:text-slate-400";
  return (
    <section aria-label={tt("my.title")} className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Ruler className="size-4" aria-hidden /> {tt("my.title")}
      </h2>
      <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400" lang={lang}>{tt("my.help", { gauge: name })}</p>
      {saved != null && (
        <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100" lang={lang}>
          {tt("my.saved", { level: formatLevel(saved, unit), gauge: name, now: level != null ? formatLevel(level, unit) : "—" })}
        </p>
      )}
      <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`my-level-${station}`}>{tt("my.label", { gauge: name })}</label>
        <input
          id={`my-level-${station}`}
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={tt("my.placeholder", { unit: unit ? ` (${unit})` : "" })}
          aria-invalid={bad}
          className={`${input} ${ring}`}
        />
        <button type="submit" className={`h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white ${ring}`}>
          {tt("my.save")}
        </button>
        {saved != null && (
          <button
            type="button"
            onClick={() => writeMyLevel(station, null)}
            className={`h-11 rounded-md border border-slate-300 dark:border-slate-700 px-4 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}
          >
            {tt("my.clear")}
          </button>
        )}
        {bad && <span className="text-sm text-amber-700 dark:text-amber-300" role="alert">{tt("my.invalid")}</span>}
      </form>
    </section>
  );
}
