'use strict';
// Розрахунки: поточний пробіг, стан вузлів за регламентом, витрати.
const M = (() => {
  const DEF_VEHICLE = { id: 'vehicle', t: 'vehicle', name: 'Мій автомобіль', vin: '', warnKm: 1500, warnDays: 45 };
  const CATS = [
    'ТО: комплекс робіт', 'Олива двигуна і фільтр', 'Фільтри повітря і салону', 'Свічки запалювання',
    'Гальмівна система', 'Антифриз', 'Ремінь і ролики приводу', 'Олива МКПП', 'Ходова і рульове',
    'Ремонт двигуна', 'Електрика', 'Акумулятор', 'Кондиціонер', 'Склоочисники', 'Шини і диски',
    'Кузов (ДТП)', 'Аксесуари, доп. обладнання', 'Гарантійна кампанія', 'Діагностика, перевірки',
    'Інше (хімія, дрібниці, слюсарні)',
  ];
  const DOC_KINDS = ['Акт робіт', 'Чек', 'Видаткова накладна', 'Наряд-замовлення', 'Рахунок-фактура',
    'Звіт механіка', 'Калькуляція (не для оплати)', 'Рукописна нотатка'];
  const ST = {
    over: 'Прострочено', soon: 'Незабаром', ok: 'Гаразд', nodata: 'Немає даних', state: 'За станом',
  };
  const ST_ORDER = { over: 0, soon: 1, nodata: 2, ok: 3, state: 4 };

  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || ((a.km || 0) - (b.km || 0));
  function vehicle() {
    const v = Object.assign({}, DEF_VEHICLE, DB.get('vehicle') || {});
    for (const k of ['name', 'warnKm', 'warnDays']) if (v[k] == null || v[k] === '') v[k] = DEF_VEHICLE[k];
    return v;
  }
  const rules = () => DB.list('rule').sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'uk'));
  const works = () => DB.list('work').sort(byDate);
  const odos = () => DB.list('odo').sort(byDate);
  const docs = () => DB.list('doc').sort(byDate);
  const notes = () => DB.list('note').sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (b.date || '').localeCompare(a.date || ''));

  // Усі відомі покази одометра (оцінки не беремо).
  function points() {
    const pts = [];
    for (const r of odos()) if (r.date && r.km != null && !r.kmEst) pts.push({ date: r.date, km: r.km });
    for (const r of works()) if (r.date && r.km != null && !r.kmEst) pts.push({ date: r.date, km: r.km });
    for (const r of docs()) if (r.date && r.km != null && !r.kmEst) pts.push({ date: r.date, km: r.km });
    return pts.sort(byDate);
  }
  const current = (pts = points()) => pts.length ? pts[pts.length - 1] : null;

  // Середній пробіг за день: за останній рік (як у книзі — від показу, що старший щонайменше на 300 днів).
  function rate(pts = points()) {
    if (pts.length < 2) return null;
    const cur = pts[pts.length - 1];
    let base = null;
    for (const p of pts) if (U.days(p.date, cur.date) >= 300) base = p;
    if (!base) base = pts[0];
    const d = U.days(base.date, cur.date);
    return d > 0 && cur.km > base.km ? (cur.km - base.km) / d : null;
  }

  // Пробіг на дату: точний показ або оцінка між сусідніми показами.
  function kmAt(date, pts = points()) {
    if (!date || !pts.length) return null;
    let a = null, b = null, same = null;
    for (const p of pts) {
      if (p.date === date) same = Math.max(same ?? 0, p.km);
      else if (p.date < date) a = p;
      else if (!b) b = p;
    }
    if (same != null) return { km: same, est: false };
    if (a && b) return { km: Math.round(a.km + (b.km - a.km) * U.days(a.date, date) / U.days(a.date, b.date)), est: true };
    const r = rate(pts);
    if (a && r) return { km: Math.round(a.km + r * U.days(a.date, date)), est: true };
    if (b && r) return { km: Math.max(0, Math.round(b.km - r * U.days(date, b.date))), est: true };
    return null;
  }

  function context() {
    const pts = points();
    const cur = current(pts);
    const r = rate(pts);
    const today = U.today();
    let nowKm = null, nowEst = false;
    if (cur) {
      nowKm = cur.km;
      if (r && cur.date < today) { nowKm = Math.round(cur.km + r * U.days(cur.date, today)); nowEst = true; }
    }
    return { pts, cur, r, today, nowKm, nowEst, v: vehicle(), works: works() };
  }

  function status(rule, ctx = context()) {
    const ws = ctx.works.filter(w => w.rule === rule.id && w.date);
    const last = ws.length ? ws[ws.length - 1] : null;
    const o = { rule, last, count: ws.length };
    if (last) {
      o.lastDate = last.date;
      if (last.km != null) { o.lastKm = last.km; o.lastKmEst = !!last.kmEst; }
      else { const e = kmAt(last.date, ctx.pts); if (e) { o.lastKm = e.km; o.lastKmEst = e.est; } }
    }
    if (!rule.km && !rule.months) { o.st = 'state'; return o; }
    if (!last) { o.st = 'nodata'; return o; }
    if (rule.km && o.lastKm != null) {
      o.nextKm = o.lastKm + rule.km;
      if (ctx.nowKm != null) { o.remKm = o.nextKm - ctx.nowKm; o.remKmEst = ctx.nowEst; }
    }
    if (rule.months) o.nextDate = U.addMonths(o.lastDate, rule.months);
    let kmDate = null;
    if (o.nextKm != null && ctx.cur && ctx.r) kmDate = U.addDays(ctx.cur.date, (o.nextKm - ctx.cur.km) / ctx.r);
    o.dueDate = [o.nextDate, kmDate].filter(Boolean).sort()[0] || null;
    o.dueByKm = !!kmDate && o.dueDate === kmDate && kmDate !== o.nextDate;
    if (o.dueDate) o.remDays = U.days(ctx.today, o.dueDate);
    const v = ctx.v;
    if ((o.remKm != null && o.remKm < 0) || (o.remDays != null && o.remDays < 0)) o.st = 'over';
    else if ((o.remKm != null && o.remKm <= v.warnKm) || (o.remDays != null && o.remDays <= v.warnDays)) o.st = 'soon';
    else o.st = 'ok';
    return o;
  }

  function allStatus(ctx = context()) {
    return rules().filter(r => !r.group).map(r => status(r, ctx)).sort((a, b) =>
      ST_ORDER[a.st] - ST_ORDER[b.st] ||
      ((a.remDays ?? 1e9) - (b.remDays ?? 1e9)) ||
      (a.rule.order ?? 999) - (b.rule.order ?? 999));
  }

  // ---- документи і витрати ----
  function docTotal(d) {
    const items = d.items || [];
    const s = items.reduce((a, i) => a + (i.sum || 0), 0);
    const total = d.sum != null ? d.sum : s;
    return { total, itemsSum: s, coef: s > 0 ? total / s : 0 };
  }
  function nextDocCode() {
    let mx = 0;
    for (const d of DB.list('doc')) { const m = /(\d+)/.exec(d.code || ''); if (m) mx = Math.max(mx, +m[1]); }
    return 'Д' + String(mx + 1).padStart(2, '0');
  }
  function expenses() {
    const years = new Map();
    const pts = points();
    for (const d of docs()) {
      if (!d.count || !d.date) continue;
      const y = +d.date.slice(0, 4);
      const { total, itemsSum, coef } = docTotal(d);
      let Y = years.get(y);
      if (!Y) years.set(y, Y = { year: y, total: 0, count: 0, cats: {} });
      Y.total += total; Y.count++;
      if (itemsSum > 0) {
        for (const i of d.items) {
          const c = i.cat || 'Без категорії';
          Y.cats[c] = (Y.cats[c] || 0) + (i.sum || 0) * coef;
        }
      } else if (total) Y.cats['Без розкладу на позиції'] = (Y.cats['Без розкладу на позиції'] || 0) + total;
    }
    // Роки без жодного документа теж показуємо — щоб прогалину було видно.
    const today = U.today(), thisYear = +today.slice(0, 4);
    if (years.size) {
      const first = Math.min(...years.keys());
      for (let y = first; y <= thisYear; y++) if (!years.has(y)) years.set(y, { year: y, total: 0, count: 0, cats: {} });
    }
    for (const Y of years.values()) Object.assign(Y, yearKm(Y.year, pts, today) || {});
    return [...years.values()].sort((a, b) => b.year - a.year);
  }

  // Пробіг за рік: пробіг на 31 грудня мінус пробіг на 31 грудня попереднього року
  // (між показами — оцінка). Перший рік рахуємо від першого показу, поточний — по сьогодні.
  function yearKm(y, pts = points(), today = U.today()) {
    if (!pts.length) return null;
    let from = (y - 1) + '-12-31', to = y + '-12-31', kmFirst = false, kmNow = false;
    if (pts[0].date > from) { from = pts[0].date; kmFirst = true; }
    if (to > today) { to = today; kmNow = true; }
    if (to <= from) return null;
    const a = kmAt(from, pts), b = kmAt(to, pts);
    if (!a || !b || b.km <= a.km) return null;
    return { km: b.km - a.km, kmEst: a.est || b.est, kmFirst, kmNow, kmFrom: from };
  }

  // Пробіг за весь час обліку: від першого показу до сьогодні.
  function totalKm(ctx = context()) {
    if (!ctx.pts.length || ctx.nowKm == null) return null;
    const km = ctx.nowKm - ctx.pts[0].km;
    return km > 0 ? { km, from: ctx.pts[0].date } : null;
  }

  // ---- документ → журнал: які вузли зачіпає документ ----
  // Ключ → як упізнати вузол у регламенті за назвою (вузли власник може перейменувати — тоді просто не відмітиться).
  const NODE_RE = {
    oil: /олива двигуна|моторн\S* олив/i, air: /повітрян\S* фільтр|фільтр повітр/i, cabin: /фільтр салону|салонн\S* фільтр/i,
    plugs: /свічк/i, brakefluid: /гальмівн\S* рідин/i, coolant: /антифриз|охолоджувальн\S* рідин/i,
    belt: /ремінь|ремені/i, rollers: /ролик/i, chain: /ланцюг/i, mkpp: /мкпп|кпп|коробк/i,
    brakes: /^гальма/i, chassis: /^ходова/i, align: /розвал|сходжен/i, cooling: /система охолодж/i,
    fuel: /паливн/i, locks: /замки|петлі/i, padsF: /колодки.*передн/i, padsR: /колодки.*задн/i,
    battery: /акумулятор/i, ac: /кондиціонер/i, wipers: /склоочис|двірник/i, tires: /^шини/i,
    gEngine: /ремонт:?\s*двигун/i, gChassis: /ремонт:?\s*ходов/i, gElec: /ремонт:?\s*електр/i,
    gBody: /^кузов/i, gAcc: /аксесуар/i, gWarranty: /гарантійн/i, gDiag: /^діагностик/i,
  };
  const BY_CAT = {
    'Олива двигуна і фільтр': 'oil', 'Свічки запалювання': 'plugs', 'Антифриз': 'coolant', 'Олива МКПП': 'mkpp',
    'Акумулятор': 'battery', 'Кондиціонер': 'ac', 'Склоочисники': 'wipers', 'Шини і диски': 'tires',
    'Ремонт двигуна': 'gEngine', 'Електрика': 'gElec', 'Кузов (ДТП)': 'gBody',
    'Аксесуари, доп. обладнання': 'gAcc', 'Гарантійна кампанія': 'gWarranty',
  };
  function itemKeys(it) {
    const n = (it.name || '').toLowerCase(), cat = it.cat || '';
    const k = new Set();
    const check = /^\s*(\[[^\]]*\]\s*)?(перевір|провер|діагност|диагност|огляд|осмотр|контрол)/.test(n) && !/замін|замен|с\/у|зняття/.test(n);
    // Огляди й перевірки — за словами в назві (заміна теж означає, що вузол оглянули).
    if (/колодк|тормоз|гальм\S* (диск|шланг|трубк|трубопр|систем|механізм)|(диск|шланг|трубк)\S* гальм/.test(n) || (check && /гальм/.test(n))) k.add('brakes');
    if (/ходов|підвіск|подвеск|шарнір|рульов|рулев|важел|амортиз|маточин|стабіліз|стабилиз|пильовик|пыльник|чохл/.test(n)) k.add('chassis');
    if (/розвал|сходжен|схожден|балансув/.test(n)) k.add('align');
    if (/охолод|радіатор|патрубк|антифриз/.test(n)) k.add('cooling');
    if (/паливн|топливн|evap/.test(n)) k.add('fuel');
    if (/замк|петел|петл/.test(n)) k.add('locks');
    if (/акб|акумулятор|аккумулятор/.test(n)) k.add('battery');
    if (/(^|[^а-яіїєґ])шин|шиномонт/.test(n)) k.add('tires');
    if (/кпп|коробк\S* (змін|передач)|трансміс|трансмис/.test(n)) k.add('mkpp');
    if (/діагност|диагност/.test(n) && cat === 'Діагностика, перевірки') k.add('gDiag');
    if (check) return k;
    // Заміни — за категорією позиції, а без категорії — за назвою.
    const before = k.size;
    if (BY_CAT[cat]) k.add(BY_CAT[cat]);
    else if (cat === 'Фільтри повітря і салону') k.add(/салон|кондиці|кондици/.test(n) ? 'cabin' : 'air');
    else if (cat === 'Ремінь і ролики приводу') k.add(/ролик/.test(n) ? 'rollers' : /ланцюг|грм/.test(n) ? 'chain' : 'belt');
    else if (cat === 'Ходова і рульове' && !k.has('align')) k.add('gChassis');
    if (cat === 'Гальмівна система' || !cat || k.size === before) {
      if (/(олив|масл|олі|мастил)\S* .*(двиг|двс|двз|мотор)|мотор\S* олив|(фільтр|фильтр)\S* (олив|масл)|(оливн|масляний)\S* (фільтр|фильтр)/.test(n)) k.add('oil');
      if (/фільтр|фильтр/.test(n) && /салон|кондиці|кондици/.test(n)) k.add('cabin');
      else if (/фільтр|фильтр/.test(n) && /повітр|воздуш/.test(n)) k.add('air');
      if (/свіч|свеч/.test(n)) k.add('plugs');
      if (/гальмівн\S* рідин|рідин\S* гальм|тормозн\S* жидк/.test(n)) k.add('brakefluid');
      if (/антифриз|охолоджу\S* рідин|тосол/.test(n)) k.add('coolant');
      if (/колодк/.test(n) && /передн|переднего/.test(n)) k.add('padsF');
      if (/колодк/.test(n) && /задн/.test(n)) k.add('padsR');
      if (/щітк\S* склоочис|склоочис|двірник|дворник/.test(n)) k.add('wipers');
      if (/ролик/.test(n)) k.add('rollers');
      else if (/ремін|ремен/.test(n)) k.add('belt');
    }
    return k;
  }
  // Пункти регламенту, які, найімовірніше, виконано за документом.
  // Літрів у позиції: «Охолоджуюча рідина, 5Л» × 0,3 шт = 1,5 л.
  function litres(it) {
    const m = /(\d+(?:[.,]\d+)?)\s*(л(?:ітр|итр)?[а-яіїєґ]*|l)(?![а-яіїєґa-z])/i.exec(it.name || '');
    const per = m ? +m[1].replace(',', '.') : null;
    if (/^л/i.test(it.unit || '')) return it.qty ?? per ?? 0;
    return per != null ? per * (it.qty ?? 1) : 0;
  }
  // Рідину замінено, якщо є робота «заміна» або куплено достатньо (інакше це доливання).
  function replaced(items, re, min) {
    const its = items.filter(i => re.test(i.name || ''));
    return its.some(i => /замін|замен/i.test(i.name)) || its.reduce((s, i) => s + litres(i), 0) >= min;
  }
  function docRules(d) {
    const keys = new Set(), items = d.items || [];
    for (const it of items) itemKeys(it).forEach(x => keys.add(x));
    if (keys.has('coolant') && !replaced(items, /охолод\S* рідин|антифриз|тосол/i, 4)) keys.delete('coolant');
    if (keys.has('brakefluid') && !replaced(items, /(рідин|жидк)\S*.*(гальм|тормоз)|(гальм|тормоз)\S* (рідин|жидк)|dot\s*4/i, 0.8)) keys.delete('brakefluid');
    const rs = rules(), out = new Set();
    for (const key of keys) {
      const g = key[0] === 'g';   // ключі розділів журналу (ремонти) починаються з «g»
      const r = rs.find(r => !!r.group === g && NODE_RE[key].test(r.name));
      if (r) out.add(r.id);
    }
    return out;
  }

  // Значення, що вже траплялися — для підказок під час введення.
  function used(t, field, extra = []) {
    const s = new Set(extra);
    for (const r of DB.list(t)) if (r[field]) s.add(r[field]);
    return [...s].sort((a, b) => a.localeCompare(b, 'uk'));
  }
  function usedCats() {
    const s = new Set(CATS);
    for (const d of DB.list('doc')) for (const i of d.items || []) if (i.cat) s.add(i.cat);
    return [...s];
  }

  return {
    ST, CATS, DOC_KINDS, vehicle, rules, works, odos, docs, notes, points, current, rate, kmAt,
    context, status, allStatus, docTotal, nextDocCode, expenses, yearKm, totalKm, docRules, used, usedCats,
  };
})();
