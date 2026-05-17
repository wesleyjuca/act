const SEMA_CONFIG = {

  // URL do Google Apps Script (Web App implantado)
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbyOfzikgP8I5PCQ2WoQQzbiG6KQoQJeR2BBFyG2vsFf1LIbvdrwFIGhhJhFxmqR4-2O/exec',

  // Token para operações de escrita (admin → Sheets)
  // Configure o Secret SYNC_TOKEN no GitHub para habilitar o painel admin
  syncToken: '3f033d20-e310-47b4-889d-8e73d87b4c35',

  // Sync automático
  interval:     300_000,   // 5 min entre syncs (0 = somente manual)
  retryMax:     3,
  retryDelay:   2_000,
  conflictMode: 'newest',  // 'newest' | 'local' | 'remote'

  // Aba da planilha
  sheet: 'DADOS_PÚBLICOS',

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
