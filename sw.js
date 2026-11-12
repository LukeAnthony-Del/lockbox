const CACHE = "lockbox-v4";
let meta = { me: "", muted: [] };

async function loadMeta() {
  if (meta.me) return meta;
  try {
    const cache = await caches.open("lockbox-meta");
    const saved = await cache.match("./meta.json");
    if (saved) meta = await saved.json();
  } catch (e) { /* meta is optional */ }
  return meta;
}

async function saveMeta(next) {
  meta = next || { me: "", muted: [] };
  try {
    const cache = await caches.open("lockbox-meta");
    await cache.put("./meta.json", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
  } catch (e) { /* meta is optional */ }
}
const ASSETS = ["./","index.html","styles.css","app.js","manifest.json","icon-192.png","icon-512.png","apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== "lockbox-meta").map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.meta) saveMeta(event.data.meta);
});

self.addEventListener("push", (event) => {
  event.waitUntil(showPush(event));
});

async function showPush(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = {}; }
  if (data.event === "subscription_expiring") {
    const open = await self.clients.matchAll({ includeUncontrolled: true });
    open.forEach((client) => client.postMessage({ renewPush: true }));
    return self.registration.showNotification("Lockbox", {
      body: "Open Lockbox to keep alerts on.",
      icon: "icon-192.png",
      tag: "lockbox-renew",
    });
  }
  const message = data.message || {};
  let payload = null;
  try { payload = JSON.parse(message.message || ""); }
  catch (e) { payload = null; }
  if (!payload || payload.v !== 1) return;
  const info = await loadMeta();
  if (info.me && payload.from === info.me) return;
  const incomingCall = payload.kind === "call" && payload.op === "offer";
  if (payload.kind !== "msg" && !incomingCall) return;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (clients.some((client) => client.visibilityState === "visible")) return;
  const chatId = payload.gid ? "g:" + payload.gid : "d:" + payload.from;
  if ((info.muted || []).includes(chatId)) return;
  const title = incomingCall ? "Incoming call" : (message.title || "Lockbox");
  const body = incomingCall ? (payload.name || "Someone") + " is calling" : (payload.text || "New message");
  return self.registration.showNotification(title, {
    body: String(body).slice(0, 180),
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: incomingCall ? "call-" + payload.sid : chatId,
    renotify: true,
    data: { chatId, call: incomingCall ? payload.sid : "" },
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chatId = event.notification.data && event.notification.data.chatId;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const target = new URL("./", self.registration.scope);
      if (chatId) target.hash = "#/c/" + encodeURIComponent(chatId);
      const open = clients.find((client) => client.url.includes(self.registration.scope));
      if (open) {
        open.postMessage({ open: chatId || "" });
        return open.focus();
      }
      return self.clients.openWindow(target.href);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./")))
  );
});
