"use client";

import { CloudRain, Info, TriangleAlert, Waves, Ruler, Droplets, Landmark, CircleCheck, Siren } from "lucide-react";
import { VerdictCard, type T3, type VerdictTone } from "../ShareButton";
import { TimeAgo } from "../TimeAgo";
import { useI18n } from "../LocaleProvider";
import { CALL, hourReason, withReason } from "../verdict";
import { assessTown, type ReasonKind, type TownRisk, type TownRiskInput } from "@/lib/townRisk";
import { ttFor, type TKey } from "@/lib/i18n/town";
import { formatKm } from "@/lib/nearby";
import { riverName, clock, dayTick } from "@/lib/i18n/format";
import { markGap, dayOutlook } from "@/lib/townNotes";
import type { TownPeople } from "@/lib/townPeople";
import { isTidalStation } from "@/lib/verdictLift";
import { isShortForecastGauge } from "@/lib/forecastRules.mjs";
import { formatLevel, type Unit } from "@/lib/units";
import type { Thresholds } from "@/lib/readings";
import { useMyLevel } from "./useMyLevel";

const t3 = (key: TKey, vars?: Record<string, string | number>): T3 => ({
  en: ttFor("en")(key, vars),
  si: ttFor("si")(key, vars),
  ta: ttFor("ta")(key, vars),
});

/** Closer than this, the gauge is effectively in the town: do not say "no gauge here". */
const ON_GAUGE_KM = 1.5;

const ICON: Record<ReasonKind, typeof Waves> = {
  official: Siren,
  personal: Ruler,
  river: Waves,
  forecast: TriangleAlert,
  rain: CloudRain,
  canal: Droplets,
  release: Landmark,
  calm: CircleCheck,
  nogauge: Info,
};

const HOUR_ARROW: Partial<Record<TownRisk["hourKey"], TownRisk["trend"]>> = {
  "dir.rising": "up",
  "dir.slow": "up",
  "dir.falling": "down",
  "dir.steady": "steady",
  "dir.tide": "steady",
};

export type TownVerdictProps = {
  townName: string;
  input: TownRiskInput;
  gauge: { station: string; name: string; basin: string; km: number; unit: Unit; thresholds: Thresholds; level: number | null; ts: number | null; next24: number | null } | null;
  office: { district: string; tel: string } | null;
  serverNow: number;
  href: string;
  /** Aggregated answers from people near the town (lib/townPeople.ts); null = hidden (below the privacy minimum or unavailable). */
  people?: TownPeople | null;
};

/** Verdict card + "Why" list for a town. Client-side because the visitor's own street level (localStorage) changes it. */
export function TownVerdict({ townName, input, gauge, office, serverNow, href, people }: TownVerdictProps) {
  const { lang, t } = useI18n();
  const tt = ttFor(lang);
  const probe = assessTown(input, null);
  const mine = useMyLevel(probe.gauge?.station ?? gauge?.station ?? null);
  const r = mine != null ? assessTown(input, mine) : probe;

  const tone = r.tone as VerdictTone;
  const elevated = tone === "alert" || tone === "minor" || tone === "major";
  const stale = tone === "stale";
  const verdict = t3(`tone.${r.tone}` as TKey);
  const level = gauge?.level ?? null;
  const g = r.gauge;

  const fill = (vars: Record<string, string | number>) => {
    const out: Record<string, string | number> = { ...vars };
    if (typeof out.dir === "string" && out.dir.startsWith("w.")) out.dir = tt(out.dir as TKey);
    if (typeof out.tier === "string" && out.tier.startsWith("t.")) out.tier = tt(out.tier as TKey);
    if (typeof out.river === "string") out.river = riverName(out.river, lang);
    if (typeof out.area === "string" && input.warning && out.area === input.warning.area) out.area = riverName(out.area, lang);
    if (!("town" in out)) out.town = townName;
    return out;
  };

  const note = (stale && !g ? tt("note.none", { town: townName }) : g ? (g.km < ON_GAUGE_KM ? tt("note.onGauge", { gauge: g.name }) : tt("note.experimental", { town: townName, gauge: g.name, km: formatKm(g.km, t) })) : tt("note.experimentalGeneric", { town: townName })) + (lang !== "en" ? ` (${t("common.machineTranslated")})` : "");

  // a town the rules mark "watch" still reads Normal; the strongest reason is the small note under it (owner, 26 Oct 2026)
  const lead = tone === "watch" ? (r.reasons.find((x) => x.warn) ?? r.reasons[0]) : undefined;
  const nearNote = lead ? tt(lead.key as TKey, fill(lead.vars)) : null;
  const HOUR = 3_600_000;
  const timeAt = (h: number) => clock(serverNow + h * HOUR, t);
  const fmtFt = (ft: number) => `${ft.toFixed(1)} ft`;

  // ---- notes under the verdict. Display only: they never change the step, pill, sticky bar, push or tone.
  // gauge marks are only used when the gauge the estimate rests on is the one the card got thresholds for
  const gg = g && gauge && gauge.station === g.station && gauge.level != null && !stale ? gauge : null;

  // 1. why this step: it comes from an official warning or a confirmed release, not the gauge's own level
  let whyNote: React.ReactNode = null;
  if (r.why && elevated) {
    const w = input.warning;
    if (r.why.kind === "warning" && w) {
      const iso = w.issuedAt ? Date.parse(w.issuedAt) : NaN;
      const when = Number.isFinite(iso) ? (dayTick(iso, t) === dayTick(serverNow, t) ? clock(iso, t) : `${dayTick(iso, t)} ${clock(iso, t)}`) : null;
      const vars = fill({ source: w.source, area: w.area });
      const text = when ? tt("why.warningAt", { ...vars, time: when }) : tt("why.warning", vars);
      whyNote = (
        <>
          {text}
          {w.url && (
            <>
              {" · "}
              <a href={w.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-900 dark:hover:text-slate-100">
                {tt("why.read")}
              </a>
            </>
          )}
        </>
      );
    } else if (r.why.kind === "release") {
      whyNote = tt("why.release", { res: r.why.res, cusecs: r.why.cusecs.toLocaleString("en-US") });
    }
  }

  // 2. distance to the next official mark, in the gauge's own unit (skipped when the unit is unknown)
  let gapNote: string | null = null;
  const gap = gg ? markGap(gg.level, gg.thresholds, gg.unit) : null;
  if (gg && gap) {
    const m = (k: "alert" | "minor" | "major") => tt(`mk.${k}` as TKey);
    const atMark = gap.above && gap.above.ft < 0.1;
    const text = atMark
      ? tt("gap.at", { m: m(gap.above!.mark) })
      : gap.above && gap.below
        ? tt("gap.aboveBelow", { a: fmtFt(gap.above.ft), m: m(gap.above.mark), d: fmtFt(gap.below.ft), m2: m(gap.below.mark) })
        : gap.above
          ? tt("gap.above", { a: fmtFt(gap.above.ft), m: m(gap.above.mark) })
          : gap.below
            ? tt("gap.below", { d: fmtFt(gap.below.ft), m: m(gap.below.mark) })
            : null;
    gapNote = text && (gg.km >= ON_GAUGE_KM ? `${gg.name}: ${text}` : text);
  }

  // 3. a concrete "Next 24 hours" when the line would only say "Risk stays high" (forecast central levels the tiles already use)
  let dayKey = r.day.key as TKey;
  let dayVars: Record<string, string | number> = r.day.vars;
  // "Falling now" stays unless the forecast sees the river rise again (peak / rising); only "Risk stays high" is swapped for the other day lines
  const fallingDay = r.day.key === "n24.falling" || r.day.key === "n24.fallingKeeps";
  if ((r.day.key === "n24.stay" || fallingDay) && gg && !isTidalStation(gg.station) && input.forecast && input.forecast.status !== "unavailable") {
    const o = dayOutlook({ level: gg.level, horizons: input.forecast.horizons, alertMark: gg.thresholds.alert, unit: gg.unit, shortOnly: isShortForecastGauge(gg.station) });
    if (o && !(fallingDay && o.kind !== "peak" && o.kind !== "rising")) {
      const lv = (v: number) => formatLevel(v, gg.unit);
      if (o.kind === "peak") { dayKey = "n24.peak"; dayVars = { level: lv(o.level), time: timeAt(o.h) }; }
      else if (o.kind === "rising") { dayKey = "n24.rising"; dayVars = { level: lv(o.level) }; }
      else if (o.kind === "backBelow") { dayKey = "n24.back"; dayVars = { mark: lv(o.mark), time: timeAt(o.h) }; }
      else if (o.kind === "flat") { dayKey = "n24.flat"; dayVars = { level: lv(o.level) }; }
      else { dayKey = "n24.easing"; dayVars = { level: lv(o.level) }; }
    }
  }

  // 4. what people near the town said today (counts only, hidden below the minimum)
  let peopleNote: string | null = null;
  if (people?.answers) {
    const a = people.answers;
    const parts = [a.yes > 0 ? tt("people.yes", { n: a.yes }) : null, a.worse > 0 ? tt("people.worse", { n: a.worse }) : null, a.better > 0 ? tt("people.better", { n: a.better }) : null].filter(Boolean);
    if (parts.length) peopleNote = tt("people.line", { n: a.n, town: townName, parts: parts.join(", ") });
  }
  const waterNote = people?.water ? tt("people.water", { n: people.water.n, h: people.water.hours }) : null;
  const moreNotes: React.ReactNode[] = [whyNote, gapNote, peopleNote, waterNote].filter((x) => x != null);
  return (
    <>
      <VerdictCard
        tone={tone}
        verdict={verdict}
        direction={
          g
            ? withReason(
                t3(r.hourKey),
                r.hourKey === "dir.falling" || r.hourKey === "dir.steady" || r.hourKey === "dir.rising" || r.hourKey === "dir.slow"
                  ? hourReason({
                      kind: r.hourKey === "dir.falling" ? "falling" : r.hourKey === "dir.steady" ? "steady" : "rising",
                      delta3hM: g.rate3hM != null ? g.rate3hM * 3 : null,
                      unit: g.unit,
                      heavyRain: input.rain ? r.heavyRain : null,
                      lowRain: input.rain != null && input.rain.past6hMm < 10,
                      release: !!input.release?.confirmed,
                    })
                  : null,
              )
            : null
        }
        fact={stale && !r.heavyRain ? null : t3(dayKey, dayVars)}
        tide={r.hourKey === "dir.tide"}
        labels={{ direction: t3("label.hour"), fact: t3("label.day") }}
        action={r.actionKey ? t3(r.actionKey) : null}
        // The arrow follows the same next-hour call as the words beside it ("River rising slowly"
        // with a down arrow happened when the past 3 h fell but the forecast turned up).
        outlook={{ trend: HOUR_ARROW[r.hourKey] ?? r.trend, text: <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{note}</p> }}
        note={nearNote}
        moreNotes={moreNotes}
        call={elevated ? CALL : null}
        office={elevated && office ? { label: t("common.callDmcOffice", { district: office.district }), tel: office.tel } : null}
        footer={
          gauge?.ts != null ? (
            <>
              {t("common.readingAt", { time: clock(gauge.ts, t) })} · <TimeAgo ts={gauge.ts} serverNow={serverNow} />
            </>
          ) : (
            tt("estimate")
          )
        }
        level={level != null && !stale ? formatLevel(level, gauge?.unit ?? null) : null}
        levelInfo={level != null && !stale && gauge ? t("level.info", { level: formatLevel(level, gauge.unit ?? null), gauge: gauge.name }) : null}
        gauge={!stale && gauge && level != null ? { tone, level, next24: gauge.next24, unit: gauge.unit, thresholds: gauge.thresholds } : null}
        share={{ href, name: `${townName} · ${tt("estimate")}`, text: `${townName} · ${tt("estimate")}: ${verdict[lang]}` }}
      >
        <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
          <p className="font-medium">{tt("details.how")}</p>
          <ul className="mt-1.5 space-y-1 text-slate-600 dark:text-slate-400">
            {(["details.1", "details.2", "details.3", "details.4"] as const).map((k) => (
              <li key={k}>· {tt(k)}</li>
            ))}
          </ul>
        </div>
      </VerdictCard>

      {r.reasons.length > 0 && (
        <section aria-label={tt("sec.why")} className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            {tt("sec.why")}
          </h2>
          <ul className="space-y-2.5" lang={lang}>
            {r.reasons.map((x, i) => {
              const Icon = ICON[x.kind];
              return (
                <li key={`${x.key}-${i}`} data-reason={x.kind} className="flex items-start gap-2.5 text-sm sm:text-base text-slate-800 dark:text-slate-200">
                  <Icon className={`mt-0.5 size-4.5 shrink-0 ${x.warn ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500"}`} aria-hidden />
                  <span>{tt(x.key as TKey, fill(x.vars))}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
