/* AmeSSIST iPhone版の Service Worker。画面のコードだけを端末に保存し、圏外でも開けるようにする（データは別。IndexedDB）。
   方式: 保存した版を、通信なしで、いつも先に使う（ギガを使わない。サイトが止まっても開ける）。
   更新: 画面（phone.js）が、1日1回まで、この sw.js だけを確かめる。V を変えると新しい版と見なし、全ファイルを取り直す。
   画面のコードを直したときは、V（と phone.js の APP_VER）を必ず上げる。 */
const V = 'amessist-phone-v3';
const FILES = ['./', 'index.html', 'phone.css', 'phone.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', '../style.css'];

self.addEventListener('install', e => {
  /* cache:'reload' = ブラウザの一時保存（GitHub Pagesは最大10分）を使わず、必ず最新を取る */
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(V);
    const hit = await cache.match(r, { ignoreSearch: true });
    if (hit) return hit;   // 保存した版があれば、通信しない
    try {
      const res = await fetch(r);
      if (res.ok) cache.put(r, res.clone());
      return res;
    } catch (err) {
      return r.mode === 'navigate' ? ((await cache.match('index.html')) || Response.error()) : Response.error();
    }
  })());
});
