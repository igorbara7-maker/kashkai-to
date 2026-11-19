'use strict';
// Розбір розпізнаного тексту документа: рядки таблиці, дата, номер, СТО, пробіг, сума, позиції.
// Лише пропонує значення — власник перевіряє їх у формі перед збереженням.
const OP = (() => {
  // ---------- рядки з окремих написів ----------
  // lines: [{text, box:[[x,y]×4]}] → rows: [{cells:[text…], text}] у порядку читання.
  function rowsFromLines(lines) {
    if (!lines.length) return [];
    const ang = [];
    for (const l of lines) {
      const [tl, tr, , bl] = l.box;
      const w = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]), h = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
      if (w > 3 * h) ang.push(Math.atan2(tr[1] - tl[1], tr[0] - tl[0]));
    }
    ang.sort((a, b) => a - b);
    const a = ang.length ? ang[ang.length >> 1] : 0, cs = Math.cos(a), sn = Math.sin(a);
    const items = lines.map(l => {
      const [tl, tr, br, bl] = l.box;
      const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4, cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
      const h = Math.max(1, (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2);
      const w = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
      const x = cs * cx + sn * cy, y = -sn * cx + cs * cy;
      return { text: l.text, x0: x - w / 2, x1: x + w / 2, y, h };
    }).sort((p, q) => p.y - q.y);
    const rows = [];
    for (const it of items) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(it.y - r.y) < 0.5 * Math.min(it.h, r.h)) {
        r.items.push(it);
        r.y = r.items.reduce((s, x) => s + x.y, 0) / r.items.length;
      } else rows.push({ y: it.y, h: it.h, items: [it] });
    }
    return rows.map(r => {
      r.items.sort((p, q) => p.x0 - q.x0);
      const cells = r.items.map(x => x.text);
      return { cells, xs: r.items.map(x => [x.x0, x.x1]), text: cells.join('  ') };
    });
  }

  // ---------- числа ----------
  // «1 234,56», «1234.56», «200.000», «3,250» → число. Пробіли — розділювач тисяч.
  // Число не може починатися одразу після літери (MO8, L19 — це частини артикулів).
  const NUM_RE = /(?<![\d.,A-Za-zА-Яа-яІіЇїЄєҐґ])(?:\d{1,3}(?:[   ]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d+)?)(?!\d)/g;
  function toNum(s) {
    let t = String(s).replace(/[   ]/g, '');
    const i = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    if (i >= 0) t = t.slice(0, i).replace(/[.,]/g, '') + '.' + t.slice(i + 1);
    const n = Number(t);
    return isFinite(n) ? n : null;
  }
  function nums(s) {
    const out = [];
    for (const m of String(s).matchAll(NUM_RE)) {
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (/^\s?%/.test(after)) continue; // відсотки
      const v = toNum(m[0]);
      if (v != null) out.push({ v, raw: m[0], i: m.index });
    }
    return out;
  }
  const lat2cyr = s => s.replace(/[aeiopcxykmhbt]/g, c => 'аеіорсхукмнвт'['aeiopcxykmhbt'.indexOf(c)]);
  const low = s => lat2cyr(String(s).toLowerCase()).replace(/[’'ʼ`´]/g, "'");

  // ---------- сума прописом ----------
  const W1 = {
    'нуль': 0, 'один': 1, 'одна': 1, 'одне': 1, 'одно': 1, 'два': 2, 'дві': 2, 'две': 2, 'три': 3, 'чотири': 4, 'четыре': 4,
    "п'ять": 5, 'пять': 5, 'шість': 6, 'шесть': 6, 'сім': 7, 'семь': 7, 'вісім': 8, 'восемь': 8, "дев'ять": 9, 'девять': 9,
    'десять': 10, 'одинадцять': 11, 'одиннадцать': 11, 'дванадцять': 12, 'двенадцать': 12, 'тринадцять': 13, 'тринадцать': 13,
    'чотирнадцять': 14, 'четырнадцать': 14, "п'ятнадцять": 15, 'пятнадцать': 15, 'шістнадцять': 16, 'шестнадцать': 16,
    'сімнадцять': 17, 'семнадцать': 17, 'вісімнадцять': 18, 'восемнадцать': 18, "дев'ятнадцять": 19, 'девятнадцать': 19,
    'двадцять': 20, 'двадцать': 20, 'тридцять': 30, 'тридцать': 30, 'сорок': 40, "п'ятдесят": 50, 'пятьдесят': 50,
    'шістдесят': 60, 'шестьдесят': 60, 'сімдесят': 70, 'семьдесят': 70, 'вісімдесят': 80, 'восемьдесят': 80,
    "дев'яносто": 90, 'девяносто': 90, 'сто': 100, 'двісті': 200, 'двести': 200, 'триста': 300, 'чотириста': 400,
    'четыреста': 400, "п'ятсот": 500, 'пятьсот': 500, 'шістсот': 600, 'шестьсот': 600, 'сімсот': 700, 'семьсот': 700,
    'вісімсот': 800, 'восемьсот': 800, "дев'ятсот": 900, 'девятьсот': 900,
  };
  const KEYS = Object.keys(W1);
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function wordVal(w) {
    if (w in W1) return W1[w];
    const v = w.replace(/'/g, '');
    for (const k of KEYS) if (k.replace(/'/g, '') === v) return W1[k];
    if (w.length >= 5) for (const k of KEYS) if (k.length >= 5 && lev(k.replace(/'/g, ''), v) <= 1) return W1[k];
    return null;
  }
  // «Дві тисячі дванадцять гривень 45 копійок» → 2012.45
  function sumInWords(text) {
    const t = low(text);
    const m = t.match(/([а-яіїєґ' \-]{3,}?)\s*(гривень|гривні|гривня|гривна|гривен|грн)\.?\s*(\d{1,2})?\s*(коп|копійок|копійки|копійка|копеек|копейки)?/);
    if (!m) return null;
    const words = m[1].split(/[\s\-]+/).filter(Boolean);
    let total = 0, part = 0, any = false;
    for (const w of words) {
      if (/^тисяч|^тысяч/.test(w) || lev(w.slice(0, 6), 'тисячі') <= 1) { total += (part || 1) * 1000; part = 0; any = true; continue; }
      if (/^мільйон|^миллион/.test(w)) { total += (part || 1) * 1e6; part = 0; any = true; continue; }
      const v = wordVal(w);
      if (v == null) { if (any) { total = 0; part = 0; any = false; } continue; } // слово не число — починаємо заново
      part += v; any = true;
    }
    if (!any) return null;
    const kop = m[3] != null ? Number(m[3]) : 0;
    return Math.round(((total + part) + kop / 100) * 100) / 100;
  }

  // ---------- дата ----------
  const MONTHS = ['січ', 'лют', 'берез', 'квіт', 'трав', 'черв', 'лип', 'серп', 'верес', 'жовт', 'листоп', 'груд'];
  const MONTHS_RU = ['янв', 'февр', 'март', 'апр', 'ма', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];
  function mkDate(d, m, y) {
    if (y < 100) y += 2000;
    const now = new Date().getFullYear();
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= now + 1)) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function datesIn(s) {
    const out = [];
    for (const m of s.matchAll(/(?<!\d)(\d{1,2})\s?[.\/-]\s?(\d{1,2})\s?[.\/-]\s?(\d{4}|\d{2})(?!\d)/g)) {
      const v = mkDate(+m[1], +m[2], +m[3]);
      if (v) out.push({ v, i: m.index });
    }
    const t = low(s);
    for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s+([а-яіїє]{3,})\.?\s+(\d{4})/g)) {
      let mi = MONTHS.findIndex(x => m[2].startsWith(x));
      if (mi < 0) mi = MONTHS_RU.findIndex(x => m[2].startsWith(x) && (x !== 'ма' || /^ма[яй]/.test(m[2])));
      const v = mi >= 0 ? mkDate(+m[1], mi + 1, +m[3]) : null;
      if (v) out.push({ v, i: m.index });
    }
    return out;
  }

  // ---------- тип документа ----------
  // У порядку важливості: якщо в одному документі є і акт, і рахунок — це акт.
  const NB = '(?<![а-яіїєґ])', NA = '(?![а-яіїєґ])';
  const KINDS = [
    [new RegExp(`ак[тм]\\s+(в[иі]к|выпол|здач|прийм|наданих)|^ак[тм]${NA}|${NB}акт\\s*№`), 'Акт робіт'],
    [/калькуляц|попередн\S*\s+(розрахун|сума|калькул)/, 'Калькуляція (не для оплати)'],
    [/видаткова\s+накладна|расходная\s+накладная|накладна\s*№|накладная\s*№/, 'Видаткова накладна'],
    [/наряд[\s\-]*замовлен|заказ[\s\-]*наряд|наряд[\s\-]*заказ/, 'Наряд-замовлення'],
    [new RegExp(`фіскальний\\s+чек|касовий\\s+чек|чек\\s*№|${NB}прро${NA}|фіскальний\\s+номер|${NB}фн\\s*\\d`), 'Чек'],
    [/рахунок[\s\-]*фактура|рахунок\s+на\s+оплату|счет[\s\-]*фактура|^рахунок\s*№/, 'Рахунок-фактура'],
  ];

  // Порівняння назв без різниці мов і схожих літер: и/і/ї/ы → і, е/є/э/ё → е, ґ → г.
  const canon = s => low(s).replace(/[иіїы]/g, 'і').replace(/[еєэё]/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ъь'"«»“”„]/g, '').replace(/[\-–—_.,:;()\/]/g, ' ').replace(/\s+/g, ' ').trim();
  const GENERIC = new Set(['дилер', 'nissan', 'сервіс', 'сервис', 'авто', 'центр', 'моторс', 'миколаїв', 'одеса', 'херсон', 'київ', 'назва', 'скані', 'видна'].map(canon));

  // ---------- позиції ----------
  const UNIT_RE = /^(шт|шт\.|л|л\.|кг|г|м|пара|к-т|кт|компл\.?|комп\.?|н\/год|н\/г|н-год|н\.год|норм\.?\s*год|год\.?|род|час|уп\.?)$/i;
  const ART_RE = /^(?!\d+[.,]\d{1,3}$)(?=[A-Z0-9\-\.\/]*\d[A-Z0-9\-\.\/]*\d)[A-Z0-9][A-Z0-9\-\.\/]{4,}$/i;
  const WORK_RE = /с\/у|з\/в|робот|заміна|замена|зняття|снятие|зняти|встановл|установ|діагност|диагност|регулюв|регулир|ремонт|перевір|провер|мийк|мойк|шиномонт|розвал|развал|балансув|обслугов|прокачк|огляд|осмотр|демонтаж|монтаж|вальцюв|корегув|корректир/i;
  const TOTAL_RE = /^(всього|усього|разом|итого|всего|сума|знижка|скидка|пдв|ндс|оплачено|до\s+сплати)/i;
  const CAT_RULES = [
    [/фільтр.*(повітр|салон|кондиц)|фильтр.*(воздуш|салон)|повітрян.*фільтр|салонн.*фільтр/i, 'Фільтри повітря і салону'],
    [/олив|масл|oil|мастил/i, 'Олива двигуна і фільтр'],
    [/свіч|свеч/i, 'Свічки запалювання'],
    [/гальм|тормоз|колодк/i, 'Гальмівна система'],
    [/антифриз|охолодж|охлажд|тосол/i, 'Антифриз'],
    [/ремін|ремен|ролик|натяжит/i, 'Ремінь і ролики приводу'],
    [/кпп|трансмісі|трансмисс|коробк/i, 'Олива МКПП'],
    [/амортиз|стійк|стойк|важіл|рычаг|сайлент|кермов|рулев|рульов|наконечн|накінечн|опор|шарнір|шарова|шаров|ступиц|маточин|підшипн|подшипн|підвіск|подвеск|пружин|стабілізатор/i, 'Ходова і рульове'],
    [/акумулят|аккумулят|акб/i, 'Акумулятор'],
    [/кондиціон|кондицион|фреон|холодоагент/i, 'Кондиціонер'],
    [/щітк|щетк|склоочис|стеклоочис|двірник|дворник/i, 'Склоочисники'],
    [/шин|балансув|шиномонт|колес|диск\s+колес/i, 'Шини і диски'],
    [/діагност|диагност|перевір|провер|огляд|осмотр/i, 'Діагностика, перевірки'],
    [/сигналіз|реєстрат|регістрат|регистрат|камер|парктронік|парктроник|магнітол|магнитол|килим|коврик|чохл|чехл|дефлектор|вітровик|фаркоп|аксесуар/i, 'Аксесуари, доп. обладнання'],
    [/лампа|запобіжн|предохран|проводк|електр|электр|генератор|стартер/i, 'Електрика'],
  ];
  const stem = w => canon(w).replace(/[^а-яa-z0-9і]/g, '').slice(0, 5);
  function guessCat(name, known) {
    const ws = new Set(String(name).split(/\s+/).map(stem).filter(w => w.length >= 4));
    let best = null, bestN = 0;
    for (const k of known || []) {
      let n = 0;
      for (const w of new Set(String(k.name).split(/\s+/).map(stem))) if (ws.has(w)) n++;
      if (n > bestN) { bestN = n; best = k.cat; }
    }
    if (best && bestN >= 1) return best;
    for (const [re, c] of CAT_RULES) if (re.test(name)) return c;
    return null;
  }

  const letters = s => String(s).replace(/[^а-яіїєґa-z]/gi, '').length;

  // Назва, артикул і одиниця — з тексту до першого числа позиції.
  function nameParts(row, first) {
    const words = [];
    let unit = null, art = null;
    row.cells.forEach((c, ci) => {
      if (ci > first.ci) return;
      const t = ci === first.ci ? c.slice(0, first.i) : c;
      for (const tok of t.split(/\s+/)) {
        if (!tok) continue;
        if (UNIT_RE.test(low(tok))) { unit = unit || low(tok).replace(/\.$/, ''); continue; }
        if (!art && ART_RE.test(tok)) { art = tok; continue; }
        words.push(tok);
      }
    });
    for (const c of row.cells.slice(first.ci)) for (const tok of c.split(/\s+/)) if (!unit && UNIT_RE.test(low(tok))) unit = low(tok).replace(/\.$/, '');
    while (words.length && /^(№|-|[\d.,]+[.)]?)$/.test(words[0])) words.shift(); // номер рядка, код
    const name = words.join(' ').replace(/\s+/g, ' ').replace(/[;:,\s]+$/, '').trim();
    return { name, unit, art };
  }

  // Дати й час замінюємо пробілами тієї ж довжини — щоб місця в рядку не зсувались.
  const blankDates = s => s.replace(DATE_ANY, m => ' '.repeat(m.length)).replace(/(?<!\d)\d{1,2}:\d{2}(:\d{2})?(?!\d)/g, m => ' '.repeat(m.length));
  function rowNums(row) {
    const ns = [];
    row.cells.forEach((c, ci) => nums(blankDates(c)).forEach(n => {
      const b = c[n.i - 1], a = c[n.i + n.raw.length];
      n.clean = (b === undefined || /\s/.test(b)) && (a === undefined || /[\s;,]/.test(a)); // окреме число, не «5W40» чи «208L»
      ns.push(Object.assign(n, { ci }));
    }));
    // перше ціле число на початку рядка перед текстом — номер рядка
    if (ns.length && ns[0].ci === 0 && ns[0].i === 0 && /^\d{1,3}$/.test(ns[0].raw) && /^\d{1,3}\s+[^\d\s]/.test(row.cells[0] + ' ' + (row.cells[1] || ''))) ns.shift();
    return ns;
  }

  function itemFromRow(row, prevText) {
    const ns = rowNums(row);
    if (ns.length < 3) return null;
    // к-сть × ціна ≈ сума; між ними можуть бути ПДВ, сума без ПДВ, знижка (відсоток чи сума)
    const tol = s => Math.max(0.06, s * 0.001);
    let best = null;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i].v, b = ns[j].v, g = a * b;
      if (!(a > 0 && b > 0) || Math.min(a, b) > 1000 || !ns[i].clean || !ns[j].clean) continue;
      for (let k = j + 1; k < ns.length; k++) {
        const s = ns[k].v;
        let ok = Math.abs(g - s) <= tol(s);
        for (let m = j + 1; m < k && !ok; m++) {
          const d = ns[m].v;
          if (Math.abs(g - d - s) <= tol(s) || (d < 100 && Math.abs(g * (1 - d / 100) - s) <= tol(s))) ok = true;
        }
        if (ok && (!best || k > best.k || (k === best.k && i > best.i))) best = { i, j, k, a, b, s };
      }
    }
    let first, qty, price, sum;
    const K = ns.length - 1, t = ns[K].v, v = ns[K - 1].v;
    if (best && best.k === K) {
      first = ns[best.i]; qty = Math.min(best.a, best.b); price = Math.max(best.a, best.b); sum = best.s;
    } else if (K >= 2 && t > 0 && Math.abs(v - t / 6) <= 0.03 && Math.abs(ns[K - 2].v + v - t) <= 0.03) {
      // «сума без ПДВ, ПДВ 20%, сума з ПДВ» в кінці — навіть якщо ціну розмито
      const q = ns.slice(0, K - 2).find(n => n.v > 0 && n.v <= 1000);
      first = q || ns[K - 2]; sum = t;
      qty = q ? q.v : null; price = q ? Math.round(t / q.v * 100) / 100 : null;
    } else if (best && best.k >= K - 1) {
      first = ns[best.i]; qty = Math.min(best.a, best.b); price = Math.max(best.a, best.b); sum = best.s;
    } else return null;
    const { name: nm, unit: u, art } = nameParts(row, first);
    let name = nm, unit = u;
    if (letters(name) < 3 && prevText) name = (prevText + ' ' + name).trim();
    if (letters(name) < 3 || TOTAL_RE.test(low(name))) return null;
    if (unit && /^(год|род|час|н\/г|н-год|н\.год)/i.test(unit)) unit = 'н/год';
    const isWork = (unit === 'н/год') || (!art && WORK_RE.test(name));
    return { kind: isWork ? 'Робота' : 'Запчастина', name, art, qty, unit, price, sum };
  }

  // Рядок «назва … сума» без кількості й ціни (простий акт).
  function simpleItem(row) {
    const ns = rowNums(row);
    if (ns.length !== 1 || !/[.,]\d{2}$/.test(ns[0].raw)) return null;
    const last = row.cells[row.cells.length - 1];
    if (!last.trim().endsWith(ns[0].raw)) return null;
    const { name, unit, art } = nameParts(row, ns[0]);
    if (letters(name) < 5 || TOTAL_RE.test(low(name)) || /:\s*$/.test(name)) return null;
    const isWork = !art && WORK_RE.test(name);
    return { kind: isWork ? 'Робота' : 'Запчастина', name, art, qty: null, unit, price: null, sum: ns[0].v };
  }

  const DATE_ANY = /(?<!\d)\d{1,2}\s?[.\/-]\s?\d{1,2}\s?[.\/-]\s?(?:\d{4}|\d{2})(?!\d)(\s+\d{1,2}:\d{2}(:\d{2})?)?/g;
  const noDates = s => s.replace(DATE_ANY, ' ');

  // ---------- головне ----------
  // known: { sellers:[…], items:[{name,cat}] }
  function parse(rows, known = {}) {
    const texts = rows.map(r => r.text);
    const L = texts.map(low);
    const all = L.join('\n');
    const res = { items: [] };

    // тип — за важливістю; рядок, де знайдено, допомагає знайти номер і дату
    let kindRow = -1;
    for (const [re, k] of KINDS) {
      const i = L.findIndex(t => re.test(t));
      if (i >= 0) { res.kind = k; kindRow = i; break; }
    }

    // дата
    let bestD = null;
    texts.forEach((t, ri) => {
      for (const d of datesIn(t)) {
        const before = L[ri].slice(Math.max(0, d.i - 14), d.i);
        let sc = 1 - ri / Math.max(1, texts.length);
        if (ri >= kindRow && ri <= kindRow + 2 && kindRow >= 0) sc += 2;
        if (/№/.test(t)) sc += 2;
        if (/від|от|дата|date|відкрит|прибут|открыт/.test(before)) sc += 2;
        if (/народж|рожд|видан|выдан|гаранті|придатн|продан|продаж|рег\.|реєстр|регистр|випуск|1-ї|першо|друку|печат|договір|договор|довірен|доверен|попередн|візит/.test(before + ' ' + L[ri].slice(0, d.i))) sc -= 4;
        if (sc > 0 && (!bestD || sc > bestD.sc)) bestD = { v: d.v, sc };
      }
    });
    if (bestD) res.date = bestD.v;

    // номер: поруч із назвою документа, інакше будь-де (крім карток, номерних знаків тощо)
    const NUM_AT = /(?:№|\bN[oо°º]\.?|\bN(?=\s+[A-ZА-ЯІЇЄҐ]{1,4}-\d)|(?<![а-яіїєґ])номер(?![а-яіїєґ]):?)\s*([A-ZА-ЯІЇЄҐ]{0,5}[\-\s]?\d[0-9A-Za-zА-ЯІЇЄҐ\-\/]*)/i;
    const BAD_NUM = /карт|серія|серия|паспорт|свідоцтв|свидетельств|єдрпоу|едрпоу|іпн|инн|тел|iban|р\/р|договір|договор|довірен|доверен|держ|номерн|код|клієнт|клиент|двигун|двигат|кузов|vin|дисконт|закон|стор\.|документ\s*№/;
    const tryNum = ri => {
      if (ri < 0 || ri >= texts.length) return;
      const m = texts[ri].match(NUM_AT);
      if (m && /\d/.test(m[1]) && !BAD_NUM.test(L[ri].slice(0, m.index + 1))) res.number = m[1].replace(/\s/g, '').replace(/^([A-ZА-ЯІЇЄҐ]{1,3})3(?=-)/i, '$1З');
    };
    if (kindRow >= 0) for (let ri = kindRow; ri <= kindRow + 2 && !res.number; ri++) tryNum(ri);
    for (let ri = 0; ri < texts.length && !res.number; ri++) if (!BAD_NUM.test(L[ri])) tryNum(ri);

    // СТО / продавець: спершу відомі з попередніх документів
    const textC = canon(all);
    const quoted = [...all.matchAll(/["«“„]([^"»”“\n]{2,40})["»”“]/g)].map(m => canon(m[1]));
    let bestS = null;
    for (const s of (known.sellers || []).filter(x => x && x !== '—')) {
      const q = s.match(/[«"“]([^»"”]+)[»"”]/);
      const key = canon(q ? q[1] : s.split(/[,(]/)[0]);
      let sc = 0;
      if (key.length >= 3 && quoted.includes(key)) sc += 10;
      else if (key.length >= 5 && !GENERIC.has(key) && textC.includes(key)) sc += 5;
      const ws = canon(s).split(' ').filter(w => w.length >= 4 && !GENERIC.has(w) && w !== key);
      // слова з назви, що є в тексті, додають; відсутні — трохи віднімають
      const hit = ws.filter(w => textC.includes(w)).length;
      if (ws.length) sc += 3 * hit / ws.length - 0.5 * (ws.length - hit);
      if (sc >= 3 && (!bestS || sc > bestS.sc)) bestS = { s, sc };
    }
    if (bestS) res.seller = bestS.s;
    else {
      for (let ri = 0; ri < texts.length && !res.seller; ri++) {
        const t = texts[ri];
        const org = t.match(/(?<![а-яіїєґa-z])(товариство\s+з\s+обмеженою\s+відповідальністю|тов|тзов|фоп|пп|ооо|чп|фізична\s+особа[\s\-]*підприємець|приватне\s+підприємство)\s*["«“„]([^"»”“]{2,40})["»”“]/i);
        const lab = t.match(/(?:постачальник|виконавець|продавець|поставщик|исполнитель|продавец)\s*:?\s*(.{3,60})/i);
        if (org) {
          const o = org[1].toLowerCase();
          const short = o.startsWith('товариство') ? 'ТОВ' : o.startsWith('фізична') ? 'ФОП' : o.startsWith('приватне') ? 'ПП' : org[1].toUpperCase();
          res.seller = short + ' «' + org[2].trim() + '»';
        } else if (lab && letters(lab[1]) >= 3) res.seller = lab[1].trim();
      }
    }

    // пробіг: у тому ж рядку після слова або в таблиці під заголовком «Пробіг»
    const KM_RE = /пробіг|пробег|одометр|mileage/;
    const kmOf = s => {
      for (const n of nums(noDates(s))) {
        const v = Math.round(n.v);
        if (v >= 1 && v < 1e6 && !/[.,]\d{1,2}$/.test(n.raw)) return v;
      }
      return null;
    };
    for (let ri = 0; ri < rows.length && res.km == null; ri++) {
      const l = L[ri], r = rows[ri];
      if (!KM_RE.test(l) || /без\s+обмежен|без\s+огранич|гаранті/.test(l)) continue;
      const ci = r.cells.findIndex(c => KM_RE.test(low(c)));
      const after = r.cells.slice(ci).join(' ');
      let v = kmOf(after.slice(low(after).search(KM_RE)));
      if (v == null && r.xs) {
        const [x0, x1] = r.xs[ci];
        for (let k = ri + 1; k <= ri + 3 && k < rows.length && v == null; k++) {
          const rr = rows[k];
          rr.cells.forEach((c, j) => {
            if (v != null || !rr.xs) return;
            const [a0, a1] = rr.xs[j];
            if (Math.min(a1, x1) - Math.max(a0, x0) > 0) v = kmOf(c);
          });
        }
      }
      if (v != null) res.km = v;
    }

    // сума: прописом — найнадійніше, якщо таке число є й цифрами
    const docNums = new Set();
    texts.forEach(t => nums(t).forEach(n => docNums.add(Math.round(n.v * 100))));
    for (let ri = 0; ri < texts.length && res.sum == null; ri++) {
      if (!/гривн|гривен|грн/.test(L[ri])) continue;
      const v = sumInWords(texts[ri - 1] && !/\d/.test(texts[ri - 1]) ? texts[ri - 1] + ' ' + texts[ri] : texts[ri]);
      if (v && docNums.has(Math.round(v * 100))) { res.sum = v; res.sumWords = true; }
    }
    if (res.sum == null) {
      const PRI = [
        /до\s+сплати|до\s+оплати|к\s+оплате/,
        /всього\s+на\s+суму|загальна\s+сума|разом\s+з\s+пдв|всього\s+з\s+пдв|итого\s+с\s+ндс|всего\s+с\s+ндс/,
        /всього|усього|разом|итого|всего|сума\s+з\s+пдв/,
      ];
      for (const re of PRI) {
        let best = null;
        L.forEach((l, ri) => {
          if (!re.test(l) || (/прописом|без\s+знижки|без\s+скидки|без\s+пдв|без\s+ндс|знижк|скидк|роботи|матеріал|материал|запчаст/.test(l) && !/до\s+сплати/.test(l))) return;
          let ns = nums(noDates(texts[ri].slice(l.search(re)))).filter(n => n.v >= 1);
          if (!ns.length && ri + 1 < texts.length && /^[\d\s.,грн]+$/i.test(L[ri + 1].trim())) ns = nums(texts[ri + 1]).filter(n => n.v >= 1);
          if (!ns.length) return;
          const v = ns[ns.length - 1].v;
          if (!best || ri > best.ri) best = { v, ri }; // підсумок зазвичай нижче
        });
        if (best) { res.sum = best.v; break; }
      }
    }
    if (res.sum == null) { // без підписів — найбільша сума з копійками
      let mx = null;
      texts.forEach(t => nums(noDates(t)).forEach(n => { if (/[.,]\d{2}$/.test(n.raw) && n.v < 1e6 && (mx == null || n.v > mx)) mx = n.v; }));
      if (mx != null) { res.sum = mx; res.sumGuess = true; }
    }

    // позиції
    let prevText = null, last = null;
    // Рядки «назва … сума» беремо, якщо їх кілька поспіль або нижче є підсумок, рівний їхній сумі.
    const simple = rows.map(simpleItem), okSimple = [];
    for (let i = 0; i < rows.length;) {
      if (!simple[i]) { i++; continue; }
      let j = i, s = 0;
      while (j < rows.length && simple[j]) { s += simple[j].sum; j++; }
      const nx = j < rows.length ? rowNums(rows[j]) : [];
      const ok = j - i >= 2 || (nx.length > 0 && Math.abs(nx[nx.length - 1].v - s) < 0.01);
      for (let k = i; k < j; k++) okSimple[k] = ok;
      i = j;
    }
    rows.forEach((r, ri) => {
      let it = itemFromRow(r, prevText);
      if (!it && okSimple[ri]) it = simple[ri];
      if (it) {
        res.items.push(it);
        last = it; prevText = null;
        return;
      }
      const noNum = nums(r.text).length === 0 && r.text.length < 90;
      // продовження назви попередньої позиції (з малої літери)
      if (last && noNum && /^[а-яіїєґa-z]/.test(r.text.trim())) { last.name += ' ' + r.text.trim(); return; }
      last = null;
      prevText = noNum ? r.text : null;
    });
    res.items.forEach(it => { it.cat = guessCat(it.name, known.items); });
    return res;
  }

  return { rowsFromLines, parse, nums, toNum, sumInWords, datesIn, guessCat, canon };
})();
if (typeof module !== 'undefined') module.exports = OP;
