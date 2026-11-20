'use strict';
// Поїздки і дрібні витрати на авто (мийка, стоянка, платна дорога…). Лише те, що стосується машини.
// Записи: trip {name, from, to (null — ще триває), kmStart, kmEnd, levelStart, levelEnd (частка бака 0..1), note}
//         expense {date, sum, cat, note, noTrip} — фото чека через DB.addFile(id).
// До поїздки належать заправки, дрібні витрати й документи «у витратах», дата яких — у її днях
// (позначка noTrip у записі — не зараховувати). Заправка з пробігом до старту чи після фінішу — не належить.
// Витрата пального: (залито в дорозі + (рівень на старті − рівень на фініші) × об'єм бака) ÷ пробіг × 100 —
// точна навіть без повного бака. Без рівнів — приблизно, за заправками в дорозі (як на екрані «Пальне»).
const Trip = (() => {
  const e = U.esc;
  const CATS = ['Мийка', 'Стоянка, паркування', 'Платна дорога, пором', 'Доливання (омивач, олива)', 'Дрібний ремонт', 'Інше'];
  const LEVELS = [[1, 'повний'], [0.875, '⅞'], [0.75, '¾'], [0.625, '⅝'], [0.5, '½'], [0.375, '⅜'], [0.25, '¼'], [0.125, '⅛'], [0, 'майже порожній']];
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.u || 0) - (b.u || 0);

  const trips = () => DB.list('trip').sort((a, b) => (b.from || '').localeCompare(a.from || '') || (b.u || 0) - (a.u || 0));
  const has = () => DB.list('trip').length > 0;
  const ongoing = () => trips().find(t => !t.to) || null;
  const expenses = () => DB.list('expense').sort(byDate);
  const tank = () => M.vehicle().tank;
  const dayN = n => n + ' ' + U.plural(n, 'день', 'дні', 'днів');
  const fuelN = n => n + ' ' + U.plural(n, 'заправка', 'заправки', 'заправок');
  function levelText(v) {
    if (v == null) return '—';
    let best = LEVELS[0];
    for (const l of LEVELS) if (Math.abs(l[0] - v) < Math.abs(best[0] - v)) best = l;
    return best[1];
  }
  // Категорії: свої — у порядку списку, далі ті, що траплялися в записах.
  function catOpts(cur) {
    const s = CATS.slice();
    for (const x of DB.list('expense')) if (x.cat && !s.includes(x.cat)) s.push(x.cat);
    if (cur && !s.includes(cur)) s.push(cur);
    return s.map(c => ({ v: c, l: c }));
  }
  const catList = cats => Object.entries(cats).filter(x => x[1] > 0.005).sort((a, b) => b[1] - a[1]);

  // ---------- що належить поїздці ----------
  function inTrip(r, t) {
    if (!r || r.noTrip || !r.date || !t || !t.from) return false;
    if (r.date < t.from || (t.to && r.date > t.to)) return false;
    if (r.t === 'doc' && !r.count) return false;
    if (r.t === 'fuel' && r.km != null) {
      if (t.kmStart != null && r.km <= t.kmStart) return false;   // заправились до старту — це вже «рівень на старті»
      if (t.kmEnd != null && r.km > t.kmEnd) return false;        // після фінішу
    }
    return true;
  }
  const tripOf = r => trips().find(t => inTrip(r, t)) || null;

  function lastPrice(date) {
    let p = null;
    for (const f of M.fuels()) {
      if (f.date > date) break;
      const x = f.price != null ? f.price : f.litres ? f.sum / f.litres : null;
      if (x) p = x;
    }
    return p;
  }

  // ---------- підсумок поїздки ----------
  function summary(t, today = U.today()) {
    const fuels = M.fuels().filter(f => inTrip(f, t));
    const exps = expenses().filter(x => inTrip(x, t));
    const docs = M.docs().filter(d => inTrip(d, t));
    const live = !t.to, end = t.to || today, started = t.from <= today;
    const days = started ? Math.max(1, U.days(t.from, end) + 1) : 0;
    // Пробіг: старт і фініш; не вказано — оцінка; поки в дорозі — до останнього відомого показу.
    const pts = M.points();
    let k0 = t.kmStart, k1 = t.kmEnd, est = false, sofar = false;
    // Без пробігу в поїздці беремо лише справжній показ того дня (заправка, одометр) — оцінка за середнім тут нічого не варта.
    if (k0 == null) { const x = M.kmAt(t.from, pts); if (x && !x.est) { k0 = x.km; est = true; } }
    if (k1 == null && !live) { const x = M.kmAt(t.to, pts); if (x && !x.est) { k1 = x.km; est = true; } }
    if (k1 == null && live && k0 != null) {
      const p = pts.filter(x => x.date >= t.from).pop();
      if (p && p.km > k0) { k1 = p.km; sofar = true; }
    }
    const km = k0 != null && k1 != null && k1 > k0 ? k1 - k0 : null;
    // Пальне.
    const litres = fuels.reduce((a, f) => a + P.litres(f), 0), fuelSum = fuels.reduce((a, f) => a + (f.sum || 0), 0);
    const price = litres > 0 ? fuelSum / litres : lastPrice(end);
    let use = null;
    if (km && !live && t.levelStart != null && t.levelEnd != null) {
      const used = litres + (t.levelStart - t.levelEnd) * tank();
      if (used > 0) use = { used, per100: used / km * 100, perKm: price ? used * price / km : null, exact: !est };
    }
    if (!use) { const u = P.sumUp(P.segments(fuels)); if (u) use = { per100: u.per100, perKm: u.perKm, exact: false, segs: true }; }
    if (use) use.odd = use.per100 < 3 || use.per100 > 25;
    // Інше на машину.
    const cats = {};
    for (const x of exps) { const c = x.cat || 'Інше'; cats[c] = (cats[c] || 0) + (x.sum || 0); }
    const other = exps.reduce((a, x) => a + (x.sum || 0), 0);
    const docSum = docs.reduce((a, d) => a + M.docTotal(d).total, 0);
    // Пальне в підсумку: відомо, скільки використано (рівні в баку), — за використаним: стартували з повним баком —
    // поїздка «з'їла» і те, що куплено раніше; лишилось у баку — це вже не її витрата. Інакше — скільки заплачено в дорозі.
    const byUse = !!(use && use.used && price);
    const fuelCost = byUse ? use.used * price : fuelSum;
    const total = fuelCost + other + docSum;
    return {
      t, live, started, fuels, exps, docs, days, k0, k1, km, est, sofar, litres, fuelSum, price, use, cats, other, docSum,
      byUse, fuelCost, total, paid: fuelSum + other + docSum, perDay: days ? total / days : null, perKm: km ? total / km : null,
    };
  }

  const per100Text = u => (u.exact ? '' : '≈ ') + P.dec(u.per100, 1) + ' л/100 км';
  const howText = (u, s) => u.exact ? 'точно — з урахуванням рівня пального на старті й фініші'
    : u.segs ? (s.live ? 'поки приблизно — за заправками в дорозі; після фінішу з рівнем пального буде точна'
      : 'приблизно — за заправками в дорозі. Для точної вкажіть рівень пального на старті й фініші')
      : 'приблизно — пробіг на старті чи фініші лише оцінка';
  const when = (t, s) => !s.started ? 'починається ' + U.date(t.from)
    : s.live ? 'з ' + U.date(t.from) + ' · день ' + s.days
      : U.date(t.from) + (t.to !== t.from ? '–' + U.date(t.to) : '') + ' · ' + dayN(s.days);

  // Підсумок текстом — переслати чи зберегти.
  function text(s) {
    const t = s.t, L = [];
    L.push('Поїздка «' + t.name + '»' + (s.live ? ' — ще триває' : ''));
    L.push([U.date(t.from) + (t.to && t.to !== t.from ? '–' + U.date(t.to) : ''), s.days ? dayN(s.days) : '',
      s.km ? U.km(s.km, s.est) + (s.sofar ? ' поки що' : '') : ''].filter(Boolean).join(' · '));
    const use = s.use ? per100Text(s.use) + (s.use.perKm ? ', ' + P.dec(s.use.perKm) + ' грн/км' : '') : '';
    if (s.byUse) L.push('Пальне: використано ' + P.lit(s.use.used) + ' ≈ ' + U.money0(s.fuelCost) + ' · витрата ' + use
      + (s.fuels.length ? ' (заправлено в дорозі ' + P.lit(s.litres) + ' за ' + U.money0(s.fuelSum) + ')' : ''));
    else if (s.fuels.length) L.push('Пальне: ' + P.lit(s.litres) + ', ' + U.money0(s.fuelSum) + (use ? ' · витрата ' + use : ''));
    else if (use) L.push('Пальне: витрата ' + use);
    for (const [c, v] of catList(s.cats)) L.push(c + ': ' + U.money0(v));
    if (s.docSum) L.push('СТО, шиномонтаж (за документами): ' + U.money0(s.docSum));
    L.push('Усього на машину: ' + U.money0(s.total) + (s.days ? ' · ' + U.money0(s.perDay) + ' на день' : '')
      + (s.perKm ? ' · ' + P.dec(s.perKm) + ' грн на 1 км' : ''));
    return L.join('\n');
  }

  // ---------- смужка на «Стані» ----------
  function bar() {
    const t = ongoing();
    if (!t) return '';
    const s = summary(t);
    return `<section class="panel edge st-state">
      <a class="row plain" href="#/poizdka/${e(t.id)}"><div class="grow"><b>Поїздка «${e(t.name)}»</b>
        <div class="sub">${s.started ? 'день ' + s.days + ' · на машину витрачено ' + U.money0(s.total) : 'починається ' + U.date(t.from)}</div></div>
        <span class="muted small">Підсумок ›</span></a>
      <div class="actions wide-btns"><a class="btn" href="#/edit/fuel/new">Заправка</a><a class="btn" href="#/edit/expense/new">Витрата на авто</a></div>
    </section>`;
  }

  // ---------- екран «Поїздки» ----------
  function screen() {
    const ts = trips(), cur = ongoing();
    const start = '<a class="btn" href="#/edit/trip/new">Почати поїздку</a>';
    if (!ts.length) {
      return {
        title: 'Поїздки', back: true, html: `
        <section class="panel">
          <h2>Поїздок ще немає</h2>
          <p>Далека поїздка чи відпочинок: натисніть «Почати поїздку» — назва, дата, пробіг за одометром. Поки поїздка триває, заправки і витрати на машину (платні дороги, стоянки, мийка) зараховуються до неї самі.</p>
          <p>Після фінішу — підсумок: пробіг, витрата пального саме в цій поїздці, скільки пішло на машину — усього, на день і на 1 км.</p>
          <p class="actions">${start}</p>
        </section>${help()}`,
      };
    }
    const item = t => {
      const s = summary(t);
      return `<a class="item" href="#/poizdka/${e(t.id)}"><div class="row"><b class="grow">${e(t.name)}</b><b>${U.money0(s.total)}</b></div>
        <div class="sub">${when(t, s)}${s.km ? ' · ' + U.km(s.km, s.est) : ''}${s.use ? ' · ' + per100Text(s.use) : ''}</div></a>`;
    };
    return {
      title: 'Поїздки', back: true, html: `
      ${cur ? bar() : `<p class="actions">${start}</p>`}
      <div class="list">${ts.map(item).join('')}</div>
      ${help()}`,
    };
  }

  function help() {
    return `<details class="panel"><summary><b>Як це працює</b></summary>
      <p class="small"><b>Почати поїздку</b> — назва, дата, пробіг за одометром і, за бажанням, рівень пального за стрілкою. Поки поїздка триває, на головному екрані — смужка з кнопками «Заправка» і «Витрата на авто».</p>
      <p class="small"><b>Що зараховується.</b> Заправки, дрібні витрати (мийка, стоянка, платна дорога…) і документи «у витратах» (СТО чи шиномонтаж у дорозі), дата яких — у днях поїздки. Вони водночас ідуть у загальний облік пального й витрат. Щоб запис не зараховувався — у ньому є позначка «Не зараховувати до поїздки».</p>
      <p class="small"><b>Витрата пального.</b> Якщо вказано рівень пального на старті й на фініші, програма врахує різницю в баку (об'єм бака — у Налаштуваннях → Автомобіль), і витрата за поїздку точна навіть без повного бака. Тоді й пальне в підсумку рахується за використаним: виїхали з повним баком — враховано й те, що залили ще вдома; лишилось у баку — не враховано. Рівень — на ту мить, коли записуєте пробіг. Заправка з пробігом, не більшим за стартовий, до поїздки не йде: вона вже в «рівні на старті».</p>
      <p class="small muted">Лише витрати на машину — житло, харчування тощо тут не ведуться.</p></details>`;
  }

  // ---------- одна поїздка ----------
  function recItem(r) {
    if (r.t === 'fuel') {
      return `<a class="item" href="#/edit/fuel/${e(r.id)}"><div class="row"><b>${U.date(r.date)}</b><span class="grow">Заправка</span><b>${U.money(r.sum)}</b></div>
        <div class="sub">${P.lit(P.litres(r))}${r.station ? ' · ' + e(r.station) : ''}${r.km != null ? ' · ' + U.km(r.km) : ''}</div></a>`;
    }
    if (r.t === 'expense') {
      return `<a class="item" href="#/edit/expense/${e(r.id)}"><div class="row"><b>${U.date(r.date)}</b><span class="grow">${e(r.cat || 'Інше')}</span><b>${U.money(r.sum)}</b></div>
        ${r.note ? `<div class="sub">${e(r.note)}</div>` : ''}</a>`;
    }
    return `<a class="item" href="#/doc/${e(r.id)}"><div class="row"><b>${U.date(r.date)}</b><span class="grow">Документ ${e(r.code || '')}</span><b>${U.money(M.docTotal(r).total)}</b></div>
      <div class="sub">${e([r.seller, r.kind].filter(Boolean).join(' · '))}</div></a>`;
  }

  function tripScreen(id) {
    const t = DB.get(id);
    if (!t || t.t !== 'trip') return V.notFound();
    const s = summary(t);
    const recs = [...s.fuels, ...s.exps, ...s.docs].sort(byDate);
    const lv = t.levelStart != null || t.levelEnd != null;
    const kmDl = s.km
      ? `<dt>Пробіг</dt><dd><b>${U.km(s.km, s.est)}</b>${s.sofar ? ' поки що' : ''}<div class="sub">${U.int(s.k0)} → ${U.int(s.k1)}${s.est ? ' · ≈ — оцінка: пробіг на старті чи фініші не вказано' : ''}</div></dd>`
      : `<dt>Пробіг</dt><dd class="muted">${s.live ? 'буде видно після фінішу (або нового показу пробігу)' : 'не вказано'}</dd>`;
    const useDl = s.use
      // dd зберігає пробіли й переноси (white-space: pre-wrap) — тому без переносів усередині
      ? `<dt>Витрата</dt><dd><b>${per100Text(s.use)}</b>${s.use.perKm ? ' · ' + P.dec(s.use.perKm) + ' грн/км' : ''}`
        + (s.use.used ? `<div class="sub">використано ${P.lit(s.use.used)}</div>` : '') + `<div class="sub">${howText(s.use, s)}</div>`
        + (s.use.odd ? '<div class="sub err">Незвичне значення — перевірте пробіг і рівень пального.</div>' : '') + '</dd>'
      : `<dt>Витрата</dt><dd class="muted">${s.live ? 'порахується після фінішу: вкажіть пробіг і рівень пального' : 'вкажіть пробіг і рівень пального на старті й фініші («Змінити»)'}</dd>`;
    const acts = s.live ? `<p class="actions wide-btns"><a class="btn" href="#/edit/fuel/new">Заправка</a><a class="btn" href="#/edit/expense/new">Витрата на авто</a></p>
      <p class="actions"><a class="btn ghost" href="#/edit/trip/${e(id)}?finish=1">Завершити поїздку</a></p>` : '';
    return {
      title: t.name || 'Поїздка', back: true, html: `
      <section class="panel edge st-${s.live ? 'state' : 'ok'}">
        <div class="muted small">${when(t, s)}</div>
        <div class="big">${U.money0(s.total)}</div>
        <div class="sub">на машину${s.days ? ' · ' + U.money0(s.perDay) + ' на день' : ''}${s.perKm ? ' · ' + P.dec(s.perKm) + ' грн на 1 км' : ''}</div>
        ${acts}
      </section>
      <section class="panel"><h3>Пробіг і пальне</h3><dl class="kv">
        ${kmDl}
        ${lv ? `<dt>У баку</dt><dd>на старті ${levelText(t.levelStart)}${s.live ? '' : ' · на фініші ' + levelText(t.levelEnd)} <span class="muted">(бак ${U.int(tank())} л)</span></dd>` : ''}
        ${s.fuels.length ? `<dt>Заправлено</dt><dd>${P.lit(s.litres)} · ${U.money0(s.fuelSum)} · ${fuelN(s.fuels.length)}</dd>` : ''}
        ${useDl}
      </dl></section>
      <section class="panel"><h3>Витрати на машину</h3><dl class="kv">
        ${s.byUse ? `<dt>Пальне</dt><dd>${U.money0(s.fuelCost)}<div class="sub">за використаним: ${P.lit(s.use.used)} × ${P.dec(s.price)} грн${s.fuels.length ? ` · заплачено в дорозі ${U.money0(s.fuelSum)}` : ''}</div></dd>`
          : s.fuelSum ? `<dt>Пальне</dt><dd>${U.money0(s.fuelSum)}</dd>` : ''}
        ${catList(s.cats).map(([c, v]) => `<dt>${e(c)}</dt><dd>${U.money0(v)}</dd>`).join('')}
        ${s.docSum ? `<dt>СТО, шиномонтаж</dt><dd>${U.money0(s.docSum)} <span class="muted">(за документами: ${s.docs.length})</span></dd>` : ''}
        <dt><b>Усього</b></dt><dd><b>${U.money0(s.total)}</b>${s.days ? ' · ' + U.money0(s.perDay) + ' на день' : ''}${s.perKm ? ' · ' + P.dec(s.perKm) + ' грн/км' : ''}</dd>
      </dl></section>
      <h3 class="sec">Записи поїздки (${recs.length})</h3>
      <div class="list">${recs.map(recItem).join('') || '<p class="muted">Ще немає. Заправки і витрати на авто в дні поїздки зарахуються самі.</p>'}</div>
      ${t.note ? `<section class="panel"><p class="small">${e(t.note)}</p></section>` : ''}
      <details class="panel"><summary><b>Текст підсумку</b></summary><pre class="ocr-pre" id="tripText">${e(text(s))}</pre></details>
      <p class="actions"><button type="button" class="btn ghost" data-act="share" data-src="#tripText">Надіслати підсумок</button>
        <button type="button" class="btn ghost" data-act="copy" data-src="#tripText">Копіювати</button>
        <a class="btn ghost" href="#/edit/trip/${e(id)}">Змінити</a></p>`,
    };
  }

  // ---------- форма поїздки: старт, фініш, зміна ----------
  const levelOpts = () => [{ v: '', l: '— не вказано —' }].concat(LEVELS.map(([v, l]) => ({ v, l })));
  function form(id, q) {
    const isNew = id === 'new', finish = !isNew && q && q.get('finish');
    const cur = ongoing();
    if (isNew && cur) {
      return {
        title: 'Поїздка', back: true, html: `<section class="panel"><h2>Поїздка «${e(cur.name)}» ще триває</h2>
          <p>Нову можна почати, коли цю завершено.</p>
          <p class="actions"><a class="btn" href="#/edit/trip/${e(cur.id)}?finish=1">Завершити поїздку</a> <a class="btn ghost" href="#/poizdka/${e(cur.id)}">Підсумок</a></p></section>`,
      };
    }
    let t;
    if (isNew) t = { from: U.today() };
    else if (!(t = DB.get(id)) || t.t !== 'trip') return V.notFound();
    else if (finish && !t.to) t = Object.assign({}, t, { to: U.today() < t.from ? t.from : U.today() });
    const f = (k, label, type, extra = {}) => F.field(Object.assign({ k, label, type }, extra), t[k]);
    const startF = f('name', 'Назва', 'text', { req: true, hint: 'напр. «Карпати 2027»' })
      + f('from', 'Дата старту', 'date', { req: true })
      + f('kmStart', 'Пробіг на старті, км', 'number', { mode: 'numeric', hint: 'за одометром' })
      + f('levelStart', 'Пальне в баку на старті', 'select', { opts: levelOpts(), hint: 'за стрілкою, за бажанням — для точної витрати' });
    const endF = f('to', 'Дата фінішу', 'date', { hint: finish ? '' : 'порожньо — поїздка ще триває' })
      + f('kmEnd', 'Пробіг на фініші, км', 'number', { mode: 'numeric', hint: 'за одометром' })
      + f('levelEnd', 'Пальне в баку на фініші', 'select', { opts: levelOpts(), hint: 'за стрілкою' });
    const fields = isNew ? startF + `<details><summary>Поїздка вже минула? Вказати фініш</summary>${endF}</details>`
      : finish ? endF : startF + '<h3>Фініш</h3>' + endF;
    return {
      title: isNew ? 'Почати поїздку' : finish ? 'Завершити поїздку' : 'Поїздка', back: true, form: true,
      after: () => {
        const fm = document.querySelector('form[data-form="trip"]');
        kmHint(fm);
        const el = fm && (isNew || finish) ? fm.elements[isNew ? 'name' : 'kmEnd'] : null;
        if (el) el.focus();
      },
      html: `
      ${finish ? `<section class="panel"><b>${e(t.name)}</b><div class="sub">з ${U.date(t.from)}${t.kmStart != null ? ' · на старті ' + U.km(t.kmStart) : ''}${t.levelStart != null ? ' · у баку ' + levelText(t.levelStart) : ''}</div></section>` : ''}
      <form class="panel form" data-form="trip" data-id="${isNew ? '' : e(id)}"${finish ? ' data-finish="1"' : ''}>
        ${fields}
        ${f('note', 'Примітка', 'textarea', { rows: 2 })}
        ${F.actions(isNew, !finish)}
      </form>
      ${isNew ? help() : ''}`,
    };
  }
  // Оцінка пробігу на дату старту й фінішу — сірою підказкою.
  function kmHint(fm) {
    if (!fm) return;
    for (const [d, k] of [['from', 'kmStart'], ['to', 'kmEnd']]) {
      const de = fm.elements[d], ke = fm.elements[k];
      if (!de || !ke) continue;
      const x = de.value && !ke.value.trim() ? M.kmAt(de.value) : null;
      ke.placeholder = x ? (de.value === U.today() ? 'сьогодні' : 'на цю дату') + ' ≈ ' + U.int(x.km) : '';
    }
  }
  function onInput(ev, fm) { if (/^(from|to|kmStart|kmEnd)$/.test(ev.target.name)) kmHint(fm); }

  async function submit(fm) {
    const id = fm.dataset.id;
    const base = id ? DB.get(id) : { t: 'trip' };
    if (!base) { U.toast('Запис уже видалено'); return false; }
    const r = Object.assign({}, base);
    const inForm = k => !!fm.elements[k];   // у формі фінішу — лише поля фінішу, решта лишається як була
    const str = k => fm.elements[k].value.trim() || null;
    for (const k of ['name', 'from', 'to', 'note']) if (inForm(k)) r[k] = str(k);
    for (const k of ['kmStart', 'kmEnd', 'levelStart', 'levelEnd']) if (inForm(k)) r[k] = U.num(fm.elements[k].value);
    if (!r.name) { U.toast('Вкажіть назву поїздки'); return false; }
    if (!r.from) { U.toast('Вкажіть дату старту'); return false; }
    if (fm.dataset.finish && !r.to) { U.toast('Вкажіть дату фінішу'); return false; }
    if (!r.to && (r.kmEnd != null || r.levelEnd != null)) { U.toast('Вкажіть дату фінішу — або приберіть пробіг і рівень на фініші', 4000); return false; }
    if (r.to && r.to < r.from) { U.toast('Фініш раніше за старт — перевірте дати'); return false; }
    for (const k of ['kmStart', 'kmEnd']) if (r[k] != null && r[k] < 0) { U.toast('Пробіг не може бути від’ємним'); return false; }
    if (r.kmStart != null && r.kmEnd != null && r.kmEnd <= r.kmStart) { U.toast('Пробіг на фініші має бути більший, ніж на старті', 4000); return false; }
    if (!r.to) {
      const other = DB.list('trip').find(x => !x.to && x.id !== r.id);
      if (other) { U.toast('Поїздка «' + other.name + '» ще триває — спершу завершіть її', 4000); return false; }
    }
    const endOf = x => x.to || (x.from > U.today() ? x.from : U.today());   // триває — поки що по сьогодні
    const cross = DB.list('trip').find(x => x.id !== r.id && x.from && x.from <= endOf(r) && r.from <= endOf(x));
    if (cross && !confirm('Дні поїздки перетинаються з поїздкою «' + cross.name + '». Заправки й витрати тих днів зарахуються до обох. Зберегти все одно?')) return false;
    if (!F.kmOk(r.from, r.kmStart) || (r.to && !F.kmOk(r.to, r.kmEnd))) return false;
    const rec = await DB.save(r);
    U.toast(!id ? (r.to ? 'Поїздку записано' : 'Поїздку почато — заправки й витрати на авто зараховуватимуться до неї') : fm.dataset.finish ? 'Поїздку завершено' : 'Збережено', 4000);
    return !id || fm.dataset.finish ? { go: '#/poizdka/' + rec.id } : true;
  }

  // ---------- екран «Дрібні витрати» ----------
  function expScreen() {
    const xs = expenses(), today = U.today();
    const add = '<a class="btn" href="#/edit/expense/new">Витрата на авто</a>';
    if (!xs.length) {
      return {
        title: 'Дрібні витрати', back: true, html: `<section class="panel"><h2>Дрібних витрат ще немає</h2>
          <p>Мийка, стоянка, платна дорога, доливання омивача чи оливи, дрібний ремонт — усе, що на машину, але без акта СТО. Сума, на що, за бажанням — фото чека.</p>
          <p class="muted small">Витрати з документами (акт, накладна) — як і раніше, документом.</p>
          <p class="actions">${add}</p></section>`,
      };
    }
    const sumOf = arr => arr.reduce((a, x) => a + (x.sum || 0), 0);
    const byCat = arr => { const c = {}; for (const x of arr) c[x.cat || 'Інше'] = (c[x.cat || 'Інше'] || 0) + (x.sum || 0); return catList(c); };
    const year = xs.filter(x => (x.date || '').startsWith(today.slice(0, 4)));
    const item = x => {
      const tr = tripOf(x);
      return `<a class="item" href="#/edit/expense/${e(x.id)}"><div class="row"><b>${U.date(x.date)}</b><span class="grow">${e(x.cat || 'Інше')}</span><b>${U.money(x.sum)}</b></div>
        ${x.note || tr || DB.filesOf(x.id).length ? `<div class="sub">${e([x.note, tr ? 'поїздка «' + tr.name + '»' : ''].filter(Boolean).join(' · '))}${DB.filesOf(x.id).length ? (x.note || tr ? ' · ' : '') + 'фото чека' : ''}</div>` : ''}</a>`;
    };
    return {
      title: 'Дрібні витрати', back: true, html: `
      <section class="panel">
        <div class="row"><div class="grow"><div class="big">${U.money0(sumOf(year))}</div><div class="muted small">цього року · за весь час ${U.money0(sumOf(xs))}</div></div>${add}</div>
        ${year.length ? `<dl class="kv">${byCat(year).map(([c, v]) => `<dt>${e(c)}</dt><dd>${U.money0(v)}</dd>`).join('')}</dl>` : ''}
        <p class="muted small">Ідуть у «Витрати» окремим рядком — разом з ТО, ремонтом і пальним це «разом утримання».</p>
      </section>
      <h3 class="sec">Усі (${xs.length})</h3>
      <div class="list">${xs.slice().reverse().map(item).join('')}</div>`,
    };
  }

  return {
    CATS, LEVELS, trips, has, ongoing, expenses, inTrip, tripOf, summary, text, levelText, catOpts, catList, tank,
    bar, screen, tripScreen, form, submit, onInput, expScreen,
  };
})();
