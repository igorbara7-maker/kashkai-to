// Робота без інтернету: усі файли програми зберігаються на пристрої.
// Після кожної зміни програми збільшуйте номер версії — тоді пристрої отримають оновлення.
const VERSION = 'kashkai-to-0.23.1';
const FILES = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/util.js', 'js/db.js', 'js/model.js', 'js/ocrparse.js', 'js/ocr.js', 'js/chek.js', 'js/kamera.js', 'js/zip.js', 'js/folder.js', 'js/obmin.js', 'js/khmara.js', 'js/excel.js', 'js/palne.js', 'js/shyny.js', 'js/poizdky.js', 'js/zapchasty.js', 'js/views.js', 'js/forms.js', 'js/app.js',
  'js/ocr-worker.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
// Великі файли розпізнавання (~27 МБ) лежать в окремому сховищі й не перекачуються
// при кожному оновленні програми. Міняйте номер лише тоді, коли міняєте ці файли.
const OCR_CACHE = 'kashkai-ocr-1';
// Фото, надіслані в програму через «Поділитися» (з галереї, камери): лежать тут, доки програма їх не забере.
const SHARE_CACHE = 'kashkai-share';
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
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== OCR_CACHE && k !== SHARE_CACHE).map(k => caches.delete(k))))
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

// «Поділитися → Кашкай ТО»: система надсилає фото сюди (POST …/share), без інтернету теж.
async function receiveShare(req) {
  const c = await caches.open(SHARE_CACHE);
  for (const k of await c.keys()) await c.delete(k);
  try {
    const fd = await req.formData();
    let i = 0;
    for (const f of fd.getAll('photos')) {
      if (!f || !f.size) continue;
      await c.put('shared/' + i++, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg', 'X-Name': encodeURIComponent(f.name || '') } }));
    }
  } catch (err) { /* порожньо — програма скаже, що фото не отримано */ }
  return Response.redirect(new URL('./#/share', self.registration.scope).href, 303);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && /\/share$/.test(url.pathname)) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).catch(() => req.mode === 'navigate' ? caches.match('./') : Response.error());
    }).then(isolate)
  );
});
