// Розпізнавання тексту на фото документа — працює окремо від екрана, без інтернету.
// Моделі PaddleOCR (PP-OCRv5: пошук рядків + кириличне читання) у форматі ONNX,
// рушій — ONNX Runtime Web. Обробка повторює PaddleOCR: ті самі пороги й розміри.
import * as ort from '../vendor/ort/ort.wasm.bundle.min.mjs';

const BASE = new URL('../vendor/', import.meta.url).href;
ort.env.wasm.wasmPaths = BASE + 'ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.wasm.proxy = false;

const DET = { maxSide: 1920, thresh: 0.3, boxThresh: 0.6, unclip: 1.5, minSize: 3, maxCandidates: 1000 };
const REC = { h: 48, maxW: 3200 };

let det = null, rec = null, dict = null;

async function load(say) {
  if (det && rec && dict) return;
  say('Завантажую модель розпізнавання…');
  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  det = det || await ort.InferenceSession.create(BASE + 'ocr/det.onnx', opt);
  rec = rec || await ort.InferenceSession.create(BASE + 'ocr/rec.onnx', opt);
  if (!dict) {
    const r = await fetch(BASE + 'ocr/dict.txt');
    if (!r.ok) throw new Error('Не знайдено словник літер');
    dict = (await r.text()).replace(/\r/g, '').split('\n');
    dict.push(' ');
  }
}

// ---------- пошук рядків тексту ----------
function detInput(bmp) {
  const W = bmp.width, H = bmp.height;
  const k = Math.min(1, DET.maxSide / Math.max(W, H));
  const w = Math.max(32, Math.round(W * k / 32) * 32), h = Math.max(32, Math.round(H * k / 32) * 32);
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, n = w * h, data = new Float32Array(3 * n);
  // Порядок каналів B, G, R — як у PaddleOCR (зображення з OpenCV).
  const m = [0.485, 0.456, 0.406], s = [0.229, 0.224, 0.225];
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    data[i] = (px[j + 2] / 255 - m[0]) / s[0];
    data[n + i] = (px[j + 1] / 255 - m[1]) / s[1];
    data[2 * n + i] = (px[j] / 255 - m[2]) / s[2];
  }
  return { tensor: new ort.Tensor('float32', data, [1, 3, h, w]), w, h };
}

function hull(pts) {
  // pts: [x0,y0,x1,y1,…] → опукла оболонка (масив [x,y])
  const a = [];
  for (let i = 0; i < pts.length; i += 2) a.push([pts[i], pts[i + 1]]);
  a.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (a.length < 3) return a;
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const lo = [], up = [];
  for (const p of a) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = a.length - 1; i >= 0; i--) { const p = a[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

// Найменший повернутий прямокутник навколо точок (як cv2.minAreaRect).
function minRect(h) {
  if (h.length < 3) return null;
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i], q = h[(i + 1) % h.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (!len) continue;
    const ux = dx / len, uy = dy / len, vx = -uy, vy = ux;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const r of h) {
      const a = r[0] * ux + r[1] * uy, b = r[0] * vx + r[1] * vy;
      if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ux, uy, vx, vy, a0, a1, b0, b1 };
  }
  if (!best) return null;
  const { ux, uy, vx, vy, a0, a1, b0, b1 } = best;
  return {
    cx: ((a0 + a1) / 2) * ux + ((b0 + b1) / 2) * vx, cy: ((a0 + a1) / 2) * uy + ((b0 + b1) / 2) * vy,
    ux, uy, vx, vy, w: a1 - a0, h: b1 - b0,
  };
}

function rectPoints(r, grow = 0) {
  const hw = r.w / 2 + grow, hh = r.h / 2 + grow;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) =>
    [r.cx + a * r.ux + b * r.vx, r.cy + a * r.uy + b * r.vy]);
  // Порядок: верх-ліво, верх-право, низ-право, низ-ліво (як get_mini_boxes у PaddleOCR).
  pts.sort((p, q) => p[0] - q[0]);
  const [l1, l2] = pts[0][1] <= pts[1][1] ? [pts[0], pts[1]] : [pts[1], pts[0]];
  const [r1, r2] = pts[2][1] <= pts[3][1] ? [pts[2], pts[3]] : [pts[3], pts[2]];
  return [l1, r1, r2, l2];
}

function boxScore(prob, w, h, box) {
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (const [x, y] of box) { x0 = Math.min(x0, Math.floor(x)); x1 = Math.max(x1, Math.ceil(x)); y0 = Math.min(y0, Math.floor(y)); y1 = Math.max(y1, Math.ceil(y)); }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(h - 1, y1);
  const P = box.map(([x, y]) => [Math.round(x), Math.round(y)]);
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let inside = true, sign = 0;
    for (let i = 0; i < 4 && inside; i++) {
      const p = P[i], q = P[(i + 1) % 4];
      const c = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      if (c !== 0) { const sg = c > 0 ? 1 : -1; if (sign && sg !== sign) inside = false; else sign = sg; }
    }
    if (inside) { sum += prob[y * w + x]; n++; }
  }
  return n ? sum / n : 0;
}

function findBoxes(prob, w, h, sx, sy, W, H) {
  const n = w * h, bin = new Uint8Array(n), lab = new Uint8Array(n), stack = new Int32Array(n);
  for (let i = 0; i < n; i++) bin[i] = prob[i] > DET.thresh ? 1 : 0;
  const out = [];
  let found = 0;
  for (let s = 0; s < n && found < DET.maxCandidates; s++) {
    if (!bin[s] || lab[s]) continue;
    found++;
    let sp = 0; stack[sp++] = s; lab[s] = 1;
    const edge = [];
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      let border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (bin[q]) { if (!lab[q]) { lab[q] = 1; stack[sp++] = q; } }
        else if (!dx || !dy) border = true;
      }
      if (border) edge.push(x, y);
    }
    const r = minRect(hull(edge));
    if (!r || Math.min(r.w, r.h) < DET.minSize) continue;
    if (boxScore(prob, w, h, rectPoints(r)) < DET.boxThresh) continue;
    // Розширення рамки (unclip): для прямокутника рівно на d з кожного боку.
    const d = (r.w * r.h * DET.unclip) / (2 * (r.w + r.h));
    if (Math.min(r.w, r.h) + 2 * d < DET.minSize + 2) continue;
    const box = rectPoints(r, d).map(([x, y]) => [
      Math.min(W, Math.max(0, Math.round(x * sx))), Math.min(H, Math.max(0, Math.round(y * sy)))]);
    out.push(box);
  }
  return out;
}

// ---------- читання рядка ----------
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Вирізає рядок з фото у смужку висотою 48 точок (з поворотом за рамкою).
function crop(bmp, box) {
  let [tl, tr, br, bl] = box;
  let bw = Math.max(dist(tl, tr), dist(bl, br)), bh = Math.max(dist(tl, bl), dist(tr, br));
  if (bw < 1 || bh < 1) return null;
  if (bh / bw >= 1.5) { [tl, tr, br, bl] = [tr, br, bl, tl]; [bw, bh] = [bh, bw]; } // вертикальний напис
  const H = REC.h, rw = Math.max(1, Math.min(REC.maxW, Math.ceil(H * bw / bh)));
  const c = new OffscreenCanvas(rw, H), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  // Перетворення: точка фото → точка смужки (tl→(0,0), tr→(rw,0), bl→(0,H)).
  const ax = (tr[0] - tl[0]) / rw, ay = (tr[1] - tl[1]) / rw, bx = (bl[0] - tl[0]) / H, by = (bl[1] - tl[1]) / H;
  const det = ax * by - bx * ay;
  if (!det) return null;
  const ia = by / det, ib = -ay / det, ic = -bx / det, id = ax / det;
  g.setTransform(ia, ib, ic, id, -(ia * tl[0] + ic * tl[1]), -(ib * tl[0] + id * tl[1]));
  g.drawImage(bmp, 0, 0);
  return { px: g.getImageData(0, 0, rw, H).data, rw };
}

// Пачка смужок однієї ширини (коротші доповнюються нулями, як у PaddleOCR).
function batchTensor(cs, W) {
  const H = REC.h, n = H * W, data = new Float32Array(cs.length * 3 * n);
  cs.forEach((c, b) => {
    const o = b * 3 * n, px = c.px, rw = c.rw;
    for (let y = 0; y < H; y++) for (let x = 0; x < rw; x++) {
      const j = (y * rw + x) * 4, i = o + y * W + x;
      data[i] = px[j + 2] / 127.5 - 1;
      data[n + i] = px[j + 1] / 127.5 - 1;
      data[2 * n + i] = px[j] / 127.5 - 1;
    }
  });
  return new ort.Tensor('float32', data, [cs.length, 3, H, W]);
}

function decode(out, b) {
  const [, T, C] = out.dims, p = out.data, base = b * T * C;
  let text = '', sum = 0, cnt = 0, prev = -1;
  for (let t = 0; t < T; t++) {
    let bi = 0, bv = -Infinity;
    const o = base + t * C;
    for (let c = 0; c < C; c++) if (p[o + c] > bv) { bv = p[o + c]; bi = c; }
    if (bi !== 0 && bi !== prev) { text += dict[bi - 1] ?? ''; sum += bv; cnt++; }
    prev = bi;
  }
  return { text, score: cnt ? sum / cnt : 0 };
}

// ---------- головне ----------
async function detect(bmp) {
  const di = detInput(bmp);
  const dout = await det.run({ [det.inputNames[0]]: di.tensor });
  return findBoxes(dout[det.outputNames[0]].data, di.w, di.h, bmp.width / di.w, bmp.height / di.h, bmp.width, bmp.height);
}

async function read(bmp, boxes, say, limit = Infinity) {
  const cs = [];
  for (let i = 0; i < boxes.length && cs.length < limit; i++) { const c = crop(bmp, boxes[i]); if (c) cs.push(Object.assign(c, { i })); }
  cs.sort((a, b) => a.rw - b.rw);
  const lines = [];
  for (let k = 0; k < cs.length;) {
    const part = cs.slice(k, k + OPT.batch);
    k += part.length;
    const bw = Math.max(OPT.minW, Math.ceil(part[part.length - 1].rw / 8) * 8);
    const r = await rec.run({ [rec.inputNames[0]]: batchTensor(part, bw) });
    const out = r[rec.outputNames[0]];
    part.forEach((c, b) => {
      const d = decode(out, b);
      if (d.text.trim()) lines.push({ text: d.text.trim(), score: d.score, box: boxes[c.i], i: c.i });
    });
    if (say) say(`Читаю рядки: ${k} з ${cs.length}`);
  }
  lines.sort((a, b) => a.i - b.i);
  lines.forEach(l => delete l.i);
  return lines;
}

const flip = b => [b[2], b[3], b[0], b[1]]; // та сама рамка, прочитана «з іншого боку»
const meanScore = ls => ls.length ? ls.reduce((s, l) => s + l.score, 0) / ls.length : 0;
const WORD_RE = /[А-ЯІЇЄҐа-яіїєґ']{4,}/g;
const words = lines => lines.reduce((s, l) => s + (l.text.match(WORD_RE) || []).length, 0);
const tallShare = boxes => {
  let tall = 0;
  for (const [tl, tr, , bl] of boxes) if (dist(tl, bl) > dist(tl, tr)) tall++;
  return boxes.length ? tall / boxes.length : 0;
};

function rotate(bmp, deg) {
  const sw = deg % 180 !== 0, w = sw ? bmp.height : bmp.width, h = sw ? bmp.width : bmp.height;
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
  g.translate(w / 2, h / 2); g.rotate(deg * Math.PI / 180);
  g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return c.transferToImageBitmap();
}

async function recognize(blob, say) {
  const t0 = performance.now();
  await load(say);
  const t1 = performance.now();
  say('Шукаю рядки тексту…');
  let bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const big = Math.max(bmp.width, bmp.height);
  if (big > 4096) { // дуже велике фото — зменшуємо, щоб вистачило пам'яті телефона
    const k = 4096 / big;
    const b2 = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
    bmp.close(); bmp = b2;
  }
  let boxes = await detect(bmp), rot = 0;
  // Аркуш боком: рядки вузькі й високі — пробуємо обидва повороти на кількох рядках.
  if (boxes.length >= 3 && tallShare(boxes) > 0.5) {
    say('Аркуш лежить боком — повертаю…');
    let best = null;
    for (const deg of [90, 270]) {
      const rb = rotate(bmp, deg), bx = await detect(rb);
      const sc = meanScore(await read(rb, bx, null, 12)); // правильний бік модель читає впевненіше
      if (!best || sc > best.sc) { if (best) best.bmp.close(); best = { bmp: rb, boxes: bx, sc, deg }; } else rb.close();
    }
    bmp.close(); bmp = best.bmp; boxes = best.boxes; rot = best.deg;
  }
  const t2 = performance.now();
  // Чи не догори ногами: десять найдовших рядків читаємо звичайно і перевернутими —
  // перевернутий текст модель читає з низькою впевненістю (і «слова» виходять випадкові).
  if (boxes.length >= 6) {
    const sample = boxes.map(b => ({ b, w: dist(b[0], b[1]) })).sort((x, y) => y.w - x.w).slice(0, 10).map(x => x.b);
    const a = await read(bmp, sample, null), b = await read(bmp, sample.map(flip), null);
    if (meanScore(b) > meanScore(a) + 0.08 && words(b) >= words(a)) {
      say('Фото догори ногами — читаю перевернутим…');
      boxes = boxes.map(flip);
      rot = (rot + 180) % 360;
    }
  }
  const lines = await read(bmp, boxes, say);
  const W = bmp.width, H = bmp.height;
  bmp.close();
  const t3 = performance.now();
  return { w: W, h: H, rot, lines, ms: Math.round(t3 - t0), parts: { load: Math.round(t1 - t0), det: Math.round(t2 - t1), rec: Math.round(t3 - t2) } };
}

// По одному рядку, ширина від 320 точок — як PaddleOCR на компі (пачки й вужчі смужки
// дають ~25% швидкості, але частіше плутають літери).
const OPT = { batch: 1, minW: 320 };

self.onmessage = async ev => {
  const { id, blob, opt } = ev.data || {};
  if (opt) Object.assign(OPT, opt); // для перевірок: розмір пачки, найменша ширина
  const say = text => self.postMessage({ id, progress: text });
  try {
    const res = await recognize(blob, say);
    self.postMessage({ id, result: res });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
