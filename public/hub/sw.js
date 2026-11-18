// Service worker du hub : il rend le hub installable comme application
// (Chrome, Edge). Aucune mise en cache : tout vient toujours du reseau.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
