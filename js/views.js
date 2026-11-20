'use strict';
// Екрани програми. Кожен повертає { title, html, after? }.
const V = (() => {
  const e = U.esc;

  function intervalText(r) {
    const a = [];
    if (r.km) a.push('кожні ' + U.int(r.km) + ' км');
    if (r.months) a.push((r.km ? '' : 'кожні ') + r.months + ' міс');
    const s = M.seasonDates(r.season);
    if (s.length) a.push('щороку до ' + s.map(([m, d]) => String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0')).join(' і '));
    return a.length ? a.join(' або ') : 'за станом';
  }

  // Одна головна фраза для картки: що з вузлом зараз.
  function mainText(o) {
    if (o.st === 'nodata') return 'Записів немає — ' + intervalText(o.rule);
    if (o.st === 'state') return o.lastDate ? 'Востаннє ' + U.date(o.lastDate) : 'За станом, записів немає';
    const a = [];
    if (o.remKm != null && (o.remKm < 0 || o.st !== 'over')) a.push(o.remKm >= 0 ? 'через ' + U.km(o.remKm, o.remKmEst) : 'перебіг ' + U.km(-o.remKm, o.remKmEst));
    if (o.remDays != null && (o.remDays < 0 || o.st !== 'over')) {
      a.push(o.remDays >= 0 ? 'до ' + U.date(o.dueDate) + (o.remDays <= 60 ? ' (' + U.daysText(o.remDays) + ')' : '')
        : 'строк минув ' + U.daysText(-o.remDays) + ' тому');
    }
    return a.join(' або ').replace(/^перебіг (.*) або строк/, 'перебіг $1, строк');
  }
  const isCheckRule = r => /огляд|перевір|змащ|стан/i.test(r.action || '');

  function remText(o) {
    const a = [];
    if (o.remKm != null) a.push(o.remKm >= 0 ? 'залишилось ' + U.km(o.remKm, o.remKmEst) : 'перебіг ' + U.km(-o.remKm, o.remKmEst));
    if (o.remDays != null) {
      const by = o.dueByKm ? ' (за пробігом)' : '';
      a.push(o.remDays >= 0
        ? 'до ' + U.date(o.dueDate) + by + ', ' + U.daysText(o.remDays)
        : 'строк минув ' + U.date(o.dueDate) + by + ', ' + U.daysText(-o.remDays) + ' тому');
    }
    return a.join(' · ');
  }

  function lastText(o) {
    if (!o.lastDate) return 'Записів у журналі ще немає';
    return 'Востаннє: ' + U.date(o.lastDate) + (o.lastKm != null ? ' · ' + U.km(o.lastKm, o.lastKmEst) : '');
  }

  function docLabel(id) {
    const d = DB.get(id);
    return d ? d.code || 'документ' : (id ? 'документ видалено' : '');
  }

  // ---------- Стан ----------
  function stan() {
    const ctx = M.context();
    const list = M.allStatus(ctx);
    if (!DB.list('rule').length && !ctx.cur) {
      return {
        title: 'Стан', html: `
        <section class="panel">
          <h2>Даних ще немає</h2>
          <p>Якщо є файл копії або файл імпорту з книги Excel — відкрийте «Обмін даними» і прийміть його.</p>
          <p><a class="btn" href="#/obmin">Обмін даними</a> <a class="btn ghost" href="#/nalashtuvannia">Налаштування</a></p>
        </section>`,
      };
    }
    const cur = ctx.cur;
    const grp = { over: [], soon: [], nodata: [], later: [], ok: [] };
    list.forEach(o => grp[o.snoozed && /over|soon|nodata/.test(o.st) ? 'later' : o.st === 'state' ? 'ok' : o.st].push(o));
    // Висновок одним реченням.
    const names = arr => arr.slice(0, 3).map(o => o.rule.name.replace(/\s*\(.*\)$/, '')).join(', ') + (arr.length > 3 ? ' та ще ' + (arr.length - 3) : '');
    const near = list.filter(o => o.st === 'ok' && o.remDays != null).sort((a, b) => a.remDays - b.remDays)[0];
    let verdict;
    if (grp.over.length) verdict = `<div class="verdict st-over">Прострочено: ${grp.over.length}</div><div class="sub">${e(names(grp.over))}</div>`;
    else if (grp.soon.length) verdict = `<div class="verdict st-soon">Незабаром: ${e(grp.soon[0].rule.name)}</div><div class="sub">${mainText(grp.soon[0])}${grp.soon.length > 1 ? ' · і ще ' + (grp.soon.length - 1) : ''}</div>`;
    else verdict = `<div class="verdict st-ok">Усе гаразд</div>${near ? `<div class="sub">Найближче: ${e(near.rule.name)} — ${mainText(near)}</div>` : ''}`;
    // Давно не записували пробіг — від нього залежать усі строки.
    const odoAge = cur ? U.days(cur.date, ctx.today) : null;
    const odoNote = odoAge != null && odoAge > 30 ? `<div class="hint">Пробіг не записували ${U.daysText(odoAge)} — строки рахуються за оцінкою. <a href="#/edit/odo/new">Записати</a></div>` : '';
    // Давно не було резервної копії (автокопії в папку чи файлу для іншого пристрою), а зміни є.
    const lc = Obmin.lastCopy(), copyAge = lc ? Math.floor((Date.now() - lc.at) / 864e5) : 0;
    const copyNote = copyAge >= 7 && Obmin.unsaved()
      ? `<div class="hint">Резервної копії не було ${U.daysText(copyAge)}, а зміни є. <button type="button" class="linkbtn" data-act="backup-now">Зробити копію</button></div>` : '';
    const head = `
      <section class="panel">
        ${verdict}
        <div class="row km-row"><div class="grow">
          <div class="big">${U.km(ctx.nowKm, ctx.nowEst)}</div>
          <div class="muted small">${cur ? 'Останній показ: ' + U.km(cur.km) + ' на ' + U.date(cur.date) : 'Пробіг ще не записано'}${ctx.r ? ' · ≈ ' + U.int(ctx.r * 365) + ' км на рік' : ''}</div>
        </div><a class="btn" href="#/edit/odo/new">Пробіг</a></div>
        ${odoNote}${copyNote}
      </section>`;
    const card = o => {
      const id = e(o.rule.id), st = o.snoozed ? 'later' : o.st;
      const meter = o.used != null ? `<div class="meter" title="Використано ресурсу: ${Math.round(o.used * 100)}%"><i style="width:${Math.min(100, Math.max(3, o.used * 100)).toFixed(0)}%"></i></div>` : '';
      const acts = /over|soon|nodata/.test(o.st) ? `<div class="card-acts">
          <a class="btn small" href="#/edit/visit/new?rule=${id}">Зроблено</a>
          ${isCheckRule(o.rule) ? `<button type="button" class="btn small ghost" data-act="quick-check" data-id="${id}">Перевірено</button>` : ''}
          <button type="button" class="btn small ghost" data-act="snooze" data-id="${id}">${o.snoozed ? 'Відкладено' : 'Пізніше'}</button></div>` : '';
      return `<div class="card st-${st}">
        <a class="card-main" href="#/rule/${id}">
          <b>${e(o.rule.name)}</b>
          <div class="main-line">${o.snoozed ? 'Відкладено до ' + U.date(o.snoozed) + ' · ' : ''}${mainText(o)}</div>
          ${meter}
          ${o.lastDate && o.st !== 'state' ? `<div class="sub">${lastText(o)}</div>` : ''}
        </a>${acts}</div>`;
    };
    const block = (k, title) => grp[k].length ? `<h3 class="sec">${title} (${grp[k].length})</h3><div class="cards">${grp[k].map(card).join('')}</div>` : '';
    const rest = grp.later.length + grp.ok.length;
    return {
      title: 'Стан', noTopKm: true, html: head
        + block('over', 'Прострочено') + block('soon', 'Незабаром') + block('nodata', 'Немає даних')
        + (rest ? `<details class="more"${grp.over.length + grp.soon.length + grp.nodata.length ? '' : ' open'}><summary>Гаразд і відкладене (${rest})</summary>`
          + block('later', 'Відкладено') + block('ok', 'Гаразд') + '</details>' : ''),
    };
  }

  // ---------- Вузол (пункт регламенту) ----------
  function rule(id) {
    const r = DB.get(id);
    if (!r) return notFound();
    const o = M.status(r);
    const ws = M.works().filter(w => w.rule === id).reverse();
    const kv = [
      ['Що робити', r.action],
      ['Інтервал', r.group ? 'розділ журналу, без інтервалу' : intervalText(r)],
      ['Важкі умови', r.heavy],
      ['Джерело', r.source],
      ['Примітка', r.note],
    ].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${e(v)}</dd>`).join('');
    let st = '';
    if (!r.group) {
      st = `<dt>Стан</dt><dd><span class="badge-inline st-${o.st}">${M.ST[o.st]}</span></dd>
        <dt>Востаннє</dt><dd>${o.lastDate ? U.date(o.lastDate) + (o.lastKm != null ? ' · ' + U.km(o.lastKm, o.lastKmEst) : '') : '—'}</dd>`;
      if (o.nextKm != null || o.nextDate) st += `<dt>Наступне</dt><dd>${[o.nextKm != null ? U.km(o.nextKm) : '', o.nextDate ? U.date(o.nextDate) : ''].filter(Boolean).join(' або ')}</dd>`;
      if (remText(o)) st += `<dt>Залишилось</dt><dd>${remText(o)}</dd>`;
      if (o.snoozed) st += `<dt>Відкладено</dt><dd>до ${U.date(o.snoozed)}</dd>`;
    }
    const seasonHint = /шин/i.test(r.name) && !M.seasonDates(r.season).length
      ? `<p class="hint">Можна вказати дати сезонної заміни (наприклад, 01.11, 01.04) і прибрати інтервал у місяцях — тоді програма нагадуватиме саме перед сезоном. Натисніть «Змінити пункт».</p>` : '';
    const hist = ws.length ? ws.map(w => `
      <a class="item" href="#/edit/work/${e(w.id)}">
        <div class="row"><b>${U.date(w.date)}</b><span class="muted">${w.km != null ? U.km(w.km, w.kmEst) : ''}</span><span class="grow"></span><span class="muted">${e(docLabel(w.doc))}</span></div>
        <div>${e(w.what || '')}</div>
        ${w.parts || w.note ? `<div class="sub">${e([w.parts, w.note].filter(Boolean).join(' · '))}</div>` : ''}
      </a>`).join('') : '<p class="muted">Записів ще немає.</p>';
    return {
      title: r.name, back: true, html: `
      <section class="panel ${r.group ? '' : 'st-' + o.st} edge">
        <h2>${e(r.name)}</h2>
        <dl class="kv">${st}${kv}</dl>
        ${seasonHint}
        <p class="actions"><a class="btn" href="#/edit/visit/new?rule=${e(id)}">Записати виконання</a>
        ${!r.group && isCheckRule(r) ? `<button type="button" class="btn ghost" data-act="quick-check" data-id="${e(id)}">Перевірено — гаразд</button>` : ''}
        ${!r.group && o.st !== 'state' && o.st !== 'ok' || o.snoozed ? `<button type="button" class="btn ghost" data-act="snooze" data-id="${e(id)}">${o.snoozed ? 'Відкладено' : 'Нагадати пізніше'}</button>` : ''}
        <a class="btn ghost" href="#/edit/rule/${e(id)}">Змінити пункт</a></p>
      </section>
      <h3 class="sec">Історія (${ws.length})</h3>
      <div class="list">${hist}</div>`,
    };
  }

  // ---------- Журнал ----------
  function zhurnal(q) {
    const sel = q.get('rule') || '';
    const rules = M.rules();
    let ws = M.works();
    if (sel) ws = ws.filter(w => w.rule === sel);
    const groups = new Map();
    for (const w of ws) {
      const k = (w.date || '') + '|' + (w.doc || '');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(w);
    }
    const keys = [...groups.keys()].sort().reverse();
    const opt = `<option value="">Усі вузли і роботи</option>` + rules.map(r =>
      `<option value="${e(r.id)}"${r.id === sel ? ' selected' : ''}>${e(r.name)}</option>`).join('');
    const html = keys.map(k => {
      const g = groups.get(k), w0 = g[0];
      const kmW = g.find(w => w.km != null);
      return `<div class="group">
        <div class="group-h"><b>${U.date(w0.date)}</b>${kmW ? ' · ' + U.km(kmW.km, kmW.kmEst) : ''}
          ${w0.doc ? ` · <a href="#/doc/${e(w0.doc)}">${e(docLabel(w0.doc))}</a>` : ''}</div>
        ${g.map(w => {
          const r = DB.get(w.rule);
          return `<a class="item" href="#/edit/work/${e(w.id)}">
            <div><b>${e(r ? r.name : 'Вузол видалено')}</b>${w.what ? ' — ' + e(w.what) : ''}</div>
            ${w.parts || w.note ? `<div class="sub">${e([w.parts, w.note].filter(Boolean).join(' · '))}</div>` : ''}
          </a>`;
        }).join('')}
      </div>`;
    }).join('');
    return {
      title: 'Журнал робіт', html: `
      <div class="toolbar"><select data-nav-rule>${opt}</select></div>
      <p class="muted small">Записів: ${ws.length}. Натисніть на запис, щоб змінити.</p>
      ${html || '<p class="muted">Записів ще немає.</p>'}`,
    };
  }

  // ---------- Документи ----------
  function docs() {
    const ds = M.docs().reverse();
    const html = ds.map(d => {
      const t = M.docTotal(d);
      const nph = DB.filesOf(d.id).length;
      const text = [d.code, d.seller, d.kind, d.number, d.about, U.date(d.date),
        ...(d.items || []).map(i => i.name + ' ' + (i.art || ''))].join(' ').toLowerCase();
      return `<a class="item doc-item" href="#/doc/${e(d.id)}" data-text="${e(text)}">
        <div class="row"><b>${e(d.code || '')}</b><span>${U.date(d.date)}</span><span class="grow"></span><b>${t.total ? U.money(t.total) : ''}</b></div>
        <div class="sub">${e([d.kind, d.number ? '№ ' + d.number : ''].filter(Boolean).join(' '))}${d.seller ? ' · ' + e(d.seller) : ''}</div>
        ${d.about ? `<div class="sub clip">${e(d.about)}</div>` : ''}
        <div class="tags">${!d.count ? '<span class="tag">не у витратах</span>' : ''}${nph ? `<span class="tag">фото: ${nph}</span>` : ''}${(d.items || []).length ? `<span class="tag">позицій: ${d.items.length}</span>` : ''}</div>
      </a>`;
    }).join('');
    return {
      title: 'Документи', html: `
      <section class="panel"><b>Документ з фото</b>
        <p class="muted small">Програма прочитає дату, номер, суму, позиції — ви перевірите і збережете.</p>
        <div class="actions">${ocrButtons()}</div></section>
      <div class="toolbar"><input type="search" placeholder="Пошук: СТО, номер, деталь, артикул" data-filter=".doc-item"></div>
      <p class="muted small">Документів: ${ds.length}</p>
      <div class="list">${html || '<p class="muted">Документів ще немає.</p>'}</div>`,
    };
  }

  function doc(id) {
    const d = DB.get(id);
    if (!d) return notFound();
    const t = M.docTotal(d);
    const kv = [
      ['Дата', U.date(d.date)],
      ['Номер', d.number],
      ['СТО / продавець', d.seller],
      ['Пробіг', d.km != null ? U.km(d.km, d.kmEst) : ''],
      ['Сума', t.total ? U.money(t.total) : ''],
      ['У витратах', d.count ? 'так' : 'ні'],
      ['Паперовий скан', d.scan],
      ['Зміст', d.about],
    ].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${e(v)}</dd>`).join('');
    const items = d.items || [];
    const itemsHtml = items.map(i => `
      <div class="item static">
        <div><b>${e(i.name || '')}</b>${i.art ? ` <span class="muted">${e(i.art)}</span>` : ''}</div>
        <div class="sub">${e([i.kind, i.cat].filter(Boolean).join(' · '))}</div>
        <div class="row sub"><span class="grow">${i.qty != null ? String(i.qty).replace('.', ',') : ''} ${e(i.unit || '')}${i.price != null ? ' × ' + U.money(i.price) : ''}</span>
          <b class="strong">${i.sum != null ? U.money(i.sum) : ''}</b></div>
      </div>`).join('');
    const coefNote = items.length && t.itemsSum && Math.abs(t.coef - 1) > 0.001
      ? `<p class="muted small">Сума позицій ${U.money(t.itemsSum)}; у витрати кожна позиція йде з поправкою ×${t.coef.toFixed(3).replace('.', ',')} (знижка чи ПДВ), щоб разом вийшла сума документа.</p>` : '';
    const ws = M.works().filter(w => w.doc === id);
    const wsHtml = ws.map(w => {
      const r = DB.get(w.rule);
      return `<a class="item" href="#/edit/work/${e(w.id)}"><b>${e(r ? r.name : 'Вузол видалено')}</b>${w.what ? ' — ' + e(w.what) : ''}</a>`;
    }).join('');
    return {
      title: (d.code || 'Документ'), back: true, html: `
      <section class="panel">
        <h2>${e(d.code || '')} · ${e(d.kind || 'Документ')}</h2>
        <dl class="kv">${kv}</dl>
        <p class="actions"><a class="btn" href="#/edit/doc/${e(id)}">Змінити</a></p>
      </section>
      ${!ws.length && !/калькуляц|рахунок/i.test(d.kind || '') ? `<section class="panel note-box">
        <b>Позначте виконане в журналі</b>
        <p class="small">Поки цього не зроблено, стан вузлів на головному екрані не зміниться. Вузли програма відмітить сама за позиціями документа — вам лишиться перевірити.</p>
        <p class="actions"><a class="btn" href="#/edit/visit/new?doc=${e(id)}">Позначити виконане</a></p>
      </section>` : ''}
      <section class="panel">
        <div class="row"><h3 class="grow">Фото</h3>
          <label class="btn small">Камера<input type="file" accept="image/*" capture="environment" data-photo="${e(id)}" hidden></label>
          <label class="btn small ghost">З галереї<input type="file" accept="image/*" multiple data-photo="${e(id)}" hidden></label>
        </div>
        <div class="photos" id="photos"></div>
        ${DB.filesOf(id).length ? `<p class="actions"><a class="btn small ghost" href="#/edit/doc/${e(id)}?ocr=1">Заповнити порожні поля з фото</a></p>` : ''}
      </section>
      <section class="panel">
        <h3>Позиції (${items.length})</h3>
        ${itemsHtml || '<p class="muted">Позицій не внесено.</p>'}
        ${coefNote}
      </section>
      ${ws.length ? `<h3 class="sec">У журналі (${ws.length})</h3><div class="list">${wsHtml}</div>
        <p class="actions"><a class="btn small ghost" href="#/edit/visit/new?doc=${e(id)}">Додати ще виконане</a></p>` : ''}`,
      after: () => App.showPhotos(id),
    };
  }

  // ---------- Витрати ----------
  function vytraty() {
    const ys = M.expenses();
    const all = ys.reduce((a, y) => a + y.total, 0);
    const allCats = {};
    ys.forEach(y => Object.entries(y.cats).forEach(([c, s]) => { allCats[c] = (allCats[c] || 0) + s; }));
    const bars = cats => {
      const ent = Object.entries(cats).filter(x => x[1] > 0.005).sort((a, b) => b[1] - a[1]);
      const mx = ent.length ? ent[0][1] : 1;
      return ent.map(([c, s]) => `<div class="bar-row"><div class="row"><span class="grow">${e(c)}</span><b>${U.money0(s)}</b></div>
        <div class="bar"><i style="width:${Math.max(1, s / mx * 100).toFixed(1)}%"></i></div></div>`).join('');
    };
    const kmLine = y => {
      if (!y.km) return '';
      const per = y.total ? ' · ' + U.money0(y.total / y.km * 1000) + ' на 1000 км' : '';
      const part = y.kmFirst ? ' (неповний рік: облік з ' + U.date(y.kmFrom) + (y.kmNow ? ' по сьогодні' : '') + ')'
        : y.kmNow ? ' (рік ще триває)' : '';
      return '<div class="sub">Пробіг за рік ' + U.km(y.km, y.kmEst) + part + per + '</div>';
    };
    const years = ys.map(y => y.count ? `
      <details class="panel">
        <summary><div class="row"><b class="grow">${y.year}</b><b>${U.money0(y.total)}</b></div>
          <div class="sub">${y.count} ${U.plural(y.count, 'документ', 'документи', 'документів')}</div>${kmLine(y)}</summary>
        ${bars(y.cats)}
      </details>` : `
      <section class="panel">
        <div class="row"><b class="grow">${y.year}</b><span class="muted">0 грн</span></div>
        <div class="sub muted">Документів за цей рік немає — якщо витрати були, додайте документи.</div>${kmLine(y)}
      </section>`).join('');
    const tk = M.totalKm();
    return {
      title: 'Витрати', html: `
      <section class="panel">
        <div class="big">${U.money0(all)}</div>
        <div class="muted">усього за документами, позначеними «у витратах»</div>
        ${tk && all ? `<div class="sub">За весь час обліку (з ${U.date(tk.from)}, ${U.km(tk.km, true)}): ${U.money0(all / tk.km * 1000)} на 1000 км</div>` : ''}
      </section>
      ${years || '<p class="muted">Витрат ще немає.</p>'}
      ${ys.length ? `<details class="panel"><summary><b>За всі роки — за категоріями</b></summary>${bars(allCats)}</details>` : ''}`,
    };
  }

  // ---------- Ще ----------
  function sche() {
    const n = M.notes().filter(x => !x.done).length;
    const nc = M.checkList().active.length;
    const link = (h, t, s) => `<a class="item" href="${h}"><b>${t}</b>${s ? `<div class="sub">${s}</div>` : ''}</a>`;
    return {
      title: 'Ще', html: `<div class="list">
        ${link('#/maistru', 'Список для майстра', 'Що зробити і перевірити — щоб показати чи надіслати на СТО')}
        ${link('#/notes', 'Нотатки' + (n ? ` (${n})` : ''), 'Відкриті питання, поради механіків')}
        ${link('#/perevirka', 'Перевірити дані' + (nc ? ` (${nc})` : ''), 'Оцінений пробіг, «уточніть», пробіг не по порядку, документи поза журналом')}
        ${link('#/probih', 'Пробіг', 'Усі покази одометра')}
        ${link('#/reglament', 'Регламент', 'Пункти обслуговування та інтервали — можна правити')}
        ${link('#/obmin', 'Обмін даними', 'Копія для телефона чи компа, імпорт')}
        ${link('#/excel', 'Таблиця Excel', 'Усі дані одним файлом — переглянути, роздрукувати, надіслати')}
        ${link('#/nalashtuvannia', 'Налаштування', 'Автомобіль, попередження, сховище')}
      </div>`,
    };
  }

  function maistru() {
    const ctx = M.context(), v = ctx.v;
    const list = M.allStatus(ctx);
    const L = [];
    L.push(v.name);
    if (v.vin) L.push('VIN ' + v.vin);
    if (ctx.nowKm != null) L.push('Пробіг: ' + U.km(ctx.nowKm, ctx.nowEst) + ' (' + U.date(ctx.today) + ')');
    const sect = (title, arr, fn) => { if (arr.length) { L.push(''); L.push(title); arr.forEach(o => L.push('• ' + fn(o))); } };
    const last = o => o.lastDate ? 'востаннє ' + U.date(o.lastDate) + (o.lastKm != null ? ', ' + U.km(o.lastKm, o.lastKmEst) : '') : 'даних немає';
    sect('ПОТРІБНО ЗРОБИТИ (строк минув):', list.filter(o => o.st === 'over'), o => o.rule.name + ' — ' + (o.rule.action || '').toLowerCase() + ' (' + last(o) + ')');
    sect('НЕЗАБАРОМ:', list.filter(o => o.st === 'soon'), o => o.rule.name + ' — ' + (o.rule.action || '').toLowerCase() + ' (' + remText(o) + ')');
    sect('ПЕРЕВІРИТИ (немає записів про заміну):', list.filter(o => o.st === 'nodata'), o => o.rule.name + (o.rule.action ? ' — ' + o.rule.action.toLowerCase() : ''));
    sect('ПОДИВИТИСЬ СТАН:', list.filter(o => o.st === 'state'), o => o.rule.name + ' (' + last(o) + ')');
    const ns = M.notes().filter(n => !n.done && n.master);
    if (ns.length) { L.push(''); L.push('ЩЕ:'); ns.forEach(n => L.push('• ' + n.text)); }
    const text = L.join('\n');
    return {
      title: 'Для майстра', back: true, html: `
      <section class="panel">
        <pre class="pre" id="mText">${e(text)}</pre>
        <p class="actions"><button class="btn" data-act="copy" data-src="#mText">Копіювати</button>
        <button class="btn ghost" data-act="share" data-src="#mText">Надіслати</button></p>
        <p class="muted small">Список складається сам зі стану вузлів. Нотатки потрапляють сюди, якщо в них позначено «до списку для майстра».</p>
      </section>`,
    };
  }

  // ---------- Перевірити дані ----------
  const recLink = r => r.t === 'doc' ? '#/doc/' + r.id : '#/edit/' + r.t + '/' + r.id;
  function perevirka() {
    const { active, ok } = M.checkList();
    const ruleName = id => { const r = DB.get(id); return r ? r.name : 'вузол видалено'; };
    const item = (g, isOk) => {
      const m = g.main;
      const title = m.t === 'doc' ? 'Документ ' + [m.code, m.seller].filter(Boolean).join(' · ')
        : m.t === 'work' ? 'Журнал: ' + ruleName(m.rule) : m.t === 'odo' ? 'Показ пробігу' : 'Нотатка';
      const ws = g.recs.filter(r => r.t === 'work' && r !== m);
      const ids = e(g.recs.map(r => r.id).join(','));
      const btn = isOk
        ? `<button type="button" class="btn small ghost" data-act="data-back" data-ids="${ids}">Повернути до списку</button>`
        : `<button type="button" class="btn small ghost" data-act="data-ok" data-ids="${ids}" data-codes="${e(g.codes.join(','))}">${m.t === 'note' ? 'Закрити нотатку' : 'Гаразд, так і є'}</button>`;
      return `<div class="card st-${isOk ? 'ok' : 'soon'}">
        <a class="card-main" href="${recLink(m)}">
          <div class="row"><b class="grow">${e(title)}</b><span class="muted">${U.date(m.date)}</span></div>
          ${g.why.map(w => `<div class="sub">• ${e(w)}</div>`).join('')}
          ${ws.length ? `<div class="sub">Стосується записів у журналі: ${ws.length} (${e([...new Set(ws.map(w => ruleName(w.rule)))].slice(0, 4).join(', '))})</div>` : ''}
        </a>
        <div class="card-acts">${btn}${g.others.map(o => `<a class="btn small ghost" href="${recLink(o)}">Запис від ${U.date(o.date)}</a>`).join('')}</div>
      </div>`;
    };
    return {
      title: 'Перевірити дані', back: true, html: `
      <section class="panel">
        <p class="small">Тут зібрано, що варто уточнити: пробіг лише оцінений, позначки «уточніть», «не видно», «не вказано», покази пробігу не по порядку дат, документи, не позначені в журналі. Відкрийте пункт і виправте — уточнивши пробіг, зніміть позначку «лише оцінка» і приберіть «уточніть» з примітки.</p>
        <p class="muted small">Якщо все так і є — «Гаразд, так і є»: пункт зникне і повернеться, лише якщо з’явиться нова причина.</p>
      </section>
      ${active.length ? `<div class="cards">${active.map(g => item(g, false)).join('')}</div>` : '<section class="panel"><p class="ok">Перевіряти нічого — дані в порядку.</p></section>'}
      ${ok.length ? `<details class="more"><summary>Позначені «гаразд» (${ok.length})</summary><div class="cards">${ok.map(g => item(g, true)).join('')}</div></details>` : ''}`,
    };
  }

  function reglament() {
    const rs = M.rules();
    const row = r => `<a class="item" href="#/edit/rule/${e(r.id)}"><div class="row"><b class="grow">${e(r.name)}</b></div>
      <div class="sub">${e(r.action || '')}${r.action ? ' · ' : ''}${r.group ? 'розділ журналу' : intervalText(r)}${r.heavy ? ' · важкі умови: ' + e(r.heavy) : ''}</div></a>`;
    return {
      title: 'Регламент', back: true, html: `
      <p class="actions"><a class="btn" href="#/edit/rule/new">Додати пункт</a></p>
      <h3 class="sec">Обслуговування</h3><div class="list">${rs.filter(r => !r.group).map(row).join('')}</div>
      <h3 class="sec">Розділи журналу (ремонти, без інтервалу)</h3><div class="list">${rs.filter(r => r.group).map(row).join('')}</div>`,
    };
  }

  function notes() {
    const ns = M.notes();
    const html = ns.map(n => `
      <div class="item note ${n.done ? 'done' : ''}">
        <label class="check"><input type="checkbox" data-act="note-done" data-id="${e(n.id)}"${n.done ? ' checked' : ''}></label>
        <a class="grow" href="#/edit/note/${e(n.id)}"><div>${e(n.text)}</div>
          <div class="sub">${U.date(n.date)}${n.master ? ' · до списку для майстра' : ''}</div></a>
      </div>`).join('');
    return {
      title: 'Нотатки', back: true, html: `
      <p class="actions"><a class="btn" href="#/edit/note/new">Нова нотатка</a></p>
      <div class="list">${html || '<p class="muted">Нотаток немає.</p>'}</div>`,
    };
  }

  function probih() {
    const os = M.odos().reverse();
    const html = os.map(o => `<a class="item" href="#/edit/odo/${e(o.id)}"><div class="row"><b>${U.date(o.date)}</b><span class="grow"></span><b>${U.km(o.km, o.kmEst)}</b></div>
      ${o.src ? `<div class="sub">${e(o.src)}</div>` : ''}</a>`).join('');
    return {
      title: 'Пробіг', back: true, html: `
      <p class="actions"><a class="btn" href="#/edit/odo/new">Записати пробіг</a></p>
      <p class="muted small">Записуйте показ одометра щоразу, коли на нього дивитесь, — від цього залежить точність строків. Пробіг із записів у журналі та документах теж враховується.</p>
      <div class="list">${html || '<p class="muted">Показів ще немає.</p>'}</div>`,
    };
  }

  function obmin() { return Obmin.screen(); }

  function nalashtuvannia() {
    const v = M.vehicle();
    return {
      title: 'Налаштування', back: true, html: `
      <section class="panel">
        <h3>${e(v.name)}</h3>
        <dl class="kv">${v.vin ? `<dt>VIN</dt><dd>${e(v.vin)}</dd>` : ''}
          <dt>Попереджати за</dt><dd>${U.km(v.warnKm)} або ${U.daysText(v.warnDays)}</dd></dl>
        <p class="actions"><a class="btn" href="#/edit/vehicle/vehicle">Змінити</a></p>
      </section>
      <section class="panel">
        <h3>Сховище на цьому пристрої</h3>
        <div id="storeInfo" class="muted">Перевіряю…</div>
      </section>
      <section class="panel">
        <h3>Про програму</h3>
        <p class="muted small">«Кашкай ТО», версія ${e(App.VERSION)}. Працює без інтернету, дані зберігаються лише на цьому пристрої. Позначка пристрою: ${e(DB.device)}.</p>
      </section>`,
      after: async () => {
        const el = document.getElementById('storeInfo');
        const p = await DB.persist();
        let s = p === true ? 'Дані захищені від автоматичного очищення браузером.'
          : p === false ? 'Браузер не підтвердив захист даних від очищення. Встановіть програму значком на екран — тоді захист вмикається.'
            : 'Браузер не повідомляє про захист даних.';
        try {
          const est = await navigator.storage.estimate();
          s += ' Зайнято ≈ ' + (est.usage / 1048576).toFixed(1).replace('.', ',') + ' МБ.';
        } catch (x) { /* немає даних */ }
        el.textContent = s;
      },
    };
  }

  function notFound() {
    return { title: 'Не знайдено', back: true, html: '<p class="muted">Запис не знайдено — можливо, його видалено.</p>' };
  }

  // Кнопки «Камера» / «З галереї» для нового документа з розпізнаванням.
  function ocrButtons() {
    return `<label class="btn small">Камера<input type="file" accept="image/*" capture="environment" data-ocr hidden></label>
      <label class="btn small ghost">З галереї<input type="file" accept="image/*" multiple data-ocr hidden></label>`;
  }

  return { stan, rule, zhurnal, docs, doc, vytraty, sche, maistru, perevirka, reglament, notes, probih, obmin, nalashtuvannia, notFound, remText, intervalText, mainText, ocrButtons };
})();
