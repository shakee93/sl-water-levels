// "Where the water goes" for one reservoir: a vertical flow diagram. The reservoir at the top, the
// river gauges below it in the order the water reaches them (arrival time on each leg), the towns
// along the way and, when the last gauge is the river's last, the sea. While water is being
// released the path shows moving dashes. Plain SVG, no JavaScript; every gauge is a real link.
// Height follows the content. The width is fixed (360) so labels keep their size on a phone.
import Link from "next/link";
import type { RV, Status } from "@/lib/reservoirData";
import type { NationalStation } from "@/lib/arcgis";
import type { RT } from "@/lib/i18n/reservoirs";
import type { TFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import { stationPath } from "@/lib/slug";
import { tierLabel, TIER_HEX } from "@/app/tierUi";
import { fmt } from "./bits";
import { localName } from "./RvCard";

const W = 360;
const TX = 30; // trunk x
const CX = 58; // card x
const CW = W - CX - 4;

const STATUS_HEX: Record<Status, string> = { spilling: "#f59e0b", releasing: "#0ea5e9", holding: "#10b981", nodata: "#cbd5e1" };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const halo = "stroke-white dark:stroke-slate-900 [paint-order:stroke]";

type Row =
  | { k: "res" }
  | { k: "gauge"; g: RV["gauges"][number]; s: NationalStation | null }
  | { k: "town"; name: string }
  | { k: "sea" };

export function FlowDiagram({ rv, byStation, lang, t, rt, p, sea }: { rv: RV; byStation: Map<string, NationalStation>; lang: Locale; t: TFn; rt: RT; p: (x: string) => string; sea: boolean }) {
  const releasing = (rv.status === "spilling" || rv.status === "releasing") && !!rv.flow && rv.flow.kind !== "outlets";
  const gauges = [...rv.gauges].sort((a, b) => (a.eta ? a.eta[0] : 1e9) - (b.eta ? b.eta[0] : 1e9));
  const rows: Row[] = [{ k: "res" }];
  const seenTown = new Set<string>();
  for (const g of gauges) {
    rows.push({ k: "gauge", g, s: byStation.get(g.station) ?? null });
    const st = stationDisplayName(g.station);
    if (g.town && g.town !== st && !seenTown.has(g.town)) {
      seenTown.add(g.town);
      rows.push({ k: "town", name: g.town });
    }
  }
  if (sea) rows.push({ k: "sea" });

  // y of each row's centre
  const H: Record<Row["k"], number> = { res: 64, gauge: 56, town: 30, sea: 30 };
  const gapAfter = (prev: Row, next: Row) => (next.k === "gauge" ? 50 : next.k === "town" ? 16 : 22) + (prev.k === "res" ? 0 : 0);
  let y = 8;
  const pos: { row: Row; y0: number; cy: number }[] = [];
  rows.forEach((row, i) => {
    if (i > 0) y += gapAfter(rows[i - 1], row);
    pos.push({ row, y0: y, cy: y + H[row.k] / 2 });
    y += H[row.k];
  });
  const height = y + 8;
  const trunk = `M${TX} ${pos[0].cy} V${pos[pos.length - 1].cy}`;
  const latin = lang === "en";
  const cw = latin ? 7 : 7.6;

  const flowCls = "rm-flow stroke-amber-500 dark:stroke-amber-400";
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="mx-auto block w-full max-w-[460px] h-auto" role="group" aria-label={rt("down.listLabel")} style={{ fontSize: 14 }}>
      {/* the river path */}
      <path d={trunk} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-sky-200 dark:stroke-sky-900" aria-hidden />
      {releasing ? (
        <path d={trunk} fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1 10" className={flowCls} aria-hidden />
      ) : (
        <path d={trunk} fill="none" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" className="stroke-slate-400 dark:stroke-slate-500" aria-hidden />
      )}

      {pos.map(({ row, y0, cy }, i) => {
        if (row.k === "res") {
          const flowTxt = releasing ? `${rt(`s.${rv.status}` as "s.spilling")} · ${t("release.cusecs", { n: fmt(rv.flow!.cusecs) })}` : rt(`s.${rv.status}` as "s.spilling");
          return (
            <g key="res">
              <rect x={CX} y={y0} width={CW} height={H.res} rx="12" strokeWidth="2" className="fill-slate-50 dark:fill-slate-800/60 stroke-sky-600 dark:stroke-sky-400" />
              <circle cx={TX} cy={cy} r="17" fill={STATUS_HEX[rv.status]} className="stroke-white dark:stroke-slate-900" strokeWidth="3" />
              <path d={`M${TX - 8} ${cy + 1} q4 -4 8 0 t8 0 M${TX - 8} ${cy + 6} q4 -4 8 0 t8 0`} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              <text x={CX + 14} y={cy - 5} fontSize="16" fontWeight="600" className="fill-slate-900 dark:fill-slate-100">{clip(localName(rv, lang), 28)}</text>
              <text x={CX + 14} y={cy + 15} fontSize="13.5" className="fill-slate-600 dark:fill-slate-300">{clip(flowTxt, 38)}</text>
            </g>
          );
        }
        // the leg arriving at this row
        const prev = pos[i - 1];
        const leg = (() => {
          if (row.k !== "gauge") return null;
          const text = row.g.eta ? `${rt("down.arrives")} ${t("release.eta", { a: row.g.eta[0], b: row.g.eta[1] })}` : row.g.indirect ? rt("down.far") : rt("down.etaUnknown");
          const w = Math.min(CW, text.length * cw * 0.95 + 38);
          const my = (prev.y0 + H[prev.row.k] + y0) / 2;
          return (
            <g key={`leg-${i}`}>
              <rect x={CX} y={my - 12} width={w} height="24" rx="12" className={row.g.eta ? "fill-sky-50 dark:fill-sky-950 stroke-sky-300 dark:stroke-sky-800" : "fill-white dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-600"} strokeWidth="1.2" strokeDasharray={row.g.eta ? undefined : "3 3"} />
              <circle cx={CX + 13} cy={my} r="6" fill="none" strokeWidth="1.5" className="stroke-slate-500 dark:stroke-slate-400" />
              <path d={`M${CX + 13} ${my - 3} V${my} H${CX + 16}`} fill="none" strokeWidth="1.5" strokeLinecap="round" className="stroke-slate-500 dark:stroke-slate-400" />
              <text x={CX + 26} y={my + 4.5} fontSize="13" fontWeight="500" className="fill-slate-700 dark:fill-slate-200">{text}</text>
            </g>
          );
        })();

        if (row.k === "gauge") {
          const name = stationDisplayName(row.g.station);
          const s = row.s;
          const tier = s?.tier ?? "none";
          const lvl = s && s.latest?.water_level != null && s.tier !== "stale" ? formatLevel(s.latest.water_level, s.unit) : null;
          const sub = s ? [tierLabel(t, s.tier), lvl].filter(Boolean).join(" · ") : rt("down.noReading");
          return (
            <g key={`g-${i}`}>
              {leg}
              <Link href={p(stationPath(row.g.basin, row.g.station))} aria-label={`${name}, ${sub}`} className="outline-none group cursor-pointer">
                <rect x={CX} y={y0} width={CW} height={H.gauge} rx="12" strokeWidth="1.5" className="fill-slate-50 dark:fill-slate-800/60 stroke-slate-200 dark:stroke-slate-700 group-hover:stroke-sky-400 group-focus-visible:stroke-sky-600 group-focus-visible:[stroke-width:2.5]" />
                <circle cx={TX} cy={cy} r="11" fill={TIER_HEX[tier]} className="stroke-white dark:stroke-slate-900" strokeWidth="3" />
                <text x={CX + 14} y={cy - 4} fontSize="15.5" fontWeight="600" className="fill-slate-900 dark:fill-slate-100">{clip(name, 28)}</text>
                <text x={CX + 14} y={cy + 14} fontSize="13.5" className="fill-slate-600 dark:fill-slate-300">{clip(sub, 38)}</text>
              </Link>
            </g>
          );
        }
        if (row.k === "town") {
          return (
            <g key={`t-${i}`} aria-hidden={false}>
              <circle cx={TX} cy={cy} r="6" strokeWidth="2.2" className="fill-white dark:fill-slate-900 stroke-slate-500 dark:stroke-slate-400" />
              <text x={CX + 2} y={cy + 5} fontSize="14.5" fontWeight="500" strokeWidth="3" className={`fill-slate-700 dark:fill-slate-200 ${halo}`}>{clip(row.name, 34)}</text>
            </g>
          );
        }
        return (
          <g key="sea">
            <path d={`M${TX - 9} ${cy - 2} q4.5 -5 9 0 t9 0 M${TX - 9} ${cy + 5} q4.5 -5 9 0 t9 0`} fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-sky-600 dark:stroke-sky-400" />
            <text x={CX + 2} y={cy + 5} fontSize="14.5" fontStyle="italic" fontWeight="500" className="fill-sky-800 dark:fill-sky-300">{rt("down.sea")}</text>
          </g>
        );
      })}
    </svg>
  );
}
