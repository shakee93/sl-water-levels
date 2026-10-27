"use client";
// "Report here" sheet for the 3D flood test map. Fixed choices only (no free text), position and accuracy from the GPS spot or the dragged
// pin. The consent line is shown right above the Send button; the position is sent to our own /api/flood3d/report and kept private.
import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { preparePhoto, type Prepared } from "./photos";

export type RepPos = { lat: number; lon: number; src: "gps" | "pin"; acc: number | null };
export type CellInfo = { covered: boolean; shaded: boolean; cellFt: number | null };

const DEPTHS: [string, string][] = [["ankle", "Ankle deep"], ["knee", "Knee deep"], ["waist", "Waist deep"], ["above_waist", "Above waist"], ["house", "Water inside the house"]];
const EVENTS: [string, string][] = [["ditwah_2025", "Cyclone Ditwah, Nov–Dec 2025"], ["may_2016", "May 2016"], ["jun_2024", "June 2024"], ["other", "Another flood"]];
type Kind = "water_now" | "past_wet" | "past_dry";
const KINDS: [Kind, string][] = [["water_now", "Water here now"], ["past_wet", "Flooded here last time"], ["past_dry", "Stayed dry here in a flood"]];

const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 dark:border-slate-600"}`;

export function ReportPanel({ pos, cell, onClose, tr, lang, photosEnabled = false }: { photosEnabled?: boolean; pos: RepPos; cell: CellInfo; onClose: () => void; tr: (en: string, vars?: Record<string, string | number>) => string; lang: "en" | "si" | "ta" }) {
  const [opened] = useState(() => performance.now());
  const [kind, setKind] = useState<Kind | null>(null);
  const [depth, setDepth] = useState<string | null>(null);
  const [event, setEvent] = useState<string | null>(null);
  const [mapRight, setMapRight] = useState<string | null>(null);
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error" | "limit">("idle");
  const [area, setArea] = useState<{ name: string; n: number } | null>(null);

  const [photos, setPhotos] = useState<Prepared[]>([]);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setPhotoMsg(null);
    const next = [...photos];
    for (const f of Array.from(list)) {
      if (next.length >= 3) { setPhotoMsg(tr("Up to 3 photos.")); break; }
      try { next.push(await preparePhoto(f)); } catch (e) { setPhotoMsg(e instanceof Error && e.message === "size" ? tr("That photo is too large.") : tr("This photo format can't be read here. Please use a JPEG, PNG or WebP photo.")); }
    }
    setPhotos(next);
    if (fileRef.current) fileRef.current.value = "";
  };
  const needsDepth = kind === "water_now" || kind === "past_wet";
  const needsEvent = kind === "past_wet" || kind === "past_dry";
  const ready = Boolean(kind ? (!needsDepth || depth) && (!needsEvent || event) : mapRight);

  async function send() {
    setState("sending");
    try {
      const r = await fetch("/api/flood3d/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: typeof location !== "undefined" && new URLSearchParams(location.search).has("f3dtest"), kind: kind ?? "map_check", depth: needsDepth ? depth : undefined, event: needsEvent ? event : undefined, lat: pos.lat, lon: pos.lon, acc: pos.acc ?? undefined, src: pos.src, mapRight: mapRight ?? undefined, cellFt: cell.cellFt ?? undefined, lang, consent: true, hp, ms: performance.now() - opened }),
      });
      if (r.status === 429) return setState("limit");
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) return setState("error");
      setArea(j.area ?? null);
      // photos (optional) go after the report, with the short-lived token it returned; a failure never loses the report
      if (photos.length && j.photo && photosEnabled) {
        let sent = 0;
        for (const ph of photos) {
          try {
            const q = new URLSearchParams({ report: String(j.photo.id), tok: j.photo.token });
            if (ph.exifTime) q.set("et", ph.exifTime);
            if (ph.exifGps) q.set("eg", ph.exifGps);
            const pr = await fetch(`/api/flood3d/photo?${q}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: ph.blob });
            if (pr.ok) sent++;
          } catch { /* keep going */ }
        }
        if (sent < photos.length) setPhotoMsg(tr("Your report was saved, but {n} photo(s) could not be sent.", { n: photos.length - sent }));
      }
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div role="dialog" aria-label={tr("Report from this spot")} className="absolute inset-x-0 bottom-0 z-20 max-h-[78%] overflow-y-auto rounded-t-xl border-t border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{tr("Report from this spot")}</p>
        <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">{tr("Close")}</button>
      </div>
      {state === "done" ? (
        <div className="space-y-1 py-2">
          <p className="font-medium">{tr("Thank you. Your report will help improve the map.")}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{area ? tr("{n} reports so far around {area}.", { n: area.n, area: area.name === "Kelaniya" ? tr("Kelaniya") : area.name }) : tr("Reports are counted by area once there are at least 3.")} {tr("Your exact spot stays private.")}</p>
          <button type="button" onClick={onClose} className="mt-1 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white">{tr("Done")}</button>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-slate-600 dark:text-slate-400">{pos.src === "gps" ? (pos.acc ? tr("Using your location (accurate to about {m} m). Drag the pin if it is not the right spot.", { m: Math.round(pos.acc) }) : tr("Using your location. Drag the pin if it is not the right spot.")) : tr("Drag the pin to the right spot.")}</p>
          {!cell.covered && <p className="rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{tr("The map does not cover this area yet. Your report is still welcome and helps us decide where to extend it.")}</p>}
          <div className="flex flex-wrap gap-2">{KINDS.map(([k, label]) => <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => { setKind(k); setDepth(null); setEvent(null); }}>{tr(label)}</button>)}</div>
          {needsEvent && (
            <div className="space-y-1"><p className="text-xs font-medium">{tr("Which flood?")}</p><div className="flex flex-wrap gap-2">{EVENTS.map(([k, label]) => <button key={k} type="button" aria-pressed={event === k} className={chip(event === k)} onClick={() => setEvent(k)}>{tr(label)}</button>)}</div></div>
          )}
          {needsDepth && (
            <div className="space-y-1"><p className="text-xs font-medium">{kind === "water_now" ? tr("How deep is it?") : tr("Roughly how high did it get?")}</p><div className="flex flex-wrap gap-2">{DEPTHS.map(([k, label]) => <button key={k} type="button" aria-pressed={depth === k} className={chip(depth === k)} onClick={() => setDepth(k)}>{tr(label)}</button>)}</div></div>
          )}
          {cell.shaded && (
            <div className="space-y-1"><p className="text-xs font-medium">{tr("Is the map right here? (it shows water at this spot)")}</p><div className="flex flex-wrap gap-2">{([["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={mapRight === k} className={chip(mapRight === k)} onClick={() => setMapRight(mapRight === k ? null : k)}>{tr(label)}</button>)}</div></div>
          )}
          {photosEnabled && (
            <div className="space-y-1">
              <p className="text-xs font-medium">{tr("Add photos (optional)")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {photos.map((ph, i) => (
                  <span key={i} className="relative inline-block size-14 overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a site image */}
                    <img src={ph.previewUrl} alt="" className="size-full object-cover" />
                    <button type="button" aria-label={tr("Remove photo")} onClick={() => setPhotos(photos.filter((_, k) => k !== i))} className="absolute right-0 top-0 flex size-5 items-center justify-center rounded-bl-md bg-black/60 text-white"><X className="size-3" /></button>
                  </span>
                ))}
                {photos.length < 3 && (
                  <button type="button" onClick={() => fileRef.current?.click()} className="flex h-14 items-center gap-1.5 rounded-lg border border-dashed border-slate-400 px-3 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-500 dark:text-slate-200 dark:hover:bg-slate-800"><Camera className="size-4" aria-hidden />{tr("Add photo")}</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" aria-label={tr("Add photo")} onChange={(e) => void addFiles(e.target.files)} />
              </div>
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{tr("Photos help us check reports. They are kept private and never shown publicly without review. Avoid faces and number plates.")}</p>
              {photoMsg && <p className="text-xs text-red-700 dark:text-red-300">{photoMsg}</p>}
            </div>
          )}
          <input aria-hidden tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" name="website" />
          <p className="text-xs text-slate-600 dark:text-slate-400">{tr("Your exact spot is kept private and used only to improve the flood map. The public only ever sees counts for an area.")}</p>
          {state === "error" && <p className="text-xs text-red-700">{tr("The report could not be sent. Please try again in a minute.")}</p>}
          {state === "limit" && <p className="text-xs text-red-700">{tr("That is the daily limit for reports from one phone. Thank you for the ones you sent.")}</p>}
          <button type="button" disabled={!ready || state === "sending"} onClick={send} className="rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{state === "sending" ? tr("Sending…") : tr("Send report")}</button>
        </div>
      )}
    </div>
  );
}
