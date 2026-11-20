'use strict';
// Пальне: заправки, середня витрата, вартість кілометра. І нагадування в календарі телефона.
// До повного бака власник не заправляється, тож витрату однієї заправки знати не можна —
// рахуємо за період: усі залиті літри між першою і останньою заправкою з пробігом ÷ пробіг між ними.
// Невідома різниця рівня в баку (не більше об'єму бака) з часом стає малою порівняно з усім залитим.
const P = (() => {
  const e = U.esc;
  const FUELS = ['А-95', 'А-95+', 'А-98', 'А-92'];
  const STATIONS = ['WOG', 'ОККО', 'UPG', 'SOCAR', 'Shell', 'БРСМ-Нафта', 'Укрнафта', 'Укравтогаз', 'Amic'];
  const r2 = n => Math.round(n * 100) / 100;
  const dec = (n, d = 2) => n == null ? '—' : n.toLocaleString('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const lit = n => dec(n, n != null && Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2) + ' л';

  // ---------- перевірка і доповнення запису заправки ----------
  // Досить двох із трьох (літри, ціна, сума) — третє рахуємо.
  function complete(r) {
    const l = r.litres, p = r.price, s = r.sum;
    if (l != null && p != null && s == null) r.sum = r2(l * p);
    else if (l != null && s != null && p == null && l > 0) r.price = r2(s / l);
    else if (p != null && s != null && l == null && p > 0) r.litres = r2(s / p);
    if (r.litres == null || r.sum == null) { U.toast('Вкажіть хоча б два з трьох: літри, ціну за літр, суму', 4000); return false; }
    if (r.litres <= 0 || r.sum <= 0) { U.toast('Літри і сума мають бути більші за нуль', 4000); return false; }
    if (r.litres > 75 && !confirm('Літрів ' + dec(r.litres) + ' — більше, ніж уміщує бак. Можливо, помилка в цифрах. Зберегти все одно?')) return false;
    if (r.price != null && Math.abs(r.litres * r.price - r.sum) > Math.max(1, r.sum * 0.02)) {
      return confirm('Літри × ціна = ' + U.money(r2(r.litres * r.price)) + ', а сума — ' + U.money(r.sum)
        + '. Можлива помилка в цифрах (або знижка). Зберегти все одно?');
    }
    return true;
  }

  // Підказка у формі: третє значення і перевірка, поки вводять.
  function hint(form) {
    // Оцінка пробігу — на дату заправки, а не на сьогодні.
    const d = form.elements.date.value, x = d && !form.elements.km.value.trim() ? M.kmAt(d) : null;
    form.elements.km.placeholder = x ? (d === U.today() ? 'сьогодні' : 'на цю дату') + ' ≈ ' + U.int(x.km) : '';
    const g = k => U.num(form.elements[k].value);
    const l = g('litres'), p = g('price'), s = g('sum');
    const ph = (k, v) => { form.elements[k].placeholder = v == null ? '' : '≈ ' + dec(v); };
    ph('litres', p != null && s != null && l == null && p > 0 ? s / p : null);
    ph('price', l != null && s != null && p == null && l > 0 ? s / l : null);
    ph('sum', l != null && p != null && s == null ? l * p : null);
    const out = document.getElementById('fuelMsg');
    if (!out) return;
    out.textContent = l != null && p != null && s != null && Math.abs(l * p - s) > Math.max(1, s * 0.02)
      ? 'Літри × ціна = ' + U.money(r2(l * p)) + ' — не збігається із сумою. Перевірте цифри (або це знижка).' : '';
    out.hidden = !out.textContent;
  }

  // ---------- розрахунки ----------
  const litres = f => f.litres != null ? f.litres : f.sum != null && f.price ? f.sum / f.price : 0;

  // Витрата за період [from, to]. Ланцюжок рветься на заправці з позначкою «попередню не записано».
  function usage(from, to = U.today(), list = M.fuels()) {
    let L = 0, S = 0, km = 0, n = 0, start = null, accL = 0, accS = 0, accN = 0, first = null, last = null;
    for (const f of list) {
      if (!f.date || f.date < from || f.date > to) continue;
      if (f.missed) start = null;
      if (!start) { if (f.km != null) { start = f; accL = accS = accN = 0; } continue; }
      accL += litres(f); accS += f.sum || 0; accN++;
      if (f.km == null) continue;
      if (f.km > start.km) {
        L += accL; S += accS; n += accN; km += f.km - start.km;
        if (!first) first = start.date;
        last = f.date;
      }
      start = f; accL = accS = accN = 0;   // пробіг не зріс (помилка в цифрах) — починаємо звідси
    }
    if (km <= 0) return null;
    return { litres: L, sum: S, km, n, from: first, to: last, per100: L / km * 100, perKm: S / km, approx: n < 4 || km < 1500 };
  }

  // Заправлено за місяць чи рік (prefix: '2026' або '2026-11').
  function totals(prefix, list = M.fuels()) {
    const o = { n: 0, litres: 0, sum: 0 };
    for (const f of list) if ((f.date || '').startsWith(prefix)) { o.n++; o.litres += litres(f); o.sum += f.sum || 0; }
    return o;
  }

  function periods(today = U.today()) {
    return [
      { name: 'За 3 місяці', from: U.addMonths(today, -3) },
      { name: 'За рік', from: U.addMonths(today, -12) },
      { name: 'За весь час', from: '0000' },
    ].map(p => Object.assign(p, { u: usage(p.from, today) }));
  }
  const same = (a, b) => a && b && a.from === b.from && a.km === b.km;

  const usageText = u => u
    ? `<b>${u.approx ? '≈ ' : ''}${dec(u.per100, 1)} л/100 км</b> · ${dec(u.perKm)} грн/км`
      + `<div class="sub">${U.int(u.km)} км, ${lit(u.litres)}, ${U.money0(u.sum)} · ${U.date(u.from)}–${U.date(u.to)}${u.approx ? ' · приблизно, бо ще мало заправок' : ''}</div>`
    : '<span class="muted">мало даних</span>';

  // ---------- екран «Пальне» ----------
  function screen() {
    const fs = M.fuels();
    const today = U.today();
    const add = '<a class="btn" href="#/edit/fuel/new">Заправка</a>';
    if (!fs.length) {
      return {
        title: 'Пальне', back: true, html: `
        <section class="panel">
          <h2>Заправок ще немає</h2>
          <p>Записуйте кожну заправку: літри, суму (або ціну) і пробіг за одометром. Програма порахує середню витрату на 100 км і скільки коштує кілометр.</p>
          <p class="actions">${add}</p>
        </section>${howTo()}`,
      };
    }
    const ps = periods(today);
    const main = ps[1].u || ps[2].u || ps[0].u;
    const m = totals(today.slice(0, 7), fs), y = totals(today.slice(0, 4), fs);
    const lastF = fs[fs.length - 1];
    const lastPrice = lastF.price != null ? lastF.price : lastF.litres ? lastF.sum / lastF.litres : null;
    const yearAgo = fs.filter(f => f.date >= U.addMonths(today, -12));
    const yl = yearAgo.reduce((a, f) => a + litres(f), 0), ys = yearAgo.reduce((a, f) => a + (f.sum || 0), 0);
    const withKm = fs.filter(f => f.km != null).length;
    const item = f => `<a class="item" href="#/edit/fuel/${e(f.id)}"><div class="row"><b>${U.date(f.date)}</b><span class="grow"></span><b>${U.money(f.sum)}</b></div>
      <div class="sub">${lit(litres(f))}${f.price != null ? ' × ' + dec(f.price) + ' грн' : ''}${f.fuel ? ' · ' + e(f.fuel) : ''}${f.station ? ' · ' + e(f.station) : ''}</div>
      <div class="sub">${f.km != null ? U.km(f.km) : 'пробіг не вказано'}${f.missed ? ' · попередню не записано' : ''}${DB.filesOf(f.id).length ? ' · фото чека' : ''}${f.note ? ' · ' + e(f.note) : ''}</div></a>`;
    return {
      title: 'Пальне', back: true, html: `
      <section class="panel">
        <div class="row"><div class="grow">
          ${main ? `<div class="big">${main.approx ? '≈ ' : ''}${dec(main.per100, 1)} л/100 км</div>
            <div class="muted small">середня витрата ${main === ps[1].u ? 'за рік' : main === ps[2].u ? 'за весь час' : 'за 3 місяці'} · ${dec(main.perKm)} грн за 1 км (${U.money0(main.perKm * 100)} на 100 км)</div>`
          : `<div class="sub">Щоб порахувати витрату, потрібні щонайменше дві заправки з пробігом${withKm ? ' (зараз з пробігом: ' + withKm + ')' : ''}.</div>`}
        </div>${add}</div>
      </section>
      ${main ? `<section class="panel"><h3>Витрата і вартість кілометра</h3><dl class="kv">${ps.filter((p, i) => !(i === 2 && same(p.u, ps[1].u))).map(p => `<dt>${p.name}</dt><dd>${usageText(p.u)}</dd>`).join('')}</dl></section>` : ''}
      <section class="panel">
        <h3>Заправлено</h3>
        <dl class="kv">
          <dt>Цього місяця</dt><dd>${m.n ? lit(m.litres) + ' · ' + U.money0(m.sum) + ' · ' + m.n + ' ' + U.plural(m.n, 'заправка', 'заправки', 'заправок') : 'ще не заправлялись'}</dd>
          <dt>Цього року</dt><dd>${lit(y.litres)} · ${U.money0(y.sum)} · ${y.n} ${U.plural(y.n, 'заправка', 'заправки', 'заправок')}</dd>
          <dt>Ціна літра</dt><dd>остання ${lastPrice != null ? dec(lastPrice) + ' грн' : '—'}${yl ? ' · середня за рік ' + dec(ys / yl) + ' грн' : ''}</dd>
        </dl>
      </section>
      <h3 class="sec">Заправки (${fs.length})</h3>
      <div class="list">${fs.slice().reverse().map(item).join('')}</div>
      ${howTo()}`,
    };
  }

  function howTo() {
    return `<details class="panel"><summary><b>Як рахується витрата</b></summary>
      <p class="small">До повного бака заправлятися не потрібно. Витрату видно не з однієї заправки, а за період: усі літри, залиті після першої заправки періоду і до останньої, ділимо на пробіг між ними. Що більше заправок і довший період — то точніше: за 4–5 заправок похибка вже невелика, за кілька місяців — майже нульова.</p>
      <p class="small">Тому щоразу вказуйте пробіг за одометром. Якщо чек загубився і заправку не записано — у наступній позначте «Попередню заправку не записано», щоб не зіпсувати розрахунок.</p>
      <p class="small muted">Пробіг із заправок іде й у строки ТО — що частіше заправляєтесь, то точніші строки.</p></details>`;
  }

  // ---------- нагадування в календарі ----------
  const pad = n => String(n).padStart(2, '0');
  const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
  function nextDate(m, d, today = new Date()) {   // найближче m-го місяця d-го числа (сьогодні теж годиться)
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let x = new Date(t.getFullYear(), m - 1, d);
    if (x < t) x = new Date(t.getFullYear() + 1, m - 1, d);
    return x;
  }
  function nextFirst(today = new Date()) {
    return today.getDate() === 1 ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth() + 1, 1);
  }
  function events() {
    const url = appUrl();
    return [
      { id: 'probih', title: 'Кашкай — записати пробіг', when: 'Щомісяця 1-го о 9:00 — записати пробіг', start: nextFirst(),
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', text: 'Запишіть пробіг за одометром у програму «Кашкай ТО»: ' + url + '#/edit/odo/new' },
      { id: 'shyny-lito', title: 'Кашкай — поставити літні шини', when: 'Щороку 1 квітня — поставити літні шини', start: nextDate(4, 1),
        rrule: 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=1', text: 'Сезонна заміна шин: до кінця квітня поставити літні. Після заміни — запис у програмі «Кашкай ТО»: ' + url },
      { id: 'shyny-zyma', title: 'Кашкай — поставити зимові шини', when: 'Щороку 15 жовтня — поставити зимові шини', start: nextDate(10, 15),
        rrule: 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=15', text: 'Сезонна заміна шин: до 15 листопада поставити зимові. Після заміни — запис у програмі «Кашкай ТО»: ' + url },
    ].map(ev => { ev.start.setHours(9, 0, 0, 0); return ev; });
  }
  const stamp = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  const endOf = d => new Date(d.getTime() + 15 * 60000);

  // Посилання Google Календаря з готовою повторюваною подією (час — місцевий, календаря власника).
  function gcal(ev) {
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.title)
      + '&dates=' + stamp(ev.start) + '/' + stamp(endOf(ev.start))
      + '&recur=' + encodeURIComponent('RRULE:' + ev.rrule) + '&details=' + encodeURIComponent(ev.text);
  }

  // Файл .ics (Outlook на компі, інші календарі): ті самі події з нагадуванням.
  function icsText() {
    const now = new Date();
    const utc = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const t = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    // Рядки довші за 75 байтів переносяться (кирилиця — 2 байти на літеру).
    const fold = line => {
      const out = []; let cur = '', bytes = 0;
      for (const ch of line) {
        const b = new TextEncoder().encode(ch).length;
        if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
        cur += ch; bytes += b;
      }
      out.push(cur);
      return out.join('\r\n ');
    };
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kashkai TO//UK', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const ev of events()) {
      L.push('BEGIN:VEVENT', 'UID:kashkai-to-' + ev.id + '@kashkai-to', 'DTSTAMP:' + utc,
        'DTSTART:' + stamp(ev.start), 'DTEND:' + stamp(endOf(ev.start)), 'RRULE:' + ev.rrule,
        'SUMMARY:' + t(ev.title), 'DESCRIPTION:' + t(ev.text), 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + t(ev.title), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function ics() {
    U.download('кашкай_нагадування.ics', new Blob([icsText()], { type: 'text/calendar;charset=utf-8' }));
    U.toast('Файл збережено в «Завантаження» — відкрийте його, і календар додасть нагадування', 5000);
  }

  function calendarPanel() {
    return `<section class="panel">
      <h3>Нагадування в календарі</h3>
      <p class="small">Програма працює без інтернету й сервера, тож сама «задзвонити» в певний день не може. Натисніть потрібний пункт один раз (з інтернетом) — відкриється Google Календар із уже заповненою подією, натисніть «Зберегти». Далі календар нагадуватиме сам, навіть без програми. У нагадуванні є посилання, що відкриває програму.</p>
      <div class="list">${events().map(ev => `<a class="item" href="${e(gcal(ev))}" target="_blank" rel="noopener"><b>${e(ev.when)}</b><div class="sub">Додати в Google Календар · уперше ${U.date(U.iso(ev.start))}</div></a>`).join('')}</div>
      <p class="actions"><button type="button" class="btn ghost" data-act="ics">Файл для Outlook (.ics)</button></p>
      <p class="muted small">Файл .ics — для Outlook на компі чи іншого календаря: усі три нагадування одразу. Якщо подію вже додано — повторно не додавайте, бо нагадування задвоїться.</p>
    </section>`;
  }

  return { FUELS, STATIONS, complete, hint, usage, totals, periods, litres, screen, calendarPanel, ics, icsText, gcal, events, dec, lit };
})();
