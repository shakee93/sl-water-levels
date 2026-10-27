"use client";
// "Report here" sheet for the 3D flood test map. Fixed choices only (no free text), position and accuracy from the GPS spot or the dragged
// pin. The consent line is shown right above the Send button; the position is sent to our own /api/flood3d/report and kept private.
import { useState } from "react";

export type RepPos = { lat: number; lon: number; src: "gps" | "pin"; acc: number | null };
export type CellInfo = { covered: boolean; shaded: boolean; cellFt: number | null };

const DEPTHS: [string, string][] = [["ankle", "Ankle deep"], ["knee", "Knee deep"], ["waist", "Waist deep"], ["above_waist", "Above waist"], ["house", "Water inside the house"]];
const EVENTS: [string, string][] = [["ditwah_2025", "Cyclone Ditwah, Nov–Dec 2025"], ["may_2016", "May 2016"], ["jun_2024", "June 2024"], ["other", "Another flood"]];
type Kind = "water_now" | "past_wet" | "past_dry";
const KINDS: [Kind, string][] = [["water_now", "Water here now"], ["past_wet", "Flooded here last time"], ["past_dry", "Stayed dry here in a flood"]];

const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 dark:border-slate-600"}`;

export function ReportPanel({ pos, cell, onClose }: { pos: RepPos; cell: CellInfo; onClose: () => void }) {
  const [opened] = useState(() => performance.now());
  const [kind, setKind] = useState<Kind | null>(null);
  const [depth, setDepth] = useState<string | null>(null);
  const [event, setEvent] = useState<string | null>(null);
  const [mapRight, setMapRight] = useState<string | null>(null);
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error" | "limit">("idle");
  const [area, setArea] = useState<{ name: string; n: number } | null>(null);

  const needsDepth = kind === "water_now" || kind === "past_wet";
  const needsEvent = kind === "past_wet" || kind === "past_dry";
  const ready = Boolean(kind ? (!needsDepth || depth) && (!needsEvent || event) : mapRight);

  async function send() {
    setState("sending");
    try {
      const r = await fetch("/api/flood3d/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: kind ?? "map_check", depth: needsDepth ? depth : undefined, event: needsEvent ? event : undefined, lat: pos.lat, lon: pos.lon, acc: pos.acc ?? undefined, src: pos.src, mapRight: mapRight ?? undefined, cellFt: cell.cellFt ?? undefined, lang: "en", consent: true, hp, ms: performance.now() - opened }),
      });
      if (r.status === 429) return setState("limit");
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) return setState("error");
      setArea(j.area ?? null);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div role="dialog" aria-label="Report from this spot" className="absolute inset-x-0 bottom-0 z-20 max-h-[78%] overflow-y-auto rounded-t-xl border-t border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">Report from this spot</p>
        <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Close</button>
      </div>
      {state === "done" ? (
        <div className="space-y-1 py-2">
          <p className="font-medium">Thank you. Your report will help improve the map.</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{area ? `${area.n} reports so far around ${area.name}.` : "Reports are counted by area once there are at least 3."} Your exact spot stays private.</p>
          <button type="button" onClick={onClose} className="mt-1 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white">Done</button>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-slate-600 dark:text-slate-400">{pos.src === "gps" ? `Using your location${pos.acc ? ` (accurate to about ${Math.round(pos.acc)} m)` : ""}. Drag the pin if it is not the right spot.` : "Drag the pin to the right spot."}</p>
          {!cell.covered && <p className="rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">The map does not cover this area yet. Your report is still welcome and helps us decide where to extend it.</p>}
          <div className="flex flex-wrap gap-2">{KINDS.map(([k, t]) => <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => { setKind(k); setDepth(null); setEvent(null); }}>{t}</button>)}</div>
          {needsEvent && (
            <div className="space-y-1"><p className="text-xs font-medium">Which flood?</p><div className="flex flex-wrap gap-2">{EVENTS.map(([k, t]) => <button key={k} type="button" aria-pressed={event === k} className={chip(event === k)} onClick={() => setEvent(k)}>{t}</button>)}</div></div>
          )}
          {needsDepth && (
            <div className="space-y-1"><p className="text-xs font-medium">{kind === "water_now" ? "How deep is it?" : "Roughly how high did it get?"}</p><div className="flex flex-wrap gap-2">{DEPTHS.map(([k, t]) => <button key={k} type="button" aria-pressed={depth === k} className={chip(depth === k)} onClick={() => setDepth(k)}>{t}</button>)}</div></div>
          )}
          {cell.shaded && (
            <div className="space-y-1"><p className="text-xs font-medium">Is the map right here? (it shows water at this spot)</p><div className="flex flex-wrap gap-2">{([["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={mapRight === k} className={chip(mapRight === k)} onClick={() => setMapRight(mapRight === k ? null : k)}>{t}</button>)}</div></div>
          )}
          <input aria-hidden tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" name="website" />
          <p className="text-xs text-slate-600 dark:text-slate-400">Your exact spot is kept private and used only to improve the flood map. The public only ever sees counts for an area.</p>
          {state === "error" && <p className="text-xs text-red-700">The report could not be sent. Please try again in a minute.</p>}
          {state === "limit" && <p className="text-xs text-red-700">That is the daily limit for reports from one phone. Thank you for the ones you sent.</p>}
          <button type="button" disabled={!ready || state === "sending"} onClick={send} className="rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{state === "sending" ? "Sending…" : "Send report"}</button>
        </div>
      )}
    </div>
  );
}
