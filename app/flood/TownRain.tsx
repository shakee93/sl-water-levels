import { CloudRain } from "lucide-react";
import type { TownRain as Rain } from "@/lib/townWeather";
import { ttFor, type TT } from "@/lib/i18n/town";
import type { Locale } from "@/lib/i18n/config";
import { RainBars, type RainBarView } from "./RainBars";
import { h12, leadLine, localHour, rainClass, yScale, type RainBar, type RainClass } from "@/lib/rainChart";

const HOUR = 3_600_000;
/** Bar fill by intensity (light / moderate / heavy / very heavy). Heavy stays amber like the rest of the site. */
const FILL: Record<RainClass, string> = {
  light: "bg-sky-300 dark:bg-sky-300",
  moderate: "bg-blue-600 dark:bg-blue-500",
  heavy: "bg-amber-500",
  violent: "bg-red-600 dark:bg-red-500",
};
type Sat = { hours: { end: number; mm: number | null }[]; mm24h: number | null; mm24hClipped: number | null };

const hr = (tt: TT, hour: number) => {
  const { h, pm } = h12(hour);
  return tt("rain.hr", { h, ap: tt(pm ? "rain.pm" : "rain.am") });
};
/** "7–8 pm" for the hour that ends at `end`. */
function range(tt: TT, end: number) {
  const a = localHour(end - HOUR).hour, b = localHour(end).hour;
  const A = h12(a), B = h12(b);
  return A.pm === B.pm
    ? tt("rain.rangeSame", { a: A.h, h: B.h, ap: tt(B.pm ? "rain.pm" : "rain.am") })
    : tt("rain.rangeDiff", { a: hr(tt, a), b: hr(tt, b) });
}

/**
 * Rain at the town: one plain sentence, then 24 hourly bars of what fell and 24 of what is forecast.
 * Fallen rain is the satellite's where the town has a satellite zone (canal-flood towns), else the weather model's.
 */
export function TownRain({ lang, town, rain, reason, sat }: { lang: Locale; town: string; rain: Rain | null; reason: string | null; sat?: Sat | null }) {
  const tt = ttFor(lang);
  const head = (
    <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><CloudRain className="size-4" aria-hidden />{tt("sec.rain", { town })}</h2>
  );
  if (!rain) {
    void reason; // shown to nobody: the sentence below is the plain-language version
    return (
      <section className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        {head}
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{tt("sec.rainFail", { town })}</p>
      </section>
    );
  }

  // Fallen: satellite hours where we have them (a missing hour stays empty, never filled from the model), else the model.
  const satByEnd = sat ? new Map(sat.hours.map((h) => [h.end, h.mm])) : null;
  const past: RainBar[] = rain.past.map((p) => ({ end: p.end, mm: satByEnd ? (satByEnd.get(p.end) ?? null) : p.mm }));
  const next: RainBar[] = rain.next.map((p) => ({ end: p.end, mm: p.mm }));
  const pastSum = past.reduce((s, x) => s + (x.mm ?? 0), 0);
  const pastKnown = past.filter((x) => x.mm != null).length;
  const past24 = sat ? (sat.mm24h ?? (pastKnown >= 18 ? pastSum : null)) : rain.past24hMm;
  const all = [...past, ...next];
  const peak = Math.max(0, ...all.map((b) => b.mm ?? 0));
  const { max, ticks } = yScale(peak);

  const lead = leadLine(past, past24, next, rain.nowHour);
  const cls = (c?: string) => tt(`rain.cls.${c}` as "rain.cls.light");
  const leadText = [
    tt(lead.past.key, { cls: cls(lead.past.cls), mm: lead.past.mm ?? 0 }),
    tt(lead.next.key, { cls: cls(lead.next.cls), mm: lead.next.mm ?? 0, when: lead.next.when ? tt(`rain.when.${lead.next.when}` as "rain.when.early") : "" }),
  ].join(" ");

  const pastSrc = tt(sat ? "rain.src.sat" : "rain.src.model");
  const views: RainBarView[] = all.map((b, i) => {
    const fut = i >= past.length;
    const c = b.mm != null ? rainClass(b.mm) : null;
    const rg = range(tt, b.end);
    const label =
      b.mm == null ? tt("rain.tipNA", { range: rg })
      : c == null ? tt("rain.tip0", { range: rg })
      : tt("rain.tip", { range: rg, mm: Math.round(b.mm * 10) / 10, cls: cls(c).toLowerCase() });
    return {
      key: b.end,
      frac: b.mm == null ? 0.015 : c == null ? 0 : Math.max(0.015, b.mm / max),
      color: b.mm == null ? "bg-slate-200 dark:bg-slate-700" : c ? FILL[c] : "",
      fut,
      label,
      source: fut ? tt("rain.src.fc") : pastSrc,
    };
  });
  // 6-hourly labels fit at 375 px in English; the longer Sinhala and Tamil am/pm words only fit every 12 hours
  const labelEvery = lang === "en" ? 6 : 12;
  const times = all.flatMap((b, i) => (localHour(b.end - HOUR).hour % labelEvery === 0 ? [{ i, text: hr(tt, localHour(b.end - HOUR).hour) }] : []));
  const anyViolent = all.some((b) => b.mm != null && rainClass(b.mm) === "violent");
  const leadId = `rain-lead-${town.replace(/\W+/g, "")}`;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5" lang={lang}>
      {head}
      <p id={leadId} className="mt-1.5 text-[15px] leading-snug text-slate-900 dark:text-slate-100">{leadText}</p>

      <RainBars
        bars={views}
        ticks={ticks.map((v) => ({ label: String(v), frac: v / max }))}
        times={times}
        nowIndex={past.length}
        nowLabel={tt("rain.now")}
        unitLabel={tt("rain.scale")}
        hint={tt("rain.tipHint")}
        groupLabel={tt("rain.group", { town })}
        describedBy={leadId}
      />

      <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400" aria-label={tt("rain.legend.hint")}>
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-blue-600 dark:bg-blue-500" />{tt("rain.legend.fallen")}</li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-blue-600 dark:bg-blue-500" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 2px, transparent 2px 4px)" }} />
          {tt("rain.legend.forecast")}
        </li>
        <li aria-hidden className="text-slate-300 dark:text-slate-600">|</li>
        {(["light", "moderate", "heavy", ...(anyViolent ? ["violent"] : [])] as RainClass[]).map((c) => (
          <li key={c} className="flex items-center gap-1.5"><span aria-hidden className={`size-2.5 rounded-full ${FILL[c]}`} />{cls(c)}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{tt(sat ? "rain.srcLine.sat" : "rain.srcLine.model")}</p>
    </section>
  );
}
