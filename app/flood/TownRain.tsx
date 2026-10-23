import { CloudRain } from "lucide-react";
import type { TownRain as Rain } from "@/lib/townWeather";
import { ttFor } from "@/lib/i18n/town";
import type { Locale } from "@/lib/i18n/config";

/** WMO/AMS "heavy" rain rate, mm per hour: such hours are drawn amber. */
const HEAVY_HOURLY_MM = 7.6;
const W = 480, H = 96, TOP = 8, BOT = 18;

/** Rain at the town: 24 hourly bars of what fell, then 24 of what is forecast. Pure SVG, no client JS. */
export function TownRain({ lang, town, rain, reason }: { lang: Locale; town: string; rain: Rain | null; reason: string | null }) {
  const tt = ttFor(lang);
  if (!rain) {
    void reason; // shown to nobody: the sentence below is the plain-language version
    return (
      <section className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><CloudRain className="size-4" aria-hidden />{tt("sec.rain", { town })}</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{tt("sec.rainFail", { town })}</p>
      </section>
    );
  }
  const bars = [...rain.past, ...rain.next];
  const max = Math.max(10, ...bars.map((b) => b.mm));
  const slot = W / bars.length;
  const bw = slot * 0.7;
  const plot = H - TOP - BOT;
  const a = Math.round(rain.past24hMm), b = Math.round(rain.next24hMm);
  return (
    <section className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><CloudRain className="size-4" aria-hidden />{tt("sec.rain", { town })}</h2>
      <p className="mt-1 text-sm tabular-nums text-slate-800 dark:text-slate-200" lang={lang}>{tt("sec.rainLegend", { a, b })}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full h-auto" role="img" aria-label={tt("rain.aria", { town, a, b })}>
        <line x1={0} x2={W} y1={H - BOT} y2={H - BOT} className="stroke-slate-200 dark:stroke-slate-700" />
        {bars.map((x, i) => {
          const h = Math.max(x.mm > 0 ? 1.5 : 0, (x.mm / max) * plot);
          const fut = i >= rain.past.length;
          const heavy = x.mm >= HEAVY_HOURLY_MM;
          return (
            <rect
              key={x.end}
              x={i * slot + (slot - bw) / 2}
              y={H - BOT - h}
              width={bw}
              height={h}
              rx={1}
              className={heavy ? "fill-amber-500" : fut ? "fill-sky-500 dark:fill-sky-400" : "fill-slate-400 dark:fill-slate-500"}
            />
          );
        })}
        <line x1={rain.past.length * slot} x2={rain.past.length * slot} y1={TOP - 4} y2={H - BOT + 4} strokeDasharray="3 3" className="stroke-slate-400 dark:stroke-slate-500" />
        <g className="fill-slate-500 dark:fill-slate-400" fontSize="10">
          <text x={0} y={H - 4}>{tt("rain.past")}</text>
          <text x={rain.past.length * slot} y={H - 4} textAnchor="middle">{tt("rain.now")}</text>
          <text x={W} y={H - 4} textAnchor="end">{tt("rain.next")}</text>
        </g>
      </svg>
    </section>
  );
}
