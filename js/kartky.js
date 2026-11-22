'use strict';
// Картки вузлів: вкладка «Авто» → вузли. Одна картка на вузол — стан, що заливати, деталі, історія, гроші.
// Усе береться зі спільних блоків: пункт регламенту (інтервал), запчастини й документи (за ключами вузла, див. vuzly.js),
// довідка моделі (J11). Власного списку вузлів чи деталей тут немає.
const Cards = (() => {
  const e = U.esc;

  // Деталі вузла: за ключами, що збережені в запчастині (не за назвою).
  const partsOf = rule => {
    const ks = Nodes.ofRule(rule);
    return Parts.parts().filter(p => M.partNodes(p).some(k => ks.includes(k)));
  };
  const nameOf = p => p.name || 'Запчастина';

  // Скільки всього витрачено на вузол: позиції документів, що належать вузлу (з поправкою знижки документа).
  function spent(rule) {
    const ks = Nodes.ofRule(rule);
    let sum = 0, n = 0;
    for (const d of M.docs()) {
      if (!d.count) continue;   // документи не «у витратах» не рахуємо — як на екрані «Витрати»
      const { coef } = M.docTotal(d);
      let s = 0;
      for (const it of d.items || []) if ([...M.itemKeys(it)].some(k => ks.includes(k))) s += (it.sum || 0) * coef;
      if (s > 0) { sum += s; n++; }
    }
    return { sum, n };
  }

  // Рядки вузла для списку майстру: довідка + номери деталей (з позначкою, чи звірено за VIN).
  function master(rule) {
    const out = [];
    let unver = false;
    const sp = M.spec(rule);
    if (sp) out.push('    Залити: ' + sp);
    for (const p of partsOf(rule).filter(x => !x.dont)) {
      const alts = Array.isArray(p.alts) ? p.alts : [];
      const num = (p.oem && p.chk !== 'bad' ? p.oem : (alts.find(a => a.num && a.st !== 'dont') || {}).num || '').trim();
      if (!num) { out.push('    ' + nameOf(p) + ': номера немає — знайти за VIN'); unver = true; continue; }
      const ok = p.chk === 'ok';
      if (!ok) unver = true;
      out.push('    ' + nameOf(p) + ': ' + num + (ok ? '' : ' *'));
    }
    return { text: out.length ? '\n' + out.join('\n') : '', unver };
  }

  function stateSec(r, o) {
    const last = o.lastDate ? U.date(o.lastDate) + (o.lastKm != null ? ' · ' + U.km(o.lastKm, o.lastKmEst) : '') : 'записів у журналі ще немає';
    const kv = [
      ['Зараз', V.remText(o)],
      ['Востаннє', last],
      ['Наступне', [o.nextKm != null ? U.km(o.nextKm) : '', o.nextDate ? U.date(o.nextDate) : ''].filter(Boolean).join(' або ')],
      ['Що робити', r.action],
      ['Інтервал', V.intervalText(r)],
      ['Важкі умови', r.heavy],
      ['Відкладено', o.snoozed ? 'до ' + U.date(o.snoozed) : ''],
      ['Примітка', r.note],
      ['Джерело', r.source],
    ].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${e(v)}</dd>`).join('');
    const seasonHint = Nodes.has(r, 'tires') && !M.seasonDates(r.season).length
      ? '<p class="hint">Можна вказати дати сезонної заміни (наприклад, 01.11, 01.04) і прибрати інтервал у місяцях — тоді програма нагадуватиме саме перед сезоном. Натисніть «Змінити пункт».</p>' : '';
    return `<div class="vsec"><h4>Стан</h4><dl class="kv">${kv}</dl>${seasonHint}</div>`;
  }

  function historySec(r) {
    const ws = M.works().filter(w => w.rule === r.id).reverse();
    const rows = ws.slice(0, 6).map(w => `<a class="hrow" href="#/edit/work/${e(w.id)}"><span>${U.date(w.date)}${w.what ? ' · ' + e(w.what) : ''}</span><span class="muted">${w.km != null ? U.km(w.km, w.kmEst) : ''}</span></a>`).join('');
    return `<div class="vsec"><h4>Історія (${ws.length})</h4>${rows || '<p class="muted small">Записів ще немає.</p>'}
      ${ws.length > 6 ? `<a class="small" href="#/zhurnal?rule=${encodeURIComponent(r.id)}">Усі записи (${ws.length}) в Історії</a>` : ''}</div>`;
  }

  function moneySec(r) {
    const c = M.ruleCost(r), s = spent(r);
    const rows = [];
    if (c) rows.push(`<div class="hrow"><span>Зазвичай коштує</span><b>≈ ${U.int(c.sum)} грн</b></div><div class="muted small">${c.src === 'doc' ? 'за останнім чеком' + (c.year ? ' ' + c.year : '') : 'за свіжими цінами деталей'}</div>`);
    if (s.n) rows.push(`<div class="hrow"><span>Усього на вузол</span><b>${U.int(Math.round(s.sum))} грн</b></div><div class="muted small">за ${s.n} ${U.plural(s.n, 'документ', 'документи', 'документів')}, що йдуть у витрати</div>`);
    return `<div class="vsec"><h4>Гроші</h4>${rows.join('') || '<p class="muted small">Витрат на цей вузол у документах ще немає.</p>'}</div>`;
  }

  // «Що заливати»: рідина, об'єм, інтервал з пакета моделі — кожен рядок з джерелом або позначкою «не перевірено».
  function factsSec(r) {
    const fs = M.facts(r);
    if (!fs.length) return '';
    const rows = fs.map(f => f.ok
      ? `<div class="fact"><span class="muted small">${e(f.what)}</span> <b>${e(f.text)}</b><div class="muted small">✓ ${e(f.src)}</div></div>`
      : `<div class="fact"><span class="muted small">${e(f.what)}</span> <span class="tag tag-wait">не перевірено</span><div class="muted small">${e(f.src)}</div></div>`).join('');
    return `<div class="vsec"><h4>Що заливати</h4>${rows}</div>`;
  }

  function partsSec(r, ps) {
    const key = Nodes.ofRule(r)[0] || '';
    return `<div class="vsec"><h4>Деталі</h4>${ps.map(Parts.item).join('') || '<p class="muted small">Деталей до цього вузла ще не прив’язано.</p>'}
      <p class="actions"><a class="btn small ghost" href="#/edit/part/new${key ? '?node=' + encodeURIComponent(key) : ''}">Додати деталь</a></p></div>`;
  }

  function actions(r, o) {
    const id = e(r.id), check = !r.group && /огляд|перевір|змащ|стан/i.test(r.action || '');
    return `<p class="actions"><a class="btn" href="#/edit/visit/new?rule=${id}">Записати виконання</a>
      ${check ? `<button type="button" class="btn ghost" data-act="quick-check" data-id="${id}">Перевірено — гаразд</button>` : ''}
      ${!r.group && (o.st === 'over' || o.st === 'soon' || o.st === 'nodata' || o.snoozed) ? `<button type="button" class="btn ghost" data-act="snooze" data-id="${id}">${o.snoozed ? 'Відкладено' : 'Нагадати пізніше'}</button>` : ''}
      <a class="btn ghost" href="#/edit/rule/${id}">Змінити пункт</a>
      ${!r.group && Nodes.has(r, 'tires') ? '<a class="btn ghost" href="#/shyny">Шини: комплекти</a>' : ''}</p>`;
  }

  // Одна картка. o — стан вузла (для розділів журналу — null).
  function card(r, o) {
    const ps = partsOf(r);
    const st = o ? o.st : 'state';
    const sub = o ? V.mainText(o) : 'розділ журналу, без інтервалу';
    const badge = o ? M.ST[o.st] : 'розділ';
    const spec = M.spec(r);
    const q = [r.name, r.action, spec, ...ps.map(Parts.searchText)].join(' ').toLowerCase();
    return `<details class="card vcard st-${st}" id="v_${e(r.id)}" data-q="${e(q)}">
      <summary><span class="grow"><b>${e(r.name)}</b><span class="sub">${o && o.snoozed ? 'Відкладено до ' + U.date(o.snoozed) + ' · ' : ''}${e(sub)}</span></span><span class="badge">${e(badge)}</span></summary>
      <div class="vbody">
        ${o ? stateSec(r, o) : ''}
        ${factsSec(r)}
        ${partsSec(r, ps)}
        ${historySec(r)}
        ${moneySec(r)}
        <div class="vsec">${actions(r, o || {})}</div>
      </div></details>`;
  }

  // Усі картки — для вкладки «Авто». open — id вузла, який треба розгорнути й показати.
  function block(open) {
    const ctx = M.context();
    const list = M.allStatus(ctx);
    const groups = M.rules().filter(r => r.group);
    const all = DB.list('part').length ? Parts.parts() : [];
    // Деталі, що не потрапили в жоден вузол.
    const inCard = new Set();
    for (const r of M.rules()) for (const p of partsOf(r)) inCard.add(p.id);
    const orphans = all.filter(p => !inCard.has(p.id));
    const orphanHtml = orphans.length ? `<details class="card vcard st-state" id="v_orphans" data-q="${e(orphans.map(Parts.searchText).join(' '))}">
      <summary><span class="grow"><b>Інші деталі</b><span class="sub">не віднесені до вузла: ${orphans.length}</span></span><span class="badge">без вузла</span></summary>
      <div class="vbody"><div class="vsec">${orphans.map(Parts.item).join('')}
        <p class="muted small">Щоб віднести деталь до вузла, натисніть «Змінити» й виберіть вузол у розділі «Вузол».</p></div></div></details>` : '';
    const cnt = k => list.filter(o => k.includes(o.st)).length;
    const html = `<h3 class="sec">Вузли (${list.length}) <span class="cnt c-over">${cnt(['over'])}</span> <span class="cnt c-soon">${cnt(['soon', 'nodata'])}</span> <span class="cnt c-ok">${cnt(['ok', 'state'])}</span></h3>
      <div class="toolbar"><input id="vq" type="search" placeholder="Пошук: вузол, деталь, номер, виробник" autocomplete="off"></div>
      <p class="actions"><a class="btn small ghost" href="#/edit/rule/new">Додати пункт</a></p>
      <div class="cards" id="vcards">${list.map(o => card(o.rule, o)).join('')}${orphanHtml}</div>
      ${groups.length ? `<details class="more"><summary>Розділи журналу — ремонти (${groups.length})</summary><div class="cards">${groups.map(r => card(r, null)).join('')}</div></details>` : ''}
      ${Parts.tools(all)}`;
    return {
      html,
      after: () => {
        Ceny.draw();
        const q = document.getElementById('vq');
        if (q) q.addEventListener('input', () => {
          const t = q.value.trim().toLowerCase();
          const cs = [...document.querySelectorAll('.vcard')];
          cs.forEach(c => { c.hidden = !!t && !c.dataset.q.includes(t); });
          const shown = cs.filter(c => !c.hidden);
          if (t) shown.forEach(c => { c.open = shown.length <= 3; });
          document.querySelectorAll('details.more').forEach(d => { if (t && d.querySelector('.vcard') && d.querySelector('.vcard:not([hidden])')) d.open = true; });
        });
        if (open) {
          const c = document.getElementById('v_' + open);
          if (c) {
            const more = c.closest('details.more');
            if (more) more.open = true;
            c.open = true;
            c.scrollIntoView({ block: 'start' });
          }
        }
      },
    };
  }

  return { block, master, partsOf };
})();
