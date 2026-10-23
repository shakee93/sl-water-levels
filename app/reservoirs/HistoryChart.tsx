// Release and water level over the days our archive covers. Plain SVG, no chart library.
// Points are our own checks of the daily reports (data branch), so a day with no change is a
// flat line, and the chart says plainly when the archive is still short.
import type { RV, SheetPt, WmsPt } from "@/lib/reservoirData";
import type { RT } from "@/lib/i18n/reservoirs";
import { shortDay, dayTick } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
import { fmt } from "./bits";

type P = { t: number; v: number };
const COLOMBO_MS = 5.5 * 3_600_000;
const DAY = 86_400_000;
const W = 600;
const L = 46;
const R = 10;

function step(pts: P[], x: (t: number) => number, y: (v: number) => number, end: number): string {
  if (!pts.length) return "";
  let d = `M${x(pts[0].t).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].v).toFixed(1)}`;
  return d + ` H${x(end).toFixed(1)}`;
}

export function HistoryChart({ rv, sheet, wms, firstDay, now, rt, t }: { rv: RV; sheet: SheetPt[]; wms: WmsPt[]; firstDay: string | null; now: number; rt: RT; t: TFn }) {
  const spill: P[] = sheet.flatMap((p) => (p.spill != null ? [{ t: p.t, v: p.spill }] : []));
  const sluice: P[] = sheet.flatMap((p) => (p.sluice != null ? [{ t: p.t, v: p.sluice }] : []));
  const down: P[] = wms.flatMap((p) => (p.discharge != null ? [{ t: p.t, v: p.discharge }] : []));
  const depth: P[] = sheet.flatMap((p) => (p.depthPct != null ? [{ t: p.t, v: p.depthPct }] : []));
  const stor: P[] = wms.flatMap((p) => (p.storagePct != null ? [{ t: p.t, v: p.storagePct }] : []));
  const rel = spill.length ? spill : down;
  const lvl = depth.length ? depth : stor;
  const lvlLabel = depth.length ? rt("chart.depth") : rt("chart.storage");
  const empty = rel.length === 0 && sluice.length === 0 && lvl.length === 0;

  const all = [...rel, ...sluice, ...lvl];
  const first = all.length ? Math.min(...all.map((p) => p.t)) : now;
  const t0 = Math.min(first - 2 * 3_600_000, now - DAY);
  const t1 = now;
  const x = (tm: number) => L + ((tm - t0) / (t1 - t0)) * (W - L - R);

  const relMax = Math.max(100, ...rel.map((p) => p.v), ...sluice.map((p) => p.v));
  const relTop = 12;
  const relBot = 100;
  const yr = (v: number) => relBot - (v / relMax) * (relBot - relTop);
  const lvTop = 122;
  const lvBot = 178;
  const lvMax = Math.max(100, ...lvl.map((p) => p.v));
  const yl = (v: number) => lvBot - (v / lvMax) * (lvBot - lvTop);

  // Colombo midnights as day ticks.
  const ticks: number[] = [];
  for (let d = Math.ceil((t0 + COLOMBO_MS) / DAY) * DAY - COLOMBO_MS; d <= t1; d += DAY) ticks.push(d);
  const skip = Math.ceil(ticks.length / 7);

  const note = empty ? rt("chart.none") : firstDay ? rt("chart.start", { date: `${shortDay(firstDay, t)} ${firstDay.slice(0, 4)}` }) : null;
  const axis = "stroke-slate-200 dark:stroke-slate-800";
  const txt = "fill-slate-500 dark:fill-slate-400";

  return (
    <div>
      <svg viewBox={`0 0 ${W} 214`} className="w-full h-auto" role="img" aria-label={rt("chart.title")}>
        <line x1={L} x2={W - R} y1={relBot} y2={relBot} className={axis} />
        <line x1={L} x2={W - R} y1={lvBot} y2={lvBot} className={axis} />
        {ticks.map((tm, i) => (
          <g key={tm}>
            <line x1={x(tm)} x2={x(tm)} y1={relTop} y2={lvBot} className={axis} strokeDasharray="2 3" />
            {i % skip === 0 && (
              <text x={x(tm)} y={206} textAnchor="middle" fontSize="13" className={txt}>{dayTick(tm + 12 * 3_600_000, t)}</text>
            )}
          </g>
        ))}
        <text x={L - 4} y={relTop + 4} textAnchor="end" fontSize="13" className={txt}>{fmt(Math.round(relMax))}</text>
        <text x={L - 4} y={relBot} textAnchor="end" fontSize="13" className={txt}>0</text>
        {lvl.length > 0 && (
          <>
            <line x1={L} x2={W - R} y1={yl(100)} y2={yl(100)} strokeDasharray="4 3" className="stroke-slate-400 dark:stroke-slate-500" />
            <text x={L - 4} y={yl(100) + 4} textAnchor="end" fontSize="13" className={txt}>{rt("chart.full")}</text>
          </>
        )}
        {rel.length > 0 && (
          <>
            <path d={`${step(rel, x, yr, t1)} V${relBot} H${x(rel[0].t)} Z`} className="fill-sky-400/25 dark:fill-sky-400/20" />
            <path d={step(rel, x, yr, t1)} fill="none" strokeWidth="2" className="stroke-sky-600 dark:stroke-sky-400" />
          </>
        )}
        {sluice.length > 0 && <path d={step(sluice, x, yr, t1)} fill="none" strokeWidth="1.5" strokeDasharray="5 3" className="stroke-slate-500 dark:stroke-slate-400" />}
        {lvl.length > 0 && <path d={step(lvl, x, yl, t1)} fill="none" strokeWidth="2" className="stroke-emerald-600 dark:stroke-emerald-400" />}
        {[...rel, ...lvl].map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={rel.includes(p) ? yr(p.v) : yl(p.v)} r="2.5" className={rel.includes(p) ? "fill-sky-600 dark:fill-sky-400" : "fill-emerald-600 dark:fill-emerald-400"} />
        ))}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        {rel.length > 0 && (
          <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-sky-600 dark:bg-sky-400" aria-hidden />{spill.length ? rt("spill") : rt("downstream")} · {rt("chart.release")}</li>
        )}
        {sluice.length > 0 && (
          <li className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-slate-500" aria-hidden />{rt("chart.outlets")}</li>
        )}
        {lvl.length > 0 && (
          <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-emerald-600 dark:bg-emerald-400" aria-hidden />{lvlLabel}</li>
        )}
      </ul>
      {note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
      <span className="sr-only">{rv.name}</span>
    </div>
  );
}
