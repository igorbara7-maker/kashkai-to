'use strict';
// Обмін між пристроями (телефон ↔ комп). Копія — архів ZIP: дані (kashkai.json) і фото (foto/…).
//
// «Лише зміни»: кожна копія несе відомості, що вже є на пристрої-відправнику
// (have: пристрій → час його найновішої зміни, яку відправник має). Прийнявши копію від «Комп»,
// телефон знає, що там уже є, і далі шле лише новіше. Якщо файл зі змінами загубився — не страшно:
// доки звідти не прийде нова копія, кожні наступні «зміни» містять і все попереднє.
// Копія «лише змін» пам'ятає, від чого її рахували (base). Якщо на приймачі чогось із того бракує
// (дані стерли, файл призначався іншому пристрою), програма попередить і попросить повну копію.
const Obmin = (() => {
  const FORMAT = 2;
  const DATA = 'kashkai.json';
  const e = U.esc;
  let ready = null;   // підготовлений файл { file, sum }
  let busy = false;

  const defaultName = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'Телефон' : 'Комп';
  const myName = () => DB.getMeta('deviceName') || defaultName();
  const know = () => DB.getMeta('know') || {};
  const peers = () => DB.getMeta('peers') || {};
  const $ = id => document.getElementById(id);

  function peerList() {
    const ps = peers();
    return Object.keys(ps).filter(id => id !== DB.device)
      .map(id => Object.assign({ id }, ps[id])).sort((a, b) => (b.got || 0) - (a.got || 0));
  }

  const pad = n => String(n).padStart(2, '0');
  function when(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function size(b) {
    if (b < 1048576) return Math.max(1, Math.round(b / 1024)) + ' КБ';
    return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
  }
  const ext = mime => ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.bin');

  // Що піде в копію: усе (peerId порожній) або лише те, чого на пристрої peerId ще немає.
  function select(peerId) {
    const base = peerId ? Object.assign({}, (peers()[peerId] || {}).have) : null;
    const pick = x => !base || base[x.dev] == null || x.u > base[x.dev];
    const records = DB.allRecords().filter(pick);
    const files = DB.allFiles().filter(pick);
    const photos = files.filter(f => !f.del);
    return { base, records, files, photos, bytes: photos.reduce((s, f) => s + (f.size || 0), 0) };
  }

  // ---------- підготовка копії ----------
  // Дані копії без фото (files заповнює той, хто знає, де лежатимуть фото: архів чи Google Диск).
  // Після успішного запису копії викличте DB.setMeta('clock', now).
  function payload(peerId) {
    const now = DB.clock();
    const sel = select(peerId);
    const have = Object.assign({}, know());
    have[DB.device] = now;
    const data = {
      app: 'kashkai-to', format: FORMAT, created: new Date(now).toISOString(),
      device: DB.device, deviceName: myName(), have, base: sel.base, for: peerId || null,
      records: sel.records, files: [],
    };
    return { now, sel, data };
  }

  async function build(peerId, onStep) {
    const m = mark();
    const { now, sel, data } = payload(peerId);
    const entries = [], files = data.files;
    for (const f of sel.files) {
      const { size: _s, ...m } = f;
      if (!f.del) {
        const rec = await DB.getFile(f.id);
        if (!rec || !(rec.blob instanceof Blob)) continue;   // фото зникло — не обіцяємо його
        m.path = 'foto/' + f.id + ext(f.mime);
        entries.push({ name: m.path, data: rec.blob });
      }
      files.push(m);
    }
    entries.unshift({ name: DATA, data: JSON.stringify(data) });
    const zip = await Zip.write(entries, onStep);
    await DB.setMeta('clock', now);
    const d = new Date(now);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    const name = `кашкай_${peerId ? 'зміни' : 'копія'}_${who()}_${stamp}.zip`;
    return {
      file: new File([zip], name, { type: 'application/zip' }),
      sum: { records: sel.records.length, photos: entries.length - 1, peer: peerId ? (peers()[peerId] || {}).name : null },
      mark: m,
    };
  }
  const who = () => myName().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);

  // Chrome, Edge, Opera (рушій Chromium) через «Поділитися» пускають лише фото, відео, PDF і текст:
  // .zip відхиляють, хоча canShare відповідає «можна» (перевірено на Poco F7, 2026-11-20).
  // Тому там — лише «Зберегти у файл». Якщо надсилання не вдалося деінде — пристрій це запам'ятовує.
  const NO_SHARE = 'kashkai.noFileShare';
  function canShare(file) {
    try {
      if (navigator.userAgentData || localStorage.getItem(NO_SHARE)) return false;
      return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    } catch (x) { return false; }
  }

  async function make() {
    if (busy) return;
    const out = $('obminOut');
    const pick = document.querySelector('input[name="obminWhat"]:checked');
    const peerId = pick ? pick.value : '';
    busy = true;
    ready = null;
    out.innerHTML = '<p class="muted">Готую файл…</p>';
    try {
      ready = await build(peerId, (i, n) => { if (n > 3) out.innerHTML = `<p class="muted">Готую файл… ${i} з ${n}</p>`; });
      showReady();
    } catch (err) {
      console.error(err);
      out.innerHTML = `<p class="err">Не вдалося підготувати файл: ${e(err.message)}</p>`;
    } finally { busy = false; }
  }

  function showReady() {
    const out = $('obminOut');
    if (!ready || !out) return;
    const f = ready.file, s = ready.sum, share = canShare(f);
    const phone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const dir = Folder.name() ? `папка «${e(Folder.name())}»` : 'папка «Завантаження» (Download)';
    const hint = share
      ? '«Надіслати» → виберіть <b>LocalSend</b> → пристрій, на який надсилаєте.'
      : phone
        ? `Натисніть «Зберегти у файл». Потім у <b>LocalSend</b>: «Надіслати» → «Файл» → ${dir} → цей файл.`
        : `Файл ляже в ${Folder.name() ? 'папку «' + e(Folder.name()) + '»' : 'папку «Завантаження»'}. Перетягніть його у вікно <b>LocalSend</b> і виберіть пристрій.`;
    out.innerHTML = `<div class="ready">
        <p><b>Файл готовий</b><br><span class="small">${e(f.name)}</span><br>
        <span class="sub">${size(f.size)} · записів ${s.records}, фото ${s.photos}</span></p>
        <p class="actions">${share ? '<button class="btn" data-act="obmin-share">Надіслати</button>' : ''}
          <button class="btn${share ? ' ghost' : ''}" data-act="obmin-save">Зберегти у файл</button></p>
        <p class="muted small">${hint}</p></div>`;
  }

  async function share() {
    if (!ready) return;
    try { await navigator.share({ files: [ready.file], title: ready.file.name }); await copied(ready.mark); }
    catch (err) {
      if (err && err.name === 'AbortError') return;   // власник передумав
      try { localStorage.setItem(NO_SHARE, '1'); } catch (x) { /* без сховища — лише цього разу */ }
      showReady();
      U.toast('Цей пристрій не надсилає такі файли напряму — натисніть «Зберегти у файл»', 6000);
    }
  }
  async function save() {
    if (!ready) return;
    const f = ready.file;
    let msg = 'Файл збережено в «Завантаження»';
    try {
      if (await Folder.save(f)) msg = `Файл збережено в папку «${Folder.name()}»`;
      else U.download(f.name, f);
    } catch (err) {
      console.error(err);
      U.download(f.name, f);
      msg = `У папку «${Folder.name()}» записати не вдалося — файл збережено в «Завантаження»`;
    }
    await Folder.made(f.name);
    await copied(ready.mark);
    U.toast(msg, 5000);
  }

  // ---------- автокопія ----------
  // Якщо вибрано папку програми і браузер пам'ятає дозвіл на неї, програма сама тримає там одну
  // повну копію (файл перезаписується після змін) — на випадок, коли браузер стер дані чи програму видалили.
  // Окремо пам'ятаємо, коли востаннє робили будь-яку копію (lastCopy), — для нагадування на «Стані».
  const AUTO = 'autoCopy', LAST = 'lastCopy';
  const AUTO_GAP = 5 * 60e3;   // не частіше ніж раз на 5 хвилин (крім згортання програми)
  let autoTimer = null, autoErr = null;

  // Відбиток даних: міняється з кожною зміною будь-якого запису чи фото (тут чи прийнятою з іншого пристрою).
  function mark() {
    let n = 0, s = 0;
    for (const r of DB.allRecords()) { n++; s += r.u % 1e10; }
    for (const f of DB.allFiles()) { n++; s += f.u % 1e10; }
    return n + ':' + s;
  }
  const autoName = () => `кашкай_автокопія_${who()}_${DB.device.slice(0, 4)}.zip`;
  const auto = () => DB.getMeta(AUTO) || null;
  const lastCopy = () => DB.getMeta(LAST) || null;
  const unsaved = () => { const l = lastCopy(); return !!DB.allRecords().length && (!l || l.mark !== mark()); };
  const copied = m => DB.setMeta(LAST, { at: Date.now(), mark: m });

  async function exists(h, name) {
    try { await h.getFileHandle(name); return true; } catch (x) { return false; }
  }

  // Записати автокопію. ask=true — після натискання кнопки: можна спитати дозволу на папку, пишемо завжди.
  // Відповідь: 'done' | 'same' (копія й так свіжа) | 'noaccess' | 'busy' | 'nofolder'.
  async function autoRun(ask) {
    if (!Folder.name()) return 'nofolder';
    if (busy) return 'busy';
    if (!DB.allRecords().length) return 'same';
    const h = await Folder.access(ask);
    if (!h) return 'noaccess';
    const a = auto(), name = autoName();
    if (!ask && a && a.mark === mark() && a.name === name && await exists(h, name)) return 'same';
    if (busy) return 'busy';
    busy = true;
    try {
      const r = await build(null);
      const f = new File([r.file], name, { type: 'application/zip' });
      await Folder.made(name);   // свою копію не пропонуємо «Прийняти»
      await Folder.save(f, h);
      const nRec = DB.allRecords().filter(x => !x.del).length;
      await DB.setMeta(AUTO, { at: Date.now(), mark: r.mark, name, size: f.size, records: nRec, photos: r.sum.photos });
      await copied(r.mark);
      autoErr = null;
      // Пристрій перейменували — стару автокопію прибираємо, щоб не плутала.
      if (a && a.name && a.name !== name) { try { await h.removeEntry(a.name); } catch (x) { /* її вже немає */ } }
      return 'done';
    } catch (err) {
      autoErr = err.message || String(err);
      throw err;
    } finally { busy = false; }
  }

  // Коли писати: через хвилину спокою після змін, при згортанні програми, після запуску.
  function autoSoon(delay = 60e3) {
    if (!Folder.name()) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => autoTick(false), delay);
  }
  async function autoTick(now) {
    clearTimeout(autoTimer);
    autoTimer = null;
    const a = auto();
    if (!now && a && Date.now() - a.at < AUTO_GAP) { autoSoon(AUTO_GAP - (Date.now() - a.at) + 1000); return; }
    try { if (await autoRun(false) === 'busy') autoSoon(); }
    catch (err) { console.warn('Автокопію не записано', err); }
  }

  // Кнопка «Зробити копію»: у папку програми, а якщо її немає чи доступу не дали — файлом у «Завантаження».
  async function backupNow() {
    if (busy) return;
    if (Folder.name()) {
      try {
        if (await autoRun(true) === 'done') { U.toast(`Копію записано в папку «${Folder.name()}»`, 4000); App.refresh(); return; }
      } catch (err) { console.error(err); }
    }
    busy = true;
    try {
      const r = await build(null);
      U.download(r.file.name, r.file);
      await Folder.made(r.file.name);
      await copied(r.mark);
      U.toast('Повну копію збережено в «Завантаження». Надішліть її на інший пристрій або перенесіть на флешку.', 7000);
    } catch (err) {
      console.error(err);
      U.toast('Не вдалося зробити копію: ' + err.message, 6000);
    } finally { busy = false; }
    App.refresh();
  }

  // Перший запуск з автокопією: відлік «давно не було копії» починаємо з сьогодні.
  async function init() {
    if (!lastCopy()) await DB.setMeta(LAST, { at: Date.now(), mark: null });
    autoSoon(5000);
  }

  // ---------- папка програми ----------
  let folderList = [];
  async function fillFolder(ask) {
    const box = $('folderFiles');
    if (!box || !Folder.name()) return;
    const fn = e(Folder.name());
    let fs;
    try { fs = await Folder.copies(ask); }
    catch (err) {
      console.error(err);
      box.innerHTML = `<p class="err">Папку «${fn}» прочитати не вдалося: ${e(err.message)}. Виберіть її ще раз унизу сторінки.</p>`;
      return;
    }
    if (!fs) {
      box.innerHTML = `<p class="actions"><button class="btn" data-act="folder-show">Показати файли з папки «${fn}»</button></p>`;
      return;
    }
    folderList = fs.slice(0, 5);
    box.innerHTML = folderList.length
      ? `<p class="small">Отримані файли в папці «${fn}», найновіші зверху:</p>
        <div class="files">${folderList.map((f, i) => { const g = Folder.isGot(f.name); return `<div class="file-row"><span><b>${e(f.name)}</b>
          <span class="sub">${when(f.lastModified)} · ${size(f.size)}${g ? ' · уже прийнято' : ''}</span></span>
          <button class="btn small${g ? ' ghost' : ''}" data-act="folder-import" data-i="${i}">Прийняти</button></div>`; }).join('')}</div>`
      : `<p class="muted small">У папці «${fn}» отриманих файлів поки немає.</p>`;
  }
  async function importFromFolder(i) {
    const f = folderList[i];
    if (!f) return;
    await Folder.got(f.name);
    await importFile(f);
  }
  async function chooseFolder() {
    try {
      const h = await Folder.choose();
      if (!h) return;
      await DB.setMeta(AUTO, null);   // автокопія — відтепер у новій папці
      U.toast(`Папка «${h.name}» вибрана`, 4000);
    } catch (err) {
      console.error(err);
      U.toast('Цю папку вибрати не можна — створіть у «Завантаженнях» папку «Кашкай» і виберіть її', 7000);
    }
    App.refresh();
    autoSoon(3000);   // дозвіл щойно дано — першу автокопію пишемо одразу
  }
  async function forgetFolder() {
    if (!confirm(`Більше не використовувати папку «${Folder.name()}»? Файли в ній лишаться, нові ляжуть у «Завантаження».`)) return;
    await Folder.forget();
    App.refresh();
  }

  async function rename() {
    const v = prompt('Назва цього пристрою (її побачить інший пристрій під час обміну):', myName());
    if (v == null) return;
    const name = v.trim().slice(0, 40);
    if (!name) return;
    await DB.setMeta('deviceName', name);
    App.refresh();
  }

  // ---------- прийом копії ----------
  function b64ToBlob(b64, mime) {
    const bin = atob(b64), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: mime || 'image/jpeg' });
  }

  async function readCopy(file, onStep) {
    let data, zip = null;
    if (await Zip.isZip(file)) {
      zip = await Zip.open(file);
      if (!zip.has(DATA)) throw new Error('Це архів, але не копія програми «Кашкай ТО».');
      try { data = JSON.parse(await zip.text(DATA)); } catch (x) { throw new Error(x.message.startsWith('Пошкоджений') ? x.message : 'Копія пошкоджена.'); }
    } else {
      try { data = JSON.parse(await file.text()); } catch (x) { throw new Error('Це не файл копії програми «Кашкай ТО».'); }
    }
    return mergeData(data, f => {
      if (zip && f.path) return zip.blob(f.path, f.mime || 'image/jpeg');
      if (f.data) return b64ToBlob(f.data, f.mime);
      throw new Error('фото немає в копії');
    }, onStep);
  }

  // Злити дані копії з цього пристрою. getBlob(відомості про фото) → Blob — звідки взяти саме фото.
  async function mergeData(data, getBlob, onStep) {
    if (!data || data.app !== 'kashkai-to' || !Array.isArray(data.records)) throw new Error('Це не файл копії програми «Кашкай ТО».');
    if (data.format > FORMAT) throw new Error('Копію зроблено новішою версією програми — спершу оновіть програму на цьому пристрої (Ще → Налаштування).');

    const list = Array.isArray(data.files) ? data.files : [];
    const files = [];
    let bad = 0, i = 0;
    for (const f of list) {
      if (onStep) onStep(++i, list.length);
      if (!f || typeof f.id !== 'string' || typeof f.u !== 'number') continue;
      if (f.del) { files.push(f); continue; }
      if (!DB.wantsFile(f)) continue;
      try {
        const blob = await getBlob(f);
        const { path: _p, data: _d, size: _s, ...m } = f;
        files.push(Object.assign(m, { blob }));
      } catch (x) { console.warn('Фото не взято', f.id, x); bad++; }
    }
    const res = await DB.merge(data.records, files);
    res.bad = bad;
    res.from = data.deviceName || '';
    res.book = !!data.import;
    res.created = Date.parse(data.created) || 0;

    // Що тепер відомо: про себе (know) і про пристрій-відправник (peers).
    const self = DB.device;
    if (data.have && typeof data.have === 'object') {
      const k = Object.assign({}, know());
      const base = data.base && typeof data.base === 'object' ? data.base : null;
      const fits = !base || Object.keys(base).every(x => x === self || (k[x] || 0) >= base[x]);
      if (fits && !bad) {
        for (const [x, t] of Object.entries(data.have)) if (x !== self && typeof t === 'number' && !(k[x] >= t)) k[x] = t;
        await DB.setMeta('know', k);
      } else if (!fits) res.partial = true;
      if (data.device && data.device !== self && !data.import) {
        const ps = Object.assign({}, peers());
        const old = ps[data.device] || {};
        const h = Object.assign({}, old.have);
        for (const [x, t] of Object.entries(data.have)) if (typeof t === 'number' && !(h[x] >= t)) h[x] = t;
        ps[data.device] = {
          name: data.deviceName || old.name || 'Інший пристрій', have: h,
          at: Math.max(old.at || 0, res.created), got: Date.now(),
        };
        await DB.setMeta('peers', ps);
      }
    }
    if (data.device === self) res.own = true;
    return res;
  }

  async function importFile(file) {
    if (!file || busy) return;
    busy = true;
    let msg;
    const out0 = $('importRes');
    if (out0) out0.innerHTML = '<p class="muted">Читаю файл…</p>';
    try {
      const r = await readCopy(file, (i, n) => { const o = $('importRes'); if (o && n > 3) o.innerHTML = `<p class="muted">Читаю фото… ${i} з ${n}</p>`; });
      const parts = [`Нових записів: ${r.added}`, `оновлено: ${r.updated}`];
      if (r.deleted) parts.push(`видалено: ${r.deleted}`);
      if (r.photos) parts.push(`фото: ${r.photos}`);
      if (r.photosDel) parts.push(`видалено фото: ${r.photosDel}`);
      if (r.kept) parts.push(`у вас новіші, лишено ваші: ${r.kept}`);
      parts.push(`без змін: ${r.same}`);
      const src = r.own ? 'Це копія з цього ж пристрою. '
        : r.book ? `Файл імпорту з книги Excel${r.created ? ' від ' + when(r.created) : ''}. `
        : r.from ? `Копія з «${e(r.from)}»${r.created ? ' від ' + when(r.created) : ''}. ` : '';
      msg = `<p class="ok">Готово.</p><p>${src}${parts.join(', ')}.</p>`;
      if (r.bad) msg += `<p class="err">Пошкоджених фото: ${r.bad} — їх не взято. Надішліть копію ще раз.</p>`;
      if (r.partial) msg += `<p class="err">Увага: це лише зміни, а частини попередніх змін на цьому пристрої немає. Надішліть сюди з «${e(r.from || 'іншого пристрою')}» повну копію.</p>`;
    } catch (err) {
      console.error(err);
      msg = `<p class="err">${e(err.message)}</p>`;
    } finally { busy = false; }
    App.refresh();
    const out = $('importRes');
    if (out) out.innerHTML = msg;
  }

  // ---------- екран ----------
  function screen() {
    const all = select(null);
    const ps = peerList();
    const opt = (val, title, sub, on) => `<label class="check choice"><input type="radio" name="obminWhat" value="${e(val)}"${on ? ' checked' : ''}>
      <span><b>${title}</b><span class="sub">${sub}</span></span></label>`;
    let opts = ps.map((pr, i) => {
      const s = select(pr.id);
      const what = s.records.length || s.files.length
        ? `змін: ${s.records.length}, фото: ${s.photos.length}${s.bytes ? ', ≈ ' + size(s.bytes) : ''}`
        : 'нових змін немає';
      return opt(pr.id, `Лише зміни для «${e(pr.name)}»`, `${what} · рахую від його копії ${when(pr.at)}`, i === 0);
    }).join('');
    const nRec = all.records.filter(r => !r.del).length;
    opts += opt('', 'Повна копія', `записів ${nRec}, фото ${all.photos.length}${all.bytes ? ', ≈ ' + size(all.bytes) : ''}`, !ps.length);
    return {
      title: 'Обмін даними', back: true, html: `
      ${Cloud.panel()}
      <section class="panel">
        <h3>Надіслати файлом на інший пристрій</h3>
        <p class="muted small">Цей пристрій: <b>${e(myName())}</b> · <button type="button" class="linkbtn" data-act="dev-rename">змінити назву</button></p>
        <div class="choices">${opts}</div>
        ${ps.length ? '' : '<p class="muted small">Перший раз надішліть повну копію. Коли інший пристрій надішле свою копію сюди, з\'явиться «лише зміни» — це менший файл.</p>'}
        <p class="actions"><button class="btn" data-act="obmin-make">Підготувати файл</button></p>
        <div id="obminOut"></div>
      </section>
      <section class="panel">
        <h3>Прийняти копію</h3>
        <p>Файл з іншого пристрою (LocalSend кладе отримане ${Folder.name() ? 'туди, куди вкажете в його налаштуваннях' : 'зазвичай у «Завантаження»'}) або файл імпорту з книги Excel. Нічого не затирається: з двох версій одного запису лишається новіша, видалене на іншому пристрої видаляється й тут.</p>
        <div id="folderFiles"></div>
        <label class="btn${Folder.name() ? ' ghost' : ''}">Вибрати файл<input type="file" accept=".zip,.json,application/zip,application/x-zip-compressed,application/json,application/octet-stream" data-act="import" hidden></label>
        <div id="importRes"></div>
      </section>
      ${folderPanel()}`,
      after: () => { Cloud.after(); return fillFolder(false); },
    };
  }

  function folderPanel() {
    if (!Folder.supported()) return '';
    const n = Folder.name();
    if (!n) {
      return `<section class="panel">
        <h3>Окрема папка для файлів</h3>
        <p class="muted small">Щоб не шукати файли серед усіх завантажень: натисніть «Вибрати папку», відкрийте «Завантаження» (Download), створіть там папку <b>Кашкай</b> і виберіть її. Тоді копії й таблиці лягатимуть туди, отримані файли програма покаже сама, а ще триматиме там свіжу резервну копію всіх даних.</p>
        <p class="actions"><button class="btn ghost" data-act="folder-choose">Вибрати папку</button></p>
      </section>`;
    }
    const a = auto();
    const state = a
      ? `записана ${when(a.at)} · ${size(a.size)} · записів ${a.records}, фото ${a.photos}${a.mark !== mark() ? '<br><span class="sub">Є новіші зміни — програма допише їх сама за кілька хвилин.</span>' : ''}`
      : 'ще не записувалась';
    return `<section class="panel">
        <h3>Папка програми: «${e(n)}»</h3>
        <p class="muted small">Сюди лягають копії й таблиці Excel, а отримані файли з неї програма показує вище — шукати не треба. Щоб LocalSend клав отримане сюди ж: LocalSend → «Налаштування» → папка для отриманих файлів → «${e(n)}».</p>
        <p class="actions"><button class="btn ghost small" data-act="folder-choose">Вибрати іншу</button>
          <button class="btn ghost small" data-act="folder-forget">Не використовувати</button></p>
      </section>
      <section class="panel">
        <h3>Автокопія</h3>
        <p>${state}</p>
        ${autoErr ? `<p class="err small">Остання спроба не вдалася: ${e(autoErr)}</p>` : ''}
        <p class="muted small">Програма сама тримає в папці «${e(n)}» повну копію даних з фото — файл «${e(autoName())}», він перезаписується після змін. Якщо браузер стер дані чи програму перевстановили — прийміть цей файл. Від втрати телефона рятує інше: час від часу надсилайте зміни на комп.</p>
        <p class="actions"><button class="btn small" data-act="backup-now">Записати копію зараз</button></p>
      </section>`;
  }

  return {
    screen, make, share, save, rename, importFile, readCopy, build, select, payload, mergeData,
    fillFolder, importFromFolder, chooseFolder, forgetFolder, isBusy: () => busy,
    init, autoSoon, autoTick, backupNow, lastCopy, unsaved, auto, mark, copied, myName, when, size,
  };
})();
