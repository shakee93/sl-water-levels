"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Reading, StationData } from "@/lib/arcgis";
import { useDays } from "./RangePicker";

const TZ = "Asia/Colombo";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COLOMBO_MS = 5.5 * HOUR;

function lower(s: string) {
  return s.replace(/\s?(AM|PM)/, (_, m: string) => ` ${m.toLowerCase()}`);
}
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: true });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric" });
const fullFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function niceTicks(from: number, to: number, days: number): number[] {
  const step = days <= 1 ? 4 * HOUR : DAY;
  const out: number[] = [];
  let t = Math.ceil((from + COLOMBO_MS) / step) * step - COLOMBO_MS;
  for (; t <= to; t += step) out.push(t);
  return out;
}

export function LevelChart({
  readings,
  thresholds,
  unit,
}: {
  readings: Reading[];
  thresholds: StationData["thresholds"];
  unit?: "ft" | "m" | null;
}) {
  const days = useDays();

  const { data, ticks, domain, last } = useMemo(() => {
    const valid = readings.filter((r) => r.water_level != null);
    const anchor = valid.length ? valid[valid.length - 1].ts : 0;
    const from = anchor - days * DAY;
    const data = valid.filter((r) => r.ts >= from).map((r) => ({ ts: r.ts, level: r.water_level as number }));
    const vals = [
      ...data.map((d) => d.level),
      ...[thresholds.alert, thresholds.minor, thresholds.major].filter((v): v is number => v != null),
    ];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.08, 0.1);
    return {
      data,
      ticks: data.length ? niceTicks(data[0].ts, data[data.length - 1].ts, days) : [],
      domain: [Math.floor((lo - pad) * 2) / 2, Math.ceil((hi + pad) * 2) / 2] as [number, number],
      last: data.length ? data[data.length - 1] : null,
    };
  }, [readings, thresholds, days]);

  const u = unit ? ` ${unit}` : "";

  if (data.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md">
        No readings in this period.
      </div>
    );
  }

  const tickFmt = (v: number) => (days <= 1 ? lower(hourFmt.format(v)) : dayFmt.format(v));
  const line = (y: number | null, label: string, color: string) =>
    y != null && (
      <ReferenceLine
        y={y}
        stroke={color}
        strokeDasharray="4 4"
        label={{ value: `${label} ${y}${u}`, position: "insideTopLeft", fontSize: 12, fill: color }}
      />
    );

  return (
    <div
      className="h-[22rem] sm:h-80 w-full"
      role="img"
      aria-label={`Water level over the last ${days} ${days === 1 ? "day" : "days"}; latest ${last?.level.toFixed(2)}${u}`}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={tickFmt}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.5}
            interval="preserveStartEnd"
          />
          <YAxis
            type="number"
            domain={domain}
            allowDataOverflow
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.5}
            width={unit ? 48 : 38}
            tickFormatter={(v) => `${v}${unit ?? ""}`}
          />
          <Tooltip
            labelFormatter={(v) => lower(fullFmt.format(Number(v)))}
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              return [Number.isFinite(n) ? `${n.toFixed(2)}${u}` : "—", "Water level"];
            }}
            contentStyle={{ fontSize: 13 }}
          />
          {line(thresholds.alert, "Alert", "#d97706")}
          {line(thresholds.minor, "Minor flood", "#ea580c")}
          {line(thresholds.major, "Major flood", "#dc2626")}
          <Line type="monotone" dataKey="level" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
          {last && (
            <ReferenceDot
              x={last.ts}
              y={last.level}
              r={6}
              fill="#0ea5e9"
              stroke="#fff"
              strokeWidth={2}
              ifOverflow="visible"
              label={{ value: "Now", position: "top", fontSize: 12, fill: "currentColor" }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
