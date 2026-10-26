"use client";

// "Alert settings": what this phone or browser is alerted about. Opened from the Your places card (next to the alerts
// switch) and from the phone's More sheet. Choices are saved on the server with the subscription (POST /api/push/prefs,
// lib/pushPrefs.ts) and change at once, without turning alerts off and on again. The defaults are what everyone had
// before this panel existed. Plain words only: the river levels are named by what to do ("Get ready"), with the
// official level in brackets.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellRing, Check, SlidersHorizontal, X } from "lucide-react";
import { rtFor, type RKey } from "@/lib/i18n/return";
import { baseKey, DEFAULT_PREFS, MORNING_TIMES, QUIET_DEFAULT, type Prefs, type RiverMin } from "@/lib/pushPrefs";
import { useI18n } from "./LocaleProvider";
import { parseLowSpots, readLowSpotsRaw, writeLowSpot } from "@/lib/lowSpots";
import { placeBySlug } from "@/lib/places";

/** Only towns with the satellite rain rule (canal-backwater towns) can have a low spot. */
const canalTown = (key: string) => key.startsWith("t:") && !!placeBySlug(key.slice(2))?.rainZone;

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const select = `min-h-11 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-sm text-slate-900 dark:text-slate-100 ${ring}`;
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const SAVE_DELAY_MS = 500;
const TEST_GAP_MS = 60_000;

type Ctx = { open: () => void };
const SettingsCtx = createContext<Ctx>({ open: () => {} });
export const useAlertSettings = () => useContext(SettingsCtx);

export function AlertSettingsProvider({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  const open = useCallback(() => setShown(true), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <SettingsCtx.Provider value={value}>
      {children}
      {shown && <SettingsSheet onClose={() => setShown(false)} />}
    </SettingsCtx.Provider>
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

/** A row for the phone's More sheet. Shows only where this browser really has alerts on. */
export function AlertSettingsRow({ onDone }: { onDone?: () => void }) {
  const { lang } = useI18n();
  const { open } = useAlertSettings();
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Notification.permission === "granted") {
      currentSubscription().then((s) => alive && setHas(!!s));
    }
    return () => {
      alive = false;
    };
  }, []);
  if (!has) return null;
  return (
    <button type="button" onClick={() => { onDone?.(); open(); }} className={`flex w-full items-center gap-3 min-h-12 rounded-md px-2 text-left text-base font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
      <SlidersHorizontal className="size-5 text-slate-500 dark:text-slate-400" aria-hidden />
      {rtFor(lang)("as.open")}
    </button>
  );
}

type Place = { key: string; name: string };
type Load = "loading" | "ready" | "error" | "off";
type Save = "idle" | "saving" | "saved" | "error";

function Toggle({ id, checked, onChange, title, help }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; help?: string }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-start gap-3 py-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={`mt-0.5 size-5 shrink-0 rounded border-slate-300 dark:border-slate-600 accent-sky-600 ${ring}`} />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium leading-snug text-slate-900 dark:text-slate-100">{title}</span>
        {help && <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-400">{help}</span>}
      </span>
    </label>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</h3>;
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { lang, t } = useI18n();
  const rt = rtFor(lang);
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [places, setPlaces] = useState<Place[]>([]);
  const [save, setSave] = useState<Save>("idle");
  const [testNote, setTestNote] = useState<RKey | null>(null);
  const endpoint = useRef<string | null>(null);
  const latest = useRef<Prefs>(DEFAULT_PREFS);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const lastTest = useRef(0);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      before?.focus?.();
    };
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !endpoint.current) return;
    dirty.current = false;
    setSave("saving");
    try {
      const res = await fetch("/api/push/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: endpoint.current, prefs: latest.current }) });
      setSave(res.ok ? "saved" : "error");
    } catch {
      setSave("error");
    }
  }, []);

  // load: this browser's subscription -> saved choices + the places it follows -> their names
  useEffect(() => {
    let alive = true;
    (async () => {
      const sub = await currentSubscription();
      if (!alive) return;
      if (!sub) return setLoad("off");
      endpoint.current = sub.endpoint;
      try {
        const res = await fetch("/api/push/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        if (res.status === 404) return alive ? setLoad("off") : undefined;
        const j = (await res.json()) as { ok?: boolean; prefs?: Prefs; places?: string[] };
        if (!alive) return;
        if (!j.ok || !j.prefs) return setLoad("error");
        // a low spot chosen on a town page before alerts were on is carried over now
        const local = parseLowSpots(readLowSpotsRaw()).map((s) => `t:${s}`).filter((k) => !j.prefs!.lowSpots.includes(k));
        if (local.length > 0) {
          j.prefs = { ...j.prefs, lowSpots: [...j.prefs.lowSpots, ...local] };
          dirty.current = true;
          timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
        }
        latest.current = j.prefs;
        setPrefs(j.prefs);
        const keys = j.places ?? [];
        let names = new Map<string, string>();
        try {
          const r = await fetch(`/api/places-state?keys=${encodeURIComponent(keys.join("|"))}`);
          const g = (await r.json()) as { places?: { key: string; name: string }[] };
          names = new Map((g.places ?? []).map((p) => [baseKey(p.key), p.name]));
        } catch {
          /* the names are a nicety: fall back to the key's own name */
        }
        if (!alive) return;
        setPlaces(keys.map((k) => ({ key: k, name: names.get(k) ?? k.slice(2).replace(/-/g, " ") })));
        setLoad("ready");
      } catch {
        if (alive) setLoad("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => void flush(), [flush]);

  const change = useCallback(
    (patch: Partial<Prefs>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      dirty.current = true;
      setPrefs(next);
      setSave("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const close = () => {
    void flush();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab" && panel.current) {
      const f = [...panel.current.querySelectorAll<HTMLElement>("button, input, select, a[href]")].filter((x) => !(x as HTMLInputElement).disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };

  const testAlert = useCallback(async () => {
    if (Date.now() - lastTest.current < TEST_GAP_MS) return setTestNote("as.testWait");
    lastTest.current = Date.now();
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg || Notification.permission !== "granted") throw new Error("no permission");
      await reg.showNotification(rt("pn.testTitle"), { body: rt("as.testBody"), icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: "test", lang });
      setTestNote("as.testSent");
    } catch {
      setTestNote("as.testFail");
    }
  }, [lang, rt]);

  const quietOn = prefs.quiet != null;
  const status = save === "saving" ? rt("as.saving") : save === "saved" ? rt("as.saved") : save === "error" ? rt("as.saveError") : "";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" onKeyDown={onKey} lang={lang}>
      <div className="absolute inset-0 bg-slate-950/50" onClick={close} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="as-title"
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div>
            <h2 id="as-title" className="text-lg font-semibold tracking-tight">{rt("as.title")}</h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{rt("as.intro")}</p>
          </div>
          <button ref={closeBtn} type="button" onClick={close} aria-label={rt("as.close")} className={`-mr-1.5 -mt-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {load === "loading" && <p className="mt-4 text-sm text-slate-600 dark:text-slate-400" role="status">{rt("as.loading")}</p>}
          {load === "error" && <p className="mt-4 text-sm text-amber-700 dark:text-amber-300" role="status">{rt("as.loadError")}</p>}
          {load === "off" && <p className="mt-4 text-sm text-slate-600 dark:text-slate-400" role="status">{rt("as.turnOn")}</p>}
          {load === "ready" && (
            <>
              <H>{rt("as.places")}</H>
              {places.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">{rt("as.noPlaces")}</p>
              ) : (
                <ul>
                  {places.map((p, i) => (
                    <li key={p.key}>
                      <Toggle id={`as-p${i}`} checked={!prefs.muted.includes(p.key)} title={p.name} onChange={(v) => change({ muted: v ? prefs.muted.filter((k) => k !== p.key) : [...prefs.muted, p.key] })} />
                      {canalTown(p.key) && (
                        <div className="ml-8">
                          <Toggle
                            id={`as-low${i}`}
                            checked={prefs.lowSpots.includes(p.key)}
                            title={rt("as.lowSpot")}
                            help={rt("as.lowSpotHelp")}
                            onChange={(v) => {
                              writeLowSpot(p.key.slice(2), v, { sync: false });
                              change({ lowSpots: v ? [...prefs.lowSpots.filter((k) => k !== p.key), p.key] : prefs.lowSpots.filter((k) => k !== p.key) });
                            }}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <H>{rt("as.what")}</H>
              <div className="py-2">
                <label htmlFor="as-river" className="block text-[15px] font-medium text-slate-900 dark:text-slate-100">{rt("as.river")}</label>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{rt("as.riverHelp")}</p>
                <select id="as-river" value={prefs.riverMin} onChange={(e) => change({ riverMin: Number(e.target.value) as RiverMin })} className={`${select} mt-1.5 w-full`}>
                  <option value={2}>{rt("as.rv2")}</option>
                  <option value={3}>{rt("as.rv3")}</option>
                  <option value={4}>{rt("as.rv4")}</option>
                </select>
              </div>
              <Toggle id="as-rs" checked={prefs.reservoir} onChange={(v) => change({ reservoir: v })} title={rt("as.reservoir")} help={rt("as.reservoirHelp")} />
              <Toggle id="as-ac" checked={prefs.allClear} onChange={(v) => change({ allClear: v })} title={rt("as.allClear")} />

              <div className="mt-3 border-t border-slate-100 dark:border-slate-800" />
              <Toggle id="as-mo" checked={prefs.morning} onChange={(v) => change({ morning: v })} title={rt("as.morning")} help={rt("as.morningHelp")} />
              {prefs.morning && (
                <div className="ml-8 flex items-center gap-2 pb-1">
                  <label htmlFor="as-mt" className="text-sm text-slate-700 dark:text-slate-300">{rt("as.morningAt")}</label>
                  <select id="as-mt" value={prefs.morningAt} onChange={(e) => change({ morningAt: e.target.value })} className={select}>
                    {MORNING_TIMES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
              )}

              <div className="mt-3 border-t border-slate-100 dark:border-slate-800" />
              <Toggle id="as-qh" checked={quietOn} onChange={(v) => change({ quiet: v ? QUIET_DEFAULT : null })} title={rt("as.quiet")} help={rt("as.quietHelp")} />
              {prefs.quiet && (
                <div className="ml-8 flex flex-wrap items-center gap-x-2 gap-y-1 pb-1">
                  <label htmlFor="as-qf" className="text-sm text-slate-700 dark:text-slate-300">{rt("as.from")}</label>
                  <select id="as-qf" value={prefs.quiet.from} onChange={(e) => change({ quiet: { from: e.target.value, to: prefs.quiet!.to === e.target.value ? HOURS[(HOURS.indexOf(e.target.value) + 1) % 24] : prefs.quiet!.to } })} className={select}>
                    {HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <label htmlFor="as-qt" className="text-sm text-slate-700 dark:text-slate-300">{rt("as.to")}</label>
                  <select id="as-qt" value={prefs.quiet.to} onChange={(e) => change({ quiet: { from: prefs.quiet!.from === e.target.value ? HOURS[(HOURS.indexOf(e.target.value) + 23) % 24] : prefs.quiet!.from, to: e.target.value } })} className={select}>
                    {HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
              )}

              <div className="mt-3 border-t border-slate-100 dark:border-slate-800" />
              <Toggle id="as-an" checked={prefs.announce} onChange={(v) => change({ announce: v })} title={rt("as.announce")} help={rt("as.announceHelp")} />

              <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                <button type="button" onClick={testAlert} className={`inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
                  <BellRing className="size-4" aria-hidden /> {rt("as.test")}
                </button>
                {testNote && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400" role="status">{rt(testNote)}</p>}
              </div>
            </>
          )}
          {lang !== "en" && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="inline-flex min-w-0 items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400" role="status" aria-live="polite">
            {save === "saved" && <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
            {status}
          </p>
          <button type="button" onClick={close} className={`inline-flex min-h-11 items-center justify-center rounded-md bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 ${ring}`}>
            {rt("as.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
