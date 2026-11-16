// Service worker de l'app Suivi : notifications, et l'app s'ouvre meme sans reseau.
const CACHE = "suivi-v1";
const COQUILLE = ["/app/", "/app/app.js", "/app/manifest.webmanifest", "/app/icones/suivi-192.png", "/marque/logo-bleu-480.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(COQUILLE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});

// Reseau d'abord (les donnees doivent etre fraiches), cache si hors ligne.
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/app/api/") || u.pathname.startsWith("/app/push")) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === "basic" && !r.redirected) { const copie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("/app/"))));
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corps: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titre || "Suivi Bati Azur", {
    body: d.corps || "", tag: d.sujet || "suivi", renotify: true,
    icon: "/app/icones/suivi-192.png", badge: "/app/icones/suivi-192.png",
    data: { url: d.url || "/app/#matin" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/app/#matin", location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(fenetres => {
    const f = fenetres.find(w => w.url.includes("/app/"));
    if (f) { f.postMessage({ url }); return f.focus(); }
    return self.clients.openWindow(url);
  }));
});
