/* SEMA/ACT — Service Worker: cache-first do app-shell para uso offline/instalável.
   Progressive enhancement: se isto falhar ou não for suportado, o painel continua
   funcionando normalmente sem SW (registro em index.html é defensivo/try-catch).

   IMPORTANTE: a sincronização de dados usa JSONP (gasJsonp em index.html), que injeta
   um <script src> cross-origin para script.google.com — isso NÃO passa de forma útil
   pelo evento 'fetch' interceptável aqui (resposta viria opaca). Por isso este SW
   nunca tenta cachear/responder por esse domínio; ver shouldBypassServiceWorker. */

importScripts('js/sw-helpers.js');

// Bump esta versão a cada mudança relevante no app-shell (força invalidação do cache
// antigo). Não há build step que sincronize automaticamente com package.json — é
// disciplina manual, assim como o BACKEND_VERSION em SEMA_Code.gs.
const CACHE_VERSION = '9.4.0';
const CACHE_NAME = 'sema-act-shell-v' + CACHE_VERSION;
const CACHE_PREFIX = 'sema-act-shell-';

self.addEventListener('install', (event) => {
  // NÃO chama skipWaiting() aqui de propósito: um SW novo instalado fica em "waiting"
  // até o usuário confirmar a atualização (ver mensagem 'SKIP_WAITING' abaixo e o
  // registro em index.html) — evita trocar o app-shell debaixo do usuário em silêncio
  // no meio de uma sessão longa.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache.addAll() é atômico: se QUALQUER asset falhar (ex.: CDN externo
      // instável, ad-blocker, rede restrita), NENHUM é cacheado — nem os
      // essenciais same-origin (index.html, js/*), o que anularia o offline.
      // Por isso cacheamos individualmente com allSettled: os externos
      // (Chart.js/fonte) são best-effort, mas nunca derrubam o app-shell.
      Promise.allSettled(
        getAppShellAssets().map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] Falha ao pré-cachear (não crítico):', asset, err.message);
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// index.html envia isto só depois do usuário confirmar o aviso de "nova versão
// disponível" — nunca automaticamente, para não trocar o app-shell sem interação.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Passthrough total para o Apps Script (JSONP) — nunca interceptar/cachear.
  if (shouldBypassServiceWorker(url)) return;

  // Só GET é cacheável de forma segura (POST/etc. seguem direto para a rede).
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Só cacheia respostas bem-sucedidas e do próprio app-shell/origens confiáveis
        // já listadas em getAppShellAssets(); evita poluir o cache com tráfego avulso.
        if (response && response.ok && getAppShellAssets().some((a) => url.endsWith(a) || url === a)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached); // offline e sem cache: deixa falhar graciosamente
    })
  );
});
