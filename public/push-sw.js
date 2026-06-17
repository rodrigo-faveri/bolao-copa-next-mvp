self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || "Bolao Copa 2026";
  const options = {
    body: payload.body || "Voce tem um aviso do bolao.",
    data: { url: payload.url || "/bolao" },
    icon: "/icon.svg",
    tag: payload.tag || "bolao-copa",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/bolao", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }

    await clients.openWindow(targetUrl);
  })());
});
