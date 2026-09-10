import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* Estas duas funções vivem no <script> inline de index.html (não são um módulo
   separado). Seguindo o mesmo padrão já usado em tests/stress.test.js e
   tests/focus-trap.test.js ("replicar o mecanismo real com uma cópia fiel da
   implementação"), reproduzimos aqui exatamente a lógica de _copyUrlToClipboard e
   _printWithRestore para testar o comportamento sem precisar carregar o HTML inteiro. */

function makeCopyUrlToClipboard(showToast) {
  return function _copyUrlToClipboard(url, successMsg = '🔗 Link copiado!') {
    navigator.clipboard?.writeText(url)
      .then(() => showToast(successMsg, 3000, 'success'))
      .catch(() => showToast('Copie manualmente: ' + url, 6000, 'error'));
  };
}

function _printWithRestore(prepare, restore, printFn, addListener, removeListener, setTimeoutFn) {
  prepare();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    restore();
    removeListener('afterprint', onAfterPrint);
  };
  const onAfterPrint = () => finish();
  addListener('afterprint', onAfterPrint);
  printFn();
  setTimeoutFn(finish, 1500);
  return { finish, onAfterPrint }; // exposto só para os testes disparararem manualmente
}

describe('_copyUrlToClipboard', () => {
  let showToast;
  let copyUrlToClipboard;

  beforeEach(() => {
    showToast = vi.fn();
    copyUrlToClipboard = makeCopyUrlToClipboard(showToast);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('mostra toast de sucesso com a mensagem padrão quando a cópia funciona', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    copyUrlToClipboard('https://exemplo/pagina');
    await Promise.resolve(); await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith('🔗 Link copiado!', 3000, 'success');
  });

  it('aceita mensagem de sucesso customizada', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    copyUrlToClipboard('https://exemplo/pagina', 'Copiado!');
    await Promise.resolve(); await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith('Copiado!', 3000, 'success');
  });

  it('mostra toast de erro com a URL quando a cópia falha', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) } });
    copyUrlToClipboard('https://exemplo/pagina');
    await Promise.resolve(); await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith('Copie manualmente: https://exemplo/pagina', 6000, 'error');
  });
});

describe('_printWithRestore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('chama prepare, print, e restore ao disparar afterprint (fluxo normal)', () => {
    const prepare = vi.fn(), restore = vi.fn(), printFn = vi.fn();
    let handler;
    const addListener = vi.fn((evt, fn) => { handler = fn; });
    const removeListener = vi.fn();

    _printWithRestore(prepare, restore, printFn, addListener, removeListener, setTimeout);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(printFn).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();

    handler(); // simula o evento 'afterprint' disparando
    expect(restore).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('afterprint', handler);

    vi.runAllTimers(); // o fallback não deve restaurar de novo
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('restaura pelo fallback de timeout se afterprint nunca disparar', () => {
    const prepare = vi.fn(), restore = vi.fn(), printFn = vi.fn();
    const addListener = vi.fn();
    const removeListener = vi.fn();

    _printWithRestore(prepare, restore, printFn, addListener, removeListener, setTimeout);
    expect(restore).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('nunca restaura duas vezes (afterprint + fallback ambos disparando)', () => {
    const prepare = vi.fn(), restore = vi.fn(), printFn = vi.fn();
    let handler;
    const addListener = vi.fn((evt, fn) => { handler = fn; });
    const removeListener = vi.fn();

    _printWithRestore(prepare, restore, printFn, addListener, removeListener, setTimeout);
    handler();               // afterprint dispara primeiro
    vi.advanceTimersByTime(1500); // fallback dispara depois, mas não deve restaurar de novo

    expect(restore).toHaveBeenCalledTimes(1);
  });
});
