import { releaseAffecting } from "@/lib/releases";
import { TimeAgo } from "./TimeAgo";
import { ClampedText } from "./ClampedText";
import { CloudRain, TriangleAlert } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { loadForecast, type Forecast as ForecastT } from "@/lib/forecast";
import { getAdvisory } from "@/lib/advisory";
import { DISTRICT_BY_STATION } from "@/lib/districts";
import { getGsmapForStation, GSMAP_CREDIT } from "@/lib/gsmap";
import { heaviestUpstream, measuredAtGauge } from "@/lib/stationRain";
import { noRainSensor } from "@/lib/rainSensors";
import { forThisRiver, rainWord, reachesTrigger, satelliteCaveat } from "@/lib/rainWords";
import { rainTriggersFor } from "@/lib/rainTriggers";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";
import { contactsForDistrict } from "@/lib/help";
import { statusFor } from "@/lib/status";
import { formatDelta, formatLevel, publishedAs, shownNumber } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import { stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { clock, riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";
import { AdvisoryText, VerdictCard, type T3, type VerdictTone } from "./ShareButton";
import { CALL, STEADY_M_PER_H, VERDICT, directionFor } from "./verdict";
import { chanceWords, isTidalStation, liftVerdict, riverRising } from "@/lib/verdictLift";

const HOUR = 3_600_000;
const mm = (v: number | null) => (v == null ? "—" : v < 10 ? v.toFixed(1) : String(Math.round(v)));

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
// Render time for the live age label (outside the component so render stays pure).
const renderedAt = () => Date.now();

function forecastFact(f: ForecastT, tier: string, now: number): { fact: T3 | null; target: number; likely?: boolean } {
  const c = f.crossings
    .filter((x) => x.wording === "likely" || x.wording === "possible")
    .sort((a, b) => (a.etaTs ?? Infinity) - (b.etaTs ?? Infinity))[0];
  if (c) {
    const flood = c.threshold !== "alert";
    const lvl = flood
      ? { en: "flood level", si: "ගංවතුර මට්ටම", ta: "வெள்ள மட்டத்தை" }
      : { en: "alert level", si: "අනතුරු ඇඟවීමේ මට්ටම", ta: "எச்சரிக்கை மட்டத்தை" };
    const target = ORDER.indexOf(c.threshold);
    const likely = c.wording === "likely";
    if (c.etaTs != null) {
      const n = Math.max(1, Math.round((c.etaTs - now) / HOUR));
      const h = hoursPhrase(n);
      return {
        target,
        likely,
        fact: {
          en: `Could reach ${lvl.en} in ${h.en}`,
          si: `${h.si} ඇතුළත ${lvl.si}ට ළඟා විය හැක`,
          ta: `${h.ta}ில் ${lvl.ta} எட்டலாம்`,
        },
      };
    }
    return {
      target,
      likely,
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

const TIDE_RISE: T3 = {
  en: "Rising with the tide (about the same once the tide is allowed for)",
  si: "වඩින මුහුදු රැළි සමඟ ඉහළ යයි (රැළි සලකා බැලූ විට පාහේ එලෙසමයි)",
  ta: "அலையுடன் உயர்கிறது (அலையைக் கணக்கிட்டால் ஏறக்குறைய அதே அளவு)",
};

/** The calm "small chance" line for a crossing the verdict rule did not lift (lib/verdictLift.ts). */
function smallChanceFact(c: { threshold: string }, hours: number | null, heavier: boolean): T3 {
  const flood = c.threshold !== "alert";
  const lvl = flood
    ? { en: "flood level", si: "ගංවතුර මට්ටමට", ta: "வெள்ள மட்டத்தை" }
    : { en: "alert level", si: "අනතුරු ඇඟවීමේ මට්ටමට", ta: "எச்சரிக்கை மட்டத்தை" };
  const h = hours != null ? hoursPhrase(hours) : null;
  const rain = heavier
    ? { en: " (if the heavier rain comes)", si: " (වැසි වැඩි වුවහොත්)", ta: " (கனமழை வந்தால்)" }
    : { en: "", si: "", ta: "" };
  return {
    en: `Small chance it reaches the ${lvl.en} ${h ? `in ${h.en}` : "within 24 hours"}${rain.en}`,
    si: `${h ? `${h.si} ඇතුළත` : "පැය 24ක් ඇතුළත"} ${lvl.si} ළඟා වීමට ඇත්තේ සුළු ඉඩකි${rain.si}`,
    ta: `${h ? `${h.ta}ில்` : "24 மணி நேரத்தில்"} ${lvl.ta} எட்டுவதற்கான வாய்ப்பு சிறியது${rain.ta}`,
  };
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
  const [advisory, warnings, release, sat] = await Promise.all([
    getAdvisory({ station: selectedStation, river: basin.trim(), district, tier: realTier, forecast: f }),
    warningsP.then((w) => warningsForBasin(w, basin, [selectedStation])),
    releaseAffecting(selectedStation).catch(() => ({ active: false, confirmed: false }) as const),
    getGsmapForStation(basin, selectedStation),
  ]);

  const stale = realTier === "stale";
  const now = f.asOfTs ?? latest?.ts ?? 0;
  const { fact: forecastLine } = stale ? { fact: null } : forecastFact(f, realTier, now);

  // "Next hour": the forecast's 1 h change when there is one (metres, unit-aware),
  // otherwise the recent 3 h rate as a persistence guess.
  const h1 = f.horizons.find((h) => h.h === 1);
  const mpu = me?.metresPerUnit ?? 1;
  const r = stale
    ? null
    : h1 && f.currentLevel != null
      ? (h1.level - f.currentLevel) * mpu
      : (me?.rate3hM ?? null);
  // "Rising" means the river is rising: on a tidal gauge (Nagalagam Street...) the twice-daily tide moves the level by
  // 0.6-0.8 ft, so it is judged against the level one tide cycle ago (lib/verdictLift.ts), and a tide-only rise is said so.
  const tidal = isTidalStation(selectedStation);
  const rising = !stale && riverRising(selectedStation, me?.trend24h, mpu, me?.rate3hM ?? null);
  const tideOnly = tidal && !stale && r != null && r > STEADY_M_PER_H && !rising;
  const direction: T3 | null = stale
    ? latest && me?.ageMin != null
      ? (() => {
          const h = Math.max(1, Math.round(me.ageMin / 60));
          return { en: `Last reading ${h} h ago`, si: `අවසන් කියවීම පැය ${h}කට පෙර`, ta: `கடைசி அளவீடு ${h} மணி நேரத்திற்கு முன்` };
        })()
      : { en: "No recent reading", si: "මෑත කියවීමක් නැත", ta: "சமீபத்திய அளவீடு இல்லை" }
    : r == null
      ? null
      : tideOnly
        ? TIDE_RISE
        : directionFor(r);
  // A confirmed reservoir release upstream counts as an expected crossing only when
  // the gauge is already close to alert (within 1 m, or 20% of the alert level) and
  // rising: a release far below alert, or on a falling river, stays informational
  // (the release card above the verdict still shows it).
  const alertLvl = me?.thresholds.alert ?? null;
  const lvlNow = latest?.water_level ?? null;
  const gapM = alertLvl != null && lvlNow != null ? (alertLvl - lvlNow) * mpu : null;
  const nearAlert = gapM != null && gapM > 0 && (gapM <= 1 || gapM <= alertLvl! * mpu * 0.2);
  const releaseLift = !stale && rising && nearAlert && release.active && release.confirmed;
  // One rule for "Get ready" from a forecast crossing (lib/verdictLift.ts); real readings always win.
  const lift = stale
    ? null
    : liftVerdict({ tier: realTier, crossings: f.crossings, horizons: f.horizons, currentLevel: f.currentLevel, rising, now });
  const tone: VerdictTone = stale
    ? "stale"
    : lift?.verdict === "alert" && (realTier === "normal" || realTier === "watch")
      ? "alert"
      : // a forecast crossing or a confirmed release upstream: "Keep an eye on it" at most; Get ready is the alert level itself (26 Oct 2026)
        (lift?.verdict === "watch" || releaseLift) && realTier === "normal"
        ? "watch"
        : realTier;
  // "Next 24 hours" always has an answer when the gauge is live, even if it's "no estimate".
  const heavier = f.rainRisk != null || f.stormHorizons.length > 0;
  const fact: T3 | null = stale
    ? null
    : lift?.why === "small" && lift.crossing
      ? smallChanceFact(lift.crossing, lift.etaHours, heavier)
      : (forecastLine ?? { en: "No estimate yet", si: "තවම ඇස්තමේන්තුවක් නැත", ta: "இன்னும் மதிப்பீடு இல்லை" });

  const elevated = tone === "alert" || tone === "minor" || tone === "major";
  const dc = elevated ? contactsForDistrict(district) : null;
  const name = stationDisplayName(selectedStation);
  const unit = me?.unit ?? null;
  const level = latest?.water_level ?? null;
  // "Reading at 11:10 am · 55 min ago": the time the gauge measured, plus a live age,
  // so a cached page can't pass off an hour-old reading as fresh.
  const footer = latest ? (
    <>
      {t("common.readingAt", { time: clock(latest.ts, t) })} · <TimeAgo ts={latest.ts} serverNow={renderedAt()} />
    </>
  ) : (
    t("common.noReading")
  );
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
  const fu = f.unit ? " ft" : "";
  // Metre gauges are shown in feet; the official figures stay one line away so bulletins can be matched.
  const pubLevel = publishedAs(level, unit);
  const pubMarks = me
    ? (["alert", "minor", "major"] as const)
        .filter((k) => me.thresholds[k] != null && me.thresholds[k]! > 0)
        .map((k) => `${t(`mark.${k}` as "mark.alert").toLowerCase()} ${publishedAs(me.thresholds[k], unit, 1)}`)
        .join(", ")
    : "";
  // Rain, three sources kept apart (lib/stationRain.ts): what THIS gauge's sensor measured, the satellite estimate, the weather-model forecast.
  const nowMs = renderedAt();
  const sensor = !noRainSensor(selectedStation);
  const fell = me ? measuredAtGauge(selectedStation, me.trend24h, nowMs) : null;
  const upRain = !sensor && me ? heaviestUpstream(snapshot, basin, selectedStation, nowMs) : null;
  const trig = rainTriggersFor(selectedStation);
  const localHeavy = fell ? forThisRiver(reachesTrigger("3h", fell.mm3h, trig) || reachesTrigger("24h", fell.mm24h, trig), trig, lang) : "";
  const fellWord = fell?.mm24h != null && fell.mm24h >= 0.2 ? rainWord("24h", fell.mm24h, lang) : null;
  const fcMm = f.rain?.next24hMm.det ?? null;
  const fcWord = fcMm != null ? rainWord("24h", fcMm, lang) : null;
  const hasRain = f.signals.rainContributors.length > 0;

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
                trend: r == null ? "unknown" : tideOnly || Math.abs(r) < STEADY_M_PER_H ? "steady" : r < 0 ? "down" : "up",
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
          {pubLevel && (
            <p data-published-as className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t("unit.publishedAs", { v: pubLevel })}
              {pubMarks ? ` (${pubMarks})` : ""}
            </p>
          )}
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
                      <td className="py-0.5 font-medium">{shownNumber(h.level, f.unit)}{fu}</td>
                      <td className="py-0.5">{h.low != null && h.high != null ? `${shownNumber(h.low, f.unit)} ${t("fc.to")} ${shownNumber(h.high, f.unit)}` : t("common.na")}</td>
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
                    {`${t(`mark.${c.threshold}` as "mark.alert")} (${formatLevel(c.level, f.unit)}): ${t(`fc.w.${c.wording}` as "fc.w.likely")}, ${chanceWords(c.probability)[lang]}${c.etaTs ? t("fc.crossingEta", { time: fmtTime(c.etaTs) }) : ""}`}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Cell label={t("fc.localTrend")}>{f.signals.localRatePerH != null ? `${formatDelta(f.signals.localRatePerH, f.unit, { sign: true })}/h` : "—"}</Cell>
              <Cell label={t("fc.upstreamAvg")}>
                {f.signals.upstreamRatePerH != null
                  ? `${formatDelta(f.signals.upstreamRatePerH, f.unit, { sign: true })}/h`
                  : f.signals.upstreamCount === 0 ? t("fc.upstreamTop") : "—"}
              </Cell>
            </div>
            <dl data-rain-rows className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">{t("fc.rainFell")}</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">
                  {!sensor
                    ? t("fc.rainNoSensor")
                    : fell
                      ? t("fc.rainFellGauge", { h3: mm(fell.mm3h), h24: mm(fell.mm24h), word: `${fellWord ? ` (${fellWord})` : ""}${localHeavy}` })
                      : t("fc.rainNoReading")}
                  {upRain && <span className="block font-normal text-slate-600 dark:text-slate-400">{t("fc.rainFellUp", { gauge: stationDisplayName(upRain.gauge), h3: mm(upRain.mm3h), h24: mm(upRain.mm24h) })}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">{t("fc.rainForecast")}</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">
                  {fcMm != null ? t("fc.rainForecastVal", { mm: mm(fcMm), word: fcWord ?? "" }) : <span className="font-normal">{t("fc.rainForecastNone")}</span>}
                </dd>
              </div>
            </dl>
            {sat && sat.mm6h != null && sat.mm24h != null && (
              <p data-satellite-rain className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                {t("fc.satRain", { h6: sat.mm6h.toFixed(1), h24: sat.mm24h.toFixed(1), time: clock(sat.endsAt, t) })}{" "}
                {satelliteCaveat(basin, lang)}{" "}
                <span className="text-slate-500 dark:text-slate-500">{GSMAP_CREDIT}</span>
              </p>
            )}
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
