'use strict';
// Мої запчастини: власний короткий список під цей автомобіль (VIN у налаштуваннях) — не каталог.
// Запис part {cat, name, qty (скільки потрібно),
//   oem (номер за каталогом), chk ('ok' перевірено за VIN | 'bad' за VIN не підходить | null не перевірено), chkDate, chkWhere,
//   oemPrice, oemDate, oemShop (ціна оригіналу на дату),
//   alts: [{brand, num, st ('ok' ставив — добре | 'dont' не брати | null), price, date, shop, note}],
//   with (купити разом — кожна з нового рядка), now (що ставили, з актів), note, dont (не брати), src}.
// Номер з акта СТО — лише «що ставили»: СТО могло поставити інше, тож без позначки «перевірено за VIN» він не каталог.
// Старі записи мали alts текстом (кожен з нового рядка) — перетворюємо при показі, масивом зберігаються після «Зберегти».
const Parts = (() => {
  const e = U.esc;
  const CATS = ['ТО: олива й фільтри', 'Рідини', 'Знос: гальма й підвіска', 'Щітки, лампи, дрібне', 'Рідко й дорого'];
  const FRESH = 90;   // днів: ціна старша — «стара ціна», сірим
  // Запчастини за замовчуванням і «підозрілі» номери — з пакета моделі (js/model-j11.js).
  // Рядок: [розділ, назва, оригінал, аналоги, що ставили, звідки, скільки, pk, nodes].
  const SEED = J11.PARTS;

  const key = s => (s || '').replace(/[\s.\-]/g, '').toUpperCase();
  // Постійний код запчастини з пакета моделі: збережений, а для старого запису — за назвою (його запише M.ensureNodes).
  const pkOf = p => p.pk || ((SEED.find(s => key(s[1]) === key(p.name)) || [])[7]) || null;
  const nameOf = p => p.name || 'Запчастина';
  const grn = n => Number.isInteger(n) ? U.money0(n) : U.money(n);

  // «Wix WL7506», «15209-00Q0F (Nissan, акт 2024)», «Victor Reinz 71-10887-00 (акт 2024)» → {brand, num, note}.
  function parseLine(s) {
    let note = null;
    const m = /\s*\(([^)]*)\)\s*$/.exec(s);
    if (m) { note = m[1].trim() || null; s = s.slice(0, m.index).trim(); }
    const toks = s.split(/\s+/).filter(Boolean);
    let i = toks.length - 1;
    while (i >= 0 && !/\d/.test(toks[i])) i--;
    let brand = i > 0 ? toks.slice(0, i).join(' ') : null;
    const num = i >= 0 ? toks.slice(i).join(' ') : s;
    const b = !brand && note && /^([A-Z][A-Za-z]+)(?:,\s*|$)(.*)$/.exec(note);
    if (b) { brand = b[1]; note = b[2].trim() || null; }
    return { brand, num: num || null, st: null, price: null, date: null, shop: null, note };
  }
  // Старий запис (аналоги текстом) → новий вигляд. Новий повертається як є.
  function norm(p) {
    if (Array.isArray(p.alts)) return p;
    const alts = [], w = p.with ? [p.with] : [];
    for (const raw of String(p.alts || '').split('\n')) {
      const s = raw.trim();
      if (!s) continue;
      if (/^[а-яіїєґ]/.test(s)) w.push(s); else alts.push(parseLine(s));
    }
    return Object.assign({}, p, { alts, with: w.join('\n') || null });
  }
  const parts = () => DB.list('part').map(norm);

  async function seed() {
    const have = new Set(DB.list('part').map(p => key(p.name)));
    for (const p of DB.list('part')) if (p.pk) have.add('pk:' + p.pk);
    // Раніше диски були одним рядком «передні / задні» — якщо він є, окремі рядки не додаємо.
    if (have.has(key('Диски гальмівні передні / задні'))) { have.add(key('Диски гальмівні передні')); have.add(key('Диски гальмівні задні')); }
    const recs = SEED.filter(s => !have.has(key(s[1])) && !have.has('pk:' + s[7])).map(s => norm({
      t: 'part', cat: CATS[s[0]], name: s[1], oem: s[2] || null, alts: s[3] || null, now: s[4] || null, src: s[5] || null, qty: s[6] || null, chk: null,
      pk: s[7], nodes: s[8].slice(),
    }));
    if (!recs.length) { U.toast('Усе вже є в списку'); return; }
    await DB.saveAll(recs);
    U.toast('Додано пунктів: ' + recs.length);
  }

  // Пошук за номером на сайтах продавців: лише відкриваємо сайт у новій вкладці, ціни програма не тягне.
  const SHOPS = [
    ['Intercars', n => 'https://intercars.com.ua/search/?q=' + encodeURIComponent(n)],
    ['Google', n => 'https://www.google.com/search?q=' + encodeURIComponent(n + ' купити ціна')],
    ['Exist', n => 'https://exist.ua/search/?q=' + encodeURIComponent(n)],
  ];

  // Номери, що ставили, але яких немає ні в каталожному, ні серед аналогів — показуємо попередження.
  function mismatch(p) {
    if (!p.now || (!p.oem && !p.alts.length)) return [];
    const known = key([p.oem || '', ...p.alts.map(a => a.num || '')].join(' '));
    const nums = (p.now.match(/\d{2,6}[\- ]?[0-9A-Za-z]{3,6}/g) || []).filter(t => /\d{4}/.test(t) && /[A-Za-z]|-/.test(t) || /^\d{9,}$/.test(t));
    return nums.filter(t => key(t).length >= 8 && !known.includes(key(t)));
  }

  const ageText = d => d < 60 ? U.daysText(d) : Math.round(d / 30.4) + ' міс.';
  // Ціна з датою: свіжа (до 3 міс.) — звичайна, старша чи без дати — сірим з позначкою «стара ціна».
  function priceText(price, date, shop) {
    if (price == null) return '';
    const age = date ? U.days(date, U.today()) : null, old = age == null || age > FRESH;
    const tail = [shop, date ? 'на ' + U.date(date) : 'дата невідома'].filter(Boolean).join(' · ')
      + (old ? ' · стара ціна' + (age != null ? ' (' + ageText(age) + ')' : '') : '');
    return `<b class="${old ? 'muted' : ''}">${e(grn(price))}</b> <span class="muted small">${e(tail)}</span>`;
  }
  function chkTag(p) {
    if (p.chk === 'ok') return `<span class="tag tag-ok">✓ перевірено за VIN${p.chkDate ? ' ' + e(U.date(p.chkDate)) : ''}</span>`;
    if (p.chk === 'bad') return '<span class="tag tag-bad">за VIN не підходить</span>';
    return '<span class="tag tag-wait">не перевірено за VIN</span>';
  }
  const ST = { ok: 'ставив — добре', dont: 'не брати' };

  function item(p) {
    const n = (p.oem || '').trim();
    const sn = n || ((p.alts.find(a => a.num) || {}).num || '');   // номер для пошуку в магазинах
    const mm = mismatch(p);
    const warn = p.chk !== 'ok' && J11.SUSPECT[pkOf(p)];
    const shops = sn ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${SHOPS.map(([nm, f]) =>
      `<a class="btn small ghost" href="${e(f(sn))}" target="_blank" rel="noopener">${nm}</a>`).join('')}
      <button class="btn small ghost" type="button" data-act="copy" data-src="#pn_${e(p.id)}">Скопіювати номер</button></div>` : '';
    const alts = p.alts.filter(a => a.num || a.brand).map(a => `<li class="${a.st === 'dont' ? 'muted' : ''}">
      ${e([a.brand, a.num].filter(Boolean).join(' '))}${a.st ? ` <span class="small ${a.st === 'dont' ? 'err' : 'ok'}">${ST[a.st]}</span>` : ''}
      ${a.price != null ? '<br>' + priceText(a.price, a.date, a.shop) : ''}${a.note ? ` <span class="muted small">(${e(a.note)})</span>` : ''}</li>`).join('');
    const q = [p.name, p.oem, p.now, p.note, p.with, ...p.alts.flatMap(a => [a.brand, a.num, a.note])].join(' ').toLowerCase();
    return `<div class="item${p.dont ? ' muted' : ''}" data-q="${e(q)}">
      <div class="row"><b class="grow">${e(nameOf(p))}${p.qty ? ` <span class="muted small">· ${e(p.qty)}</span>` : ''}</b><a class="btn small ghost" href="#/edit/part/${e(p.id)}">Змінити</a></div>
      ${n ? `<div>За каталогом: <b${p.chk === 'bad' ? ' class="err"' : ''}>${e(n)}</b> ${chkTag(p)}</div>`
        : '<div class="muted small">Номера за каталогом ще немає — знайдіть за VIN і впишіть</div>'}
      ${n && p.oemPrice != null ? `<div class="small">Оригінал: ${priceText(p.oemPrice, p.oemDate, p.oemShop)}</div>` : ''}
      ${alts ? `<div class="small">Аналоги:</div><ul class="alts small">${alts}</ul>` : ''}
      ${p.with ? `<div class="small">Купити разом: ${e(p.with).replace(/\n/g, '; ')}</div>` : ''}
      ${p.now ? `<div class="small">Ставили (з актів): ${e(p.now)}</div>` : ''}
      ${warn ? `<div class="small err">⚠ ${e(warn)}</div>` : ''}
      ${mm.length ? `<div class="small err">⚠ Номер ${e(mm.join(', '))} ставили, але його немає ні в каталожному, ні серед аналогів — звірте за VIN.</div>` : ''}
      ${p.dont ? '<div class="small err">Не брати</div>' : ''}
      ${p.note ? `<div class="small muted">${e(p.note)}</div>` : ''}
      ${p.src ? `<div class="small muted">Звідки: ${e(p.src)}</div>` : ''}
      <span hidden id="pn_${e(p.id)}">${e(sn)}</span>
      ${shops}</div>`;
  }

  function screen() {
    const ps = parts();
    const add = '<a class="btn" href="#/edit/part/new">Додати запчастину</a>';
    if (!ps.length) {
      return {
        title: 'Мої запчастини', back: true, html: `<section class="panel"><h2>Свій список запчастин</h2>
          <p>Короткий список під ваш автомобіль: номер за каталогом (з позначкою, чи звірено за VIN), аналоги з цінами на дату, що ставили на СТО. Кнопки відкривають пошук за номером на сайтах продавців.</p>
          <p>Можна одразу заповнити номерами з ваших актів СТО. Це те, що ставили, — його ще треба звірити за VIN. Чого в актах не було — лишиться порожнім рядком «знайти за VIN».</p>
          <p class="actions"><button class="btn" data-act="parts-seed">Заповнити з актів СТО</button> ${add}</p></section>`,
      };
    }
    const cats = CATS.concat(ps.map(p => p.cat).filter(c => c && !CATS.includes(c)));
    const body = cats.map(c => {
      const xs = ps.filter(p => (p.cat || CATS[3]) === c).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'uk'));
      return xs.length ? `<h3 class="sec">${e(c)}</h3><div class="list">${xs.map(item).join('')}</div>` : '';
    }).join('');
    const empty = ps.filter(p => !p.oem).length;
    const unchecked = ps.filter(p => p.oem && p.chk !== 'ok').length;
    const today = U.today();
    const stale = ps.filter(p => [[p.oemPrice, p.oemDate], ...p.alts.map(a => [a.price, a.date])]
      .some(([pr, d]) => pr != null && (!d || U.days(d, today) > FRESH))).length;
    const counts = [empty && 'без номера: ' + empty, unchecked && 'не перевірено за VIN: ' + unchecked, stale && 'зі старою ціною: ' + stale].filter(Boolean).join(' · ');
    return {
      title: 'Мої запчастини', back: true, html: `
      <section class="panel"><div class="row"><div class="grow"><b>${ps.length}</b> <span class="muted small">пунктів${counts ? ' · ' + counts : ''}</span></div>${add}</div>
        <p class="muted small">Номери з актів СТО — це те, що ставили, а не каталог: СТО могло поставити інше, а програма — помилитися, читаючи акт. Звірте номер за VIN і позначте «перевірено». Ціни — на дату; старші за 3 місяці показані сірим.</p>
        <p><button class="btn small ghost" data-act="parts-seed">Дозаповнити з актів</button></p>
        <p class="muted small"><b>Без ключа, безкоштовно:</b> 1) скопіюйте запит, 2) вставте його в додаток Gemini на телефоні, 3) скопіюйте відповідь і вставте нижче.</p>
        <p><button class="btn small" data-act="gem-copy">1. Скопіювати запит для Gemini</button></p>
        <textarea id="gemPaste" rows="3" placeholder="3. Сюди вставте відповідь Gemini" style="width:100%"></textarea>
        <p><button class="btn small" data-act="gem-paste">Розібрати відповідь</button></p></section>
      <div id="gemBox"></div>
      <input id="pq" type="search" placeholder="Пошук: назва, номер, виробник" autocomplete="off" style="width:100%;margin:8px 0">
      <div id="pbody">${body}</div>`,
      after: () => {
        Ceny.draw();
        const q = document.getElementById('pq');
        if (!q) return;
        q.addEventListener('input', () => {
          const t = q.value.trim().toLowerCase();
          document.querySelectorAll('#pbody .item').forEach(it => { it.hidden = !!t && !it.dataset.q.includes(t); });
          document.querySelectorAll('#pbody .sec').forEach(h => { const l = h.nextElementSibling; h.hidden = !!t && ![...l.children].some(c => !c.hidden); });
        });
      },
    };
  }

  // ---------- форма ----------
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
  function altEd(a = {}) {
    const st = [['', 'Не пробував'], ['ok', 'Ставив — добре'], ['dont', 'Не брати']]
      .map(([v, l]) => `<option value="${v}"${(a.st || '') === v ? ' selected' : ''}>${l}</option>`).join('');
    return `<div class="item-ed pa-ed">
      <div class="row"><input name="a_brand" placeholder="Виробник" autocomplete="off" list="paBrands" value="${e(a.brand || '')}" class="grow">
        <button type="button" class="x" data-act="pa-del" aria-label="Прибрати аналог">×</button></div>
      <div class="pa-grid">
        <input name="a_num" placeholder="Номер" autocomplete="off" value="${e(a.num || '')}" class="span2">
        <select name="a_st">${st}</select>
        <input name="a_price" inputmode="decimal" placeholder="Ціна, грн" autocomplete="off" value="${e(a.price == null ? '' : String(a.price).replace('.', ','))}">
        <input name="a_date" type="date" title="Ціна на дату" value="${e(a.date || '')}">
        <input name="a_shop" placeholder="Магазин" autocomplete="off" list="paShops" value="${e(a.shop || '')}">
      </div>
      <input name="a_note" placeholder="Примітка" autocomplete="off" value="${e(a.note || '')}"></div>`;
  }
  function addAlt() {
    const box = document.getElementById('palts');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', altEd());
    box.lastElementChild.querySelector('[name="a_brand"]').focus();
  }

  function form(id) {
    const isNew = id === 'new';
    const raw = isNew ? { t: 'part', cat: CATS[0], alts: [] } : DB.get(id);
    if (!raw) return V.notFound();
    const p = norm(raw);
    const all = parts();
    const shops = uniq(SHOPS.map(s => s[0]).concat(all.flatMap(x => [x.oemShop, ...x.alts.map(a => a.shop)])));
    const brands = uniq(['Nissan', 'Bosch', 'Wix', 'Mann', 'Mahle', 'Valeo', 'TRW', 'Brembo', 'Febi', 'Lemförder', 'SKF', 'Gates', 'Contitech', 'NGK', 'Denso', 'Sachs', 'KYB']
      .concat(all.flatMap(x => x.alts.map(a => a.brand))));
    const cats = CATS.concat(p.cat && !CATS.includes(p.cat) ? [p.cat] : []);
    const fld = (f, v) => F.field(f, v);
    return {
      title: isNew ? 'Нова запчастина' : nameOf(p), back: true, form: true, html: `
      <form class="panel form" data-form="part" data-id="${isNew ? '' : e(id)}">
        <datalist id="paShops">${shops.map(x => `<option value="${e(x)}">`).join('')}</datalist>
        <datalist id="paBrands">${brands.map(x => `<option value="${e(x)}">`).join('')}</datalist>
        ${fld({ k: 'name', label: 'Назва', type: 'text', req: true }, p.name)}
        <div class="grid2">
          ${fld({ k: 'cat', label: 'Розділ', type: 'select', opts: cats.map(c => ({ v: c, l: c })) }, p.cat)}
          ${fld({ k: 'qty', label: 'Скільки потрібно', type: 'text', hint: '4 шт., 4,6 л' }, p.qty)}
        </div>
        <h3>За каталогом</h3>
        <p class="muted small">Номер, який каталог дає саме для вашого VIN. Номер з акта СТО — ще не каталог: СТО могло поставити інше.</p>
        ${fld({ k: 'oem', label: 'Номер оригіналу', type: 'text' }, p.oem)}
        <div class="grid2">
          ${fld({ k: 'chk', label: 'Перевірено за VIN', type: 'select', opts: [{ v: '', l: 'Ні, не перевірено' }, { v: 'ok', l: 'Так, підходить' }, { v: 'bad', l: 'Перевірено — не підходить' }] }, p.chk || '')}
          ${fld({ k: 'chkDate', label: 'Коли перевірено', type: 'date' }, p.chkDate)}
          ${fld({ k: 'chkWhere', label: 'Де перевіряли', type: 'text', hint: 'каталог, магазин' }, p.chkWhere)}
        </div>
        <div class="grid2">
          ${fld({ k: 'oemPrice', label: 'Ціна оригіналу, грн', type: 'number' }, p.oemPrice)}
          ${fld({ k: 'oemDate', label: 'Ціна на дату', type: 'date' }, p.oemDate)}
          ${fld({ k: 'oemShop', label: 'Магазин', type: 'text', list: shops }, p.oemShop)}
        </div>
        <h3>Аналоги</h3>
        <p class="muted small">Кожен аналог окремо: виробник і номер. Ціну пишіть сьогоднішню — дата поставиться сама; ціна старша за 3 місяці показується сірим.</p>
        <div id="palts">${p.alts.map(altEd).join('')}</div>
        <p><button type="button" class="btn ghost" data-act="pa-add">Додати аналог</button></p>
        ${fld({ k: 'with', label: 'Купити разом', type: 'textarea', rows: 3, hint: 'супутні дрібниці: шайба, гайка, підшипник — кожна з нового рядка' }, p.with)}
        ${fld({ k: 'now', label: 'Що ставили (з актів СТО)', type: 'text' }, p.now)}
        ${fld({ k: 'note', label: 'Нотатка', type: 'textarea', rows: 2, hint: 'ставив, не підійшло, де брав' }, p.note)}
        ${fld({ k: 'dont', label: 'Не брати', type: 'check' }, p.dont)}
        ${F.actions(isNew)}
      </form>`,
    };
  }

  // Змінили ціну — дата ціни стає сьогоднішньою; позначили перевірку — дата перевірки теж.
  function onInput(ev) {
    const t = ev.target, today = U.today();
    const setDate = el => { if (el) el.value = today; };
    if (t.name === 'a_price') setDate(t.closest('.pa-ed').querySelector('[name="a_date"]'));
    else if (t.name === 'oemPrice') setDate(t.form.elements.oemDate);
    else if (t.name === 'chk') { const d = t.form.elements.chkDate; if (d) d.value = t.value ? today : ''; }
  }

  async function submit(form) {
    const id = form.dataset.id;
    const g = k => form.elements[k] ? form.elements[k].value.trim() : '';
    const alts = [];
    for (const el of form.querySelectorAll('.pa-ed')) {
      const v = n => el.querySelector(`[name="${n}"]`).value.trim();
      const a = { brand: v('a_brand') || null, num: v('a_num') || null, st: v('a_st') || null, price: U.num(v('a_price')), date: v('a_date') || null, shop: v('a_shop') || null, note: v('a_note') || null };
      if (!a.brand && !a.num && a.price == null && !a.note) continue;   // порожній рядок
      if (a.price != null && a.price < 0) { U.toast('Ціна не може бути від’ємною'); return false; }
      if (a.price != null && !a.date) a.date = U.today();
      if (a.price == null) a.date = null;
      alts.push(a);
    }
    const oemPrice = U.num(g('oemPrice'));
    if (oemPrice != null && oemPrice < 0) { U.toast('Ціна не може бути від’ємною'); return false; }
    const chk = g('chk') === 'ok' || g('chk') === 'bad' ? g('chk') : null;
    const rec = {
      name: g('name'), cat: g('cat') || CATS[0], qty: g('qty') || null, oem: g('oem') || null,
      chk, chkDate: chk ? g('chkDate') || U.today() : null, chkWhere: chk ? g('chkWhere') || null : null,
      oemPrice, oemDate: oemPrice != null ? g('oemDate') || U.today() : null, oemShop: oemPrice != null ? g('oemShop') || null : null,
      alts, with: g('with') || null, now: g('now') || null, note: g('note') || null, dont: form.elements.dont.checked,
    };
    const base = id ? DB.get(id) : { t: 'part' };
    if (!base) { U.toast('Запис уже видалено'); return false; }
    const saved = Object.assign({}, base, rec);
    if (!Array.isArray(saved.nodes)) saved.nodes = M.partNodes(saved);   // вузли зберігаються й надалі не залежать від назви
    await DB.save(saved);
    U.toast('Збережено');
    return true;
  }

  return { screen, seed, form, submit, onInput, addAlt, CATS, parts, norm };
})();
