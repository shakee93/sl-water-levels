// "Where the water goes" for one reservoir: a horizontal flow strip that runs the SAME way as the map
// above it. Reading order for screen readers is reservoir -> gauges -> sea (an ordered list); on screen
// the strip is mirrored (flex-row-reverse) when the water flows west on the map, so the sea sits on the
// left exactly as it does there. The arrival time sits on the connector between two cards; while water
// is being released the connectors carry moving dashes. No JavaScript; every gauge is a real link.
// On a phone the strip scrolls sideways (snap, faded edges), never down, so the direction never changes.
import Link from "next/link";
import { Clock, Waves } from "lucide-react";
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

const STATUS_HEX: Record<Status, string> = { spilling: "#f59e0b", releasing: "#0ea5e9", holding: "#10b981", nodata: "#cbd5e1" };

const CARD = "relative flex min-h-[84px] w-[152px] shrink-0 snap-center flex-col justify-center gap-0.5 rounded-xl border-[1.5px] bg-slate-50 dark:bg-slate-800/60 px-3 py-2 sm:w-auto sm:min-w-[144px] sm:flex-1";

/** The line between two cards. The dashes move from the card on the reservoir side towards the sea. */
function Connector({ children, flowing, west }: { children?: React.ReactNode; flowing: boolean; west: boolean }) {
  return (
    <div className="flex min-w-[76px] shrink-0 flex-col items-center justify-center gap-1 px-1 sm:min-w-[84px] sm:flex-[0.7]" aria-hidden={children ? undefined : true}>
      {children}
      <div className={`flex w-full items-center ${west ? "-scale-x-100" : ""}`} aria-hidden>
        <svg className="h-2 w-0 min-w-0 flex-1 overflow-visible" height="8">
          <line x1="0" y1="4" x2="100%" y2="4" strokeWidth="6" strokeLinecap="round" className="stroke-sky-200 dark:stroke-sky-900" />
          {flowing ? (
            <line x1="0" y1="4" x2="100%" y2="4" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1 10" className="rm-flow stroke-amber-500 dark:stroke-amber-400" />
          ) : (
            <line x1="0" y1="4" x2="100%" y2="4" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 6" className="stroke-slate-400 dark:stroke-slate-500" />
          )}
        </svg>
        <svg width="9" height="12" viewBox="0 0 9 12" className="shrink-0 -ml-1"><path d="M1 1 L8 6 L1 11" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="stroke-sky-500 dark:stroke-sky-400" /></svg>
      </div>
    </div>
  );
}

export function FlowDiagram({ rv, byStation, lang, t, rt, p, sea, flowsWest }: { rv: RV; byStation: Map<string, NationalStation>; lang: Locale; t: TFn; rt: RT; p: (x: string) => string; sea: boolean; flowsWest: boolean }) {
  const releasing = (rv.status === "spilling" || rv.status === "releasing") && !!rv.flow && rv.flow.kind !== "outlets";
  const gauges = [...rv.gauges].sort((a, b) => (a.eta ? a.eta[0] : 1e9) - (b.eta ? b.eta[0] : 1e9));
  const seenTown = new Set<string>();
  const flowTxt = releasing ? t("release.cusecs", { n: fmt(rv.flow!.cusecs) }) : null;

  const dir = flowsWest ? "flex-row-reverse" : "flex-row";
  return (
    <div className="relative">
      <ol
        aria-label={rt("down.listLabel")}
        className={`flex items-stretch overflow-x-auto snap-x snap-proximity pb-1 [scrollbar-width:thin] max-w-full max-sm:[mask-image:linear-gradient(to_right,transparent,#000_14px,#000_calc(100%-14px),transparent)] ${flowsWest ? "flex-row-reverse" : "flex-row"}`}
      >
        <li className="flex shrink-0 items-stretch sm:flex-1">
          <div className={`${CARD} border-sky-600 dark:border-sky-400`}>
            <div className="flex items-center gap-1.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full" style={{ background: STATUS_HEX[rv.status] }} aria-hidden><Waves className="size-3.5 text-white" /></span>
              <span className="min-w-0 break-words text-[14.5px] font-semibold leading-tight text-slate-900 dark:text-slate-100">{localName(rv, lang)}</span>
            </div>
            <span className="text-[13px] leading-tight text-slate-600 dark:text-slate-300">{rt(`s.${rv.status}` as "s.spilling")}</span>
            {flowTxt && <span className="text-[13px] font-medium leading-tight tabular-nums text-slate-700 dark:text-slate-200">{flowTxt}</span>}
          </div>
        </li>

        {gauges.map((g) => {
          const s = byStation.get(g.station) ?? null;
          const name = stationDisplayName(g.station);
          const tier = s?.tier ?? "none";
          const lvl = s && s.latest?.water_level != null && s.tier !== "stale" ? formatLevel(s.latest.water_level, s.unit) : null;
          const status = s ? tierLabel(t, s.tier) : rt("down.noReading");
          const town = g.town && g.town !== name && !seenTown.has(g.town) ? g.town : null;
          if (town) seenTown.add(town);
          const eta = g.eta ? t("release.eta", { a: g.eta[0], b: g.eta[1] }) : null;
          const etaFull = eta ? `${rt("down.arrives")} ${eta}` : g.indirect ? rt("down.far") : rt("down.etaUnknown");
          return (
            <li key={g.station} className={`flex shrink-0 items-stretch sm:flex-[1.6] ${dir}`}>
              <Connector flowing={releasing} west={flowsWest}>
                <span
                  title={etaFull}
                  className={`inline-flex max-w-[110px] items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-center text-[12px] font-medium leading-tight sm:max-w-[150px] whitespace-nowrap ${eta ? "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 text-slate-700 dark:text-slate-200" : "border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
                >
                  {eta ? <Clock className="size-3 shrink-0" aria-hidden /> : null}
                  <span className="tabular-nums" aria-hidden={eta ? undefined : true}>{eta ?? (g.indirect ? rt("down.shortFar") : rt("down.short"))}</span>
                  <span className="sr-only">{eta ? rt("down.arrives") : etaFull}</span>
                </span>
              </Connector>
              <Link
                href={p(stationPath(g.basin, g.station))}
                aria-label={`${name}, ${status}${lvl ? ` ${lvl}` : ""}${town ? `, ${town}` : ""}`}
                className={`${CARD} sm:w-auto border-slate-200 dark:border-slate-700 outline-none hover:border-sky-400 focus-visible:border-sky-600 focus-visible:ring-2 focus-visible:ring-sky-500`}
               
              >
                <span className="flex items-center gap-1.5">
                  <span className="size-3.5 shrink-0 rounded-full border-2 border-white dark:border-slate-900 shadow-[0_0_0_1px_rgba(100,116,139,.35)]" style={{ background: TIER_HEX[tier] }} aria-hidden />
                  <span className="min-w-0 break-words text-[14.5px] font-semibold leading-tight text-slate-900 dark:text-slate-100">{name}</span>
                </span>
                <span className="text-[13px] leading-tight text-slate-600 dark:text-slate-300">{status}</span>
                {lvl && <span className="text-[14px] font-semibold leading-tight tabular-nums text-slate-800 dark:text-slate-100">{lvl}</span>}
                {town && <span className="mt-0.5 text-[12px] leading-tight text-slate-500 dark:text-slate-400">{town}</span>}
              </Link>
            </li>
          );
        })}

        {sea && (
          <li className={`flex shrink-0 items-stretch sm:flex-none ${dir}`}>
            <Connector flowing={releasing} west={flowsWest} />
            <div className="flex min-h-[84px] w-[84px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-sky-200 bg-sky-50 px-2 dark:border-sky-800 dark:bg-sky-950/60 sm:w-[110px]">
              <Waves className="size-6 text-sky-600 dark:text-sky-400" aria-hidden />
              <span className="text-[14px] font-medium italic text-sky-800 dark:text-sky-300">{rt("down.sea")}</span>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}
