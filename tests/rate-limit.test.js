import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* SEMA_Code.gs roda no ambiente do Google Apps Script, fora do alcance do Vitest/Node —
   a maior parte deste arquivo é checagem textual (grep-based). O circuit breaker de
   volume agregado (_isThrottled) também é exercitado de fato: extraímos a função e as
   constantes THROTTLE_* por regex do próprio .gs e rodamos com um CacheService falso
   (Map em memória), sem precisar mockar o SDK do Apps Script inteiro. */

const gsPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'SEMA_Code.gs');
const src = readFileSync(gsPath, 'utf-8');

describe('SEMA_Code.gs — circuit breaker de volume agregado (_isThrottled)', () => {
  it('doGet checa _isThrottled() antes do try (recusa cedo, sem custo de handlers)', () => {
    const doGetMatch = src.match(/function doGet\(e\)\s*\{[\s\S]*?\n\}/);
    expect(doGetMatch).not.toBeNull();
    const body = doGetMatch[0];
    const throttleIdx = body.indexOf('_isThrottled()');
    const tryIdx = body.indexOf('try {');
    expect(throttleIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(throttleIdx).toBeLessThan(tryIdx);
  });

  it('_isThrottled usa CacheService.getScriptCache() (mesmo padrão de handleList)', () => {
    const fnMatch = src.match(/function _isThrottled\(\)\s*\{[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch[0]).toContain('CacheService.getScriptCache()');
  });

  it('mensagem de throttle não colide com a detecção de erro de setup do front (_setupKeywords)', () => {
    const doGetMatch = src.match(/function doGet\(e\)\s*\{[\s\S]*?_isThrottled[\s\S]*?\n  \}\n/);
    expect(doGetMatch).not.toBeNull();
    const throttleBlock = doGetMatch[0];
    expect(throttleBlock).not.toContain('não encontrada');
  });

  it('BACKEND_VERSION foi bumpado nesta mudança de contrato de API', () => {
    const m = src.match(/const\s+BACKEND_VERSION\s*=\s*'([^']+)'/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toBe('9.2.0');
  });
});

describe('_isThrottled — comportamento real via extração + CacheService falso', () => {
  function buildIsThrottled(maxRequests, windowSeconds) {
    const fnSrc = src.match(/function _isThrottled\(\)\s*\{[\s\S]*?\n\}/)[0];
    const keyMatch = src.match(/THROTTLE_WINDOW_KEY\s*=\s*'([^']+)'/);
    const cache = new Map();
    const CacheService = {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); },
      }),
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(
      'CacheService', 'THROTTLE_WINDOW_KEY', 'THROTTLE_WINDOW_SECONDS', 'THROTTLE_MAX_REQUESTS',
      `${fnSrc}; return _isThrottled;`
    );
    return factory(CacheService, keyMatch[1], windowSeconds, maxRequests);
  }

  it('libera enquanto abaixo do limite e recusa ao atingi-lo', () => {
    const isThrottled = buildIsThrottled(3, 5);
    expect(isThrottled()).toBe(false); // 0 -> 1
    expect(isThrottled()).toBe(false); // 1 -> 2
    expect(isThrottled()).toBe(false); // 2 -> 3
    expect(isThrottled()).toBe(true);  // já em 3, limite atingido
    expect(isThrottled()).toBe(true);  // continua recusando
  });

  it('com limite 0, recusa desde a primeira chamada', () => {
    const isThrottled = buildIsThrottled(0, 5);
    expect(isThrottled()).toBe(true);
  });
});
