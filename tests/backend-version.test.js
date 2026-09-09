import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* SEMA_Code.gs roda no ambiente do Google Apps Script, fora do alcance do Vitest/Node —
   este teste é uma checagem textual (grep-based), não uma execução real do backend.
   Objetivo: evitar que a versão do backend volte a ficar hardcoded/duplicada e
   esquecida (bug real corrigido: 'ping'/'status' retornavam '8.0' enquanto o projeto
   já estava na v9.1, e a aba de saúde tinha um '7.0' independente ainda mais antigo). */

const gsPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'SEMA_Code.gs');
const src = readFileSync(gsPath, 'utf-8');

describe('SEMA_Code.gs — versão do backend centralizada', () => {
  it('define uma única constante BACKEND_VERSION', () => {
    const matches = src.match(/const\s+BACKEND_VERSION\s*=\s*'([^']+)'/);
    expect(matches).not.toBeNull();
    expect(matches[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('não usa mais os literais de versão antigos e esquecidos (8.0 / 7.0)', () => {
    expect(src).not.toMatch(/version:\s*'8\.0'/);
    expect(src).not.toMatch(/'versao',\s*'7\.0'/);
    expect(src).not.toMatch(/set\('versao',\s*'8\.0'\)/);
  });

  it('handlePing/handleStatus/_atualizarSaude referenciam BACKEND_VERSION, não um literal', () => {
    const versionAssignments = [...src.matchAll(/version:\s*(\S+),/g)].map(m => m[1]);
    expect(versionAssignments.length).toBeGreaterThan(0);
    versionAssignments.forEach(v => expect(v).toBe('BACKEND_VERSION'));

    const versaoSets = [...src.matchAll(/set\('versao',\s*([^)]+)\);/g)].map(m => m[1].trim());
    expect(versaoSets.length).toBeGreaterThan(0);
    versaoSets.forEach(v => expect(v).toBe('BACKEND_VERSION'));
  });
});

describe('SEMA_Code.gs — erro público não vaza detalhe interno', () => {
  it('doGet usa _publicErrorMessage no catch, não err.message cru', () => {
    expect(src).toMatch(/const\s+data\s*=\s*\{\s*error:\s*_publicErrorMessage\(err\)\s*\}/);
    // garante que não sobrou nenhum "error: err.message" esquecido em doGet
    expect(src).not.toMatch(/error:\s*err\.message/);
  });

  it('_publicErrorMessage preserva a mensagem de aba não encontrada usada pelo front-end', () => {
    // getSheet() lança "Aba '...' não encontrada" — index.html detecta essa substring
    // (_setupKeywords) para mostrar o guia de configuração; não pode ser genericizada.
    expect(src).toMatch(/não encontrada`\)/);
    const fnMatch = src.match(/function _publicErrorMessage\(err\)\s*\{[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch[0]).toContain("includes('não encontrada')");
  });
});

describe('SEMA_Code.gs — histórico de edições registra o usuário', () => {
  it('_appendHistorico aceita e grava o parâmetro usuario (não mais string vazia fixa)', () => {
    expect(src).toMatch(/function _appendHistorico\(aba, row, col, before, after, usuario\)/);
    expect(src).not.toMatch(/hist\.appendRow\(\[new Date\(\), aba, row, col, before, after, ''\]\)/);
  });

  it('onEdit tenta capturar Session.getActiveUser().getEmail() com fallback seguro', () => {
    expect(src).toMatch(/Session\.getActiveUser\(\)\.getEmail\(\)/);
    expect(src).toMatch(/usuario = 'desconhecido'/);
  });
});
