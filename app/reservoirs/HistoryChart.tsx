// Release and water level over the days our archive covers. Plain SVG, no chart library.
// Points are our own checks of the daily reports (data branch). One value per day (the last
// check of the day). Until three days exist there is nothing to draw a trend from, so the card
// says so and lists the days we do have as small fixed-width tiles instead of a stretched chart.
import type { RV, SheetPt, WmsPt } from "@/lib/reservoirData";
import type { RT } from "@/lib/i18n/reservoirs";
import { shortDay, dayTick } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
import { fmt } from "./bits";

const COLOMBO_MS = 5.5 * 3_600_000;
const DAY = 86_400_000;
const MIN_DAYS = 3;
const MAX_DAYS = 14;
const dayOf = (ms: number) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);
const noon = (iso: string) => Date.parse(iso + "T06:00:00Z");

type Day = { day: string; rel: number | null; sluice: number | null; lvl: number | null };

export function HistoryChart({ rv, sheet, wms, firstDay, now, rt, t }: { rv: RV; sheet: SheetPt[]; wms: WmsPt[]; firstDay: string | null; now: number; rt: RT; t: TFn }) {
  const useSheet = sheet.some((p) => p.spill != null);
  const lvlIsDepth = sheet.some((p) => p.depthPct != null);
  const by = new Map<string, Day>();
  const slot = (d: string) => {
    let x = by.get(d);
    if (!x) by.set(d, (x = { day: d, rel: null, sluice: null, lvl: null }));
    return x;
  };
  for (const p of [...sheet].sort((a, b) => a.t - b.t)) {
    const d = slot(dayOf(p.t));
    if (p.spill != null) d.rel = p.spill;
    if (p.sluice != null) d.sluice = p.sluice;
    if (lvlIsDepth && p.depthPct != null) d.lvl = p.depthPct;
  }
  for (const p of [...wms].sort((a, b) => a.t - b.t)) {
    const d = slot(dayOf(p.t));
    if (!useSheet && p.discharge != null) d.rel = p.discharge;
    if (!lvlIsDepth && p.storagePct != null) d.lvl = p.storagePct;
  }
  const have = [...by.values()].filter((d) => d.rel != null || d.sluice != null || d.lvl != null).sort((a, b) => a.day.localeCompare(b.day));
  const startNote = firstDay ? rt("chart.start", { date: `${shortDay(firstDay, t)} ${firstDay.slice(0, 4)}` }) : null;
  const lvlLabel = lvlIsDepth ? rt("chart.depth") : rt("chart.stor");
  const relLabel = useSheet ? rt("spill") : rt("downstream");

  if (have.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">{rt("chart.none")}</p>;

  if (have.length < MIN_DAYS) {
    return (
      <div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{rt("chart.wait", { date: shortDay(firstDay ?? have[0].day, t) })}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {have.map((d) => (
            <li key={d.day} className="w-28 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{dayTick(noon(d.day), t)}</p>
              <p className="mt-1 text-sm tabular-nums">{d.lvl != null ? `${Math.round(d.lvl)}%` : <span className="text-slate-400">{rt("noData")}</span>}</p>
              <span className="mt-1 block h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
                <span className="block h-full rounded-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${Math.max(3, Math.min(100, d.lvl ?? 0))}%` }} />
              </span>
              <p className="mt-1.5 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                {d.rel != null ? `${fmt(d.rel)} ${t("release.cusecs", { n: "" }).trim()}` : <span className="text-slate-400">{rt("noData")}</span>}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{lvlLabel} · {relLabel}</p>
      </div>
    );
  }

  // Every calendar day from the first to the last we have (a day without a check stays empty).
  const last = have[have.length - 1].day;
  const days: Day[] = [];
  const from = Math.max(noon(have[0].day), noon(last) - (MAX_DAYS - 1) * DAY);
  for (let ms = from; ms <= noon(last); ms += DAY) {
    const d = new Date(ms).toISOString().slice(0, 10);
    days.push(by.get(d) ?? { day: d, rel: null, sluice: null, lvl: null });
  }
  void now;

  const W = 380;
  const L = 36;
  const R = 8;
  const n = days.length;
  const sw = (W - L - R) / n;
  const cx = (i: number) => L + sw * (i + 0.5);
  const lvTop = 16;
  const lvBot = 92;
  const lvMax = Math.max(100, ...days.map((d) => d.lvl ?? 0));
  const yl = (v: number) => lvBot - (v / lvMax) * (lvBot - lvTop);
  const rbTop = 116;
  const rbBot = 176;
  const relMax = Math.max(100, ...days.map((d) => (d.rel ?? 0) + (d.sluice ?? 0)));
  const yr = (v: number) => rbBot - (v / relMax) * (rbBot - rbTop);
  const bw = Math.min(26, sw * 0.62);
  const every = n > 10 ? 2 : 1;
  const axis = "stroke-slate-200 dark:stroke-slate-700";
  const txt = "fill-slate-500 dark:fill-slate-400";

  const pts = days.flatMap((d, i) => (d.lvl != null ? [{ x: cx(i), y: yl(d.lvl) }] : []));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");

  return (
    <div>
      <svg viewBox={`0 0 ${W} 214`} className="w-full h-auto" role="img" aria-label={`${rt("chart.title")}: ${lvlLabel}, ${rt("chart.bars")}`}>
        {/* storage panel */}
        {[0, 50].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={yl(v)} y2={yl(v)} className={axis} />
            <text x={L - 5} y={yl(v) + 4} textAnchor="end" fontSize="12" className={txt}>{v}%</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={yl(100)} y2={yl(100)} strokeWidth="1.5" strokeDasharray="5 4" className="stroke-slate-500 dark:stroke-slate-400" />
        <text x={L - 5} y={yl(100) + 4} textAnchor="end" fontSize="12" className={txt}>100%</text>
        <text x={W - R} y={yl(100) - 5} textAnchor="end" fontSize="12" fontWeight="500" className="fill-slate-600 dark:fill-slate-300">{rt("chart.fullLine")}</text>
        {pts.length > 1 && <path d={line} fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="stroke-emerald-600 dark:stroke-emerald-400" />}
        {/* release panel */}
        <line x1={L} x2={W - R} y1={rbBot} y2={rbBot} className={axis} />
        <text x={L - 5} y={rbBot + 4} textAnchor="end" fontSize="12" className={txt}>0</text>
        <text x={L - 5} y={rbTop + 8} textAnchor="end" fontSize="12" className={txt}>{relMax >= 10_000 ? `${Math.round(relMax / 1000)}k` : fmt(Math.round(relMax))}</text>
        {days.map((d, i) => {
          const sl = d.sluice ?? 0;
          const rl = d.rel ?? 0;
          return (
            <g key={d.day}>
              {sl > 0 && <rect x={cx(i) - bw / 2} y={yr(sl)} width={bw} height={rbBot - yr(sl)} rx="2" className="fill-slate-400 dark:fill-slate-500" />}
              {rl > 0 && <rect x={cx(i) - bw / 2} y={yr(sl + rl)} width={bw} height={yr(sl) - yr(sl + rl)} rx="2" className="fill-sky-500 dark:fill-sky-400" />}
              {d.lvl != null && <circle cx={cx(i)} cy={yl(d.lvl)} r="3.5" strokeWidth="1.5" className="fill-emerald-600 dark:fill-emerald-400 stroke-white dark:stroke-slate-900" />}
              {i % every === (n - 1) % every && (
                <text x={cx(i)} y={202} textAnchor="middle" fontSize="12" className={txt}>{dayTick(noon(d.day), t)}</text>
              )}
              <rect x={L + sw * i} y={lvTop - 6} width={sw} height={rbBot - lvTop + 6} fill="transparent">
                <title>{[
                  dayTick(noon(d.day), t),
                  d.lvl != null ? `${lvlLabel}: ${Math.round(d.lvl)}%` : null,
                  d.rel != null ? `${relLabel}: ${t("release.cusecs", { n: fmt(d.rel) })}` : null,
                  d.sluice != null ? `${rt("outlets")}: ${t("release.cusecs", { n: fmt(d.sluice) })}` : null,
                ].filter(Boolean).join(" · ")}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-emerald-600 dark:bg-emerald-400" aria-hidden />{lvlLabel}</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-sky-500 dark:bg-sky-400" aria-hidden />{relLabel} · {rt("chart.release")}</li>
        {days.some((d) => (d.sluice ?? 0) > 0) && <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-slate-400" aria-hidden />{rt("chart.outlets")}</li>}
      </ul>
      {startNote && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{startNote}</p>}
      <span className="sr-only">{rv.name}</span>
    </div>
  );
}
