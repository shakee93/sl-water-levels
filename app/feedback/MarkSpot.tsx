"use client";
// "Flooded where you are? Mark it on the map": a mini version of the flood survey inside the "Is this right?" card. Only the "now" questions
// (water here right now? how deep on the street? inside the house?) and a small map for the pin. Nothing of the map loads until the visitor opens
// this step: the map component, MapLibre and the base style are fetched then, never on page load. Sends exactly what the survey's "now" answers
// send (POST /api/flood3d/report, survey: true, water_now / dry_now) through the same helper. The exact spot stays private (area counts of 3 or
// more are all the public sees). Official steps and verdicts never read it.
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CircleCheck, LocateFixed, MapPinned, Map as MapIcon, X } from "lucide-react";
import type { FT, FKey } from "@/lib/i18n/feedback";
import { BOUNDS, colomboMonth } from "@/lib/flood3dReports";
import { LEVELS, postSurveyReport } from "@/app/[lang]/lab/flood-3d/surveyShared";
import { trackEvent } from "@/lib/umami";

const MiniPickMap = dynamic(() => import("@/app/[lang]/lab/flood-3d/MiniPickMap"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">…</div>,
});

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const chip = (on: boolean) =>
  `inline-flex items-center min-h-11 rounded-full border px-4 text-sm transition ${ring} ${
    on ? "border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-950 dark:text-sky-100" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
  }`;

type Pos = { lat: number; lon: number; acc: number | null; src: "gps" | "pin" };
const inBounds = (lat: number, lon: number) => lat >= BOUNDS.south && lat <= BOUNDS.north && lon >= BOUNDS.west && lon <= BOUNDS.east;

export function MarkSpot({ ft, lang, lat, lon, page, target }: { ft: FT; lang: "en" | "si" | "ta"; lat: number; lon: number; page: string; target: string }) {
  const [open, setOpen] = useState(false);
  const opened = useRef(0);
  const [pos, setPos] = useState<Pos | null>(null);
  const [geo, setGeo] = useState<"idle" | "busy" | "off" | "out">("idle");
  const [mapFail, setMapFail] = useState(false);
  const [wet, setWet] = useState<boolean | null>(null);
  const [street, setStreet] = useState<string | null>(null);
  const [inside, setInside] = useState<"no" | "yes" | null>(null);
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error" | "limit">("idle");

  const locate = () => {
    if (!navigator.geolocation) return setGeo("off");
    setGeo("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude: la, longitude: lo, accuracy } = p.coords;
        if (!inBounds(la, lo)) return setGeo("out");
        setGeo("idle");
        setPos({ lat: la, lon: lo, acc: accuracy, src: "gps" });
      },
      () => setGeo("off"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  async function send() {
    if (!pos || wet == null || (wet && !street)) return;
    setState("sending");
    const res = await postSurveyReport({
      kind: wet ? "water_now" : "dry_now", floodMonth: colomboMonth(),
      streetLevel: wet ? street : undefined, inside: wet ? inside ?? undefined : undefined,
      lat: pos.lat, lon: pos.lon, acc: pos.acc ?? undefined, src: pos.src, lang, consent: true, hp, ms: performance.now() - opened.current,
    });
    if (res.state === "done") trackEvent("feedback_spot_sent", { page, target, wet: wet ? "yes" : "no", how: pos.src });
    setState(res.state);
  }

  if (state === "done") {
    const href = `${lang === "en" ? "" : `/${lang}`}/flood-map?ll=${pos!.lon.toFixed(4)},${pos!.lat.toFixed(4)},16.5,55`;
    return (
      <div className="mt-4 border-t border-sky-200 pt-4 text-sm text-slate-800 dark:border-sky-900 dark:text-slate-200" role="status" data-testid="spot-thanks">
        <p className="flex items-start gap-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> {ft("fb.spotThanks")}</p>
        <a href={href} className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-sky-600 px-4 text-sm font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40 ${ring}`}>
          <MapIcon className="size-4" aria-hidden /> {ft("fb.spotMap")}
        </a>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-4 border-t border-sky-200 pt-3 dark:border-sky-900">
        <button
          type="button"
          onClick={() => { opened.current = performance.now(); setOpen(true); trackEvent("feedback_spot_open", { page, target }); }}
          className={`inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-left text-sm font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950 dark:text-sky-300 dark:hover:text-sky-100 ${ring}`}
        >
          <MapPinned className="size-4 shrink-0" aria-hidden /> {ft("fb.spotLink")}
        </button>
      </div>
    );
  }

  const sendable = !!pos && wet != null && (!wet || !!street);
  return (
    <div className="mt-4 border-t border-sky-200 pt-4 text-sm text-slate-800 dark:border-sky-900 dark:text-slate-200" role="group" aria-label={ft("fb.spotTitle")}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{ft("fb.spotTitle")}</p>
        <button type="button" onClick={() => setOpen(false)} className={`-mt-1 inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 ${ring}`}>
          <X className="size-3.5" aria-hidden /> {ft("fb.spotClose")}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{ft("fb.spotTap")}</p>
      <div role="region" aria-label={ft("fb.spotMapLabel")} className="mt-2 h-[260px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60">
        {mapFail ? (
          <p className="p-4 text-sm text-slate-600 dark:text-slate-400">{ft("fb.spotMapFail")}</p>
        ) : (
          <MiniPickMap
            center={[lon, lat]}
            pos={pos}
            onPick={(la, lo) => { if (inBounds(la, lo)) setPos({ lat: la, lon: lo, acc: null, src: "pin" }); }}
            help={{ win: ft("fb.spotGWin"), mac: ft("fb.spotGMac"), mobile: ft("fb.spotGMob") }}
            onFail={() => setMapFail(true)}
          />
        )}
      </div>
      <button type="button" onClick={locate} disabled={geo === "busy"} className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800 ${ring}`}>
        <LocateFixed className="size-4 shrink-0" aria-hidden /> {geo === "busy" ? ft("fb.spotLocBusy") : ft("fb.spotLoc")}
      </button>
      {(geo === "off" || geo === "out") && <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400" role="status">{ft(geo === "off" ? "fb.spotLocOff" : "fb.spotLocOut")}</p>}

      {pos ? (
        <div className="mt-4 space-y-4">
          <div role="group" aria-label={ft("fb.spotWet")}>
            <p className="mb-1.5 font-medium">{ft("fb.spotWet")}</p>
            <div className="flex flex-wrap gap-2">
              {([[true, "fb.spotYes"], [false, "fb.spotNo"]] as const).map(([k, key]) => (
                <button key={String(k)} type="button" aria-pressed={wet === k} onClick={() => setWet(k)} className={chip(wet === k)}>{ft(key)}</button>
              ))}
            </div>
          </div>
          {wet && (
            <>
              <div role="group" aria-label={ft("fb.spotDepth")}>
                <p className="mb-1.5 font-medium">{ft("fb.spotDepth")}</p>
                <div className="flex flex-wrap gap-2">
                  {LEVELS.map(([k]) => (
                    <button key={k} type="button" aria-pressed={street === k} onClick={() => setStreet(k)} className={chip(street === k)}>{ft(`fb.lvl.${k}` as FKey)}</button>
                  ))}
                </div>
              </div>
              <div role="group" aria-label={ft("fb.spotInside")}>
                <p className="mb-1.5 font-medium">{ft("fb.spotInside")}</p>
                <div className="flex flex-wrap gap-2">
                  {([["no", "fb.spotIN"], ["yes", "fb.spotIY"]] as const).map(([k, key]) => (
                    <button key={k} type="button" aria-pressed={inside === k} onClick={() => setInside(inside === k ? null : k)} className={chip(inside === k)}>{ft(key)}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{ft("fb.spotNeedPin")}</p>
      )}

      {/* honeypot: people never see or fill this */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      {state === "error" && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300" role="status">{ft("fb.spotErr")}</p>}
      {state === "limit" && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" role="status">{ft("fb.spotLimit")}</p>}
      <div className="mt-4">
        <button type="button" onClick={send} disabled={!sendable || state === "sending"} className={`min-h-11 rounded-md bg-sky-700 px-5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-40 dark:bg-sky-600 dark:hover:bg-sky-500 ${ring}`}>
          {state === "sending" ? ft("fb.sending") : ft("fb.spotSend")}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{ft("fb.spotPrivacy")}</p>
    </div>
  );
}
