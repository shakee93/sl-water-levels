import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Minus, ShieldCheck, TriangleAlert } from "lucide-react";
import { fetchNationalSnapshot, type Station } from "@/lib/arcgis";
import {
  buildAttention,
  TIER_LABEL,
  type AttentionTier,
  type BasinAttention,
  type StationAttention,
} from "@/lib/attention";
import { basinPath } from "@/lib/slug";
import { detectUnit, formatLevel, type Unit } from "@/lib/units";

type TierStyle = {
  card: string;
  pill: string;
  bar: string;
  gap: string;
  dot: string;
};

// One row per tier so the colour story is consistent with the status dots used
// in BasinFlow and StationCard: red = major, orange = minor, amber = alert.
// `approaching` deliberately reads as informational (sky), not alarming — it is
// a watch state, and colouring it like a flood would cry wolf.
const TIER_STYLE: Record<AttentionTier, TierStyle> = {
  major: {
    card: "border-red-300 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 hover:border-red-500 dark:hover:border-red-700",
    pill: "bg-red-600 text-white",
    bar: "bg-red-500",
    gap: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  minor: {
    card: "border-orange-300 dark:border-orange-900 bg-orange-50/70 dark:bg-orange-950/30 hover:border-orange-500 dark:hover:border-orange-700",
    pill: "bg-orange-500 text-white",
    bar: "bg-orange-500",
    gap: "text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  alert: {
    card: "border-amber-300 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 hover:border-amber-500 dark:hover:border-amber-700",
    pill: "bg-amber-500 text-white",
    bar: "bg-amber-500",
    gap: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  approaching: {
    card: "border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/20 hover:border-sky-400 dark:hover:border-sky-700",
    pill: "bg-sky-500 text-white",
    bar: "bg-sky-500",
    gap: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
};

function Trend({ rate }: { rate: number | null }) {
  if (rate == null) {
    return <span className="text-[11px] text-slate-400">no trend</span>;
  }
  const abs = Math.abs(rate);
  const text = `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}/h`;
  if (abs < 0.02) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
        <Minus className="size-3" aria-hidden />
        steady
      </span>
    );
  }
  if (rate > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600 dark:text-orange-400 tabular-nums">
        <ArrowUp className="size-3" aria-hidden />
        rising {text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
      <ArrowDown className="size-3" aria-hidden />
      falling {text}
    </span>
  );
}

// Level plotted against this gauge's own alert / minor / major marks. The scale
// runs 0 → major (or a little past the current level when it has overtopped
// major), so the ticks sit where the reader expects and the fill is comparable
// across gauges with wildly different absolute ranges.
function ThresholdBar({ s, style }: { s: StationAttention; style: TierStyle }) {
  const { alert, minor, major } = s.thresholds;
  const top = major ?? minor ?? (alert != null ? alert * 1.5 : null);
  if (top == null || top <= 0) return null;
  const scaleMax = Math.max(top, s.level * 1.05);
  const at = (v: number | null) =>
    v == null ? null : Math.max(0, Math.min(100, (v / scaleMax) * 100));

  const fill = at(s.level) ?? 0;
  const ticks: Array<{ pos: number; title: string }> = [];
  for (const [label, v] of [
    ["Alert", alert],
    ["Minor flood", minor],
    ["Major flood", major],
  ] as const) {
    const pos = at(v);
    if (pos != null && pos > 0 && pos < 100) ticks.push({ pos, title: `${label} ${v}` });
  }

  return (
    <div
      className="relative mt-2.5 h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
      role="img"
      aria-label={`Level ${s.level} against alert ${alert ?? "n/a"}, minor ${minor ?? "n/a"}, major ${major ?? "n/a"}`}
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

function BasinCard({ b }: { b: BasinAttention }) {
  const style = TIER_STYLE[b.tier];
  const unit: Unit = detectUnit(b.lead.thresholds);
  const others = b.stations.slice(1);

  return (
    <li>
      <Link
        href={basinPath(b.basin)}
        className={`group flex h-full flex-col rounded-xl border px-4 py-3.5 transition ${style.card}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style.pill}`}
          >
            {b.tier !== "approaching" && <TriangleAlert className="size-3" aria-hidden />}
            {TIER_LABEL[b.tier]}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
            {b.stations.length} of {b.gaugeCount} gauge{b.gaugeCount === 1 ? "" : "s"}
          </span>
        </div>

        <h3 className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
          {b.basin}
        </h3>

        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-slate-600 dark:text-slate-300 truncate">
            {b.lead.station}
          </span>
          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
            {formatLevel(b.lead.level, unit)}
          </span>
        </div>

        {b.lead.gap && (
          <div className={`mt-0.5 text-[11px] tabular-nums ${b.lead.gap.crossed ? style.gap : "text-slate-500 dark:text-slate-400"}`}>
            {b.lead.gap.crossed
              ? `+${b.lead.gap.amount.toFixed(2)} above ${b.lead.gap.label}`
              : `${b.lead.gap.amount.toFixed(2)} below ${b.lead.gap.label}`}
          </div>
        )}

        <ThresholdBar s={b.lead} style={style} />

        <div className="mt-2">
          <Trend rate={b.lead.ratePerHour} />
        </div>

        {others.length > 0 && (
          <ul className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            {others.map((o) => (
              <li key={o.station} className="inline-flex items-center gap-1 min-w-0">
                {/* Per-gauge dot: a basin can hold an at-alert gauge and a
                    watch-tier one at once, and the card headline only shows the
                    worst. Without this the list reads as "all at Alert". */}
                <span
                  className={`size-1.5 rounded-full shrink-0 ${TIER_STYLE[o.tier].dot}`}
                  title={TIER_LABEL[o.tier]}
                />
                <span className="truncate">{o.station}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-3 inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 group-hover:text-sky-700 dark:group-hover:text-sky-300 transition">
          View basin
          <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
        </div>
      </Link>
    </li>
  );
}

export async function NeedsAttention({ stations }: { stations: Station[] }) {
  let snapshot;
  try {
    snapshot = await fetchNationalSnapshot();
  } catch {
    // The map and basin list below still work without this section, so a
    // rate-limited ArcGIS response should degrade to silence, not an error page.
    return null;
  }

  const basinByStation = new Map(stations.map((s) => [s.station, s.basin] as const));
  const { basins, flagged, reporting, highest } = buildAttention(snapshot, (name) =>
    basinByStation.get(name),
  );

  if (basins.length === 0) {
    return (
      <section className="mb-6">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/25 px-4 py-3">
          <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0 text-sm">
            <span className="font-medium text-emerald-800 dark:text-emerald-200">
              All clear
            </span>
            <span className="text-emerald-700/80 dark:text-emerald-300/80">
              {" "}— all {reporting} reporting gauges are well below their alert levels.
            </span>
            {highest && (
              <div className="text-[11px] text-emerald-700/70 dark:text-emerald-300/60 mt-0.5 truncate">
                Highest right now: {highest.station} ({highest.basin}) at{" "}
                <span className="tabular-nums">{Math.round(highest.ratio * 100)}%</span> of alert.
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  const acting = flagged.filter((f) => f.tier !== "approaching").length;

  return (
    <section className="mb-6" aria-labelledby="needs-attention-heading">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <h2
          id="needs-attention-heading"
          className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200"
        >
          Needs attention
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {basins.length} basin{basins.length === 1 ? "" : "s"} · {flagged.length} of {reporting} gauges
        </span>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {basins.map((b) => (
          <BasinCard key={b.basin} b={b} />
        ))}
      </ul>

      <p className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
        {acting > 0
          ? `${acting} gauge${acting === 1 ? " is" : "s are"} at or above an official threshold. `
          : "No gauge has crossed an official threshold yet. "}
        Thresholds are the Department of Irrigation&rsquo;s own alert, minor-flood and
        major-flood marks. Gauges within 15% of alert are shown as a watch.
      </p>
    </section>
  );
}

export function NeedsAttentionSkeleton() {
  return (
    <section className="mb-6" aria-hidden>
      <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-800 animate-pulse mb-2.5" />
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="h-[168px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900 animate-pulse"
          />
        ))}
      </ul>
    </section>
  );
}
