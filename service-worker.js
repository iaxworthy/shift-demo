// The app shell, openable offline. Firestore keeps its own offline queue, so
// this only has to serve the files.
//
// Two kinds of file, two rules:
//   assets/*   Vite names these by content hash, so a URL never changes what it
//              holds. Cache first: fetched once, then never again.
//   the rest   index.html, the manifest, this file: same URL, new content on
//              every deploy. Network first, past the HTTP cache, with the cached
//              copy only when there is no network. (PBJ ran an old build for an
//              hour after each deploy because fetch() honoured the HTTP cache.)
const CACHE_NAME = "shift-shell-v2";
const MAX_ASSETS = 80;   // a deploy adds a handful; the oldest fall off

self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME && n !== "shift-share-v1").map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});
// Android share sheet (manifest share_target). The shared fields are parked in
// a cache on this device for the page to pick up once; they never go into a URL
// or to the network. The inbox reads and deletes them (ui/capture.js).
const SHARE_CACHE = "shift-share-v1", SHARE_KEY = "/__shared__";
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const fields = { title: form.get("title"), text: form.get("text"), url: form.get("url") };
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(SHARE_KEY, new Response(JSON.stringify(fields), { headers: { "content-type": "application/json" } }));
  } catch (err) { console.warn("[sw] share failed", err); }
  return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
}

const ASSETS = new URL("./assets/", self.registration.scope).pathname;

async function hashedAsset(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp.ok) {
    await cache.put(req, resp.clone());
    const kept = (await cache.keys()).filter((k) => new URL(k.url).pathname.startsWith(ASSETS));
    await Promise.all(kept.slice(0, Math.max(0, kept.length - MAX_ASSETS)).map((k) => cache.delete(k)));
  }
  return resp;
}

function shell(req) {
  return fetch(req, { cache: "no-store" }).then((resp) => {
    const clone = resp.clone();
    if (resp.ok) caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
    return resp;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match(self.registration.scope)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method === "POST" && new URL(req.url).href === new URL("./share", self.registration.scope).href) { event.respondWith(receiveShare(req)); return; }
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache Firebase / Google APIs
  event.respondWith(url.pathname.startsWith(ASSETS) ? hashedAsset(req) : shell(req));
});
