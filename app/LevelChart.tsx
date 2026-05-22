"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Reading, StationData } from "@/lib/arcgis";

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LevelChart({
  readings,
  thresholds,
}: {
  readings: Reading[];
  thresholds: StationData["thresholds"];
}) {
  if (readings.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md">
        No readings in the last 4 days for this station.
      </div>
    );
  }

  const data = readings.map((r) => ({ ts: r.ts, level: r.water_level }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTime}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.5}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.5}
            width={36}
          />
          <Tooltip
            labelFormatter={(v) => fmtTime(Number(v))}
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              return [Number.isFinite(n) ? n.toFixed(2) : "—", "Water level"];
            }}
            contentStyle={{ fontSize: 12 }}
          />
          {thresholds.alert != null && (
            <ReferenceLine
              y={thresholds.alert}
              stroke="#eab308"
              strokeDasharray="4 4"
              label={{ value: `alert ${thresholds.alert}`, position: "insideTopRight", fontSize: 10, fill: "#eab308" }}
            />
          )}
          {thresholds.minor != null && (
            <ReferenceLine
              y={thresholds.minor}
              stroke="#f97316"
              strokeDasharray="4 4"
              label={{ value: `minor ${thresholds.minor}`, position: "insideTopRight", fontSize: 10, fill: "#f97316" }}
            />
          )}
          {thresholds.major != null && (
            <ReferenceLine
              y={thresholds.major}
              stroke="#dc2626"
              strokeDasharray="4 4"
              label={{ value: `major ${thresholds.major}`, position: "insideTopRight", fontSize: 10, fill: "#dc2626" }}
            />
          )}
          <Line
            type="monotone"
            dataKey="level"
            stroke="#0ea5e9"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
