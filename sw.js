/* ==========================================================
   sw.js — Service Worker
   ・HTML/JSはネットワーク優先（更新をすぐ反映）
   ・アイコン等の静的アセットはキャッシュ優先（オフライン対応）
   ========================================================== */
const CACHE_NAME = 'monster-catapult-v34';
const APP_SHELL = [
  './',
  './index.html',
  './mc-game.js',
  './mc-firebase.js',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './bg-meadow.jpg',
  './bg-forest.jpg',
  './bg-cave.jpg',
  './bg-snow.jpg',
  './bg-volcano.jpg',
  './block-stone.jpg',
  './castle-tower.png',
  './castle-wall.png',
  './castle-keep.png',
  './launcher-cannon-tower.png',
  './monster-slime.png',
  './monster-woodkin.png',
  './monster-phoenix.png',
  './monster-icegolem.png',
  './monster-skeleton.png',
  './monster-centaur.png',
  './monster-dragon.png',
  './monster-spikeball.png',
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=> cache.addAll(APP_SHELL)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=> k!==CACHE_NAME).map(k=> caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  const isAppShell = /\.(html|js)$/.test(new URL(req.url).pathname) || req.mode === 'navigate';

  if(isAppShell){
    event.respondWith(
      fetch(req).then(res=>{
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache=> cache.put(req, clone)).catch(()=>{});
        return res;
      }).catch(()=> caches.match(req).then(cached=> cached || caches.match('./index.html')))
    );
  } else {
    event.respondWith(
      caches.match(req).then(cached=>{
        if(cached) return cached;
        return fetch(req).then(res=>{
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache=> cache.put(req, clone)).catch(()=>{});
          return res;
        }).catch(()=> cached);
      })
    );
  }
});
