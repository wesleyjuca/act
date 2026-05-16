/**
 * SEMA/AC — Configuração do Sistema
 * Edite este arquivo com suas credenciais após o deploy do Apps Script.
 *
 * ATENÇÃO: SYNC_TOKEN deve ser uma string aleatória longa (>= 32 chars).
 * Nunca comite este arquivo com valores reais no GitHub público.
 * Use GitHub Secrets para CI/CD e substitua via sed no workflow.
 */

const SEMA_CONFIG = {

  // ── APPS SCRIPT ────────────────────────────────────────────────────────────
  // URL gerada após "Implantar como aplicativo da Web" no Google Apps Script
  // Formato: https://script.google.com/macros/s/AKfy.../exec
  appsScriptUrl: '%%APPS_SCRIPT_URL%%',

  // Token secreto compartilhado entre este frontend e o Apps Script
  // Configure também em: Apps Script → Propriedades do Projeto → SYNC_TOKEN
  syncToken: '%%SYNC_TOKEN%%',

  // ── SYNC ───────────────────────────────────────────────────────────────────
  interval:     300_000,   // ms entre syncs automáticos (0 = somente manual)
  retryMax:     3,         // tentativas em caso de falha
  retryDelay:   2_000,     // delay base entre tentativas (ms)
  conflictMode: 'newest',  // 'newest' | 'local' | 'remote'

  // ── PLANILHA ───────────────────────────────────────────────────────────────
  sheet:        'DADOS_PÚBLICOS',

  // ── CACHE ──────────────────────────────────────────────────────────────────
  cacheKey:     'sema_tct_cache',
  logKey:       'sema_tct_logs',
  logMax:       100,

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  // Hash SHA-256 da senha admin (padrão: SEMA@2026)
  // Gere o hash: console → await crypto.subtle.digest('SHA-256', new TextEncoder().encode('SUA_SENHA'))
  // .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
  senhaHash: '%%SENHA_HASH%%',

  // ── URLs ───────────────────────────────────────────────────────────────────
  publicUrl:  '%%PUBLIC_URL%%',   // URL do painel público (GitHub Pages)
  adminUrl:   '%%ADMIN_URL%%',    // URL do painel admin

};

if (typeof window !== 'undefined') window.SEMA_CONFIG = SEMA_CONFIG;
if (typeof module !== 'undefined') module.exports = SEMA_CONFIG;
