/**
 * SEMA/AC — Google Apps Script
 * API REST para Painel de Termos de Cooperação Técnica
 *
 * CONFIGURAÇÃO:
 *  1. Abra o Google Sheets → Extensões → Apps Script → cole este código
 *  2. Projeto → Propriedades → Adicionar propriedade: SYNC_TOKEN = <token>
 *  3. Implantar → Novo implantação → Aplicativo da Web
 *       Executar como: Eu (conta Google)
 *       Quem tem acesso: Qualquer pessoa
 *  4. Copiar URL gerada → config.js → appsScriptUrl
 *
 * ENDPOINTS:
 *  GET  ?action=list      → retorna todos os registros (todas as colunas da planilha)
 *  GET  ?action=schema    → retorna definição das colunas [{key, label, col}]
 *  GET  ?action=status    → saúde da API
 *  GET  ?action=export    → download CSV completo da planilha
 *  POST {action:'upsert',     record, token}  → cria/atualiza 1 registro
 *  POST {action:'delete',     tipo, num, token} → remove 1 registro
 *  POST {action:'replaceAll', records[], token} → substitui toda a planilha
 */

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const SHEET_DADOS = 'DADOS_PÚBLICOS';
const SHEET_LOG   = 'SYNC_LOG';

// Mapeamento de variações de cabeçalho → chave canônica usada pelo frontend
// Permite que planilhas com nomes de coluna ligeiramente diferentes funcionem corretamente
const HEADER_MAP = {
  'tipo': 'tipo', 'type': 'tipo',
  'num': 'num', 'numero': 'num', 'número': 'num',
  'objeto': 'objeto', 'obj': 'objeto',
  'inst': 'inst', 'instituicao': 'inst', 'instituição': 'inst',
  'instituicao_parceira': 'inst', 'entidade': 'inst',
  'esfera': 'esfera',
  'inicio': 'inicio', 'início': 'inicio', 'data_inicio': 'inicio',
  'termino': 'termino', 'término': 'termino', 'data_termino': 'termino',
  'area': 'area', 'área': 'area',
  'status': 'status', 'situacao': 'status', 'situação': 'status',
  'diasrestantes': 'diasRestantes', 'dias_restantes': 'diasRestantes',
  'link': 'link', 'linkdoc': 'link', 'link_doc': 'link',
  'sei': 'sei',
  'obs': 'obs', 'observacoes': 'obs', 'observações': 'obs',
};

// ── NORMALIZAÇÃO DE HEADER ────────────────────────────────────────────────────
/** Normaliza um label de cabeçalho para chave comparável */
function normHeader(h) {
  return String(h || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** Retorna a chave canônica para um label de cabeçalho */
function headerKey(label) {
  const norm = normHeader(label);
  return HEADER_MAP[norm] || norm;
}

// ── GET HANDLER ───────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const rlCache = CacheService.getScriptCache();
    const rlKey   = 'rl_get_' + new Date().toISOString().slice(0, 16);
    const rlCount = parseInt(rlCache.get(rlKey) || '0') + 1;
    rlCache.put(rlKey, String(rlCount), 90);
    if (rlCount > 120) {
      return jsonResponse({ error: 'rate_limit', message: 'Muitas requisições. Aguarde 1 minuto.' });
    }

    const action = (e.parameter && e.parameter.action) || 'list';
    switch (action) {
      case 'list':   return jsonResponse(handleList(e.parameter));
      case 'schema': return jsonResponse(handleSchema());
      case 'status': return jsonResponse(handleStatus());
      case 'export': return exportCsv();   // retorna CSV, não JSON
      default:       return jsonResponse({ error: `Ação desconhecida: ${action}` });
    }
  } catch (err) {
    logError('doGet', err.message);
    return jsonResponse({ error: err.message });
  }
}

// ── POST HANDLER ──────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    let raw = '';
    if (e.postData) {
      const ct = String(e.postData.type || '').toLowerCase();
      if (ct.indexOf('x-www-form-urlencoded') !== -1) {
        const contents = String(e.postData.contents || '');
        const m = contents.match(/(?:^|&)data=([^&]*)/);
        raw = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
      } else {
        raw = String(e.postData.contents || '');
      }
    }
    if (!raw || !raw.trim()) return jsonResponse({ error: 'Corpo POST vazio ou ausente' });

    let body;
    try { body = JSON.parse(raw); }
    catch (pe) { return jsonResponse({ error: 'JSON inválido: ' + pe.message }); }

    if (!validateToken(body.token)) {
      logError('auth', 'Token inválido em ' + new Date().toISOString());
      return jsonResponse({ error: 'Token inválido' });
    }

    const cache  = CacheService.getScriptCache();
    const rlKey  = 'rl_' + String(body.token || '').slice(0, 12);
    const rlCount = parseInt(cache.get(rlKey) || '0') + 1;
    cache.put(rlKey, String(rlCount), 60);
    if (rlCount > 30) {
      return jsonResponse({ error: 'rate_limit', message: 'Muitas requisições. Aguarde 1 minuto.' });
    }

    switch (body.action) {
      case 'upsert':     return jsonResponse(handleUpsert(body.record, body.sheet));
      case 'delete':     return jsonResponse(handleDelete(body.tipo, body.num, body.sheet));
      case 'replaceAll': return jsonResponse(handleReplaceAll(body));
      default:           return jsonResponse({ error: `Ação POST desconhecida: ${body.action}` });
    }
  } catch (err) {
    logError('doPost', err.message);
    return jsonResponse({ error: err.message });
  }
}

// ── AÇÕES GET ─────────────────────────────────────────────────────────────────

function handleList(params) {
  const sheetName = (params && params.sheet) || SHEET_DADOS;

  // Cache de 30s para evitar leituras repetidas ao Sheets
  const cache = CacheService.getScriptCache();
  const cKey  = 'list_' + sheetName;
  const hit   = cache.get(cKey);
  if (hit) {
    try { return JSON.parse(hit); } catch (_) {}
  }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada`, records: [] };

  const data = sheet.getDataRange().getValues();
  if (data.length < 3) return { records: [], count: 0, total: 0, sheet: sheetName, updated: new Date().toISOString() };

  // Linha 2 (índice 1) = cabeçalhos reais; mapeia cada um para sua chave canônica
  const keys = data[1].map(h => headerKey(String(h)));

  const records = [];
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row.some(cell => String(cell).trim())) continue;  // pula linhas completamente vazias
    const rec = {};
    keys.forEach((k, j) => {
      const v = row[j];
      rec[k] = v instanceof Date
        ? Utilities.formatDate(v, 'America/Rio_Branco', 'yyyy-MM-dd')
        : String(v === null || v === undefined ? '' : v);
      if (h === 'num' || h === 'tipo') {
        // num/tipo nunca são datas — se Sheets converteu "01/2025" para Date, reconstruir
        rec[h] = v instanceof Date
          ? (String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear())
          : String(v || '');
      } else {
        rec[h] = v instanceof Date
          ? Utilities.formatDate(v, 'America/Rio_Branco', 'yyyy-MM-dd')
          : String(v || '');
      }
    });
    rec._row = i + 1;
    records.push(rec);
  }

  const total  = records.length;
  const limit  = parseInt((params && params.limit)  || '0');
  const offset = parseInt((params && params.offset) || '0');
  const paged  = limit > 0 ? records.slice(offset, offset + limit) : records;

  logInfo('list', `${paged.length}/${total} registros`);
  const result = { records: paged, count: paged.length, total, sheet: sheetName, updated: new Date().toISOString() };
  cache.put(cKey, JSON.stringify(result), 30);
  return result;
}

function handleSchema() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_DADOS);
  if (!sheet) return { columns: [], sheets: [], updated: new Date().toISOString() };

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return { columns: [], sheets: [], updated: new Date().toISOString() };

  const headerRow = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const columns = headerRow
    .map((h, i) => {
      const label = String(h || '').trim();
      if (!label) return null;
      return { key: headerKey(label), label, col: i + 1 };
    })
    .filter(Boolean);

  return {
    columns,
    sheets:  ss.getSheets().map(s => s.getName()),
    updated: new Date().toISOString(),
  };
}

function handleStatus() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(SHEET_DADOS);
  const rows = sh ? Math.max(0, sh.getLastRow() - 2) : 0;
  return {
    ok:      true,
    name:    ss.getName(),
    id:      ss.getId(),
    sheets:  ss.getSheets().map(s => s.getName()),
    rows,
    updated: new Date().toISOString(),
    version: '4.0',
  };
}

// ── AÇÕES POST ────────────────────────────────────────────────────────────────

// Converte célula para string de número de ACT, tratando auto-conversão do Sheets
function numToStr(v) {
  if (v instanceof Date)
    return String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear();
  return String(v || '').trim();
}

function handleUpsert(record, sheetName) {
  if (!record) return { error: 'Registro inválido: objeto vazio' };
  sheetName = sheetName || SHEET_DADOS;
  CacheService.getScriptCache().remove('list_' + sheetName);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada` };

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { error: 'Planilha sem cabeçalhos (linha 2 vazia)' };

  // Detecta dinamicamente os índices das colunas-chave (tipo e num) a partir dos headers reais
  const hdrs = data[1];
  let tipoIdx = 0, numIdx = 1;  // fallback: coluna A = tipo, coluna B = num
  hdrs.forEach((h, i) => {
    const k = headerKey(String(h));
    if (k === 'tipo') tipoIdx = i;
    if (k === 'num')  numIdx  = i;
  });

  // Valores de identificação do registro enviado (normalizados para comparação)
  const recTipo = String(record.tipo || record[headerKey(String(hdrs[tipoIdx]))] || '').trim().toUpperCase();
  const recNum  = String(record.num  || record[headerKey(String(hdrs[numIdx]))]  || '').trim();

  if (!recTipo || !recNum) {
    return { error: 'Registro inválido: colunas de identificação (tipo e número) são obrigatórias' };
  }

  // Busca linha existente para update
  let targetRow = -1;
  for (let i = 2; i < data.length; i++) {
    if (String(data[i][tipoIdx]).trim().toUpperCase() === recTipo &&
        String(data[i][numIdx]).trim()               === recNum) {
  const data    = sheet.getDataRange().getValues();

  // Procura linha existente usando numToStr para suportar células auto-convertidas para Date
  const _tipUps = String(record.tipo).trim().toUpperCase();
  const _numUps = String(record.num).trim();
  let targetRow = -1;
  for (let i = 2; i < data.length; i++) {
    if (numToStr(data[i][1])                     === _numUps &&
        String(data[i][0]).trim().toUpperCase() === _tipUps) {
      targetRow = i + 1;
      break;
    }
  }

  const rowValues = buildRowValues(record, sheet);

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    logInfo('upsert', `Atualizado: ${recTipo} ${recNum} (linha ${targetRow})`);
    return { ok: true, action: 'updated', row: targetRow };
  } else {
    const lastRow = Math.max(sheet.getLastRow(), 2);
    sheet.getRange(lastRow + 1, 1, 1, rowValues.length).setValues([rowValues]);
    logInfo('upsert', `Inserido: ${recTipo} ${recNum} (linha ${lastRow + 1})`);
    return { ok: true, action: 'inserted', row: lastRow + 1 };
    // Forçar formato texto para coluna num (B) — evita re-conversão pelo Sheets
    sheet.getRange(targetRow, 2, 1, 1).setNumberFormat('@STRING@');
    logInfo('upsert', `Atualizado: ${record.tipo} ${record.num} (linha ${targetRow})`);
    return { ok: true, action: 'updated', row: targetRow, _ts_server: record._ts_server };
  } else {
    const lastRow = findLastRow(sheet);
    sheet.getRange(lastRow + 1, 1, 1, rowValues.length).setValues([rowValues]);
    sheet.getRange(lastRow + 1, 2, 1, 1).setNumberFormat('@STRING@');
    logInfo('upsert', `Inserido: ${record.tipo} ${record.num} (linha ${lastRow + 1})`);
    return { ok: true, action: 'inserted', row: lastRow + 1, _ts_server: record._ts_server };
  }
}

function handleUpsertBatch(records, sheetName) {
  if (!Array.isArray(records) || !records.length) {
    return { error: 'records deve ser um array não vazio' };
  }
  if (records.length > 200) {
    return { error: 'Limite de 200 registros por lote excedido. Divida em lotes menores.' };
  }
  sheetName = sheetName || SHEET_DADOS;
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada` };

  // Leitura única: construir mapa tipo+num → linha 1-based usando numToStr
  const data   = sheet.getDataRange().getValues();
  const rowMap = new Map();
  for (let i = 2; i < data.length; i++) {
    if (data[i][1]) {
      const k = `${String(data[i][0]).trim().toUpperCase()}|${numToStr(data[i][1])}`;
      rowMap.set(k, i + 1);
    }
  }

  let updated = 0, inserted = 0, errors = 0;
  const toInsert = [];
  const insertedRows = [];

  for (const r of records) {
    try {
      if (!r || !r.tipo || !r.num) { errors++; continue; }
      r._ts_server = Date.now();
      if (!r._ts) r._ts = r._ts_server;
      const rowValues = buildRowValues(r, sheetName);
      const key = `${String(r.tipo).trim().toUpperCase()}|${String(r.num).trim()}`;
      if (rowMap.has(key)) {
        const row = rowMap.get(key);
        sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
        sheet.getRange(row, 2, 1, 1).setNumberFormat('@STRING@');
        updated++;
      } else {
        toInsert.push(rowValues);
      }
    } catch (e) { errors++; }
  }

  // Inserção em lote: uma única chamada ao Sheets
  if (toInsert.length > 0) {
    const lastRow = Math.max(sheet.getLastRow(), 2);
    sheet.getRange(lastRow + 1, 1, toInsert.length, toInsert[0].length).setValues(toInsert);
    // Forçar formato texto para coluna num em todas as linhas inseridas
    sheet.getRange(lastRow + 1, 2, toInsert.length, 1).setNumberFormat('@STRING@');
    inserted = toInsert.length;
  }
}

function handleDelete(tipo, num, sheetName) {
  if (!tipo || !num) return { error: 'tipo e num são obrigatórios' };
  sheetName = sheetName || SHEET_DADOS;

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada` };

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: false, reason: 'not_found' };

  // Detecta colunas-chave dinamicamente
  const hdrs = data[1];
  let tipoIdx = 0, numIdx = 1;
  hdrs.forEach((h, i) => {
    const k = headerKey(String(h));
    if (k === 'tipo') tipoIdx = i;
    if (k === 'num')  numIdx  = i;
  });

  const tipNorm = String(tipo).trim().toUpperCase();
  const numNorm = String(num).trim();

  for (let i = 2; i < data.length; i++) {
    if (String(data[i][tipoIdx]).trim().toUpperCase() === tipNorm &&
        String(data[i][numIdx]).trim()               === numNorm) {
      sheet.deleteRow(i + 1);
      logInfo('delete', `Removido: ${tipo} ${num}`);
      return { ok: true, row: i + 1 };
    }
  }
  return { ok: false, reason: 'not_found' };
}

function handleReplaceAll(p) {
  CacheService.getScriptCache().remove('list_' + (p.sheet || SHEET_DADOS));
  const records = p.records;
  if (!Array.isArray(records)) return { error: 'records deve ser um array' };

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_DADOS);
  if (!sheet) return { error: `Aba '${SHEET_DADOS}' não encontrada` };

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return { error: 'Planilha sem colunas' };

  // Lê cabeçalhos (linha 2) e constrói mapa de correspondência
  const sheetHeaders = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const headerIdx = {};
  sheetHeaders.forEach((h, i) => {
    const label = String(h || '').trim();
    if (!label) return;
    const norm   = normHeader(label);
    const canon  = HEADER_MAP[norm] || norm;
    headerIdx[label]            = i;
    headerIdx[label.toLowerCase()] = i;
    headerIdx[norm]             = i;
    headerIdx[canon]            = i;
  });

  // Mapeia cada registro → linha
  const rows = records.map(rec => {
    const row = new Array(lastCol).fill('');
    Object.entries(rec).forEach(([key, val]) => {
      const norm  = normHeader(key);
      const canon = HEADER_MAP[norm] || norm;
      let colIdx  = -1;
      for (const k of [key, key.toLowerCase(), norm, canon]) {
        if (headerIdx[k] !== undefined) { colIdx = headerIdx[k]; break; }
      }
      if (colIdx < 0) return;
      const v      = String(val === undefined || val === null ? '' : val).trim();
      const parsed = parseDate(v);
      row[colIdx]  = parsed instanceof Date ? parsed : v;
    });
    return row;
  });

  // Limpa dados (mantém linhas 1 e 2 intactas)
  const lastRow = sheet.getLastRow();
  if (lastRow >= 3) sheet.getRange(3, 1, lastRow - 2, lastCol).clearContent();
  if (rows.length > 0) sheet.getRange(3, 1, rows.length, lastCol).setValues(rows);

  logInfo('replaceAll', `${rows.length} registros gravados`);
  return { ok: true, replaced: rows.length };
}

// ── EXPORT CSV ────────────────────────────────────────────────────────────────
/** GET ?action=export — retorna todos os dados da aba como CSV (UTF-8 + BOM) */
function exportCsv() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_DADOS);
  if (!sheet) {
    return ContentService.createTextOutput('Aba não encontrada').setMimeType(ContentService.MimeType.TEXT);
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.CSV);
  }

  const SEP   = ';';
  const lines = [];
  const headers = data[1].map(h => String(h || '').trim());
  lines.push(headers.map(csvCell).join(SEP));

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row.some(cell => String(cell).trim())) continue;
    lines.push(headers.map((_, j) => {
      const v = row[j];
      return csvCell(v instanceof Date ? Utilities.formatDate(v, 'America/Rio_Branco', 'dd/MM/yyyy') : String(v !== undefined && v !== null ? v : ''));
    }).join(SEP));
  }

  return ContentService.createTextOutput('﻿' + lines.join('\r\n'))
    .setMimeType(ContentService.MimeType.CSV);
}

function csvCell(val) {
  const s = String(val === undefined || val === null ? '' : val);
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Constrói array de valores para uma linha da planilha a partir de um objeto de registro.
 * Completamente dinâmico: lê os headers reais da linha 2 da planilha.
 */
function buildRowValues(rec, sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  return headers.map(h => {
    const label = String(h || '').trim();
    const norm  = normHeader(label);
    const canon = HEADER_MAP[norm] || norm;
    // Tenta encontrar o valor no registro por chave canônica, normalizada ou label exato
    const raw = rec[canon] !== undefined ? rec[canon]
              : rec[norm]  !== undefined ? rec[norm]
              : rec[label] !== undefined ? rec[label] : '';
    const s = String(raw === null || raw === undefined ? '' : raw);
    // Converte string ISO (yyyy-mm-dd) para objeto Date para o Sheets salvar como data
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = parseDate(s);
      if (d instanceof Date) return d;
    }
    return s;
  });
}

function parseDate(str) {
  if (!str) return '';
  if (str instanceof Date) return str;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    return new Date(y, m - 1, d);
  }
  return '';
}

function validateToken(token) {
  const stored = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN')
              || '27f2b931-2773-4198-9edd-261047aa5ec7-9a263f1b-488d-4a6d-81a1-dfe1704acf29';
  if (!token || token.length !== stored.length) return false;
  let match = true;
  for (let i = 0; i < stored.length; i++) { if (token[i] !== stored[i]) match = false; }
  return match;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── LOG ───────────────────────────────────────────────────────────────────────

let _logSheet = null;

function ensureLogSheet() {
  if (_logSheet) return _logSheet;
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let log   = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    log.appendRow(['Timestamp', 'Nível', 'Mensagem', 'Usuário', 'IP']);
    log.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#095C18').setFontColor('#FFFFFF');
  }
  _logSheet = log;
  return _logSheet;
}

function logInfo(action, msg) {
  try { ensureLogSheet().appendRow([new Date(), 'info',  `[${action}] ${msg}`, 'api', '']); } catch (_) {}
}

function logError(action, msg) {
  try { ensureLogSheet().appendRow([new Date(), 'error', `[${action}] ${msg}`, 'api', '']); } catch (_) {}
}

// ── TRIGGER OPCIONAL ──────────────────────────────────────────────────────────
/** Habilite em: Apps Script → Triggers → onSheetEdit → onChange */
function onSheetEdit(e) {
  const webhookUrl = PropertiesService.getScriptProperties().getProperty('WEBHOOK_URL');
  if (!webhookUrl) return;
  try {
    UrlFetchApp.fetch(webhookUrl, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ event: 'sheet_edit', range: e.range.getA1Notation(),
        sheet: e.source.getActiveSheet().getName(), ts: Date.now() }),
    });
  } catch (_) {}
}

// ── SETUP / UTILITÁRIOS ───────────────────────────────────────────────────────

function setupSyncToken() {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', token);
  Logger.log('SYNC_TOKEN criado: ' + token);
  Logger.log('Cole este valor em Secrets do GitHub → SYNC_TOKEN');
}

function testGet() {
  Logger.log(JSON.stringify(handleList({ sheet: SHEET_DADOS }), null, 2));
}

function testSchema() {
  Logger.log(JSON.stringify(handleSchema(), null, 2));
}

/**
 * Cria (ou recria) a aba DADOS_TCT_MODELO com o modelo padrão do SEMA/AC.
 * Execute UMA vez no Apps Script → Executar → criarPlanilhaModelo
 * Depois renomeie a aba para DADOS_PÚBLICOS.
 */
function criarPlanilhaModelo() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const modelName = 'DADOS_TCT_MODELO';
  let sh = ss.getSheetByName(modelName);
  if (sh) { sh.clear(); } else { sh = ss.insertSheet(modelName); }

  // Linha 1: título decorativo
  sh.getRange(1, 1).setValue('SEMA/AC — Termos de Cooperação Técnica');
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#095C18');

  // Linha 2: cabeçalhos reais (lidos pela API)
  const headers = [
    'Tipo', 'Número', 'Objeto', 'Instituição', 'Esfera',
    'Início', 'Término', 'Área', 'SEI', 'Link Documentação', 'Observações',
    'Status', 'Dias Restantes',
  ];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#095C18').setFontColor('#FFFFFF');

  // Linha 3: dados de exemplo
  sh.getRange(3, 1, 1, 11).setValues([[
    'ACT', '01/2025', 'Cooperação técnica para monitoramento ambiental',
    'Exemplo S/A', 'Privado', new Date(2025, 0, 1), new Date(2027, 11, 31),
    'Gestão ambiental', '0820.000001/2025-00', 'https://exemplo.ac.gov.br/doc',
    'Publicado no DOE nº 14.000',
  ]]);

  // Fórmulas de Status (col L=12) e Dias Restantes (col M=13)
  sh.getRange(3, 12).setFormula(
    '=IF(G3="","",IF(TODAY()>G3,"Expirado",IF(G3-TODAY()<=30,"Vence em 30 dias",IF(G3-TODAY()<=90,"A vencer","Vigente"))))'
  );
  sh.getRange(3, 13).setFormula('=IF(G3="","",G3-TODAY())');

  // Formatação
  sh.getRange(3, 6, 100, 1).setNumberFormat('dd/mm/yyyy');  // Início
  sh.getRange(3, 7, 100, 1).setNumberFormat('dd/mm/yyyy');  // Término
  sh.getRange(3, 2, 100, 1).setNumberFormat('@STRING@');    // Número como texto
  [80,100,350,200,90,100,100,160,220,200,200,130,110].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setFrozenRows(2);

  Logger.log('Aba modelo criada: ' + modelName);
  SpreadsheetApp.getUi().alert('Aba "' + modelName + '" criada!\n\nRenomeie para DADOS_PÚBLICOS ao migrar.');
}
