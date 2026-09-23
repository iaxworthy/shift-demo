// Network-first app shell with a cached fallback when offline. Firestore keeps
// its own offline queue, so this only has to make the shell openable.
const CACHE_NAME = "shift-shell-v1";

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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method === "POST" && new URL(req.url).href === new URL("./share", self.registration.scope).href) { event.respondWith(receiveShare(req)); return; }
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache Firebase / Google APIs
  event.respondWith(
    fetch(req, { cache: "no-store" }).then((resp) => {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
      return resp;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match(self.registration.scope)))
  );
});
