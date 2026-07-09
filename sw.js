// TriLens service worker — v2026:07:02-21:48
// POLICY: app shell is cached for offline launch; the trilens-data API is NEVER
// cached here. Freshness/caching of readings is handled server-side with
// labelled tiers so the UI can always tell the truth about data age.
const CACHE = "trilens-shell-v2026-07-09-1855";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never intercept/cache data calls — always network
  if (url.hostname.endsWith("supabase.co")) return;
  if (e.request.method !== "GET") return;

  // Navigation: network-first, cache fallback (offline launch)
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: cache-first with background fill
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});
