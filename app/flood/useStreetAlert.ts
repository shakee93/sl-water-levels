"use client";

// One switch for "tell me when my street may get water" on a canal-area town page. The truth is the SERVER's push prefs
// (`lowSpots` holds "t:<slug>", lib/pushPrefs.ts), read and written through /api/push/prefs exactly like the alert settings
// sheet does. The device note (localStorage sl_low_spots, lib/lowSpots.ts) is kept in step with it, so the Your places card
// and this switch always agree. Turning it on without alerts runs the normal subscribe flow (permission, subscription,
// place saved) and pins the town; it never sends a test push.
import { useCallback, useEffect, useRef, useState } from "react";
import { parseLowSpots, readLowSpotsRaw, writeLowSpot } from "@/lib/lowSpots";
import { currentSubscription, pushSupported, subscribePush } from "@/lib/pushClient";
import { parsePins, readPinsRaw, togglePin, townSlugOfHref } from "@/lib/pins";
import { MAX_PLACES } from "@/lib/myPlaces";
import { baseKey, type Prefs } from "@/lib/pushPrefs";
import { trackEvent } from "@/lib/umami";
import { useLowSpot } from "./useLowSpot";

/**
 * loading: asking the server
 * local:   this site cannot send pushes, or this browser cannot receive them (or they are blocked): the switch only keeps the device note
 * ready:   pushes can work; `on` says whether this town's street water is switched on for this browser
 */
/** After the move to waterlevels.lk: the old address's push endpoint (app/ImportHandover.tsx), replaced server-side so no alert comes twice. */
const oldPushEndpoint = (): string | undefined => {
  try {
    return localStorage.getItem("sl_push_old") ?? undefined;
  } catch {
    return undefined;
  }
};

export type StreetAlertState = "loading" | "local" | "ready";
export type StreetAlertWhy = "nopush" | "unsupported" | "denied" | null;

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

type PrefsReply = { ok?: boolean; prefs?: Prefs; places?: string[] };
async function readPrefs(endpoint: string): Promise<{ status: number; j: PrefsReply }> {
  const res = await post("/api/push/prefs", { endpoint });
  return { status: res.status, j: (await res.json().catch(() => ({}))) as PrefsReply };
}

export function useStreetAlert(slug: string, townName: string, lang: string) {
  const key = `t:${slug}`;
  const local = useLowSpot(slug);
  const [state, setState] = useState<StreetAlertState>("loading");
  const [why, setWhy] = useState<StreetAlertWhy>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const vapid = useRef<string | null>(null);
  const busyRef = useRef(false);
  const stateRef = useRef<StreetAlertState>("loading");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // first look: can alerts work here, is this browser subscribed, is this town switched on in its prefs
  useEffect(() => {
    let alive = true;
    (async () => {
      const fallback = (w: StreetAlertWhy) => {
        if (!alive) return;
        setWhy(w);
        setState("local");
      };
      try {
        const cfg = (await (await fetch("/api/push", { cache: "no-store" })).json()) as { enabled?: boolean; key?: string | null };
        if (!cfg.enabled || !cfg.key) return fallback("nopush");
        vapid.current = cfg.key;
        if (!pushSupported()) return fallback("unsupported");
        const sub = await currentSubscription();
        let serverOn = false;
        if (sub && Notification.permission === "granted") {
          const { status, j } = await readPrefs(sub.endpoint);
          if (status !== 404 && j.ok && j.prefs) serverOn = j.prefs.lowSpots.includes(key) && !j.prefs.muted.includes(key) && (j.places ?? []).map(baseKey).includes(key);
        } else if (Notification.permission === "denied") {
          return fallback("denied");
        }
        if (!alive) return;
        setOn(serverOn);
        setState("ready");
        // one source of truth: the device note follows the server
        if (parseLowSpots(readLowSpotsRaw()).includes(slug) !== serverOn) writeLowSpot(slug, serverOn, { sync: false });
      } catch {
        fallback("nopush");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, key]);

  // the alert settings sheet (or another tab) changed the device note: follow it
  useEffect(() => {
    if (stateRef.current === "ready" && !busyRef.current) setOn(local);
  }, [local]);

  const turnOn = useCallback(async () => {
    // the town is saved as a pinned place: alerts are sent for the places a browser follows
    const pin = () => {
      if (!parsePins(readPinsRaw()).some((p) => townSlugOfHref(p.href) === slug)) togglePin(`/flood/${slug}`, townName);
    };
    let sub = await currentSubscription();
    if (!sub || Notification.permission !== "granted") {
      if (!vapid.current) throw new Error("no key");
      const r = await subscribePush(vapid.current);
      if ("denied" in r) {
        setWhy("denied");
        setState("local");
        trackEvent("subscribe_failed", { reason: "denied" });
        return false;
      }
      if ("dismissed" in r) return false;
      sub = r.sub;
      pin();
      const pins = parsePins(readPinsRaw()).map((p) => townSlugOfHref(p.href)).filter((s): s is string => !!s).map((s) => `t:${s}`);
      const places = [...new Set([...pins, key])].slice(0, MAX_PLACES);
      const res = await post("/api/push", { subscription: sub.toJSON(), places, lang, replaces: oldPushEndpoint() });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        throw new Error("save");
      }
      trackEvent("alerts_on", { places: places.length });
    }
    pin();
    const cur = await readPrefs(sub.endpoint);
    if (cur.status === 404 || !cur.j.ok || !cur.j.prefs) throw new Error("prefs");
    // already subscribed, but this town is not one of its places yet
    const followed = (cur.j.places ?? []).map(baseKey);
    if (!followed.includes(key)) {
      const res = await post("/api/push", { subscription: sub.toJSON(), places: [...followed, key].slice(0, MAX_PLACES), lang, replaces: oldPushEndpoint() });
      if (!res.ok) throw new Error("save");
    }
    const p = cur.j.prefs;
    const next: Prefs = { ...p, lowSpots: [...p.lowSpots.filter((k) => k !== key), key], muted: p.muted.filter((k) => k !== key) };
    const saved = await post("/api/push/prefs", { endpoint: sub.endpoint, prefs: next });
    if (!saved.ok) throw new Error("prefs");
    trackEvent("street_alert_on");
    return true;
  }, [slug, key, townName, lang]);

  const turnOff = useCallback(async () => {
    const sub = await currentSubscription();
    if (!sub) return;
    const cur = await readPrefs(sub.endpoint);
    if (!cur.j.ok || !cur.j.prefs) throw new Error("prefs");
    const saved = await post("/api/push/prefs", { endpoint: sub.endpoint, prefs: { ...cur.j.prefs, lowSpots: cur.j.prefs.lowSpots.filter((k) => k !== key) } });
    if (!saved.ok) throw new Error("prefs");
    trackEvent("street_alert_off");
  }, [key]);

  const toggle = useCallback(async () => {
    if (busyRef.current) return;
    if (state !== "ready") {
      // device note only
      writeLowSpot(slug, !local, { sync: false });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(false);
    try {
      if (on) {
        await turnOff();
        setOn(false);
        writeLowSpot(slug, false, { sync: false });
      } else if (await turnOn()) {
        setOn(true);
        writeLowSpot(slug, true, { sync: false });
      }
    } catch {
      setError(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [state, local, on, slug, turnOn, turnOff]);

  const shownOn = state === "ready" ? on : local;
  return { state, why, on: shownOn, busy, error, toggle };
}
