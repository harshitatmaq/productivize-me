/* Productivize service worker: push notifications, notification actions, offline fallback. */
const VERSION = "pm-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for page navigations, with an offline page when there is no connection.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(
    fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Productivize", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Productivize";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag,
    renotify: !!data.tag,
    requireInteraction: !!data.requireInteraction,
    actions: (data.actions || []).slice(0, 2),
    data: { url: data.url || "/", ...(data.data || {}) },
    vibrate: [80, 40, 80],
    timestamp: Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

async function focusOrOpen(url) {
  const target = new URL(url, self.location.origin).href;
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of all) {
    if (new URL(client.url).origin === self.location.origin && "focus" in client) {
      await client.focus();
      if ("navigate" in client) return client.navigate(target).catch(() => client.postMessage({ type: "navigate", url: target }));
      return client.postMessage({ type: "navigate", url: target });
    }
  }
  return self.clients.openWindow(target);
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();

  event.waitUntil(
    (async () => {
      try {
        switch (event.action) {
          case "carry": {
            const r = await post("/api/tasks/carry", { to: "tomorrow" });
            await self.registration.showNotification("Moved to tomorrow", {
              body: `${r.moved ?? "Your"} unfinished task${r.moved === 1 ? "" : "s"} will be waiting for you.`,
              icon: "/icons/icon-192.png",
              badge: "/icons/badge-96.png",
              tag: "eod-done",
              data: { url: "/upcoming" },
            });
            return;
          }
          case "done":
            if (data.taskId) await post("/api/tasks/action", { id: data.taskId, action: "done" });
            return;
          case "snooze":
            if (data.taskId) await post("/api/tasks/action", { id: data.taskId, action: "snooze", minutes: 60 });
            return;
          case "review":
            return focusOrOpen("/?review=1");
          case "log":
            return focusOrOpen("/learning?new=1");
          default:
            return focusOrOpen(data.url || "/");
        }
      } catch {
        // Not signed in on this browser session or offline: just open the app.
        return focusOrOpen(data.url || "/");
      }
    })(),
  );
});
