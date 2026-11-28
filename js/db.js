'use strict';
// Сховище на пристрої (IndexedDB).
// Кожен запис: { id, t: тип, u: час зміни (мс), dev: пристрій, del: true якщо видалено, ...поля }.
// Видалення не стирає запис, а лишає позначку — щоб при обміні з іншим пристроєм воно теж «доїхало».
// Фото лежать окремо (сховище files) і прив'язані до документа полем doc.
const DB = (() => {
  const NAME = 'kashkai-to', VER = 1;
  let db = null, device = '';
  const cache = new Map();   // записи
  const fcache = new Map();  // відомості про фото (без самих зображень)
  const meta = {};           // службові відомості пристрою (назва, що відомо про інші пристрої)

  // Час зміни. Не буває раніше за час останньої копії, надісланої звідси: інший пристрій вважає,
  // що має все наше до цього часу, тож зміна з «відсталим» годинником загубилася б у «лише змінах».
  function clock() { return Math.max(Date.now(), (meta.clock || 0) + 1); }

  // Нова версія запису завжди пізніша за ту, поверх якої її зроблено: інакше на пристрої з «відсталим»
  // годинником виправлення, зроблене після обміну, програло б старішій версії з іншого пристрою.
  const after = (now, prev) => Math.max(now, ((prev && prev.u) || 0) + 1);

  const p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = t => new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Запис перервано'));
  });
  const fmeta = f => { const { blob, ...m } = f; m.size = blob ? blob.size : 0; return m; };

  async function open() {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Програма відкрита ще в іншій вкладці — закрийте її.'));
    });
    db.onversionchange = () => { db.close(); location.reload(); };
    const t = db.transaction(['records', 'files', 'meta']);
    const [recs, files, mkeys, mvals] = await Promise.all([
      p(t.objectStore('records').getAll()),
      p(t.objectStore('files').getAll()),
      p(t.objectStore('meta').getAllKeys()),
      p(t.objectStore('meta').getAll()),
    ]);
    cache.clear(); recs.forEach(r => cache.set(r.id, r));
    fcache.clear(); files.forEach(f => fcache.set(f.id, fmeta(f)));
    mkeys.forEach((k, i) => { meta[k] = mvals[i]; });
    device = meta.device;
    if (!device) {
      device = U.uid().slice(0, 8);
      const w = db.transaction('meta', 'readwrite');
      w.objectStore('meta').put(device, 'device');
      await done(w);
      meta.device = device;
    }
  }

  function getMeta(key) { return meta[key]; }
  async function setMeta(key, val) {
    const w = db.transaction('meta', 'readwrite');
    w.objectStore('meta').put(val, key);
    await done(w);
    meta[key] = val;
  }

  function list(t) {
    const out = [];
    for (const r of cache.values()) if (r.t === t && !r.del) out.push(r);
    return out;
  }
  function get(id) { const r = cache.get(id); return r && !r.del ? r : null; }

  async function saveAll(recs) {
    const now = clock();
    const t = db.transaction('records', 'readwrite');
    const s = t.objectStore('records');
    for (const r of recs) {
      if (!r.id) r.id = U.uid();
      r.u = after(now, cache.get(r.id)); r.dev = device;
      s.put(r);
    }
    await done(t);
    recs.forEach(r => cache.set(r.id, r));
    return recs;
  }
  const save = r => saveAll([r]).then(a => a[0]);

  async function remove(ids) {
    const recs = [].concat(ids).map(id => cache.get(id)).filter(r => r && !r.del)
      .map(r => ({ id: r.id, t: r.t, del: true }));
    if (recs.length) await saveAll(recs);
  }

  // ---- фото ----
  async function addFile(docId, blob) {
    const now = clock();
    const f = { id: U.uid(), doc: docId, mime: blob.type || 'image/jpeg', c: now, u: now, dev: device, blob };
    const t = db.transaction('files', 'readwrite');
    t.objectStore('files').put(f);
    await done(t);
    fcache.set(f.id, fmeta(f));
    return f;
  }
  async function getFile(id) { return p(db.transaction('files').objectStore('files').get(id)); }
  function filesOf(docId) {
    return [...fcache.values()].filter(f => f.doc === docId && !f.del).sort((a, b) => a.c - b.c);
  }
  function allFiles() { return [...fcache.values()]; }
  async function removeFiles(ids) {
    const now = clock();
    const t = db.transaction('files', 'readwrite');
    const out = [];
    for (const id of [].concat(ids)) {
      const m = fcache.get(id);
      if (!m || m.del) continue;
      const f = { id, doc: m.doc, c: m.c, del: true, u: after(now, m), dev: device };
      t.objectStore('files').put(f);
      out.push(f);
    }
    await done(t);
    out.forEach(f => fcache.set(f.id, fmeta(f)));
  }

  // ---- злиття з копією з іншого пристрою ----
  // Перемагає новіша зміна; при однаковому часі — за назвою пристрою (щоб обидва боки дійшли однакового).
  function newer(a, b) {
    if (!b) return true;
    if (a.u !== b.u) return a.u > b.u;
    return String(a.dev || '') > String(b.dev || '');
  }
  // Чи візьме злиття це фото (нове або новіше за наше) — щоб не читати з копії зайвого.
  function wantsFile(f) {
    const l = fcache.get(f.id);
    if (l && l.u === f.u && l.dev === f.dev) return false;
    return newer(f, l);
  }
  async function merge(records = [], files = []) {
    const res = { added: 0, updated: 0, deleted: 0, kept: 0, same: 0, photos: 0, photosDel: 0 };
    const recOk = [], fileOk = [];
    for (const r of records) {
      if (!r || typeof r.id !== 'string' || typeof r.t !== 'string' || typeof r.u !== 'number') continue;
      const l = cache.get(r.id);
      if (l && l.u === r.u && l.dev === r.dev) { res.same++; continue; }
      if (!newer(r, l)) { res.kept++; continue; }
      recOk.push(r);
      if (r.del) { if (l && !l.del) res.deleted++; }
      else if (!l || l.del) res.added++;
      else res.updated++;
    }
    for (const f of files) {
      if (!f || typeof f.id !== 'string' || typeof f.u !== 'number') continue;
      if (!f.del && !(f.blob instanceof Blob)) continue;
      const l = fcache.get(f.id);
      if (l && l.u === f.u && l.dev === f.dev) continue;
      if (!newer(f, l)) continue;
      fileOk.push(f);
      if (!f.del) res.photos++;
      else if (l && !l.del) res.photosDel++;
    }
    if (recOk.length || fileOk.length) {
      const t = db.transaction(['records', 'files'], 'readwrite');
      recOk.forEach(r => t.objectStore('records').put(r));
      fileOk.forEach(f => t.objectStore('files').put(f));
      await done(t);
      recOk.forEach(r => cache.set(r.id, r));
      fileOk.forEach(f => fcache.set(f.id, fmeta(f)));
    }
    return res;
  }

  function allRecords() { return [...cache.values()]; }

  async function persist() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return null;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) { return null; }
  }

  return {
    open, list, get, save, saveAll, remove, merge, allRecords, persist, getMeta, setMeta, clock,
    addFile, getFile, filesOf, allFiles, removeFiles, wantsFile,
    get device() { return device; },
  };
})();
