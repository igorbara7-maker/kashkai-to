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
    ['Intercars', n => 'https://intercars.com.ua/uk/poshuk/?q=' + encodeURIComponent(n)],
    ['Google', n => 'https://www.google.com/search?q=' + encodeURIComponent(n + ' купити ціна')],
    ['Exist', n => 'https://exist.ua/uk/search/?query=' + encodeURIComponent(n)],
    ['Amayama', n => 'https://www.amayama.com/en/find?q=' + encodeURIComponent(n)],
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

  // Каталог оригіналу: Amayama — безкоштовні каталоги Nissan з пошуком за VIN. Якщо VIN заповнено (17 знаків),
  // адреса відкриває пошук одразу з ним (власник погодив); інакше — загальна сторінка каталогу.
  // Назва деталі (і VIN) усе одно копіюється в буфер обміну.
  const CATALOG = 'https://www.amayama.com/en/genuine-catalogs/nissan';
  const catalogUrl = () => { const v = String((M.vehicle() || {}).vin || '').replace(/\s/g, '').toUpperCase(); return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) ? 'https://www.amayama.com/en/genuine-catalogs/epc/nissan-japan/search_frame?frame_no=' + v : CATALOG; };
  const vinClean = () => String((M.vehicle() || {}).vin || '').replace(/\s/g, '').toUpperCase();
  const catalogUrl2 = () => /^[A-HJ-NPR-Z0-9]{17}$/.test(vinClean()) ? 'https://partsouq.com/en/search/all?q=' + vinClean() : 'https://partsouq.com/';
  const vinText = p => { const v = M.vehicle(); return [v.vin ? 'VIN ' + v.vin : '', 'Nissan Qashqai J11 1.2 DIG-T', 'Деталь: ' + nameOf(p)].filter(Boolean).join('\n'); };
  const searchText = p => [p.name, p.oem, p.now, p.note, p.with, ...p.alts.flatMap(a => [a.brand, a.num, a.note])].filter(Boolean).join(' ').toLowerCase();

  // Деталь у картці вузла: номер з позначкою перевірки, аналоги, ціни, «Знайти номер за VIN» і «Купити».
  function item(p) {
    const n = (p.oem || '').trim();
    const sn = n || ((p.alts.find(a => a.num) || {}).num || '');   // номер для пошуку в магазинах
    const mm = mismatch(p);
    const warn = p.chk !== 'ok' && J11.SUSPECT[pkOf(p)];
    const find = p.chk === 'ok' ? '' : `<a class="btn small" href="${e(catalogUrl())}" target="_blank" rel="noopener" data-act="copy-text" data-text="${e(vinText(p))}">Знайти номер за VIN</a> <a class="btn small ghost" href="${e(catalogUrl2())}" target="_blank" rel="noopener" data-act="copy-text" data-text="${e(vinText(p))}">PartSouq</a>`;
    const buy = sn ? `<details class="buy"><summary class="btn small ghost">Купити</summary>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${SHOPS.map(([nm, f]) =>
        `<a class="btn small ghost" href="${e(f(sn))}" target="_blank" rel="noopener">${nm}</a>`).join('')}
        <button class="btn small ghost" type="button" data-act="copy" data-src="#pn_${e(p.id)}">Скопіювати номер</button>
        <button class="btn small ghost" type="button" data-act="gem-copy">Запит про ціни для Gemini</button></div>
      <div class="buyrec" data-id="${e(p.id)}" data-num="${e(sn)}"><div class="small muted">Купили? Запишіть, щоб наступного разу бачити, скільки коштувало.</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><input class="pb-price" inputmode="decimal" placeholder="Ціна, грн" autocomplete="off" style="width:7.5em">
          <input class="pb-shop" placeholder="Магазин" autocomplete="off" list="shopList" style="width:9em">
          <button class="btn small" type="button" data-act="part-buy-save">Записати покупку</button></div></div></details>` : '';
    const paste = p.chk === 'ok' ? '' : `<details class="buy"><summary class="btn small ghost">Вставити знайдений номер</summary>
      <div class="buyrec" data-id="${e(p.id)}"><div class="small muted">Знайшли номер на малюнку каталогу — вставте його сюди.</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><input class="pn-num" placeholder="Номер з каталогу" autocomplete="off" style="width:11em">
          <input class="pn-where" placeholder="Де знайшли" value="Amayama" autocomplete="off" style="width:8em">
          <button class="btn small" type="button" data-act="part-num-save">Перевірено за VIN</button></div></div></details>`;
    const lb = p.buys && p.buys[0];
    const bought = lb ? `<div class="small">Куплено: <b>${e(grn(lb.price))}</b> <span class="muted">${e([lb.shop, U.date(lb.date), lb.num].filter(Boolean).join(' · '))}</span>${p.buys.length > 1 ? ` <span class="muted">(усього покупок: ${p.buys.length})</span>` : ''}</div>` : '';
    const alts = p.alts.filter(a => a.num || a.brand).map(a => `<li class="${a.st === 'dont' ? 'muted' : ''}">
      ${e([a.brand, a.num].filter(Boolean).join(' '))}${a.st ? ` <span class="small ${a.st === 'dont' ? 'err' : 'ok'}">${ST[a.st]}</span>` : ''}
      ${a.price != null ? '<br>' + priceText(a.price, a.date, a.shop) : ''}${a.note ? ` <span class="muted small">(${e(a.note)})</span>` : ''}</li>`).join('');
    return `<div class="part${p.dont ? ' muted' : ''}">
      <div class="row"><b class="grow">${e(nameOf(p))}${p.qty ? ` <span class="muted small">· ${e(p.qty)}</span>` : ''}</b><a class="btn small ghost" href="#/edit/part/${e(p.id)}">Змінити</a></div>
      ${n ? `<div>За каталогом: <b${p.chk === 'bad' ? ' class="err"' : ''}>${e(n)}</b> ${chkTag(p)}</div>`
        : '<div class="muted small">Номера за каталогом ще немає — знайдіть за VIN і впишіть («Змінити»)</div>'}
      ${bought}
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
      <div class="btns">${find}${paste}${buy}</div></div>`;
  }

  // Ви знайшли номер у каталозі й вставили його: записуємо як оригінал, ставимо «перевірено за VIN» із датою.
  // Попередній номер не губимо — він іде в аналоги з приміткою.
  async function saveNum(box) {
    const num = box.querySelector('.pn-num').value.trim().replace(/\s+/g, ' ').toUpperCase();
    if (num.length < 5 || !/^[0-9A-Z][0-9A-Z .\-]*$/.test(num)) { U.toast('Номер виглядає неправильно: лише цифри, літери й дефіс'); return false; }
    const base = DB.get(box.dataset.id);
    if (!base) { U.toast('Запис уже видалено'); return false; }
    const rec = norm(base), old = (rec.oem || '').trim();
    if (old && key(old) !== key(num) && !rec.alts.some(a => key(a.num || '') === key(old)))
      rec.alts.push({ brand: null, num: old, st: null, price: null, date: null, shop: null, note: 'номер раніше в картці, не збігся з каталогом за VIN' });
    rec.alts = rec.alts.filter(a => key(a.num || '') !== key(num) || a.price != null);
    rec.oem = num; rec.chk = 'ok'; rec.chkDate = U.today(); rec.chkWhere = box.querySelector('.pn-where').value.trim() || null;
    await DB.save(rec);
    U.toast('Номер записано: перевірено за VIN');
    return true;
  }
  // Купили: ціна й магазин у деталь. Якщо купили оригінал чи відомий аналог — оновлюємо й його ціну на дату.
  async function saveBuy(box) {
    const price = U.num(box.querySelector('.pb-price').value);
    if (price == null || price <= 0) { U.toast('Вкажіть ціну в гривнях'); return false; }
    const base = DB.get(box.dataset.id);
    if (!base) { U.toast('Запис уже видалено'); return false; }
    const rec = norm(base), shop = box.querySelector('.pb-shop').value.trim() || null, num = box.dataset.num || null, today = U.today();
    rec.buys = [{ date: today, price, shop, num }, ...(Array.isArray(rec.buys) ? rec.buys : [])];
    if (num && key(num) === key(rec.oem || '')) { rec.oemPrice = price; rec.oemDate = today; rec.oemShop = shop; }
    else { const a = rec.alts.find(x => num && key(x.num || '') === key(num)); if (a) { a.price = price; a.date = today; a.shop = shop; } }
    await DB.save(rec);
    U.toast('Покупку записано');
    return true;
  }
  const uniqShops = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
  const shopList = () => `<datalist id="shopList">${uniqShops(SHOPS.map(s => s[0]).concat(parts().flatMap(x => [x.oemShop, ...(x.buys || []).map(b => b.shop), ...x.alts.map(a => a.shop)]))).map(x => `<option value="${e(x)}">`).join('')}</datalist>`;

  // Службові дії зі списком запчастин (під картками вузлів): заповнити, ціни через Gemini, додати свою.
  function tools(ps) {
    const empty = ps.filter(p => !p.oem).length;
    const unchecked = ps.filter(p => p.oem && p.chk !== 'ok').length;
    const today = U.today();
    const stale = ps.filter(p => [[p.oemPrice, p.oemDate], ...p.alts.map(a => [a.price, a.date])]
      .some(([pr, d]) => pr != null && (!d || U.days(d, today) > FRESH))).length;
    const counts = [empty && 'без номера: ' + empty, unchecked && 'не перевірено за VIN: ' + unchecked, stale && 'зі старою ціною: ' + stale].filter(Boolean).join(' · ');
    return `<details class="more"><summary>Запчастини: додати, ціни через Gemini</summary>
      <section class="panel"><div class="row"><div class="grow"><b>${ps.length}</b> <span class="muted small">деталей${counts ? ' · ' + counts : ''}</span></div>
        <a class="btn" href="#/edit/part/new">Додати запчастину</a></div>
        <p class="muted small">Номери з актів СТО — це те, що ставили, а не каталог: СТО могло поставити інше, а програма — помилитися, читаючи акт. Звірте номер за VIN і позначте «перевірено». Ціни — на дату; старші за 3 місяці показані сірим.</p>
        <p><button class="btn small ghost" data-act="parts-seed">${ps.length ? 'Дозаповнити з актів' : 'Заповнити з актів СТО'}</button></p>
        <p class="muted small"><b>Без ключа, безкоштовно:</b> 1) скопіюйте запит, 2) вставте його в додаток Gemini на телефоні, 3) скопіюйте відповідь і вставте нижче.</p>
        <p><button class="btn small" data-act="gem-copy">1. Скопіювати запит для Gemini</button></p>
        <textarea id="gemPaste" rows="3" placeholder="3. Сюди вставте відповідь Gemini" style="width:100%"></textarea>
        <p><button class="btn small" data-act="gem-paste">Розібрати відповідь</button></p></section>
      <div id="gemBox"></div></details>`;
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

  function form(id, q) {
    const isNew = id === 'new';
    const node = isNew && q ? q.get('node') : '';
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
      <form class="panel form" data-form="part" data-id="${isNew ? '' : e(id)}"${node ? ` data-node="${e(node)}"` : ''}>
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
        <h3>Вузол</h3>
        <p class="muted small">Деталь показується в картці вузла. ${Array.isArray(p.nodes) && p.nodes.length ? 'Зараз вона в: ' + e(M.rules().filter(r => !r.group && Nodes.ofRule(r).some(k => p.nodes.includes(k))).map(r => r.name).join('; ') || 'вузол видалено') + '.' : 'Зараз вона ні до якого вузла не віднесена.'} Вибір нижче додає ще один вузол.</p>
        ${fld({ k: 'addNode', label: 'Додати до вузла', type: 'select', opts: [{ v: '', l: '— не міняти —' }].concat(M.rules().filter(r => !r.group).map(r => ({ v: r.id, l: r.name }))) }, '')}
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
    if (!id && form.dataset.node) saved.nodes = [form.dataset.node];   // нова деталь, додана з картки вузла
    if (!Array.isArray(saved.nodes)) saved.nodes = M.partNodes(saved);   // вузли зберігаються й надалі не залежать від назви
    const add = DB.get(g('addNode'));
    if (add) saved.nodes = [...new Set([...saved.nodes, ...Nodes.ofRule(add)])];
    await DB.save(saved);
    U.toast('Збережено');
    return true;
  }

  return { item, tools, saveNum, saveBuy, shopList, searchText, seed, form, submit, onInput, addAlt, CATS, parts, norm };
})();
