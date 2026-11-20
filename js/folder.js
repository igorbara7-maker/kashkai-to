'use strict';
// Папка програми (напр. «Завантаження/Кашкай»): туди лягають копії й таблиці,
// а отримані файли з неї програма показує сама — не треба шукати серед усіх завантажень.
// Вибирається один раз. Працює в Chrome/Edge/Opera (на Android — Chrome від версії 132).
// Де браузер не вміє вибирати папку — усе як раніше, через «Завантаження».
const Folder = (() => {
  const KEY = 'folder', MADE = 'madeFiles', GOT = 'gotFiles';
  const RW = { mode: 'readwrite' };
  const supported = () => typeof window.showDirectoryPicker === 'function';
  const handle = () => (supported() && DB.getMeta(KEY)) || null;
  const name = () => { const h = handle(); return h ? h.name : null; };

  // Доступ до папки. ask=true — можна спитати дозволу (лише одразу після натискання кнопки).
  async function access(ask) {
    const h = handle();
    if (!h) return null;
    try {
      if (await h.queryPermission(RW) === 'granted') return h;
      if (ask && await h.requestPermission(RW) === 'granted') return h;
    } catch (x) { console.warn(x); }
    return null;
  }

  // Вікно вибору папки. null — власник передумав.
  async function choose() {
    let h;
    try { h = await window.showDirectoryPicker({ id: 'kashkai', mode: 'readwrite', startIn: 'downloads' }); }
    catch (x) { if (x && x.name === 'AbortError') return null; throw x; }
    await DB.setMeta(KEY, h);
    return h;
  }
  const forget = () => DB.setMeta(KEY, null);

  // Записати файл у папку. true — записано; false — папки немає або доступу не дали.
  async function save(file, h) {
    h = h || await access(true);
    if (!h) return false;
    const fh = await h.getFileHandle(file.name, { create: true });
    const w = await fh.createWritable();
    try { await w.write(file); await w.close(); }
    catch (x) { try { await w.abort(); } catch (y) { /* уже закрито */ } throw x; }
    return true;
  }

  // Пам'ять назв: зроблені тут (їх не пропонуємо прийняти) і вже прийняті (позначаємо).
  async function remember(key, fileName) {
    const a = (DB.getMeta(key) || []).filter(n => n !== fileName);
    a.unshift(fileName);
    await DB.setMeta(key, a.slice(0, 40));
  }
  const made = fileName => remember(MADE, fileName);
  const got = fileName => remember(GOT, fileName);
  const isMine = fileName => (DB.getMeta(MADE) || []).includes(fileName);
  const isGot = fileName => (DB.getMeta(GOT) || []).includes(fileName);

  // Файли копій у папці (без зроблених тут), найновіші спершу. null — доступу немає.
  async function copies(ask) {
    const h = await access(ask);
    if (!h) return null;
    const out = [];
    for await (const fh of h.values()) {
      if (fh.kind === 'file' && /\.(zip|json)$/i.test(fh.name) && !isMine(fh.name)) out.push(await fh.getFile());
    }
    return out.sort((a, b) => b.lastModified - a.lastModified);
  }

  return { supported, handle, name, access, choose, forget, save, made, got, isGot, copies };
})();
