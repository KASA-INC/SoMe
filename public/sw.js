// Service worker for push-varsler fra voksenkontakten. Den mellomlagrer ingenting og rører ikke nettverkstrafikken.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch { /* tomt varsel */ }
  event.waitUntil(self.registration.showNotification(data.title || "quiply", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag, // nye beskjeder i samme gruppe erstatter det forrige varselet
    renotify: !!data.tag,
    data: { url: data.url || "/" },
  }));
});

// Trykk på varselet: åpne voksenkontakten i et vindu som allerede er åpent, eller i et nytt.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      await w.focus();
      return w.navigate ? w.navigate(url).catch(() => self.clients.openWindow(url)) : self.clients.openWindow(url);
    }
    return self.clients.openWindow(url);
  })());
});
