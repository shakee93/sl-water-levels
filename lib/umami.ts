// Thin, safe wrapper around the Umami client snippet loaded in `app/layout.tsx`.
// `window.umami` may be missing if the script is blocked or hasn't loaded yet —
// every call is a no-op in that case.

type UmamiEventData = Record<string, string | number | boolean | null | undefined>;

type UmamiClient = {
  track: ((event: string, data?: UmamiEventData) => void) &
    ((data: UmamiEventData) => void);
};

declare global {
  interface Window {
    umami?: UmamiClient;
  }
}

export function trackEvent(name: string, data?: UmamiEventData) {
  if (typeof window === "undefined") return;
  try {
    window.umami?.track(name, data);
  } catch {
    /* swallow — analytics must never break the app */
  }
}
