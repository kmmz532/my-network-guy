// サービスワーカー。一度開いたあとは、オフラインでも起動できるようにする。
// ページ（HTML）はネットワーク優先（更新を逃さない）、ハッシュ付きの資材は保存を優先する。
// 版の文字列（下の CACHE）はビルド時に置き換わり、版が変わると古い保存を捨てる。
const CACHE = 'network-ya-__BUILD__';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache
        .addAll(['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'])
        // ビルドのすべての資材は、1つずつ保存する（1つが読めなくてもインストールは止めない。読めなかった資材は、開いたときに保存される）
        .then(() =>
          // 一度に保存する数を1件に絞る（同時の取得が重なると、初回の訪問で一部の取得が失敗することがあるため。B9）
          __ASSETS__.reduce((chain, url) => chain.then(() => cache.add(url).catch(() => undefined)), Promise.resolve()),
        ),
    ),
  );
});

// 新しい版は、利用者が更新を押すまで待機する（勝手には切り替えない）。ページが SKIP_WAITING を送ったら切り替える
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  event.respondWith(
    // 保存の照合が失敗したときは、ネットワークから取り直す（例外を外へ出さない。B9）
    caches.match(req).catch(() => undefined).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
