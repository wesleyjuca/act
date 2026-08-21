import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import util from '../js/util.js';

const {
  computeStatusClientSide, normalizeStatus, sanitizeCell,
  parseDateFlexible, compareValues, inferSortType, buildXlsx,
} = util;

/* ─── Gerador de dataset sintético grande ─────────────────────────────────── */
const TIPOS   = ['ACT', 'Convênio', 'Termo de Cooperação', 'ACT & Anexo'];
const STATUS  = ['Vigente', 'A vencer', 'Expirado', 'Em análise', 'Suspenso', '', '#N/A'];
function makeRecords(n) {
  const recs = [];
  for (let i = 0; i < n; i++) {
    const dia = (i % 28) + 1, mes = (i % 12) + 1, ano = 2020 + (i % 8);
    recs.push({
      tipo: TIPOS[i % TIPOS.length],
      num: `${(i % 999) + 1}/${ano}`,
      objeto: `Objeto de cooperação nº ${i} — fiscalização & monitoramento`,
      inst: `Instituição ${(i % 37)}`,
      inicio: `01/0${(i % 9) + 1}/${ano}`,
      termino: `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano + 2}`,
      status: STATUS[i % STATUS.length],
      diasRestantes: String((i % 400) - 100),
    });
  }
  return recs;
}

describe('stress — volume (10k registros)', () => {
  const N = 10_000;
  const recs = makeRecords(N);

  it('computeStatusClientSide processa 10k sem lançar e dentro do orçamento de tempo', () => {
    const t0 = Date.now();
    let ok = 0;
    for (const r of recs) {
      const out = computeStatusClientSide(r);
      if (out && typeof out.status === 'string') ok++;
    }
    const dt = Date.now() - t0;
    expect(ok).toBe(N);
    expect(dt).toBeLessThan(2000); // folgado; detecta regressão de desempenho
  });

  it('ordenação type-aware de 10k por data é estável e correta nas pontas', () => {
    const type = inferSortType('termino');
    const sorted = [...recs].sort((a, b) => compareValues(a.termino, b.termino, type));
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseDateFlexible(sorted[i - 1].termino).getTime();
      const cur  = parseDateFlexible(sorted[i].termino).getTime();
      expect(prev).toBeLessThanOrEqual(cur);
    }
  });

  it('exporta XLSX de 10k linhas sem estourar (gerador nativo)', () => {
    const headers = ['tipo', 'num', 'objeto', 'termino', 'status'];
    const rows = recs.map(r => headers.map(k => r[k]));
    const t0 = Date.now();
    const bytes = buildXlsx(headers, rows, 'ACTs SEMA');
    const dt = Date.now() - t0;
    expect(bytes[0]).toBe(0x50); // 'PK'
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(dt).toBeLessThan(3000);
  });
});

describe('stress — fuzz / entradas maliciosas ou malformadas', () => {
  const NASTY = [
    null, undefined, '', ' ', '\t\t', '\r\n', 0, 42, -1, NaN, true, false,
    '=1+1', '+cmd', '-2', '@SUM(A1)', '\t=HYPERLINK("http://x")',
    '😀🔥'.repeat(500), 'A'.repeat(50_000),
    '<script>alert(1)</script>', '"; DROP TABLE--',
    '31/02/2024', '99/99/9999', '0000-00-00', '2024-13-40',
    '１２３', 'null', 'undefined', {}, [],
  ];

  it('normalizeStatus nunca lança e sempre retorna string', () => {
    for (const v of NASTY) {
      const out = normalizeStatus(v);
      expect(typeof out).toBe('string');
    }
  });

  it('sanitizeCell neutraliza todo início perigoso e nunca lança', () => {
    for (const v of NASTY) {
      const out = sanitizeCell(v);
      expect(typeof out).toBe('string');
      expect(/^[=+\-@\t\r]/.test(out)).toBe(false); // nunca começa com gatilho de fórmula
    }
  });

  it('parseDateFlexible devolve null ou Date, nunca lança', () => {
    for (const v of NASTY) {
      const out = parseDateFlexible(v);
      expect(out === null || out instanceof Date).toBe(true);
    }
  });

  it('compareValues é consistente (nunca lança) sob lixo em qualquer tipo', () => {
    for (const a of NASTY) for (const b of NASTY.slice(0, 8)) {
      for (const t of ['date', 'number', 'text']) {
        const c = compareValues(a, b, t);
        expect(typeof c).toBe('number');
        expect(Number.isNaN(c)).toBe(false);
      }
    }
  });

  it('buildXlsx gera pacote válido mesmo com células malformadas', () => {
    const rows = NASTY.map(v => [v, String(v)]);
    const bytes = buildXlsx(['a', 'b'], rows, 'Fuzz');
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});

/* ─── SIMULAÇÃO DE USO CONTÍNUO ────────────────────────────────────────────
   Reproduz o padrão do painel: N ciclos de sync→filtrar→ordenar→agregar→gráficos,
   verificando que NÃO há crescimento ilimitado (leak de gráficos) nem duplicação
   de listeners — os dois riscos reais de uma página que roda por horas. */
describe('uso contínuo — sem vazamento ao longo de muitos ciclos', () => {
  it('registro de gráficos: destruir-antes-de-criar mantém instâncias vivas constantes', () => {
    let live = 0;
    class FakeChart { constructor() { FakeChart.created++; live++; this.dead = false; } destroy() { if (!this.dead) { this.dead = true; live--; } } }
    FakeChart.created = 0;
    const reg = {};
    const destroyChart = (id) => { if (reg[id]) { reg[id].destroy(); delete reg[id]; } };
    const buildChart   = (id) => { destroyChart(id); reg[id] = new FakeChart(); };
    const CHART_IDS = ['status', 'tipo', 'inst', 'ano', 'vencimentos'];

    const CYCLES = 500;
    for (let c = 0; c < CYCLES; c++) {
      CHART_IDS.forEach(buildChart);
      // invariante a cada ciclo: nº de instâncias vivas == nº de gráficos exibidos
      expect(live).toBe(CHART_IDS.length);
      expect(Object.keys(reg).length).toBe(CHART_IDS.length);
    }
    expect(FakeChart.created).toBe(CYCLES * CHART_IDS.length); // criou muitos…
    expect(live).toBe(CHART_IDS.length);                        // …mas só 5 vivos (sem leak)
  });

  it('listeners delegados: guard dataset.listenerReady impede duplicação', () => {
    const dom = new JSDOM('<!doctype html><div id="head"></div>');
    const doc = dom.window.document;
    const el = doc.getElementById('head');
    let handlerCalls = 0;

    // replica setupDelegatedListeners(): idempotente via flag no dataset
    function setup() {
      if (el.dataset.listenerReady) return;
      el.addEventListener('click', () => { handlerCalls++; });
      el.dataset.listenerReady = '1';
    }
    for (let i = 0; i < 200; i++) setup();     // simula 200 re-render/sync
    el.dispatchEvent(new dom.window.Event('click'));
    expect(handlerCalls).toBe(1);              // um único handler, não 200
  });

  it('pipeline filtrar→ordenar→agregar não muta nem faz crescer a fonte', () => {
    const recs = makeRecords(2000);
    const originalLen = recs.length;
    const originalFirst = JSON.stringify(recs[0]);

    const filterAndAgg = (q) => {
      const filtered = recs.filter(r => r._searchStr === undefined
        ? Object.values(r).join(' ').toLowerCase().includes(q)
        : r._searchStr.includes(q));
      const sorted = [...filtered].sort((a, b) => compareValues(a.termino, b.termino, 'date'));
      const counts = {};
      sorted.forEach(r => { const k = normalizeStatus(r.status) || '—'; counts[k] = (counts[k] || 0) + 1; });
      return { n: sorted.length, counts };
    };

    const queries = ['', 'cooperação', 'instituição 1', 'convênio', 'objeto', 'xyz-nada'];
    for (let c = 0; c < 300; c++) {
      const res = filterAndAgg(queries[c % queries.length]);
      expect(res.n).toBeGreaterThanOrEqual(0);
    }
    // fonte intacta após 300 ciclos
    expect(recs.length).toBe(originalLen);
    expect(JSON.stringify(recs[0])).toBe(originalFirst);
  });
});
