'use strict';
// Дрібні допоміжні функції: дати, числа, екранування тексту, повідомлення.
const U = {
  esc(s) {
    return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  uid() {
    const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '')
      : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return r.slice(0, 16);
  },

  // Дати зберігаються як рядок РРРР-ММ-ДД.
  iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  today() { return U.iso(new Date()); },
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  date(s) { if (!s) return ''; const [y, m, d] = s.split('-'); return d + '.' + m + '.' + y; },
  addMonths(s, n) {
    const d = U.parse(s), day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return U.iso(d);
  },
  addDays(s, n) { const d = U.parse(s); d.setDate(d.getDate() + Math.round(n)); return U.iso(d); },
  days(a, b) { return Math.round((U.parse(b) - U.parse(a)) / 86400000); },

  // Числа: приймаємо «1 234,5» і «1234.5».
  num(v) {
    if (v == null) return null;
    const s = String(v).replace(/[\s  ]/g, '').replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  },
  int(n) { return n == null ? '' : Math.round(n).toLocaleString('uk-UA'); },
  km(n, est) { return n == null ? '—' : (est ? '≈ ' : '') + U.int(n) + ' км'; },
  money(n) {
    return n == null ? '—' : n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' грн';
  },
  money0(n) { return n == null ? '—' : Math.round(n).toLocaleString('uk-UA') + ' грн'; },
  plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  },
  daysText(n) { return U.int(n) + ' ' + U.plural(n, 'день', 'дні', 'днів'); },

  toast(msg, ms = 2600) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(U._tt);
    U._tt = setTimeout(() => t.classList.add('hidden'), ms);
  },

  download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);  // великий файл телефон пише довше
  },

  // Стискання фото документа: довга сторона до 2000 точок, JPEG.
  // rot — поворот за годинниковою стрілкою (90/180/270), якщо аркуш зняли боком чи догори ногами.
  async compressImage(file, max = 2000, q = 0.82, rot = 0) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      src = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('Не вдалося відкрити фото'));
        im.src = URL.createObjectURL(file);
      });
    }
    const w = src.width, h = src.height;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'), dw = Math.round(w * k), dh = Math.round(h * k), side = rot % 180 !== 0;
    c.width = side ? dh : dw; c.height = side ? dw : dh;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180);
    g.drawImage(src, -dw / 2, -dh / 2, dw, dh);
    if (src.close) src.close();
    return await new Promise(res => c.toBlob(res, 'image/jpeg', q));
  },
};
