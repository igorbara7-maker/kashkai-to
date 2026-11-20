'use strict';
// Таблиця Excel (.xlsx) з усіма даними — переглянути, роздрукувати, надіслати.
// Назад у програму таблиця не приймається: переносити дані між пристроями — через «Обмін даними».
// Файл .xlsx — це архів ZIP із кількох файлів XML; пишемо його самі, без сторонніх бібліотек і без інтернету.
const Excel = (() => {
  // ---------- оформлення ----------
  // Номери стилів клітинок (порядок збігається з XF нижче).
  const S = { text: 0, head: 1, title: 2, date: 3, km: 4, kmEst: 5, money: 6, coef: 7, wrap: 8,
    over: 9, soon: 10, nodata: 11, ok: 12, bold: 13, moneyBold: 14, note: 15, lit: 16, dec1: 17 };
  // [формат числа, шрифт, заливка, рамка, вирівнювання]
  const XF = [
    [0, 0, 0, 0, 'top'],          // text
    [0, 1, 2, 1, 'head'],         // head: жирний, заливка, лінія знизу, перенос
    [0, 2, 0, 0, ''],             // title
    [164, 0, 0, 0, 'left'],       // date дд.мм.рррр
    [3, 0, 0, 0, 'top'],          // km 12 345
    [165, 0, 0, 0, 'top'],        // kmEst ≈ 12 345
    [4, 0, 0, 0, 'top'],          // money 1 234,56
    [166, 0, 0, 0, 'top'],        // coef 0,950
    [0, 0, 0, 0, 'wrap'],         // wrap — довгий текст переноситься
    [0, 1, 3, 0, 'top'],          // over — прострочено
    [0, 1, 4, 0, 'top'],          // soon — незабаром
    [0, 0, 5, 0, 'top'],          // nodata
    [0, 0, 6, 0, 'top'],          // ok
    [0, 1, 0, 0, 'top'],          // bold
    [4, 1, 0, 0, 'top'],          // moneyBold
    [0, 3, 0, 0, ''],             // note — дрібний сірий курсив
    [2, 0, 0, 0, 'top'],          // lit — літри 12,34
    [167, 0, 0, 0, 'top'],        // dec1 — л/100 км 7,4
  ];
  const ALIGN = {
    '': '', top: '<alignment vertical="top"/>', left: '<alignment horizontal="left" vertical="top"/>',
    wrap: '<alignment vertical="top" wrapText="1"/>', head: '<alignment vertical="center" wrapText="1"/>',
  };
  const fill = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const font = (extra, sz = 11, color = '') => `<font>${extra}<sz val="${sz}"/>${color ? `<color rgb="FF${color}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`;
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="&quot;≈ &quot;#,##0;&quot;≈ -&quot;#,##0"/><numFmt numFmtId="166" formatCode="0.000"/><numFmt numFmtId="167" formatCode="0.0"/></numFmts>
<fonts count="4">${font('')}${font('<b/>')}${font('<b/>', 14)}${font('<i/>', 10, '595959')}</fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('DCE6F1')}${fill('FFC7CE')}${fill('FFEB9C')}${fill('E7E6E6')}${fill('C6EFCE')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8EA9C1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XF.length}">${XF.map(([n, fo, fi, b, a]) =>
    `<xf numFmtId="${n}" fontId="${fo}" fillId="${fi}" borderId="${b}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${ALIGN[a]}</xf>`).join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  // ---------- запис книги ----------
  const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;   // символи, яких XML не допускає
  const x = s => String(s).replace(BAD, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function col(i) { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
  const qname = n => "'" + n.replace(/'/g, "''") + "'";

  // Рядок спільних текстів (так менше важить і читається будь-якою програмою для таблиць).
  function strings() {
    const map = new Map(), list = [];
    return {
      id(s) {
        if (s.length > 32000) s = s.slice(0, 32000) + '…';
        let i = map.get(s);
        if (i == null) { i = list.length; map.set(s, i); list.push(s); }
        return i;
      },
      xml() {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${list.length}" uniqueCount="${list.length}">${
  list.map(s => `<si><t xml:space="preserve">${x(s)}</t></si>`).join('')}</sst>`;
      },
    };
  }

  // Аркуш: { name, cols: [ширини], rows: [[клітинка…]], freeze: [стовпців, рядків], filter: 'A1:G9', titleRow: n }.
  // Клітинка: null, текст, число або { v, s } (s — номер стилю).
  function sheetXml(sh, sst, first) {
    let maxC = 0;
    const rows = [];
    sh.rows.forEach((row, ri) => {
      const cells = [];
      (row || []).forEach((c, ci) => {
        let v = c, s = 0;
        if (c && typeof c === 'object') { v = c.v; s = c.s || 0; }
        if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return;
        const r = `r="${col(ci)}${ri + 1}"${s ? ` s="${s}"` : ''}`;
        cells.push(typeof v === 'number' ? `<c ${r}><v>${v}</v></c>` : `<c ${r} t="s"><v>${sst.id(String(v))}</v></c>`);
        maxC = Math.max(maxC, ci + 1);
      });
      if (cells.length) rows.push(`<row r="${ri + 1}">${cells.join('')}</row>`);
    });
    const [fx, fy] = sh.freeze || [0, 0];
    let view = `<sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}>`;
    if (fx || fy) {
      const tl = col(fx) + (fy + 1), pane = fx && fy ? 'bottomRight' : fy ? 'bottomLeft' : 'topRight';
      view += `<pane${fx ? ` xSplit="${fx}"` : ''}${fy ? ` ySplit="${fy}"` : ''} topLeftCell="${tl}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${tl}" sqref="${tl}"/>`;
    }
    view += '</sheetView>';
    const cols = (sh.cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${col(Math.max(0, maxC - 1))}${Math.max(1, sh.rows.length)}"/>
<sheetViews>${view}</sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows.join('')}</sheetData>${sh.filter ? `<autoFilter ref="${sh.filter}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }

  // sheets → Blob файлу .xlsx
  async function write(sheets, title) {
    const sst = strings();
    const xmls = sheets.map((sh, i) => sheetXml(sh, sst, i === 0));
    const names = [];
    sheets.forEach((sh, i) => {
      if (sh.filter) {
        const [a, b] = sh.filter.split(':').map(r => r.replace(/([A-Z]+)(\d+)/, '$$$1$$$2'));
        names.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${x(qname(sh.name))}!${a}:${b}</definedName>`);
      }
      if (sh.titleRow) names.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${x(qname(sh.name))}!$${sh.titleRow}:$${sh.titleRow}</definedName>`);
    });
    const n = sheets.length;
    const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const entries = [
      { name: '[Content_Types].xml', data: H + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` },
      { name: '_rels/.rels', data: H + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` },
      { name: 'docProps/core.xml', data: H + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(title || '')}</dc:title><dc:creator>Кашкай ТО</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>` },
      { name: 'xl/workbook.xml', data: H + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${names.length ? `<definedNames>${names.join('')}</definedNames>` : ''}
</workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: H + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...xmls.map((d, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: d })),
      { name: 'xl/sharedStrings.xml', data: sst.xml() },
    ];
    const zip = await Zip.write(entries);
    return new Blob([zip], { type: MIME });
  }
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ---------- дані програми → аркуші ----------
  // Дата Excel — кількість днів від 30.12.1899.
  function serial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) / 86400000 + 25569 : null;
  }
  const Dt = iso => ({ v: serial(iso), s: S.date });
  const K = (n, est) => ({ v: n == null ? null : Math.round(n), s: est ? S.kmEst : S.km });
  const Mo = n => ({ v: n == null ? null : Math.round(n * 100) / 100, s: S.money });
  const W = t => ({ v: t, s: S.wrap });
  const head = list => list.map(v => ({ v, s: S.head }));
  const yes = b => b ? 'Так' : 'Ні';
  const ST_STYLE = { over: S.over, soon: S.soon, nodata: S.nodata, ok: S.ok, state: S.text };
  const pad = n => String(n).padStart(2, '0');
  const when = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ruleName = id => { const r = DB.get(id); return r ? r.name : 'Вузол видалено'; };
  const docCode = id => { const d = DB.get(id); return d ? d.code || 'документ' : (id ? 'документ видалено' : ''); };
  // Таблиця з рядком заголовка: автофільтр по ній і заголовок на кожній друкованій сторінці.
  function table(sh, headRow, nRows, nCols) {
    sh.filter = `A${headRow}:${col(nCols - 1)}${headRow + Math.max(nRows, 1)}`;
    sh.titleRow = headRow;
    return sh;
  }

  function stanSheet(now) {
    const ctx = M.context(), v = ctx.v, list = M.allStatus(ctx);
    const cnt = k => list.filter(o => o.st === k).length;
    const rows = [
      [{ v: v.name + ' — стан на ' + U.date(ctx.today), s: S.title }],
      [{ v: [v.vin ? 'VIN ' + v.vin : '', 'вивантажено з програми «Кашкай ТО» ' + when(now), 'знак ≈ — оцінка за середнім пробігом'].filter(Boolean).join(' · '), s: S.note }],
      [],
      ['Поточний пробіг, км', K(ctx.nowKm, ctx.nowEst), null, null, 'Прострочено:', null, cnt('over')],
      ['Останній показ одометра, км', K(ctx.cur && ctx.cur.km), null, null, 'Незабаром:', null, cnt('soon')],
      ['Дата останнього показу', Dt(ctx.cur && ctx.cur.date), null, null, 'Немає даних:', null, cnt('nodata')],
      ['Середній пробіг, км на рік', K(ctx.r ? ctx.r * 365 : null)],
      ['Попереджати за, км', K(v.warnKm)],
      ['Попереджати за, днів', v.warnDays],
      [],
      head(['Вузол / операція', 'Що робити', 'Інтервал, км', 'Інтервал, міс', 'Востаннє: дата', 'Востаннє: пробіг',
        'Наступне: пробіг', 'Наступне: дата', 'Залишилось, км', 'Орієнтовно настане (що раніше)', 'Залишилось, днів', 'Стан', 'Примітка']),
    ];
    const hr = rows.length;
    for (const o of list) {
      rows.push([W(o.rule.name), o.rule.action, K(o.rule.km), o.rule.months || null, Dt(o.lastDate), K(o.lastKm, o.lastKmEst),
        K(o.nextKm), Dt(o.nextDate), K(o.remKm, o.remKmEst), Dt(o.dueDate), K(o.remDays),
        { v: M.ST[o.st], s: ST_STYLE[o.st] }, W(o.rule.note)]);
    }
    return table({ name: 'Стан ТО', rows, freeze: [1, hr], cols: [36, 16, 11, 9, 12, 12, 12, 12, 12, 14, 11, 14, 50] }, hr, list.length, 13);
  }

  function zhurnalSheet() {
    const ws = M.works();
    const rows = [head(['Дата', 'Пробіг, км', 'Вузол / розділ', 'Що зроблено', "Запчастини / артикул / об'єм", 'Документ', 'Примітка'])];
    for (const w of ws) rows.push([Dt(w.date), K(w.km, w.kmEst), W(ruleName(w.rule)), W(w.what), W(w.parts), docCode(w.doc), W(w.note)]);
    return table({ name: 'Журнал робіт', rows, freeze: [0, 1], cols: [12, 11, 30, 40, 34, 10, 40] }, 1, ws.length, 7);
  }

  function docsSheet() {
    const ds = M.docs();
    const rows = [head(['№', 'Дата', 'Пробіг, км', 'СТО / продавець', 'Тип документа', 'Номер', 'Скан (файл, сторінки)', 'Сума, грн',
      'У витратах', 'Що це / рекомендації механіка', 'Рік', 'Сума позицій, грн', 'Поправка (знижка, ПДВ)', 'Фото, шт.'])];
    for (const d of ds) {
      const t = M.docTotal(d);
      rows.push([d.code, Dt(d.date), K(d.km, d.kmEst), W(d.seller), d.kind, d.number, W(d.scan), Mo(t.total), yes(d.count), W(d.about),
        d.date ? +d.date.slice(0, 4) : null, Mo(t.itemsSum || null), { v: t.itemsSum ? Math.round(t.coef * 1000) / 1000 : null, s: S.coef },
        DB.filesOf(d.id).length || null]);
    }
    return table({ name: 'Документи', rows, freeze: [1, 1], cols: [7, 12, 11, 30, 18, 15, 24, 12, 10, 60, 7, 12, 11, 8] }, 1, ds.length, 14);
  }

  function itemsSheet() {
    const rows = [head(['Документ', 'Дата', 'Вид', 'Категорія', 'Найменування', 'Артикул', 'К-сть', 'Од.', 'Ціна', 'Сума в документі',
      'Сума фактична, грн', 'У витратах', 'Рік'])];
    let n = 0;
    for (const d of M.docs()) {
      const { coef } = M.docTotal(d);
      for (const i of d.items || []) {
        rows.push([d.code, Dt(d.date), i.kind, W(i.cat), W(i.name), i.art, i.qty ?? null, i.unit, Mo(i.price), Mo(i.sum),
          Mo(i.sum != null && coef ? i.sum * coef : null), yes(d.count), d.date ? +d.date.slice(0, 4) : null]);
        n++;
      }
    }
    return table({ name: 'Позиції', rows, freeze: [0, 1], cols: [10, 12, 12, 26, 50, 16, 7, 6, 11, 12, 13, 10, 7] }, 1, n, 13);
  }

  function costsSheet() {
    const ys = M.expenses().slice().reverse();   // за зростанням років
    const rows = [
      [{ v: 'Витрати на обслуговування', s: S.title }],
      [{ v: 'Лише документи з позначкою «у витратах». Позиції перераховано з поправкою на знижку чи ПДВ, щоб разом вийшла сума документа.', s: S.note }],
      [],
      head(['Рік', 'ТО і ремонт, грн', 'Документів', 'Пробіг за рік, км', 'ТО і ремонт: грн на 1000 км', 'Пальне, грн', 'Пальне, л', 'Разом утримання, грн', 'Примітка']),
    ];
    for (const y of ys) {
      const note = [y.kmEst ? 'пробіг — оцінка між показами' : '', y.kmFirst ? 'неповний рік: облік з ' + U.date(y.kmFrom) : y.kmNow ? 'рік ще триває' : '',
        y.count ? '' : 'документів немає'].filter(Boolean).join('; ');
      rows.push([y.year, Mo(y.total), y.count, K(y.km), Mo(y.km && y.total ? y.total / y.km * 1000 : null),
        Mo(y.fuelN ? y.fuel : null), { v: y.fuelN ? Math.round(y.fuelL * 100) / 100 : null, s: S.lit }, Mo(y.total + y.fuel), note || null]);
    }
    const all = ys.reduce((a, y) => a + y.total, 0), cnt = ys.reduce((a, y) => a + y.count, 0);
    const fuel = ys.reduce((a, y) => a + y.fuel, 0), fuelL = ys.reduce((a, y) => a + y.fuelL, 0);
    const mb = n => ({ v: Math.round(n * 100) / 100, s: S.moneyBold });
    rows.push([{ v: 'Разом', s: S.bold }, mb(all), { v: cnt, s: S.bold }, null, null, mb(fuel), { v: Math.round(fuelL * 100) / 100, s: S.lit }, mb(all + fuel)]);
    rows.push([], [{ v: 'За категоріями', s: S.bold }]);
    const cats = {};
    ys.forEach(y => Object.entries(y.cats).forEach(([c, s]) => { cats[c] = (cats[c] || 0) + s; }));
    const order = Object.keys(cats).filter(c => cats[c] > 0.005).sort((a, b) => cats[b] - cats[a]);
    rows.push(head(['Категорія (ТО і ремонт)', ...ys.map(y => String(y.year)), 'Разом']));
    for (const c of order) {
      rows.push([W(c), ...ys.map(y => Mo(y.cats[c] > 0.005 ? y.cats[c] : null)), { v: Math.round(cats[c] * 100) / 100, s: S.moneyBold }]);
    }
    rows.push([{ v: 'Разом', s: S.bold }, ...ys.map(y => ({ v: Math.round(y.total * 100) / 100, s: S.moneyBold })), { v: Math.round(all * 100) / 100, s: S.moneyBold }]);
    return { name: 'Витрати', rows, freeze: [1, 0], cols: [34, ...Array(Math.max(8, ys.length + 1)).fill(13)] };
  }

  function fuelSheet() {
    const fs = M.fuels();
    const rows = [
      [{ v: 'Пальне', s: S.title }],
      [{ v: 'До повного бака не заправлялись, тому витрата рахується за період: літри, залиті після першої заправки з пробігом і до останньої, ÷ пробіг між ними. Що довший період — то точніше.', s: S.note }],
      [],
      head(['Період', 'Л на 100 км', 'Грн на 1 км', 'Пробіг, км', 'Літрів', 'Сума, грн', 'Заправок', 'З', 'По', 'Примітка']),
    ];
    for (const p of P.periods()) {
      const u = p.u;
      rows.push(u ? [p.name, { v: Math.round(u.per100 * 10) / 10, s: S.dec1 }, Mo(u.perKm), K(u.km), { v: Math.round(u.litres * 100) / 100, s: S.lit },
        Mo(u.sum), u.n, Dt(u.from), Dt(u.to), u.approx ? 'приблизно — ще мало заправок' : null] : [p.name, null, null, null, null, null, null, null, null, 'мало даних']);
    }
    rows.push([]);
    const hr = rows.length + 1;
    rows.push(head(['Дата', 'Пробіг, км', 'Літрів', 'Ціна, грн/л', 'Сума, грн', 'Пальне', 'АЗС', 'Попередню не записано', 'Примітка', 'Фото чека, шт.']));
    for (const f of fs) {
      rows.push([Dt(f.date), K(f.km), { v: Math.round(P.litres(f) * 100) / 100, s: S.lit }, Mo(f.price), Mo(f.sum), f.fuel, W(f.station),
        f.missed ? 'Так' : null, W(f.note), DB.filesOf(f.id).length || null]);
    }
    return table({ name: 'Пальне', rows, freeze: [0, hr], cols: [12, 11, 10, 11, 12, 10, 16, 12, 40, 9] }, hr, fs.length, 10);
  }

  function probihSheet() {
    const os = M.odos();
    const rows = [head(['Дата', 'Пробіг, км', 'Звідки'])];
    for (const o of os) rows.push([Dt(o.date), K(o.km, o.kmEst), W(o.src)]);
    return table({ name: 'Пробіг', rows, freeze: [0, 1], cols: [12, 12, 44] }, 1, os.length, 3);
  }

  function reglamentSheet() {
    const rs = M.rules();
    const rows = [head(['№', 'Вузол / операція', 'Що робити', 'Інтервал, км', 'Інтервал, міс', 'Важкі умови', 'Джерело', 'Примітка', 'Вид'])];
    rs.forEach((r, i) => rows.push([i + 1, W(r.name), r.action, K(r.km), r.months || null, W(r.heavy), W(r.source), W(r.note),
      r.group ? 'Розділ журналу' : 'Обслуговування']));
    return table({ name: 'Регламент', rows, freeze: [2, 1], cols: [5, 36, 18, 12, 10, 20, 14, 60, 16] }, 1, rs.length, 9);
  }

  function notesSheet() {
    const ns = M.notes();
    const rows = [head(['Дата', 'Нотатка', 'Для майстра', 'Виконано'])];
    for (const n of ns) rows.push([Dt(n.date), W(n.text), n.master ? 'Так' : '', n.done ? 'Так' : '']);
    return table({ name: 'Нотатки', rows, freeze: [0, 1], cols: [12, 100, 12, 11] }, 1, ns.length, 4);
  }

  async function build() {
    const now = new Date();
    const v = M.vehicle();
    const sheets = [stanSheet(now), zhurnalSheet(), docsSheet(), itemsSheet(), costsSheet(), fuelSheet(), probihSheet(), reglamentSheet(), notesSheet()];
    const blob = await write(sheets, v.name + ' — облік ТО');
    const name = `кашкай_таблиця_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;
    return new File([blob], name, { type: MIME });
  }

  // ---------- екран ----------
  let busy = false;
  async function save() {
    if (busy) return;
    busy = true;
    const out = document.getElementById('excelOut');
    out.innerHTML = '<p class="muted">Готую таблицю…</p>';
    try {
      const dir = await Folder.access(true);   // дозвіл на папку питаємо одразу після натискання
      const f = await build();
      let inDir = false;
      if (dir) { try { inDir = await Folder.save(f, dir); } catch (x) { console.error(x); } }
      if (!inDir) U.download(f.name, f);
      const where = inDir ? `«Завантаження» → «${U.esc(Folder.name())}»` : '«Завантаження»';
      const phone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      out.innerHTML = `<div class="ready"><p><b>Таблицю збережено</b><br><span class="small">${U.esc(f.name)}</span><br>
        <span class="sub">${Math.max(1, Math.round(f.size / 1024))} КБ, папка ${inDir ? '«' + U.esc(Folder.name()) + '»' : '«Завантаження»'}</span></p>
        <p class="muted small">${phone
          ? `Відкрийте її ${inDir ? '' : 'з повідомлення про завантаження або '}через «Файли» → ${where}. Потрібна програма для таблиць: Excel, Google Таблиці чи WPS Office.`
          : `Відкрийте її в Excel із папки ${inDir ? '«' + U.esc(Folder.name()) + '»' : '«Завантаження»'}.`}</p></div>`;
    } catch (err) {
      console.error(err);
      out.innerHTML = `<p class="err">Не вдалося зробити таблицю: ${U.esc(err.message)}</p>`;
    } finally { busy = false; }
  }

  function screen() {
    const items = M.docs().reduce((a, d) => a + (d.items || []).length, 0);
    return {
      title: 'Таблиця Excel', back: true, html: `
      <section class="panel">
        <p>Усі дані одним файлом Excel: стан вузлів, журнал робіт, документи і їхні позиції, витрати за роками й категоріями, пальне, пробіг, регламент, нотатки.</p>
        <p class="muted small">Записів у журналі: ${M.works().length}, документів: ${M.docs().length}, позицій: ${items}, заправок: ${M.fuels().length}. Фото у таблицю не входять — вони є в копії «Обмін даними».</p>
        <p class="actions"><button class="btn" data-act="excel-save">Зберегти таблицю</button></p>
        <div id="excelOut"></div>
      </section>
      <p class="muted small">Таблиця — для перегляду, друку чи пошти. Зміни, зроблені в ній, у програму не повертаються: дані між телефоном і компом переносить «Обмін даними».</p>`,
    };
  }

  return { screen, save, build, write, S, isBusy: () => busy };
})();
