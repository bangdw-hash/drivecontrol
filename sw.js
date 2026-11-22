const VER = 'dc-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './lib/txt.js', './lib/graph.js', './lib/store.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('drivecontrol', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('shares', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function saveShare(rec) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('shares', 'readwrite'); t.objectStore('shares').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData();
        const files = fd.getAll('files').filter((f) => f && f.name).map((f) => ({ name: f.name, type: f.type, blob: f }));
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await saveShare({ id, at: Date.now(), files, title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '' });
        return Response.redirect('./?shared=' + id, 303);
      } catch (err) {
        return Response.redirect('./?shareError=1', 303);
      }
    })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) caches.open(VER).then((c) => c.put(req, r.clone())); return r; }).catch(() => hit);
    return hit || net;
  }));
});
