// Small visual pieces shared by the reservoir pages. Server components, no JavaScript.
import type { Status } from "@/lib/reservoirData";
import type { RT } from "@/lib/i18n/reservoirs";
import { SIZE_STEP, releaseSize } from "@/lib/releaseUi";
import type { TFn } from "@/lib/i18n/translate";

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

/** Tank graphic: water filled to the storage %, dashed line at full supply. */
export function Tank({ pct, stale, rt }: { pct: number | null; stale: boolean; rt: RT }) {
  const top = 14;
  const inner = 134;
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const wy = top + inner * (1 - p / 100);
  const water = stale ? "fill-slate-300 dark:fill-slate-700" : pct != null && pct > 100 ? "fill-amber-400" : "fill-sky-400 dark:fill-sky-500";
  return (
    <svg viewBox="0 0 150 156" className="w-28 sm:w-32 shrink-0" role="img" aria-label={pct == null ? rt("tank.none") : rt("tank.aria", { n: Math.round(pct) })}>
      <defs>
        <clipPath id="tank-clip"><rect x="10" y={top} width="130" height={inner} rx="10" /></clipPath>
      </defs>
      <rect x="10" y={top} width="130" height={inner} rx="10" className="fill-slate-50 dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" strokeDasharray={pct == null ? "5 4" : undefined} />
      {pct != null && (
        <g clipPath="url(#tank-clip)">
          <rect x="10" y={wy} width="130" height={160 - wy} className={water} opacity="0.9" />
        </g>
      )}
      <line x1="2" x2="148" y1={top} y2={top} strokeDasharray="4 3" strokeWidth="1.5" className="stroke-slate-500 dark:stroke-slate-400" />
      <text x="146" y={top - 3} textAnchor="end" className="fill-slate-500 dark:fill-slate-400" fontSize="9">{rt("fullSupply")}</text>
    </svg>
  );
}
