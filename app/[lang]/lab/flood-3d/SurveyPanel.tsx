"use client";
// Flood survey sheet: "pin your spot, how deep did it get". Past floods only (mainly Cyclone Ditwah). Fixed choices and optional numbers,
// no free text, no names. Goes to the same private pipeline as "Report here" (POST /api/flood3d/report with survey: true): the exact spot
// stays private, the public sees only area counts of 3 or more. The map is an illustration; answers never feed an official step.
import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import type { CellInfo, RepPos } from "./ReportPanel";
import { EVENT_MONTHS, colomboMonth } from "@/lib/flood3dReports";

const EVENTS: [string, string][] = [["ditwah_2025", "Cyclone Ditwah, Nov–Dec 2025"], ["may_2016", "May 2016"], ["jun_2024", "June 2024"], ["other", "Another flood"]];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// the month a named flood starts in (Ditwah peaked on 1 Dec 2025 at Nagalagam, but many places flooded from late November)
const FIRST_MONTH: Record<string, string> = { ditwah_2025: "2025-11", may_2016: "2016-05", jun_2024: "2024-06" };
const lastDay = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
const LEVELS: [string, string, string][] = [["ankle", "Ankle", "about 10 cm / 4 in"], ["knee", "Knee", "about 45 cm / 1.5 ft"], ["waist", "Waist", "about 1 m / 3 ft"], ["chest", "Chest", "about 1.3 m / 4 ft"], ["head", "Above my head", "1.7 m / 5.5 ft or more"]];
const PARTS: [string, string][] = [["night", "Night"], ["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"]];

const chip = (on: boolean) => `min-h-9 rounded-full border px-3 py-1 text-xs ${on ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 dark:border-slate-600"}`;
const field = "h-9 w-24 rounded-md border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800";
const primary = "min-h-9 rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40";
const ghost = "min-h-9 rounded-md border border-slate-300 px-3 py-2 text-xs dark:border-slate-600";
const todayIso = () => new Date().toISOString().slice(0, 10);

export function SurveyPanel({ onSheet, pos, cell, onClose, onLocate, geoMsg, tr, lang }: { onSheet?: (px: number) => void; pos: RepPos; cell: CellInfo; onClose: () => void; onLocate: () => void; geoMsg: string | null; tr: (en: string, vars?: Record<string, string | number>) => string; lang: "en" | "si" | "ta" }) {
  const box = useRef<HTMLDivElement>(null);
  const [opened] = useState(() => performance.now());
  const [step, setStep] = useState(0);
  const [event, setEvent] = useState<string | null>(null);
  const [wet, setWet] = useState<boolean | null>(null);
  const [street, setStreet] = useState<string | null>(null);
  const [streetFt, setStreetFt] = useState("");
  const [inside, setInside] = useState<"no" | "yes" | null>(null);
  const [insideLevel, setInsideLevel] = useState<string | null>(null);
  const [insideFt, setInsideFt] = useState("");
  const [steps, setSteps] = useState("");
  const [day, setDay] = useState("");
  const [fYear, setFYear] = useState("");
  const [fMon, setFMon] = useState("");
  const [part, setPart] = useState<string | null>(null);
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error" | "limit">("idle");
  const [area, setArea] = useState<{ name: string; n: number } | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !onSheet || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => onSheet(el.offsetHeight));
    ro.observe(el);
    return () => { ro.disconnect(); onSheet(0); };
  }, [onSheet]);

  const last = wet === false ? 1 : 3;
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const shareUrl = () => `${location.origin}${lang === "en" ? "" : `/${lang}`}/flood-survey`;

  async function send() {
    setState("sending");
    try {
      const r = await fetch("/api/flood3d/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test: new URLSearchParams(location.search).has("f3dtest"), survey: true, kind: wet ? "past_wet" : "past_dry", event,
          streetLevel: wet ? street : undefined, streetFt: wet ? num(streetFt) : undefined, inside: wet ? inside ?? undefined : undefined,
          insideLevel: wet && inside === "yes" ? insideLevel ?? undefined : undefined, insideFt: wet && inside === "yes" ? num(insideFt) : undefined,
          steps: wet ? num(steps) : undefined, floodMonth, peakDay: wet && day && day.startsWith(floodMonth) ? day : undefined, peakPart: wet ? part ?? undefined : undefined,
          lat: pos.lat, lon: pos.lon, acc: pos.acc ?? undefined, src: pos.src, cellFt: cell.cellFt ?? undefined, lang, consent: true, hp, ms: performance.now() - opened,
        }),
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
  async function share() {
    const url = shareUrl(), text = tr("How deep did the flood get at your place? Pin your spot and tell us. It takes a minute and helps improve the flood map.");
    try {
      if (navigator.share) { await navigator.share({ title: tr("Flood survey"), text, url }); return; }
      await navigator.clipboard.writeText(url);
      setShareMsg(tr("Link copied"));
    } catch { /* cancelled, or no clipboard: the address is on the page */ setShareMsg(url); }
  }

  const floodMonth = fYear && fMon ? `${fYear}-${fMon}` : "";
  const nowMonth = colomboMonth();
  const monthOk = !!floodMonth && floodMonth <= nowMonth && (!event || !EVENT_MONTHS[event] || EVENT_MONTHS[event].includes(floodMonth));
  const dmin = floodMonth ? `${floodMonth}-01` : "2010-01-01";
  const dmax = floodMonth ? (lastDay(floodMonth) < todayIso() ? lastDay(floodMonth) : todayIso()) : todayIso();
  const pickEvent = (k: string) => { setEvent(k); const m = FIRST_MONTH[k]; if (m) { setFYear(m.slice(0, 4)); setFMon(m.slice(5, 7)); } else { setFYear(""); setFMon(""); } setDay(""); };
  const years = Array.from({ length: +nowMonth.slice(0, 4) - 2009 }, (_, i) => String(+nowMonth.slice(0, 4) - i));
  const nextOk = step === 0 ? true : step === 1 ? event != null && monthOk && wet != null : step === 2 ? street != null : true;
  const consent = <p className="text-xs text-slate-600 dark:text-slate-400">{tr("Your exact spot is kept private and used only to improve the flood map. The public only ever sees counts for an area.")}</p>;

  return (
    <div ref={box} role="dialog" aria-label={tr("Flood survey")} className="absolute inset-x-0 bottom-0 z-20 max-h-[62%] overflow-y-auto rounded-t-xl border-t border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{tr("How deep did it get?")}</p>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">{tr("Close")}</button>
      </div>
      {state === "done" ? (
        <div className="space-y-2 py-2" data-testid="survey-thanks">
          <p className="font-medium">{tr("Thank you. Your answer will help improve the map.")}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{area ? tr("{n} reports so far around {area}.", { n: area.n, area: area.name === "Kelaniya" ? tr("Kelaniya") : area.name }) : tr("Reports are counted by area once there are at least 3.")} {tr("Your exact spot stays private.")}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{tr("Know someone who was flooded? Send them the survey.")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void share()} className={`${primary} inline-flex items-center gap-1.5`}><Share2 className="size-3.5" aria-hidden />{tr("Share the survey")}</button>
            <button type="button" onClick={onClose} className={ghost}>{tr("Done")}</button>
          </div>
          {shareMsg && <p className="text-xs text-slate-600 dark:text-slate-400" role="status">{shareMsg}</p>}
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{tr("Step {n}", { n: step + 1 })}</p>
          {step === 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium">{tr("Put the pin on your house or street.")}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{pos.src === "gps" ? (pos.acc ? tr("Using your location (accurate to about {m} m). Drag the pin if it is not the right spot.", { m: Math.round(pos.acc) }) : tr("Using your location. Drag the pin if it is not the right spot.")) : tr("Tap the map or drag the pin to the right spot. Search a place or road above to find it.")}</p>
              {!cell.covered && <p className="rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{tr("The map does not cover this area yet. Your report is still welcome and helps us decide where to extend it.")}</p>}
              <div className="flex flex-wrap gap-2"><button type="button" className={ghost} onClick={onLocate}>{tr("I'm here now (use my location)")}</button></div>
              {geoMsg && <p className="text-xs text-slate-600 dark:text-slate-400" role="status">{geoMsg}</p>}
            </div>
          )}
          {step === 1 && (
            <div className="space-y-2">
              <div className="space-y-1"><p className="text-xs font-medium">{tr("Which flood?")}</p><div className="flex flex-wrap gap-2">{EVENTS.map(([k, l]) => <button key={k} type="button" aria-pressed={event === k} className={chip(event === k)} onClick={() => pickEvent(k)}>{tr(l)}</button>)}</div></div>
              {event && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">{tr("Month and year of this flood")}</p>
                  <div className="flex flex-wrap gap-2">
                    <select value={fMon} onChange={(e) => { setFMon(e.target.value); setDay(""); }} className={`${field} w-36`} aria-label={tr("Month")}><option value="">{tr("Month")}</option>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{tr(m)}</option>)}</select>
                    <select value={fYear} onChange={(e) => { setFYear(e.target.value); setDay(""); }} className={`${field} w-24`} aria-label={tr("Year")}><option value="">{tr("Year")}</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
                  </div>
                  {floodMonth && !monthOk && <p className="text-xs text-red-700 dark:text-red-300">{event && EVENT_MONTHS[event] ? tr("That month does not match this flood. Pick the month it happened in, or choose \"Another flood\".") : tr("Pick a month that has already happened.")}</p>}
                </div>
              )}
              <div className="space-y-1"><p className="text-xs font-medium">{tr("Did water reach here?")}</p><div className="flex flex-wrap gap-2">{([[true, "Yes"], [false, "No, it stayed dry"]] as const).map(([k, l]) => <button key={String(k)} type="button" aria-pressed={wet === k} className={chip(wet === k)} onClick={() => setWet(k)}>{tr(l)}</button>)}</div></div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-medium">{tr("At its deepest, how deep was the water on the street outside?")}</p>
                <div className="flex flex-wrap gap-2">{LEVELS.map(([k, l, h]) => <button key={k} type="button" aria-pressed={street === k} className={chip(street === k)} onClick={() => setStreet(k)} title={h}>{tr(l)} <span className="opacity-70">· {h}</span></button>)}</div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">{tr("Or a number in feet (optional)")}<input type="number" inputMode="decimal" min={0} max={20} step={0.1} value={streetFt} onChange={(e) => setStreetFt(e.target.value)} className={field} aria-label={tr("Street depth in feet")} /></label>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">{tr("Did water come inside the house?")} <span className="font-normal text-slate-500">({tr("optional")})</span></p>
                <div className="flex flex-wrap gap-2">{([["no", "No"], ["yes", "Yes"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={inside === k} className={chip(inside === k)} onClick={() => setInside(inside === k ? null : k)}>{tr(l)}</button>)}</div>
                {inside === "yes" && (
                  <>
                    <p className="pt-1 text-xs">{tr("How deep was it inside?")}</p>
                    <div className="flex flex-wrap gap-2">{LEVELS.slice(0, 4).map(([k, l]) => <button key={k} type="button" aria-pressed={insideLevel === k} className={chip(insideLevel === k)} onClick={() => setInsideLevel(k)}>{tr(l)}</button>)}</div>
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">{tr("Or a number in feet (optional)")}<input type="number" inputMode="decimal" min={0} max={15} step={0.1} value={insideFt} onChange={(e) => setInsideFt(e.target.value)} className={field} aria-label={tr("Depth inside in feet")} /></label>
                  </>
                )}
              </div>
              <label className="flex flex-wrap items-center gap-2 text-xs">{tr("The floor is how many steps above the road? (optional)")}<input type="number" inputMode="numeric" min={0} max={30} step={1} value={steps} onChange={(e) => setSteps(e.target.value)} className={field} aria-label={tr("Steps above the road")} /></label>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-2">
              <p className="text-xs font-medium">{tr("When was it deepest?")} <span className="font-normal text-slate-500">({tr("optional")})</span></p>
              <label className="flex items-center gap-2 text-xs">{tr("Day")}<input type="date" min={dmin} max={dmax} value={day} onChange={(e) => setDay(e.target.value)} className={`${field} w-40`} aria-label={tr("Day")} /></label>
              <div className="flex flex-wrap gap-2">{PARTS.map(([k, l]) => <button key={k} type="button" aria-pressed={part === k} className={chip(part === k)} onClick={() => setPart(part === k ? null : k)}>{tr(l)}</button>)}</div>
            </div>
          )}
          {step === last && consent}
          <input aria-hidden tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" name="website" />
          {state === "error" && <p className="text-xs text-red-700 dark:text-red-300">{tr("The report could not be sent. Please try again in a minute.")}</p>}
          {state === "limit" && <p className="text-xs text-red-700 dark:text-red-300">{tr("That is the daily limit for reports from one phone. Thank you for the ones you sent.")}</p>}
          <div className="flex gap-2 pt-1">
            {step > 0 && <button type="button" className={ghost} onClick={() => setStep((s) => (s === 3 ? 2 : s - 1))}>{tr("Back")}</button>}
            {step < last ? <button type="button" className={primary} disabled={!nextOk} onClick={() => setStep((s) => s + 1)}>{tr("Next")}</button> : <button type="button" className={primary} disabled={state === "sending" || !nextOk} onClick={send}>{state === "sending" ? tr("Sending…") : tr("Send")}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
