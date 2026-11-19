'use strict';
// Розпізнавання фото документа: запуск фонового модуля, збирання рядків, підказки з історії.
const OCR = (() => {
  let worker = null, seq = 0;
  const wait = new Map();

  function ensure() {
    if (worker) return worker;
    worker = new Worker('js/ocr-worker.js', { type: 'module' });
    worker.onmessage = ev => {
      const { id, progress, result, error } = ev.data || {};
      const w = wait.get(id);
      if (!w) return;
      if (progress) { if (w.say) w.say(progress); return; }
      wait.delete(id);
      if (error) w.rej(new Error(error)); else w.res(result);
    };
    worker.onerror = ev => {
      ev.preventDefault();
      for (const w of wait.values()) w.rej(new Error('Модуль розпізнавання не запустився'));
      wait.clear();
      worker = null;
    };
    return worker;
  }

  function run(blob, say, opt) {
    return new Promise((res, rej) => {
      const id = ++seq;
      wait.set(id, { res, rej, say });
      ensure().postMessage({ id, blob, opt });
    });
  }

  // files: масив File/Blob (сторінки одного документа) → { rows, text, ms }
  async function recognize(files, say, opt) {
    const pages = [];
    for (let i = 0; i < files.length; i++) {
      const pre = files.length > 1 ? `Фото ${i + 1} з ${files.length}. ` : '';
      pages.push(await run(files[i], t => say && say(pre + t), opt));
    }
    const rows = pages.flatMap(p => OP.rowsFromLines(p.lines));
    return { pages, rows, text: rows.map(r => r.text).join('\n'), ms: pages.reduce((s, p) => s + p.ms, 0) };
  }

  // Що вже відомо з попередніх документів — щоб упізнати СТО і категорії.
  function known() {
    const items = [];
    for (const d of DB.list('doc')) for (const i of d.items || []) if (i.name && i.cat) items.push({ name: i.name, cat: i.cat });
    const pts = M.points();
    return { sellers: M.used('doc', 'seller'), items, kmMin: pts.length ? pts[0].km : null };
  }

  return { recognize, known };
})();
