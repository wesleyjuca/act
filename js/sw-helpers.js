/* SEMA/ACT — helpers puros do Service Worker (testáveis, sem depender de Cache API/SW scope).
   Carregado pelo sw.js via importScripts() e, em testes, via require()/import (Node). */
(function (root) {
  'use strict';

  /* Lista de assets do app-shell a cachear (cache-first). Mesma origem + externos
     explicitamente permitidos pela CSP de index.html (script-src/style-src). */
  function getAppShellAssets() {
    return [
      './',
      'index.html',
      'js/config.js',
      'js/util.js',
      'manifest.json',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    ];
  }

  /* Decide se uma URL deve ser ignorada pelo Service Worker (passthrough de rede,
     sem cache/interceptação) — usado para a chamada JSONP ao Apps Script, que é
     injetada via <script src> cross-origin e cuja resposta viria opaca/inútil
     se o SW tentasse fetch/cache. */
  function shouldBypassServiceWorker(requestUrl) {
    const s = String(requestUrl || '');
    return s.includes('script.google.com') || s.includes('script.googleusercontent.com');
  }

  const api = { getAppShellAssets, shouldBypassServiceWorker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
