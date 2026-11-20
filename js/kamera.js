'use strict';
// Розумна камера: одне фото → програма сама вирішує, чи це чек АЗС, приладка (пробіг) чи документ СТО.
// Завжди питає підтвердження: «Схоже на чек АЗС — зберегти?» Помилилась — кнопка «Ні, це документ СТО».
const Kamera = (() => {
  const e = U.esc;
  let files = [], seq = 0;

  function start(fs) {
    files = fs;
    if (location.hash === '#/kamera') App.refresh(); else location.hash = '#/kamera';
  }

  function screen() {
    if (!files.length) return { title: 'Фото', back: true, html: '<section class="panel"><p class="muted">Немає фото. Натисніть «Додати» → «Сфотографувати».</p></section>' };
    return {
      title: 'Читаю фото', back: true, html: `<section class="panel" id="camBox">
        <p class="small" id="camState">Готуюсь… перший раз довше — завантажується модуль розпізнавання.</p>
        <div class="photos" id="camPhotos"></div></section><div id="camAsk"></div>`,
      after: run,
    };
  }

  // Приладка: короткий текст, у якому є число 4–6 цифр, близьке до відомого пробігу (не менший і не стрибок угору).
  function odoGuess(rows, text) {
    if (rows.length > 14 || text.length > 160) return null;
    if (/(грн|сума|всього|сплати|акт|накладн|артикул|літр|дата|кількість)/i.test(text)) return null;
    const now = M.context().nowKm;
    const nums = [...text.matchAll(/(?<![\d.,])(\d{2,3})\s?(\d{3})(?![\d])|(?<![\d.,])(\d{4,6})(?![\d])/g)]
      .map(m => +(m[3] || (m[1] + m[2]))).filter(n => n >= 1000 && n <= 999999);
    const ok = nums.filter(n => now == null ? true : n >= now - 50 && n <= now + 30000);
    return ok.length ? Math.max(...ok.filter(n => now == null || n <= now + 30000)) : null;
  }

  async function attach(id) {
    try { for (const f of files) await DB.addFile(id, await U.compressImage(f)); } catch (x) { console.error(x); }
  }
  const toDoc = () => { F.setPending(files); location.replace('#/edit/doc/new?ocr=1'); };

  async function run() {
    const my = ++seq, st = document.getElementById('camState');
    const say = t => { if (my === seq && st && st.isConnected) st.innerHTML = t; };
    const box = document.getElementById('camPhotos');
    box.innerHTML = files.map(() => '<span class="ph"><img alt="Фото"></span>').join('');
    box.querySelectorAll('img').forEach((im, i) => { const u = URL.createObjectURL(files[i]); im.onload = im.onerror = () => URL.revokeObjectURL(u); im.src = u; });
    let r;
    try { r = await OCR.recognize(files, t => say(U.esc(t))); } catch (err) { say('Не вдалося прочитати: ' + e(err.message) + '. Відкриваю як документ.'); setTimeout(toDoc, 1200); return; }
    if (my !== seq || !st.isConnected) return;
    const ask = document.getElementById('camAsk');
    const today = U.today(), low = r.text.toLowerCase();
    const c = Chek.parse(r.rows, today);
    const isChek = c.ok && /(літр|пальн|бензин|дизел|азс|до сплати|а-?9\d|ДП)/i.test(low);
    if (isChek) {
      say('<span class="ok">Схоже на чек АЗС.</span> Звірте з чеком:');
      ask.innerHTML = `<section class="panel">
        <div class="row"><span class="grow">Дата</span><b>${e(U.date(c.date || today))}</b></div>
        <div class="row"><span class="grow">Літрів</span><b>${e(String(c.litres).replace('.', ','))}</b></div>
        <div class="row"><span class="grow">Ціна за літр</span><b>${e(String(c.price).replace('.', ','))} грн</b></div>
        <div class="row"><span class="grow">Сума</span><b>${U.money(c.sum)}</b></div>
        ${c.fuel ? `<div class="row"><span class="grow">Пальне</span><b>${e(c.fuel)}</b></div>` : ''}
        ${c.station ? `<div class="row"><span class="grow">АЗС</span><b>${e(c.station)}</b></div>` : ''}
        ${c.discount ? `<p class="small muted">Ціна — з урахуванням знижки ${U.money(c.discount)}.</p>` : ''}
        <p class="small muted">Пробіг можна вказати потім — від нього залежить розрахунок витрати.</p>
        <div class="actions"><button class="btn" id="camSaveFuel">Зберегти заправку</button>
        <button class="btn ghost" id="camNotFuel">Ні, це документ СТО</button></div></section>`;
      document.getElementById('camNotFuel').onclick = toDoc;
      document.getElementById('camSaveFuel').onclick = async () => {
        const rec = { t: 'fuel', date: c.date || today, litres: c.litres, price: c.price, sum: c.sum, fuel: c.fuel || (M.fuels().pop() || {}).fuel || 'А-95', station: c.station || null };
        if (!P.complete(rec)) return;
        const s = await DB.save(rec);
        await attach(s.id);
        U.toast('Заправку збережено');
        location.replace('#/edit/fuel/' + s.id);
      };
      return;
    }
    const km = odoGuess(r.rows, r.text);
    if (km != null) {
      say('<span class="ok">Схоже на приладку.</span> Звірте число з фото:');
      ask.innerHTML = `<section class="panel"><div class="big">${U.int(km)} км</div>
        <p class="small muted">Дата — сьогодні (${e(U.date(today))}). Джерело — «Одометр».</p>
        <div class="actions"><button class="btn" id="camSaveOdo">Зберегти пробіг</button>
        <button class="btn ghost" id="camNotOdo">Ні, це документ СТО</button></div></section>`;
      document.getElementById('camNotOdo').onclick = toDoc;
      document.getElementById('camSaveOdo').onclick = async () => {
        const pts = M.points(), last = pts.length ? pts[pts.length - 1] : null;
        if (last && km < last.km && !confirm('Це менше за останній пробіг (' + U.km(last.km) + '). Зберегти все одно?')) return;
        const s = await DB.save({ t: 'odo', date: today, km, src: 'Одометр (фото)' });
        await attach(s.id);
        U.toast('Пробіг записано');
        location.replace('#/stan');
      };
      return;
    }
    toDoc(); // чек і приладку не впізнано — як і раніше, читаємо як документ СТО
  }

  return { start, screen };
})();
