// Bumped from v2 → v3 to force-evict caches from earlier builds. Some users on Brave
// Android were stuck on cached index.html that pointed at JS bundles deleted by later
// deploys → white screen on launch. The activate handler below deletes every cache
// whose name isn't CACHE.
const CACHE = 'remargin-v3';

self.addEventListener('install', () => {
  // No precache. Snapshotting '/' or '/index.html' at install time freezes the asset
  // hashes inside that HTML, and a future deploy's hashes won't match — so an offline
  // fallback served from precache would point at JS files that no longer exist. The
  // navigation handler below caches a fresh '/index.html' on every successful online
  // load instead, so the offline fallback always reflects the latest deploy the user
  // has actually seen.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only GET over http(s); ignore chrome-extension:// and other schemes.
  if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // SPA navigations: network-first. On success, refresh the cached /index.html so the
  // offline fallback never points at stale asset hashes. On failure, serve whatever
  // /index.html we have (could be empty on first visit — browser shows its own offline
  // page in that case).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', clone));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Never cache the metadata APIs — covers / results should always be fresh.
  if (url.hostname.includes('googleapis') || url.hostname.includes('openlibrary')) {
    e.respondWith(fetch(req));
    return;
  }

  // Everything else (hashed Vite assets, icons, fonts): cache-first, then network.
  // Hashed filenames change per content so stale entries can't masquerade as a newer
  // version — safe to keep indefinitely until the next cache-version bump.
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        }),
    ),
  );
});
