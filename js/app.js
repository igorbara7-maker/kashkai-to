'use strict';
// Запуск, переходи між екранами, обробка натискань.
const App = (() => {
  const VERSION = '0.25.2';
  const $ = id => document.getElementById(id);
  let navCount = 0, busy = false;
  const scrollPos = new Map();
  let photoUrls = [];

  function parse() {
    const h = location.hash.replace(/^#\/?/, '');
    const i = h.indexOf('?');
    const path = i < 0 ? h : h.slice(0, i);
    return { parts: path.split('/').map(decodeURIComponent), q: new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) };
  }

  // Яка вкладка внизу світиться на якому екрані. Шестерня (#/sche, обмін, Excel, налаштування) — частина Головної.
  const TAB_OF = { '': 'stan', stan: 'stan', rule: 'stan', sche: 'stan', obmin: 'stan', excel: 'stan', perevirka: 'stan', nalashtuvannia: 'stan',
    zhurnal: 'hist', docs: 'hist', doc: 'hist', foto: 'hist', kamera: 'hist', share: 'hist', probih: 'hist', notes: 'hist',
    vytraty: 'vytraty', palne: 'vytraty', dribni: 'vytraty', poizdky: 'vytraty', poizdka: 'vytraty',
    avto: 'avto', zapchasty: 'avto', shyny: 'avto', reglament: 'avto', maistru: 'avto' };
  const TAB_OF_EDIT = { work: 'hist', visit: 'hist', doc: 'hist', odo: 'hist', note: 'hist', fuel: 'vytraty', expense: 'vytraty', trip: 'vytraty', tireevent: 'avto', rule: 'avto' };

  function route() {
    const { parts, q } = parse();
    const [a, b, c] = parts;
    let r;
    try {
      switch (a) {
        case '': case 'stan': r = V.stan(); break;
        case 'rule': r = V.rule(b); break;
        case 'zhurnal': r = V.hist(q); break;
        case 'docs': r = V.hist(new URLSearchParams('f=sto')); break;
        case 'doc': r = V.doc(b); break;
        case 'vytraty': r = V.vytraty(); break;
        case 'sche': r = V.sche(); break;
        case 'avto': r = V.avto(); break;
        case 'maistru': r = V.maistru(); break;
        case 'perevirka': r = V.perevirka(); break;
        case 'reglament': r = V.reglament(); break;
        case 'notes': r = V.notes(); break;
        case 'probih': r = V.probih(); break;
        case 'palne': r = P.screen(); break;
        case 'shyny': r = T.screen(); break;
        case 'zapchasty': r = Parts.screen(); break;
        case 'poizdky': r = Trip.screen(); break;
        case 'poizdka': r = Trip.tripScreen(b); break;
        case 'dribni': r = Trip.expScreen(); break;
        case 'obmin': r = V.obmin(); break;
        case 'excel': r = Excel.screen(); break;
        case 'nalashtuvannia': r = V.nalashtuvannia(); break;
        case 'foto': r = fotoScreen(); break;
        case 'kamera': r = Kamera.screen(); break;
        case 'share': r = shareScreen(); break;
        case 'edit': r = F.render(b, c, q); break;
        default: r = V.notFound();
      }
    } catch (err) {
      console.error(err);
      r = { title: 'Помилка', back: true, html: `<section class="panel"><p class="err">Сталася помилка: ${U.esc(err.message)}</p></section>` };
    }
    const tab = a === 'edit' ? (TAB_OF_EDIT[b] || 'stan') : (TAB_OF[a] || 'stan');
    render(r, tab);
    if (waiting) applyUpdate();
    Obmin.autoSoon();
    Cloud.soon();
  }

  function render(r, tab) {
    $('topTitle').textContent = r.title;
    document.title = r.title + ' — Кашкай ТО';
    $('back').hidden = !r.back;
    photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = [];
    $('view').innerHTML = r.html;
    document.querySelectorAll('#tabs a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    $('fab').style.visibility = r.form ? 'hidden' : '';
    $('topGear').hidden = !(tab === 'stan' && (parse().parts[0] === '' || parse().parts[0] === 'stan'));
    const ctx = M.context();
    $('topKm').textContent = ctx.nowKm != null && !r.noTopKm ? U.km(ctx.nowKm, ctx.nowEst) : '';
    window.scrollTo(0, scrollPos.get(location.hash) || 0);
    if (r.after) Promise.resolve(r.after()).catch(err => console.error(err));
  }

  function goBack(fallback) {
    if (navCount > 0) history.back();
    else location.replace(fallback || '#/stan');
  }

  // ---------- нижня панель дій ----------
  function openSheet(html) {
    const s = $('sheet');
    s.innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-box">${html}</div>`;
    s.classList.remove('hidden');
  }
  function closeSheet() {
    const s = $('sheet');
    if (s.classList.contains('hidden')) return;
    s.classList.add('hidden');
    s.classList.remove('full');
    s.querySelectorAll('img').forEach(i => { if (i.src.startsWith('blob:')) URL.revokeObjectURL(i.src); });
    s.innerHTML = '';
  }
  function openFab() {
    const tr = Trip.ongoing();
    const tile = (h, t) => `<a href="${h}">${t}</a>`;
    openSheet(`<h3>Додати</h3>
      ${tr ? `<a class="item" href="#/poizdka/${U.esc(tr.id)}"><b>Поїздка «${U.esc(tr.name)}»</b><div class="sub">Підсумок, завершити поїздку</div></a>` : ''}
      <label class="add-big">Сфотографувати<div class="sub">чек АЗС, приладку, акт чи накладну — програма сама впізнає, ви перевірите</div>
        <input type="file" accept="image/*" capture="environment" data-cam hidden></label>
      <label class="btn ghost wide">Вибрати з галереї<input type="file" accept="image/*" multiple data-cam hidden></label>
      <div class="add-grid">
        ${tile('#/edit/fuel/new', 'Заправка')}${tile('#/edit/odo/new', 'Пробіг')}${tile('#/edit/visit/new', 'ТО')}
        ${tile('#/edit/expense/new', 'Витрата')}${tile('#/edit/tireevent/new', 'Шини')}${tr ? tile('#/poizdka/' + U.esc(tr.id), 'Поїздка') : tile('#/edit/trip/new', 'Поїздка')}
        ${tile('#/edit/note/new', 'Нотатка')}${tile('#/edit/doc/new', 'Документ вручну')}
      </div>
      <button class="btn ghost wide" data-act="sheet-close">Закрити</button>`);
  }

  // ---------- фото ----------
  async function showPhotos(docId) {
    const box = $('photos');
    if (!box) return;
    const fs = DB.filesOf(docId);
    if (!fs.length) { box.innerHTML = '<p class="muted">Фото ще немає.</p>'; return; }
    box.innerHTML = fs.map(f => `<button type="button" class="ph" data-act="photo-open" data-id="${U.esc(f.id)}"><img alt="Фото документа"></button>`).join('');
    for (const f of fs) {
      const rec = await DB.getFile(f.id);
      const img = box.querySelector(`[data-id="${f.id}"] img`);
      if (rec && rec.blob && img) { const u = URL.createObjectURL(rec.blob); photoUrls.push(u); img.src = u; }
    }
  }
  async function addPhotos(docId, files) {
    if (!files || !files.length) return;
    U.toast('Обробляю фото…', 10000);
    try {
      for (const f of files) {
        const blob = await U.compressImage(f);
        await DB.addFile(docId, blob);
      }
      U.toast('Фото додано: ' + files.length);
    } catch (err) { U.toast('Не вдалося додати фото: ' + err.message, 5000); }
    showPhotos(docId);
  }
  async function openPhoto(id) {
    const rec = await DB.getFile(id);
    if (!rec || !rec.blob) return;
    const u = URL.createObjectURL(rec.blob);
    openSheet(`<div class="photo-view"><img src="${u}" alt="Фото документа"></div>
      <div class="actions"><button class="btn ghost" data-act="sheet-close">Закрити</button>
      <button class="btn danger" data-act="photo-del" data-id="${U.esc(id)}" data-doc="${U.esc(rec.doc)}">Видалити фото</button></div>`);
    $('sheet').classList.add('full');
  }

  // ---------- ярлик «Документ з фото» ----------
  function fotoScreen() {
    return {
      title: 'Документ з фото', html: `<section class="panel">
        <h2>Сфотографуйте документ</h2>
        <p class="muted small">Акт, чек, накладна — програма прочитає дату, номер, суму й позиції, а ви перевірите і збережете.</p>
        <div class="actions"><label class="btn">Камера<input type="file" accept="image/*" capture="environment" data-ocr hidden></label>
        <label class="btn ghost">З галереї<input type="file" accept="image/*" multiple data-ocr hidden></label></div>
      </section>`,
    };
  }

  // ---------- фото, надіслані через «Поділитися → Кашкай ТО» ----------
  const SHARE_CACHE = 'kashkai-share';
  let shared = [];
  async function sharedFiles() {
    try {
      const c = await caches.open(SHARE_CACHE), out = [];
      for (const k of await c.keys()) {
        const res = await c.match(k), b = await res.blob();
        out.push(new File([b], decodeURIComponent(res.headers.get('X-Name') || '') || 'фото.jpg', { type: b.type || 'image/jpeg' }));
      }
      return out;
    } catch (x) { return []; }
  }
  async function clearShared() { shared = []; try { await caches.delete(SHARE_CACHE); } catch (x) { /* немає сховища */ } }
  function shareScreen() {
    const opts = M.docs().reverse().slice(0, 40).map(d => `<option value="${U.esc(d.id)}">${U.esc([d.code, U.date(d.date), d.seller || d.kind].filter(Boolean).join(' · '))}</option>`).join('');
    return {
      title: 'Надіслані фото', html: `<section class="panel">
        <div class="photos" id="shPhotos"></div>
        <p id="shState" class="muted">Відкриваю фото…</p>
        <div id="shActs" hidden>
          <button class="btn wide" data-act="share-doc">Новий документ — розпізнати</button>
          ${opts ? `<label class="fld" style="display:block;margin-top:14px"><span class="muted small">Або додати до документа</span><select id="shDoc">${opts}</select></label>
          <button class="btn ghost wide" data-act="share-attach">Додати до вибраного документа</button>` : ''}
          <button class="btn ghost wide" data-act="share-drop">Не потрібно — прибрати</button>
        </div></section>`,
      after: async () => {
        shared = await sharedFiles();
        const box = $('shPhotos'), st = $('shState');
        if (!box) return;
        if (!shared.length) { st.textContent = 'Фото не отримано. Спробуйте ще раз: у галереї «Поділитися» → «Кашкай ТО».'; return; }
        box.innerHTML = shared.map(() => '<span class="ph"><img alt="Надіслане фото"></span>').join('');
        box.querySelectorAll('img').forEach((im, i) => { const u = URL.createObjectURL(shared[i]); photoUrls.push(u); im.src = u; });
        st.textContent = 'Отримано фото: ' + shared.length + '. Що з ними зробити?';
        $('shActs').hidden = false;
      },
    };
  }

  // ---------- швидкі дії на картці вузла ----------
  function quickCheck(id) {
    const r = DB.get(id);
    if (!r) return;
    openSheet(`<h3>${U.esc(r.name)}</h3>
      <p>Записати: <b>перевірено сьогодні (${U.date(U.today())}), усе гаразд</b>.</p>
      <label class="fld"><span class="muted small">Примітка, якщо треба</span><input id="qcNote" autocomplete="off" placeholder="напр. заряд 12,6 В"></label>
      <div class="actions"><button class="btn" data-act="quick-check-save" data-id="${U.esc(id)}">Записати</button>
      <button class="btn ghost" data-act="sheet-close">Скасувати</button></div>`);
  }
  async function quickCheckSave(id) {
    const note = ($('qcNote') && $('qcNote').value.trim()) || null;
    await DB.save({ t: 'work', date: U.today(), km: null, rule: id, what: 'Перевірено — гаразд', note });
    const r = DB.get(id);
    if (r && r.snooze) await DB.save(Object.assign({}, r, { snooze: null }));
    closeSheet();
    U.toast('Записано. Запис можна змінити чи видалити в історії вузла.', 4000);
    route();
  }
  // Відкласти можна пункт регламенту або картку «Шини» (id 'tires' — дата в записі автомобіля).
  const snoozeRec = id => id === 'tires'
    ? { rec: DB.get('vehicle') || { id: 'vehicle', t: 'vehicle' }, key: 'tireSnooze', name: 'Шини' }
    : (r => r && { rec: r, key: 'snooze', name: r.name })(DB.get(id));
  function snooze(id) {
    const x = snoozeRec(id);
    if (!x) return;
    const r = { name: x.name, snooze: x.rec[x.key] };
    const opt = (days, t) => `<button class="item" data-act="snooze-set" data-id="${U.esc(id)}" data-days="${days}"><b>${t}</b><div class="sub">до ${U.date(U.addDays(U.today(), days))}</div></button>`;
    openSheet(`<h3>Нагадати пізніше: ${U.esc(r.name)}</h3>
      <p class="muted small">${id === 'tires' ? 'Картка перейде в «Відкладено» до цієї дати. Запис заміни це не замінює.' : 'Вузол перейде в «Відкладено» і не рахуватиметься простроченим до цієї дати. Запис у журналі він не замінює.'}</p>
      ${opt(14, 'Через 2 тижні')}${opt(30, 'Через місяць')}${opt(91, 'Через 3 місяці')}
      ${r.snooze && r.snooze > U.today() ? `<button class="item" data-act="snooze-set" data-id="${U.esc(id)}" data-days="0"><b>Скасувати відкладення</b><div class="sub">зараз відкладено до ${U.date(r.snooze)}</div></button>` : ''}
      <button class="btn ghost wide" data-act="sheet-close">Закрити</button>`);
  }
  async function snoozeSet(id, days) {
    const x = snoozeRec(id);
    if (!x) return;
    await DB.save(Object.assign({}, x.rec, { [x.key]: days > 0 ? U.addDays(U.today(), days) : null }));
    closeSheet();
    U.toast(days > 0 ? 'Відкладено до ' + U.date(U.addDays(U.today(), days)) : 'Відкладення скасовано');
    route();
  }

  // «Перевірити дані»: «Гаразд» — запис лишається як є і зникає зі списку (поки не з’явиться нова причина);
  // «Повернути» — знову в списку. Нотатку «Гаразд» закриває.
  async function dataOk(ids, codes) {
    const recs = String(ids || '').split(',').map(id => DB.get(id)).filter(Boolean);
    if (!recs.length) return;
    const ok = codes ? codes.split(',') : null;
    await DB.saveAll(recs.map(r => r.t === 'note' ? Object.assign({}, r, { done: !!ok })
      : Object.assign({}, r, { ok: ok ? [...new Set([...(r.ok || []), ...ok])] : null })));
    U.toast(ok ? 'Позначено: гаразд' : 'Повернуто до списку');
    route();
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); U.toast('Скопійовано'); }
    catch (x) { U.toast('Не вдалося скопіювати — виділіть текст вручну'); }
  }

  // ---------- події ----------
  async function afterSave(r, form) {
    if (r && r.go) {
      if (form && form.dataset.id && form.dataset.form === 'doc') goBack(r.go);
      else location.replace(r.go);
    } else goBack();
  }

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (el.tagName === 'INPUT') return; // поля з data-act обробляються в change
    switch (act) {
      case 'back': goBack(); break;
      case 'fab': openFab(); break;
      case 'sheet-close': closeSheet(); break;
      case 'delete': {
        const form = el.closest('form');
        const r = await F.del(form);
        if (r) { if (r.go) location.replace(r.go); else goBack(); }
        break;
      }
      case 'item-add': {
        const box = $('items');
        box.insertAdjacentHTML('beforeend', F.itemEd({ kind: 'Запчастина' }));
        box.lastElementChild.querySelector('[name="i_name"]').focus();
        break;
      }
      case 'item-del': {
        const form = el.closest('form');
        el.closest('.item-ed').remove();
        F.itemsTotal(form);
        break;
      }
      case 'parts-seed': await Parts.seed(); route(); break;
      case 'gem-run': Ceny.run(); break;
      case 'gem-copy': await Ceny.copyPrompt(); break;
      case 'gem-paste': Ceny.parsePasted($('gemPaste').value); break;
      case 'gem-ok': await Ceny.accept(+el.dataset.i); break;
      case 'gem-no': Ceny.reject(+el.dataset.i); break;
      case 'gem-key-save': if (await Ceny.saveKey($('gemKey').value)) route(); break;
      case 'gem-key-del': await Ceny.saveKey(''); route(); break;
      case 'pa-add': Parts.addAlt(); break;
      case 'pa-del': el.closest('.pa-ed').remove(); break;
      case 'tg-add': T.addGroup(); break;
      case 'tg-del': el.closest('.tg-ed').remove(); break;
      case 'bolts-ok': await T.boltsOk(el.dataset.id); route(); break;
      case 'copy': copyText(document.querySelector(el.dataset.src).textContent); break;
      case 'share': {
        const text = document.querySelector(el.dataset.src).textContent;
        if (navigator.share) navigator.share({ text }).catch(() => { });
        else copyText(text);
        break;
      }
      case 'obmin-make': Obmin.make(); break;
      case 'obmin-share': Obmin.share(); break;
      case 'obmin-save': Obmin.save(); break;
      case 'dev-rename': Obmin.rename(); break;
      case 'excel-save': Excel.save(); break;
      case 'folder-choose': Obmin.chooseFolder(); break;
      case 'folder-forget': Obmin.forgetFolder(); break;
      case 'folder-show': Obmin.fillFolder(true); break;
      case 'folder-import': Obmin.importFromFolder(+el.dataset.i); break;
      case 'backup-now': Obmin.backupNow(); break;
      case 'cloud-sync': Cloud.sync(true); break;
      case 'cloud-client': Cloud.saveClient(); break;
      case 'cloud-off': Cloud.disconnect(); break;
      case 'cloud-restart': Cloud.restart(); break;
      case 'ics': P.ics(); break;
      case 'data-ok': dataOk(el.dataset.ids, el.dataset.codes); break;
      case 'data-back': dataOk(el.dataset.ids, null); break;
      case 'share-doc': {
        if (!shared.length) break;
        F.setPending(shared.slice());
        await clearShared();
        location.replace('#/edit/doc/new?ocr=1');
        break;
      }
      case 'share-attach': {
        const id = $('shDoc') && $('shDoc').value;
        if (!id || !shared.length) break;
        const fs = shared.slice();
        await clearShared();
        location.replace('#/doc/' + id);
        await addPhotos(id, fs);
        break;
      }
      case 'share-drop': await clearShared(); location.replace('#/stan'); break;
      case 'quick-check': quickCheck(el.dataset.id); break;
      case 'quick-check-save': quickCheckSave(el.dataset.id); break;
      case 'snooze': snooze(el.dataset.id); break;
      case 'snooze-set': snoozeSet(el.dataset.id, +el.dataset.days); break;
      case 'photo-open': openPhoto(el.dataset.id); break;
      case 'photo-del': {
        if (!confirm('Видалити це фото?')) return;
        await DB.removeFiles(el.dataset.id);
        closeSheet();
        showPhotos(el.dataset.doc);
        break;
      }
      case 'update': applyUpdate(true); break;
    }
  });

  document.addEventListener('change', async ev => {
    const t = ev.target;
    if (t.matches('[data-act="import"]')) { const f = t.files[0]; t.value = ''; await Obmin.importFile(f); }
    else if (t.matches('[data-photo]')) { await addPhotos(t.dataset.photo, [...t.files]); t.value = ''; }
    else if (t.matches('[data-pick]')) { F.pick(t.files); t.value = ''; }
    else if (t.matches('[data-cam]')) {
      const fs = [...t.files];
      t.value = '';
      if (!fs.length) return;
      closeSheet();
      Kamera.start(fs);
    }
    else if (t.matches('[data-ocr]')) {
      const fs = [...t.files];
      t.value = '';
      if (!fs.length) return;
      F.setPending(fs);
      closeSheet();
      const to = '#/edit/doc/new?ocr=1';
      if (location.hash === to) route(); else location.hash = to;
    }
    else if (t.matches('[data-nav-rule]')) location.replace('#/zhurnal' + (t.value ? '?rule=' + encodeURIComponent(t.value) : ''));
    else if (t.matches('[data-act="note-done"]')) {
      const n = DB.get(t.dataset.id);
      if (n) { await DB.save(Object.assign({}, n, { done: t.checked })); t.closest('.note').classList.toggle('done', t.checked); }
    }
  });

  document.addEventListener('input', ev => {
    const t = ev.target;
    if (t.matches('[data-filter]')) {
      const words = t.value.toLowerCase().split(/\s+/).filter(Boolean);
      document.querySelectorAll(t.dataset.filter).forEach(x => {
        const s = x.dataset.text || '';
        x.hidden = !words.every(w => s.includes(w));
      });
      document.querySelectorAll('.h-mon').forEach(m => { m.hidden = !m.querySelector('.h-ev:not([hidden])'); });
      return;
    }
    F.onInput(ev);
  });

  document.addEventListener('submit', async ev => {
    if (ev.target.id === 'cloudPw') { ev.preventDefault(); Cloud.submitPw(); return; }
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const r = await F.submit(form);
      if (r) await afterSave(r, form);
    } catch (err) {
      console.error(err);
      U.toast('Не збережено: ' + err.message, 5000);
    } finally { busy = false; }
  });

  // ---------- оновлення програми ----------
  // Нова версія ставиться сама, щойно це безпечно: не відкрита форма, не йде обмін чи запис таблиці.
  // Інакше — смужка, і оновлення відбудеться після закриття форми.
  let waiting = null, reg = null, lastCheck = Date.now();
  const safeNow = () => !busy && !document.querySelector('form[data-form]') && $('sheet').classList.contains('hidden')
    && !Obmin.isBusy() && !Excel.isBusy() && !Cloud.isBusy();
  function applyUpdate(force) {
    if (!waiting || !(force || safeNow())) return false;
    waiting.postMessage('skipWaiting');
    waiting = null;
    return true;
  }
  function serviceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && !/[?&]sw\b/.test(location.search)) return;
    const found = w => {
      waiting = w;
      if (applyUpdate()) return;
      const b = $('banner');
      b.innerHTML = 'Є нова версія програми — встановиться сама, щойно закриєте форму. <button class="btn small" data-act="update">Зараз</button>';
      b.hidden = false;
    };
    navigator.serviceWorker.register('sw.js').then(r => {
      reg = r;
      if (r.waiting && navigator.serviceWorker.controller) found(r.waiting);
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) found(w); });
      });
    }).catch(err => console.warn('Не вдалося підключити роботу без інтернету', err));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    // Встановлена програма може тижнями лишатися відкритою у фоні — перевіряємо оновлення, коли до неї повертаються.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { applyUpdate(); return; }
      if (reg && Date.now() - lastCheck > 3600e3) { lastCheck = Date.now(); reg.update().catch(() => { }); }
    });
  }

  // «Що нового» — показуємо один раз після оновлення.
  const NEWS = {
    '0.25.2': [
      'На сторінці вузла (олива, антифриз, МКПП, гальмівна рідина, кондиціонер) — довідка з інструкції Nissan для вашого J11 1.2 DIG-T: об\'єми й специфікації.',
    ],
    '0.25.1': [
      'Запит для Gemini: по 4 деталі за раз, з урахуванням вашого двигуна; Gemini пише зауваження, якщо номер не тієї деталі.',
    ],
    '0.25.0': [
      'Мої запчастини: ціни без ключа — скопіюйте запит, вставте в додаток Gemini на телефоні, а відповідь вставте назад у програму.',
    ],
    '0.24.4': [
      'Оновлення цін: якщо Google зняв стару модель Gemini, програма сама бере найновішу.',
      'Оновлення цін: замість «помилка зв’язку» тепер видно справжню причину.',
      'Посилання на пошук Intercars виправлено (адреса сайту була невірна); Omega замінено на пошук Google (у Omega немає пошуку).',
    ],
    '0.24.1': [
      'Ключ Gemini: приймаються й нові ключі з крапкою, зайві пробіли та лапки прибираються самі.',
    ],
    '0.24.0': [
      'Мої запчастини: кнопка «Оновити ціни (ШІ)» — Gemini шукає ціни в інтернеті за вашими номерами, а ви приймаєте їх по одній, звіряючи зі сторінкою. Ключ Gemini вставляється в Налаштуваннях.',
    ],
    '0.23.1': [
      'Фото приладки: число можна виправити перед збереженням; з кількох чисел береться найближче до останнього пробігу, а не найбільше; інші числа з фото — кнопками.',
    ],
    '0.23.0': [
      'Список для майстра: під кожною роботою тепер номери деталей із «Мої запчастини». Зірочка — номер ще не звірений за VIN.',
    ],
    '0.22.0': [
      'Головна: «≈ ціна» наступного візиту тепер береться зі свіжих цін у «Мої запчастини» (до 3 місяців), а якщо їх немає — з минулого чека з позначкою року.',
    ],
    '0.21.0': [
      'Мої запчастини: номер за каталогом тепер окремо від того, що ставили на СТО. Біля номера — позначка «перевірено за VIN» або «не перевірено»: номери з актів ще треба звірити.',
      'Аналоги — кожен окремо: виробник, номер, «ставив — добре» чи «не брати» і ціна з датою. Ціна старша за 3 місяці показується сірим — «стара ціна».',
      'Супутні дрібниці (шайба, гайка, підшипник) — окремо, у «Купити разом». Де номери з актів викликають сумнів, програма підказує, що звірити.',
      'Фото приладки: пробіг тепер упізнається, навіть коли програмна оцінка пробігу завищена.',
    ],
    '0.20.1': [
      'Витрати: «на місяць» і «на 1 км» показуються лише коли набралось даних (3 місяці записів і 3 заправки) — замість цифри з одного чека.',
    ],
    '0.20.0': [
      'Кнопка «Додати» → «Сфотографувати» тепер сама впізнає, що на фото: чек АЗС, приладка (пробіг) чи документ СТО.',
      'Після фото — підтвердження: «Схоже на чек АЗС / приладку», прочитані числа і кнопка «Зберегти». Помилилась — «Ні, це документ СТО».',
    ],
    '0.19.0': [
      'Витрати: угорі — скільки машина коштує на місяць і на 1 км (за останні 12 місяців) і смуга часток: ТО, пальне, дрібні витрати.',
      'Мої запчастини: пошук за назвою чи номером і попередження, якщо номер, що стояв, не збігається з оригіналом чи аналогами.',
      'З «Авто» прибрано Пробіг і Нотатки — вони в Історії.',
    ],
    '0.18.0': [
      'Історія — одна стрічка за місяцями (у заголовку місяця — сума). Візит на СТО — одна картка: торкніться, щоб побачити роботи й документ.',
      'Угорі пошук (СТО, номер, деталь, рік) і фільтри: Усе · СТО · Пальне · Шини · Витрати · Пробіг. Документи шукайте тут же.',
      'Нотатки й усі покази пробігу — кнопками під фільтрами.',
    ],
    '0.17.0': [
      'Головна стала простішою: одна картка «Наступний візит на СТО» — що прострочено чи скоро, орієнтовна ціна за минулими чеками і кнопка «Показати майстру».',
      'Огляди («перевірити при нагоді») окремо від замін; «Усі вузли» — одним рядком із кольоровими лічильниками.',
      'Внизу — пальне (л/100 км) і витрати цього місяця.',
    ],
    '0.16.0': [
      'Нова нижня панель: Головна · Історія · «Додати» · Витрати · Авто. Кругла кнопка «Додати» посередині замінила плаваючий «+».',
      'Журнал і Документи тепер в «Історії» (угорі перемикач «Роботи / Документи»). Пальне, поїздки й дрібні витрати — у «Витратах».',
      '«Ще» зникло: обмін даними, Excel, перевірка даних і налаштування — під шестернею на Головній. Запчастини, шини, регламент і список для майстра — у «Авто».',
      'Дані не змінилися — лише розташування. Старі закладки працюють.',
    ],
    '0.15.0': [
      'Новий розділ «Мої запчастини» (Ще → «Мої запчастини»): свій короткий список під ваш автомобіль — номер оригіналу, аналоги, що стоїть зараз, нотатка «ставив / не брати».',
      'Кнопка «Заповнити з актів СТО» додає номери, що справді стояли у ваших актах (олива, фільтри, свічки, рідини, колодки…). Чого в актах не було — порожній рядок «знайти за VIN».',
      'Біля кожного номера — пошук на сайтах Intercars, Omega, Exist і кнопка «Скопіювати номер». Ціни програма не показує. Список передається між пристроями разом з рештою даних.',
    ],
    '0.14.0': [
      'Чек АЗС читається з фото: «Заправка» → додайте фото чека (камера чи галерея) — програма сама заповнить дату, літри, суму, ціну, пальне й АЗС.',
      'Ціна за літр ставиться вже з урахуванням знижки (сума ÷ літри). Поля з жовтим тлом програма прочитала сама — звірте їх із чеком і виправте, якщо треба.',
      'Перший раз читання довше — завантажується модуль розпізнавання (далі працює без інтернету).',
    ],
    '0.13.0': [
      'Обмін через Google Диск: Ще → «Обмін даними» → «Підключити Google Диск». Кожен пристрій кладе свої дані на ваш Google Диск і бере звідти зміни інших — файли переносити не треба.',
      'Файли на Диску зашифровані вашим паролем: на першому пристрої його придумуєте, на інших — вводите один раз. Програма бачить на Диску лише свою папку.',
      'Після змін натисніть «Обмінятися зараз»; ще близько години після того програма обмінюється сама. Обмін файлами через LocalSend і автокопія в папку працюють, як і раніше.',
    ],
    '0.12.0': [
      'Поїздки: Ще → «Поїздки» → «Почати поїздку» (назва, дата, пробіг, за бажанням — рівень пального). Поки поїздка триває, на головному екрані — кнопки «Заправка» і «Витрата на авто», а заправки й витрати тих днів зараховуються до неї самі.',
      'Підсумок поїздки: пробіг, витрата пального саме в цій поїздці (з рівнем у баку на старті й фініші — точна), скільки пішло на машину — усього, на день і на 1 км. Підсумок можна надіслати текстом.',
      '«Витрата на авто» (+ → «Витрата на авто»): мийка, стоянка, платна дорога, доливання, дрібний ремонт — сума, на що, за бажанням фото чека. У «Витратах» — окремим рядком і в «разом утримання».',
      'У таблиці Excel — аркуші «Поїздки» і «Дрібні витрати». Об’єм паливного бака — у Налаштуваннях → Автомобіль (55 л — перевірте).',
    ],
    '0.11.0': [
      'Шини: Ще → «Шини». Додайте комплекти — зимові й літні: марка, модель, розмір, DOT (тиждень і рік виготовлення). Якщо на осях різні шини — дві групи по 2.',
      'Записуйте сезонні заміни (+ → «Шини»): програма покаже, що стоїть зараз, пробіг кожного комплекту за сезон і за весь час, вік шин.',
      'На головному екрані — картка «Шини» замість пункту регламенту: навесні й восени нагадає про заміну, попередить про старі шини (понад 6 років) і малий протектор; після заміни — перевірити болти.',
      '«Пальне»: витрата окремо на зимових і літніх шинах. У таблиці Excel — аркуш «Шини». Дати сезонних замін — у Налаштуваннях → Автомобіль.',
    ],
    '0.10.0': [
      'Пальне: «+» → «Заправка» (і ярлик «Заправка» на значку). Літри, ціна за літр, сума — досить двох, третє програма порахує. Вкажіть пробіг; за бажанням — фото чека.',
      'Ще → «Пальне»: середня витрата на 100 км і вартість кілометра — за 3 місяці, рік і весь час. До повного бака заправлятися не треба: витрата рахується за період.',
      '«Витрати»: у кожному році окремо пальне і «разом утримання»; у таблиці Excel — новий аркуш «Пальне». Пробіг із заправок теж іде в строки ТО.',
      'Новий місяць — на головному екрані нагадування записати пробіг, доки цього місяця його ще немає.',
      'Ще → Налаштування → «Нагадування в календарі»: щомісяця 1-го — пробіг, навесні й восени — шини. Календар телефона нагадуватиме сам.',
    ],
    '0.9.0': [
      'Автокопія: якщо вибрано папку програми (Ще → Обмін даними), програма сама тримає в ній свіжу повну копію даних з фото — один файл, він перезаписується після змін.',
      'Якщо резервної копії не було понад тиждень, а зміни є, — на головному екрані з’явиться нагадування з кнопкою «Зробити копію».',
      'Ще → «Перевірити дані»: оцінений пробіг, позначки «уточніть», пробіг не по порядку дат, документи, не позначені в журналі. Виправте або позначте «Гаразд, так і є».',
      'У документі тепер теж можна позначити «Пробіг — лише оцінка».',
    ],
    '0.8.0': [
      'Ярлики: натисніть і потримайте значок програми — «Пробіг», «Документ», «Робота» відкриваються одразу.',
      'Фото можна надіслати в програму з галереї чи камери: «Поділитися» → «Кашкай ТО» — новий документ або додати до наявного.',
      'Ярлики й «Поділитися» з’являються, коли телефон оновить значок програми (зазвичай протягом доби після запуску).',
    ],
    '0.7.0': [
      'Новий головний екран: угорі одне речення — що зараз головне; вузли згруповано: «Прострочено», «Незабаром», «Гаразд» (згорнуто).',
      'На кожній картці — смужка ресурсу: скільки вже «з’їдено» від заміни до заміни.',
      'Швидкі дії на картці: «Зроблено», «Перевірено» (для оглядів — одним записом) і «Пізніше» (відкласти на 2 тижні, місяць чи 3 місяці).',
      'Якщо пробіг не записували понад місяць — програма нагадає. У полі пробігу одразу видно оцінку на сьогодні.',
      'Сезонні строки: у пункті регламенту можна вказати «щороку до 01.11, 01.04» (шини).',
    ],
    '0.6.0': [
      'Програма оновлюється сама — кнопку «Оновити» натискати не треба.',
      'Витрати: пробіг за рік рахується на 31 грудня (між показами — оцінка). Виправлено 2019 і 2020 роки; роки без документів теж видно.',
      'Якщо пробіг неправдоподібно великий (помилка в цифрах, чужий документ) — програма перепитає.',
      'Документ → журнал: на сторінці документа кнопка «Позначити виконане» — вузли відмічені за позиціями, дата й пробіг заповнені.',
    ],
  };
  function showNews() {
    let seen = DB.getMeta('seenVersion');
    if (seen === VERSION) return;
    DB.setMeta('seenVersion', VERSION);
    // До 0.6.0 версію не запам'ятовували: якщо дані вже є — це оновлення з 0.5.x, інакше перший запуск.
    if (!seen) { if (!DB.allRecords().length) return; seen = '0.5.9'; }
    const items = Object.keys(NEWS).filter(v => newer(v, seen) > 0 && newer(v, VERSION) <= 0).sort(newer).flatMap(v => NEWS[v]);
    if (!items.length) return;
    openSheet(`<h3>Програму оновлено до версії ${U.esc(VERSION)}</h3>
      <ul class="news">${items.map(t => `<li>${U.esc(t)}</li>`).join('')}</ul>
      <button class="btn wide" data-act="sheet-close">Гаразд</button>`);
  }
  // Чи версія a новіша за b («0.10.0» новіша за «0.9.1»).
  function newer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
    return 0;
  }

  async function init() {
    try { await DB.open(); }
    catch (err) {
      $('view').innerHTML = `<section class="panel"><h2>Не вдалося відкрити дані</h2><p class="err">${U.esc(err.message)}</p></section>`;
      return;
    }
    // Повернулися зі сторінки входу Google — забрати дозвіл з адреси до першого показу екрана.
    let cloudRet = null;
    try { cloudRet = await Cloud.catchReturn(); } catch (err) { console.error(err); }
    window.addEventListener('hashchange', ev => {
      const old = ev.oldURL.indexOf('#') >= 0 ? ev.oldURL.slice(ev.oldURL.indexOf('#')) : '';
      scrollPos.set(old, window.scrollY);
      navCount++;
      closeSheet();
      route();
    });
    route();
    showNews();
    serviceWorker();
    DB.persist();
    Obmin.init().catch(err => console.warn(err));
    Cloud.init(cloudRet);
    // Згортають програму — дописуємо автокопію, поки є змога.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Obmin.autoTick(true); });
  }

  return { VERSION, init, showPhotos, refresh: () => route() };
})();

App.init();
