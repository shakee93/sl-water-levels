import { ClampedText } from "./ClampedText";
import { CloudRain, TriangleAlert } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { loadForecast, type Forecast as ForecastT } from "@/lib/forecast";
import { getAdvisory } from "@/lib/advisory";
import { DISTRICT_BY_STATION } from "@/lib/districts";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";
import { contactsForDistrict } from "@/lib/help";
import { statusFor } from "@/lib/status";
import { formatLevel } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import { stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { clock, riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";
import { AdvisoryText, VerdictCard, type T3, type VerdictTone } from "./ShareButton";
import { CALL, STEADY_M_PER_H, VERDICT, directionFor } from "./verdict";

const HOUR = 3_600_000;
const fmtRain = (v: number | null, t: TFn) => (v == null ? t("common.na") : `${v.toFixed(1)} mm`);

const ACTION: Partial<Record<VerdictTone, T3>> = {
  alert: { en: "Move valuables up, charge your phone", si: "ඔබේ භාණ්ඩ ඉහළට ගෙන යන්න, දුරකථනය චාජ් කරන්න", ta: "உடைமைகளை உயரத்தில் வையுங்கள், தொலைபேசியை சார்ஜ் செய்யுங்கள்" },
  minor: { en: "Be ready to leave low areas", si: "පහත් ප්‍රදේශවලින් ඉවත් වීමට සූදානම් වන්න", ta: "தாழ்வான பகுதிகளிலிருந்து வெளியேறத் தயாராக இருங்கள்" },
  major: { en: "Follow official instructions", si: "නිල උපදෙස් අනුගමනය කරන්න", ta: "அதிகாரப்பூர்வ அறிவுறுத்தல்களைப் பின்பற்றுங்கள்" },
};
const ORDER = ["normal", "watch", "alert", "minor", "major"] as const;

function hoursPhrase(n: number): T3 {
  return n <= 1
    ? { en: "~1 hour", si: "පැයක් පමණ", ta: "சுமார் 1 மணி நேரம்" }
    : { en: `~${n} hours`, si: `පැය ${n}ක් පමණ`, ta: `சுமார் ${n} மணி நேரம்` };
}

/** One forecast fact, or null. Never numbers beyond the ETA, never probabilities. */
function forecastFact(f: ForecastT, tier: string, now: number): { fact: T3 | null; target: number } {
  const c = f.crossings
    .filter((x) => x.wording === "likely" || x.wording === "possible")
    .sort((a, b) => (a.etaTs ?? Infinity) - (b.etaTs ?? Infinity))[0];
  if (c) {
    const flood = c.threshold !== "alert";
    const lvl = flood
      ? { en: "flood level", si: "ගංවතුර මට්ටම", ta: "வெள்ள மட்டத்தை" }
      : { en: "alert level", si: "අනතුරු ඇඟවීමේ මට්ටම", ta: "எச்சரிக்கை மட்டத்தை" };
    const target = ORDER.indexOf(c.threshold);
    if (c.etaTs != null) {
      const n = Math.max(1, Math.round((c.etaTs - now) / HOUR));
      const h = hoursPhrase(n);
      return {
        target,
        fact: {
          en: `Could reach ${lvl.en} in ${h.en}`,
          si: `${h.si} ඇතුළත ${lvl.si}ට ළඟා විය හැක`,
          ta: `${h.ta}ில் ${lvl.ta} எட்டலாம்`,
        },
      };
    }
    return {
      target,
      fact: {
        en: `Could reach ${lvl.en} within 24 hours`,
        si: `පැය 24ක් ඇතුළත ${lvl.si}ට ළඟා විය හැක`,
        ta: `24 மணி நேரத்தில் ${lvl.ta} எட்டலாம்`,
      },
    };
  }
  if (f.method === "model" && f.status === "ok" && (tier === "normal" || tier === "watch")) {
    return {
      target: -1,
      fact: { en: "No flooding expected today", si: "අද ගංවතුර අපේක්ෂා නොකෙරේ", ta: "இன்று வெள்ளம் எதிர்பார்க்கப்படவில்லை" },
    };
  }
  if (f.method === "trend" && tier === "watch") {
    return { target: -1, fact: { en: "Close to alert level", si: "අනතුරු ඇඟවීමේ මට්ටමට ආසන්නයි", ta: "எச்சரிக்கை மட்டத்திற்கு அருகில்" } };
  }
  return { fact: null, target: -1 };
}

/**
 * Verdict tier: the real tier, upgraded to "alert" (Get ready) when a crossing is
 * forecast within 24h. Never upgrades into "Flooding now" / "Move to safety": those
 * describe what is happening, so they only come from the measured level.
 */
function upgrade(tier: VerdictTone, target: number): VerdictTone {
  if ((tier === "normal" || tier === "watch") && target >= ORDER.indexOf("alert")) return "alert";
  return tier;
}

export async function Forecast({ lang, basin, selectedStation }: { lang: Locale; basin: string; selectedStation: string }) {
  if (!basin) return null;
  const { t, p } = getI18n(lang);
  const fmtTime = (ts: number) => clock(ts, t);
  const warningsP = getOfficialWarnings(); // fails soft, never throws
  const snapshot = await fetchBasinSnapshot(basin);
  if (snapshot.length === 0) return null;
  const f = await loadForecast(basin, snapshot, selectedStation);
  const me = snapshot.find((s) => s.station === selectedStation);
  const district = DISTRICT_BY_STATION[selectedStation] ?? null;
  const latest = me?.latest ?? null;
  const status = statusFor(latest?.water_level ?? null, me?.thresholds ?? { alert: null, minor: null, major: null }, latest?.ts);
  const realTier = status.tier;
  const [advisory, warnings] = await Promise.all([
    getAdvisory({ station: selectedStation, river: basin.trim(), district, tier: realTier, forecast: f }),
    warningsP.then((w) => warningsForBasin(w, basin)),
  ]);

  const stale = realTier === "stale";
  const now = f.asOfTs ?? latest?.ts ?? 0;
  const { fact: rawFact, target } = stale ? { fact: null, target: -1 } : forecastFact(f, realTier, now);
  // "Next 24 hours" always has an answer when the gauge is live, even if it's "no estimate".
  const fact: T3 | null = stale
    ? null
    : (rawFact ?? { en: "No estimate yet", si: "තවම ඇස්තමේන්තුවක් නැත", ta: "இன்னும் மதிப்பீடு இல்லை" });
  const tone = stale ? "stale" : upgrade(realTier, target);

  // "Next hour": the forecast's 1 h change when there is one (metres, unit-aware),
  // otherwise the recent 3 h rate as a persistence guess.
  const h1 = f.horizons.find((h) => h.h === 1);
  const mpu = me?.metresPerUnit ?? 1;
  const r = stale
    ? null
    : h1 && f.currentLevel != null
      ? (h1.level - f.currentLevel) * mpu
      : (me?.rate3hM ?? null);
  const direction: T3 | null = stale
    ? latest && me?.ageMin != null
      ? (() => {
          const h = Math.max(1, Math.round(me.ageMin / 60));
          return { en: `Last reading ${h} h ago`, si: `අවසන් කියවීම පැය ${h}කට පෙර`, ta: `கடைசி அளவீடு ${h} மணி நேரத்திற்கு முன்` };
        })()
      : { en: "No recent reading", si: "මෑත කියවීමක් නැත", ta: "சமீபத்திய அளவீடு இல்லை" }
    : r == null
      ? null
      : directionFor(r);

  const elevated = tone === "alert" || tone === "minor" || tone === "major";
  const dc = elevated ? contactsForDistrict(district) : null;
  const name = stationDisplayName(selectedStation);
  const unit = me?.unit ?? null;
  const level = latest?.water_level ?? null;
  const footer = latest ? t("common.updated", { time: clock(latest.ts, t) }) : t("common.noReading");
  const levelText = level != null ? formatLevel(level, unit) : null;
  const rn = riverName(basin, lang);
  const shareText = stale
    ? t("share.stale", { name, river: rn, last: level != null ? t("share.staleLast", { level: formatLevel(level, unit) }) : "" })
    : t("share.live", {
        name,
        river: rn,
        level: formatLevel(level, unit),
        verdict: VERDICT[tone][lang],
        dir: direction ? `, ${direction[lang].toLowerCase()}` : "",
        time: latest ? clock(latest.ts, t) : "",
      });

  const w = warnings[0];
  const fu = f.unit ? ` ${f.unit}` : "";
  const hasRain = (f.signals.rainAtStation6h ?? 0) + (f.signals.rainUpstream6h ?? 0) > 1;

  return (
    <section data-forecast-method={f.method}>
      {w && (
        <div
          data-official-warning
          className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-sm text-amber-950 dark:text-amber-100"
        >
          <TriangleAlert className="size-4 shrink-0 mt-0.5" aria-hidden />
          <span className="min-w-0">
            <span className="block font-semibold">{t("common.officialWarning")}</span>
            <ClampedText
              footer={
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline inline-flex items-center min-h-11 sm:min-h-6 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {w.source}
                </a>
              }
            >
              {w.summary}{lang !== "en" && <span className="opacity-80"> {t("common.englishNote")}</span>}
            </ClampedText>
          </span>
        </div>
      )}

      <VerdictCard
        tone={tone}
        verdict={VERDICT[tone]}
        direction={direction}
        fact={fact}
        labels={
          stale
            ? undefined
            : {
                direction: { en: "Next hour:", si: "ඊළඟ පැය:", ta: "அடுத்த மணி நேரம்:" },
                fact: { en: "Next 24 hours:", si: "ඉදිරි පැය 24:", ta: "அடுத்த 24 மணி நேரம்:" },
              }
        }
        action={stale ? null : (ACTION[tone] ?? null)}
        outlook={
          stale
            ? null
            : {
                trend: r == null ? "unknown" : Math.abs(r) < STEADY_M_PER_H ? "steady" : r < 0 ? "down" : "up",
                text: (
                  <AdvisoryText
                    en={advisory.en}
                    si={advisory.si}
                    ta={advisory.ta}
                    experimental={f.experimental && f.method === "model"}
                    source={advisory.source}
                  />
                ),
              }
        }
        call={elevated ? CALL : null}
        office={dc ? { label: t("common.callDmcOffice", { district: dc.district }), tel: dc.tel } : null}
        footer={footer}
        level={levelText}
        gauge={
          !stale && level != null && me
            ? { tone, level, next24: f.horizons.find((h) => h.h === 24)?.level ?? null, unit, thresholds: me.thresholds }
            : null
        }
        share={{ href: p(stationPath(basin, selectedStation)), name: `${name} (${rn})`, text: shareText }}
      >
        <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3 text-xs sm:text-sm text-slate-700 dark:text-slate-300" data-forecast-headline>
          <p className="font-medium">{f.headline}</p>
          {f.outlook === "elevated" && (
              <p className="mb-2 text-orange-700 dark:text-orange-400">{t("fc.elevated")}</p>
            )}
            {f.horizons.length > 0 && (
              <table className="text-xs tabular-nums w-full max-w-md">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="font-normal pb-1">{t("fc.in")}</th>
                    <th className="font-normal pb-1">{t("fc.level")}</th>
                    <th className="font-normal pb-1">{t("fc.range80")}</th>
                    <th className="font-normal pb-1">{t("fc.at")}</th>
                  </tr>
                </thead>
                <tbody>
                  {f.horizons.map((h) => (
                    <tr key={h.h}>
                      <td className="py-0.5">{h.h}h</td>
                      <td className="py-0.5 font-medium">{h.level.toFixed(2)}{fu}</td>
                      <td className="py-0.5">{h.low != null && h.high != null ? `${h.low.toFixed(2)} ${t("fc.to")} ${h.high.toFixed(2)}` : t("common.na")}</td>
                      <td className="py-0.5">{fmtTime(h.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {f.crossings.some((c) => c.wording !== "already") && (
              <ul className="mt-3 text-xs space-y-0.5">
                {f.crossings.filter((c) => c.wording !== "already").map((c) => (
                  <li key={c.threshold}>
                    {t("fc.crossing", {
                      threshold: t(`mark.${c.threshold}` as "mark.alert"),
                      level: `${c.level}${fu}`,
                      wording: t(`fc.w.${c.wording}` as "fc.w.likely"),
                      p: Math.round(c.probability * 100),
                      eta: c.etaTs ? t("fc.crossingEta", { time: fmtTime(c.etaTs) }) : "",
                    })}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 text-xs">
              <Cell label={t("fc.localTrend")}>{f.signals.localRatePerH != null ? `${f.signals.localRatePerH >= 0 ? "+" : ""}${f.signals.localRatePerH.toFixed(2)}/h` : "—"}</Cell>
              <Cell label={t("fc.upstreamAvg")}>
                {f.signals.upstreamRatePerH != null
                  ? `${f.signals.upstreamRatePerH >= 0 ? "+" : ""}${f.signals.upstreamRatePerH.toFixed(2)}/h`
                  : f.signals.upstreamCount === 0 ? t("fc.upstreamTop") : "—"}
              </Cell>
              <Cell label={t("fc.rainHere")}>{fmtRain(f.signals.rainAtStation6h, t)}</Cell>
              <Cell label={f.rain ? t("fc.rainUpArea") : t("fc.rainUp")}>{fmtRain(f.signals.rainUpstream6h, t)}</Cell>
              {f.rain && <Cell label={t("fc.rainNext")}>{fmtRain(f.rain.next24hMm.det, t)}</Cell>}
            </div>
            {hasRain && f.signals.rainContributors.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <CloudRain className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                <span>{f.signals.rainContributors.slice(0, 4).join(" · ")}</span>
              </div>
            )}
            {f.notes.length > 0 && (
              <ul className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                {f.notes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            )}
            {f.basis.length > 0 && (
              <ul className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                <li className="font-medium">{t("fc.how")}</li>
                {f.basis.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            )}

        </div>
      </VerdictCard>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="tabular-nums font-medium text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  );
}
