/* BitChord web — minimal service worker.
 *
 * Strategy:
 *  - App shell (documents + hashed build assets): cache-first with a
 *    background refresh, so the app opens instantly offline after first visit.
 *  - Googlevideo / instance stream URLs and YT thumbnails: never cached here.
 *    Range-requested media is broken by opaque response caching, and artwork
 *    already has its own memory cache in the app.
 *
 * The build hashes this file's bytes into sw.js via the footer; bump
 * CACHE_VERSION to invalidate everything deliberately.
 */
const CACHE_VERSION = 'bitchord-v1';
const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  const isOwnOrigin = url.origin === self.location.origin;
  const isGooglevideo = url.hostname.endsWith('.googlevideo.com');
  const isInstanceStream =
    url.hostname.includes('piped') ||
    url.hostname.includes('invidious') ||
    url.hostname.includes('kavin.rocks') ||
    url.hostname.includes('piped.video');
  const isThumbnail = url.hostname === 'i.ytimg.com' || url.hostname === 'lh3.googleusercontent.com';

  // Media and artwork are streamed through, never intercepted.
  if (isGooglevideo || isInstanceStream || isThumbnail) return;

  if (isOwnOrigin) {
    // Cache-first for the shell and hashed assets; refresh in the background.
    event.respondWith(
      caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then((cached) => {
        const fetched = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }
});
