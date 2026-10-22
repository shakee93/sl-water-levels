"use client";

import { useI18n } from "./LocaleProvider";

// Horizontal river gauge for the verdict card: how far the water is from each
// flood mark, at a glance. Fill = current level, faint extension = the 24 h
// estimate, ticks = alert / minor / major.

type Tone = "normal" | "watch" | "alert" | "minor" | "major" | "none" | "stale";

const FILL: Record<Tone, string> = {
  normal: "bg-sky-500",
  watch: "bg-sky-500",
  alert: "bg-amber-500",
  minor: "bg-orange-600",
  major: "bg-red-600",
  none: "bg-slate-400",
  stale: "bg-slate-400",
};

const MARKS = [
  { key: "alert", label: "mark.alert", tick: "bg-amber-500" },
  { key: "minor", label: "mark.minor", tick: "bg-orange-600" },
  { key: "major", label: "mark.major", tick: "bg-red-600" },
] as const;

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 2 : 1).replace(/0$/, ""));

export function LevelGauge({
  tone,
  level,
  next24,
  unit,
  thresholds,
}: {
  tone: Tone;
  level: number;
  next24: number | null;
  unit: string | null;
  thresholds: { alert: number | null; minor: number | null; major: number | null };
}) {
  const { t } = useI18n();
  const marks = MARKS.filter((m) => thresholds[m.key] != null && thresholds[m.key]! > 0);
  if (marks.length === 0) return null;
  // Scale from 0 (or a negative reading) to a little past the highest mark or reading.
  const top = Math.max(...marks.map((m) => thresholds[m.key]!), level, next24 ?? level) * 1.12;
  const bottom = Math.min(0, level);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - bottom) / (top - bottom)) * 100));
  const now = pct(level);
  const ahead = next24 != null ? pct(next24) : now;
  const u = unit ? ` ${unit}` : "";
  const label = t("gauge.aria", { level: `${fmt(level)}${u}`, marks: marks.map((m) => `${t(m.label).toLowerCase()} ${fmt(thresholds[m.key]!)}${u}`).join(", ") });

  return (
    <div className="mt-4" role="img" aria-label={label}>
      <div className="relative h-3 rounded-full bg-slate-200/80 dark:bg-slate-800">
        {ahead > now && (
          <div
            className={`absolute inset-y-0 rounded-r-full ${FILL[tone]} opacity-25`}
            style={{ left: `${now}%`, width: `${ahead - now}%` }}
          />
        )}
        <div className={`absolute inset-y-0 left-0 rounded-full ${FILL[tone]}`} style={{ width: `${now}%` }} />
        {marks.map((m) => (
          <div
            key={m.key}
            className={`absolute -top-1 -bottom-1 w-0.5 rounded-full ${m.tick}`}
            style={{ left: `calc(${pct(thresholds[m.key]!)}% - 1px)` }}
          />
        ))}
      </div>
      {/* A legend instead of labels under each tick: marks can sit close together. */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400" aria-hidden>
        {marks.map((m) => (
          <span key={m.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className={`inline-block w-0.5 h-3 rounded-full ${m.tick}`} />
            {t(m.label)} {fmt(thresholds[m.key]!)}
            {u}
          </span>
        ))}
      </div>
    </div>
  );
}
