// Service worker mínimo: existe solo para que Chrome/Android reconozca la
// app como instalable en modo standalone. No cachea nada a propósito —
// esta app depende de sesión y datos en vivo de Supabase, así que cada
// solicitud siempre va directo a la red.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
