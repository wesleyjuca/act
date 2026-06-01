const SEMA_CONFIG = {

  // URL do Google Apps Script (Web App implantado) — somente leitura
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbyPhH3WfRtJ4h-bPZUA7YlKPINj59l3rk5KeWpcpnQ/exec',

  // Aba da planilha de dados
  sheet: 'ACT - PAINEL PUBLICO',

  // Sync automático
  interval:      60_000,    // 1 min entre syncs
  retryMax:      3,
  retryDelay:    2_000,
  retryDelayMax: 10_000,    // cap de backoff exponencial

  // Cache local
  cacheKey: 'sema_tct_cache',

  // URL pública do painel
  publicUrl: 'https://wesleyjuca.github.io/act/',

};

if (typeof window !== 'undefined') window.SEMA_CONFIG = SEMA_CONFIG;
if (typeof module !== 'undefined') module.exports = SEMA_CONFIG;
