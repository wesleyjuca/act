import { describe, it, expect } from 'vitest';
import util from '../js/util.js';

const { compareValues, inferSortType } = util;

/* Ordena uma lista de objetos pela chave, replicando a lógica de applySort
   (type-aware, vazios/inválidos ao fim independente da direção). */
function sortByKey(list, key, asc = true) {
  const type = inferSortType(key);
  const blank = (v) => {
    if (v == null || String(v).trim() === '') return true;
    if (type === 'date')   return !util.parseDateFlexible(v);
    if (type === 'number') return isNaN(parseFloat(String(v).replace(/\./g, '').replace(',', '.')));
    return false;
  };
  return [...list].sort((a, b) => {
    const ba = blank(a[key]), bb = blank(b[key]);
    if (ba && bb) return 0;
    if (ba) return 1;
    if (bb) return -1;
    const cmp = compareValues(a[key], b[key], type);
    return asc ? cmp : -cmp;
  });
}

describe('inferSortType', () => {
  it('detecta colunas de data', () => {
    expect(inferSortType('inicio')).toBe('date');
    expect(inferSortType('termino')).toBe('date');
    expect(inferSortType('dataAssinatura')).toBe('date');
    expect(inferSortType('data_publicacao')).toBe('date');
  });
  it('detecta colunas numéricas', () => {
    expect(inferSortType('diasRestantes')).toBe('number');
    expect(inferSortType('dias')).toBe('number');
  });
  it('cai para texto no resto', () => {
    expect(inferSortType('objeto')).toBe('text');
    expect(inferSortType('instituicao')).toBe('text');
    expect(inferSortType('tipo')).toBe('text');
  });
});

describe('compareValues — datas (bug corrigido: ordem cronológica, não textual)', () => {
  it('ordena dd/mm/yyyy cronologicamente', () => {
    const rows = [
      { termino: '10/01/2024' }, { termino: '02/12/2025' },
      { termino: '05/03/2024' }, { termino: '01/01/2026' },
    ];
    const asc = sortByKey(rows, 'termino', true).map(r => r.termino);
    expect(asc).toEqual(['10/01/2024', '05/03/2024', '02/12/2025', '01/01/2026']);
  });
  it('a ordenação textual ingênua daria resultado ERRADO (garante que corrigimos)', () => {
    // Se comparasse como texto, "02/12/2025" viria antes de "10/01/2024".
    const rows = [{ termino: '10/01/2024' }, { termino: '02/12/2025' }];
    const asc = sortByKey(rows, 'termino', true).map(r => r.termino);
    expect(asc[0]).toBe('10/01/2024'); // cronológico, não '02/...'
  });
  it('aceita ISO e mistura BR/ISO', () => {
    const rows = [{ inicio: '2025-06-01' }, { inicio: '01/01/2024' }, { inicio: '2024-12-31' }];
    const asc = sortByKey(rows, 'inicio', true).map(r => r.inicio);
    expect(asc).toEqual(['01/01/2024', '2024-12-31', '2025-06-01']);
  });
  it('inverte na direção descendente', () => {
    const rows = [{ termino: '10/01/2024' }, { termino: '02/12/2025' }];
    const desc = sortByKey(rows, 'termino', false).map(r => r.termino);
    expect(desc).toEqual(['02/12/2025', '10/01/2024']);
  });
  it('mantém datas vazias/inválidas ao fim em ambas as direções', () => {
    const rows = [{ termino: '' }, { termino: '10/01/2024' }, { termino: 'xx' }, { termino: '02/12/2025' }];
    const asc  = sortByKey(rows, 'termino', true).map(r => r.termino);
    const desc = sortByKey(rows, 'termino', false).map(r => r.termino);
    expect(asc.slice(0, 2)).toEqual(['10/01/2024', '02/12/2025']);
    expect(asc.slice(2).every(v => v === '' || v === 'xx')).toBe(true);
    expect(desc.slice(0, 2)).toEqual(['02/12/2025', '10/01/2024']);
    expect(desc.slice(2).every(v => v === '' || v === 'xx')).toBe(true);
  });
});

describe('compareValues — números', () => {
  it('ordena por valor numérico, não lexicalmente', () => {
    const rows = [{ dias: '100' }, { dias: '9' }, { dias: '-5' }, { dias: '30' }];
    const asc = sortByKey(rows, 'dias', true).map(r => r.dias);
    expect(asc).toEqual(['-5', '9', '30', '100']);
  });
  it('aceita formato pt-BR (milhar . e decimal ,)', () => {
    expect(compareValues('1.000', '999', 'number')).toBeGreaterThan(0);
    expect(compareValues('1,5', '1,25', 'number')).toBeGreaterThan(0);
  });
});

describe('compareValues — texto', () => {
  it('usa locale pt-BR insensível a caixa/acento', () => {
    const rows = [{ n: 'Órgão' }, { n: 'abacate' }, { n: 'Banco' }];
    const asc = sortByKey(rows, 'objeto' /* text */, true);
    // ordena por chave 'objeto' inexistente → todos blank → estável; usar chave real:
    const byN = [...rows].sort((a, b) => compareValues(a.n, b.n, 'text')).map(r => r.n);
    expect(byN).toEqual(['abacate', 'Banco', 'Órgão']);
  });
});
