/* Service worker for Sri Lanka Water Levels.
 * 1. Offline last-known view: pages you opened are kept on the phone and shown when there is no connection,
 *    with the real network always tried first (levels are never served from the cache while online).
 * 2. Web Push: shows the alert for a pinned place and opens its page when tapped.
 * Nothing here collects or sends anything about the visitor. Bump VERSION to drop old caches. */
const VERSION = "v1";
const PAGES = "pages-" + VERSION;
const DATA = "data-" + VERSION;
const STATIC = "static-" + VERSION;
const MAX_PAGES = 40;
const NET_TIMEOUT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.add("/offline.html")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (![PAGES, DATA, STATIC].includes(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(req), NET_TIMEOUT_MS);
    if (res.ok) {
      cache.put(req, res.clone()).then(() => trim(cacheName, MAX_PAGES)).catch(() => {});
    }
    return res;
  } catch (_) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (fallbackUrl) {
      const off = await caches.match(fallbackUrl);
      if (off) return off;
    }
    return new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.pathname === "/api/places-state") {
    e.respondWith(networkFirst(req, DATA));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return;
  if (req.mode === "navigate") e.respondWith(networkFirst(req, PAGES, "/offline.html"));
});

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { title: "Sri Lanka Water Levels", body: e.data ? e.data.text() : "" };
  }
  const title = d.title || "Sri Lanka Water Levels";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: d.tag || undefined, // one notification per place: a newer one replaces the older
      renotify: false,
      lang: d.lang || undefined,
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url === target && "focus" in c) return c.focus();
      }
      const first = all.find((c) => "navigate" in c && "focus" in c);
      if (first) {
        await first.navigate(target);
        return first.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
