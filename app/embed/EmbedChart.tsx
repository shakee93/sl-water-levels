"use client";

// The gauge page's own chart (app/LevelChart.tsx, Recharts) inside an embed: same lines, band, mark lines, labels, tooltip, "Now" marker.
// It is loaded as a separate chunk after the numbers have rendered, so the first paint carries no chart code. The chart reads a handful
// of dictionary entries and the visitor's ?days=; here the entries come in the payload (already in the widget's language) and the range
// is the 24 h / 72 h buttons below.
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LocaleProvider } from "@/app/LocaleProvider";
import type { Dict } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import type { Reading } from "@/lib/readings";
import type { LChart } from "@/lib/embedTypes";

const LevelChart = dynamic(() => import("@/app/LevelChart").then((m) => m.LevelChart), { ssr: false });

const HEIGHT = { full: "h-60", compact: "h-40" } as const;
const BOX = { full: "min-h-60", compact: "min-h-40" } as const;

export function EmbedChart({ chart, lang, station, accent, compact, noRange }: { chart: LChart; lang: Locale; station: string; accent: string | null; compact?: boolean; noRange?: boolean }) {
  const [hours, setHours] = useState<24 | 72>(chart.hours);
  const readings = useMemo<Reading[]>(() => chart.readings.map(([ts, v]) => ({ ts, water_level: v, rain_fall: null })), [chart.readings]);
  const forecast = useMemo(() => (chart.forecast.length ? { points: chart.forecast } : null), [chart.forecast]);
  const k = compact ? "compact" : "full";
  return (
    <div className="mt-4">
      <div className="flex items-center justify-end gap-2">
        {chart.has72 && !compact && !noRange && (
          <div role="radiogroup" aria-label="Range" className="inline-flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 text-xs">
            {([24, 72] as const).map((h) => (
              <button key={h} type="button" role="radio" aria-checked={hours === h} onClick={() => setHours(h)} className={`px-2 py-1 tabular-nums ${hours === h ? "bg-slate-200 font-semibold dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                {h} h
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`mt-1.5 ${BOX[k]}`}>
        <LocaleProvider lang={lang} dict={chart.dict as Dict}>
          <LevelChart
            station={station}
            readings={readings}
            thresholds={chart.marks}
            unit={null}
            unitLabel={chart.unit || null}
            forecast={forecast}
            days={compact ? 1 : hours / 24}
            accent={accent}
            embed
            compact={compact}
            heightCls={HEIGHT[k]}
          />
        </LocaleProvider>
      </div>
    </div>
  );
}
