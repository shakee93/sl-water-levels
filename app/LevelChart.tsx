"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { MapPin } from "lucide-react";
import type { Reading, StationData } from "@/lib/arcgis";
import { buildYScale, plain } from "@/lib/chartAxis";
import { MY_LEVELS_EVENT, parseMyLevel, readMyLevelsRaw, writeMyLevel } from "@/lib/myLevels";
import { useDays } from "./RangePicker";
import { useI18n } from "./LocaleProvider";
import { dayTick, fullStamp, hourTick, colomboParts } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COLOMBO_MS = 5.5 * HOUR;

// Plot geometry is fixed so labels can be placed in pixels.
const AXIS_W = 36;
const AXIS_H = 24;
const M_TOP = 22;
const M_RIGHT = 14;

const BLUE = "#0ea5e9";
const AMBER = "#d97706";
const ORANGE = "#ea580c";
const RED = "#dc2626";
const VIOLET = "#8b5cf6";

export type ChartForecast = { points: { ts: number; level: number; low: number | null; high: number | null }[] };
type Marks = StationData["thresholds"];
type Zone = "below" | "alert" | "minor" | "major" | "none";
type Row = { ts: number; level?: number; fc?: number; band?: [number, number] };

function zoneOf(level: number, m: Marks): Zone {
  const ok = (v: number | null) => v != null && v > 0;
  if (!ok(m.alert) && !ok(m.minor) && !ok(m.major)) return "none";
  if (ok(m.major) && level >= (m.major as number)) return "major";
  if (ok(m.minor) && level >= (m.minor as number)) return "minor";
  if (ok(m.alert) && level >= (m.alert as number)) return "alert";
  return "below";
}
const ZONE_COLOR: Record<Zone, string> = { below: BLUE, none: BLUE, alert: AMBER, minor: ORANGE, major: RED };
const ZONE_KEY = { below: "chart.zoneBelow", none: "chart.zoneNone", alert: "tier.alert", minor: "tier.minor", major: "tier.major" } as const;

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(MY_LEVELS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(MY_LEVELS_EVENT, cb);
  };
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Tick times (ms) aligned to Sri Lanka midnight / hour marks, spaced at least `minPx` apart. */
function timeTicks(from: number, to: number, plotW: number, days: number): number[] {
  const msPerPx = (to - from) / Math.max(plotW, 1);
  const steps = (days <= 1 ? [3, 6, 12, 24, 48] : [24, 48, 96]).map((h) => h * HOUR);
  const step = steps.find((s) => s / msPerPx >= 56) ?? steps[steps.length - 1];
  const edge = 26 * msPerPx; // keep the last label clear of the right edge
  const out: number[] = [];
  for (let t = Math.ceil((from + COLOMBO_MS) / step) * step - COLOMBO_MS; t <= to - edge; t += step) out.push(t);
  return out;
}

export function LevelChart({
  station,
  readings,
  thresholds,
  unit,
  forecast,
}: {
  station: string;
  readings: Reading[];
  thresholds: Marks;
  unit?: "ft" | "m" | null;
  forecast?: ChartForecast | null;
}) {
  const days = useDays();
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [wrapRef, { w, h }] = useSize();
  const myRaw = useSyncExternalStore(subscribe, readMyLevelsRaw, () => null);
  const my = parseMyLevel(myRaw, station);
  const narrow = w > 0 && w < 480;

  const model = useMemo(() => {
    const valid = readings.filter((r) => r.water_level != null);
    const anchor = valid.length ? valid[valid.length - 1].ts : 0;
    const from = anchor - days * DAY;
    const actual = valid.filter((r) => r.ts >= from).map((r) => ({ ts: r.ts, level: r.water_level as number }));
    if (!actual.length) return null;
    const last = actual[actual.length - 1];
    const future = (forecast?.points ?? []).filter((p) => p.ts > last.ts && Number.isFinite(p.level));
    const rows: Row[] = actual.map((a) => ({ ...a }));
    if (future.length) {
      rows[rows.length - 1] = { ...last, fc: last.level, band: [last.level, last.level] };
      for (const p of future) {
        rows.push({
          ts: p.ts,
          fc: p.level,
          band: p.low != null && p.high != null ? [Math.max(0, Math.min(p.low, p.level)), Math.max(p.high, p.level)] : [p.level, p.level],
        });
      }
    }
    const lo = Math.min(...actual.map((a) => a.level));
    const hi = Math.max(...actual.map((a) => a.level));
    const end = future.length ? future[future.length - 1].ts : last.ts;
    const extra = [...future.flatMap((p) => [p.level, Math.max(0, p.low ?? p.level), p.high ?? p.level])];
    if (my != null) extra.push(my);
    return { rows, actual, last, from, end, lo, hi, extra, hasForecast: future.length > 0, fcEnd: future.length ? future[future.length - 1] : null };
  }, [readings, days, forecast, my]);

  const y = useMemo(
    () =>
      model
        ? buildYScale({ dataLo: model.lo, dataHi: model.hi, extra: model.extra, marks: thresholds, targetTicks: narrow || h < 300 ? 4 : 6 })
        : null,
    [model, thresholds, narrow, h],
  );

  if (!model || !y) {
    return (
      <div className="h-80 sm:h-[21rem] flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md">
        {t("chart.none")}
      </div>
    );
  }

  const { rows, actual, last, from, end, lo, hi, hasForecast, fcEnd } = model;
  const [dLo, dHi] = y.domain;
  const u = unit ?? "";
  const withUnit = (v: number) => (u ? `${plain(v)} ${u}` : plain(v));
  const plotW = Math.max(w - AXIS_W - M_RIGHT, 1);
  const plotH = Math.max(h - M_TOP - AXIS_H, 1);
  const yPx = (v: number) => M_TOP + ((dHi - v) / (dHi - dLo)) * plotH;
  const xPx = (ts: number) => AXIS_W + ((ts - from) / (end - from || 1)) * plotW;
  const ticks = timeTicks(from, end, plotW, days);
  const lastZone = zoneOf(last.level, thresholds);
  const tier = ZONE_COLOR[lastZone];
  const marks = y.marks;

  // line colour follows the zone: hard stops at each mark the data crosses
  const strokeStops: { off: number; color: string }[] = [];
  const crossings: { ts: number; level: number }[] = [];
  if (hi > lo) {
    const cuts = [marks.major, marks.minor, marks.alert].filter((v): v is number => v != null && v > lo && v < hi);
    const bounds = [hi, ...cuts, lo];
    bounds.slice(0, -1).forEach((top, i) => {
      const bottom = bounds[i + 1];
      const color = ZONE_COLOR[zoneOf((top + bottom) / 2, thresholds)];
      strokeStops.push({ off: (hi - top) / (hi - lo), color }, { off: (hi - bottom) / (hi - lo), color });
    });
    const all = [marks.alert, marks.minor, marks.major].filter((v): v is number => v != null);
    for (let i = 1; i < actual.length && crossings.length < 8; i++) {
      const a = actual[i - 1];
      const b = actual[i];
      for (const m of all) {
        if ((a.level < m) !== (b.level < m) && a.level !== b.level) {
          crossings.push({ ts: a.ts + ((m - a.level) / (b.level - a.level)) * (b.ts - a.ts), level: m });
        }
      }
    }
  }

  // the "Now" pill sits on the side the line is not on
  const ref3h = [...actual].reverse().find((r) => r.ts <= last.ts - 2.5 * HOUR);
  const falling = ref3h ? last.level < ref3h.level - (dHi - dLo) * 0.01 : false;
  const nowX = xPx(last.ts);
  const nowY = yPx(last.level);
  const pillText = withUnit(last.level);
  const pillW = Math.round(pillText.length * 7.2 + 18);
  const pillH = 22;
  let pillBelow = falling;
  if (nowY - 14 - pillH < M_TOP) pillBelow = true;
  else if (nowY + 14 + pillH > M_TOP + plotH) pillBelow = false;
  const pillX = Math.min(Math.max(nowX - pillW / 2, AXIS_W + 2), w - pillW - 2);
  const pillY = pillBelow ? nowY + 13 : nowY - 13 - pillH;

  // flood-mark label rows, so "Your street" can pick a free side
  const bandLabelRows = [marks.alert, marks.minor, marks.major]
    .filter((v): v is number => v != null && v >= dLo && v < dHi)
    .map((v) => yPx(v));
  const myPx = my != null && my >= dLo && my <= dHi ? yPx(my) : null;
  const myAbove = myPx == null || !bandLabelRows.some((p) => Math.abs(p - myPx) < 15) || bandLabelRows.some((p) => p > myPx && p - myPx < 27);
  const myText = t("chart.yourStreet", { level: withUnit(my ?? 0) });

  const summary =
    t("chart.summary", {
      days: t(days === 1 ? "range.day" : "range.days", { n: days }),
      lo: withUnit(lo),
      hi: withUnit(hi),
      latest: withUnit(last.level),
      zone: lastZone === "none" ? "" : ` (${t(ZONE_KEY[lastZone])})`,
    }) +
    (fcEnd ? t("chart.summaryForecast", { level: withUnit(fcEnd.level) }) : "") +
    (my != null ? t("chart.summaryYours", { level: withUnit(my) }) : "");

  const prevOf = (ts: number): number | null => {
    let best: Reading | { ts: number; level: number } | null = null;
    for (const a of actual) {
      if (Math.abs(a.ts - (ts - HOUR)) <= 30 * 60_000 && a.ts < ts && (!best || Math.abs(a.ts - (ts - HOUR)) < Math.abs(best.ts - (ts - HOUR)))) best = a;
    }
    return best ? (best as { level: number }).level : null;
  };

  const tickText = "fill-slate-500 dark:fill-slate-400";
  const bandCls = {
    alert: "fill-amber-700 dark:fill-amber-400",
    minor: "fill-orange-700 dark:fill-orange-400",
    major: "fill-red-700 dark:fill-red-400",
  } as const;
  const bands = [
    { key: "alert" as const, from: marks.alert, to: marks.minor ?? marks.major, color: AMBER, op: 0.09 },
    { key: "minor" as const, from: marks.minor, to: marks.major, color: ORANGE, op: 0.1 },
    { key: "major" as const, from: marks.major, to: null, color: RED, op: 0.12 },
  ]
    .filter((b) => b.from != null && b.from < dHi && b.from >= dLo)
    .map((b) => ({ ...b, from: b.from as number, to: Math.min(b.to ?? dHi, dHi) }));

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative h-80 sm:h-[21rem] w-full text-slate-900 dark:text-slate-100"
        role="group"
        aria-label={t("chart.aria", { days: t(days === 1 ? "range.day" : "range.days", { n: days }), level: withUnit(last.level) })}
      >
        {u && (
          <span aria-hidden className="absolute left-1 top-0 text-[11px] leading-none text-slate-500 dark:text-slate-400">
            {u}
          </span>
        )}
        {w > 0 && (
          <ComposedChart
            width={w}
            height={h}
            data={rows}
            margin={{ top: M_TOP, right: M_RIGHT, bottom: 0, left: 0 }}
            accessibilityLayer
            style={{ outline: "none" }}
          >
            <defs>
              <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={tier} stopOpacity={0.32} />
                <stop offset="1" stopColor={tier} stopOpacity={0.02} />
              </linearGradient>
              {strokeStops.length > 0 && (
                <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="0" y2="1">
                  {strokeStops.map((s, i) => (
                    <stop key={i} offset={s.off} stopColor={s.color} />
                  ))}
                </linearGradient>
              )}
            </defs>
            <CartesianGrid stroke="currentColor" strokeOpacity={0.07} vertical={false} />

            {bands.map((b) => (
              <ReferenceArea
                key={b.key}
                y1={b.from}
                y2={b.to}
                fill={b.color}
                fillOpacity={b.op}
                stroke="none"
                ifOverflow="hidden"
                label={<BandLabel text={`${t(`tier.${b.key}`)} ${withUnit(b.from)}`} cls={bandCls[b.key]} />}
              />
            ))}
            {hasForecast && (
              <ReferenceArea
                x1={last.ts}
                x2={end}
                fill="currentColor"
                fillOpacity={0.045}
                stroke="none"
                label={<ForecastLabel text={t("chart.forecast")} short={t("chart.forecast").split(" ")[0]} />}
              />
            )}
            {[marks.alert, marks.minor, marks.major].map(
              (v, i) =>
                v != null &&
                v >= dLo &&
                v <= dHi && <ReferenceLine key={i} y={v} stroke={[AMBER, ORANGE, RED][i]} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="4 4" />,
            )}
            {my != null && my >= dLo && my <= dHi && (
              <ReferenceLine
                y={my}
                stroke={VIOLET}
                strokeWidth={1.5}
                strokeDasharray="1.5 4"
                strokeLinecap="round"
                label={<MyLabel text={myText} above={myAbove} />}
              />
            )}

            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={[from, end]}
              ticks={ticks}
              tickFormatter={(v: number) => (days <= 1 && colomboParts(v).h24 !== 0 ? hourTick(v, t) : dayTick(v, t))}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "currentColor", strokeOpacity: 0.25 }}
              height={AXIS_H}
              tickMargin={6}
              className={tickText}
              allowDataOverflow
            />
            <YAxis
              type="number"
              domain={y.domain}
              ticks={y.ticks}
              width={AXIS_W}
              axisLine={false}
              tickLine={false}
              tick={(p: { x?: number | string; y?: number | string; payload?: { value: number } }) => (
                <text
                  x={Number(p.x) - 4}
                  y={Number(p.y)}
                  dy={4}
                  textAnchor="end"
                  fontSize={11}
                  className={y.markTicks.has(p.payload?.value ?? NaN) ? "fill-slate-800 dark:fill-slate-200 font-semibold" : tickText}
                >
                  {plain(p.payload?.value ?? 0)}
                </text>
              )}
              allowDataOverflow
            />

            {hasForecast && (
              <Area dataKey="band" stroke="none" fill={BLUE} fillOpacity={0.16} isAnimationActive={false} activeDot={false} legendType="none" connectNulls />
            )}
            <Area
              dataKey="level"
              type="monotone"
              stroke="none"
              fill={`url(#${uid}-fill)`}
              baseValue={dLo}
              isAnimationActive={false}
              activeDot={false}
            />
            {hasForecast && (
              <Line dataKey="fc" type="monotone" stroke={BLUE} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls />
            )}
            <Line
              dataKey="level"
              type="monotone"
              stroke={strokeStops.length ? `url(#${uid}-line)` : tier}
              strokeWidth={2.25}
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: "#fff" }}
              isAnimationActive={false}
            />
            {crossings.map((c, i) => (
              <ReferenceDot key={i} x={c.ts} y={c.level} r={3.5} fill={ZONE_COLOR[zoneOf(c.level + 1e-9, thresholds)]} stroke="#fff" strokeWidth={1.5} />
            ))}

            <ReferenceLine x={last.ts} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
            <ReferenceDot
              x={last.ts}
              y={last.level}
              r={6}
              ifOverflow="visible"
              shape={(p: { cx?: number; cy?: number }) => (
                <g pointerEvents="none">
                  <circle cx={p.cx} cy={p.cy} r={10} fill={tier} fillOpacity={0.2} />
                  <circle cx={p.cx} cy={p.cy} r={5.5} fill={tier} stroke="#fff" strokeWidth={2} />
                  <text x={(p.cx ?? 0) - 5} y={M_TOP + 11} textAnchor="end" fontSize={11} fontWeight={600} className="fill-slate-600 dark:fill-slate-300 stroke-white dark:stroke-slate-900" strokeWidth={3} paintOrder="stroke">
                    {t("chart.now")}
                  </text>
                  <rect x={pillX} y={pillY} width={pillW} height={pillH} rx={11} className="fill-white dark:fill-slate-900" stroke={tier} strokeWidth={1.5} />
                  <text x={pillX + pillW / 2} y={pillY + 15} textAnchor="middle" fontSize={12} fontWeight={700} className="fill-slate-900 dark:fill-slate-50 tabular-nums">
                    {pillText}
                  </text>
                </g>
              )}
            />

            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }}
              wrapperStyle={{ outline: "none", zIndex: 20 }}
              content={(p: { active?: boolean; payload?: ReadonlyArray<{ payload?: Row }> }) => {
                const row = p.active ? p.payload?.[0]?.payload : undefined;
                if (!row) return null;
                return <Tip row={row} t={t} marks={thresholds} withUnit={withUnit} prev={row.level != null ? prevOf(row.ts) : null} />;
              }}
            />
          </ComposedChart>
        )}
      </div>

      <p className="sr-only">{summary}</p>

      <div className="mt-2 px-1 sm:px-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
        <p className="tabular-nums" aria-hidden>
          {t("chart.highest", { v: withUnit(hi) })} <span className="mx-1">·</span> {t("chart.lowest", { v: withUnit(lo) })}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {hasForecast && (
            <span className="inline-flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" y1="3" x2="18" y2="3" stroke={BLUE} strokeWidth="2" strokeDasharray="5 3" />
              </svg>
              {t("chart.forecast")}
            </span>
          )}
          <MyLevelControl station={station} unit={unit ?? null} current={my} t={t} />
        </div>
      </div>
    </div>
  );
}

function BandLabel({ text, cls, viewBox }: { text: string; cls: string; viewBox?: { x?: number; y?: number; width?: number; height?: number } }) {
  if (!viewBox || (viewBox.height ?? 0) < 17) return null;
  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) - 6;
  const yb = (viewBox.y ?? 0) + (viewBox.height ?? 0) - 5;
  return (
    <text x={x} y={yb} textAnchor="end" fontSize={11} fontWeight={600} className={`${cls} stroke-white/70 dark:stroke-slate-900/70`} strokeWidth={3} paintOrder="stroke" pointerEvents="none">
      {text}
    </text>
  );
}

function ForecastLabel({ text, short, viewBox }: { text: string; short: string; viewBox?: { x?: number; y?: number; width?: number } }) {
  if (!viewBox) return null;
  const wpx = viewBox.width ?? 0;
  const label = wpx >= 150 ? text : wpx >= 62 ? short : "";
  if (!label) return null;
  return (
    <text x={(viewBox.x ?? 0) + 7} y={(viewBox.y ?? 0) + 11} fontSize={11} className="fill-slate-500 dark:fill-slate-400" pointerEvents="none">
      {label}
    </text>
  );
}

function MyLabel({ text, above, viewBox }: { text: string; above: boolean; viewBox?: { x?: number; y?: number; width?: number } }) {
  if (!viewBox) return null;
  return (
    <text
      x={(viewBox.x ?? 0) + (viewBox.width ?? 0) - 6}
      y={(viewBox.y ?? 0) + (above ? -5 : 13)}
      textAnchor="end"
      fontSize={11}
      fontWeight={600}
      className="fill-violet-700 dark:fill-violet-300 stroke-white/70 dark:stroke-slate-900/70"
      strokeWidth={3}
      paintOrder="stroke"
      pointerEvents="none"
    >
      {text}
    </text>
  );
}

function Tip({ row, t, marks, withUnit, prev }: { row: Row; t: TFn; marks: Marks; withUnit: (v: number) => string; prev: number | null }) {
  const isFc = row.level == null;
  const level = (row.level ?? row.fc) as number;
  const zone = zoneOf(level, marks);
  let change: string | null = null;
  if (prev != null && !isFc) {
    const d = level - prev;
    change = Math.abs(d) < 0.005 ? t("chart.steady") : t(d > 0 ? "chart.up" : "chart.down", { d: withUnit(Math.abs(d)) });
  }
  return (
    <div className="min-w-44 max-w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-lg px-3 py-2 text-sm">
      <div className="text-xs text-slate-500 dark:text-slate-400">{fullStamp(row.ts, t)}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-base font-semibold tabular-nums">{isFc ? "~" : ""}{withUnit(level)}</span>
      </div>
      {zone !== "none" && (
        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: ZONE_COLOR[zone] }} />
          {t(ZONE_KEY[zone])}
        </div>
      )}
      {isFc && row.band && row.band[0] !== row.band[1] && (
        <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
          {t("chart.forecastRange", { low: withUnit(row.band[0]), high: withUnit(row.band[1]) })}
        </div>
      )}
      {isFc && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("chart.forecast")}</div>}
      {change && <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{change}</div>}
    </div>
  );
}

function MyLevelControl({ station, unit, current, t }: { station: string; unit: "ft" | "m" | null; current: number | null; t: TFn }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  function close() {
    setOpen(false);
    btn.current?.focus();
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(text.trim().replace(",", "."));
    if (!Number.isFinite(v) || v <= 0 || v > 1000) {
      setBad(true);
      return;
    }
    writeMyLevel(station, Math.round(v * 100) / 100);
    close();
  }

  const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
  return (
    <div ref={box} className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setText(current != null ? plain(current) : "");
          setBad(false);
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-1.5 h-9 sm:h-8 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 ${ring}`}
      >
        <MapPin className="size-3.5 text-violet-600 dark:text-violet-400" aria-hidden />
        {current != null ? (
          <>
            <span>{t("chart.yourStreetShort")}</span>
            <span className="font-semibold tabular-nums">{plain(current)}{unit ? ` ${unit}` : ""}</span>
            <span className="text-sky-700 dark:text-sky-400">{t("chart.changeLevel")}</span>
          </>
        ) : (
          t("chart.setLevel")
        )}
      </button>
      {open && (
        <form
          role="dialog"
          aria-label={t("chart.setLevel")}
          onSubmit={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
          className="absolute right-0 bottom-full mb-2 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-lg p-3 text-sm"
        >
          <label htmlFor={`${id}-lvl`} className="block font-medium">
            {t("chart.levelFieldLabel")}
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={input}
              id={`${id}-lvl`}
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setBad(false);
              }}
              aria-invalid={bad}
              aria-describedby={`${id}-hint`}
              className={`h-10 w-28 rounded-md border bg-white dark:bg-slate-950 px-2.5 text-base tabular-nums ${bad ? "border-red-500" : "border-slate-300 dark:border-slate-600"} ${ring}`}
            />
            {unit && <span className="text-slate-600 dark:text-slate-400">{unit}</span>}
          </div>
          <p id={`${id}-hint`} className={`mt-1.5 text-xs ${bad ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
            {bad ? t("chart.levelInvalid") : unit ? t("chart.levelHint", { unit }) : t("chart.levelHintNoUnit")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" className={`h-10 px-4 rounded-md bg-sky-600 text-white font-medium hover:bg-sky-700 ${ring}`}>
              {t("chart.save")}
            </button>
            {current != null && (
              <button
                type="button"
                onClick={() => {
                  writeMyLevel(station, null);
                  close();
                }}
                className={`h-10 px-3 rounded-md text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 ${ring}`}
              >
                {t("chart.remove")}
              </button>
            )}
            <button type="button" onClick={close} className={`h-10 px-3 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
              {t("chart.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
