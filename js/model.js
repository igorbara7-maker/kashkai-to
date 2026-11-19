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
    // Пробіг за рік: останній показ року мінус останній показ попереднього.
    const endKm = y => { let k = null; for (const p of pts) if (+p.date.slice(0, 4) <= y) k = p.km; return k; };
    for (const Y of years.values()) {
      const a = endKm(Y.year - 1), b = endKm(Y.year);
      if (a != null && b != null && b > a) Y.km = b - a;
    }
    return [...years.values()].sort((a, b) => b.year - a.year);
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
    context, status, allStatus, docTotal, nextDocCode, expenses, used, usedCats,
  };
})();
