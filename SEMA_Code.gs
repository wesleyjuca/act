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

// Mapeamento explícito de cabeçalhos da planilha → chaves do frontend
// Evita depender de normalização frágil por regex
const HEADER_MAP = {
  'tipo': 'tipo', 'type': 'tipo',
  'num': 'num', 'numero': 'num', 'número': 'num',
  'ano': 'ano', 'year': 'ano',
  'objeto': 'objeto', 'obj': 'objeto', 'object': 'objeto',
  'inst': 'inst', 'instituicao': 'inst', 'instituição': 'inst', 'institution': 'inst',
  'instituicao_parceira': 'inst', 'instituicao parceira': 'inst',
  'institucao_parceira': 'inst', 'nome_da_entidade': 'inst', 'entidade': 'inst',
  'esfera': 'esfera', 'sphere': 'esfera',
  'inicio': 'inicio', 'início': 'inicio', 'data_inicio': 'inicio', 'start': 'inicio',
  'termino': 'termino', 'término': 'termino', 'data_termino': 'termino', 'end': 'termino',
  'area': 'area', 'área': 'area',
  'status': 'status', 'situacao': 'status',
  'diasrestantes': 'diasRestantes', 'dias_restantes': 'diasRestantes',
  'linkdoc': 'link', 'link_doc': 'link', 'link': 'link',
  'linksei': 'linkSei', 'link_sei': 'linkSei',
  'obs': 'obs', 'observacoes': 'obs', 'observações': 'obs',
  'sei': 'sei',
  'resp': 'resp', 'responsavel': 'resp', 'responsável': 'resp',
  'statusint': 'statusInt', 'status_int': 'statusInt', 'situacao_interna': 'statusInt',
  'alerta': 'alerta',
  'notas': 'notas', 'notes': 'notas',
};

const COL_PUB = [
  'tipo','num','ano','objeto','inst','esfera',
  'inicio','termino','area','status','diasRestantes',
  'linkDoc','linkSei','obs','sei'
];

const COL_INT = [
  'num','sei','resp','statusInt','dataAssinatura','dataDoe',
  'linkDoe','aditivos','dataUltimoAditivo','alerta','notas',
  'contatoContraparte','emailContraparte'
];

// ── GET HANDLER ───────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    // Rate limiting em GET: max 120 req/min (suficiente para sync periódico público)
    const rlCache = CacheService.getScriptCache();
    const rlKey = 'rl_get_' + new Date().toISOString().slice(0, 16); // por minuto
    const rlCount = parseInt(rlCache.get(rlKey) || '0') + 1;
    rlCache.put(rlKey, String(rlCount), 90);
    if (rlCount > 120) {
      return jsonResponse({ error: 'rate_limit', message: 'Muitas requisições. Aguarde 1 minuto.' });
    }

    const action = (e.parameter && e.parameter.action) || 'list';
    let result;
    switch (action) {
      case 'list':       result = handleList(e.parameter);              break;
      case 'history':    result = handleGetHistory(e.parameter);       break;
      case 'schema':     result = handleSchema();                       break;
      case 'status':     result = handleStatus();                       break;
      case 'getConfig':  result = handleGetConfig();                    break;
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
    // Suporta plain JSON (text/plain) e application/x-www-form-urlencoded
    // Nota: e.parameter NÃO é populado pelo body POST no GAS — usar e.postData
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
      return jsonResponse({ error: 'Token inválido' }, 403);
    }
    // Rate limiting simples: max 30 req/min por prefixo de token
    const cache = CacheService.getScriptCache();
    const rlKey = 'rl_' + String(body.token || '').slice(0, 12);
    const rlCount = parseInt(cache.get(rlKey) || '0') + 1;
    cache.put(rlKey, String(rlCount), 60);
    if (rlCount > 30) {
      return jsonResponse({ error: 'rate_limit', message: 'Muitas requisições. Aguarde 1 minuto.' }, 429);
    }
    let result;
    switch (body.action) {
      case 'upsert':       result = handleUpsert(body.record, body.sheet);          break;
      case 'upsertBatch':  result = handleUpsertBatch(body.records, body.sheet);    break;
      case 'delete':       result = handleDelete(body.tipo, body.num, body.sheet);  break;
      case 'log':          result = handleLogEntry(body.entry);                     break;
      case 'addHistory':   result = handleAddHistory(body.entries);                 break;
      case 'saveConfig':   result = handleSaveConfig(body.config);                  break;
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

  const headers = data[1].map(h => {
    const normalized = String(h).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return HEADER_MAP[normalized] || HEADER_MAP[String(h).trim().toLowerCase()] || normalized;
  });

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

  enrichFromInternal(records, ss, params.internal === '1');

  // Paginação opcional: ?limit=N&offset=N
  const total  = records.length;
  const limit  = parseInt(params.limit  || '0');
  const offset = parseInt(params.offset || '0');
  const paged  = (limit > 0) ? records.slice(offset, offset + limit) : records;

  logInfo('list', `${paged.length}/${total} registros retornados`);
  return {
    records: paged,
    count:   paged.length,
    total,
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

  // Procura linha existente (trim + case-insensitive no tipo)
  const _tipUps = String(record.tipo).trim().toUpperCase();
  const _numUps = String(record.num).trim();
  let targetRow = -1;
  for (let i = 2; i < data.length; i++) {
    if (String(data[i][numCol]).trim()               === _numUps &&
        String(data[i][0]).trim().toUpperCase() === _tipUps) {
      targetRow = i + 1;
      break;
    }
  }

  // Timestamp server-side garante resolução correta de conflitos
  record._ts_server = Date.now();
  if (!record._ts) record._ts = record._ts_server;

  const rowValues = buildRowValues(record, sheetName);

  if (targetRow > 0) {
    // Atualizar linha existente
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    logInfo('upsert', `Atualizado: ${record.tipo} ${record.num} (linha ${targetRow})`);
    return { ok: true, action: 'updated', row: targetRow, _ts_server: record._ts_server };
  } else {
    // Inserir nova linha (após último registro preenchido)
    const lastRow = findLastRow(sheet);
    sheet.getRange(lastRow + 1, 1, 1, rowValues.length).setValues([rowValues]);
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

  // Leitura única: construir mapa tipo+num → linha 1-based (normalizado)
  const data   = sheet.getDataRange().getValues();
  const rowMap = new Map();
  for (let i = 2; i < data.length; i++) {
    if (data[i][1]) {
      const k = `${String(data[i][0]).trim().toUpperCase()}|${String(data[i][1]).trim()}`;
      rowMap.set(k, i + 1);
    }
  }

  let updated = 0, inserted = 0, errors = 0;
  const toInsert = [];

  for (const r of records) {
    try {
      if (!r || !r.tipo || !r.num) { errors++; continue; }
      r._ts_server = Date.now();
      if (!r._ts) r._ts = r._ts_server;
      const rowValues = buildRowValues(r, sheetName);
      const key = `${String(r.tipo).trim().toUpperCase()}|${String(r.num).trim()}`;
      if (rowMap.has(key)) {
        sheet.getRange(rowMap.get(key), 1, 1, rowValues.length).setValues([rowValues]);
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
    inserted = toInsert.length;
  }

  logInfo('upsertBatch', `Lote: ${updated} atualizados, ${inserted} inseridos, ${errors} erros de ${records.length}`);
  return { ok: true, total: records.length, updated, inserted, errors };
}

function handleDelete(tipo, num, sheetName) {
  if (!tipo || !num) return { error: 'tipo e num são obrigatórios' };
  sheetName = sheetName || SHEET_DADOS;
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `Aba '${sheetName}' não encontrada` };

  const data = sheet.getDataRange().getValues();
  const tipNorm = String(tipo).trim().toUpperCase();
  const numNorm = String(num).trim();
  for (let i = 2; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === tipNorm &&
        String(data[i][1]).trim()               === numNorm) {
      sheet.deleteRow(i + 1);
      logInfo('delete', `Removido: ${tipo} ${num}`);
      return { ok: true, row: i + 1 };
    }
  }
  return { ok: false, reason: 'not_found' };
}

// ── CONFIG DE VISIBILIDADE ────────────────────────────────────────────────────

const DEFAULT_VISIBLE_FIELDS = [
  'objeto','inst','esfera','inicio','termino','area','obs','sei','linkDoc'
];

function handleGetConfig() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('SEMA_FIELDS_CONFIG');
  if (raw) {
    try {
      const cfg = JSON.parse(raw);
      return { ok: true, config: cfg };
    } catch(_) {}
  }
  return { ok: true, config: { visibleFields: DEFAULT_VISIBLE_FIELDS } };
}

function handleSaveConfig(config) {
  if (!config || !Array.isArray(config.visibleFields)) {
    return { error: 'config.visibleFields deve ser um array' };
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SEMA_FIELDS_CONFIG', JSON.stringify(config));
  logInfo('saveConfig', 'Configuração de campos salva');
  return { ok: true };
}

function handleAddHistory(entries) {
  if (!Array.isArray(entries) || !entries.length) return { error: 'entries deve ser array não vazio' };
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  let hist   = ss.getSheetByName(SHEET_HIST);
  if (!hist) {
    hist = ss.insertSheet(SHEET_HIST);
    hist.appendRow(['Timestamp', 'Tipo', 'Num', 'Campo', 'Valor Anterior', 'Valor Novo', 'Usuário']);
    hist.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#095C18').setFontColor('#FFFFFF');
  }
  const rows = entries.map(e => [new Date(), e.tipo || '', e.num || '', e.campo || '', e.antes || '', e.depois || '', 'admin']);
  hist.getRange(hist.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
  logInfo('addHistory', `${rows.length} alterações registradas`);
  return { ok: true, count: rows.length };
}

function handleGetHistory(params) {
  const tipo = params.tipo || '';
  const num  = params.num  || '';
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const hist = ss.getSheetByName(SHEET_HIST);
  if (!hist) return { entries: [], count: 0 };
  const data = hist.getDataRange().getValues();
  const entries = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if ((tipo && String(row[1]) !== tipo) || (num && String(row[2]) !== num)) continue;
    entries.push({
      ts:    row[0] instanceof Date ? Utilities.formatDate(row[0], 'America/Rio_Branco', 'yyyy-MM-dd HH:mm:ss') : String(row[0]),
      tipo:  String(row[1]), num:   String(row[2]), campo: String(row[3]),
      antes: String(row[4]), depois:String(row[5]), usuario: String(row[6]),
    });
  }
  return { entries, count: entries.length };
}

function handleLogEntry(entry) {
  ensureLogSheet().appendRow([
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
      rec.linkDoc || rec.link || '', rec.linkSei || '', rec.obs || '', rec.sei || '',
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

// Enrich records from DADOS_INTERNOS with a single read
// fullInternal=true also includes resp, statusInt, alerta, notas
function enrichFromInternal(records, ss, fullInternal) {
  const intSheet = ss.getSheetByName(SHEET_INTERNO);
  if (!intSheet) return;
  const intData = intSheet.getDataRange().getValues();
  const intMap  = {};
  for (let i = 2; i < intData.length; i++) {
    const k = String(intData[i][0] || '').trim();
    if (k) intMap[k] = intData[i];
  }
  records.forEach(rec => {
    const row = intMap[(rec.num || rec.numero || '').trim()];
    if (!row) return;
    rec.sei = String(row[1] || '');
    if (fullInternal) {
      rec.resp      = String(row[2]  || '');
      rec.statusInt = String(row[3]  || '');
      rec.alerta    = String(row[9]  || '');
      rec.notas     = String(row[10] || '');
    }
  });
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
  return '';
}

function findLastRow(sheet) {
  return Math.max(sheet.getLastRow(), 2);
}

function validateToken(token) {
  // Preferir SYNC_TOKEN das propriedades do projeto; fallback para valor hardcoded
  const stored = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN')
              || '27f2b931-2773-4198-9edd-261047aa5ec7-9a263f1b-488d-4a6d-81a1-dfe1704acf29';
  if (!token || token.length !== stored.length) return false;
  // Comparação de comprimento constante para mitigar timing attacks
  let match = true;
  for (let i = 0; i < stored.length; i++) { if (token[i] !== stored[i]) match = false; }
  return match;
}

function jsonResponse(data, code) {
  const resp = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return resp;
}

// ── LOG SHEET ─────────────────────────────────────────────────────────────────

let _logSheet = null;  // cached per-execution to avoid repeated getSheetByName calls

function ensureLogSheet() {
  if (_logSheet) return _logSheet;
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let log   = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    log.appendRow(['Timestamp', 'Nível', 'Mensagem', 'Usuário', 'IP']);
    log.getRange(1, 1, 1, 5).setFontWeight('bold')
       .setBackground('#095C18').setFontColor('#FFFFFF');
  }
  _logSheet = log;
  return _logSheet;
}

function logInfo(action, msg) {
  try {
    ensureLogSheet().appendRow([new Date(), 'info', `[${action}] ${msg}`, 'api', '']);
  } catch (_) {}
}

function logError(action, msg) {
  try {
    ensureLogSheet().appendRow([new Date(), 'error', `[${action}] ${msg}`, 'api', '']);
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

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const create = (name, headers) => {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name);
    // Linha 1: título decorativo (convenção das abas existentes)
    sh.appendRow([name]);
    sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
    // Linha 2: cabeçalho real lido por handleList (data[1] = índice 1 = linha 2)
    sh.appendRow(headers);
    sh.getRange(2, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#095C18').setFontColor('#FFFFFF');
  };
  create(SHEET_DADOS,   COL_PUB);
  create(SHEET_INTERNO, COL_INT);
  create(SHEET_HIST,    ['tipo','num','data','aditivo_num','descricao']);
  ensureLogSheet();
  logInfo('setup', 'Planilha inicializada');
}

function setupSyncToken() {
  // Execute UMA vez para criar o token nas propriedades do projeto
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', token);
  Logger.log('SYNC_TOKEN criado: ' + token);
  Logger.log('Cole este valor em config.js → syncToken');
}
