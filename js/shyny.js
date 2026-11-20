'use strict';
// Шини: комплекти (зимові, літні…), події з шинами (сезонна заміна, перестановка, ремонт, огляд),
// що стоїть на авто зараз, пробіг кожного комплекту, вік за DOT, залишок протектора, сезонні нагадування.
// Записи: tireset {name, season: winter|summer|all, groups:[{id, brand, model, size, dot, count, pos, bought, price, to, note}],
//                  storage, note, retired}
//         tireevent {date, km, kind: swap|rotate|repair|check, on, off, tread:{id групи: мм}, pressure, where, cost, doc, note, boltsOk}
const T = (() => {
  const e = U.esc;
  const SEASONS = { winter: 'Зимові', summer: 'Літні', all: 'Всесезонні' };
  const ON_SEASON = { winter: 'На зимових шинах', summer: 'На літніх шинах', all: 'На всесезонних шинах' };
  const OF_SEASON = { winter: 'зимових', summer: 'літніх', all: 'всесезонних' };
  const ORDER = { winter: 0, summer: 1, all: 2 };
  const KINDS = { swap: 'Сезонна заміна', rotate: 'Перестановка між осями', repair: 'Ремонт (прокол)', check: 'Огляд' };
  const AFTER = { swap: 'заміни шин', rotate: 'перестановки коліс', repair: 'ремонту колеса' };
  const POS = { all: 'усі колеса', front: 'передня вісь', rear: 'задня вісь' };
  const MIN_TREAD = { winter: 4, summer: 2, all: 4 };   // мм — менше радять міняти; законний мінімум 1,6 мм
  const LEGAL = 1.6, AGE_MAX = 6, BOLTS_DAYS = 14;
  const DEF_WIN = { summer: '01.04–30.04', winter: '15.10–15.11' };
  const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const RANK = { over: 0, soon: 1, nodata: 2, ok: 3 };
  const pad = n => String(n).padStart(2, '0');
  const numIn = n => n == null ? '' : String(n).replace('.', ',');
  const mm = n => P.dec(n, Math.abs(n - Math.round(n)) < 0.05 ? 0 : 1) + ' мм';

  const sets = () => DB.list('tireset').sort((a, b) => (a.retired ? 1 : 0) - (b.retired ? 1 : 0)
    || (ORDER[a.season] ?? 3) - (ORDER[b.season] ?? 3) || (a.name || '').localeCompare(b.name || '', 'uk'));
  const events = () => DB.list('tireevent').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.u || 0) - (b.u || 0));
  const has = () => DB.list('tireset').length > 0;
  const nameOf = s => s ? s.name || SEASONS[s.season] || 'Комплект' : 'комплект видалено';
  const setName = id => nameOf(DB.get(id));
  const activeGroups = s => (s.groups || []).filter(g => !g.to);
  const groupName = g => [g.brand, g.model].filter(Boolean).join(' ') || g.size || 'шини';
  const docCode = id => { const d = id && DB.get(id); return d ? d.code || 'документ' : ''; };

  // ---------- коли міняти ----------
  // Вікна з налаштувань авто: «01.04–30.04» → ['04-01', '04-30'].
  function windows(v = M.vehicle()) {
    const w = (s, def) => {
      let d = M.seasonDates(s);
      if (d.length < 2) d = M.seasonDates(def);
      return d.slice(0, 2).map(([m, x]) => pad(m) + '-' + pad(x));
    };
    return { summer: w(v.tireSummer, DEF_WIN.summer), winter: w(v.tireWinter, DEF_WIN.winter) };
  }
  const md = d => d.slice(5);
  // Чи день «ММ-ДД» у межах [a, b] (з переходом через Новий рік).
  const inside = (x, a, b) => a <= b ? x >= a && x <= b : x >= a || x <= b;
  const ddmm = s => s.slice(3) + '.' + s.slice(0, 2);
  const dayMonth = s => +s.slice(3) + ' ' + MONTHS[+s.slice(0, 2) - 1];
  // Найближча дата «ММ-ДД» не раніше сьогодні / найпізніша не пізніше сьогодні.
  const nextOn = (x, today) => { const d = today.slice(0, 4) + '-' + x; return d >= today ? d : (+today.slice(0, 4) + 1) + '-' + x; };
  const lastOn = (x, today) => { const d = today.slice(0, 4) + '-' + x; return d <= today ? d : (+today.slice(0, 4) - 1) + '-' + x; };
  // Який сезон за календарем: зимовий — від початку вікна зимових до початку вікна літніх.
  function seasonNow(today = U.today(), W = windows()) {
    const x = md(today);
    return inside(x, W.winter[0], W.summer[0]) && x !== W.summer[0] ? 'winter' : 'summer';
  }

  // ---------- що стояло на авто і скільки проїхали ----------
  const kmOf = (x, ctx) => x.km != null ? { km: x.km, est: false } : M.kmAt(x.date, ctx.pts);
  // Проміжки між сезонними замінами (останній — по сьогодні).
  function stints(ctx = M.context()) {
    const sw = events().filter(x => x.kind === 'swap' && x.date && x.on);
    const out = [];
    sw.forEach((a, i) => {
      const b = sw[i + 1];
      if (b && b.date === a.date) return;   // дві заміни в один день — береться пізніший запис
      const ka = kmOf(a, ctx);
      const kb = b ? kmOf(b, ctx) : ctx.nowKm != null ? { km: ctx.nowKm, est: ctx.nowEst } : null;
      out.push({
        set: a.on, ev: a, from: a.date, to: b ? b.date : null, kmFrom: ka, kmTo: kb,
        km: ka && kb && kb.km >= ka.km ? kb.km - ka.km : null, est: !!(ka && ka.est) || !!(kb && kb.est),
      });
    });
    return out;
  }
  function current(ctx = M.context(), st = stints(ctx)) {
    let s = null;
    for (const x of st) if (x.from <= ctx.today) s = x;
    const set = s && DB.get(s.set);
    return set ? Object.assign({ setRec: set }, s) : null;
  }
  // Сезон шин, що стояли на дату (для витрати пального взимку і влітку).
  function seasonAt(date, st = stints()) {
    for (let i = st.length - 1; i >= 0; i--) if (st[i].from <= date) { const s = DB.get(st[i].set); return s ? s.season : null; }
    return null;
  }
  function setKm(id, st, ctx) {
    const mine = st.filter(s => s.set === id);
    if (!mine.length) return null;
    const last = mine[mine.length - 1];
    return {
      total: mine.reduce((a, s) => a + (s.km || 0), 0), est: mine.some(s => s.est),
      last: last.km, lastEst: last.est, seasons: mine.length,
    };
  }
  // Пробіг групи: як у комплекту, але від покупки (якщо докупили згодом) і до «знято».
  function groupKm(g, id, st, ctx) {
    let km = 0, est = false;
    for (const s of st) {
      if (s.set !== id) continue;
      const a = g.bought && g.bought > s.from ? g.bought : s.from;
      const end = s.to || ctx.today;
      const b = g.to && g.to < end ? g.to : end;
      if (b <= a) continue;
      const ka = a === s.from ? s.kmFrom : M.kmAt(a, ctx.pts);
      const kb = b === end ? s.kmTo : M.kmAt(b, ctx.pts);
      if (ka && kb && kb.km > ka.km) { km += kb.km - ka.km; est = est || ka.est || kb.est; }
    }
    return { km, est };
  }

  // ---------- вік і протектор ----------
  // DOT — 4 цифри на боковині: тиждень і рік виготовлення (2321 — 23-й тиждень 2021 року).
  function dotDate(dot) {
    const m = /^(\d{2})(\d{2})$/.exec(String(dot || '').trim());
    if (!m || +m[1] < 1 || +m[1] > 53) return null;
    return U.addDays((2000 + +m[2]) + '-01-01', (+m[1] - 1) * 7 + 3);
  }
  const age = (dot, today = U.today()) => { const d = dotDate(dot); return d ? Math.max(0, U.days(d, today) / 365.25) : null; };
  function ageText(a) {
    if (a == null) return '';
    const y = Math.floor(a), m = Math.floor((a - y) * 12);
    if (!y && !m) return 'менше місяця';
    return [y ? y + ' ' + U.plural(y, 'рік', 'роки', 'років') : '', m ? m + ' ' + U.plural(m, 'місяць', 'місяці', 'місяців') : ''].filter(Boolean).join(' ');
  }
  // Останній вимір протектора групи.
  function tread(gid, evs = events()) {
    let r = null;
    for (const x of evs) if (x.tread && x.tread[gid] != null) r = { mm: x.tread[gid], date: x.date };
    return r;
  }

  // ---------- стан для головного екрана ----------
  function status(ctx = M.context()) {
    if (!has()) return null;
    const st = stints(ctx), cur = current(ctx, st), evs = events(), today = ctx.today, W = windows(ctx.v);
    const o = { st: 'ok', cur, warns: [], swap: null, bolts: null };
    const warn = (s, text) => { o.warns.push({ st: s, text }); if (RANK[s] < RANK[o.st]) o.st = s; };
    const stand = cur ? nameOf(cur.setRec) + ' — з ' + U.date(cur.from) + (cur.km != null ? ' · ' + U.km(cur.km, cur.est) + ' за сезон' : '') : null;
    if (!cur) warn('nodata', 'Не вказано, які шини стоять зараз');
    else {
      const season = cur.setRec.season, want = season === 'winter' ? 'summer' : season === 'summer' ? 'winter' : null;
      if (want) {
        const [a, b] = W[want], own = W[season][0], x = md(today), what = 'поставити ' + SEASONS[want].toLowerCase();
        if (inside(x, a, b)) {
          o.swap = 'soon';
          const d = nextOn(b, today), left = U.days(today, d);
          warn('soon', 'Час ' + what + ' — до ' + U.date(d) + (left ? ' (' + U.daysText(left) + ')' : ' (сьогодні останній день)'));
        }
        else if (inside(x, b, own) && x !== b && x !== own) {
          o.swap = 'over';
          const d = lastOn(b, today);
          warn('over', 'Пора ' + what + ' — строк минув ' + U.date(d) + ' (' + U.daysText(U.days(d, today)) + ' тому)');
        }
      }
    }
    const old = [];   // вік — довга порада, тож іде після свіжих (заміна, протектор, болти)
    for (const s of sets().filter(x => !x.retired)) for (const g of activeGroups(s)) {
      const who = nameOf(s) + ': ' + groupName(g);
      const a = age(g.dot, today);
      if (a != null && a >= AGE_MAX) old.push(who + ' — ' + ageText(a) + ' від виготовлення (DOT ' + g.dot + '); шини, старші ' + AGE_MAX + ' років, радять міняти');
      const t = tread(g.id, evs);
      const onCar = cur && cur.set === s.id;
      if (t && t.mm < LEGAL) warn(onCar ? 'over' : 'soon', who + ' — протектор ' + mm(t.mm) + ', менше законних 1,6 мм' + (onCar ? '' : ': до наступного сезону потрібні нові'));
      else if (t && t.mm < MIN_TREAD[s.season]) warn('soon', who + ' — протектор ' + mm(t.mm) + ' (для ' + OF_SEASON[s.season] + ' радять не менше ' + MIN_TREAD[s.season] + ' мм)');
    }
    // Після заміни чи ремонту колеса — перевірити затяжку болтів.
    const lw = evs.filter(x => AFTER[x.kind] && x.date && x.date <= today).pop();
    if (lw && !lw.boltsOk && U.days(lw.date, today) <= BOLTS_DAYS) {
      o.bolts = lw;
      warn('soon', 'Після ' + AFTER[lw.kind] + ' ' + U.date(lw.date) + ': через 50–100 км перевірте затяжку болтів коліс');
    }
    old.forEach(t => warn('soon', t));
    const v = ctx.v;
    if (v.tireSnooze && v.tireSnooze > today) o.snoozed = v.tireSnooze;
    o.warns.sort((a, b) => RANK[a.st] - RANK[b.st]);
    o.main = o.warns.length ? o.warns[0].text : stand;
    o.subs = (o.warns.length ? [stand] : []).concat(o.warns.slice(1).map(w => w.text)).filter(Boolean);
    return o;
  }

  // Картка «Шини» на «Стані» (замість пункту регламенту про шини).
  function card(o) {
    const later = o.snoozed && o.st !== 'ok';
    const acts = [];
    if (o.swap || !o.cur) acts.push(`<a class="btn small" href="#/edit/tireevent/new?kind=swap">${o.cur ? 'Записати заміну' : 'Вказати'}</a>`);
    if (o.bolts) acts.push(`<button type="button" class="btn small ghost" data-act="bolts-ok" data-id="${e(o.bolts.id)}">Болти перевірено</button>`);
    if (o.st !== 'ok' && o.cur) acts.push(`<button type="button" class="btn small ghost" data-act="snooze" data-id="tires">${later ? 'Відкладено' : 'Пізніше'}</button>`);
    return `<div class="card st-${later ? 'later' : o.st}">
      <a class="card-main" href="#/shyny"><b>Шини</b>
        <div class="main-line">${later ? 'Відкладено до ' + U.date(o.snoozed) + ' · ' : ''}${e(o.main)}</div>
        ${o.subs.map(t => `<div class="sub">${e(t)}</div>`).join('')}
      </a>${acts.length ? `<div class="card-acts">${acts.join('')}</div>` : ''}</div>`;
  }

  // Рядки для «Списку для майстра».
  function masterLines(o) {
    if (!o) return [];
    const L = [];
    if (o.cur) {
      L.push('Стоять: ' + nameOf(o.cur.setRec) + ' — ' + activeGroups(o.cur.setRec).map(g =>
        [groupName(g), g.size && (g.brand || g.model) ? g.size : '', g.count + ' шт.' + (g.pos !== 'all' ? ', ' + POS[g.pos] : '')].filter(Boolean).join(', ')).join('; '));
    }
    return L.concat(o.warns.filter(w => w.st === 'over' || w.st === 'soon').map(w => w.text));
  }

  // ---------- екран «Шини» ----------
  function screen() {
    const ss = sets();
    if (!ss.length) {
      return {
        title: 'Шини', back: true, html: `
        <section class="panel">
          <h2>Комплектів шин ще немає</h2>
          <p>Додайте комплекти — «Зимові» і «Літні»: марку, модель, розмір і DOT (тиждень і рік виготовлення з боковини). Якщо на осях різні шини — дві групи по 2.</p>
          <p>Далі записуйте сезонні заміни — програма покаже, що стоїть зараз, пробіг кожного комплекту, вік шин, і нагадає про заміну навесні й восени.</p>
          <p class="actions"><a class="btn" href="#/edit/tireset/new">Додати комплект</a></p>
        </section>${help(windows())}`,
      };
    }
    const ctx = M.context(), st = stints(ctx), o = status(ctx), evs = events(), cur = o.cur;
    const head = `<section class="panel st-${o.st} edge">
      ${cur ? `<div class="muted small">Зараз стоять</div><div class="big">${e(nameOf(cur.setRec))}</div>
        <div class="sub">з ${U.date(cur.from)}${cur.km != null ? ' · ' + U.km(cur.km, cur.est) + ' за цей сезон' : ''}</div>`
        : '<h2>Не вказано, які шини стоять зараз</h2><p class="small">Запишіть сезонну заміну: коли поставили шини, що стоять зараз (дату можна приблизно).</p>'}
      ${o.warns.filter(w => w.st !== 'nodata').map(w => `<div class="hint">${e(w.text)}</div>`).join('')}
      <p class="actions"><a class="btn" href="#/edit/tireevent/new?kind=swap">Записати заміну</a>
        <a class="btn ghost" href="#/edit/tireevent/new?kind=check">Огляд, ремонт…</a>
        ${o.bolts ? `<button type="button" class="btn ghost" data-act="bolts-ok" data-id="${e(o.bolts.id)}">Болти перевірено</button>` : ''}</p>
    </section>`;
    const setItem = s => {
      const k = setKm(s.id, st, ctx), on = cur && cur.set === s.id;
      const where = on ? 'на авто з ' + U.date(cur.from) : s.retired ? 'не використовується' : s.storage ? 'зберігаються: ' + e(s.storage) : 'не на авто';
      const kmTxt = k ? (on ? 'цей сезон ' : 'останній сезон ') + U.km(k.last, k.lastEst) + (k.seasons > 1 ? ' · за весь час ' + U.km(k.total, k.est) : '')
        : 'пробіг — від першої записаної заміни';
      const gl = (s.groups || []).map(g => {
        const a = age(g.dot, ctx.today), t = tread(g.id, evs), gk = k ? groupKm(g, s.id, st, ctx) : null;
        const bits = [
          g.size && (g.brand || g.model) ? e(g.size) : '', g.count + ' шт.' + (g.pos !== 'all' ? ', ' + POS[g.pos] : ''),
          g.dot ? 'DOT ' + e(g.dot) + ' (' + ageText(a) + ')' : 'DOT не вказано',
          t ? 'протектор ' + mm(t.mm) + ' на ' + U.date(t.date) : '',
          gk && gk.km && Math.abs(gk.km - k.total) > 50 ? 'пробіг ' + U.km(gk.km, gk.est) : '',
          g.to ? 'знято ' + U.date(g.to) : '',
        ].filter(Boolean);
        return `<div class="sub${g.to ? ' muted' : ''}"><b class="strong">${e(groupName(g))}</b> · ${bits.join(' · ')}</div>`;
      }).join('');
      return `<a class="item" href="#/edit/tireset/${e(s.id)}"><div class="row"><b class="grow">${e(nameOf(s))}</b>${nameOf(s) !== SEASONS[s.season] ? `<span class="tag">${SEASONS[s.season] || ''}</span>` : ''}</div>
        <div class="sub">${where} · ${kmTxt}</div>${gl}${s.note ? `<div class="sub">${e(s.note)}</div>` : ''}${DB.filesOf(s.id).length ? '<div class="sub">є фото</div>' : ''}</a>`;
    };
    const evItem = x => {
      const what = x.kind === 'swap' ? 'поставили ' + setName(x.on) + (x.off ? ', зняли ' + setName(x.off) : '') : '';
      const tr = x.tread ? Object.values(x.tread).map(mm).join(', ') : '';
      const sub = [x.where, tr ? 'протектор ' + tr : '', x.pressure ? 'тиск ' + x.pressure : '', docCode(x.doc), x.note].filter(Boolean);
      return `<a class="item" href="#/edit/tireevent/${e(x.id)}"><div class="row"><b>${U.date(x.date)}</b><span class="muted">${x.km != null ? U.km(x.km) : ''}</span>
        <span class="grow"></span><span>${x.cost != null ? U.money0(x.cost) : ''}</span></div>
        <div>${KINDS[x.kind] || 'Подія'}${what ? ': ' + e(what) : ''}</div>${sub.length ? `<div class="sub">${e(sub.join(' · '))}</div>` : ''}</a>`;
    };
    let buy = 0, serv = 0;
    for (const s of ss) for (const g of s.groups || []) if (g.price != null) buy += g.price * (g.count || 0);
    for (const x of evs) if (x.cost != null) serv += x.cost;
    const live = ss.filter(s => !s.retired), old = ss.filter(s => s.retired);
    return {
      title: 'Шини', back: true, html: head + `
      <h3 class="sec">Комплекти</h3>
      <div class="list">${live.map(setItem).join('') || '<p class="muted">Усі комплекти позначено «не використовується».</p>'}</div>
      ${old.length ? `<details class="more"><summary>Не використовуються (${old.length})</summary><div class="list">${old.map(setItem).join('')}</div></details>` : ''}
      <p class="actions"><a class="btn ghost" href="#/edit/tireset/new">Додати комплект</a></p>
      ${buy || serv ? `<section class="panel"><h3>Витрати на шини</h3><dl class="kv">${buy ? `<dt>Покупка шин</dt><dd>${U.money0(buy)}</dd>` : ''}${serv ? `<dt>Заміни, ремонт</dt><dd>${U.money0(serv)}</dd>` : ''}</dl>
        <p class="muted small">У «Витрати» ці суми потрапляють через документ (чек) з позначкою «у витратах» — його можна вибрати в події.</p></section>` : ''}
      <h3 class="sec">Історія (${evs.length})</h3>
      <div class="list">${evs.slice().reverse().map(evItem).join('') || '<p class="muted">Подій ще немає. Почніть із сезонної заміни: коли поставили шини, що стоять зараз.</p>'}</div>
      ${help(windows(ctx.v))}`,
    };
  }

  function help(W) {
    return `<details class="panel"><summary><b>Як це працює</b></summary>
      <p class="small"><b>Сезонна заміна.</b> Стоять зимові — з ${ddmm(W.summer[0])} по ${ddmm(W.summer[1])} програма нагадає поставити літні, після ${ddmm(W.summer[1])} — «Прострочено». Стоять літні — з ${ddmm(W.winter[0])} по ${ddmm(W.winter[1])} нагадає про зимові. Дати можна змінити: Ще → Налаштування → Автомобіль. Для всесезонних нагадувань немає.</p>
      <p class="small"><b>Пробіг комплекту</b> — від заміни до заміни: пробіг у день, коли шини поставили, і коли зняли. Якщо пробіг у заміні не вказано — оцінка (зі знаком ≈).</p>
      <p class="small"><b>DOT</b> — чотири цифри в овалі на боковині, після літер DOT: тиждень і рік виготовлення. 2321 — 23-й тиждень 2021 року. Шини, старші ${AGE_MAX} років, радять міняти навіть із добрим протектором: гума твердне.</p>
      <p class="small"><b>Протектор</b> — за бажанням, у міліметрах, у найменшому місці. Зимові — радять не менше 4 мм, літні — 2 мм; законний мінімум — 1,6 мм.</p>
      <p class="small"><b>Після заміни</b> два тижні висить порада перевірити затяжку болтів коліс через 50–100 км.</p></details>`;
  }

  // ---------- форма комплекту ----------
  const BRANDS = ['Nokian', 'Michelin', 'Continental', 'Bridgestone', 'Goodyear', 'Pirelli', 'Hankook', 'Kumho', 'Nexen', 'Toyo',
    'Yokohama', 'Dunlop', 'Falken', 'Matador', 'Barum', 'Kleber', 'BFGoodrich', 'Sava', 'Debica', 'Kormoran', 'Tigar', 'Rosava', 'Premiorri', 'Laufenn', 'Triangle'];
  const SIZES = ['215/65 R16', '215/60 R17', '225/55 R18', '225/45 R19'];   // заводські розміри Qashqai J11
  const allGroups = () => DB.list('tireset').flatMap(s => s.groups || []);
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));

  function groupEd(g = {}) {
    const opt = (list, v) => list.map(([k, l]) => `<option value="${e(k)}"${String(v) === String(k) ? ' selected' : ''}>${e(l)}</option>`).join('');
    const inp = (name, label, val, extra = '', hint = '') => `<label class="fld"><span>${label}${hint ? ` <small>${hint}</small>` : ''}</span>
      <input name="${name}" autocomplete="off" value="${e(val ?? '')}"${extra}></label>`;
    return `<div class="item-ed tg-ed" data-gid="${e(g.id || '')}">
      <div class="row"><b class="grow">Шини</b><button type="button" class="x" data-act="tg-del" aria-label="Прибрати групу шин">×</button></div>
      <div class="grid2">
        ${inp('g_brand', 'Марка', g.brand, ' list="tBrands"')}
        ${inp('g_model', 'Модель', g.model)}
        ${inp('g_size', 'Розмір', g.size, ' list="tSizes" placeholder="215/60 R17"')}
        ${inp('g_dot', 'DOT', g.dot, ' inputmode="numeric" maxlength="6" placeholder="2321"', 'тиждень, рік')}
        <label class="fld"><span>Кількість</span><select name="g_count">${opt([[4, '4'], [2, '2'], [1, '1'], [5, '5 (із запаскою)']], g.count ?? 4)}</select></label>
        <label class="fld"><span>Де стоять</span><select name="g_pos">${opt(Object.entries(POS), g.pos || 'all')}</select></label>
        ${inp('g_bought', 'Куплено', g.bought, ' type="date"')}
        ${inp('g_price', 'Ціна за шину, грн', numIn(g.price), ' inputmode="decimal"')}
        ${inp('g_to', 'Знято', g.to, ' type="date"', 'якщо вже не в комплекті')}
      </div>
      ${inp('g_note', 'Примітка', g.note)}
    </div>`;
  }
  // Нова група: якщо вже є передня — пропонуємо задню, і навпаки.
  function addGroup() {
    const box = document.getElementById('tgroups');
    if (!box) return;
    const pos = [...box.querySelectorAll('[name="g_pos"]')].map(x => x.value);
    const p = pos.includes('front') && !pos.includes('rear') ? 'rear' : pos.includes('rear') && !pos.includes('front') ? 'front' : pos.length ? 'front' : 'all';
    box.insertAdjacentHTML('beforeend', groupEd({ count: p === 'all' ? 4 : 2, pos: p }));
    box.lastElementChild.querySelector('[name="g_brand"]').focus();
  }

  function setForm(id) {
    const isNew = id === 'new';
    let s;
    if (isNew) {
      const have = new Set(DB.list('tireset').filter(x => !x.retired).map(x => x.season));
      const season = !have.has('winter') ? 'winter' : !have.has('summer') ? 'summer' : 'all';
      s = { season, name: SEASONS[season], groups: [{ count: 4, pos: 'all' }] };
    } else if (!(s = DB.get(id))) return V.notFound();
    const storages = uniq(['Гараж', 'Шиномонтаж (сезонне зберігання)', 'Балкон', 'Підвал'].concat(DB.list('tireset').map(x => x.storage)));
    return {
      title: isNew ? 'Новий комплект шин' : nameOf(s), back: true, form: true,
      after: isNew ? null : () => App.showPhotos(id),
      html: `
      <form class="panel form" data-form="tireset" data-id="${isNew ? '' : e(id)}">
        ${F.field({ k: 'season', label: 'Сезон', type: 'select', opts: Object.entries(SEASONS).map(([v, l]) => ({ v, l })) }, s.season)}
        ${F.field({ k: 'name', label: 'Назва', type: 'text', req: true, hint: 'напр. «Зимові», «Літні нові»' }, s.name)}
        <h3>Шини в комплекті</h3>
        <p class="muted small">Якщо на осях різні шини — дві групи по 2 шини: передня і задня вісь. Купили згодом дві нові — додайте нову групу, а в старій вкажіть дату «Знято»: історія лишиться.</p>
        <datalist id="tBrands">${uniq(BRANDS.concat(allGroups().map(g => g.brand))).map(x => `<option value="${e(x)}">`).join('')}</datalist>
        <datalist id="tSizes">${uniq(SIZES.concat(allGroups().map(g => g.size))).map(x => `<option value="${e(x)}">`).join('')}</datalist>
        <div id="tgroups">${(s.groups || []).map(groupEd).join('')}</div>
        <p><button type="button" class="btn ghost" data-act="tg-add">Додати групу шин</button></p>
        ${F.field({ k: 'storage', label: 'Де зберігаються, коли не на авто', type: 'text', list: storages }, s.storage)}
        ${F.field({ k: 'note', label: 'Примітка', type: 'textarea', rows: 2 }, s.note)}
        ${F.field({ k: 'retired', label: 'Більше не використовується (продано, зношено)', type: 'check' }, s.retired)}
        ${F.actions(isNew)}
      </form>
      ${isNew ? '' : `<section class="panel">
        <div class="row"><h3 class="grow">Фото</h3>
          <label class="btn small">Камера<input type="file" accept="image/*" capture="environment" data-photo="${e(id)}" hidden></label>
          <label class="btn small ghost">З галереї<input type="file" accept="image/*" multiple data-photo="${e(id)}" hidden></label>
        </div>
        <p class="muted small">Боковина з DOT, чек покупки — щоб усе було під рукою.</p>
        <div class="photos" id="photos"></div>
      </section>`}`,
    };
  }

  async function submitSet(form) {
    const id = form.dataset.id;
    const g = k => form.elements[k] ? form.elements[k].value.trim() : '';
    const season = SEASONS[g('season')] ? g('season') : 'all';
    const groups = [];
    for (const el of form.querySelectorAll('.tg-ed')) {
      const v = n => el.querySelector(`[name="${n}"]`).value.trim();
      const x = {
        id: el.dataset.gid || U.uid(), brand: v('g_brand') || null, model: v('g_model') || null, size: v('g_size') || null,
        dot: v('g_dot').replace(/\D/g, '') || null, count: +v('g_count') || 4, pos: POS[v('g_pos')] ? v('g_pos') : 'all',
        bought: v('g_bought') || null, price: U.num(v('g_price')), to: v('g_to') || null, note: v('g_note') || null,
      };
      if (!x.brand && !x.model && !x.size && !x.dot && x.price == null && !x.note) continue;   // порожня група
      if (x.dot) {
        const d = dotDate(x.dot);
        if (!d) { U.toast('DOT ' + x.dot + ' — потрібні 4 цифри: тиждень (01–53) і рік, напр. 2321', 5000); return false; }
        if (d > U.addDays(U.today(), 7)) { U.toast('DOT ' + x.dot + ' — виходить дата в майбутньому. Перевірте цифри.', 5000); return false; }
      }
      if (x.price != null && x.price < 0) { U.toast('Ціна не може бути від’ємною'); return false; }
      groups.push(x);
    }
    const base = id ? DB.get(id) : { t: 'tireset' };
    if (!base) { U.toast('Запис уже видалено'); return false; }
    await DB.save(Object.assign({}, base, {
      season, name: g('name') || SEASONS[season], storage: g('storage') || null, note: g('note') || null,
      retired: form.elements.retired.checked, groups,
    }));
    U.toast('Збережено');
    return id ? true : { go: '#/shyny' };
  }

  // ---------- форма події ----------
  function eventForm(id, q) {
    const isNew = id === 'new';
    if (!has()) {
      return {
        title: 'Шини', back: true, html: `<section class="panel"><h2>Спершу додайте комплект шин</h2>
          <p>Щоб записати заміну чи огляд, програма має знати, які шини у вас є.</p>
          <p class="actions"><a class="btn" href="#/edit/tireset/new">Додати комплект</a></p></section>`,
      };
    }
    const ctx = M.context(), live = sets().filter(s => !s.retired);
    let r;
    if (isNew) {
      const cur = current(ctx);
      const kind = KINDS[q && q.get('kind')] ? q.get('kind') : 'swap';
      const want = cur ? (cur.setRec.season === 'winter' ? 'summer' : 'winter') : seasonNow(ctx.today, windows(ctx.v));
      const on = live.find(s => s.season === want && (!cur || s.id !== cur.set)) || live.find(s => !cur || s.id !== cur.set) || live[0];
      r = { date: U.today(), kind, on: on ? on.id : '', off: cur ? cur.set : '' };
    } else if (!(r = DB.get(id))) return V.notFound();
    const all = sets().filter(s => !s.retired || s.id === r.on || s.id === r.off);
    const setOpts = empty => [{ v: '', l: empty }].concat(all.map(s => ({
      v: s.id, l: nameOf(s) + (nameOf(s) !== SEASONS[s.season] ? ' (' + (SEASONS[s.season] || '').toLowerCase() + ')' : ''),
    })));
    const tr = r.tread || {};
    const treadSets = sets().filter(s => !s.retired || (s.groups || []).some(g => tr[g.id] != null));
    const treadIn = treadSets.map(s => (s.groups || []).filter(g => !g.to || tr[g.id] != null).map(g => `
      <label class="fld"><span>${e(nameOf(s))} · ${e(groupName(g))} <small>${g.count} шт., ${POS[g.pos] || ''}</small></span>
        <input name="tr_${e(g.id)}" type="text" inputmode="decimal" autocomplete="off" value="${e(numIn(tr[g.id]))}" placeholder="мм"></label>`).join('')).join('');
    return {
      title: isNew ? 'Подія з шинами' : KINDS[r.kind] || 'Подія з шинами', back: true, form: true,
      after: () => kmHint(document.querySelector('form[data-form="tireevent"]')),
      html: `
      <form class="panel form" data-form="tireevent" data-id="${isNew ? '' : e(id)}">
        ${F.field({ k: 'kind', label: 'Що робили', type: 'select', opts: Object.entries(KINDS).map(([v, l]) => ({ v, l })) }, r.kind)}
        ${F.field({ k: 'date', label: 'Дата', type: 'date', req: true }, r.date)}
        ${F.field({ k: 'km', label: 'Пробіг за одометром, км', type: 'number', mode: 'numeric', hint: 'порожньо — програма оцінить' }, r.km)}
        <div id="twSwap"${r.kind === 'swap' ? '' : ' hidden'}>
          ${F.field({ k: 'on', label: 'Що поставили', type: 'select', opts: setOpts('— виберіть —') }, r.on)}
          ${F.field({ k: 'off', label: 'Що зняли', type: 'select', hint: 'програма підставила, що стояло; перший запис — можна порожньо', opts: setOpts('— нічого / невідомо —') }, r.off)}
        </div>
        ${F.field({ k: 'where', label: 'Де', type: 'text', list: M.used('tireevent', 'where') }, r.where)}
        ${F.field({ k: 'cost', label: 'Скільки коштувало, грн', type: 'number' }, r.cost)}
        ${F.field({ k: 'doc', label: 'Документ (чек)', type: 'select', hint: 'з ним сума піде у «Витрати»', opts: F.docOpts() }, r.doc || '')}
        ${treadIn ? `<details class="tw-tread"${Object.keys(tr).length ? ' open' : ''}><summary>Залишок протектора, мм — за бажанням</summary>
          <p class="muted small">У найменшому місці. Зимові — радять не менше 4 мм, літні — 2 мм.</p>${treadIn}</details>` : ''}
        ${F.field({ k: 'pressure', label: 'Тиск, бар', type: 'text', hint: 'за бажанням, напр. 2,3 / 2,1' }, r.pressure)}
        ${F.field({ k: 'note', label: 'Примітка', type: 'textarea', rows: 2 }, r.note)}
        ${F.actions(isNew)}
      </form>`,
    };
  }
  function kmHint(form) {
    if (!form) return;
    const d = form.elements.date.value, x = d && !form.elements.km.value.trim() ? M.kmAt(d) : null;
    form.elements.km.placeholder = x ? (d === U.today() ? 'сьогодні' : 'на цю дату') + ' ≈ ' + U.int(x.km) : '';
  }
  function onInput(ev, form) {
    const t = ev.target;
    if (form.dataset.form === 'tireset') {
      // Назва за сезоном — доки її не змінили вручну.
      if (t.name === 'season') {
        const n = form.elements.name;
        if (!n.value.trim() || Object.values(SEASONS).includes(n.value.trim())) n.value = SEASONS[t.value] || '';
      }
      return;
    }
    if (t.name === 'kind') document.getElementById('twSwap').hidden = t.value !== 'swap';
    if (t.name === 'date' || t.name === 'km') kmHint(form);
  }

  async function submitEvent(form) {
    const id = form.dataset.id;
    const g = k => form.elements[k] ? form.elements[k].value.trim() : '';
    const vals = {
      kind: KINDS[g('kind')] ? g('kind') : 'check', date: g('date'), km: U.num(g('km')), where: g('where') || null,
      cost: U.num(g('cost')), doc: g('doc') || null, pressure: g('pressure') || null, note: g('note') || null, on: null, off: null,
    };
    if (vals.km != null && vals.km < 0) { U.toast('Пробіг не може бути від’ємним'); return false; }
    if (vals.cost != null && vals.cost < 0) { U.toast('Сума не може бути від’ємною'); return false; }
    if (vals.kind === 'swap') {
      vals.on = g('on') || null; vals.off = g('off') || null;
      if (!vals.on) { U.toast('Виберіть, які шини поставили'); return false; }
      if (vals.on === vals.off) { U.toast('Поставили й зняли — той самий комплект. Перевірте.'); return false; }
    }
    const tread = {};
    for (const el of form.querySelectorAll('[name^="tr_"]')) {
      const v = U.num(el.value);
      if (v == null) continue;
      if (v < 0 || v > 15) { U.toast('Протектор — у міліметрах, від 0 до 15'); return false; }
      tread[el.name.slice(3)] = v;
    }
    vals.tread = Object.keys(tread).length ? tread : null;
    if (!F.kmOk(vals.date, vals.km)) return false;
    const base = id ? DB.get(id) : { t: 'tireevent' };
    if (!base) { U.toast('Запис уже видалено'); return false; }
    await DB.save(Object.assign({}, base, vals));
    U.toast('Збережено');
    return true;
  }

  async function boltsOk(id) {
    const x = DB.get(id);
    if (!x) return;
    await DB.save(Object.assign({}, x, { boltsOk: true }));
    U.toast('Добре — нагадування прибрано');
  }

  return {
    SEASONS, ON_SEASON, KINDS, POS, has, sets, events, stints, current, seasonAt, windows, dayMonth, status, card, masterLines,
    screen, setForm, submitSet, eventForm, submitEvent, onInput, addGroup, boltsOk,
    dotDate, age, ageText, tread, setKm, groupKm, nameOf, groupName,
  };
})();
