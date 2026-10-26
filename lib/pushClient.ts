// Browser-side helpers shared by the alerts switch (app/AlertsToggle.tsx) and the street-water switch
// (app/flood/useStreetAlert.ts): can this browser do Web Push, the saved subscription, and the VAPID key bytes.

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

/** Ask for permission and subscribe (reusing an existing subscription; replacing one made with another key). Never shows a notification. */
export async function subscribePush(vapidKey: string): Promise<{ sub: PushSubscription } | { denied: true } | { dismissed: true }> {
  const perm = await Notification.requestPermission();
  if (perm === "denied") return { denied: true };
  if (perm !== "granted") return { dismissed: true };
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const subscribe = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
  try {
    sub ??= await subscribe();
  } catch {
    // an old subscription made with another key blocks a new one
    await sub?.unsubscribe().catch(() => {});
    sub = await subscribe();
  }
  return { sub };
}
