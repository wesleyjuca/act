const SEMA_CONFIG = {

  // URL do Google Apps Script (Web App implantado)
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbyPhH3WfRtJ4h-bPZUA7YlKPINj59l3rk5KeWpcpnQ/exec',

  // Token para operações de escrita (admin → Sheets)
  // Configure o Secret SYNC_TOKEN no GitHub para habilitar o painel admin
  syncToken: '%%SYNC_TOKEN%%',

  // Sync automático
  interval:      60_000,    // 1 min entre syncs — painel público (admin sobrescreve para 5 min)
  retryMax:      3,
  retryDelay:    2_000,
  retryDelayMax: 10_000,    // cap de backoff exponencial
  conflictMode: 'newest',   // 'newest' | 'local' | 'remote'

  // Aba da planilha
  sheet: 'ACT - PAINEL PUBLICO',

  // Cache
  cacheKey: 'sema_tct_cache',
  logKey:   'sema_tct_logs',
  logMax:   100,

  // Hash SHA-256 da senha admin (padrão: SEMA@2026)
  // Sobrescrito pelo Secret SENHA_HASH no CI/CD se configurado
  senhaHash: '%%SENHA_HASH%%',

  // URLs do painel
  publicUrl: 'https://wesleyjuca.github.io/act/',
  adminUrl:  'https://wesleyjuca.github.io/act/admin.html',

};

if (typeof window !== 'undefined') window.SEMA_CONFIG = SEMA_CONFIG;
if (typeof module !== 'undefined') module.exports = SEMA_CONFIG;
