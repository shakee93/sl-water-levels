"use client";

// The embeddable widgets: one client shell (refresh every 5 minutes from /api/embed, height to the parent window, one analytics
// event) and a view per widget. Plain server-made strings in, markup out: no dictionaries, no calls to any data source.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Minus } from "lucide-react";
import { PILL, StepWord, TierPill, type PillTier } from "@/app/TierPill";
import type { EmbedCfg, Widget } from "@/lib/embedConfig";
import { styleOf } from "@/lib/embedStyle";
import type { Arrow, CardPayload, Chart, Credit, EmbedPayload, EmbedRow, FChart, ForecastPayload, GaugePayload, NowPayload, ReservoirsPayload, RiverPayload, TickerPayload, TownPayload } from "@/lib/embedTypes";

const REFRESH_MS = 5 * 60_000;
const link = "underline underline-offset-2 decoration-slate-400/70 hover:decoration-current";

// ---- small parts ------------------------------------------------------------------------------------------------------------------------

function ArrowIcon({ a, className = "size-4" }: { a: Arrow; className?: string }) {
  if (a === "up") return <ArrowUp className={`${className} text-orange-600 dark:text-orange-400`} aria-hidden />;
  if (a === "down") return <ArrowDown className={`${className} text-emerald-600 dark:text-emerald-400`} aria-hidden />;
  if (a === "steady") return <Minus className={`${className} text-slate-500`} aria-hidden />;
  return null;
}

const FILL: Record<PillTier, string> = { normal: "bg-sky-500", alert: "bg-amber-500", minor: "bg-orange-600", major: "bg-red-600", none: "bg-slate-400", stale: "bg-slate-400" };
const TICK: Record<string, string> = { alert: "bg-amber-500", minor: "bg-orange-600", major: "bg-red-600" };
const STROKE: Record<string, string> = { alert: "#f59e0b", minor: "#ea580c", major: "#dc2626" };
const TONE_CLS: Partial<Record<PillTier, string>> = { alert: "emb-tone", minor: "emb-tone", major: "emb-tone" };
const TONE_VAR: Partial<Record<PillTier, React.CSSProperties>> = {
  alert: { ["--e-tone" as string]: "#f59e0b" },
  minor: { ["--e-tone" as string]: "#ea580c" },
  major: { ["--e-tone" as string]: "#dc2626" },
};
const CARD: Record<PillTier, string> = {
  normal: "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900",
  none: "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900",
  stale: "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900",
  alert: "border-amber-300 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/25",
  minor: "border-orange-300 dark:border-orange-700/60 bg-orange-50/60 dark:bg-orange-950/25",
  major: "border-red-300 dark:border-red-700/60 bg-red-50/60 dark:bg-red-950/30",
};

function Trend({ row }: { row: Pick<EmbedRow, "arrow" | "trend"> }) {
  if (!row.trend) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-700 dark:text-slate-300">
      <ArrowIcon a={row.arrow} className="size-3.5" />
      {row.trend}
    </span>
  );
}

function Credit({ credit, open }: { credit: Credit; open: { href: string; label: string } }) {
  return (
    <footer className="mt-3 border-t border-slate-200 dark:border-slate-800 pt-2.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
      <p>
        {credit.live}{" "}
        <a href={credit.href} target="_blank" rel="noopener" className="emb-link font-semibold underline underline-offset-2">
          {credit.linkText}
        </a>
        {" · "}
        {credit.rest}
        {credit.extra && (
          <>
            {" · "}
            <a href={credit.extra.href} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">{credit.extra.text}</a>
          </>
        )}
      </p>
      <p className="mt-1">
        <a href={open.href} target="_blank" rel="noopener" className="emb-link inline-flex items-center gap-1 font-medium underline underline-offset-2">
          {open.label}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
    </footer>
  );
}

function Shell({ p, children, tone }: { p: EmbedPayload; children: React.ReactNode; tone?: PillTier }) {
  return (
    <section className={`emb-card ${TONE_CLS[tone ?? "normal"] ?? ""} rounded-xl border p-3 sm:p-4 shadow-sm ${CARD[tone ?? "normal"]}`} style={TONE_VAR[tone ?? "normal"]}>
      {children}
      <Credit credit={p.credit} open={p.open} />
    </section>
  );
}

// ---- river: every gauge, upstream to downstream -----------------------------------------------------------------------------------------

function RowView({ r, full, nameLink = true }: { r: EmbedRow; full: boolean; nameLink?: boolean }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-x-3">
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <p className="font-semibold leading-snug">
            {nameLink ? (
              <a href={r.href} target="_blank" rel="noopener" className="hover:underline underline-offset-2">{r.name}</a>
            ) : (
              r.name
            )}
            {r.river && <span className="font-normal text-slate-500 dark:text-slate-400"> · {r.river}</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{r.since ? r.since : r.time ? <><span className="whitespace-nowrap">{r.time}</span>{r.age && <> · <span className="whitespace-nowrap">{r.age}</span></>}</> : r.step}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 min-[420px]:flex-row min-[420px]:items-center min-[420px]:gap-2.5">
          {r.level && <span className="min-w-[4.5rem] text-right text-lg font-semibold tabular-nums leading-none whitespace-nowrap">{r.level}</span>}
          {!r.since && <TierPill label={r.step} tier={r.tier} />}
        </div>
      </div>
      {(r.trend || (full && (r.next || r.cross))) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-[13px]">
          <Trend row={r} />
          {full && r.next && (
            <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
              <span className="text-slate-500">{/* label comes with the text */}</span>
              {r.next}
            </span>
          )}
          {full && r.cross && <span className="font-semibold">{r.cross}</span>}
        </p>
      )}
      {full && r.marks && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{r.marks}</p>}
    </li>
  );
}

function TribHeading({ text, className = "" }: { text: string; className?: string }) {
  return <p className={`mt-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500 ${className}`}>{text}</p>;
}

/** One gauge as a small card (river widget, layout=cards). Its border takes the step colour above Normal. */
function MiniCard({ r, full }: { r: EmbedRow; full: boolean }) {
  return (
    <div className={`emb-chip rounded-lg border p-2.5 ${TONE_CLS[r.tier] ?? ""} ${CARD[r.tier]}`} style={TONE_VAR[r.tier]}>
      <p className="font-semibold leading-snug [overflow-wrap:anywhere]">
        <a href={r.href} target="_blank" rel="noopener" className="hover:underline underline-offset-2">{r.name}</a>
      </p>
      {r.since ? (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.since}</p>
      ) : (
        <>
          <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className={`text-2xl font-semibold tabular-nums leading-none ${r.level ? "" : "text-slate-400"}`}>{r.level ?? "—"}</span>
            <TierPill label={r.step} tier={r.tier} />
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <Trend row={r} />
            {r.time && <span className="text-slate-500 dark:text-slate-400 tabular-nums">{r.time}</span>}
          </p>
          {full && r.next && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{r.next}</p>}
        </>
      )}
    </div>
  );
}

function RiverView({ p }: { p: RiverPayload }) {
  const full = p.cfg.size === "full";
  const worst = p.rows.reduce<PillTier>((a, r) => (rank(r.tier) > rank(a) ? r.tier : a), "normal");
  return (
    <Shell p={p} tone={worst === "normal" ? "normal" : worst}>
      <h1 className="emb-title text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{p.summary}</p>
      {full && p.rows.length > 1 && (
        <p className="mt-2 flex justify-between text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
          <span>↓ {p.upstream}</span>
          <span>{p.downstream} ↓</span>
        </p>
      )}
      {p.cfg.layout === "cards" ? (
        <div className="mt-3 grid gap-2.5 min-[480px]:grid-cols-2">
          {p.rows.map((r, i) => (
            <Fragment key={`${r.key}-${i}`}>
              {r.tributary && !p.rows[i - 1]?.tributary && <TribHeading text={p.tributaries} className="min-[480px]:col-span-2" />}
              <MiniCard r={r} full={full} />
            </Fragment>
          ))}
        </div>
      ) : (
        <ul className={`${full ? "mt-1.5" : "mt-2.5"} divide-y divide-slate-200/80 dark:divide-slate-800`}>
          {p.rows.map((r, i) => (
            <Fragment key={`${r.key}-${i}`}>
              {r.tributary && !p.rows[i - 1]?.tributary && <li className="pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">{p.tributaries}</li>}
              <RowView r={r} full={full} />
            </Fragment>
          ))}
        </ul>
      )}
    </Shell>
  );
}

const RANK: Record<string, number> = { major: 5, minor: 4, alert: 3, normal: 2, none: 1, stale: 0 };
const rank = (t: string) => RANK[t] ?? 0;

// ---- gauge: one gauge ------------------------------------------------------------------------------------------------------------------

function MarksBar({ bar }: { bar: NonNullable<GaugePayload["bar"]> }) {
  return (
    <div className="mt-4">
      <div className="relative h-3 rounded-full bg-slate-200/80 dark:bg-slate-800">
        {bar.ahead != null && <div className={`absolute inset-y-0 rounded-r-full ${FILL[bar.tier]} opacity-25`} style={{ left: `${bar.now}%`, width: `${bar.ahead - bar.now}%` }} />}
        <div className={`absolute inset-y-0 left-0 rounded-full ${FILL[bar.tier]}`} style={{ width: `${bar.now}%` }} />
        {bar.marks.map((m) => (
          <div key={m.key} className={`absolute -top-1 -bottom-1 w-0.5 rounded-full ${TICK[m.key]}`} style={{ left: `calc(${m.pct}% - 1px)` }} />
        ))}
      </div>
      {bar.marks.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          {bar.marks.map((m) => (
            <span key={m.key} className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
              <span className={`inline-block w-0.5 h-3 rounded-full ${TICK[m.key]}`} aria-hidden />
              {m.label} {m.value}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function LineChart({ chart, title }: { chart: Chart; title: string }) {
  const W = 300, H = 96;
  const ys = [...chart.pts.map((p) => p[1]), ...chart.marks.map((m) => m.v)];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || 1) * 0.12;
  const y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const x = (t: number) => ((t - chart.from) / (chart.to - chart.from || 1)) * W;
  const d = chart.pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
  const last = chart.pts[chart.pts.length - 1];
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <div className="relative mt-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-24 text-sky-500" style={{ color: "var(--e-accent, #0ea5e9)" }} role="img" aria-label={`${title}: ${chart.min} - ${chart.max}`}>
          {chart.marks.map((m) => (
            <line key={m.key} x1="0" x2={W} y1={y(m.v)} y2={y(m.v)} stroke={STROKE[m.key]} strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" opacity="0.9" />
          ))}
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {chart.marks.map((m) => (
          <span key={m.key} className="absolute left-0 -translate-y-full emb-chip rounded-sm bg-white/85 dark:bg-slate-900/85 px-1 text-[11px] leading-tight text-slate-600 dark:text-slate-300" style={{ top: `${(y(m.v) / H) * 100}%` }}>
            {m.label}
          </span>
        ))}
        <span className="absolute size-2 rounded-full bg-sky-500 ring-2 ring-white dark:ring-slate-900 -translate-x-1/2 -translate-y-1/2" style={{ background: "var(--e-accent, #0ea5e9)", left: `${(x(last[0]) / W) * 100}%`, top: `${(y(last[1]) / H) * 100}%` }} aria-hidden />
      </div>
      <p className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
        <span>{chart.fromLabel}</span>
        <span>
          {chart.min} – {chart.max}
        </span>
        <span>{chart.toLabel}</span>
      </p>
    </div>
  );
}

function GaugeView({ p }: { p: GaugePayload }) {
  const r = p.row;
  const full = p.cfg.size === "full";
  return (
    <Shell p={p} tone={r.tier}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{p.river}</p>
        </div>
        <TierPill label={r.step} tier={r.tier} />
      </div>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-3xl sm:text-4xl font-semibold tabular-nums leading-none ${r.level ? "" : "text-slate-400"}`}>{r.level ?? "—"}</span>
        <Trend row={r} />
      </p>
      {r.outcome && <p className="mt-1.5 text-sm font-medium">{r.outcome}</p>}
      {(r.next || r.cross) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-slate-700 dark:text-slate-300">
          <ArrowIcon a={r.nextArrow} className="size-4" />
          <span>{r.next}</span>
          {r.cross && <span className="font-semibold">· {r.cross}</span>}
        </p>
      )}
      {r.time && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{r.time}{r.age ? ` · ${r.age}` : ""}</p>}
      {p.bar && <MarksBar bar={p.bar} />}
      {full && p.chart && <LineChart chart={p.chart} title={p.chartTitle} />}
    </Shell>
  );
}

// ---- forecast: the prediction box and the forecasting chart -------------------------------------------------------------------------------

function ForecastChart({ chart, title }: { chart: FChart; title: string }) {
  const W = 300, H = 120;
  const ys = [...chart.observed.map((p) => p[1]), ...chart.forecast.map((p) => p[1]), ...chart.band.flatMap((b) => [b[1], b[2]]), ...chart.marks.map((m) => m.v)];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || 1) * 0.1;
  const y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const x = (t: number) => ((t - chart.from) / (chart.to - chart.from || 1)) * W;
  const line = (pts: [number, number][]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
  const first = chart.forecast[0];
  const bandPath = chart.band.length
    ? `M${x(first[0]).toFixed(1)} ${y(first[1]).toFixed(1)} ` +
      chart.band.map((b) => `L${x(b[0]).toFixed(1)} ${y(b[2]).toFixed(1)}`).join(" ") + " " +
      [...chart.band].reverse().map((b) => `L${x(b[0]).toFixed(1)} ${y(b[1]).toFixed(1)}`).join(" ") + " Z"
    : "";
  const nx = x(chart.now);
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <div className="relative mt-1.5 pl-[3.4rem]">
        <span className="absolute left-0 top-0 w-[3.2rem] text-right text-[11px] leading-none text-slate-500 dark:text-slate-400 tabular-nums">{chart.yMax}</span>
        <span className="absolute left-0 bottom-0 w-[3.2rem] text-right text-[11px] leading-none text-slate-500 dark:text-slate-400 tabular-nums">{chart.yMin}</span>
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-32 text-sky-500" style={{ color: "var(--e-accent, #0ea5e9)" }} role="img" aria-label={title}>
            {bandPath && <path d={bandPath} fill="currentColor" opacity="0.18" />}
            {chart.marks.map((m) => (
              <line key={m.key} x1="0" x2={W} y1={y(m.v)} y2={y(m.v)} stroke={STROKE[m.key]} strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={nx} x2={nx} y1="0" y2={H} stroke="currentColor" strokeWidth="1" opacity="0.5" vectorEffect="non-scaling-stroke" />
            <path d={line(chart.observed)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={line(chart.forecast)} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {chart.marks.map((m) => (
            <span key={m.key} className="absolute left-0 -translate-y-full emb-chip rounded-sm bg-white/85 dark:bg-slate-900/85 px-1 text-[11px] leading-tight text-slate-600 dark:text-slate-300" style={{ top: `${(y(m.v) / H) * 100}%` }}>
              {m.label}
            </span>
          ))}
          <span className="absolute size-2 rounded-full bg-sky-500 ring-2 ring-white dark:ring-slate-900 -translate-x-1/2 -translate-y-1/2" style={{ background: "var(--e-accent, #0ea5e9)", left: `${(nx / W) * 100}%`, top: `${(y(chart.forecast[0][1]) / H) * 100}%` }} aria-hidden />
        </div>
      </div>
      <div className="relative mt-1 h-4 pl-[3.4rem] text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
        <span className="absolute left-[3.4rem] top-0">{chart.axis.from}</span>
        <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `calc(3.4rem + (100% - 3.4rem) * ${(nx / W).toFixed(3)})` }}>{chart.axis.now}</span>
        <span className="absolute right-0 top-0">{chart.axis.to}</span>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-sky-500" style={{ background: "var(--e-accent, #0ea5e9)" }} aria-hidden />{chart.legend.observed}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-sky-500" style={{ borderColor: "var(--e-accent, #0ea5e9)" }} aria-hidden />{chart.legend.forecast}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "color-mix(in srgb, var(--e-accent, #0ea5e9) 20%, transparent)" }} aria-hidden />{chart.legend.band}</span>
      </p>
    </div>
  );
}

function ForecastView({ p }: { p: ForecastPayload }) {
  const r = p.row;
  const full = p.cfg.size === "full";
  return (
    <Shell p={p} tone={p.tone}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h1 className="text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{p.river}</p>
        </div>
        <TierPill label={p.verdict} tier={p.tone} />
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-3xl font-semibold tabular-nums leading-none ${r.level ? "" : "text-slate-400"}`}>{r.level ?? "—"}</span>
        <Trend row={r} />
        {r.time && <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{r.time}{r.age ? ` · ${r.age}` : ""}</span>}
      </p>
      <p className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${p.noForecast ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300" : "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"}`}>{p.forecastLabel}</p>
      {(p.hour || p.day) && (
        <div className={`mt-3 grid gap-2 ${p.hour && p.day ? "grid-cols-1 min-[440px]:grid-cols-2" : ""}`}>
          {p.hour && (
            <div className="emb-tile rounded-lg bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/50 px-3 py-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{p.hour.label}</p>
              <p className="mt-0.5 flex items-start gap-1.5 text-sm font-semibold leading-snug"><span className="mt-0.5 shrink-0"><ArrowIcon a={p.hour.arrow} /></span>{p.hour.title}</p>
              {p.hour.sub && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 tabular-nums">{p.hour.sub}</p>}
            </div>
          )}
          {p.day && (
            <div className="emb-tile rounded-lg bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/50 px-3 py-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{p.day.label}</p>
              <p className="mt-0.5 text-sm font-semibold leading-snug">{p.day.text}</p>
            </div>
          )}
        </div>
      )}
      {p.action && <p className="emb-tile mt-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm font-medium">{p.action}</p>}
      {full && p.chart && <ForecastChart chart={p.chart} title={p.chartTitle} />}
      {full && p.note && <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">{p.note}</p>}
    </Shell>
  );
}

// ---- town: the town page's verdict in plain words ---------------------------------------------------------------------------------------

function TownView({ p }: { p: TownPayload }) {
  const full = p.cfg.size === "full";
  return (
    <Shell p={p} tone={p.tier}>
      <h1 className="text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="leading-tight"><StepWord label={p.step} tier={p.tier} className="text-xl sm:text-2xl tracking-tight" /></p>
        {p.level && (
          <p className="text-right leading-tight">
            <span className="block text-xl sm:text-2xl font-semibold tabular-nums">{p.level}</span>
            {p.gaugeLine && <span className="block text-xs text-slate-500 dark:text-slate-400">{p.gaugeLine}</span>}
          </p>
        )}
      </div>
      {p.marks && full && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{p.marks}</p>}
      {(p.hour || p.day) && (
        <div className={`mt-3 grid gap-2 ${p.hour && p.day ? "grid-cols-1 min-[440px]:grid-cols-2" : ""}`}>
          {p.hour && (
            <div className="emb-tile rounded-lg bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/50 px-3 py-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{p.hourLabel}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold leading-snug">
                <ArrowIcon a={p.hourArrow} />
                {p.hour}
              </p>
            </div>
          )}
          {p.day && (
            <div className="emb-tile rounded-lg bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/50 px-3 py-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{p.dayLabel}</p>
              <p className="mt-0.5 text-sm font-semibold leading-snug">{p.day}</p>
            </div>
          )}
        </div>
      )}
      {p.action && <p className="emb-tile mt-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm font-medium">{p.action}</p>}
      {full && <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">{p.note}</p>}
      {p.time && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{p.time}</p>}
    </Shell>
  );
}

// ---- now: gauges at alert or above ------------------------------------------------------------------------------------------------------

function NowView({ p }: { p: NowPayload }) {
  const full = p.cfg.size === "full";
  const worst = p.groups.reduce<PillTier>((a, g) => g.rows.reduce((b, r) => (rank(r.tier) > rank(b) ? r.tier : b), a), "normal");
  return (
    <Shell p={p} tone={worst}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="emb-title text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{p.checked}</span>
      </div>
      <p className={`mt-0.5 text-sm ${p.calm ? "text-emerald-700 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}>{p.summary}</p>
      {p.groups.map((g) => (
        <div key={g.river} className="mt-3">
          <h2 className="text-sm font-semibold">
            <a href={g.href} target="_blank" rel="noopener" className="hover:underline underline-offset-2">{g.river}</a>
          </h2>
          <ul className="mt-1 divide-y divide-slate-200/80 dark:divide-slate-800">
            {g.rows.map((r, i) => (
              <li key={`${r.key}-${i}`} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <a href={r.href} target="_blank" rel="noopener" className="block font-medium leading-snug hover:underline underline-offset-2">{r.name}</a>
                  {full && (
                    <span className="block text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {r.trend && <span className="whitespace-nowrap">{r.trend}</span>}
                      {r.trend && r.time && " · "}
                      {r.time && <span className="whitespace-nowrap">{r.time}</span>}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2.5 shrink-0">
                  {r.level && <span className="font-semibold tabular-nums">{r.level}</span>}
                  <ArrowIcon a={r.arrow} className="size-3.5" />
                  <TierPill label={r.step} tier={r.tier} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Shell>
  );
}

// ---- reservoirs -------------------------------------------------------------------------------------------------------------------------

function ReservoirsView({ p }: { p: ReservoirsPayload }) {
  return (
    <Shell p={p}>
      <h1 className="emb-title text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{p.unavailable ?? p.summary}</p>
      {p.items.length > 0 && (
        <ul className="mt-2.5 divide-y divide-slate-200/80 dark:divide-slate-800">
          {p.items.map((i, n) => (
            <li key={`${i.key}-${n}`} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a href={i.href} target="_blank" rel="noopener" className="font-semibold leading-snug hover:underline underline-offset-2">{i.name}</a>
                  {i.river && <p className="text-xs text-slate-500 dark:text-slate-400">{i.river}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${i.official ? "bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"}`}>{i.status}</span>
                  {i.figure && <p className="mt-1 text-sm font-semibold tabular-nums">{i.figure}</p>}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{`${i.source}${i.when ? ` · ${i.when}` : ""}`}</p>
              {i.reported && (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  {i.reportedUrl ? (
                    <a href={i.reportedUrl} target="_blank" rel="noopener noreferrer" className={link}>{i.reported}</a>
                  ) : (
                    i.reported
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

// ---- ticker: one line --------------------------------------------------------------------------------------------------------------------

function TickerView({ p }: { p: TickerPayload }) {
  return (
    <div className={`emb-card ${TONE_CLS[p.tier] ?? ""} rounded-lg border px-3 py-1.5 ${CARD[p.tier]}`} style={TONE_VAR[p.tier]}>
      <p className="flex items-center gap-2 text-sm leading-tight min-w-0">
        <span className={`size-2.5 shrink-0 rounded-full ${PILL[p.tier].dot}`} aria-hidden />
        <a href={p.href} target="_blank" rel="noopener" className="min-w-0 flex-1 font-medium hover:underline underline-offset-2" title={p.label}>
          {p.segments.map((s, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 text-slate-400" aria-hidden>· </span>}
              {i === 1 ? <StepWord label={s} tier={p.tier} className="text-xs" /> : s}
            </span>
          ))}
        </a>
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-slate-500 dark:text-slate-400">
        {p.credit.live}{" "}
        <a href={p.credit.href} target="_blank" rel="noopener" className="emb-link font-semibold underline underline-offset-2">{p.credit.linkText}</a>
        {" · "}
        {p.credit.rest}
        {p.credit.extra && (
          <>
            {" · "}
            <a href={p.credit.extra.href} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">{p.credit.extra.text}</a>
          </>
        )}
      </p>
    </div>
  );
}

// ---- card: the simplest box, one gauge, verdict first ----------------------------------------------------------------------------------

function CardView({ p }: { p: CardPayload }) {
  const r = p.row;
  const full = p.cfg.size === "full";
  return (
    <Shell p={p} tone={r.tier}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="emb-title text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{p.river}</p>
        </div>
        {!r.since && <TierPill label={r.step} tier={r.tier} />}
      </div>
      {r.since ? (
        <p className="mt-3 text-sm font-medium">{r.since}</p>
      ) : (
        <>
          <p className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-4xl font-semibold tabular-nums leading-none ${r.level ? "" : "text-slate-400"}`}>{r.level ?? "—"}</span>
            <Trend row={r} />
          </p>
          {r.outcome && <p className="mt-1.5 text-sm font-medium">{r.outcome}</p>}
          {full && (r.next || r.cross) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-700 dark:text-slate-300">
              <ArrowIcon a={r.nextArrow} className="size-4" />
              <span>{r.next}</span>
              {r.cross && <span className="font-semibold">· {r.cross}</span>}
            </p>
          )}
          {full && p.bar && <MarksBar bar={p.bar} />}
          {r.time && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{r.time}{r.age ? ` · ${r.age}` : ""}</p>}
        </>
      )}
    </Shell>
  );
}

// ---- the shell -------------------------------------------------------------------------------------------------------------------------

function View({ p }: { p: EmbedPayload }) {
  switch (p.kind) {
    case "river": return <RiverView p={p} />;
    case "card": return <CardView p={p} />;
    case "gauge": return <GaugeView p={p} />;
    case "forecast": return <ForecastView p={p} />;
    case "town": return <TownView p={p} />;
    case "now": return <NowView p={p} />;
    case "reservoirs": return <ReservoirsView p={p} />;
    case "ticker": return <TickerView p={p} />;
  }
}

export function EmbedApp({ initial, api, cfg, widget }: { initial: EmbedPayload | null; api: string; cfg: EmbedCfg; widget: Widget }) {
  const [data, setData] = useState<EmbedPayload | null>(initial);
  const wrap = useRef<HTMLDivElement>(null);
  const last = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "default" });
      if (!res.ok) return;
      const j = (await res.json()) as EmbedPayload;
      setData(j);
      last.current = Date.now();
    } catch {
      /* keep what is on screen; try again next time */
    }
  }, [api]);

  // the 5-minute refresh (30 s while there is nothing to show), and a refresh when the tab comes back after a while
  useEffect(() => {
    const id = setInterval(refresh, data ? REFRESH_MS : 30_000);
    const vis = () => document.visibilityState === "visible" && Date.now() - last.current > REFRESH_MS && refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh, data]);

  // content height to the parent page (the optional resize script listens); a plain fixed-height iframe just ignores it
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let prev = 0;
    const send = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== prev && window.parent !== window) {
        prev = h;
        window.parent.postMessage({ type: "waterlevels-embed-height", h }, "*");
      }
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the only analytics: one embed_view event with the embedding site's hostname (never the path), not counted for our own pages
  useEffect(() => {
    let host = "";
    try {
      host = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      host = "";
    }
    if (host === location.hostname || host === "waterlevels.lk" || host === "localhost") return;
    let n = 0;
    const id = setInterval(() => {
      const u = window.umami;
      if (u) {
        clearInterval(id);
        try {
          u.track("embed_view", { site: host || "unknown", widget });
        } catch {
          /* analytics must never break the widget */
        }
      } else if (++n > 40) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [widget]);

  const st = styleOf(cfg);
  return (
    <div ref={wrap} className={`${st.classes} ${widget === "ticker" ? "p-1" : "p-1.5"}`} lang={cfg.lang}>
      <style dangerouslySetInnerHTML={{ __html: st.css }} />
      {st.fontHref && <link rel="stylesheet" href={st.fontHref} />}
      {data ? (
        <View p={data} />
      ) : (
        <p className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">
          Live river levels are not available right now. Trying again soon.
        </p>
      )}
    </div>
  );
}
