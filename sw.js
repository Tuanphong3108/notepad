const CACHE_NAME = 'notepad-md3-v10-multitab';

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@100..1000&family=Google+Sans+Code:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/markdown-it/dist/markdown-it.min.js',
  'https://cdn.jsdelivr.net/npm/markdown-it-task-lists/dist/markdown-it-task-lists.min.js',
  'https://tuanphong3108.github.io/md3-loading/Loading_Indicator.gif'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS.map((url) => cache.add(url))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((res) => res || caches.match('/index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
