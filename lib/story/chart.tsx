// The story image's chart: the last 24 h as a line, the forecast as a dashed line with its band, the official marks that are near,
// drawn as plain SVG (ImageResponse renders it as an image; no chart library on the server). Colours match the gauge page's chart.
import type { LChart } from "@/lib/embedTypes";
import type { PillTier } from "@/app/TierPill";

export const TIER_COLOR: Record<PillTier, { bg: string; fg: string }> = {
  normal: { bg: "#059669", fg: "#ffffff" },
  alert: { bg: "#f59e0b", fg: "#451a03" },
  minor: { bg: "#ea580c", fg: "#ffffff" },
  major: { bg: "#dc2626", fg: "#ffffff" },
  none: { bg: "#94a3b8", fg: "#0f172a" },
  stale: { bg: "#94a3b8", fg: "#0f172a" },
};
const MARK_COLOR = { alert: "#d97706", minor: "#ea580c", major: "#dc2626" } as const;
const H = 3_600_000;

type Mark = { key: "alert" | "minor" | "major"; y: number; label: string };
export type Plot = { first: number; last: number; d: string; fc: string; band: string; now: [number, number] | null; marks: Mark[]; fcEndFrac: number; has: boolean; histHours: number; fcHours: number };

export function plotChart(c: LChart, w: number, h: number, labels: { alert: string; minor: string; major: string }, unitDigits: number): Plot {
  const last = c.readings[c.readings.length - 1];
  const empty: Plot = { first: 0, last: 0, d: "", fc: "", band: "", now: null, marks: [], fcEndFrac: 1, has: false, histHours: 24, fcHours: 0 };
  if (!last) return empty;
  const t1 = last[0];
  const t0 = t1 - 24 * H;
  const hist = c.readings.filter((r) => r[0] >= t0);
  if (hist.length < 2) return empty;
  const fcs = c.forecast.filter((p) => p.ts > t1 && p.ts <= t1 + 12 * H);
  const tEnd = fcs.length ? fcs[fcs.length - 1].ts : t1;
  const vals = [...hist.map((r) => r[1]), ...fcs.flatMap((p) => [p.level, p.low ?? p.level, p.high ?? p.level])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const minSpan = c.unit === "m" ? 0.3 : 1;
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const r0 = hi - lo;
  const near: Mark[] = [];
  for (const k of ["alert", "minor", "major"] as const) {
    const v = c.marks[k];
    if (v != null && v >= lo - 0.5 * r0 && v <= hi + 0.5 * r0) {
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      near.push({ key: k, y: v, label: `${labels[k]} ${v.toFixed(unitDigits)}` });
    }
  }
  const padY = (hi - lo) * 0.12;
  lo -= padY; hi += padY;
  const x = (t: number) => ((t - t0) / (tEnd - t0)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  const f = (n: number) => n.toFixed(1);
  const d = hist.map((r, i) => `${i ? "L" : "M"}${f(x(r[0]))} ${f(y(r[1]))}`).join(" ");
  const fc = fcs.length ? `M${f(x(t1))} ${f(y(last[1]))} ` + fcs.map((p) => `L${f(x(p.ts))} ${f(y(p.level))}`).join(" ") : "";
  const band = fcs.some((p) => p.low != null && p.high != null)
    ? `M${f(x(t1))} ${f(y(last[1]))} ` + fcs.map((p) => `L${f(x(p.ts))} ${f(y(p.high ?? p.level))}`).join(" ") + " " + [...fcs].reverse().map((p) => `L${f(x(p.ts))} ${f(y(p.low ?? p.level))}`).join(" ") + " Z"
    : "";
  return {
    first: y(hist[0][1]), last: y(last[1]), d, fc, band, has: true, now: [x(t1), y(last[1])], fcEndFrac: 1, histHours: 24, fcHours: fcs.length ? Math.round((tEnd - t1) / H) : 0,
    marks: near.map((m) => ({ ...m, y: y(m.y) })),
  };
}

export function ChartSvg({ plot, w, h, stroke, tier }: { plot: Plot; w: number; h: number; stroke: number; tier: PillTier }) {
  const col = TIER_COLOR[tier].bg;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg">
      {plot.marks.map((m) => (
        <line key={m.key} x1={0} x2={w} y1={m.y} y2={m.y} stroke={MARK_COLOR[m.key]} strokeWidth={Math.max(2, stroke / 2)} strokeDasharray="12 10" />
      ))}
      {plot.band && <path d={plot.band} fill="#0ea5e9" fillOpacity={0.18} />}
      {plot.fc && <path d={plot.fc} fill="none" stroke="#0ea5e9" strokeWidth={stroke} strokeDasharray={`${stroke * 2.2} ${stroke * 1.8}`} strokeLinecap="round" strokeLinejoin="round" />}
      <path d={plot.d} fill="none" stroke="#0369a1" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      {plot.now && <circle cx={Math.min(plot.now[0], w - stroke * 2)} cy={plot.now[1]} r={stroke * 2} fill={col} stroke="#ffffff" strokeWidth={stroke * 0.7} />}
    </svg>
  );
}
