"use client";

// "Tell me when it changes": Web Push for the places the visitor pinned. One message when a place needs attention, one
// when it is clear, an optional short morning summary. No account: the browser's push endpoint and the pinned place
// keys are saved (app/api/push/route.ts); "Turn off alerts" deletes them. Renders nothing until the server says it can
// both send and save (GET /api/push), so nobody meets a button that cannot work.
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, CircleCheck, Download } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { trackEvent } from "@/lib/umami";
import { useI18n } from "./LocaleProvider";
import { useInstall } from "./InstallProvider";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const btn = `inline-flex items-center justify-center gap-2 min-h-11 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 transition-colors ${ring}`;
const MORNING_KEY = "sl_push_morning";

type Status = "loading" | "hidden" | "off" | "on" | "busy" | "denied" | "unsupported" | "error";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
}

const getMorning = () => {
  try {
    return window.localStorage.getItem(MORNING_KEY) === "1";
  } catch {
    return false;
  }
};

export function AlertsToggle({ keys }: { keys: string[] }) {
  const { lang } = useI18n();
  const rt = rtFor(lang);
  const { iosNeedsInstall, install } = useInstall();
  const [status, setStatus] = useState<Status>("loading");
  const [morning, setMorning] = useState(false);
  const vapid = useRef<string | null>(null);
  const joined = keys.join("|");

  const save = useCallback(
    async (sub: PushSubscription, m: boolean) => {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), places: joined ? joined.split("|") : [], lang, morning: m }),
      });
      return res.ok;
    },
    [joined, lang],
  );

  // First look: can this site send, can this browser receive, is this browser already subscribed?
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = (await (await fetch("/api/push", { cache: "no-store" })).json()) as { enabled?: boolean; key?: string | null };
        if (!alive) return;
        if (!cfg.enabled || !cfg.key) return setStatus("hidden");
        vapid.current = cfg.key;
        setMorning(getMorning());
        if (!supported()) return setStatus("unsupported");
        if (Notification.permission === "denied") return setStatus("denied");
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (alive) setStatus(sub && Notification.permission === "granted" ? "on" : "off");
      } catch {
        if (alive) setStatus("hidden");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Keep the saved subscription in step with the pinned places (and the language / morning choice).
  useEffect(() => {
    if (status !== "on" || !joined) return;
    const id = setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) await save(sub, morning);
      } catch {
        /* the next change tries again */
      }
    }, 800);
    return () => clearTimeout(id);
  }, [status, joined, morning, save]);

  async function enable() {
    if (!vapid.current || !joined) return;
    setStatus("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") return setStatus("denied");
      if (perm !== "granted") return setStatus("off");
      const reg = await registration();
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const subscribe = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid.current!) });
      try {
        sub ??= await subscribe();
      } catch {
        // an old subscription made with another key blocks a new one
        await sub?.unsubscribe().catch(() => {});
        sub = await subscribe();
      }
      if (!(await save(sub, morning))) {
        await sub.unsubscribe().catch(() => {});
        return setStatus("error");
      }
      setStatus("on");
      trackEvent("alerts_on", { places: keys.length });
      const t = rtFor(lang);
      reg.showNotification(t("pn.testTitle"), { body: t("pn.testBody"), icon: "/icons/icon-192.png", lang }).catch(() => {});
    } catch {
      setStatus("error");
    }
  }

  async function disable() {
    setStatus("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      trackEvent("alerts_off");
    } finally {
      setStatus("off");
    }
  }

  function toggleMorning(v: boolean) {
    setMorning(v);
    try {
      window.localStorage.setItem(MORNING_KEY, v ? "1" : "0");
    } catch {
      /* storage blocked: the choice lasts until the page closes */
    }
  }

  if (status === "loading" || status === "hidden") return null;

  return (
    <div lang={lang} className="min-w-0">
      {status === "on" ? (
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200" role="status">
              <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> {rt("al.on")}
            </p>
            <button type="button" onClick={disable} className={`${btn} border-transparent bg-transparent dark:bg-transparent text-slate-600 dark:text-slate-300`}>
              <BellOff className="size-4" aria-hidden /> {rt("al.disable")}
            </button>
          </div>
          <label className="mt-1 flex min-h-11 items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={morning} onChange={(e) => toggleMorning(e.target.checked)} className={`size-5 rounded border-slate-300 dark:border-slate-600 accent-sky-600 ${ring}`} />
            {rt("al.morning")}
          </label>
        </div>
      ) : iosNeedsInstall && (status === "unsupported" || status === "off") ? (
        // iPhone and iPad only deliver alerts to a site that sits on the Home Screen
        <div>
          <p className="text-sm text-slate-700 dark:text-slate-300" role="status">{rt("ins.alerts")}</p>
          <button type="button" onClick={() => install("alerts")} className={`${btn} mt-1.5`}>
            <Download className="size-4" aria-hidden /> {rt("ins.btn")}
          </button>
        </div>
      ) : status === "unsupported" || status === "denied" ? (
        <p className="text-sm text-slate-600 dark:text-slate-400" role="status">{rt(status === "denied" ? "al.denied" : "al.unsupported")}</p>
      ) : (
        <div>
          <button type="button" onClick={enable} disabled={status === "busy" || !joined} className={btn}>
            <Bell className="size-4" aria-hidden /> {status === "busy" ? rt("al.busy") : rt("al.enable")}
          </button>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{rt("al.help")}</p>
          {status === "error" && <p className="mt-1.5 text-sm text-amber-700 dark:text-amber-300" role="status">{rt("al.error")}</p>}
        </div>
      )}
    </div>
  );
}
