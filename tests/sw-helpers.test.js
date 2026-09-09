import { describe, it, expect } from 'vitest';
import swHelpers from '../js/sw-helpers.js';

const { getAppShellAssets, shouldBypassServiceWorker } = swHelpers;

describe('getAppShellAssets', () => {
  const assets = getAppShellAssets();

  it('retorna uma lista não vazia de strings', () => {
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBeGreaterThan(0);
    assets.forEach(a => expect(typeof a).toBe('string'));
  });

  it('inclui o app-shell essencial (mesma origem)', () => {
    expect(assets).toContain('index.html');
    expect(assets).toContain('js/config.js');
    expect(assets).toContain('js/util.js');
    expect(assets).toContain('manifest.json');
    expect(assets).toContain('icons/icon-192.png');
    expect(assets).toContain('icons/icon-512.png');
  });

  it('só referencia externos permitidos pela CSP de index.html (cdnjs Chart.js e fonts.googleapis.com)', () => {
    const externals = assets.filter(a => /^https?:\/\//.test(a));
    externals.forEach(url => {
      expect(/^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com)\//.test(url)).toBe(true);
    });
  });

  it('não referencia o domínio do Apps Script (não faz sentido pré-cachear)', () => {
    assets.forEach(a => {
      expect(a).not.toMatch(/script\.google/);
    });
  });
});

describe('shouldBypassServiceWorker', () => {
  it('retorna true para chamadas ao Apps Script (script.google.com)', () => {
    expect(shouldBypassServiceWorker('https://script.google.com/macros/s/ABC/exec?action=list&callback=x')).toBe(true);
  });

  it('retorna true para o domínio de redirect do Apps Script (script.googleusercontent.com)', () => {
    expect(shouldBypassServiceWorker('https://script.googleusercontent.com/macros/echo?x')).toBe(true);
  });

  it('retorna false para assets do app-shell (mesma origem)', () => {
    expect(shouldBypassServiceWorker('https://wesleyjuca.github.io/act/index.html')).toBe(false);
    expect(shouldBypassServiceWorker('js/util.js')).toBe(false);
  });

  it('retorna false para externos permitidos pela CSP (cdnjs, fonts)', () => {
    expect(shouldBypassServiceWorker('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js')).toBe(false);
    expect(shouldBypassServiceWorker('https://fonts.googleapis.com/css2?family=Inter')).toBe(false);
  });

  it('lida com entradas vazias/nulas sem lançar', () => {
    expect(shouldBypassServiceWorker(null)).toBe(false);
    expect(shouldBypassServiceWorker(undefined)).toBe(false);
    expect(shouldBypassServiceWorker('')).toBe(false);
  });
});
