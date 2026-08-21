/* SEMA/ACT — funções utilitárias puras (testáveis, sem DOM).
   Carregado antes do script principal; exposto em window (browser) e module.exports (Node/testes). */
(function (root) {
  'use strict';

  function parseDateFlexible(s) {
    if (!s) return null;
    const br = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (br) return new Date(+br[3], +br[2] - 1, +br[1]);
    const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
    return null;
  }

  function normalizeStatus(value) {
    const st = String(value || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().replace(/\s+/g, ' ');
    if (!st) return '';
    if (st.includes('vence em 30') || st.includes('30 dias')) return 'vence em 30 dias';
    if (st.includes('a vencer') || st.includes('vencer')) return 'a vencer';
    if (st.includes('expir') || st.includes('vencido')) return 'expirado';
    if (st.includes('vigente')) return 'vigente';
    if (st.includes('analise') || st === 'em analise') return 'em análise';
    if (st.includes('aguardando')) return 'aguardando assinatura';
    if (st === 'suspenso') return 'suspenso';
    if (st === 'encerrado') return 'encerrado';
    if (st.includes('indeterminado') || st.includes('sem prazo') || st === 'prazo indeterminado') return 'prazo indeterminado';
    if (st === 'indefinido') return 'indefinido';
    return st;
  }

  function computeStatusClientSide(r) {
    const MANUAL = new Set(['em análise','aguardando assinatura','suspenso','encerrado','prazo indeterminado']);
    const termRaw = r.termino || '';
    const stNorm  = normalizeStatus(r.status || '');
    if (!termRaw) {
      if (!r.status || /^#/.test(r.status)) {
        const pi = String(r.prazoindeterminado || r.prazo_indeterminado || '').trim().toUpperCase();
        const status = pi === 'TRUE' ? 'Prazo Indeterminado' : 'Indefinido';
        return Object.assign({}, r, { status, diasRestantes: '' });
      }
      return r;
    }
    if (MANUAL.has(stNorm)) return r;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = parseDateFlexible(termRaw);
    if (!end || isNaN(end.getTime())) return r;
    const dias = Math.round((end - today) / 86400000);
    const rec = Object.assign({}, r);
    const dR = rec.diasRestantes;
    const badDias   = !dR || /^#/.test(dR) || /^\d{4}-\d{2}-\d{2}/.test(dR) || isNaN(parseInt(dR, 10));
    const badStatus = !rec.status || /^#/.test(rec.status);
    if (badDias)   rec.diasRestantes = String(dias);
    if (badStatus) {
      if (dias < 0)        rec.status = 'Expirado';
      else if (dias <= 30) rec.status = 'Vence em 30 dias';
      else if (dias <= 90) rec.status = 'A vencer';
      else                 rec.status = 'Vigente';
    }
    return rec;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* Anti-injeção de fórmula em planilhas: prefixa ' em células iniciadas por = + - @ TAB CR */
  function sanitizeCell(v) {
    const s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function csvEscape(value) {
    return `"${sanitizeCell(value).replace(/"/g, '""')}"`;
  }

  /* ─── ORDENAÇÃO TYPE-AWARE ──────────────────────────────────────────────────
     Datas em ordem cronológica, números por valor, texto por locale pt-BR.
     Valores vazios/inválidos vão sempre para o fim (independente da direção). */
  function inferSortType(key) {
    const k = String(key || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[_\s]/g, '');
    if (/^data/.test(k) || /(inicio|termino|vigenciaate|vigenciade|dataassinatura|datapublicacao|datacadastro|dataatualizacao|dtinicio|dttermino|date)/.test(k)) return 'date';
    if (/(diasrestantes|^dias$|qtd|quantidade|valor|numero$)/.test(k)) return 'number';
    return 'text';
  }

  function _numOrNull(v) {
    if (v == null || String(v).trim() === '') return null;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  /* Retorna <0, 0, >0. `type` = 'date' | 'number' | 'text'. Empties/inválidos ao fim. */
  function compareValues(a, b, type) {
    if (type === 'date') {
      const da = parseDateFlexible(a), db = parseDateFlexible(b);
      const ta = da && !isNaN(da.getTime()) ? da.getTime() : null;
      const tb = db && !isNaN(db.getTime()) ? db.getTime() : null;
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    }
    if (type === 'number') {
      const na = _numOrNull(a), nb = _numOrNull(b);
      if (na === null && nb === null) return 0;
      if (na === null) return 1;
      if (nb === null) return -1;
      return na - nb;
    }
    const sa = String(a == null ? '' : a), sb = String(b == null ? '' : b);
    return sa.localeCompare(sb, 'pt-BR', { numeric: true, sensitivity: 'base' });
  }

  /* ─── GERADOR XLSX NATIVO (self-contained, sem dependência de CDN) ───────────
     OOXML mínimo (Excel/LibreOffice) empacotado em ZIP store-only + CRC32.
     Todas as células como inlineStr (texto), com anti-injeção via sanitizeCell. */
  const _CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ _CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function _utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    // Fallback (ambientes sem TextEncoder)
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return new Uint8Array(out);
  }

  /* Monta um ZIP sem compressão (method 0) a partir de [{name, data:Uint8Array}]. */
  function zipStore(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const enc = files.map(f => ({ nameBytes: _utf8(f.name), data: f.data, crc: crc32(f.data) }));

    for (const f of enc) {
      const n = f.nameBytes.length, sz = f.data.length;
      const local = new Uint8Array(30 + n);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);   // local file header signature
      dv.setUint16(4, 20, true);           // version needed
      dv.setUint16(6, 0x0800, true);       // flags: UTF-8 filename
      dv.setUint16(8, 0, true);            // method 0 (store)
      dv.setUint16(10, 0, true);           // mod time
      dv.setUint16(12, 0x21, true);        // mod date (1980-01-01)
      dv.setUint32(14, f.crc, true);
      dv.setUint32(18, sz, true);          // compressed size
      dv.setUint32(22, sz, true);          // uncompressed size
      dv.setUint16(26, n, true);           // filename length
      dv.setUint16(28, 0, true);           // extra length
      local.set(f.nameBytes, 30);
      chunks.push(local, f.data);

      const cd = new Uint8Array(46 + n);
      const cdv = new DataView(cd.buffer);
      cdv.setUint32(0, 0x02014b50, true);  // central dir signature
      cdv.setUint16(4, 20, true);          // version made by
      cdv.setUint16(6, 20, true);          // version needed
      cdv.setUint16(8, 0x0800, true);      // flags: UTF-8
      cdv.setUint16(10, 0, true);          // method
      cdv.setUint16(12, 0, true);
      cdv.setUint16(14, 0x21, true);
      cdv.setUint32(16, f.crc, true);
      cdv.setUint32(20, sz, true);
      cdv.setUint32(24, sz, true);
      cdv.setUint16(28, n, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);     // local header offset
      cd.set(f.nameBytes, 46);
      central.push(cd);

      offset += local.length + sz;
    }

    const centralSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true);    // end of central dir signature
    edv.setUint16(8, enc.length, true);
    edv.setUint16(10, enc.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, offset, true);

    const total = offset + centralSize + end.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks)  { out.set(c, p); p += c.length; }
    for (const c of central) { out.set(c, p); p += c.length; }
    out.set(end, p);
    return out;
  }

  function _xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // remove control chars ilegais em XML
  }

  function _colLetter(n) {
    let s = '';
    n++;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function _sheetXml(matrix) {
    const rows = matrix.map((row, ri) => {
      const cells = row.map((val, ci) => {
        const ref = _colLetter(ci) + (ri + 1);
        const text = _xmlEscape(sanitizeCell(val));
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${rows}</sheetData></worksheet>`;
  }

  /* buildXlsx(headers:string[], rows:string[][], sheetName?) → Uint8Array (.xlsx válido) */
  function buildXlsx(headers, rows, sheetName) {
    const name = _xmlEscape(String(sheetName || 'Planilha').slice(0, 31)) || 'Planilha';
    const matrix = [headers || []].concat(rows || []);
    const files = [
      { name: '[Content_Types].xml', data: _utf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `</Types>`) },
      { name: '_rels/.rels', data: _utf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`) },
      { name: 'xl/workbook.xml', data: _utf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: _utf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `</Relationships>`) },
      { name: 'xl/worksheets/sheet1.xml', data: _utf8(_sheetXml(matrix)) },
    ];
    return zipStore(files);
  }

  const api = {
    parseDateFlexible, normalizeStatus, computeStatusClientSide, esc, sanitizeCell, csvEscape,
    compareValues, inferSortType, crc32, zipStore, buildXlsx,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : this);
