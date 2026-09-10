import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import util from '../js/util.js';

const { nextTabTarget } = util;
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Replica o algoritmo real de _handleModalTabKey (index.html) contra um DOM jsdom real —
   mesmo padrão de "reproduzir o mecanismo com a função pura exportada" já usado em
   tests/stress.test.js para o guard de listeners delegados. Cobre a garantia central do
   focus trap: com o modal aberto, Tab/Shift+Tab NUNCA leva o foco para fora de #modal-box. */
function handleModalTabKey(doc, shiftKey) {
  const box = doc.getElementById('modal-box');
  const focusable = box ? Array.from(box.querySelectorAll(FOCUSABLE_SEL)) : [];
  if (!focusable.length) return false;
  const curIdx = focusable.indexOf(doc.activeElement);
  const targetIdx = nextTabTarget(focusable, curIdx, shiftKey);
  if (targetIdx < 0) return false;
  focusable[targetIdx].focus();
  return true;
}

function buildModalDom() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="outside-btn">Fora do modal</button>
    <div id="modal-overlay" class="open">
      <div id="modal-box">
        <button class="modal-close-btn">Fechar</button>
        <div id="modal-body">
          <a href="#" id="link1">Link 1</a>
          <button id="fav-btn">Favoritar</button>
        </div>
        <button id="modal-next">Próximo</button>
      </div>
    </div>
  </body>`);
  return dom;
}

describe('focus trap do modal — foco nunca escapa de #modal-box', () => {
  it('Tab repetido circula só entre os focáveis do modal (nunca alcança #outside-btn)', () => {
    const dom = buildModalDom();
    const doc = dom.window.document;
    doc.querySelector('.modal-close-btn').focus();

    const visited = new Set();
    for (let i = 0; i < 20; i++) { // muito mais voltas que o nº de focáveis (4) — garante wrap estável
      handleModalTabKey(doc, false);
      visited.add(doc.activeElement.id);
      expect(doc.activeElement).not.toBe(doc.getElementById('outside-btn'));
      expect(doc.getElementById('modal-box').contains(doc.activeElement)).toBe(true);
    }
    // percorreu de fato os focáveis reais do modal (não ficou preso num só)
    expect(visited.size).toBeGreaterThan(1);
  });

  it('Shift+Tab a partir do primeiro focável vai para o último (wrap) sem escapar', () => {
    const dom = buildModalDom();
    const doc = dom.window.document;
    doc.querySelector('.modal-close-btn').focus(); // primeiro focável do modal

    handleModalTabKey(doc, true);
    const focusable = Array.from(doc.getElementById('modal-box').querySelectorAll(FOCUSABLE_SEL));
    expect(doc.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it('sem elementos focáveis no modal, não lança e não move o foco', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <button id="outside-btn">Fora</button>
      <div id="modal-overlay" class="open"><div id="modal-box"><div id="modal-body">Sem dados</div></div></div>
    </body>`);
    const doc = dom.window.document;
    doc.getElementById('outside-btn').focus();
    const moved = handleModalTabKey(doc, false);
    expect(moved).toBe(false);
    expect(doc.activeElement).toBe(doc.getElementById('outside-btn'));
  });
});
