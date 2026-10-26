"use client";

import { useEffect, useState } from "react";
import { CloudRain, Download } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { ttFor } from "@/lib/i18n/town";
import { ccFor } from "@/lib/i18n/colombo";
import { highTideWithin } from "@/lib/tide";
import { clock } from "@/lib/i18n/format";
import { useI18n } from "../LocaleProvider";
import { useInstall } from "../InstallProvider";
import { StreetResearchLink } from "./StreetResearchLink";
import { useStreetAlert } from "./useStreetAlert";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const btn = `inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`;

/**
 * "Low ground near the canals" on canal-area town pages. Never a verdict step, badge or colour state of the town (the
 * ladder is the official one), and not on the index, the social image, the APIs or X. It says what the rain is doing
 * first, then has ONE switch: "Notify me when my street may get water" (app/flood/useStreetAlert.ts), which is the
 * server push pref plus the device note, so what it shows is what will actually happen.
 */
export function LowSpot({ slug, town, mm, level, canalHigh = false }: { slug: string; town: string; /** clipped 24 h satellite rain, null = no data */ mm: number | null; level: "possible" | "likely" | null; /** the basin's canal is higher than usual (CUrW / SLLDC levels); only spoken to people who opted in */ canalHigh?: boolean }) {
  const { lang, t } = useI18n();
  const rt = rtFor(lang);
  const cc = ccFor(lang);
  const tt = ttFor(lang);
  const { iosNeedsInstall, install } = useInstall();
  const a = useStreetAlert(slug, town, lang);
  const heavy = mm != null && level != null;
  const likely = heavy && level === "likely";

  const tone = likely
    ? "border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30"
    : heavy
      ? "border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30"
      : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60";
  const iconTone = likely ? "text-amber-600 dark:text-amber-400" : heavy ? "text-sky-600 dark:text-sky-400" : "text-slate-500 dark:text-slate-400";
  const headline = likely ? tt("low.hLikely") : heavy ? tt("low.hPossible") : mm == null ? tt("low.hNoData") : tt("low.hNone");

  // iPhone and iPad only deliver notifications to a site on the Home Screen: show the install step, not a switch that cannot work
  const needInstall = iosNeedsInstall && !a.on && (a.state === "local" && a.why === "unsupported");
  const status = a.busy
    ? tt("low.stSaving")
    : a.error
      ? tt("low.stError")
      : a.state === "ready"
        ? tt(a.on ? "low.stOn" : "low.stOff", { town })
        : a.state === "local" && a.why === "denied"
          ? tt("low.stDenied")
          : a.state === "local"
            ? tt(a.on ? "low.stLocalOn" : "low.stLocal")
            : "";

  return (
    <section aria-label={tt("low.title")} className={`mt-4 rounded-xl border p-4 sm:p-5 ${tone}`} lang={lang}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{tt("low.title")}</p>
      <h2 className={`mt-1 flex items-start gap-2 ${heavy ? "text-lg font-semibold tracking-tight" : "text-base font-medium"} text-slate-900 dark:text-slate-100`}>
        <CloudRain className={`mt-0.5 size-5 shrink-0 ${iconTone}`} aria-hidden /> <span>{headline}</span>
      </h2>
      {mm != null && (heavy || a.on) && <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">{tt("low.rain", { mm: Math.round(mm) })}</p>}
      {likely && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{tt("low.lanes")}</p>}
      {mm != null && !heavy && !a.on && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{tt("low.rain", { mm: Math.round(mm) })}</p>}
      {a.on && <TideNote t={t} cc={cc} />}
      {a.on && canalHigh && <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{cc("canal.highLow")}</p>}

      <div className="mt-3 border-t border-slate-200/80 dark:border-slate-700/70 pt-2">
        {needInstall ? (
          <div>
            <p className="text-sm text-slate-700 dark:text-slate-300" role="status">{rt("ins.alerts")}</p>
            <button type="button" onClick={() => install("street-water")} className={`${btn} mt-1.5`}>
              <Download className="size-4" aria-hidden /> {rt("ins.btn")}
            </button>
          </div>
        ) : a.state === "loading" ? (
          <div className="min-h-11" aria-hidden />
        ) : (
          <div>
            <button
              type="button"
              role="switch"
              aria-checked={a.on}
              aria-busy={a.busy}
              disabled={a.busy}
              onClick={a.toggle}
              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left disabled:opacity-70 ${ring}`}
            >
              <span className="text-[15px] font-medium leading-snug text-slate-900 dark:text-slate-100">{tt("low.switch")}</span>
              <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${a.on ? "bg-sky-600 dark:bg-sky-500" : "bg-slate-300 dark:bg-slate-600"}`}>
                <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${a.on ? "translate-x-5" : ""}`} />
              </span>
            </button>
            <p className={`mt-0.5 text-sm ${a.error || (a.state === "local" && a.why === "denied") ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-slate-400"}`} role="status" aria-live="polite">{status}</p>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{tt("low.honest")}</p>
      <div className="text-xs text-slate-600 dark:text-slate-400"><StreetResearchLink /></div>
      {lang !== "en" && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
    </section>
  );
}

/** Opt-in only: a high tide in the next 6 hours makes heavy rain more likely to leave water in low spots. Computed in the browser from the tide model. */
function TideNote({ t, cc }: { t: ReturnType<typeof useI18n>["t"]; cc: ReturnType<typeof ccFor> }) {
  const [now, setNow] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state (the clock), read after hydration
  useEffect(() => setNow(Date.now()), []);
  const h = now == null ? null : highTideWithin(now, 6);
  if (!h) return null;
  return <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{cc("low.tideSoon", { time: clock(h.t, t) })}</p>;
}
