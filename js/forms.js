'use strict';
// Форми введення і збереження.
const F = (() => {
  const e = U.esc;
  const numIn = n => n == null ? '' : String(n).replace('.', ',');

  function field(f, val) {
    const id = 'f_' + f.k;
    const req = f.req ? ' required' : '';
    let inp;
    switch (f.type) {
      case 'check':
        return `<label class="check fld-check"><input type="checkbox" name="${f.k}"${val ? ' checked' : ''}> ${e(f.label)}</label>`;
      case 'textarea':
        inp = `<textarea id="${id}" name="${f.k}" rows="${f.rows || 3}"${req}>${e(val ?? '')}</textarea>`;
        break;
      case 'select':
        inp = `<select id="${id}" name="${f.k}"${req}>` + f.opts.map(o =>
          `<option value="${e(o.v)}"${String(o.v) === String(val ?? '') ? ' selected' : ''}>${e(o.l)}</option>`).join('') + '</select>';
        break;
      case 'number':
        inp = `<input id="${id}" name="${f.k}" type="text" inputmode="${f.mode || 'decimal'}" autocomplete="off" value="${e(numIn(val))}"${f.ph ? ` placeholder="${e(f.ph)}"` : ''}${req}>`;
        break;
      default:
        inp = `<input id="${id}" name="${f.k}" type="${f.type || 'text'}" autocomplete="off" value="${e(val ?? '')}"${f.list ? ` list="${id}_l"` : ''}${req}>`
          + (f.list ? `<datalist id="${id}_l">${f.list.map(x => `<option value="${e(x)}">`).join('')}</datalist>` : '');
    }
    return `<label class="fld" for="${id}"><span>${e(f.label)}${f.hint ? ` <small>${e(f.hint)}</small>` : ''}</span>${inp}</label>`;
  }

  function read(form, fields) {
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.k];
      if (!el) continue;
      if (f.type === 'check') out[f.k] = el.checked;
      else if (f.type === 'number') out[f.k] = U.num(el.value);
      else out[f.k] = el.value.trim() || null;
    }
    return out;
  }

  const docOpts = () => [{ v: '', l: '— без документа —' }].concat(M.docs().reverse().map(d => ({
    v: d.id, l: [d.code, U.date(d.date), d.seller || d.kind].filter(Boolean).join(' · '),
  })));
  const ruleOpts = () => M.rules().map(r => ({ v: r.id, l: r.name }));

  // Оцінка пробігу на сьогодні — сірою підказкою в порожньому полі.
  function odoGuess() { const x = M.kmAt(U.today()); return x ? 'сьогодні ≈ ' + U.int(x.km) : ''; }

  // Перевірка пробігу на узгодженість з іншими показами.
  function kmOk(date, km) {
    if (km == null || !date) return true;
    const pts = M.points();
    let before = null, after = null;
    for (const p of pts) { if (p.date < date) before = p; else if (p.date > date && !after) after = p; }
    const bad = (before && km < before.km) || (after && km > after.km);
    if (bad) {
      const ctx = [before ? U.date(before.date) + ' — ' + U.km(before.km) : '', after ? U.date(after.date) + ' — ' + U.km(after.km) : ''].filter(Boolean).join('; ');
      return confirm('Пробіг ' + U.km(km) + ' на ' + U.date(date) + ' не узгоджується з іншими показами (' + ctx + '). Зберегти все одно?');
    }
    // Новіший за всі покази, але неправдоподібно великий (помилка в цифрах, чужий документ).
    const prev = pts.filter(p => p.date <= date).pop();
    if (prev && !after) {
      const r = M.rate(pts) || 40, d = U.days(prev.date, date);
      const exp = Math.round(prev.km + r * d), allow = Math.max(3000, r * Math.max(1, d) * 2.5);
      if (km - exp > allow) {
        const why = d > 0 ? 'за очікуваний (' + U.km(exp, true) + '; останній показ ' + U.km(prev.km) + ' на ' + U.date(prev.date) + ')'
          : 'за інший показ того ж дня (' + U.km(prev.km) + ')';
        return confirm('Пробіг ' + U.km(km) + ' на ' + U.date(date) + ' набагато більший ' + why + '. Можливо, помилка в цифрах. Зберегти все одно?');
      }
    }
    return true;
  }

  const DEFS = {
    work: {
      title: 'Запис у журналі', t: 'work',
      fields: () => [
        { k: 'date', label: 'Дата', type: 'date', req: true },
        { k: 'km', label: 'Пробіг, км', type: 'number', mode: 'numeric' },
        { k: 'kmEst', label: 'Пробіг — лише оцінка', type: 'check' },
        { k: 'rule', label: 'Вузол / розділ', type: 'select', opts: ruleOpts(), req: true },
        { k: 'what', label: 'Що зроблено', type: 'text' },
        { k: 'parts', label: "Запчастини / артикул / об'єм", type: 'text' },
        { k: 'doc', label: 'Документ', type: 'select', opts: docOpts() },
        { k: 'note', label: 'Примітка', type: 'textarea', rows: 2 },
      ],
      check: r => r.kmEst || kmOk(r.date, r.km),
    },
    odo: {
      title: 'Показ пробігу', t: 'odo',
      fields: () => [
        { k: 'date', label: 'Дата', type: 'date', req: true },
        { k: 'km', label: 'Пробіг, км', type: 'number', mode: 'numeric', req: true, ph: odoGuess() },
        { k: 'src', label: 'Звідки', type: 'text', hint: 'одометр, акт, чек…' },
      ],
      defaults: () => ({ date: U.today(), src: 'Одометр' }),
      check: r => {
        if (r.km == null || r.km < 0) { U.toast('Вкажіть пробіг числом'); return false; }
        return kmOk(r.date, r.km);
      },
    },
    rule: {
      title: 'Пункт регламенту', t: 'rule',
      fields: () => [
        { k: 'name', label: 'Вузол / операція', type: 'text', req: true },
        { k: 'action', label: 'Що робити', type: 'text', list: ['Заміна', 'Огляд', 'Перевірка', 'Змащення', 'Обслуговування', 'Заміна за станом'] },
        { k: 'km', label: 'Інтервал, км', type: 'number', mode: 'numeric', hint: 'порожньо — без інтервалу' },
        { k: 'months', label: 'Інтервал, місяців', type: 'number', mode: 'numeric' },
        { k: 'season', label: 'Щороку до дат', type: 'text', hint: 'ДД.ММ через кому, напр. 01.11, 01.04 — сезонна заміна шин' },
        { k: 'heavy', label: 'Важкі умови', type: 'text', hint: 'для довідки' },
        { k: 'source', label: 'Джерело', type: 'text' },
        { k: 'note', label: 'Примітка', type: 'textarea', rows: 2 },
        { k: 'order', label: 'Порядок у списку', type: 'number', mode: 'numeric' },
        { k: 'group', label: 'Лише розділ журналу (ремонти — без інтервалу і стану)', type: 'check' },
      ],
      defaults: () => ({ order: Math.max(0, ...DB.list('rule').map(r => r.order || 0)) + 1 }),
    },
    fuel: {
      title: 'Заправка', t: 'fuel',
      fields: () => [
        { k: 'date', label: 'Дата', type: 'date', req: true },
        { k: 'km', label: 'Пробіг за одометром, км', type: 'number', mode: 'numeric', hint: 'від нього залежить розрахунок витрати' },
        { k: 'litres', label: 'Літрів', type: 'number' },
        { k: 'price', label: 'Ціна за літр, грн', type: 'number' },
        { k: 'sum', label: 'Сума, грн', type: 'number', hint: 'досить двох із трьох — третє програма порахує' },
        { k: 'fuel', label: 'Пальне', type: 'text', list: M.used('fuel', 'fuel', P.FUELS) },
        { k: 'station', label: 'АЗС', type: 'text', list: M.used('fuel', 'station', P.STATIONS) },
        { k: 'missed', label: 'Попередню заправку не записано (чек загубився)', type: 'check' },
        { k: 'note', label: 'Примітка', type: 'textarea', rows: 2 },
      ],
      defaults: () => { const l = M.fuels().pop(); return { date: U.today(), fuel: l && l.fuel ? l.fuel : 'А-95' }; },
      check: r => P.complete(r) && kmOk(r.date, r.km),
    },
    note: {
      title: 'Нотатка', t: 'note',
      fields: () => [
        { k: 'text', label: 'Текст', type: 'textarea', rows: 4, req: true },
        { k: 'date', label: 'Дата', type: 'date' },
        { k: 'master', label: 'Додавати до списку для майстра', type: 'check' },
        { k: 'done', label: 'Виконано / закрито', type: 'check' },
      ],
      defaults: () => ({ date: U.today() }),
    },
    vehicle: {
      title: 'Автомобіль', t: 'vehicle',
      fields: () => [
        { k: 'name', label: 'Назва', type: 'text', req: true },
        { k: 'vin', label: 'VIN', type: 'text' },
        { k: 'warnKm', label: 'Попереджати за, км', type: 'number', mode: 'numeric' },
        { k: 'warnDays', label: 'Попереджати за, днів', type: 'number', mode: 'numeric' },
        { k: 'tireSummer', label: 'Літні шини ставити', type: 'text', hint: 'з–по, ДД.ММ–ДД.ММ (стоять зимові — нагадає)' },
        { k: 'tireWinter', label: 'Зимові шини ставити', type: 'text', hint: 'з–по, ДД.ММ–ДД.ММ (стоять літні — нагадає)' },
      ],
      check: r => {
        for (const k of ['tireSummer', 'tireWinter']) {
          if (r[k] && M.seasonDates(r[k]).length !== 2) { U.toast('Дати заміни шин — дві дати ДД.ММ, напр. 01.04–30.04', 4000); return false; }
        }
        return true;
      },
    },
  };

  const actions = (isNew, canDel = true) =>
    `<div class="actions"><button class="btn" type="submit">Зберегти</button>
     ${!isNew && canDel ? '<button class="btn danger" type="button" data-act="delete">Видалити</button>' : ''}</div>`;

  function render(type, id, q) {
    if (type === 'visit') return visit(q);
    if (type === 'doc') return docForm(id, q);
    if (type === 'tireset') return T.setForm(id);
    if (type === 'tireevent') return T.eventForm(id, q);
    const def = DEFS[type];
    if (!def) return V.notFound();
    const isNew = id === 'new';
    let rec;
    if (isNew) rec = Object.assign({}, def.defaults ? def.defaults(q) : {});
    else rec = type === 'vehicle' ? M.vehicle() : DB.get(id);
    if (!rec) return V.notFound();
    const fuel = type === 'fuel';
    if (fuel) picked = [];
    return {
      // Новий показ пробігу — одразу курсор у полі (на телефоні відкриється цифрова клавіатура).
      after: isNew && type === 'odo' ? () => { const el = document.getElementById('f_km'); if (el) el.focus(); }
        : fuel ? () => { P.hint(document.querySelector('form[data-form="fuel"]')); if (!isNew) App.showPhotos(id); } : null,
      title: def.title, back: true, form: true, html: `
      <form class="panel form" data-form="${type}" data-id="${isNew ? '' : e(id)}">
        ${def.fields().map(f => field(f, rec[f.k])).join('')}
        ${fuel ? '<p class="small err" id="fuelMsg" hidden></p>' : ''}
        ${fuel && isNew ? `<div class="fld"><span>Фото чека <small>за бажанням — збережеться із заправкою</small></span>
          <div class="row"><label class="btn small">Камера<input type="file" accept="image/*" capture="environment" data-pick hidden></label>
          <label class="btn small ghost">З галереї<input type="file" accept="image/*" multiple data-pick hidden></label>
          <span class="muted small" id="pickCount"></span></div></div>` : ''}
        ${actions(isNew, type !== 'vehicle')}
      </form>
      ${fuel && !isNew ? `<section class="panel">
        <div class="row"><h3 class="grow">Фото чека</h3>
          <label class="btn small">Камера<input type="file" accept="image/*" capture="environment" data-photo="${e(id)}" hidden></label>
          <label class="btn small ghost">З галереї<input type="file" accept="image/*" multiple data-photo="${e(id)}" hidden></label>
        </div>
        <div class="photos" id="photos"></div>
      </section>` : ''}`,
    };
  }

  // Фото чека для нової заправки: збираємо, доки форму не збережено.
  let picked = [];
  function pick(files) {
    picked = picked.concat([...files]);
    const el = document.getElementById('pickCount');
    if (el) el.textContent = picked.length ? 'вибрано фото: ' + picked.length : '';
  }

  // ---------- кілька робіт за один візит ----------
  function visit(q) {
    const pre = q.get('rule');
    const d = q.get('doc') ? DB.get(q.get('doc')) : null;
    const today = U.today();
    const date = d && d.date ? d.date : today;
    const est = M.kmAt(date);
    const rules = M.rules();
    // З документа: вузли відмічаємо за позиціями, крім уже записаних у журнал за цим документом.
    const sug = d ? M.docRules(d) : new Set();
    const done = d ? M.works().filter(w => w.doc === d.id) : [];
    const doneIds = new Set(done.map(w => w.rule));
    const on = r => r.id === pre || (sug.has(r.id) && !doneIds.has(r.id));
    const preGroup = rules.some(r => r.group && on(r));
    const node = r => `<div class="node${sug.has(r.id) && on(r) ? ' auto' : ''}"><label class="check"><input type="checkbox" name="r" value="${e(r.id)}"${on(r) ? ' checked' : ''}> ${e(r.name)}</label>
      <input type="text" name="w_${e(r.id)}" class="what" autocomplete="off" value="${e(r.action && !r.group ? r.action : '')}" placeholder="Що зроблено"></div>`;
    let head = '';
    if (d) {
      const n = rules.filter(r => sug.has(r.id) && on(r)).length;
      const names = rules.filter(r => doneIds.has(r.id)).map(r => r.name);
      head = `<section class="panel note-box"><b>За документом ${e(d.code || '')} від ${U.date(d.date)}</b>
        <p class="small">${n ? `Програма відмітила вузли за позиціями документа (${n}) — вони з жовтим тлом. Перевірте, зніміть зайве чи додайте пропущене й натисніть «Зберегти».`
          : 'За позиціями документа вузлів не знайдено — позначте виконане вручну.'}</p>
        ${names.length ? `<p class="small muted">Уже записано в журналі за цим документом: ${e(names.join(', '))} — їх не відмічено.</p>` : ''}</section>`;
    }
    return {
      title: 'Записати роботу', back: true, form: true, html: head + `
      <form class="panel form" data-form="visit">
        ${field({ k: 'date', label: 'Дата', type: 'date', req: true }, date)}
        ${field({ k: 'km', label: 'Пробіг, км', type: 'number', mode: 'numeric', hint: d && d.km != null ? 'з документа' : est ? (date === today ? 'сьогодні' : 'на цю дату') + ' орієнтовно ' + U.int(est.km) : '' }, d ? d.km : null)}
        ${field({ k: 'doc', label: 'Документ', type: 'select', opts: docOpts() }, q.get('doc') || '')}
        <div class="fld"><span>Що зроблено — позначте вузли</span></div>
        <div class="nodes">${rules.filter(r => !r.group).map(node).join('')}</div>
        <details${preGroup ? ' open' : ''}><summary>Ремонти та інше</summary><div class="nodes">${rules.filter(r => r.group).map(node).join('')}</div></details>
        ${field({ k: 'parts', label: "Запчастини / артикул / об'єм (до всіх позначених)", type: 'text' }, '')}
        ${field({ k: 'note', label: 'Примітка', type: 'textarea', rows: 2 }, '')}
        ${actions(true)}
      </form>`,
    };
  }

  async function submitVisit(form) {
    const fd = new FormData(form);
    const ids = fd.getAll('r');
    if (!ids.length) { U.toast('Позначте хоча б один вузол'); return false; }
    const date = fd.get('date'), km = U.num(fd.get('km'));
    const doc = fd.get('doc') || null;
    const parts = (fd.get('parts') || '').trim() || null, note = (fd.get('note') || '').trim() || null;
    const dd = doc ? DB.get(doc) : null;
    const kmEst = !!(dd && dd.kmEst && km != null && km === dd.km); // пробіг узято з документа, де він лише оцінка
    if (!kmEst && !kmOk(date, km)) return false;
    const recs = ids.map(rid => Object.assign({ t: 'work', date, km, rule: rid, what: (fd.get('w_' + rid) || '').trim() || null, parts, doc, note }, kmEst ? { kmEst } : {}));
    await DB.saveAll(recs);
    U.toast('Записано: ' + recs.length);
    return true;
  }

  // ---------- документ з позиціями ----------
  const docFields = () => [
    { k: 'code', label: 'Позначка', type: 'text', hint: "Д01, Д02… — для зв'язку з журналом" },
    { k: 'date', label: 'Дата', type: 'date', req: true },
    { k: 'kind', label: 'Тип документа', type: 'text', list: M.used('doc', 'kind', M.DOC_KINDS) },
    { k: 'number', label: 'Номер', type: 'text' },
    { k: 'seller', label: 'СТО / продавець', type: 'text', list: M.used('doc', 'seller') },
    { k: 'km', label: 'Пробіг у документі, км', type: 'number', mode: 'numeric' },
    { k: 'kmEst', label: 'Пробіг — лише оцінка (у документі не вказано)', type: 'check' },
    { k: 'sum', label: 'Сума до сплати, грн', type: 'number', hint: 'як у документі, з урахуванням знижки' },
    { k: 'count', label: 'Враховувати у витратах', type: 'check' },
    { k: 'about', label: 'Що це / рекомендації механіка', type: 'textarea', rows: 3 },
    { k: 'scan', label: 'Де паперовий оригінал чи скан', type: 'text', hint: 'файл, сторінка' },
  ];

  function itemEd(i = {}) {
    return `<div class="item-ed">
      <div class="row"><select name="i_kind">${['Запчастина', 'Робота'].map(k => `<option${i.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
        <input name="i_cat" list="catList" placeholder="Категорія витрат" autocomplete="off" value="${e(i.cat || '')}" class="grow">
        <button type="button" class="x" data-act="item-del" aria-label="Прибрати позицію">×</button></div>
      <input name="i_name" placeholder="Найменування" autocomplete="off" value="${e(i.name || '')}">
      <div class="grid-items">
        <input name="i_art" placeholder="Артикул" autocomplete="off" value="${e(i.art || '')}" class="span2">
        <input name="i_qty" inputmode="decimal" placeholder="К-сть" value="${e(numIn(i.qty))}">
        <input name="i_unit" placeholder="Од." value="${e(i.unit || '')}">
        <input name="i_price" inputmode="decimal" placeholder="Ціна" value="${e(numIn(i.price))}">
        <input name="i_sum" inputmode="decimal" placeholder="Сума" value="${e(numIn(i.sum))}" data-auto="${i.sum == null ? 1 : 0}">
      </div></div>`;
  }

  function docForm(id, q) {
    const isNew = id === 'new';
    const d = isNew ? { code: M.nextDocCode(), date: U.today(), count: true, items: [] } : DB.get(id);
    if (!d) return V.notFound();
    const ocr = !!(q && q.get('ocr'));
    const ocrHtml = ocr ? `
      <section class="panel ocr-box">
        <h3>Розпізнавання фото</h3>
        <p class="small" id="ocrState">Готуюсь…</p>
        <div class="photos" id="ocrPhotos"></div>
        <details id="ocrText" hidden><summary>Розпізнаний текст</summary><pre class="ocr-pre"></pre></details>
      </section>` : '';
    return {
      title: isNew ? 'Новий документ' : 'Документ ' + (d.code || ''), back: true, form: true, html: ocrHtml + `
      <form class="panel form" data-form="doc" data-id="${isNew ? '' : e(id)}"${ocr ? ' data-ocr="1"' : ''}>
        ${docFields().map(f => field(f, d[f.k])).join('')}
        <h3>Позиції</h3>
        <datalist id="catList">${M.usedCats().map(c => `<option value="${e(c)}">`).join('')}</datalist>
        <div id="items">${(d.items || []).map(itemEd).join('')}</div>
        <p><button type="button" class="btn ghost" data-act="item-add">Додати позицію</button></p>
        <p class="muted small" id="itemsTotal"></p>
        ${actions(isNew)}
      </form>`,
      after: () => {
        const form = document.querySelector('form[data-form="doc"]');
        itemsTotal(form);
        if (ocr) return runOcr(form, isNew ? 'new' : id);
      },
    };
  }

  // ---------- заповнення з фото ----------
  let pending = null; // { files:[Blob], attach: додати фото до документа, doc: 'new' чи id }
  function setPending(files, attach = true, doc = 'new') { pending = files && files.length ? { files, attach, doc } : null; }

  async function runOcr(form, docId) {
    const st = document.getElementById('ocrState');
    const say = t => { if (st.isConnected) st.textContent = t; };
    if (!pending || pending.doc !== docId) {
      const files = [];
      if (docId !== 'new') for (const f of DB.filesOf(docId)) { const r = await DB.getFile(f.id); if (r && r.blob) files.push(r.blob); }
      setPending(files, false, docId);
    }
    if (!pending) { say('Немає фото для розпізнавання. Додайте фото документа камерою чи з галереї.'); return; }
    const files = pending.files;
    const box = document.getElementById('ocrPhotos');
    box.innerHTML = files.map(() => '<span class="ph"><img alt="Фото документа"></span>').join('');
    box.querySelectorAll('img').forEach((im, i) => {
      const u = URL.createObjectURL(files[i]);
      im.onload = im.onerror = () => URL.revokeObjectURL(u);
      im.src = u;
    });
    try {
      const r = await OCR.recognize(files, say);
      if (pending && pending.files === files) pending.rots = r.pages.map(p => p.rot || 0); // фото збережемо вже рівним
      if (!form.isConnected) return;
      box.querySelectorAll('img').forEach((im, i) => { const d = r.pages[i] && r.pages[i].rot; if (d) im.style.transform = `rotate(${d}deg)`; });
      const p = OP.parse(r.rows, OCR.known());
      const n = fillDoc(form, p, docId === 'new');
      document.querySelector('#ocrText pre').textContent = r.text || '';
      document.getElementById('ocrText').hidden = !r.text;
      if (!r.rows.length) { say('Тексту не знайдено. Сфотографуйте ближче, рівно, при доброму світлі.'); return; }
      const done = `<span class="ok">Готово за ${Math.max(1, Math.round(r.ms / 1000))} с.</span> `;
      st.innerHTML = done + (n.fields || n.items
        ? `Заповнено полів: ${n.fields}, позицій: ${n.items}. Поля з жовтим тлом програма прочитала сама — звірте їх з документом.`
          + (p.sumWords ? ' Суму звірено із записаною прописом.' : '')
        : 'Порожніх полів немає — нічого не змінено. Розпізнаний текст — нижче.');
    } catch (err) {
      console.error(err);
      say('Не вдалося розпізнати: ' + err.message);
    }
  }

  function fillDoc(form, p, isNew) {
    let fields = 0, items = 0;
    const set = (k, v, force) => {
      const el = form.elements[k];
      if (v == null || v === '' || !el || (el.value.trim() && !force)) return;
      el.value = (k === 'km' || k === 'sum') ? numIn(v) : v;
      el.closest('.fld').classList.add('auto');
      fields++;
    };
    set('date', p.date, isNew); // у новому документі стоїть сьогоднішня дата — замінюємо прочитаною
    set('kind', p.kind); set('number', p.number); set('seller', p.seller); set('km', p.km); set('sum', p.sum);
    const box = form.querySelector('#items');
    if (p.items.length && !box.children.length) {
      box.insertAdjacentHTML('beforeend', p.items.map(itemEd).join(''));
      box.querySelectorAll('.item-ed').forEach(x => x.classList.add('auto'));
      items = p.items.length;
    }
    itemsTotal(form);
    return { fields, items };
  }

  function itemsTotal(form) {
    if (!form) return;
    let s = 0, n = 0;
    form.querySelectorAll('.item-ed').forEach(el => {
      const v = U.num(el.querySelector('[name="i_sum"]').value);
      if (v != null) { s += v; n++; }
    });
    const sum = U.num(form.elements.sum.value);
    const out = form.querySelector('#itemsTotal');
    if (!n) { out.textContent = ''; return; }
    let t = 'Сума позицій: ' + U.money(s);
    if (sum != null && Math.abs(sum - s) > 0.009) t += ' (документ: ' + U.money(sum) + '; різницю — знижку чи ПДВ — програма розподілить пропорційно)';
    out.textContent = t;
  }

  // Автосума позиції: к-сть × ціна, доки суму не введено вручну.
  function onInput(ev) {
    const t = ev.target, form = t.form;
    if (form && form.dataset.form === 'fuel') { P.hint(form); return; }
    if (form && /^tire/.test(form.dataset.form)) { T.onInput(ev, form); return; }
    if (!form || form.dataset.form !== 'doc') return;
    const auto = t.closest('.auto');
    if (auto) auto.classList.remove('auto'); // власник виправив — позначку знімаємо
    const box = t.closest('.item-ed');
    if (box) {
      const sum = box.querySelector('[name="i_sum"]');
      if (t.name === 'i_sum') sum.dataset.auto = t.value.trim() ? '0' : '1';
      else if ((t.name === 'i_qty' || t.name === 'i_price') && sum.dataset.auto === '1') {
        const q = U.num(box.querySelector('[name="i_qty"]').value), p = U.num(box.querySelector('[name="i_price"]').value);
        sum.value = q != null && p != null ? numIn(Math.round(q * p * 100) / 100) : '';
      }
    }
    itemsTotal(form);
  }

  async function submitDoc(form) {
    const id = form.dataset.id;
    const vals = read(form, docFields());
    if (!vals.kmEst && !kmOk(vals.date, vals.km)) return false;
    const items = [...form.querySelectorAll('.item-ed')].map(el => {
      const g = n => el.querySelector(`[name="${n}"]`).value.trim();
      const it = {
        kind: g('i_kind'), cat: g('i_cat') || null, name: g('i_name') || null, art: g('i_art') || null,
        qty: U.num(g('i_qty')), unit: g('i_unit') || null, price: U.num(g('i_price')), sum: U.num(g('i_sum')),
      };
      if (it.sum == null && it.qty != null && it.price != null) it.sum = Math.round(it.qty * it.price * 100) / 100;
      return it;
    }).filter(it => it.name || it.sum != null);
    const base = id ? DB.get(id) : { t: 'doc' };
    const rec = await DB.save(Object.assign({}, base, vals, { items }));
    if (form.dataset.ocr && pending) {
      if (pending.attach && !id) {
        U.toast('Зберігаю фото…', 10000);
        for (let i = 0; i < pending.files.length; i++) {
          await DB.addFile(rec.id, await U.compressImage(pending.files[i], 2000, 0.82, (pending.rots || [])[i] || 0));
        }
      }
      pending = null;
    }
    return { go: '#/doc/' + rec.id };
  }

  // ---------- збереження і видалення ----------
  async function submit(form) {
    const type = form.dataset.form, id = form.dataset.id;
    if (type === 'visit') return submitVisit(form);
    if (type === 'doc') return submitDoc(form);
    if (type === 'tireset') return T.submitSet(form);
    if (type === 'tireevent') return T.submitEvent(form);
    const def = DEFS[type];
    const vals = read(form, def.fields());
    let base;
    if (type === 'vehicle') base = DB.get('vehicle') || { id: 'vehicle', t: 'vehicle' };
    else base = id ? DB.get(id) : { t: def.t };
    if (!base) { U.toast('Запис уже видалено'); return false; }
    const rec = Object.assign({}, base, vals);
    if (def.check && !def.check(rec)) return false;
    await DB.save(rec);
    if (type === 'fuel' && picked.length) {
      U.toast('Зберігаю фото…', 10000);
      for (const f of picked) await DB.addFile(rec.id, await U.compressImage(f));
      picked = [];
    }
    U.toast('Збережено');
    return true;
  }

  async function del(form) {
    const type = form.dataset.form, id = form.dataset.id;
    if (!id) return false;
    let msg = 'Видалити цей запис?';
    if (type === 'rule') {
      const n = DB.list('work').filter(w => w.rule === id).length;
      if (n) msg = "До цього пункту прив'язано записів у журналі: " + n + '. Вони лишаться, але без вузла. Видалити пункт?';
    }
    if (type === 'doc') {
      const n = DB.filesOf(id).length;
      msg = 'Видалити документ' + (n ? ' разом із фото (' + n + ')' : '') + '? Записи в журналі лишаться.';
    }
    if (type === 'fuel') {
      const n = DB.filesOf(id).length;
      msg = 'Видалити заправку' + (n ? ' разом із фото чека (' + n + ')' : '') + '?';
    }
    if (type === 'tireset') {
      const n = DB.list('tireevent').filter(x => x.on === id || x.off === id).length, p = DB.filesOf(id).length;
      msg = (n ? 'Комплект згадується в історії замін (' + n + '). Якщо шини просто більше не використовуєте — краще позначте «Більше не використовується»: історія і пробіг лишаться. ' : '')
        + 'Видалити комплект' + (p ? ' разом із фото (' + p + ')' : '') + '?';
    }
    if (!confirm(msg)) return false;
    if (type === 'doc' || type === 'fuel' || type === 'tireset') await DB.removeFiles(DB.filesOf(id).map(f => f.id));
    await DB.remove(id);
    U.toast('Видалено');
    return { go: type === 'doc' ? '#/docs' : type === 'rule' ? '#/reglament' : null };
  }

  return { render, submit, del, onInput, itemEd, itemsTotal, setPending, pick, field, kmOk, docOpts, actions };
})();
