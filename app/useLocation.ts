"use client";

// Visitor location, kept on the device only.
// - Stored in localStorage "sl_loc" as {lat, lon, ts}, rounded to 2 decimals (about 1 km).
// - Never sent to the server, analytics or URLs. Analytics only learns "granted" / "denied".
// - Asked only on a tap (browsers block unprompted geolocation calls). If the browser already
//   reports "granted", the position is refreshed silently, at most every 6 hours.
// - "Not now" hides the prompt for 7 days. A denial is final: we never ask again.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { trackEvent } from "@/lib/umami";

export type Loc = { lat: number; lon: number; ts: number };

const LOC = "sl_loc";
const DISMISS = "sl_loc_dismiss"; // epoch ms until which the prompt stays hidden
const DENIED = "sl_loc_denied";
const OPTOUT = "sl_loc_optout"; // set by "Forget my location": no silent refresh until the next tap
const EVT = "sl:location";
const REFRESH_MS = 6 * 3_600_000;
const DISMISS_MS = 7 * 86_400_000;

type Perm = "unknown" | PermissionState;
const mem: { perm: Perm; requesting: boolean; failed: boolean; booted: boolean } = {
  perm: "unknown",
  requesting: false,
  failed: false,
  booted: false,
};

const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: location just won't persist */
  }
};
const notify = () => window.dispatchEvent(new Event(EVT));
const round2 = (n: number) => Math.round(n * 100) / 100;

function parseLoc(raw: string | null): Loc | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Loc>;
    if (typeof v.lat === "number" && typeof v.lon === "number" && Number.isFinite(v.lat) && Number.isFinite(v.lon)) {
      return { lat: v.lat, lon: v.lon, ts: typeof v.ts === "number" ? v.ts : 0 };
    }
  } catch {
    /* corrupt value */
  }
  return null;
}

/** One string so useSyncExternalStore can compare snapshots by value. */
function snapshot(): string {
  const dismissed = Number(get(DISMISS) ?? 0) > Date.now() ? 1 : 0;
  return JSON.stringify([
    get(LOC),
    dismissed,
    get(DENIED) === "1" ? 1 : 0,
    get(OPTOUT) === "1" ? 1 : 0,
    mem.perm,
    mem.requesting ? 1 : 0,
    mem.failed ? 1 : 0,
    typeof navigator !== "undefined" && "geolocation" in navigator ? 1 : 0,
  ]);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

function save(lat: number, lon: number) {
  set(LOC, JSON.stringify({ lat: round2(lat), lon: round2(lon), ts: Date.now() }));
  set(OPTOUT, null);
  mem.failed = false;
}

function position(onOk: (lat: number, lon: number) => void, onErr: (e: GeolocationPositionError) => void) {
  navigator.geolocation.getCurrentPosition((p) => onOk(p.coords.latitude, p.coords.longitude), onErr, {
    enableHighAccuracy: false,
    timeout: 10_000,
    maximumAge: 5 * 60_000,
  });
}

/** Called from a tap. Resolves after the browser has answered. */
export function requestLocation(): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  mem.requesting = true;
  mem.failed = false;
  notify();
  position(
    (lat, lon) => {
      mem.requesting = false;
      save(lat, lon);
      set(DISMISS, null);
      trackEvent("location_granted");
      notify();
    },
    (err) => {
      mem.requesting = false;
      if (err.code === err.PERMISSION_DENIED) {
        set(DENIED, "1");
        trackEvent("location_denied");
      } else {
        mem.failed = true;
      }
      notify();
    },
  );
}

/** For callers that already hold a position (the search palette's "Use my location"). */
export function storeLocation(lat: number, lon: number): void {
  save(lat, lon);
  trackEvent("location_granted");
  notify();
}
export function markDenied(): void {
  set(DENIED, "1");
  trackEvent("location_denied");
  notify();
}

export function dismissLocationPrompt(): void {
  set(DISMISS, String(Date.now() + DISMISS_MS));
  notify();
}

export function forgetLocation(): void {
  set(LOC, null);
  set(OPTOUT, "1");
  set(DISMISS, String(Date.now() + DISMISS_MS));
  notify();
}

/** Once per page load: learn the permission state, refresh silently when already granted. */
function boot() {
  if (mem.booted || typeof navigator === "undefined") return;
  mem.booted = true;
  const refreshIfStale = () => {
    const loc = parseLoc(get(LOC));
    if (get(OPTOUT) === "1" || (loc && Date.now() - loc.ts < REFRESH_MS)) return;
    position(
      (lat, lon) => {
        save(lat, lon);
        notify();
      },
      () => {
        /* silent: keep whatever we had */
      },
    );
  };
  if (!navigator.permissions?.query) return;
  navigator.permissions
    .query({ name: "geolocation" })
    .then((status) => {
      const apply = () => {
        mem.perm = status.state;
        if (status.state === "denied") {
          set(LOC, null);
        } else if (status.state === "granted") {
          refreshIfStale();
        }
        notify();
      };
      apply();
      status.onchange = apply;
    })
    .catch(() => {
      /* permissions API unavailable: the card still works on tap */
    });
}

export function useLocation() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  useEffect(boot, []);
  const state = useMemo(() => {
    if (!raw) return null;
    const [locRaw, dismissed, denied, optout, perm, requesting, failed, supported] = JSON.parse(raw) as [
      string | null, number, number, number, Perm, number, number, number,
    ];
    return { loc: parseLoc(locRaw), dismissed: !!dismissed, denied: !!denied, optout: !!optout, perm, requesting: !!requesting, failed: !!failed, supported: !!supported };
  }, [raw]);

  const ready = state != null;
  const loc = state?.loc ?? null;
  const shouldAsk =
    !!state &&
    state.supported &&
    !loc &&
    !state.denied &&
    !state.dismissed &&
    state.perm !== "denied" &&
    (state.perm !== "granted" || state.optout);

  return {
    ready,
    loc,
    shouldAsk,
    requesting: !!state?.requesting,
    failed: !!state?.failed,
    request: requestLocation,
    dismiss: dismissLocationPrompt,
    forget: forgetLocation,
  };
}
