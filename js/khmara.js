'use strict';
// Обмін через Google Диск.
//
// На Диску власника — папка «Кашкай ТО». Кожен пристрій тримає там один файл зі своїми даними (усі записи,
// без фото) і кладе фото окремими файлами — кожне один раз. Звірка: взяти файли інших пристроїв, що
// змінилися, злити (як прийом копії), докласти фото, яких на Диску ще немає, оновити свій файл.
// Усе, що лягає на Диск, зашифровано паролем власника (AES-GCM, ключ з пароля — PBKDF2). Сам пароль
// ніде не зберігається: пристрій пам'ятає лише ключ, який не можна витягти з браузера.
//
// Вхід у Google — переходом на сторінку Google і поверненням назад (не спливним вікном: «ізоляція»
// сторінки, потрібна розпізнаванню на кількох ядрах, рве зв'язок зі спливним вікном). Дозвіл —
// «drive.file»: програма бачить лише файли, які створила сама, решти Диска не бачить.
const Cloud = (() => {
  // Ідентифікатор клієнта з Google Cloud (не секрет: його бачить кожен, хто відкриє сайт).
  const CLIENT_ID = '687670430329-pd9mcqen7soalo2stgf6sjh8u4kdq59s.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // На перевірочному сервері — окрема папка, щоб випробування не змішались зі справжніми даними,
  // і за бажанням імітація Диска (адреса в localStorage 'kto.testDrive').
  let testApi = null;
  try { testApi = local && localStorage.getItem('kto.testDrive'); } catch (x) { /* немає сховища */ }
  const API = testApi || 'https://www.googleapis.com';
  const FOLDER = local ? 'Кашкай ТО (перевірка)' : 'Кашкай ТО';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const ITER = 600000;                 // повторів PBKDF2: підбір пароля стає дуже повільним
  const MAGIC = [75, 84, 79, 49];      // «KTO1» на початку кожного зашифрованого файла
  const CHECK = 'kashkai-to';
  const e = U.esc;
  const $ = id => document.getElementById(id);
  const tenc = new TextEncoder(), tdec = new TextDecoder();

  let busy = false, need = null, timer = null, statusText = '', last = null;

  const clientId = () => DB.getMeta('gClient') || CLIENT_ID;
  const sync0 = () => DB.getMeta('gSync') || null;
  const keyRec = () => DB.getMeta('gKey') || null;
  const on = () => !!(keyRec() || sync0());
  function token() { const g = DB.getMeta('gToken'); return g && g.exp > Date.now() ? g.t : null; }
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

  // ---------- вхід у Google ----------
  async function signIn(then) {
    const id = clientId();
    if (!id) { U.toast('Google Диск ще не налаштовано — див. Ще → Обмін даними', 5000); return; }
    const state = U.uid() + U.uid();
    let back = location.hash || '#/stan';
    if (!back.startsWith('#/')) back = '#/stan';
    await DB.setMeta('gAuth', { state, back, then: then || null, at: Date.now() });
    const p = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE,
      state, include_granted_scopes: 'true',
    });
    location.assign(AUTH + '?' + p);
  }

  // Повернулися від Google: адреса виду …/#state=…&access_token=… або …#error=…
  // Викликати до першого показу екрана. Відповідь: null | { ok, then } | { err }.
  async function catchReturn() {
    const h = location.hash;
    if (!/^#(?!\/).*\b(access_token|error)=/.test(h)) return null;
    const p = new URLSearchParams(h.slice(1));
    const pend = DB.getMeta('gAuth');
    await DB.setMeta('gAuth', null);
    history.replaceState(null, '', location.pathname + location.search + ((pend && pend.back) || '#/obmin'));
    if (!pend || p.get('state') !== pend.state || Date.now() - pend.at > 3600e3) {
      return { err: 'Відповідь Google не впізнано. Натисніть кнопку ще раз.' };
    }
    const err = p.get('error');
    if (err) {
      return { err: err === 'access_denied'
        ? 'Ви не дали програмі дозволу в Google — без нього обмін через Диск не працює.'
        : 'Google не впустив (' + err + '). Спробуйте ще раз.' };
    }
    const t = p.get('access_token');
    if (!t) return { err: 'Google не дав доступу. Спробуйте ще раз.' };
    if (!(p.get('scope') || '').split(/[ +]/).includes(SCOPE)) {
      return { err: 'Google не дав доступу до файлів на Диску. Натисніть ще раз і позначте пункт про файли Google Диска, які використовує ця програма.' };
    }
    const sec = Number(p.get('expires_in')) || 3600;
    await DB.setMeta('gToken', { t, exp: Date.now() + sec * 1000 - 120e3 });
    return { ok: true, then: pend.then };
  }

  // ---------- Google Диск ----------
  const authErr = () => Object.assign(new Error('Потрібно ще раз увійти в Google.'), { auth: true });
  // Разові збої Google (код 500–504, «зачекайте») — повторюємо до 3 разів із паузою 1, 2, 4 с, як радить Google.
  async function api(path, opt = {}) {
    for (let attempt = 0; ; attempt++) {
      const t = token();
      if (!t) throw authErr();
      let res;
      try {
        res = await fetch(API + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opt.headers) }));
      } catch (x) {
        throw new Error(navigator.onLine === false ? 'Немає інтернету.' : 'Google Диск не відповідає — перевірте інтернет.');
      }
      if (res.status === 401) { await DB.setMeta('gToken', null); throw authErr(); }
      if (res.ok) return res;
      let reason = '', msg = '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || ''; reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || ''; } catch (x) { /* не JSON */ }
      console.warn('Google Диск', res.status, reason, msg);
      if (/storageQuota/i.test(reason + msg)) throw new Error('На Google Диску закінчилось місце.');
      const busyG = /rateLimit|userRateLimit/i.test(reason) || res.status === 429;
      if ((busyG || [500, 502, 503, 504].includes(res.status)) && attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 500));
        continue;
      }
      if (busyG) throw new Error('Google просить зачекати — спробуйте за хвилину.');
      if (res.status >= 500) throw new Error('Google Диск тимчасово не працює — спробуйте пізніше.');
      throw new Error(`Google Диск відмовив (код ${res.status}).`);
    }
  }
  const quote = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Папку шукаємо щоразу: якщо два пристрої вперше створили її одночасно, усі беруть найстаршу.
  async function folder() {
    const q = new URLSearchParams({
      q: `mimeType='${FOLDER_MIME}' and name='${quote(FOLDER)}' and trashed=false`,
      fields: 'files(id,createdTime)', orderBy: 'createdTime', spaces: 'drive', pageSize: '10',
    });
    const j = await (await api('/drive/v3/files?' + q)).json();
    if (j.files && j.files.length) return j.files[0].id;
    const r = await api('/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME }),
    });
    const id = (await r.json()).id;
    await upload({ name: 'ПРО_ЦЮ_ПАПКУ.txt', parents: [id], mimeType: 'text/plain', appProperties: { k: 'readme' } }, tenc.encode(README));
    return id;
  }
  const README = 'Тут лежать дані програми «Кашкай ТО» для обміну між вашими пристроями (телефон, комп).\r\n'
    + 'Файли зашифровані вашим паролем — без нього їх не відкрити.\r\n'
    + 'Нічого тут не змінюйте й не видаляйте вручну: програма робить це сама.\r\n'
    + 'Якщо папку все ж видалити — нічого не пропаде: дані є на кожному пристрої, програма створить папку знову.\r\n';

  async function list(dir) {
    const out = [];
    let page = '';
    do {
      const q = new URLSearchParams({
        q: `'${dir}' in parents and trashed=false`, spaces: 'drive', pageSize: '1000',
        fields: 'nextPageToken,files(id,name,modifiedTime,size,appProperties)',
      });
      if (page) q.set('pageToken', page);
      const j = await (await api('/drive/v3/files?' + q)).json();
      out.push(...(j.files || []));
      page = j.nextPageToken;
    } while (page);
    return out;
  }

  // Новий файл (id не задано) або нова версія наявного. Розмір до 5 МБ — фото програма стискає до ~0,5 МБ.
  async function upload(meta, bytes, id) {
    const b = 'kto-' + U.uid();
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes, `\r\n--${b}--`,
    ]);
    const r = await api('/upload/drive/v3/files' + (id ? '/' + id : '') + '?uploadType=multipart&fields=id,modifiedTime,appProperties', {
      method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body,
    });
    return r.json();
  }
  async function download(id) {
    return new Uint8Array(await (await api(`/drive/v3/files/${id}?alt=media`)).arrayBuffer());
  }
  // У кошик Диска (не назавжди): Google сам очистить його за 30 днів.
  async function trash(id) {
    try {
      await api(`/drive/v3/files/${id}?fields=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      });
    } catch (x) { console.warn('Не вдалося прибрати файл з Диска', id, x); }
  }

  // ---------- шифрування ----------
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = u8 => [...u8].map(x => x.toString(16).padStart(2, '0')).join('');

  async function derive(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', tenc.encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // Позначка ключа: однакова на всіх пристроях з тим самим паролем; новий пароль — нова позначка.
  async function kidOf(salt) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', salt)).slice(0, 4)); }
  function head(kid) {
    const h = new Uint8Array(8);
    h.set(MAGIC);
    for (let i = 0; i < 4; i++) h[4 + i] = parseInt(kid.substr(i * 2, 2), 16);
    return h;
  }
  async function seal(k, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12)), h = head(k.kid);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: h }, k.key, bytes));
    const out = new Uint8Array(20 + ct.length);
    out.set(h); out.set(iv, 8); out.set(ct, 20);
    return out;
  }
  async function unseal(k, u8) {
    const h = u8.subarray(0, 8);
    if (u8.length < 36 || MAGIC.some((x, i) => h[i] !== x)) throw new Error('це не файл програми');
    if (head(k.kid).some((x, i) => x !== h[i])) throw Object.assign(new Error('записано з іншим паролем'), { oldKey: true });
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(8, 20), additionalData: h }, k.key, u8.subarray(20)));
    } catch (x) { throw Object.assign(new Error('файл пошкоджено'), { oldKey: true }); }
  }

  // Дані стискаємо (текст стискається в 5–8 разів), фото — ні (JPEG уже стиснутий).
  const pipe = (u8, t) => new Response(new Blob([u8]).stream().pipeThrough(t)).arrayBuffer().then(b => new Uint8Array(b));
  async function pack(obj) {
    const u8 = tenc.encode(JSON.stringify(obj));
    return typeof CompressionStream === 'function' ? pipe(u8, new CompressionStream('gzip')) : u8;
  }
  async function unpack(u8) {
    if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = await pipe(u8, new DecompressionStream('gzip'));
    return JSON.parse(tdec.decode(u8));
  }

  // Ключ: файл «kashkai_ключ.json» на Диску (сіль, кількість повторів і перевірка пароля).
  // Найстаріший такий файл — головний (якщо раптом два пристрої створили його одночасно).
  const kind = f => (f.appProperties || {}).k;
  function keyFile(files) {
    return files.filter(f => kind(f) === 'key').sort((a, b) => (a.modifiedTime < b.modifiedTime ? -1 : 1))[0] || null;
  }

  async function usePassword(pw) {
    if (!need) throw new Error('Пароль зараз не потрібен.');
    if (need.need === 'new') {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await derive(pw, salt, ITER), kid = await kidOf(salt);
      const k = { key, kid };
      const info = { app: 'kashkai-to', v: 1, salt: b64(salt), iter: ITER, check: b64(await seal(k, tenc.encode(CHECK))) };
      await upload({ name: 'kashkai_ключ.json', parents: [need.folder], mimeType: 'application/json', appProperties: { k: 'key', key: kid } },
        tenc.encode(JSON.stringify(info, null, 1)));
      await DB.setMeta('gKey', { key, kid, at: Date.now() });
    } else {
      const info = need.info;
      const salt = unb64(info.salt), kid = await kidOf(salt);
      const key = await derive(pw, salt, info.iter || ITER);
      let ok = false;
      try { ok = tdec.decode(await unseal({ key, kid }, unb64(info.check))) === CHECK; } catch (x) { ok = false; }
      if (!ok) throw new Error('Пароль не той. Спробуйте ще раз (великі й малі літери різняться).');
      await DB.setMeta('gKey', { key, kid, at: Date.now() });
    }
    need = null;
  }

  // ---------- звірка ----------
  function setStatus(t) {
    statusText = t;
    const el = $('cloudState');
    if (el) el.innerHTML = t ? `<p class="muted">${e(t)}</p>` : '';
  }
  const safeName = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);

  // manual — натиснули кнопку: можна піти на вхід у Google, показувати повідомлення.
  async function sync(manual) {
    clearTimeout(timer); timer = null;
    if (busy) return;
    if (!clientId()) { if (manual) { U.toast('Google Диск ще не налаштовано — див. Ще → Обмін даними', 5000); go(); } return; }
    if (!token()) { if (manual) await signIn('sync'); return; }
    busy = true;
    setStatus('Звіряюся з Google Диском…');
    const sum = { got: [], photosUp: 0, sent: false, old: [] };
    let ok = false;
    try {
      const dir = await folder();
      const files = await list(dir);
      const kf = keyFile(files);
      const mine = keyRec();
      if (!kf || !mine || !mine.key || mine.kid !== (kf.appProperties || {}).key) {
        need = kf ? { need: 'old', info: JSON.parse(tdec.decode(await download(kf.id))), folder: dir } : { need: 'new', folder: dir };
        if (kf && mine) await DB.setMeta('gKey', null);   // пароль на Диску змінили з іншого пристрою
        setStatus('');
        busy = false;
        if (manual) { go(); U.toast(need.need === 'new' ? 'Придумайте пароль для Google Диска' : 'Введіть пароль Google Диска', 5000); }
        else { U.toast('Google Диск просить пароль: Ще → Обмін даними', 6000); refresh(); }
        return;
      }
      const k = mine;
      const st = sync0() || {};
      const seen = Object.assign({}, st.seen);
      const photos = new Map(), stale = [];
      for (const f of files) {
        const a = f.appProperties || {};
        if (a.k === 'photo') { if (a.key === k.kid) photos.set(a.id, f); else stale.push(f); }
        else if (a.k === 'key' && f !== kf) stale.push(f);
      }

      // 1. Зміни інших пристроїв.
      let own = null;
      const peers = [];
      for (const f of files.filter(x => kind(x) === 'data')) {
        const a = f.appProperties;
        if (a.key !== k.kid) { stale.push(f); if (a.dev !== DB.device) sum.old.push(a.name || f.name); continue; }
        if (a.dev === DB.device) {
          if (!own || f.modifiedTime > own.modifiedTime) { if (own) stale.push(own); own = f; } else stale.push(f);
          continue;
        }
        peers.push({ dev: a.dev, name: a.name || 'Інший пристрій', at: Date.parse(f.modifiedTime) || 0, id: f.id });
        if (seen[f.id] === f.modifiedTime) continue;
        const name = a.name || 'іншого пристрою';
        setStatus(`Беру зміни з «${name}»…`);
        let data;
        try { data = await unpack(await unseal(k, await download(f.id))); }
        catch (x) { if (x.auth) throw x; console.warn(x); sum.old.push(name); continue; }
        const r = await Obmin.mergeData(data, async m => {
          const pf = photos.get(m.id);
          if (!pf) throw new Error('фото ще немає на Диску');
          return new Blob([await unseal(k, await download(pf.id))], { type: m.mime || 'image/jpeg' });
        }, (i, n) => { if (n > 3) setStatus(`Беру фото з «${name}»… ${i} з ${n}`); });
        if (!r.bad) seen[f.id] = f.modifiedTime;
        r.from = name;
        sum.got.push(r);
      }

      // 2. Фото, яких на Диску ще немає; видалені тут — з Диска в кошик.
      const local = DB.allFiles();
      const todo = local.filter(f => !f.del && !photos.has(f.id));
      let n = 0;
      for (const f of todo) {
        setStatus(`Надсилаю фото… ${++n} з ${todo.length}`);
        const rec = await DB.getFile(f.id);
        if (!rec || !(rec.blob instanceof Blob)) continue;
        const bytes = await seal(k, new Uint8Array(await rec.blob.arrayBuffer()));
        photos.set(f.id, await upload({ name: `фото_${f.id}.kto`, parents: [dir], appProperties: { k: 'photo', id: f.id, key: k.kid } }, bytes));
        sum.photosUp++;
      }
      for (const f of local) if (f.del && photos.has(f.id)) { stale.push(photos.get(f.id)); photos.delete(f.id); }

      // 3. Свій файл даних — якщо щось змінилось (тут чи щойно прийняте), змінили назву чи пароль.
      const me = Obmin.myName();
      const mk = Obmin.mark();   // відбиток і дані беремо разом, без очікувань між ними
      if (!own || st.mark !== mk || st.kid !== k.kid || (own.appProperties || {}).name !== me) {
        setStatus('Надсилаю свої дані…');
        const { now, sel, data } = Obmin.payload(null);
        data.files = sel.files.filter(f => f.del || photos.has(f.id)).map(({ size: _s, ...m }) => m);
        const bytes = await seal(k, await pack(data));
        const meta = { name: `дані_${safeName(me)}_${DB.device}.kto`, appProperties: { k: 'data', dev: DB.device, name: me.slice(0, 40), key: k.kid } };
        if (own) await upload(meta, bytes, own.id);
        else await upload(Object.assign({ parents: [dir] }, meta), bytes);
        await DB.setMeta('clock', now);
        sum.sent = true;
      }
      for (const f of stale) await trash(f.id);
      await DB.setMeta('gSync', { at: Date.now(), mark: mk, kid: k.kid, seen, peers, err: null });
      await Obmin.copied(mk);
      ok = true;
      last = sum;
    } catch (err) {
      console.error(err);
      const st = sync0();
      if (st) await DB.setMeta('gSync', Object.assign({}, st, { err: err.message, errAt: Date.now() }));
      setStatus('');
      if (err.auth) { if (manual) { busy = false; await signIn('sync'); return; } }
      else if (manual) U.toast('Обмін через Google Диск не вдався: ' + err.message, 7000);
    } finally { busy = false; }
    setStatus('');
    const changed = sum.got.some(r => r.added + r.updated + r.deleted + r.photos + r.photosDel);
    if (ok && (manual || changed)) U.toast(result(sum), manual ? 7000 : 5000);
    if (manual || changed || location.hash === '#/obmin') refresh();
  }

  // Перемалювати екран, не збиваючи прокрутку. Поки відкрита форма — ні: зникло б уже введене.
  function refresh() {
    if (document.querySelector('form[data-form]')) return;
    const y = window.scrollY;
    App.refresh();
    window.scrollTo(0, y);
  }

  function result(sum) {
    const parts = sum.got.map(r => {
      const ch = [];
      if (r.added) ch.push(`нових ${r.added}`);
      if (r.updated) ch.push(`оновлено ${r.updated}`);
      if (r.deleted) ch.push(`видалено ${r.deleted}`);
      if (r.photos) ch.push(`фото ${r.photos}`);
      if (r.photosDel) ch.push(`видалено фото ${r.photosDel}`);
      if (r.kept) ch.push(`тут новіші, лишено ці: ${r.kept}`);
      return `з «${r.from}» — ${ch.length ? ch.join(', ') : 'нового немає'}${r.bad ? ` (фото не взято: ${r.bad}, візьму наступного разу)` : ''}`;
    });
    const out = [];
    if (sum.sent) out.push('зміни');
    if (sum.photosUp) out.push(`фото ${sum.photosUp}`);
    const s = [];
    if (parts.length) s.push('Отримано ' + parts.join('; ') + '.');
    if (out.length) s.push('На Диск надіслано: ' + out.join(', ') + '.');
    if (!s.length) s.push('Усе вже однакове.');
    if (sum.old.length) s.push(`Дані «${sum.old.join('», «')}» записано зі старим паролем — оновляться, коли той пристрій обміняється знову.`);
    return 'Google Диск. ' + s.join(' ');
  }

  // Показати панель (з полем пароля), якщо зараз інший екран.
  function go() { if (location.hash !== '#/obmin') location.hash = '#/obmin'; else App.refresh(); }

  // Звірка сама: через хвилину після змін — доки вхід у Google ще дійсний (година після натискання).
  function soon(delay = 60e3) {
    if (busy || need || !token() || !keyRec()) return;
    const st = sync0();
    if (delay > 0 && st && st.mark === Obmin.mark()) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync(false), delay);
  }

  // Запуск програми. ret — відповідь catchReturn().
  function init(ret) {
    if (ret && ret.err) { U.toast(ret.err, 8000); return; }
    if (ret && ret.ok) {
      if (ret.then === 'restart') restart(true);
      else sync(true);
      return;
    }
    if (on() && token()) timer = setTimeout(() => sync(false), 3000);
    // Повернулися до програми — заберемо свіже з інших пристроїв, якщо вхід ще дійсний.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || busy || need || !token() || !keyRec()) return;
      const st = sync0();
      if (!st || Date.now() - st.at > 120e3) { clearTimeout(timer); timer = setTimeout(() => sync(false), 1000); }
    });
  }

  // ---------- кнопки ----------
  async function submitPw() {
    const p1 = $('cpw1') ? $('cpw1').value : '', p2el = $('cpw2');
    const out = $('cpwErr'), btn = $('cpwBtn');
    const say = t => { if (out) out.innerHTML = t; };
    if (p1.length < 6) { say('<p class="err">Пароль закороткий — щонайменше 6 знаків.</p>'); return; }
    if (p2el && p2el.value !== p1) { say('<p class="err">Паролі не збігаються.</p>'); return; }
    if (btn) btn.disabled = true;
    say('<p class="muted">Перевіряю пароль…</p>');
    try { await usePassword(p1); }
    catch (err) {
      console.error(err);
      if (btn) btn.disabled = false;
      if (err.auth) { await signIn('sync'); return; }
      say(`<p class="err">${e(err.message)}</p>`);
      return;
    }
    App.refresh();
    sync(true);
  }

  async function saveClient() {
    const v = ($('gClientId') || {}).value || '';
    const id = v.trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) { U.toast('Це не схоже на ідентифікатор клієнта: він закінчується на .apps.googleusercontent.com', 6000); return; }
    await DB.setMeta('gClient', id);
    U.toast('Збережено. Тепер — «Підключити Google Диск».', 4000);
    App.refresh();
  }

  async function disconnect() {
    if (!confirm('Більше не обмінюватися через Google Диск на цьому пристрої? Файли на Диску й дані тут лишаться; підключити знову можна будь-коли (знадобиться пароль).')) return;
    clearTimeout(timer);
    need = null;
    await DB.setMeta('gKey', null);
    await DB.setMeta('gSync', null);
    await DB.setMeta('gToken', null);
    App.refresh();
  }

  // Почати заново з новим паролем: усі файли програми на Диску — у кошик, далі — як уперше.
  // Дані не пропадають: вони є на кожному пристрої; інші пристрої попросять новий пароль.
  async function restart(after) {
    if (busy) return;
    // after — повернулися від Google після входу: власник уже погодився перед тим.
    if (!after && !confirm('Почати обмін через Google Диск заново з новим паролем? Файли програми на Диску підуть у кошик (дані на пристроях лишаться). На інших пристроях програма попросить новий пароль.')) return;
    if (!token()) { await signIn('restart'); return; }
    busy = true;
    setStatus('Прибираю файли на Диску…');
    try {
      const dir = await folder();
      for (const f of await list(dir)) if (kind(f) !== 'readme') await trash(f.id);
      await DB.setMeta('gKey', null);
      await DB.setMeta('gSync', null);
      need = { need: 'new', folder: dir };
    } catch (err) {
      console.error(err);
      if (err.auth && !after) { busy = false; await signIn('restart'); return; }
      U.toast('Не вдалося: ' + err.message, 6000);
    } finally { busy = false; }
    setStatus('');
    go();
  }

  // ---------- вигляд ----------
  const when = ms => Obmin.when(ms);

  function panel() {
    const head = '<h3>Google Диск</h3>';
    if (!clientId()) {
      return `<section class="panel">${head}
        <p>Обмін через інтернет: кожен пристрій кладе свої дані на ваш Google Диск і бере звідти зміни інших. Файли зашифровані вашим паролем.</p>
        <p class="muted small">Щоб увімкнути, у програму треба один раз вписати «ідентифікатор клієнта» з Google Cloud (як його отримати — в інструкції).</p>
        <label class="fld"><input id="gClientId" placeholder="….apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
        <p class="actions"><button class="btn ghost" data-act="cloud-client">Зберегти</button></p>
      </section>`;
    }
    if (need) {
      const isNew = need.need === 'new';
      return `<section class="panel">${head}
        <form id="cloudPw" class="form" autocomplete="on">
          ${isNew
            ? `<p>Придумайте пароль для файлів на Диску. Його треба буде ввести один раз на кожному іншому пристрої.</p>
               <p class="muted small">Запишіть його й тримайте вдома. Якщо забудете — дані на пристроях не пропадуть, але обмін доведеться почати заново з новим паролем.</p>`
            : `<p>Введіть пароль Google Диска — той, що придумали на першому пристрої.</p>`}
          <input type="text" name="username" value="Кашкай ТО — Google Диск" autocomplete="username" hidden>
          <label class="fld"><span>Пароль</span><input type="password" id="cpw1" autocomplete="${isNew ? 'new-password' : 'current-password'}" required></label>
          ${isNew ? '<label class="fld"><span>Ще раз той самий</span><input type="password" id="cpw2" autocomplete="new-password" required></label>' : ''}
          <div id="cpwErr"></div>
          <p class="actions"><button class="btn" id="cpwBtn" type="submit">${isNew ? 'Зберегти пароль' : 'Продовжити'}</button></p>
        </form>
        ${isNew ? '' : '<p class="muted small">Забули пароль? <button type="button" class="linkbtn" data-act="cloud-restart">Почати обмін заново з новим паролем</button></p>'}
      </section>`;
    }
    const st = sync0();
    if (!on()) {
      return `<section class="panel">${head}
        <p>Обмін через інтернет, без перенесення файлів: кожен пристрій кладе свої дані на ваш Google Диск і бере звідти зміни інших. Файли зашифровані вашим паролем; програма бачить на Диску лише свою папку «${e(FOLDER)}».</p>
        <p class="muted small">Google попросить увійти й дозволити програмі доступ до її файлів на Диску. На всіх пристроях входьте тим самим обліковим записом Google. На першому пристрої ви придумаєте пароль, на інших — введете його.</p>
        <p class="actions"><button class="btn" data-act="cloud-sync">Підключити Google Диск</button></p>
        <div id="cloudState"></div>
      </section>`;
    }
    const ps = (st && st.peers) || [];
    const peerRows = ps.length
      ? `<div class="files">${ps.slice().sort((a, b) => b.at - a.at).map(p => `<div class="file-row"><span><b>${e(p.name)}</b>
          <span class="sub">дані на Диску від ${when(p.at)}</span></span></div>`).join('')}</div>`
      : '<p class="muted small">Інших пристроїв на Диску поки немає — підключіть Google Диск і там.</p>';
    const fresh = !!token();
    return `<section class="panel">${head}
        <p>${st ? `Останній обмін: <b>${when(st.at)}</b>` : 'Обміну ще не було'}${st && st.mark !== Obmin.mark() ? '<br><span class="sub">Тут є зміни, яких на Диску ще немає.</span>' : ''}</p>
        ${st && st.err && st.errAt > st.at ? `<p class="err small">Остання спроба не вдалася: ${e(st.err)}</p>` : ''}
        ${peerRows}
        <p class="actions"><button class="btn" data-act="cloud-sync">Обмінятися зараз</button></p>
        <div id="cloudState">${statusText ? `<p class="muted">${e(statusText)}</p>` : ''}</div>
        <p class="muted small">${fresh
          ? 'Ще близько години після натискання програма обмінюється сама: через хвилину після змін і коли до неї повертаєтесь.'
          : 'Натисніть «Обмінятися зараз» після змін тут і перед тим, як щось вносити, — щоб узяти зміни з інших пристроїв. Google може на мить показати свою сторінку.'}</p>
        <details><summary>Додатково</summary>
          <p class="actions"><button class="btn ghost small" data-act="cloud-off">Відключити на цьому пристрої</button>
            <button class="btn ghost small" data-act="cloud-restart">Почати заново з новим паролем</button></p>
        </details>
      </section>`;
  }

  // Нагадування на «Стані», якщо давно не обмінювались.
  function note() {
    if (need && need.need === 'old') return '<div class="hint">Google Диск просить пароль (його змінили на іншому пристрої). <a href="#/obmin">Ввести</a></div>';
    const st = sync0();
    if (!on() || !st || !clientId()) return '';
    const days = Math.floor((Date.now() - st.at) / 864e5);
    if (days < 3) return '';
    return `<div class="hint">З Google Диском не обмінювались ${U.daysText(days)}. <button type="button" class="linkbtn" data-act="cloud-sync">Обмінятися</button></div>`;
  }

  function after() {
    const f = $('cpw1');
    if (f && !f.value) f.focus();
  }

  return {
    catchReturn, init, sync, soon, panel, note, after, submitPw, saveClient, disconnect, restart,
    isBusy: () => busy, on,
    _t: { seal, unseal, derive, kidOf, pack, unpack },   // для перевірок
  };
})();
