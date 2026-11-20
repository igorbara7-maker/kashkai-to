'use strict';
// Мої запчастини: власний короткий список під цей автомобіль (VIN у налаштуваннях) — не каталог.
// Запис part {cat, name, oem (номер оригіналу), alts (аналоги, кожен з нового рядка), now (що стоїть зараз), note, dont (не брати), src}.
// Початковий список складено з номерів, що справді стояли в актах СТО (src показує, звідки); решта — порожні рядки «знайти».
const Parts = (() => {
  const e = U.esc;
  const CATS = ['ТО: олива й фільтри', 'Рідини', 'Знос: гальма й підвіска', 'Щітки, лампи, дрібне', 'Рідко й дорого'];
  // [категорія, назва, оригінал, аналоги, що стоїть зараз, звідки]
  const SEED = [
    [0, 'Олива двигуна 5W-30 C3', 'KE900-91073', '', 'Nissan 5W-30 C3, 4,6–4,7 л', 'акти 2023, 2024'],
    [0, 'Масляний фільтр', '15208-00Q1E', 'Wix WL7506\n15209-00Q0F (Nissan, акт 2024)', 'WL7506 (2022–2023); 15209-00Q0F (2024); у 2026 — OE 152095084R', 'акти 2016–2026'],
    [0, 'Шайба зливної пробки двигуна', '32135-AX001', '32135-00Q0C (акт 2023)\n33172-00QAA (ущільнення, акт 2024)', '', 'акти 2016–2024'],
    [0, 'Фільтр повітряний (двигун)', '16546-4BA1B', 'Wix WA9788', 'Wix WA9788 (2024)', 'акти 2016–2024'],
    [0, 'Фільтр салону', '27277-4EM0A', '27277-4BU0A (раніше в актах 2016–2019)\nWix WP2124', 'Wix WP2124 (2024)', 'акти 2016–2024'],
    [0, 'Свічки запалювання (4 шт.)', '22401-00Q0K', '', '22401-00Q0K ×4 (2023)', 'акти 2018, 2021, 2023'],
    [0, 'Паливний фільтр', '', '', '', 'знайти за VIN: чи змінний'],
    [1, 'Антифриз', 'KE902-99945', 'KE902-99935 (інше пакування)', 'Nissan — тип уточнити', 'акти 2017–2022'],
    [1, 'Гальмівна рідина DOT 4', 'KE903-99932', '', '1 л, змінювали 2017–2023', 'акти 2017–2023'],
    [1, 'Мастило КПП (механіка)', '', '', 'міняли 22.06.2026 (марку в акті не вказано)', 'знайти за VIN'],
    [1, 'Омивач', '', '', '', ''],
    [2, 'Колодки гальмівні передні', 'D1060-4EA0A', '', 'D1060-4EA0A (2024)', 'акт 2024'],
    [2, 'Колодки гальмівні задні', '', 'Bosch 0986494816', 'Bosch 0986494816 (2024)', 'акт 2024'],
    [2, 'Диски гальмівні передні / задні', '', '', '', 'знайти за VIN'],
    [2, 'Втулка стабілізатора', '54613-JD17A', '', '2 шт. (2018)', 'акт 2018'],
    [2, 'Стійки стабілізатора', '', '', '', 'знайти за VIN'],
    [2, 'Амортизатор передній', 'E4303-4EA6B', '', 'у зборі (2021)', 'акт 2021'],
    [2, 'Опора амортизатора переднього', '54320-6968R', 'опорний підшипник 54325-8271R\nвідбійник 54050-6FR0A\nгайка 54588-JP00D', 'міняли 2021', 'акт 2021'],
    [2, 'Рульова тяга', '', '43296.01 (акт 2023, 2 шт.)', '2 шт. (2023)', 'акт 2023'],
    [3, 'Щітки склоочисника', '28790-4EA0A', '28890-4EH0A (2023)\n28890-4EH1A (2023)', '2022, 2023', 'акти 2022, 2023'],
    [3, 'Лампи', '', '', '', 'знайти за VIN'],
    [4, 'Ремінь приводу (полікліновий)', '', 'GT 7PK1570', 'GT 7PK1570 (2023)', 'акт 2023'],
    [4, 'Комплект ГРМ + привід масляного насоса', '', '', '', 'знайти за VIN'],
    [4, 'Зчеплення + вижимний підшипник', '', '', '', 'знайти за VIN'],
    [4, 'Подушки двигуна', '', '', '', 'знайти за VIN'],
    [4, 'Акумулятор', '', '', '', 'знайти за VIN (чи є старт-стоп)'],
    [4, 'Прокладка клапанної кришки', '', 'Victor Reinz 71-10887-00 (акт 2024)', 'міняли 2024', 'акт 2024'],
  ];

  const parts = () => DB.list('part');
  const key = s => (s || '').replace(/[\s.\-]/g, '').toUpperCase();
  const nameOf = p => p.name || 'Запчастина';

  async function seed() {
    const have = new Set(parts().map(p => key(p.name)));
    const recs = SEED.filter(s => !have.has(key(s[1]))).map(s => ({
      t: 'part', cat: CATS[s[0]], name: s[1], oem: s[2] || null, alts: s[3] || null, now: s[4] || null, src: s[5] || null,
    }));
    if (!recs.length) { U.toast('Усе вже є в списку'); return; }
    await DB.saveAll(recs);
    U.toast('Додано пунктів: ' + recs.length);
  }

  // Пошук за номером на сайтах продавців: лише відкриваємо сайт у новій вкладці, ціни програма не тягне.
  const SHOPS = [
    ['Intercars', n => 'https://intercars.ua/search/?q=' + encodeURIComponent(n)],
    ['Omega', n => 'https://omega.page/search?q=' + encodeURIComponent(n)],
    ['Exist', n => 'https://exist.ua/search/?q=' + encodeURIComponent(n)],
  ];

  // Номери, що стоять «зараз», але не збігаються ні з оригіналом, ні з аналогами — показуємо попередження.
  function mismatch(p) {
    if (!p.oem || !p.now) return [];
    const known = key([p.oem, p.alts || ''].join(' '));
    const nums = (p.now.match(/\d{2,6}[\- ]?[0-9A-Za-z]{3,6}/g) || []).filter(t => /\d{4}/.test(t) && /[A-Za-z]|-/.test(t) || /^\d{9,}$/.test(t));
    return nums.filter(t => key(t).length >= 8 && !known.includes(key(t)));
  }

  function item(p) {
    const n = (p.oem || '').trim();
    const mm = mismatch(p);
    const shops = n ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${SHOPS.map(([nm, f]) =>
      `<a class="btn small ghost" href="${e(f(n))}" target="_blank" rel="noopener">${nm}</a>`).join('')}
      <button class="btn small ghost" type="button" data-act="copy" data-src="#pn_${e(p.id)}">Скопіювати номер</button></div>` : '';
    return `<div class="item${p.dont ? ' muted' : ''}" data-q="${e([p.name, p.oem, p.alts, p.now, p.note].join(' ').toLowerCase())}">
      <div class="row"><b class="grow">${e(nameOf(p))}</b><a class="btn small ghost" href="#/edit/part/${e(p.id)}">Змінити</a></div>
      ${n ? `<div>Оригінал: <b id="pn_${e(p.id)}">${e(n)}</b></div>` : '<div class="muted small">Номера ще немає — знайдіть за VIN і впишіть</div>'}
      ${p.alts ? `<div class="small">Аналоги: ${e(p.alts).replace(/\n/g, '; ')}</div>` : ''}
      ${p.now ? `<div class="small">Зараз стоїть: ${e(p.now)}</div>` : ''}
      ${mm.length ? `<div class="small err">⚠ Номер ${e(mm.join(', '))} стояв, але його немає серед оригіналу й аналогів — звірте за VIN і впишіть в аналоги, якщо підходить.</div>` : ''}
      ${p.dont ? '<div class="small err">Не брати</div>' : ''}
      ${p.note ? `<div class="small muted">${e(p.note)}</div>` : ''}
      ${p.src ? `<div class="small muted">Звідки: ${e(p.src)}</div>` : ''}
      ${shops}</div>`;
  }

  function screen() {
    const ps = parts();
    const add = '<a class="btn" href="#/edit/part/new">Додати запчастину</a>';
    if (!ps.length) {
      return {
        title: 'Мої запчастини', back: true, html: `<section class="panel"><h2>Свій список запчастин</h2>
          <p>Короткий список під ваш автомобіль: номер оригіналу, аналоги, що стоїть зараз, нотатка «ставив / не брати». Кнопки відкривають пошук за номером на сайтах продавців.</p>
          <p>Можна одразу заповнити номерами з ваших актів СТО (олива, фільтри, свічки, рідини, колодки…). Чого в актах не було — лишиться порожнім рядком «знайти за VIN».</p>
          <p class="actions"><button class="btn" data-act="parts-seed">Заповнити з актів СТО</button> ${add}</p></section>`,
      };
    }
    const cats = CATS.concat(ps.map(p => p.cat).filter(c => c && !CATS.includes(c)));
    const body = cats.map(c => {
      const xs = ps.filter(p => (p.cat || CATS[3]) === c).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'uk'));
      return xs.length ? `<h3 class="sec">${e(c)}</h3><div class="list">${xs.map(item).join('')}</div>` : '';
    }).join('');
    const empty = ps.filter(p => !p.oem).length;
    return {
      title: 'Мої запчастини', back: true, html: `
      <section class="panel"><div class="row"><div class="grow"><b>${ps.length}</b> <span class="muted small">пунктів${empty ? ' · без номера: ' + empty : ''}</span></div>${add}</div>
        <p class="muted small">Номери — з ваших актів СТО. Перш ніж купувати, звіряйте за VIN у каталозі: в актах бувають помилки розпізнавання.</p>
        <p><button class="btn small ghost" data-act="parts-seed">Дозаповнити з актів</button></p></section>
      <input id="pq" type="search" placeholder="Пошук: назва чи номер" autocomplete="off" style="width:100%;margin:8px 0">
      <div id="pbody">${body}</div>`,
      after: () => {
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

  const def = {
    title: 'Запчастина', t: 'part',
    fields: () => [
      { k: 'name', label: 'Назва', type: 'text', req: true },
      { k: 'cat', label: 'Розділ', type: 'select', opts: CATS.map(c => ({ v: c, l: c })) },
      { k: 'oem', label: 'Номер оригіналу', type: 'text' },
      { k: 'alts', label: 'Аналоги', type: 'textarea', rows: 3, hint: 'кожен з нового рядка: бренд і номер' },
      { k: 'now', label: 'Що стоїть зараз', type: 'text' },
      { k: 'note', label: 'Нотатка', type: 'textarea', rows: 2, hint: 'ставив, не підійшло, де брав' },
      { k: 'dont', label: 'Не брати', type: 'check' },
    ],
    defaults: () => ({ cat: CATS[0] }),
  };

  return { screen, seed, def, CATS };
})();
