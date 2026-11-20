// Робота без інтернету: усі файли програми зберігаються на пристрої.
// Після кожної зміни програми збільшуйте номер версії — тоді пристрої отримають оновлення.
const VERSION = 'kashkai-to-0.4.1';
const FILES = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/util.js', 'js/db.js', 'js/model.js', 'js/ocrparse.js', 'js/ocr.js', 'js/zip.js', 'js/obmin.js', 'js/excel.js', 'js/views.js', 'js/forms.js', 'js/app.js',
  'js/ocr-worker.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
// Великі файли розпізнавання (~27 МБ) лежать в окремому сховищі й не перекачуються
// при кожному оновленні програми. Міняйте номер лише тоді, коли міняєте ці файли.
const OCR_CACHE = 'kashkai-ocr-1';
const OCR_FILES = [
  'vendor/ort/ort.wasm.bundle.min.mjs', 'vendor/ort/ort-wasm-simd-threaded.wasm', 'vendor/ort/ort-wasm-simd-threaded.mjs',
  'vendor/ocr/det.onnx', 'vendor/ocr/rec.onnx', 'vendor/ocr/dict.txt',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })));
    const o = await caches.open(OCR_CACHE);
    for (const f of OCR_FILES) if (!(await o.match(f))) await o.add(new Request(f, { cache: 'reload' }));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== OCR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// Заголовки «ізоляції» дозволяють розпізнаванню працювати на кількох ядрах процесора
// (GitHub Pages сам таких заголовків не ставить). Усі файли програми — з того самого сайту.
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).catch(() => req.mode === 'navigate' ? caches.match('./') : Response.error());
    }).then(isolate)
  );
});
