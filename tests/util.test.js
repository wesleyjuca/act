import { describe, it, expect } from 'vitest';
import util from '../js/util.js';

const { parseDateFlexible, normalizeStatus, computeStatusClientSide, esc, sanitizeCell, csvEscape } = util;

/* helper: data ISO deslocada N dias a partir de hoje */
function isoInDays(n) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('normalizeStatus', () => {
  it('normaliza acentos e variações para a chave canônica', () => {
    expect(normalizeStatus('Vigente')).toBe('vigente');
    expect(normalizeStatus('EM ANÁLISE')).toBe('em análise');
    expect(normalizeStatus('em analise')).toBe('em análise');
    expect(normalizeStatus('Aguardando Assinatura')).toBe('aguardando assinatura');
    expect(normalizeStatus('Vence em 30 dias')).toBe('vence em 30 dias');
    expect(normalizeStatus('A Vencer')).toBe('a vencer');
    expect(normalizeStatus('Expirado')).toBe('expirado');
    expect(normalizeStatus('vencido')).toBe('expirado');
    expect(normalizeStatus('Prazo Indeterminado')).toBe('prazo indeterminado');
    expect(normalizeStatus('sem prazo')).toBe('prazo indeterminado');
  });
  it('retorna string vazia para vazio/nulo', () => {
    expect(normalizeStatus('')).toBe('');
    expect(normalizeStatus(null)).toBe('');
    expect(normalizeStatus(undefined)).toBe('');
  });
});

describe('parseDateFlexible', () => {
  it('interpreta formato BR (dd/mm/yyyy)', () => {
    const d = parseDateFlexible('15/03/2026');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });
  it('interpreta formato ISO (yyyy-mm-dd)', () => {
    const d = parseDateFlexible('2026-03-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });
  it('retorna null para inválido/vazio', () => {
    expect(parseDateFlexible('')).toBeNull();
    expect(parseDateFlexible('abc')).toBeNull();
    expect(parseDateFlexible(null)).toBeNull();
  });
});

describe('computeStatusClientSide', () => {
  it('deriva Expirado quando término já passou', () => {
    expect(computeStatusClientSide({ termino: isoInDays(-5) }).status).toBe('Expirado');
  });
  it('deriva Vence em 30 dias', () => {
    expect(computeStatusClientSide({ termino: isoInDays(15) }).status).toBe('Vence em 30 dias');
  });
  it('deriva A vencer (31–90 dias)', () => {
    expect(computeStatusClientSide({ termino: isoInDays(60) }).status).toBe('A vencer');
  });
  it('deriva Vigente (>90 dias)', () => {
    expect(computeStatusClientSide({ termino: isoInDays(200) }).status).toBe('Vigente');
  });
  it('respeita status manual (não sobrescreve)', () => {
    const r = { termino: isoInDays(-5), status: 'Suspenso' };
    expect(computeStatusClientSide(r).status).toBe('Suspenso');
  });
  it('sem término e sem status → Indefinido', () => {
    expect(computeStatusClientSide({}).status).toBe('Indefinido');
  });
  it('sem término com prazoindeterminado TRUE → Prazo Indeterminado', () => {
    expect(computeStatusClientSide({ prazoindeterminado: 'TRUE' }).status).toBe('Prazo Indeterminado');
  });
  it('preenche diasRestantes quando ausente', () => {
    expect(computeStatusClientSide({ termino: isoInDays(10) }).diasRestantes).toBe('10');
  });
});

describe('esc', () => {
  it('escapa caracteres HTML perigosos', () => {
    expect(esc('<script>"&"</script>')).toBe('&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
  });
  it('lida com nulo/vazio', () => {
    expect(esc(null)).toBe('');
  });
});

describe('sanitizeCell / csvEscape (anti-injeção de fórmula)', () => {
  it('prefixa aspa simples em fórmulas', () => {
    expect(sanitizeCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCell('+A1')).toBe("'+A1");
    expect(sanitizeCell('-2')).toBe("'-2");
    expect(sanitizeCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('não altera texto normal', () => {
    expect(sanitizeCell('SEMA')).toBe('SEMA');
    expect(sanitizeCell('123')).toBe('123');
  });
  it('csvEscape envolve em aspas e duplica aspas internas', () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape('=cmd')).toBe(`"'=cmd"`);
  });
});
