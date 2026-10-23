// Small visual pieces shared by the reservoir pages. Server components, no JavaScript.
import type { RV, Status } from "@/lib/reservoirData";
import type { RT } from "@/lib/i18n/reservoirs";
import { SIZE_STEP, releaseSize, type ReleaseSize } from "@/lib/releaseUi";
import type { TFn } from "@/lib/i18n/translate";
import { useId } from "react";

export const fmt = (n: number) => n.toLocaleString("en-US");

const CHIP: Record<Status, string> = {
  spilling: "border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200",
  releasing: "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200",
  holding: "border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
  nodata: "border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400",
};
const DOT: Record<Status, string> = { spilling: "bg-amber-500", releasing: "bg-sky-500", holding: "bg-emerald-500", nodata: "bg-slate-300 dark:bg-slate-600" };

export function StatusChip({ status, rt }: { status: Status; rt: RT }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${CHIP[status]}`}>
      <span className={`size-1.5 rounded-full ${DOT[status]}`} aria-hidden />
      {rt(`s.${status}` as "s.spilling")}
    </span>
  );
}

/** Three bars, as on the home release rows. */
export function SizeBars({ step }: { step: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-end gap-px" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i === 1 ? "h-1.5" : i === 2 ? "h-2.5" : "h-3.5"} ${i <= step ? "bg-amber-600 dark:bg-amber-300" : "bg-slate-300 dark:bg-slate-700"}`} />
      ))}
    </span>
  );
}

/** Size word + bars for a river-bound release (not for routine canal outlets). */
export function SizeChip({ cusecs, t }: { cusecs: number; t: TFn }) {
  const size = releaseSize(cusecs);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 dark:border-amber-800 bg-white/60 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-900 dark:text-amber-200">
      <SizeBars step={SIZE_STEP[size]} />
      {t(`release.size.${size}`)}
    </span>
  );
}

/** Thin storage bar for list rows. */
export function MiniBar({ pct, stale }: { pct: number | null; stale?: boolean }) {
  if (pct == null) return <span className="block h-1.5 rounded-full border border-dashed border-slate-300 dark:border-slate-700" aria-hidden />;
  const w = Math.max(2, Math.min(100, pct));
  return (
    <span className="relative block h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-full ${stale ? "bg-slate-400 dark:bg-slate-600" : pct > 100 ? "bg-amber-500" : "bg-sky-500"}`} style={{ width: `${w}%` }} />
    </span>
  );
}

/**
 * Reservoir cross-section: the bank on the left, the dam wall on the right, water filled to the
 * level, a dashed line at full supply and, when spilling, a sheet of water over the crest and down
 * the dam face. `level` is the water level as a fraction of full supply (depth where we have it,
 * else storage). A schematic, not a survey. The overflow dashes stop under prefers-reduced-motion.
 */
export function Basin({ level, stale, spilling, rt, mini = false, label }: { level: number | null; stale: boolean; spilling: boolean; rt: RT; mini?: boolean; label?: string }) {
  const id = useId();
  const FY = 40; // full-supply line = dam crest
  const BOT = 120;
  const f = level == null ? 0 : Math.max(0, Math.min(1, level));
  const wy = BOT - (BOT - FY) * f;
  const water = stale ? "fill-slate-300 dark:fill-slate-600" : "fill-sky-300 dark:fill-sky-600";
  const surf = stale ? "stroke-slate-400 dark:stroke-slate-500" : "stroke-sky-400 dark:stroke-sky-400";
  const flow = stale ? "stroke-slate-300 dark:stroke-slate-600" : "stroke-sky-300 dark:stroke-sky-600";
  const bank = "M0 52 L30 58 L80 96 L130 116 L214 120 L234 40 L234 0 L0 0 Z";
  return (
    <svg
      viewBox="0 0 320 132"
      className={mini ? "w-24 shrink-0 h-auto" : "w-full h-auto"}
      role="img"
      aria-label={label ?? (level == null ? rt("tank.none") : rt("tank.aria", { n: Math.round(f * 100) }))}
    >
      <defs>
        <clipPath id={`${id}-pool`}><path d={bank} /></clipPath>
      </defs>
      {level != null && (
        <g clipPath={`url(#${id}-pool)`}>
          <rect x="0" y={wy} width="240" height={140 - wy} className={water} />
          <line x1="0" x2="240" y1={wy} y2={wy} strokeWidth="2" className={surf} />
        </g>
      )}
      {/* bank and dam */}
      <path d="M0 52 L30 58 L80 96 L130 116 L214 120 L214 132 L0 132 Z" className="fill-slate-200 dark:fill-slate-700" />
      <path d={`M214 120 L234 ${FY} L256 ${FY} L296 120 Z`} className="fill-slate-400 dark:fill-slate-500" />
      <path d="M296 120 L320 118 L320 132 L296 132 L214 132 L214 120 Z" className="fill-slate-200 dark:fill-slate-700" />
      {level == null && <path d={`M0 ${FY + 40} H234`} fill="none" strokeWidth="2" strokeDasharray="5 5" className="stroke-slate-300 dark:stroke-slate-600" />}
      {/* full supply */}
      <line x1="0" x2="234" y1={FY} y2={FY} strokeWidth="1.5" strokeDasharray="5 4" className="stroke-slate-500 dark:stroke-slate-400" />
      {!mini && (
        <text x="6" y={FY - 7} fontSize="13" fontWeight="500" className="fill-slate-600 dark:fill-slate-300">{rt("fullSupply")}</text>
      )}
      {spilling && (
        <g>
          <title>{rt("tank.spill")}</title>
          <path d={`M232 ${FY - 2} Q246 ${FY - 7} 258 ${FY - 1} L298 118`} fill="none" strokeWidth={mini ? 7 : 6} strokeLinecap="round" strokeLinejoin="round" className={flow} />
          <path d={`M246 ${FY - 4} L298 118`} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 9" className="rm-flow stroke-white dark:stroke-slate-100" opacity="0.9" />
          <path d="M296 118 q6 -6 12 0 t12 0" fill="none" strokeWidth="2" strokeLinecap="round" className={flow} />
        </g>
      )}
    </svg>
  );
}

/** Three-segment release size meter: segments up to the current size are filled. */
export function SizeMeter({ size, t, compact = false }: { size: ReleaseSize; t: TFn; compact?: boolean }) {
  const step = SIZE_STEP[size];
  const seg = (i: number) => (i <= step ? "bg-amber-500 dark:bg-amber-400" : "bg-slate-200 dark:bg-slate-700");
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 whitespace-nowrap" role="img" aria-label={t(`release.size.${size}`)}>
        <span className="inline-flex gap-0.5" aria-hidden>
          {[1, 2, 3].map((i) => <span key={i} className={`h-1.5 w-3.5 rounded-full ${seg(i)}`} />)}
        </span>
        {t(`release.size.${size}`)}
      </span>
    );
  }
  return (
    <div role="img" aria-label={t(`release.size.${size}`)} className="w-full">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => <span key={i} className={`h-2.5 flex-1 rounded-full ${seg(i)}`} />)}
      </div>
      <div className="mt-1 flex gap-1 text-[11px] leading-tight" aria-hidden>
        {(["small", "large", "veryLarge"] as const).map((s) => (
          <span key={s} className={`flex-1 ${s === "small" ? "text-left" : s === "large" ? "text-center" : "text-right"} ${s === size ? "font-semibold text-amber-900 dark:text-amber-200" : "text-slate-400 dark:text-slate-500"}`}>
            {t(`release.size.${s}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Water level as a fraction of full supply for the cross-section: depth against full-supply depth where the sheet has both, else storage %. */
export function levelOf(rv: RV): number | null {
  const sh = rv.sheet;
  let lv: number | null = null;
  if (sh && sh.depthFt != null && sh.fsdFt != null && sh.fsdFt > 0) lv = sh.depthFt / sh.fsdFt;
  else if (rv.storage) lv = rv.storage.pct / 100;
  if (lv != null && rv.status === "spilling" && rv.storage?.fresh !== false) lv = Math.max(lv, 0.97);
  return lv;
}
