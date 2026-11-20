'use strict';
// Запуск, переходи між екранами, обробка натискань.
const App = (() => {
  const VERSION = '0.5.0';
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

  const TAB_OF = { '': 'stan', stan: 'stan', rule: 'stan', zhurnal: 'zhurnal', docs: 'docs', doc: 'docs', vytraty: 'vytraty' };
  const TAB_OF_EDIT = { work: 'zhurnal', visit: 'zhurnal', doc: 'docs', odo: 'stan' };

  function route() {
    const { parts, q } = parse();
    const [a, b, c] = parts;
    let r;
    try {
      switch (a) {
        case '': case 'stan': r = V.stan(); break;
        case 'rule': r = V.rule(b); break;
        case 'zhurnal': r = V.zhurnal(q); break;
        case 'docs': r = V.docs(); break;
        case 'doc': r = V.doc(b); break;
        case 'vytraty': r = V.vytraty(); break;
        case 'sche': r = V.sche(); break;
        case 'maistru': r = V.maistru(); break;
        case 'reglament': r = V.reglament(); break;
        case 'notes': r = V.notes(); break;
        case 'probih': r = V.probih(); break;
        case 'obmin': r = V.obmin(); break;
        case 'excel': r = Excel.screen(); break;
        case 'nalashtuvannia': r = V.nalashtuvannia(); break;
        case 'edit': r = F.render(b, c, q); break;
        default: r = V.notFound();
      }
    } catch (err) {
      console.error(err);
      r = { title: 'Помилка', back: true, html: `<section class="panel"><p class="err">Сталася помилка: ${U.esc(err.message)}</p></section>` };
    }
    const tab = a === 'edit' ? (TAB_OF_EDIT[b] || 'sche') : (TAB_OF[a] || 'sche');
    render(r, tab);
  }

  function render(r, tab) {
    $('topTitle').textContent = r.title;
    document.title = r.title + ' — Кашкай ТО';
    $('back').hidden = !r.back;
    photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = [];
    $('view').innerHTML = r.html;
    document.querySelectorAll('#tabs a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    $('fab').hidden = !!r.form;
    const ctx = M.context();
    $('topKm').textContent = ctx.nowKm != null ? U.km(ctx.nowKm, ctx.nowEst) : '';
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
    openSheet(`
      <a class="item" href="#/edit/visit/new"><b>Записати ТО / роботу</b><div class="sub">Що зроблено, по вузлах</div></a>
      <div class="item"><b>Документ з фото</b><div class="sub">Програма прочитає дату, суму, позиції — ви перевірите</div>
        <div class="actions">${V.ocrButtons()}</div></div>
      <a class="item" href="#/edit/doc/new"><b>Новий документ / чек вручну</b><div class="sub">Акт, накладна, чек — з позиціями і фото</div></a>
      <a class="item" href="#/edit/odo/new"><b>Записати пробіг</b><div class="sub">Показ одометра</div></a>
      <a class="item" href="#/edit/note/new"><b>Нотатка</b><div class="sub">Порада механіка, нагадування</div></a>
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
      case 'photo-open': openPhoto(el.dataset.id); break;
      case 'photo-del': {
        if (!confirm('Видалити це фото?')) return;
        await DB.removeFiles(el.dataset.id);
        closeSheet();
        showPhotos(el.dataset.doc);
        break;
      }
      case 'update': if (App._waiting) App._waiting.postMessage('skipWaiting'); break;
    }
  });

  document.addEventListener('change', async ev => {
    const t = ev.target;
    if (t.matches('[data-act="import"]')) { const f = t.files[0]; t.value = ''; await Obmin.importFile(f); }
    else if (t.matches('[data-photo]')) { await addPhotos(t.dataset.photo, [...t.files]); t.value = ''; }
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
      return;
    }
    F.onInput(ev);
  });

  document.addEventListener('submit', async ev => {
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
  function serviceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && !/[?&]sw\b/.test(location.search)) return;
    const ask = w => {
      App._waiting = w;
      const b = $('banner');
      b.innerHTML = 'Є нова версія програми. <button class="btn small" data-act="update">Оновити</button>';
      b.hidden = false;
    };
    navigator.serviceWorker.register('sw.js').then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
      });
    }).catch(err => console.warn('Не вдалося підключити роботу без інтернету', err));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  }

  async function init() {
    try { await DB.open(); }
    catch (err) {
      $('view').innerHTML = `<section class="panel"><h2>Не вдалося відкрити дані</h2><p class="err">${U.esc(err.message)}</p></section>`;
      return;
    }
    window.addEventListener('hashchange', ev => {
      const old = ev.oldURL.indexOf('#') >= 0 ? ev.oldURL.slice(ev.oldURL.indexOf('#')) : '';
      scrollPos.set(old, window.scrollY);
      navCount++;
      closeSheet();
      route();
    });
    route();
    serviceWorker();
    DB.persist();
  }

  return { VERSION, init, showPhotos, refresh: () => route() };
})();

App.init();
