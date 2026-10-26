"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, CircleCheck, CircleHelp, MapPin, MessageCircleQuestion, TrendingDown, TrendingUp, X } from "lucide-react";
import { FB_RAIN, FB_RIVER, NOTE_MAX, colomboDay, fbCookieName, roundCoord, type FbAnswer, type FbPage, type FbRain, type FbRiver } from "@/lib/feedback";
import { fbFor, type FKey } from "@/lib/i18n/feedback";
import { trackEvent } from "@/lib/umami";
import { useI18n } from "../LocaleProvider";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const ANSWERS: { id: FbAnswer; key: FKey; Icon: typeof Check }[] = [
  { id: "yes", key: "fb.yes", Icon: Check },
  { id: "worse", key: "fb.worse", Icon: TrendingUp },
  { id: "better", key: "fb.better", Icon: TrendingDown },
  { id: "unsure", key: "fb.unsure", Icon: CircleHelp },
];

// "Already answered today" is a cookie the route sets; useSyncExternalStore keeps server and client markup equal on first paint.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
const answeredToday = (name: string) => () => {
  try {
    return document.cookie.split("; ").includes(`${name}=${colomboDay(Date.now())}`);
  } catch {
    return false;
  }
};

type Phase = "idle" | "sending" | "done" | "error" | "limit";
type Loc = { state: "none" } | { state: "busy" } | { state: "off" } | { state: "ok"; lat: number; lon: number };

/**
 * "Is this right?" under the verdict. One tap answers; then an optional second step (what they see, a note, a rough location).
 * Location is read only when the person taps the button and is rounded to 0.01 degree (about 1 km) here, before anything is sent.
 */
export function AccuracyFeedback({ page, station, town, name, tone }: { page: FbPage; station: string | null; town?: string; name: string; tone: string }) {
  const { lang } = useI18n();
  const ft = fbFor(lang);
  const target = page === "station" ? (station as string) : (town as string);
  const cookie = fbCookieName(page, target);
  const already = useSyncExternalStore(subscribe, answeredToday(cookie), () => false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hp, setHp] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ n: number; matched: number } | null>(null);
  const [river, setRiver] = useState<FbRiver | null>(null);
  const [rain, setRain] = useState<FbRain | null>(null);
  const [note, setNote] = useState("");
  const [loc, setLoc] = useState<Loc>({ state: "none" });
  const [detail, setDetail] = useState<"open" | "sending" | "sent" | "skipped">("open");
  const [noteDropped, setNoteDropped] = useState(false);
  const [answer, setAnswer] = useState<FbAnswer | null>(null);

  async function send(a: FbAnswer) {
    if (phase === "sending") return;
    setPhase("sending");
    setAnswer(a);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "answer", page, station, town, answer: a, tone, lang, hp, ms: Math.round(performance.now()) }),
      });
      if (res.ok) {
        const j = (await res.json().catch(() => null)) as { token?: string; impact?: { n: number; matched: number } | null } | null;
        setToken(j?.token ?? null);
        setImpact(j?.impact ?? null);
        trackEvent("feedback_answer", { page, answer: a, tone, target });
        listeners.forEach((l) => l());
        setPhase("done");
      } else setPhase(res.status === 429 ? "limit" : "error");
    } catch {
      setPhase("error");
    }
  }

  function askLocation() {
    if (!navigator.geolocation) return setLoc({ state: "off" });
    setLoc({ state: "busy" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        // rounded here: the exact position never leaves the phone
        setLoc({ state: "ok", lat: roundCoord(p.coords.latitude), lon: roundCoord(p.coords.longitude) });
        trackEvent("feedback_location", { result: "granted" });
      },
      () => {
        setLoc({ state: "off" });
        trackEvent("feedback_location", { result: "denied" });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  async function sendDetails() {
    if (!token) return setDetail("sent");
    setDetail("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "details", token, river, rain, note: note.trim() || null, lat: loc.state === "ok" ? loc.lat : null, lon: loc.state === "ok" ? loc.lon : null, hp }),
      });
      const j = (await res.json().catch(() => null)) as { noteDropped?: boolean } | null;
      if (j?.noteDropped) setNoteDropped(true);
      trackEvent("feedback_details", { page, answer, river, rain, location: loc.state === "ok", note: note.trim().length > 0, target });
    } catch {
      /* the answer itself is already saved */
    }
    setDetail("sent");
  }

  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 min-h-11 rounded-full border px-4 text-sm transition ${ring} ${
      on
        ? "border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-950 dark:text-sky-100"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
    }`;
  const done = phase === "done";

  return (
    <section aria-label={ft("fb.title")} lang={lang} className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <MessageCircleQuestion className="size-4" aria-hidden /> {ft("fb.title")}
      </h2>

      {already && !done ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200" role="status">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> {ft("fb.already")}
        </p>
      ) : done ? (
        <div className="mt-2 text-sm text-slate-800 dark:text-slate-200" role="status">
          <p className="flex items-start gap-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> {ft("fb.thanks")}
          </p>
          {impact && <p className="mt-1.5 pl-6 text-slate-600 dark:text-slate-400">{ft("fb.impact", { n: impact.n, m: impact.matched, name })}</p>}

          {token && detail === "open" && (
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{ft("fb.more")}</p>

              <div className="mt-3" role="group" aria-label={ft("fb.riverQ")}>
                <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">{ft("fb.riverQ")}</p>
                <div className="flex flex-wrap gap-2">
                  {FB_RIVER.map((r) => (
                    <button key={r} type="button" aria-pressed={river === r} onClick={() => setRiver(river === r ? null : r)} className={chip(river === r)}>
                      {ft(`fb.river.${r}` as FKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3" role="group" aria-label={ft("fb.rainQ")}>
                <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">{ft("fb.rainQ")}</p>
                <div className="flex flex-wrap gap-2">
                  {FB_RAIN.map((r) => (
                    <button key={r} type="button" aria-pressed={rain === r} onClick={() => setRain(rain === r ? null : r)} className={chip(rain === r)}>
                      {ft(`fb.rain.${r}` as FKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <label htmlFor={`fb-note-${cookie}`} className="mb-1.5 block text-xs text-slate-500 dark:text-slate-400">{ft("fb.noteLabel")}</label>
                <textarea
                  id={`fb-note-${cookie}`}
                  value={note}
                  maxLength={NOTE_MAX}
                  rows={3}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={ft("fb.notePh")}
                  className={`w-full rounded-md border border-slate-300 bg-white p-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 ${ring}`}
                />
                <p className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">{ft("fb.noteCount", { n: note.length, max: NOTE_MAX })}</p>
              </div>

              <div className="mt-3">
                {loc.state === "ok" ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <MapPin className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> {ft("fb.locOk")}
                    <button type="button" onClick={() => setLoc({ state: "none" })} className={`inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-slate-600 underline underline-offset-2 dark:text-slate-400 ${ring}`}>
                      <X className="size-3.5" aria-hidden /> {ft("fb.locRemove")}
                    </button>
                  </p>
                ) : (
                  <button type="button" onClick={askLocation} disabled={loc.state === "busy"} className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800 ${ring}`}>
                    <MapPin className="size-4 shrink-0" aria-hidden /> {loc.state === "busy" ? ft("fb.locBusy") : ft("fb.locBtn")}
                  </button>
                )}
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{loc.state === "off" ? ft("fb.locOff") : ft("fb.locWhy")}</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={sendDetails} className={`min-h-11 rounded-md bg-sky-700 px-5 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500 ${ring}`}>
                  {ft("fb.send")}
                </button>
                <button type="button" onClick={() => setDetail("skipped")} className={`min-h-11 rounded-md px-4 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 ${ring}`}>
                  {ft("fb.skip")}
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{ft("fb.privacy")}</p>
            </div>
          )}
          {detail === "sending" && <p className="mt-3 text-slate-500 dark:text-slate-400">{ft("fb.sending")}</p>}
          {detail === "sent" && <p className="mt-1.5 pl-6 text-slate-600 dark:text-slate-400">{noteDropped ? ft("fb.noteDropped") : ft("fb.detailsDone")}</p>}
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{ft("fb.intro")}</p>
          {/* honeypot: people never see or fill this */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" />
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ANSWERS.map(({ id, key, Icon }) => (
              <button
                key={id}
                type="button"
                disabled={phase === "sending"}
                onClick={() => send(id)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800 ${ring}`}
              >
                <Icon className="size-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden /> {ft(key)}
              </button>
            ))}
          </div>
          <p className="mt-2 min-h-5 text-sm" role="status">
            {phase === "sending" && <span className="text-slate-500 dark:text-slate-400">{ft("fb.sending")}</span>}
            {phase === "error" && <span className="text-amber-700 dark:text-amber-300">{ft("fb.error")}</span>}
            {phase === "limit" && <span className="text-slate-600 dark:text-slate-300">{ft("fb.limit")}</span>}
          </p>
        </>
      )}
    </section>
  );
}
