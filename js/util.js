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

  const api = { parseDateFlexible, normalizeStatus, computeStatusClientSide, esc, sanitizeCell, csvEscape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : this);
