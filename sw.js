const CACHE_NAME = 'notepad-v13-multitab';

// Relative URLs resolve against this file, so the cache works under any
// base path (the app is served from /notepad/, not from the site root).
const ASSETS = [
  './',
  'index.html',
  'index_md1.html',
  'about.html',
  'app.js',
  'editor.css',
  'manifest.json',
  'manifest_md1.json',
  'icon.png',
  'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@100..1000&family=Google+Sans+Code:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;700&family=Google+Sans+Code:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/markdown-it/dist/markdown-it.min.js',
  'https://cdn.jsdelivr.net/npm/markdown-it-task-lists/dist/markdown-it-task-lists.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js',
  'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js',
  'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/languages/powershell.min.js',
  'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/languages/dos.min.js',
  'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/languages/vbscript.min.js',
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

  const sameOrigin = new URL(req.url).origin === self.location.origin;

  // Our own pages and scripts: network first (always fresh), cache when offline.
  if (sameOrigin || req.mode === 'navigate') {
    event.respondWith(
      // 'no-cache' = always revalidate with the server, so GitHub Pages' 10-minute HTTP cache can't
      // serve a stale app.js next to a fresh index.html
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          if (req.mode === 'navigate') {
            const shell = await caches.match('index.html');
            if (shell) return shell;
          }
          return Response.error();
        })
    );
    return;
  }

  // Third-party libraries, fonts, spell-check dictionaries: cache first, and remember whatever is
  // downloaded on demand (dictionaries are versioned URLs, so they never go stale).
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
