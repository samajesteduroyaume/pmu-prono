// Service Worker Neutralisé - Elite Punter v16
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => {
            return Promise.all(names.map(name => caches.delete(name)));
        }).then(() => self.clients.claim())
    );
});
self.addEventListener('fetch', (event) => {
    // Ne rien mettre en cache, passer directement au réseau
    return;
});
