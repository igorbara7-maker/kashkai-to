'use strict';
// «Оновити ціни» через Gemini з пошуком у інтернеті. Ключ — власний безкоштовний, лежить лише на цьому пристрої (meta, не синхронізується).
// ШІ нічого не записує сам: знайдене показується списком із посиланням, і кожну ціну власник приймає окремо.
// Ціна без джерела (пошук не спрацював) відкидається; ціна, не схожа на правдоподібну, — теж.
const Ceny = (() => {
  const e = U.esc;
  const KEY = 'gemKey', MODEL = 'gemini-2.5-flash', FRESH = 90, PER_RUN = 6, GAP = 7000;
  let found = [];           // {pid, num, price, shop, url, name}
  let notes = [];           // рядки-пояснення (не знайдено, помилки)
  let busy = false, state = '';

  const key = () => DB.getMeta(KEY) || '';
  const norm = s => (s || '').replace(/[\s.\-]/g, '').toUpperCase();

  async function saveKey(v) {
    v = (v || '').replace(/[\s"']/g, '');
    if (v && !/^[A-Za-z0-9_.\-]{20,200}$/.test(v)) { U.toast('Це не схоже на ключ Gemini'); return false; }
    await DB.setMeta(KEY, v || null);
    U.toast(v ? 'Ключ збережено на цьому пристрої' : 'Ключ прибрано');
    return true;
  }

  function settingsPanel() {
    const has = !!key();
    return `<section class="panel"><h3>Gemini (ціни запчастин)</h3>
      <p class="muted small">${has ? 'Ключ є. Кнопка «Оновити ціни» — у розділі «Мої запчастини».' : 'Потрібен безкоштовний ключ із сайту aistudio.google.com/apikey.'} Ключ зберігається лише на цьому пристрої й не потрапляє ні в копії, ні в обмін. У Gemini надсилаються тільки назви й номери деталей — без VIN і ваших даних.</p>
      <input id="gemKey" type="password" autocomplete="off" placeholder="${has ? 'Ключ збережено — вставте новий, щоб замінити' : 'Вставте ключ'}" style="width:100%">
      <p class="actions"><button class="btn small" data-act="gem-key-save">Зберегти ключ</button>${has ? ' <button class="btn small ghost" data-act="gem-key-del">Прибрати ключ</button>' : ''}</p></section>`;
  }

  // Які деталі брати: не «не брати», є номер, а ціни немає або вона старша за 3 місяці. Спершу ті, де ціни ще немає.
  function candidates() {
    const today = U.today();
    const old = (pr, d) => pr == null || !d || U.days(d, today) > FRESH;
    const out = [];
    for (const p of Parts.parts()) {
      if (p.dont) continue;
      const nums = [];
      if (p.oem) nums.push({ num: p.oem, old: old(p.oemPrice, p.oemDate), none: p.oemPrice == null });
      for (const a of p.alts) if (a.num && a.st !== 'dont') nums.push({ num: a.num, old: old(a.price, a.date), none: a.price == null });
      const need = nums.filter(n => n.old);
      if (!need.length) continue;
      out.push({ p, nums: need, none: need.every(n => n.none) });
    }
    out.sort((a, b) => (b.none - a.none));
    return out;
  }

  function prompt(c) {
    const list = c.nums.map(n => '- ' + n.num).join('\n');
    return `Знайди ПОТОЧНУ роздрібну ціну у гривнях в українських інтернет-магазинах автозапчастин (intercars.ua, omega.page, exist.ua, avtopro.ua, autodoc тощо) на деталь «${c.p.name}» для Nissan Qashqai за такими номерами:\n${list}\n\n`
      + 'Правила: ціну бери ЛИШЕ зі сторінки товару, яку ти справді знайшов саме за цим номером (не аналог, не схожий номер, не комплект). Якщо не знайшов — price: null. Нічого не вигадуй і не округлюй. '
      + 'Відповідь — ТІЛЬКИ JSON-масив без пояснень: [{"num":"номер зі списку","price":число або null,"shop":"сайт","url":"посилання на сторінку товару"}]';
  }

  async function ask(text) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0 } }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      const err = new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  function parse(resp, c) {
    const cand = resp.candidates && resp.candidates[0];
    if (!cand || !cand.content) return { rows: [], why: 'порожня відповідь' };
    const g = cand.groundingMetadata;
    if (!g || !(g.groundingChunks || []).length) return { rows: [], why: 'пошук у мережі не спрацював — відповідь без джерел відкинуто' };
    const txt = (cand.content.parts || []).map(x => x.text || '').join('');
    const m = /\[[\s\S]*\]/.exec(txt);
    if (!m) return { rows: [], why: 'ціни не знайдено' };
    let arr;
    try { arr = JSON.parse(m[0]); } catch (x) { return { rows: [], why: 'відповідь не розібрати' }; }
    const want = new Map(c.nums.map(n => [norm(n.num), n.num]));
    const rows = [];
    for (const it of Array.isArray(arr) ? arr : []) {
      const num = want.get(norm(it && it.num));
      const price = typeof it.price === 'number' ? it.price : null;
      if (!num || price == null || !(price >= 5 && price <= 300000)) continue;
      const url = typeof it.url === 'string' && /^https?:\/\//i.test(it.url) ? it.url : null;
      rows.push({ pid: c.p.id, name: c.p.name, num, price: Math.round(price * 100) / 100, shop: String(it.shop || '').slice(0, 40) || null, url });
    }
    return { rows, why: rows.length ? '' : 'за цими номерами ціну не знайдено' };
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function run() {
    if (busy) return;
    if (!key()) { U.toast('Спершу вставте ключ Gemini в Налаштуваннях'); return; }
    if (!navigator.onLine) { U.toast('Немає інтернету'); return; }
    const cs = candidates().slice(0, PER_RUN);
    if (!cs.length) { state = 'Усі ціни свіжі (до 3 місяців) або в деталей немає номерів.'; draw(); return; }
    busy = true; found = []; notes = [];
    for (let i = 0; i < cs.length; i++) {
      state = `Шукаю ціни: ${i + 1} з ${cs.length} — ${cs[i].p.name}…`;
      draw();
      try {
        const { rows, why } = parse(await ask(prompt(cs[i])), cs[i]);
        found.push(...rows);
        if (why) notes.push(cs[i].p.name + ': ' + why);
      } catch (x) {
        if (x.status === 429) { notes.push('Ліміт безкоштовних запитів Gemini вичерпано — спробуйте пізніше.'); break; }
        if (x.status === 400 || x.status === 403) { notes.push('Gemini відхилив ключ чи запит (' + x.message.slice(0, 80) + '). Перевірте ключ у Налаштуваннях.'); break; }
        const why2 = x.status ? ('Gemini відповів ' + x.status + ': ' + String(x.message).slice(0, 120)) : ('немає зв’язку з Gemini (' + String(x.message).slice(0, 60) + ')');
        notes.push(cs[i].p.name + ': ' + why2);
        if (x.status === 404 || x.status === 401) break;
      }
      if (i < cs.length - 1) await wait(GAP);
    }
    busy = false;
    state = found.length ? 'Знайдено цін: ' + found.length + '. Перевірте за посиланням і прийміть потрібні.' : 'Нічого нового не знайдено.';
    if (!found.length) notes.push('Інші деталі — повторіть пізніше.');
    draw();
  }

  async function accept(i) {
    const f = found[i];
    if (!f) return;
    const raw = DB.get(f.pid);
    if (!raw) { U.toast('Запчастину вже видалено'); return; }
    const p = Parts.norm(raw), today = U.today();
    let ok = false;
    const rec = Object.assign({}, p);
    if (p.oem && norm(p.oem) === norm(f.num)) { rec.oemPrice = f.price; rec.oemDate = today; rec.oemShop = f.shop; ok = true; }
    else rec.alts = p.alts.map(a => { if (!ok && a.num && norm(a.num) === norm(f.num)) { ok = true; return Object.assign({}, a, { price: f.price, date: today, shop: f.shop }); } return a; });
    if (!ok) { U.toast('Номер у записі змінився'); return; }
    await DB.save(rec);
    found.splice(i, 1);
    U.toast('Ціну записано');
    App.refresh();
  }
  function reject(i) { found.splice(i, 1); draw(); }

  function draw() {
    const box = document.getElementById('gemBox');
    if (!box) return;
    if (!state && !found.length && !notes.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="panel"><p class="small">${e(state)}</p>
      ${found.map((f, i) => `<div class="item"><b>${e(f.name)}</b> <span class="muted small">${e(f.num)}</span><br>
        <b>${e(Number.isInteger(f.price) ? U.money0(f.price) : U.money(f.price))}</b> <span class="muted small">${e(f.shop || '')}${f.url ? ' · <a href="' + e(f.url) + '" target="_blank" rel="noopener">сторінка</a>' : ' · посилання немає'}</span>
        <div class="row" style="gap:6px;margin-top:6px"><button class="btn small" data-act="gem-ok" data-i="${i}">Прийняти</button><button class="btn small ghost" data-act="gem-no" data-i="${i}">Відкинути</button></div></div>`).join('')}
      ${notes.length ? `<div class="muted small">${notes.map(e).join('<br>')}</div>` : ''}
      <p class="muted small">Ціни знайшов ШІ в інтернеті і міг помилитись: звіряйте зі сторінкою. Нічого не записується, поки не натиснете «Прийняти».</p></div>`;
  }

  return { run, accept, reject, draw, saveKey, settingsPanel, hasKey: () => !!key() };
})();
