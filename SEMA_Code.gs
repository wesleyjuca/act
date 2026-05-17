/**
 * SEMA/AC — Google Apps Script
 * API REST para Painel de Termos de Cooperação Técnica
 *
 * CONFIGURAÇÃO:
 *  1. Abra o Google Sheets da planilha SEMA_Planilha_TCT_v2
 *  2. Extensões → Apps Script → cole este código
 *  3. Projeto → Propriedades → Adicionar propriedade:
 *       SYNC_TOKEN = <mesma string do config.js>
 *  4. Implantar → Novo implantação → Aplicativo da Web
 *       Executar como: Eu (conta Google)
 *       Quem tem acesso: Qualquer pessoa
 *  5. Copiar URL gerada → config.js → appsScriptUrl
 *
 * ENDPOINTS:
 *  GET  ?action=list&sheet=DADOS_PÚBLICOS     → retorna todos os registros
 *  GET  ?action=schema                         → retorna colunas
 *  GET  ?action=status                         → saúde da API
 *  POST {action:'upsert',   record, token}     → cria/atualiza 1 registro
 *  POST {action:'upsertBatch', records, token} → cria/atualiza N registros
 *  POST {action:'delete', tipo, num, token}    → remove 1 registro
 *  POST {action:'log', entry, token}           → adiciona log na aba LOGS
 */

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const SHEET_DADOS   = 'DADOS_PÚBLICOS';
const SHEET_INTERNO = 'DADOS_INTERNOS';
const SHEET_HIST    = 'HISTÓRICO_ADITIVOS';
const SHEET_LOG     = 'SYNC_LOG';

const COL_PUB = [
  'tipo','num','ano','objeto','inst','esfera',
  'inicio','termino','area','status','diasRestantes',
  'linkDoc','linkSei','obs'
];

const COL_INT = [
  'num','sei','resp','statusInt','dataAssinatura','dataDoe',
  'linkDoe','aditivos','dataUltimoAditivo','alerta','notas',
  'contatoContraparte','emailContraparte'
];

// ── GET HANDLER ───────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || 'list';
    let result;
    switch (action) {
      case 'list':   result = handleList(e.parameter);   break;
      case 'schema': result = handleSchema();            break;
      case 'status': result = handleStatus();            break;
      default:       result = { error: `Ação desconhecida: ${action}` };
    }
    return jsonResponse(result);
  } catch (err) {
    logError('doGet', err.message);
    return jsonResponse({ error: err.message, stack: err.stack });
  }
}

// ── POST HANDLER ──────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!validateToken(body.token)) {
      return jsonResponse({ error: 'Token inválido' }, 403);
    }
    let result;
    switch (body.action) {
      case 'upsert':       result = handleUpsert(body.record, body.sheet);          break;
      case 'upsertBatch':  result = handleUpsertBatch(body.records, body.sheet);    break;
      case 'delete':       result = handleDelete(body.tipo, body.num, body.sheet);  break;
      case 'log':          result = handleLogEntry(body.entry);                     break;
      default:             result = { error: `Ação POST desconhecida: ${body.action}` };
    }
    return jsonResponse(result);
  } catch (err) {
    logError('doPost', err.message);
    return jsonResponse({ error: err.message });
  }
}

// ── AÇÕES GET ─────────────────────────────────────────────────────────────────

function handleList(params) {
  const sheetName = params.sheet || SHEET_DADOS;
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada`, records: [] };

  const data  = sheet.getDataRange().getValues();
  if (data.length < 3) return { records: [], count: 0 };

  const headers = data[1].map(h => String(h).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''));

  const records = [];
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row[1]) continue;  // sem número → linha vazia
    const rec = {};
    headers.forEach((h, j) => {
      const v = row[j];
      rec[h] = v instanceof Date ? Utilities.formatDate(v, 'America/Rio_Branco', 'yyyy-MM-dd') : String(v || '');
    });
    // Também mapeia para chaves canônicas usadas pelo frontend
    rec._ts  = Date.now();
    rec._row = i + 1;
    records.push(rec);
  }

  // Enrichment: também busca dados internos para usuário admin (flag)
  const includeInternal = params.internal === '1';
  if (includeInternal) {
    const intSheet = ss.getSheetByName(SHEET_INTERNO);
    if (intSheet) {
      const intData = intSheet.getDataRange().getValues();
      const intMap  = {};
      for (let i = 2; i < intData.length; i++) {
        const numRef = String(intData[i][0] || '');
        if (numRef) intMap[numRef] = intData[i];
      }
      records.forEach(rec => {
        const intRow = intMap[rec.numero || rec.num || ''];
        if (intRow) {
          rec.sei       = String(intRow[1] || '');
          rec.resp      = String(intRow[2] || '');
          rec.statusInt = String(intRow[3] || '');
          rec.alerta    = String(intRow[9] || '');
          rec.notas     = String(intRow[10] || '');
        }
      });
    }
  }

  logInfo('list', `${records.length} registros retornados`);
  return {
    records,
    count:   records.length,
    sheet:   sheetName,
    updated: new Date().toISOString(),
  };
}

function handleSchema() {
  return {
    publicColumns:   COL_PUB,
    internalColumns: COL_INT,
    sheets: [SHEET_DADOS, SHEET_INTERNO, SHEET_HIST],
  };
}

function handleStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    ok:       true,
    name:     ss.getName(),
    id:       ss.getId(),
    sheets:   ss.getSheets().map(s => s.getName()),
    updated:  new Date().toISOString(),
    version:  '2.0',
  };
}

// ── AÇÕES POST ────────────────────────────────────────────────────────────────

function handleUpsert(record, sheetName) {
  if (!record || !record.tipo || !record.num) {
    return { error: 'Registro inválido: tipo e num são obrigatórios' };
  }
  sheetName = sheetName || SHEET_DADOS;
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada` };

  const data    = sheet.getDataRange().getValues();
  const numCol  = 1;  // coluna B (índice 1) = NÚMERO

  // Procura linha existente
  let targetRow = -1;
  for (let i = 2; i < data.length; i++) {
    if (String(data[i][numCol]) === String(record.num) &&
        String(data[i][0])      === String(record.tipo)) {
      targetRow = i + 1;
      break;
    }
  }

  const rowValues = buildRowValues(record, sheetName);

  if (targetRow > 0) {
    // Atualizar linha existente
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    logInfo('upsert', `Atualizado: ${record.tipo} ${record.num} (linha ${targetRow})`);
    return { ok: true, action: 'updated', row: targetRow };
  } else {
    // Inserir nova linha (após último registro preenchido)
    const lastRow = findLastRow(sheet);
    sheet.getRange(lastRow + 1, 1, 1, rowValues.length).setValues([rowValues]);
    logInfo('upsert', `Inserido: ${record.tipo} ${record.num} (linha ${lastRow + 1})`);
    return { ok: true, action: 'inserted', row: lastRow + 1 };
  }
}

function handleUpsertBatch(records, sheetName) {
  if (!Array.isArray(records) || !records.length) {
    return { error: 'records deve ser um array não vazio' };
  }
  const results = records.map(r => {
    try   { return handleUpsert(r, sheetName); }
    catch (e) { return { error: e.message, num: r.num }; }
  });
  const ok  = results.filter(r => r.ok).length;
  const err = results.filter(r => r.error).length;
  logInfo('upsertBatch', `Lote: ${ok} OK, ${err} erros de ${records.length}`);
  return { ok: true, total: records.length, updated: ok, errors: err, results };
}

function handleDelete(tipo, num, sheetName) {
  if (!tipo || !num) return { error: 'tipo e num são obrigatórios' };
  sheetName = sheetName || SHEET_DADOS;
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada` };

  const data = sheet.getDataRange().getValues();
  for (let i = 2; i < data.length; i++) {
    if (String(data[i][1]) === String(num) &&
        String(data[i][0]) === String(tipo)) {
      sheet.deleteRow(i + 1);
      logInfo('delete', `Removido: ${tipo} ${num}`);
      return { ok: true, row: i + 1 };
    }
  }
  return { ok: false, reason: 'not_found' };
}

function handleLogEntry(entry) {
  ensureLogSheet();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(SHEET_LOG);
  log.appendRow([
    new Date(), entry.level || 'info', entry.msg || '',
    entry.user || 'sistema', entry.ip || ''
  ]);
  return { ok: true };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function buildRowValues(rec, sheetName) {
  if (sheetName === SHEET_DADOS) {
    return [
      rec.tipo || '', rec.num || '',
      rec.ano  || extractYear(rec.num),
      rec.objeto || '', rec.inst || '', rec.esfera || '',
      rec.inicio  ? parseDate(rec.inicio)  : '',
      rec.termino ? parseDate(rec.termino) : '',
      rec.area || '', '', '',   // status e diasRestantes = fórmulas → mantém vazio
      rec.linkDoc || '', rec.linkSei || '', rec.obs || '',
    ];
  }
  if (sheetName === SHEET_INTERNO) {
    return [
      rec.num || '', rec.sei || '', rec.resp || '',
      rec.statusInt || '', rec.dataAssinatura ? parseDate(rec.dataAssinatura) : '',
      rec.dataDoe   ? parseDate(rec.dataDoe) : '',
      rec.linkDoe   || '', rec.aditivos || '',
      rec.dataUltimoAditivo ? parseDate(rec.dataUltimoAditivo) : '',
      rec.alerta || '', rec.notas || '',
      rec.contatoContraparte || '', rec.emailContraparte || '',
    ];
  }
  return Object.values(rec);
}

function extractYear(num) {
  const m = String(num || '').match(/\/(\d{4})$/);
  return m ? parseInt(m[1]) : '';
}

function parseDate(str) {
  if (!str) return '';
  if (str instanceof Date) return str;
  // ISO yyyy-mm-dd ou dd/mm/yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    return new Date(y, m - 1, d);
  }
  return str;
}

function findLastRow(sheet) {
  const vals = sheet.getRange('B:B').getValues();
  let last = 2;
  for (let i = 2; i < vals.length; i++) {
    if (vals[i][0] !== '') last = i;
  }
  return last;
}

function validateToken(token) {
  // Token gerado em 2026-05-17 — rotacionar editando esta constante e js/config.js
  const HARDCODED_TOKEN = '3f033d20-e310-47b4-889d-8e73d87b4c35';
  if (token && token === HARDCODED_TOKEN) return true;
  // Fallback: PropertiesService (caso configurado via setupSyncToken())
  const stored = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  return stored && token && token === stored;
}

function jsonResponse(data, code) {
  const resp = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return resp;
}

// ── LOG SHEET ─────────────────────────────────────────────────────────────────

function ensureLogSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let log   = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    log.appendRow(['Timestamp', 'Nível', 'Mensagem', 'Usuário', 'IP']);
    log.getRange(1, 1, 1, 5).setFontWeight('bold')
       .setBackground('#095C18').setFontColor('#FFFFFF');
  }
  return log;
}

function logInfo(action, msg) {
  try {
    ensureLogSheet();
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const log = ss.getSheetByName(SHEET_LOG);
    log.appendRow([new Date(), 'info', `[${action}] ${msg}`, 'api', '']);
  } catch (_) {}
}

function logError(action, msg) {
  try {
    ensureLogSheet();
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const log = ss.getSheetByName(SHEET_LOG);
    log.appendRow([new Date(), 'error', `[${action}] ${msg}`, 'api', '']);
  } catch (_) {}
}

// ── TRIGGER: Sync reverso (Sheets → sistema via webhook) ──────────────────────
/**
 * Instale o trigger: Relógio → onEdit ou onChange
 * Cada edição na planilha pode notificar um endpoint externo.
 * Habilite em: Apps Script → Triggers → Adicionar trigger → onSheetEdit
 */
function onSheetEdit(e) {
  const webhookUrl = PropertiesService.getScriptProperties().getProperty('WEBHOOK_URL');
  if (!webhookUrl) return;
  try {
    UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        event: 'sheet_edit',
        range: e.range.getA1Notation(),
        sheet: e.source.getActiveSheet().getName(),
        ts:    Date.now(),
      }),
      muteHttpExceptions: true,
    });
  } catch (_) {}
}

// ── TESTE MANUAL ──────────────────────────────────────────────────────────────
function testGet() {
  const result = handleList({ sheet: SHEET_DADOS });
  Logger.log(JSON.stringify(result, null, 2));
}

function testStatus() {
  Logger.log(JSON.stringify(handleStatus(), null, 2));
}

function setupSyncToken() {
  // Execute UMA vez para criar o token nas propriedades do projeto
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', token);
  Logger.log('SYNC_TOKEN criado: ' + token);
  Logger.log('Cole este valor em config.js → syncToken');
}
