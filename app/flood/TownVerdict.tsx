"use client";

import { CloudRain, Info, TriangleAlert, Waves, Ruler, Droplets, Landmark, CircleCheck, Siren } from "lucide-react";
import { VerdictCard, type T3, type VerdictTone } from "../ShareButton";
import { TimeAgo } from "../TimeAgo";
import { useI18n } from "../LocaleProvider";
import { CALL } from "../verdict";
import { assessTown, type ReasonKind, type TownRiskInput } from "@/lib/townRisk";
import { ttFor, type TKey } from "@/lib/i18n/town";
import { formatKm } from "@/lib/nearby";
import { riverName, clock } from "@/lib/i18n/format";
import { formatLevel, type Unit } from "@/lib/units";
import type { Thresholds } from "@/lib/readings";
import { useMyLevel } from "./useMyLevel";
import { StreetResearchLink } from "./StreetResearchLink";

const t3 = (key: TKey, vars?: Record<string, string | number>): T3 => ({
  en: ttFor("en")(key, vars),
  si: ttFor("si")(key, vars),
  ta: ttFor("ta")(key, vars),
});

const r1 = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

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

export type TownVerdictProps = {
  townName: string;
  input: TownRiskInput;
  gauge: { station: string; name: string; basin: string; km: number; unit: Unit; thresholds: Thresholds; level: number | null; ts: number | null; next24: number | null } | null;
  office: { district: string; tel: string } | null;
  serverNow: number;
  href: string;
};

/** Verdict card + "Why" list for a town. Client-side because the visitor's own street level (localStorage) changes it. */
export function TownVerdict({ townName, input, gauge, office, serverNow, href }: TownVerdictProps) {
  const { lang, t } = useI18n();
  const tt = ttFor(lang);
  const probe = assessTown(input, null);
  const mine = useMyLevel(probe.gauge?.station ?? gauge?.station ?? null);
  const r = mine != null ? assessTown(input, mine) : probe;

  const tone = r.tone as VerdictTone;
  const elevated = tone === "alert" || tone === "minor" || tone === "major";
  const stale = tone === "stale";
  // when the satellite street-rain trigger is what sets the verdict, say what it is about; otherwise the usual scale wording
  const verdict = t3(r.street?.drives ? (r.street.level === "likely" ? "tone.streetLikely" : "tone.streetPossible") : (`tone.${r.tone}` as TKey));
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

  const dayVars = r.day.vars;
  return (
    <>
      <VerdictCard
        tone={tone}
        verdict={verdict}
        direction={g ? t3(r.hourKey) : null}
        fact={stale && !r.heavyRain ? null : t3(r.day.key as TKey, dayVars)}
        labels={{ direction: t3("label.hour"), fact: t3("label.day") }}
        action={r.actionKey ? t3(r.actionKey) : null}
        outlook={{ trend: r.trend === "unknown" ? "unknown" : r.trend, text: <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{note}</p> }}
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
          {input.streetRain !== undefined && (
            <div className="mt-2.5 border-t border-slate-200 dark:border-slate-800 pt-2.5 text-slate-600 dark:text-slate-400" lang={lang}>
              <p>{tt("details.street")}</p>
              <p className="mt-1.5 tabular-nums">
                {input.streetRain
                  ? tt("details.streetNow", {
                      mm24: r1(input.streetRain.mm24h),
                      mm6: input.streetRain.mm6h != null ? r1(input.streetRain.mm6h) : "–",
                      time: clock(input.streetRain.endsAt, t),
                    })
                  : tt("details.streetNone")}
              </p>
              <p className="mt-1.5">{tt("details.streetHonest")}</p>
              <StreetResearchLink />
            </div>
          )}
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
