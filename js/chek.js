'use strict';
// Читання касового чека АЗС: рядки розпізнаного тексту → літри, сума, ціна, дата, пальне, АЗС.
// Розпізнавання плутає цифри й літери, тому кожне значення звіряємо з іншими місцями чека:
//   сума — «ДО СПЛАТИ», «БЕЗГОТІВКОВА», «СУМА» (беремо те, що повторюється);
//   сума до знижки = сума + знижка; літри й ціна — такі, щоб літри × ціна дали саме цю суму до знижки.
const Chek = (() => {
  const r2 = n => Math.round(n * 100) / 100;
  const LAT = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'і', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
  const low = s => String(s).toLowerCase().replace(/[a-z]/g, c => LAT[c] || c);

  // Числа з двома знаками після коми: 3439,60 · 3519.60 · «251970» (кома загубилась) — теж, якщо це ціле число з 5–6 цифр.
  function money(s) {
    const out = [];
    for (const m of String(s).matchAll(/(\d[\d\s]{0,6}?)[.,:]\s?(\d{2})(?!\d)/g)) out.push(+(m[1].replace(/\s/g, '') + '.' + m[2]));
    return out;
  }

  // Скільки місць рядка збігається з числом (справа наліво) — міра схожості з тим, що прочитало розпізнавання.
  function sim(num, raw, dec = 2) {
    if (!raw) return 0;
    const a = num.toFixed(dec).replace(/\D/g, ''), b = String(raw).replace(/\D/g, '');
    let n = 0;
    for (let i = 1; i <= Math.min(a.length, b.length); i++) if (a[a.length - i] === b[b.length - i]) n++;
    return n / Math.max(a.length, 1);
  }

  const dateOk = (d, m, y) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2015 && y <= 2100;

  function parseDate(rows, today) {
    const found = [];
    for (const t of rows) {
      let m = t.match(/(\d{2})\.(\d{2})\.(20\d{2})\s*\D?\s*(\d{2})[-:.](\d{2})[-:.](\d{2})/) || t.match(/(\d{2})\.(\d{2})\.(20\d{2})/);
      if (!m) m = t.match(/(\d{2})(\d{2})\.(20\d{2})\s+\d{2}[-:.]\d{2}[-:.]\d{2}/); // загубилась крапка між днем і місяцем
      if (!m) continue;
      const d = +m[1], mo = +m[2], y = +m[3];
      if (!dateOk(d, mo, y)) continue;
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (today && iso > today) continue;
      found.push(iso);
    }
    return found[0] || null;
  }

  function parseFuel(rows) {
    for (const t of rows) {
      const l = low(t);
      if (!/(бензин|дизел|пальне|газ\b|а-?\s?9|а-?\s?10)/.test(l) && !/[a-zа-я]-?\s?9[258]/i.test(t)) continue;
      if (/дизел|\bдп\b|дт\b/.test(l)) return 'ДП';
      if (/газ|lpg|пропан/.test(l) && !/газуват/.test(l)) return 'Газ';
      const g = t.match(/9[258]|100/);
      if (!g) continue;
      const plus = /[pр]\s*[1lл|]\s*[uuи]/i.test(t) || /преміум|premium|\+/i.test(t);
      return 'А-' + g[0] + (plus && g[0] === '95' ? '+' : '');
    }
    return null;
  }

  const BRANDS = [
    [/(смар|смз?р).*(па[уе]|ер)|па[уе]ер/, 'Євро Смарт Пауер'],
    [/\bwog\b|вог/, 'WOG'], [/окко|okko/, 'ОККО'], [/\bupg\b|упг/, 'UPG'], [/socar|сокар/, 'SOCAR'], [/shell|шелл/, 'Shell'],
    [/брсм/, 'БРСМ-Нафта'], [/укрнафт/, 'Укрнафта'], [/укравтогаз/, 'Укравтогаз'], [/\bamic\b|аміс/, 'Amic'], [/klo|кло/, 'KLO'],
  ];
  function parseStation(rows) {
    const head = rows.slice(0, 7).map(low).join(' | ');
    for (const [re, name] of BRANDS) if (re.test(head)) return name;
    return null;
  }

  // Усе разом. Повертає { litres, sum, price, priceList, discount, date, fuel, station, ok, notes }.
  function parse(rows, today) {
    const R = rows.map(r => (typeof r === 'string' ? r : r.text)).filter(Boolean);
    const L = R.map(low);
    const notes = [];

    // сума до сплати — що повторюється серед «до сплати / безготівкова / сума»
    const cand = [];
    R.forEach((t, i) => {
      const k = /до\s*спл|д0\s*спл|спат|безгот|безгот|^\s*сума|суma|cyma|сума/.test(L[i]) || /^\s*cyma/i.test(t);
      if (!k || /пдв|ждв|\*а|знижк|жка/.test(L[i])) return;
      for (const v of money(t)) if (v > 1 && v < 100000) cand.push({ v, w: /до\s*спл|д0\s*спл|спат/.test(L[i]) ? 1.2 : 1 });
      // «251970»: кома загубилась
      const m = t.match(/(?:cyma|сума|суmа)\D*(\d{4,6})\b(?![.,]\d)/i);
      if (m) cand.push({ v: +(m[1].slice(0, -2) + '.' + m[1].slice(-2)), w: 0.6 });
    });
    // знижка і рядок «ціна × літри … сума до знижки»
    let disc = 0, row = null;
    R.forEach((t, i) => {
      if (/^\s*[з3]\s*[нh]\s*[иi]/i.test(L[i]) || /знижк/.test(L[i])) {
        const ns = money(t); if (ns.length) disc = ns[ns.length - 1];
      }
      const m = t.match(/(\d+[.,]\d{2})\s*[x×хХ*]\s*(\d*[.,]?\d*)\s*\S*\s+(\d+[.,]\d{2})\s*-?\s*[АAА]?\s*$/);
      if (m && !row) row = { pl: m[1], l: m[2], g: +m[3].replace(',', '.') };
    });
    const tally = new Map();
    for (const c of cand) tally.set(c.v, (tally.get(c.v) || 0) + c.w);
    // сума мусить узгоджуватись із рядком товару: сума до знижки − знижка
    if (row) for (const [v] of tally) if (Math.abs(row.g - disc - v) < 0.006) tally.set(v, tally.get(v) + 2);
    let sum = null, best = 0;
    for (const [v, w] of tally) if (w > best) { best = w; sum = v; }
    if (sum == null && row) { sum = r2(row.g - disc); notes.push('суму виведено з рядка товару'); }
    if (sum == null) return { ok: false, notes: ['не знайдено суму'], date: parseDate(R, today), fuel: parseFuel(R), station: parseStation(R) };

    // сума до знижки
    let gross = r2(sum + disc);
    if (row && Math.abs(row.g - gross) > 0.006) notes.push('сума до знижки в рядку товару не збігається — літри можуть бути неточні');

    // ціна після знижки: рядок «ВАРТІСТЬ З УРАХУВАННЯМ ЗНИЖКИ … 85,99 ГРН./ЛІТР»
    let paRaw = null;
    R.forEach((t, i) => {
      if (paRaw == null && /(грн|гph|gph|tph|трн)\.?\s*\/\s*(літр|літ|лiтр|nitp|mitp|mltp|litp|л)/i.test(t.replace(/[Ll]/g, 'л')) || /\.\/\S*(тр|tp)\b/i.test(t)) {
        const m = t.match(/(\d{2,3})\s*[,.]\s*(\d{2})/); if (m) paRaw = m[1] + m[2];
        else { const m2 = t.match(/(\d{4,5})/); if (m2) paRaw = m2[1]; }
      }
    });

    // літри: перебір 0,01…75 л із умовою «ціна до знижки — рівно в копійках»; найближче до прочитаного — перемагає
    const lRaw = row ? row.l.replace(',', '.') : null, plRaw = row ? row.pl : null;
    let best2 = null;
    for (let c = 100; c <= 7500; c++) {
      const lit = c / 100;
      const pl = gross / lit;
      if (pl < 20 || pl > 150) continue;
      if (Math.abs(r2(pl) * lit - gross) > 0.005 || Math.abs(pl * 100 - Math.round(pl * 100)) > 1e-6) continue;
      const pa = sum / lit;
      let s = 2 * sim(lit, lRaw) + sim(r2(pl), plRaw) + (paRaw ? sim(r2(pa), paRaw) : 0);
      if (Math.abs(lit - Math.round(lit)) < 1e-9) s += 0.4;           // літри на колонці частіше цілі
      if (lit > 60) s -= 0.5;
      if (!best2 || s > best2.s) best2 = { s, lit, pl: r2(pl), pa: r2(pa) };
    }
    if (!best2) {
      // без точного збігу: літри з рядка товару, інакше сума / ціна після знижки
      const l0 = lRaw ? +lRaw : null;
      if (l0 && l0 > 1 && l0 < 100) best2 = { lit: l0, pl: r2(gross / l0), pa: r2(sum / l0) };
      notes.push('літри не вдалося звірити з сумою');
    }
    const litres = best2 ? best2.lit : null;
    const price = litres ? r2(sum / litres) : null;
    return {
      ok: litres != null, litres, sum, price, priceList: best2 ? best2.pl : null, discount: disc || 0, gross,
      date: parseDate(R, today), fuel: parseFuel(R), station: parseStation(R), notes,
    };
  }

  return { parse };
})();
if (typeof module !== 'undefined') module.exports = Chek;
