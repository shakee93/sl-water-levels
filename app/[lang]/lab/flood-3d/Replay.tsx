"use client";
// "Replay Cyclone Ditwah" card for the flood test map: hour by hour, the river level at Nagalagam Street (tide smoothed) from 25 Nov to 8 Dec 2025,
// with the satellite rain for context. The map itself is drawn by Flood3dMap from the level this card sets. Data: /flood3d/ditwah.json (3 KB,
// loaded only when the replay is opened; built by scripts/flood3d/replay.py).
import { Pause, Play, X } from "lucide-react";
import { GLASS } from "./ui";
import type { Lang } from "./strings";

export type ReplayData = { start: number; hours: number; nag: number[]; han: number[]; rain: number[]; shots: { h: number; ev: string }[] };
type Tr = (en: string, vars?: Record<string, string | number>) => string;

const LOCALE: Record<Lang, string> = { en: "en-GB", si: "si-LK", ta: "ta-LK" };
const SHOT_WHEN: Record<string, string> = { "EMS 30 Nov 2025": "30 Nov, 11:09", "EMS 3 Dec 2025": "3 Dec, 12:36" };
export const shotWhen = (ev: string) => SHOT_WHEN[ev] ?? "";

export function replayTime(d: ReplayData, idx: number, lang: Lang): string {
  try {
    return new Date((d.start + Math.round(idx) * 3600) * 1000).toLocaleString(LOCALE[lang] ?? "en-GB", { timeZone: "Asia/Colombo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return ""; }
}

export function ReplayCard({ data, idx, setIdx, playing, setPlaying, onClose, tr, lang, near, top }: {
  data: ReplayData | null; idx: number; setIdx: (i: number) => void; playing: boolean; setPlaying: (p: boolean) => void; onClose: () => void; tr: Tr; lang: Lang; near: { h: number; ev: string } | null; top: number;
}) {
  const i = data ? Math.max(0, Math.min(data.hours - 1, Math.round(idx))) : 0;
  const peak = data ? data.nag.indexOf(Math.max(...data.nag)) : 0;
  const W = 300, Hh = 40;
  const chip = "rounded-full border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";
  let chart = null;
  if (data) {
    const lo = 1.5, hi = 9, x = (k: number) => (k / (data.hours - 1)) * W, y = (v: number) => Hh - 2 - ((v / 100 - lo) / (hi - lo)) * (Hh - 6);
    const line = data.nag.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)}`).join("");
    chart = (
      <svg viewBox={`0 0 ${W} ${Hh}`} className="mt-1 h-8 w-full sm:h-10" role="img" aria-label={tr("River level at Nagalagam Street, hour by hour, with rain")}>
        {data.rain.map((r, k) => (r > 0 ? <rect key={k} x={x(k) - 0.5} y={0} width={1.2} height={Math.min(14, r / 10 * 1.6)} fill="rgb(100,140,200)" opacity={0.55} /> : null))}
        <path d={line} fill="none" stroke="rgb(15,90,180)" strokeWidth={1.6} strokeLinejoin="round" />
        {data.shots.map((s) => <circle key={s.ev} cx={x(s.h)} cy={y(data.nag[Math.max(0, Math.min(data.hours - 1, s.h))])} r={2.6} fill="#fff" stroke="#4f46e5" strokeWidth={1.4} />)}
        <line x1={x(i)} x2={x(i)} y1={0} y2={Hh} stroke="rgb(220,38,38)" strokeWidth={1.2} />
      </svg>
    );
  }
  return (
    <div role="region" aria-label={tr("Replay Cyclone Ditwah")} className={`absolute z-20 rounded-xl p-3 text-xs ${GLASS}`} style={{ top, left: 12, right: 12, maxWidth: 360 }} data-testid="flood3d-replay">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{tr("Cyclone Ditwah, Nov 2025")}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{tr("River level hour by hour")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={tr("Close")} className="-mr-1 -mt-1 flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-800"><X className="size-4" aria-hidden /></button>
      </div>
      {!data ? <p className="py-3 text-slate-500">{tr("Loading the replay…")}</p> : (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-2" aria-live="off">
            <span className="text-sm font-semibold tabular-nums" data-testid="flood3d-replay-time">{replayTime(data, i, lang)}</span>
            <span className="tabular-nums">{tr("Nagalagam Street {ft} ft", { ft: (data.nag[i] / 100).toFixed(1) })}</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => { if (!playing && i >= data.hours - 1) setIdx(0); setPlaying(!playing); }} aria-label={playing ? tr("Pause") : tr("Play")} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2">
              {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            </button>
            <input type="range" min={0} max={data.hours - 1} step={1} value={i} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} aria-label={tr("Time")} aria-valuetext={replayTime(data, i, lang)} className="w-full accent-sky-600" />
          </div>
          {chart}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 pt-1.5 sm:flex-wrap sm:overflow-visible [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <button type="button" className={chip} onClick={() => { setPlaying(false); setIdx(data.hours > 60 ? 54 : 0); }}>{tr("Rain, 27 Nov")}</button>
            <button type="button" className={chip} onClick={() => { setPlaying(false); setIdx(peak); }}>{tr("River peak, 1 Dec")}</button>
            {data.shots.map((s) => <button key={s.ev} type="button" className={chip} onClick={() => { setPlaying(false); setIdx(s.h); }}>{tr("Satellite photo, {when}", { when: shotWhen(s.ev) })}</button>)}
          </div>
          {near ? (
            <p className="pt-1.5 text-[11px] leading-snug text-indigo-800 dark:text-indigo-200">{tr("The dashed outline is the real flood seen from space at {when}.", { when: shotWhen(near.ev) })}</p>
          ) : (
            <p className="hidden pt-1.5 text-[10px] leading-snug text-slate-500 sm:block dark:text-slate-400">{tr("Estimate from the river level. It was checked against satellite photos on 30 Nov, 2 Dec and 3 Dec; the hours between are our best guess. The water followed the river, not the local rain (blue bars).")}</p>
          )}
        </>
      )}
    </div>
  );
}
