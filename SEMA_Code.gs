/**
 * SEMA/AC — Google Apps Script
 * API REST (somente leitura) para o Painel Público de Acordos de Cooperação Técnica
 *
 * Endpoints GET (JSONP via ?callback=): ping | list | schema | status | export
 * Os dados são editados diretamente na planilha; Status e Dias Restantes
 * são calculados por fórmula automática na aba.
 *
 * VERSÃO 6.0 — SOMENTE LEITURA
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
// FORMULA COLS — colunas calculadas automaticamente pela planilha
// ─────────────────────────────────────────────────────────────

const FORMULA_COLS = {
  'status':        (row, col) => `=IF(${col}${row}="","",IF(TODAY()>${col}${row},"Expirado",IF(${col}${row}-TODAY()<=30,"Vence em 30 dias",IF(${col}${row}-TODAY()<=90,"A vencer","Vigente"))))`,
  'diasRestantes': (row, col) => `=IF(${col}${row}="","",${col}${row}-TODAY())`,
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
  const callback = e.parameter?.callback;
  try {

    const action = (e.parameter?.action || 'list');

    let data;
    switch (action) {

      case 'ping':
        data = handlePing(); break;

      case 'list':
        data = handleList(e.parameter); break;

      case 'schema':
        data = handleSchema(); break;

      case 'status':
        data = handleStatus(); break;

      case 'export':
        return exportCsv();

      default:
        data = { error: 'Ação desconhecida' };
    }

    if (callback) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonResponse(data);

  } catch (err) {

    logError('GET', err);
    const data = { error: err.message };
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonResponse(data);
  }
}

// ─────────────────────────────────────────────────────────────
// PING
// ─────────────────────────────────────────────────────────────

function handlePing() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    ok: true,
    version: '6.0',
    sheet: SHEET_DADOS,
    sheetExists: !!ss.getSheetByName(SHEET_DADOS),
    spreadsheetId: ss.getId().replace(/.{30}$/, '…'),
  };
}

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────

function handleList(params = {}) {

  const sheetName = params.sheet || SHEET_DADOS;

  const cache = CacheService.getScriptCache();
  const cKey  = 'list_' + sheetName;
  const hit   = cache.get(cKey);
  if (hit) { try { return JSON.parse(hit); } catch (_) {} }

  const sheet = getSheet(sheetName);

  const lastCol = sheet.getLastColumn();

  // Cabeçalhos sempre na linha 2 (linha 1 = título decorativo)
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];

  const data = sheet.getDataRange().getValues();

  if (data.length < 3) {
    return {
      records: [],
      count: 0
    };
  }

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

  const result = { records, count: records.length, updated: new Date().toISOString() };
  try { cache.put(cKey, JSON.stringify(result), 30); } catch (_) {}
  return result;
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
    col: i + 1,
    formula: !!FORMULA_COLS[headerKey(h)],
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
    version: '6.0'
  };
}

// ─────────────────────────────────────────────────────────────
// EXPORT CSV
// ─────────────────────────────────────────────────────────────

function exportCsv() {
  const sheet = getSheet(SHEET_DADOS);
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.CSV);
  }

  const SEP  = ';';
  const hdrs = data[1].map(h => String(h || '').trim());
  const lines = [hdrs.map(csvCell).join(SEP)];

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row.some(c => String(c).trim())) continue;
    lines.push(hdrs.map((_, j) => {
      const v = row[j];
      return csvCell(v instanceof Date
        ? Utilities.formatDate(v, 'America/Rio_Branco', 'dd/MM/yyyy')
        : String(v !== undefined && v !== null ? v : ''));
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

// ─────────────────────────────────────────────────────────────
// FORMULA HELPERS (usados por criarPlanilhaModelo)
// ─────────────────────────────────────────────────────────────

function colLetter(n) {
  let s = '';
  while (n > 0) { s = String.fromCharCode(64 + ((n - 1) % 26 + 1)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function applyFormulaRange(sheet, startRow, count, headers) {
  const terminoIdx = headers.findIndex(h => headerKey(String(h)) === 'termino');
  if (terminoIdx < 0) {
    throw new Error('Coluna "Término" não encontrada — as fórmulas de Status/Dias Restantes dependem dela');
  }
  const terminoCol = colLetter(terminoIdx + 1);

  headers.forEach((h, colIdx) => {
    const key = headerKey(String(h));
    if (!FORMULA_COLS[key]) return;
    const formulas = [];
    for (let r = 0; r < count; r++) formulas.push([FORMULA_COLS[key](startRow + r, terminoCol)]);
    const range = sheet.getRange(startRow, colIdx + 1, count, 1);
    range.setFormulas(formulas);
    if (key === 'diasRestantes') range.setNumberFormat('0');
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
// FUNÇÕES DE TESTE / SETUP
// ─────────────────────────────────────────────────────────────

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

  // Colunas I e J = fórmulas automáticas para 500 linhas de dados
  applyFormulaRange(sh, 3, 500, headers);

  // DOE / DOU / SEI / Link / Observação — deixar em branco no exemplo
  sh.getRange(3, 11, 1, 5).setValues([['14.000', '000', '0820.000001/2025-00', 'https://sema.ac.gov.br', 'Exemplo inicial']]);

  // Formatos
  sh.getRange(3, 6, 500, 1).setNumberFormat('dd/mm/yyyy');   // Início (col F)
  sh.getRange(3, 7, 500, 1).setNumberFormat('dd/mm/yyyy');   // Término (col G)
  sh.getRange(3, 10, 500, 1).setNumberFormat('0');           // Dias Restantes como inteiro
  sh.getRange(3, 2, 500, 1).setNumberFormat('@');             // Número como texto

  // Larguras de coluna (px): Tipo|Número|Objeto|Instituição|Esfera|Início|Término|Área|Status|Dias|DOE|DOU|SEI|Link|Obs
  [80, 100, 300, 200, 110, 90, 90, 150, 130, 80, 80, 80, 150, 180, 220]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  sh.setFrozenRows(2);
  sh.setRowHeight(2, 30);

  Logger.log('Aba criada com sucesso: ' + tabName);
  Logger.log('• Linha 2: cabeçalhos (lidos pela API)');
  Logger.log('• Linha 3: exemplo com fórmulas em Status e Dias Restantes');
  Logger.log('• Adicione seus dados a partir da linha 4.');
  Logger.log('• Fórmulas aplicadas até a linha 502 (capacidade de 500 registros).');
  Logger.log('  Para mais de 500 linhas, arraste as fórmulas das colunas Status/Dias Restantes.');
}
