import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  CloudRain,
  Minus,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import type { NationalStation } from "@/lib/arcgis";
import type { StationVerdict } from "@/lib/stationVerdict";
import {
  buildAttention,
  RISING_M_PER_H,
  type AttentionTier,
  type BasinAttention,
  type StationAttention,
} from "@/lib/attention";
import { basinPath } from "@/lib/slug";
import { detectUnit, formatDelta, formatLevel, type Unit } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import { heavyMeasuredOnRiver } from "@/lib/stationRain";
import { TimeAgo } from "./TimeAgo";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";

// A near-alert gauge reads "Normal" (tier.watch); the near-alert reason is the note under it (owner, 26 Oct 2026).
const tierText = (t: TFn, tier: AttentionTier) => t(`tier.${tier}` as "tier.major");
const markText = (t: TFn, k: "major flood" | "minor flood" | "alert") => t(`gap.${k.split(" ")[0]}` as "gap.alert");

type TierStyle = {
  card: string;
  pill: string;
  bar: string;
  gap: string;
  dot: string;
};

// One row per tier so the colour story is consistent with the status dots used
// in BasinFlow and StationCard: red = major, orange = minor, amber = alert.
// `watch` (near alert) is the Normal look: it is not a step of the Department's ladder.
// Pills use dark text on the light fills (amber/yellow) for AA contrast.
const TIER_STYLE: Record<AttentionTier, TierStyle> = {
  major: {
    card: "border-red-300 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 hover:border-red-500 dark:hover:border-red-700",
    pill: "bg-red-700 text-white",
    bar: "bg-red-500",
    gap: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  minor: {
    card: "border-orange-300 dark:border-orange-900 bg-orange-50/70 dark:bg-orange-950/30 hover:border-orange-500 dark:hover:border-orange-700",
    pill: "bg-orange-700 text-white",
    bar: "bg-orange-500",
    gap: "text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  alert: {
    card: "border-amber-300 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 hover:border-amber-500 dark:hover:border-amber-700",
    pill: "bg-amber-400 text-amber-950",
    bar: "bg-amber-500",
    gap: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  watch: {
    card: "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600",
    pill: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
    bar: "bg-sky-500",
    gap: "text-slate-600 dark:text-slate-300",
    dot: "bg-slate-400 dark:bg-slate-500",
  },
};

// Direction comes from the metre-normalised 3h rate so feet and metre gauges
// share one "steady" cut-off; the printed number is in feet like every other level.
function Trend({ t, rateM, rate, unit }: { t: TFn; rateM: number | null; rate: number | null; unit: Unit }) {
  if (rateM == null || rate == null) return null;
  if (Math.abs(rateM) < RISING_M_PER_H) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        <Minus className="size-3" aria-hidden />
        {t("trend.steady")}
      </span>
    );
  }
  const text = `${formatDelta(rate, unit, { sign: true })}/h`;
  return rateM > 0 ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-400 tabular-nums">
      <ArrowUp className="size-3" aria-hidden />
      {t("trend.rising")} {text}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
      <ArrowDown className="size-3" aria-hidden />
      {t("trend.falling")} {text}
    </span>
  );
}

// Level plotted against this gauge's own alert / minor / major marks. The scale
// runs 0 → major (or a little past the current level when it has overtopped
// major), so the ticks sit where the reader expects and the fill is comparable
// across gauges with wildly different absolute ranges.
function ThresholdBar({ t, s, style }: { t: TFn; s: StationAttention; style: TierStyle }) {
  const { alert, minor, major } = s.thresholds;
  const top = major ?? minor ?? (alert != null ? alert * 1.5 : null);
  if (top == null || top <= 0) return null;
  const scaleMax = Math.max(top, s.level * 1.05);
  const at = (v: number | null) =>
    v == null ? null : Math.max(0, Math.min(100, (v / scaleMax) * 100));

  const fill = at(s.level) ?? 0;
  const ticks: Array<{ pos: number; title: string }> = [];
  for (const [label, v] of [
    [t("mark.alert"), alert],
    [t("mark.minor"), minor],
    [t("mark.major"), major],
  ] as const) {
    const pos = at(v);
    if (pos != null && pos > 0 && pos < 100) ticks.push({ pos, title: `${label} ${v}` });
  }

  return (
    <div
      className="relative mt-2.5 h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
      role="img"
      aria-label={t("bar.aria", { level: s.level, alert: alert ?? t("common.na"), minor: minor ?? t("common.na"), major: major ?? t("common.na") })}
    >
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${style.bar}`}
        style={{ width: `${fill}%` }}
      />
      {ticks.map((t) => (
        <span
          key={t.title}
          title={t.title}
          className="absolute inset-y-0 w-px bg-slate-500/60 dark:bg-slate-400/50"
          style={{ left: `${t.pos}%` }}
        />
      ))}
    </div>
  );
}

function BasinCard({
  t,
  p,
  lang,
  b,
  rateM,
  serverNow,
  rain,
}: {
  t: TFn;
  p: (path: string) => string;
  lang: Locale;
  b: BasinAttention;
  rateM: number | null;
  serverNow: number;
  /** Heavy rain the gauges on this river measured (lib/stationRain.ts), or null. */
  rain: ReturnType<typeof heavyMeasuredOnRiver>;
}) {
  const style = TIER_STYLE[b.tier];
  const unit: Unit = detectUnit(b.lead.thresholds);
  const others = b.stations.slice(1);
  // One flagged gauge: skip the basin page and go straight to that station.
  const single = b.stations.length === 1;

  return (
    <li>
      <Link
        href={p(single ? b.lead.href : basinPath(b.basin))}
        className={`group flex h-full flex-col rounded-xl border px-4 py-3.5 transition ${style.card}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${style.pill}`}
          >
            {b.tier !== "watch" && <TriangleAlert className="size-3" aria-hidden />}
            {tierText(t, b.tier)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs tabular-nums shrink-0 text-slate-500 dark:text-slate-400">
            {b.lead.stale && <Clock className="size-3" aria-hidden />}
            <TimeAgo ts={b.lead.ts} serverNow={serverNow} short={b.lead.stale} />
          </span>
        </div>

        <h3 className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
          {riverName(b.basin, lang)}
        </h3>

        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-slate-600 dark:text-slate-300 truncate">
            {stationDisplayName(b.lead.station)}
          </span>
          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
            {formatLevel(b.lead.level, unit)}
          </span>
        </div>

        {b.lead.gap && (
          <div data-verdict-note={b.tier === "watch" ? "" : undefined} className={`mt-0.5 text-xs tabular-nums ${b.lead.gap.crossed ? style.gap : "text-slate-500 dark:text-slate-400"}`}>
            {b.tier === "watch" && !b.lead.gap.crossed
              ? t("needs.nearNote", { amount: formatDelta(b.lead.gap.amount, unit) })
              : b.lead.gap.crossed
              ? t("gap.above", { amount: formatDelta(b.lead.gap.amount, unit), mark: markText(t, b.lead.gap.label) })
              : t("gap.below", { amount: formatDelta(b.lead.gap.amount, unit), mark: markText(t, b.lead.gap.label) })}
          </div>
        )}

        <ThresholdBar t={t} s={b.lead} style={style} />

        {/* Trend and the measured-rain note share one quiet line under the bar (the header keeps only the tier pill,
            which wrapped onto two lines when a rain chip sat beside it). */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {b.lead.stale ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">{t("needs.lastKnown")}</span>
          ) : (
            <Trend t={t} rateM={rateM} rate={b.lead.ratePerHour} unit={unit} />
          )}
          {rain && (
            <span
              data-rain-badge
              title={t("needs.rainTitle", { gauge: rain.gaugeName, mm: rain.mm, h: rain.hours })}
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-sky-700 dark:text-sky-300"
            >
              <CloudRain className="size-3.5" aria-hidden />
              {rain.local ? t("needs.rainLocal") : t("needs.rain")}
            </span>
          )}
        </div>

        {others.length > 0 && (
          <ul className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {others.map((o) => (
              <li key={o.station} className="inline-flex items-center gap-1 min-w-0">
                {/* Per-gauge dot: a basin can hold an at-alert gauge and a
                    watch-tier one at once, and the card headline only shows the
                    worst. Without this the list reads as "all at Alert". */}
                <span
                  className={`size-1.5 rounded-full shrink-0 ${TIER_STYLE[o.tier].dot}`}
                  title={tierText(t, o.tier)}
                />
                <span className="truncate">{stationDisplayName(o.station)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 group-hover:text-sky-700 dark:group-hover:text-sky-300 transition">
          {single ? t("needs.viewStation", { name: stationDisplayName(b.lead.station) }) : t("needs.viewBasin")}
          <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
        </div>
      </Link>
    </li>
  );
}

export function NeedsAttention({
  lang,
  snapshot,
  serverNow,
  verdicts = {},
}: {
  lang: Locale;
  snapshot: NationalStation[] | null;
  serverNow: number;
  /** Gauge-page verdicts (lib/stationVerdict.ts): calm gauges the forecast lifts to "Get ready" are listed under the cards. */
  verdicts?: Record<string, StationVerdict>;
}) {
  const { t, p } = getI18n(lang);
  if (!snapshot) {
    return (
      <section className="mb-6">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3">
          <WifiOff className="size-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          <div className="text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {t("needs.unavailable")}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {" "}{t("needs.unavailableHelp")}
            </span>
          </div>
        </div>
      </section>
    );
  }

  const { basins, flagged, reporting } = buildAttention(snapshot);
  // Near-alert gauges read Normal: only the gauges at Alert or above are counted as such, the rest are "near alert".
  const aboveN = flagged.filter((f) => f.tier !== "watch").length;
  const nearN = flagged.length - aboveN;
  const countText = [aboveN > 0 ? t("needs.count", { n: aboveN, m: reporting }) : null, nearN > 0 ? t("needs.countNear", { n: nearN }) : null].filter(Boolean).join(" · ");
  const rateByHref = new Map(snapshot.map((s) => [s.href, s.rate3hM] as const));

  const soon = <ForecastSoon lang={lang} p={p} snapshot={snapshot} verdicts={verdicts} />;

  if (basins.length === 0) {
    return (
      <section className="mb-6">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/25 px-4 py-3">
          <ShieldCheck className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
          <div className="text-sm text-emerald-900 dark:text-emerald-200">
            <span className="font-medium">{t("needs.allClear")}</span>
            <span className="text-emerald-800/80 dark:text-emerald-300/80">
              {" "}{t("needs.allClearHelp", { n: reporting })}
            </span>
          </div>
        </div>
        {soon}
      </section>
    );
  }

  return (
    <section className="mb-6" aria-labelledby="needs-attention-heading">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <h2
          id="needs-attention-heading"
          className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
        >
          {t("needs.heading")}
        </h2>
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {countText}
        </span>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {basins.map((b) => (
          <BasinCard
            t={t}
            p={p}
            lang={lang}
            key={b.basin}
            b={b}
            rateM={rateByHref.get(b.lead.href) ?? null}
            serverNow={serverNow}
            rain={heavyMeasuredOnRiver(snapshot, b.basin, serverNow)}
          />
        ))}
      </ul>
      {soon}
    </section>
  );
}

// Gauges below alert whose forecast says they will likely reach a mark (lib/verdictLift.ts, the same words as their pages).
// Since 26 Oct 2026 this is a heads-up, not "Get ready": Get ready is the gauge's own alert level. si/ta are drafts.
const SOON = {
  en: { title: "Forecast to reach alert level", alert: "alert level", minor: "minor flood level", major: "major flood level", line: "Likely to reach {mark} in about {h} h", day: "Likely to reach {mark} within 24 hours" },
  si: { title: "අනතුරු ඇඟවීමේ මට්ටමට ළඟා වීමට පුරෝකථනය", alert: "අනතුරු ඇඟවීමේ මට්ටම", minor: "සුළු ගංවතුර මට්ටම", major: "ප්‍රධාන ගංවතුර මට්ටම", line: "පැය {h} කින් පමණ {mark} කරා ළඟා විය හැක", day: "පැය 24 ක් තුළ {mark} කරා ළඟා විය හැක" },
  ta: { title: "எச்சரிக்கை மட்டத்தை அடையும் என முன்னறிவிப்பு", alert: "எச்சரிக்கை மட்டம்", minor: "சிறு வெள்ள மட்டம்", major: "பெரு வெள்ள மட்டம்", line: "சுமார் {h} மணி நேரத்தில் {mark} அடையலாம்", day: "24 மணி நேரத்திற்குள் {mark} அடையலாம்" },
} as const;

function ForecastSoon({ lang, p, snapshot, verdicts }: { lang: Locale; p: (path: string) => string; snapshot: NationalStation[]; verdicts: Record<string, StationVerdict> }) {
  const c = SOON[lang];
  const rows = snapshot
    .filter((s) => (s.tier === "normal" || s.tier === "watch") && verdicts[s.station]?.th)
    .map((s) => ({ s, v: verdicts[s.station] }))
    .sort((a, b) => ["major", "minor", "alert"].indexOf(a.v.th!) - ["major", "minor", "alert"].indexOf(b.v.th!) || (a.v.h ?? 99) - (b.v.h ?? 99));
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3" lang={lang}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <TriangleAlert className="size-4" aria-hidden /> {c.title}
      </h3>
      <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map(({ s, v }) => {
          const mark = c[v.th!];
          const line = v.h != null ? c.line.replace("{mark}", mark).replace("{h}", String(Math.max(1, Math.round(v.h)))) : c.day.replace("{mark}", mark);
          return (
            <li key={s.href}>
              <Link href={p(s.href)} className="group flex items-baseline justify-between gap-3 text-sm hover:underline underline-offset-2">
                <span className="min-w-0">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{stationDisplayName(s.station)}</span>
                  <span className="text-slate-500 dark:text-slate-400"> · {riverName(s.basin, lang)}</span>
                  <span className="block text-xs text-amber-900/90 dark:text-amber-200/90">{line}</span>
                </span>
                {s.latest?.water_level != null && <span className="shrink-0 tabular-nums text-xs text-slate-600 dark:text-slate-300">{formatLevel(s.latest.water_level, s.unit)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
