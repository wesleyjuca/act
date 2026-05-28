/**
 * SEMA/AC — Google Apps Script
 * API REST para Painel de Termos de Cooperação Técnica
 * VERSÃO CORRIGIDA E ESTÁVEL
 */

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const SHEET_DADOS = 'ACT - PAINEL PUBLICO';
const SHEET_LOG = 'SYNC_LOG';

// ─────────────────────────────────────────────────────────────
// HEADER MAP
// ─────────────────────────────────────────────────────────────

const HEADER_MAP = {
  'tipo': 'tipo',
  'type': 'tipo',

  'num': 'num',
  'numero': 'num',
  'número': 'num',

  'objeto': 'objeto',
  'obj': 'objeto',

  'inst': 'inst',
  'instituicao': 'inst',
  'instituição': 'inst',
  'instituicao_parceira': 'inst',
  'entidade': 'inst',

  'esfera': 'esfera',

  'inicio': 'inicio',
  'início': 'inicio',
  'data_inicio': 'inicio',

  'termino': 'termino',
  'término': 'termino',
  'data_termino': 'termino',

  'area': 'area',
  'área': 'area',

  'status': 'status',
  'situacao': 'status',
  'situação': 'status',

  'diasrestantes': 'diasRestantes',
  'dias_restantes': 'diasRestantes',

  'doe_no': 'doe',
  'doe': 'doe',

  'dou_no': 'dou',
  'dou': 'dou',

  'link': 'link',
  'linkdoc': 'link',
  'link_doc': 'link',
  'link_documentacao': 'link',

  'sei': 'sei',

  'obs': 'obs',
  'observacao': 'obs',
  'observacoes': 'obs',
  'observações': 'obs',
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function headerKey(label) {
  const norm = normHeader(label);
  return HEADER_MAP[norm] || norm;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function validateToken(token) {
  const stored = PropertiesService
    .getScriptProperties()
    .getProperty('SYNC_TOKEN');

  if (!stored) {
    throw new Error('SYNC_TOKEN não configurado');
  }

  return token === stored;
}

function parseDate(value) {
  if (!value) return '';

  if (value instanceof Date) {
    return value;
  }

  const str = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    return new Date(y, m - 1, d);
  }

  return value;
}

function sanitizeCell(value) {
  let str = String(value ?? '');

  // proteção CSV injection
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }

  return str;
}

function numToStr(v) {
  if (v instanceof Date) {
    return String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear();
  }

  return String(v || '').trim();
}

function getSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`Aba '${sheetName}' não encontrada`);
  }

  return sheet;
}

// ─────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────

function doGet(e) {
  try {

    const action = (e.parameter?.action || 'list');

    switch (action) {

      case 'list':
        return jsonResponse(handleList(e.parameter));

      case 'schema':
        return jsonResponse(handleSchema());

      case 'status':
        return jsonResponse(handleStatus());

      default:
        return jsonResponse({
          error: 'Ação desconhecida'
        });
    }

  } catch (err) {

    logError('GET', err);

    return jsonResponse({
      error: err.message
    });
  }
}

// ─────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────

function doPost(e) {

  const lock = LockService.getScriptLock();

  try {

    lock.waitLock(30000);

    const body = JSON.parse(e.postData.contents || '{}');

    if (!validateToken(body.token)) {
      return jsonResponse({
        error: 'Token inválido'
      });
    }

    switch (body.action) {

      case 'upsert':
        return jsonResponse(
          handleUpsert(body.record, body.sheet)
        );

      case 'delete':
        return jsonResponse(
          handleDelete(body.tipo, body.num, body.sheet)
        );

      case 'replaceAll':
        return jsonResponse(
          handleReplaceAll(body.records, body.sheet)
        );

      default:
        return jsonResponse({
          error: 'Ação POST desconhecida'
        });
    }

  } catch (err) {

    logError('POST', err);

    return jsonResponse({
      error: err.message
    });

  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────

function handleList(params = {}) {

  const sheetName = params.sheet || SHEET_DADOS;

  const sheet = getSheet(sheetName);

  const data = sheet.getDataRange().getValues();

  if (data.length < 3) {
    return {
      records: [],
      count: 0
    };
  }

  const headers = data[1];

  const keys = headers.map(h => headerKey(h));

  const records = [];

  for (let i = 2; i < data.length; i++) {

    const row = data[i];

    if (!row.some(c => String(c).trim())) {
      continue;
    }

    const rec = {};

    keys.forEach((k, j) => {

      const v = row[j];

      if (k === 'num' || k === 'tipo') {

        rec[k] = numToStr(v);

      } else if (v instanceof Date) {

        rec[k] = Utilities.formatDate(
          v,
          'America/Rio_Branco',
          'yyyy-MM-dd'
        );

      } else {

        rec[k] = String(v ?? '');
      }

    });

    rec._row = i + 1;

    records.push(rec);
  }

  return {
    records,
    count: records.length,
    updated: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────

function handleSchema() {

  const sheet = getSheet(SHEET_DADOS);

  const headers = sheet
    .getRange(2, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  const columns = headers.map((h, i) => ({
    key: headerKey(h),
    label: h,
    col: i + 1
  }));

  return {
    columns,
    updated: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────

function handleStatus() {

  const sheet = getSheet(SHEET_DADOS);

  return {
    ok: true,
    rows: Math.max(sheet.getLastRow() - 2, 0),
    updated: new Date().toISOString(),
    version: '5.0'
  };
}

// ─────────────────────────────────────────────────────────────
// UPSERT
// ─────────────────────────────────────────────────────────────

function handleUpsert(record, sheetName = SHEET_DADOS) {

  if (!record) {
    throw new Error('Registro inválido');
  }

  const sheet = getSheet(sheetName);

  const data = sheet.getDataRange().getValues();

  const headers = data[1];

  let tipoIdx = 0;
  let numIdx = 1;

  headers.forEach((h, i) => {

    const k = headerKey(h);

    if (k === 'tipo') tipoIdx = i;
    if (k === 'num') numIdx = i;

  });

  const recTipo = String(record.tipo || '')
    .trim()
    .toUpperCase();

  const recNum = String(record.num || '')
    .trim();

  if (!recTipo || !recNum) {
    throw new Error('tipo e num são obrigatórios');
  }

  let targetRow = -1;

  for (let i = 2; i < data.length; i++) {

    const tipo = String(data[i][tipoIdx])
      .trim()
      .toUpperCase();

    const num = numToStr(data[i][numIdx]);

    if (tipo === recTipo && num === recNum) {
      targetRow = i + 1;
      break;
    }
  }

  const rowValues = buildRowValues(record, sheet);

  if (targetRow > 0) {

    sheet
      .getRange(targetRow, 1, 1, rowValues.length)
      .setValues([rowValues]);

    return {
      ok: true,
      action: 'updated',
      row: targetRow
    };
  }

  const newRow = Math.max(sheet.getLastRow(), 2) + 1;

  sheet
    .getRange(newRow, 1, 1, rowValues.length)
    .setValues([rowValues]);

  return {
    ok: true,
    action: 'inserted',
    row: newRow
  };
}

// ─────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────

function handleDelete(tipo, num, sheetName = SHEET_DADOS) {

  const sheet = getSheet(sheetName);

  const data = sheet.getDataRange().getValues();

  const headers = data[1];

  let tipoIdx = 0;
  let numIdx = 1;

  headers.forEach((h, i) => {

    const k = headerKey(h);

    if (k === 'tipo') tipoIdx = i;
    if (k === 'num') numIdx = i;
  });

  for (let i = 2; i < data.length; i++) {

    const rowTipo = String(data[i][tipoIdx])
      .trim()
      .toUpperCase();

    const rowNum = numToStr(data[i][numIdx]);

    if (
      rowTipo === String(tipo).trim().toUpperCase() &&
      rowNum === String(num).trim()
    ) {

      sheet.deleteRow(i + 1);

      return {
        ok: true,
        row: i + 1
      };
    }
  }

  return {
    ok: false,
    reason: 'not_found'
  };
}

// ─────────────────────────────────────────────────────────────
// REPLACE ALL
// ─────────────────────────────────────────────────────────────

function handleReplaceAll(records, sheetName = SHEET_DADOS) {

  if (!Array.isArray(records)) {
    throw new Error('records deve ser array');
  }

  const sheet = getSheet(sheetName);

  const lastCol = sheet.getLastColumn();

  const headers = sheet
    .getRange(2, 1, 1, lastCol)
    .getValues()[0];

  const rows = records.map(rec => {

    return headers.map(h => {

      const key = headerKey(h);

      const value = rec[key] ?? '';

      const sanitized = sanitizeCell(value);

      return parseDate(sanitized);

    });

  });

  if (sheet.getLastRow() >= 3) {

    sheet
      .getRange(
        3,
        1,
        sheet.getLastRow() - 2,
        lastCol
      )
      .clearContent();
  }

  if (rows.length > 0) {

    sheet
      .getRange(3, 1, rows.length, rows[0].length)
      .setValues(rows);
  }

  return {
    ok: true,
    replaced: rows.length
  };
}

// ─────────────────────────────────────────────────────────────
// BUILD ROW
// ─────────────────────────────────────────────────────────────

function buildRowValues(record, sheet) {

  const headers = sheet
    .getRange(2, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  return headers.map(h => {

    const key = headerKey(h);

    const value = sanitizeCell(
      record[key] ?? ''
    );

    return parseDate(value);
  });
}

// ─────────────────────────────────────────────────────────────
// LOG
// ─────────────────────────────────────────────────────────────

function ensureLogSheet() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let log = ss.getSheetByName(SHEET_LOG);

  if (!log) {

    log = ss.insertSheet(SHEET_LOG);

    log.appendRow([
      'Timestamp',
      'Level',
      'Action',
      'Message'
    ]);
  }

  return log;
}

function logInfo(action, message) {

  try {

    ensureLogSheet().appendRow([
      new Date(),
      'INFO',
      action,
      String(message)
    ]);

  } catch (_) {}
}

function logError(action, err) {

  try {

    ensureLogSheet().appendRow([
      new Date(),
      'ERROR',
      action,
      err.message || String(err)
    ]);

  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────
// SETUP TOKEN
// ─────────────────────────────────────────────────────────────

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
 * Cria (ou recria) a aba 'ACT - PAINEL PUBLICO' com o modelo padrão do SEMA/AC.
 * Execute UMA vez no Apps Script → Executar → criarPlanilhaModelo
 *
 * Colunas: Tipo | Número | Objeto | Instituição | Esfera | Início | Término |
 *          Área | Status* | Dias Restantes* | DOE Nº | DOU Nº | SEI | Link | Observação
 *  (* = fórmula automática baseada na coluna Término)
 */
function criarPlanilhaModelo() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const tabName  = SHEET_DADOS;   // 'ACT - PAINEL PUBLICO'
  let sh = ss.getSheetByName(tabName);
  if (sh) { sh.clear(); } else { sh = ss.insertSheet(tabName); }

  // Linha 1: título decorativo (mesclado)
  const nCols = 15;
  sh.getRange(1, 1, 1, nCols).merge();
  sh.getRange(1, 1).setValue('SEMA/AC — Acordos de Cooperação Técnica — Acre')
    .setFontSize(13).setFontWeight('bold')
    .setFontColor('#FFFFFF').setBackground('#095C18')
    .setHorizontalAlignment('center');

  // Linha 2: cabeçalhos reais (exatamente como o sistema os lê)
  const headers = [
    'Tipo', 'Número', 'Objeto', 'Instituição', 'Esfera',
    'Início', 'Término', 'Área',
    'Status', 'Dias Restantes',
    'DOE Nº', 'DOU Nº', 'SEI', 'Link', 'Observação',
  ];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1FAD35').setFontColor('#FFFFFF')
    .setWrap(true);

  // Linha 3: exemplo + fórmulas
  sh.getRange(3, 1, 1, 8).setValues([[
    'ACT', '001/2025',
    'Cooperação técnica para monitoramento ambiental',
    'Exemplo Instituição', 'Estadual',
    new Date(2025, 0, 1), new Date(2027, 11, 31),
    'Recursos Hídricos',
  ]]);

  // Col I (9) = Status — fórmula automática baseada em Término (col G=7)
  sh.getRange(3, 9).setFormula(
    '=IF(G3="","",IF(TODAY()>G3,"Expirado",IF(G3-TODAY()<=30,"Vence em 30 dias",IF(G3-TODAY()<=90,"A vencer","Vigente"))))'
  );
  // Col J (10) = Dias Restantes
  sh.getRange(3, 10).setFormula('=IF(G3="","",G3-TODAY())');

  // DOE / DOU / SEI / Link / Observação — deixar em branco no exemplo
  sh.getRange(3, 11, 1, 5).setValues([['14.000', '000', '0820.000001/2025-00', 'https://sema.ac.gov.br', 'Exemplo inicial']]);

  // Formatos
  sh.getRange(3, 6, 500, 1).setNumberFormat('dd/mm/yyyy');   // Início (col F)
  sh.getRange(3, 7, 500, 1).setNumberFormat('dd/mm/yyyy');   // Término (col G)
  sh.getRange(3, 10, 500, 1).setNumberFormat('0');           // Dias Restantes como inteiro
  sh.getRange(3, 2, 500, 1).setNumberFormat('@STRING@');     // Número como texto

  // Larguras de coluna (px): Tipo|Número|Objeto|Instituição|Esfera|Início|Término|Área|Status|Dias|DOE|DOU|SEI|Link|Obs
  [80, 100, 300, 200, 110, 90, 90, 150, 130, 80, 80, 80, 150, 180, 220]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  sh.setFrozenRows(2);
  sh.setRowHeight(2, 30);

  Logger.log('Aba criada: ' + tabName);
  SpreadsheetApp.getUi().alert(
    'Aba "' + tabName + '" criada com sucesso!\n\n' +
    '• Linha 2: cabeçalhos (lidos pela API)\n' +
    '• Linha 3: exemplo com fórmulas em Status e Dias Restantes\n' +
    '• Adicione seus dados a partir da linha 4.'
  );
}
