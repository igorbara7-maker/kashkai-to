'use strict';
// Архів ZIP без стискання (фото JPEG і так стиснуті): запис і читання.
// Читання розуміє й стиснені записи — якщо архів перепакувала інша програма.
// Кожен запис перевіряється за контрольною сумою: пошкоджений файл не потрапить у дані.
const Zip = (() => {
  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const enc = new TextEncoder();

  function dos(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }
  async function bytesOf(data) {
    if (typeof data === 'string') return enc.encode(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof Uint8Array) return data;
    return new Uint8Array(data);
  }

  // entries: [{ name, data: рядок | Blob | Uint8Array }] → Blob архіву.
  async function write(entries, onStep) {
    const parts = [], central = [];
    const { time, date } = dos(new Date());
    let offset = 0, i = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const bytes = await bytesOf(e.data);
      const crc = crc32(bytes), size = bytes.length;
      if (offset + size > 0xFFFFFFF0) throw new Error('Копія завелика для одного файлу (понад 4 ГБ).');
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);          // імена в UTF-8
      h.setUint16(8, 0, true);               // без стискання
      h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      // Blob кладемо сам по собі (не копію в пам'яті) — так велика копія не з'їдає пам'ять телефона.
      parts.push(h.buffer, name, e.data instanceof Blob ? e.data : bytes);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + size;
      if (onStep) onStep(++i, entries.length);
    }
    const cdSize = central.reduce((s, x) => s + x.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  async function isZip(file) {
    const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return h.length === 4 && h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4;
  }

  // Відкриває архів: повертає { names, has(name), bytes(name), text(name), blob(name, type) }.
  async function open(file) {
    const size = file.size;
    const tailLen = Math.min(size, 22 + 65535);
    const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
    let p = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
    if (p < 0) throw new Error('Файл архіву пошкоджений або неповний (можливо, передача обірвалася).');
    const count = tail.getUint16(p + 10, true), cdSize = tail.getUint32(p + 12, true), cdOff = tail.getUint32(p + 16, true);
    if (cdOff === 0xFFFFFFFF || cdOff + cdSize > size) throw new Error('Файл архіву пошкоджений або неповний.');
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const map = new Map();
    let q = 0;
    for (let i = 0; i < count; i++) {
      if (q + 46 > cd.byteLength || cd.getUint32(q, true) !== 0x02014b50) throw new Error('Файл архіву пошкоджений.');
      const flags = cd.getUint16(q + 8, true), method = cd.getUint16(q + 10, true);
      const crc = cd.getUint32(q + 16, true), csize = cd.getUint32(q + 20, true), usize = cd.getUint32(q + 24, true);
      const nl = cd.getUint16(q + 28, true), xl = cd.getUint16(q + 30, true), cl = cd.getUint16(q + 32, true);
      const lo = cd.getUint32(q + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, q + 46, nl));
      map.set(name, { flags, method, crc, csize, usize, lo });
      q += 46 + nl + xl + cl;
    }

    async function bytes(name) {
      const e = map.get(name);
      if (!e) throw new Error('У копії немає файлу ' + name);
      if (e.flags & 1) throw new Error('Архів захищено паролем — такий не підходить.');
      const h = new DataView(await file.slice(e.lo, e.lo + 30).arrayBuffer());
      if (h.byteLength < 30 || h.getUint32(0, true) !== 0x04034b50) throw new Error('Файл архіву пошкоджений.');
      const start = e.lo + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const raw = file.slice(start, start + e.csize);
      let out;
      if (e.method === 0) out = new Uint8Array(await raw.arrayBuffer());
      else if (e.method === 8 && typeof DecompressionStream === 'function') {
        out = new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      } else throw new Error('Невідомий спосіб стискання в архіві.');
      if (out.length !== e.usize || crc32(out) !== e.crc) throw new Error('Пошкоджений файл у копії: ' + name);
      return out;
    }
    return {
      names: [...map.keys()],
      has: name => map.has(name),
      bytes,
      text: async name => dec.decode(await bytes(name)),
      blob: async (name, type) => new Blob([await bytes(name)], { type: type || '' }),
    };
  }

  return { write, open, isZip, crc32 };
})();
if (typeof module !== 'undefined') module.exports = Zip;
