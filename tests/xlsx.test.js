import { describe, it, expect } from 'vitest';
import util from '../js/util.js';

const { buildXlsx, zipStore, crc32 } = util;

/* Extrator de ZIP store-only (method 0) — suficiente para validar o .xlsx nativo.
   Percorre os local file headers e devolve { nome: textoUTF8 }. */
function unzipStore(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out = {};
  let i = 0;
  while (i + 4 <= bytes.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    const crc    = dv.getUint32(i + 14, true);
    const csize  = dv.getUint32(i + 18, true);
    const nlen   = dv.getUint16(i + 26, true);
    const elen   = dv.getUint16(i + 28, true);
    const name   = dec.decode(bytes.subarray(i + 30, i + 30 + nlen));
    const dstart = i + 30 + nlen + elen;
    const data   = bytes.subarray(dstart, dstart + csize);
    out[name] = { text: method === 0 ? dec.decode(data) : null, crc, data };
    i = dstart + csize;
  }
  return out;
}

describe('crc32', () => {
  it('confere valores conhecidos', () => {
    const enc = new TextEncoder();
    expect(crc32(enc.encode('')) >>> 0).toBe(0x00000000);
    expect(crc32(enc.encode('123456789')) >>> 0).toBe(0xCBF43926); // vetor padrão CRC-32
  });
});

describe('zipStore', () => {
  it('gera um ZIP válido e recuperável, com CRC correto', () => {
    const enc = new TextEncoder();
    const files = [
      { name: 'a.txt', data: enc.encode('hello') },
      { name: 'dir/b.txt', data: enc.encode('mundo çãó') },
    ];
    const zip = zipStore(files);
    expect(zip[0]).toBe(0x50); // 'P'
    expect(zip[1]).toBe(0x4b); // 'K'
    const parsed = unzipStore(zip);
    expect(parsed['a.txt'].text).toBe('hello');
    expect(parsed['dir/b.txt'].text).toBe('mundo çãó');
    // CRC gravado bate com o recomputado
    expect(parsed['a.txt'].crc >>> 0).toBe(crc32(enc.encode('hello')) >>> 0);
  });
});

describe('buildXlsx (gerador nativo, sem CDN)', () => {
  const headers = ['Tipo', 'Objeto', 'Término'];
  const rows = [
    ['ACT', 'Cooperação ambiental', '31/12/2026'],
    ['Convênio', 'Fiscalização & "aspas"', '15/03/2027'],
  ];

  it('produz um pacote OOXML com as partes obrigatórias', () => {
    const xlsx = buildXlsx(headers, rows, 'ACTs SEMA');
    const p = unzipStore(xlsx);
    expect(Object.keys(p)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', '_rels/.rels',
      'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml',
    ]));
  });

  it('grava cabeçalhos e valores na planilha', () => {
    const p = unzipStore(buildXlsx(headers, rows, 'ACTs SEMA'));
    const sheet = p['xl/worksheets/sheet1.xml'].text;
    expect(sheet).toContain('Tipo');
    expect(sheet).toContain('Cooperação ambiental');
    expect(sheet).toContain('31/12/2026');
    expect(sheet).toContain('r="A1"');   // referências de célula presentes
    expect(sheet).toContain('r="C3"');   // 3 colunas x (1 header + 2 linhas)
  });

  it('escapa XML corretamente (& e aspas não quebram o arquivo)', () => {
    const sheet = unzipStore(buildXlsx(headers, rows, 'S')).text
      || unzipStore(buildXlsx(headers, rows, 'S'))['xl/worksheets/sheet1.xml'].text;
    expect(sheet).toContain('Fiscaliza');
    expect(sheet).toContain('&amp;');    // '&' escapado
    expect(sheet).toContain('&quot;');   // '"' escapado
    expect(sheet).not.toContain('& "');  // não deve haver '&' cru seguido de aspa crua
  });

  it('mantém o anti-injeção de fórmula (prefixo apóstrofo)', () => {
    const p = unzipStore(buildXlsx(['x'], [['=SUM(A1)'], ['@cmd'], ['+1'], ['-2'], ['ok']], 'S'));
    const sheet = p['xl/worksheets/sheet1.xml'].text;
    expect(sheet).toContain("&apos;=SUM(A1)");  // '=' vira '\'=' e o apóstrofo é escapado em XML
    expect(sheet).toContain("&apos;@cmd");
    expect(sheet).toContain("&apos;+1");
    expect(sheet).toContain("&apos;-2");
    expect(sheet).toContain('>ok<');            // texto normal intacto
  });

  it('nome de aba é truncado em 31 chars (limite do Excel)', () => {
    const longo = 'A'.repeat(50);
    const wb = unzipStore(buildXlsx(['x'], [['y']], longo))['xl/workbook.xml'].text;
    const m = wb.match(/name="(A+)"/);
    expect(m[1].length).toBe(31);
  });
});
