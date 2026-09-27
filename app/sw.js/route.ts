export const dynamic = "force-dynamic";

export async function GET() {
  const source = `
const CACHE_NAME = "billtrack-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
    return response;
  }).catch(() => caches.match(event.request)));
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data
      ? event.data.json()
      : {};
  } catch {
    payload = {
      data: {
        body: event.data
          ? event.data.text()
          : ""
      }
    };
  }

  const notification =
    payload.notification || {};

  const data =
    payload.data || {};

  const title =
    notification.title ||
    data.title ||
    "BillTrack";

  const badgeCount =
    Number(data.badgeCount || 0);

  const options = {
    body:
      notification.body ||
      data.body ||
      "You have a payment reminder.",

    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",

    tag:
      data.tag ||
      "billtrack-reminder",

    renotify: false,

    data: {
      url: data.url || "/"
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(
        title,
        options
      ),

      badgeCount > 0 &&
      "setAppBadge" in self.navigator
        ? self.navigator.setAppBadge(
            badgeCount
          )
        : badgeCount === 0 &&
          "clearAppBadge" in self.navigator
        ? self.navigator.clearAppBadge()
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ("focus" in client) { client.navigate(target); return client.focus(); }
    }
    return clients.openWindow ? clients.openWindow(target) : undefined;
  }));
});
`;

  return new Response(source, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
