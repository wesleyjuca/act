/**
 * SEMA/AC — Google Apps Script
 * API REST (somente leitura) para o Painel Público de Acordos de Cooperação Técnica
 *
 * Endpoints GET (JSONP via ?callback=): ping | list | schema | status | export
 * Os dados são editados diretamente na planilha; Status e Dias Restantes
 * são calculados por fórmula automática na aba.
 *
 * VERSÃO 7.0 — SOMENTE LEITURA + SETUP/MIGRAÇÃO
 */

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const SHEET_DADOS     = 'ACT - PAINEL PUBLICO';
const SHEET_LOG       = 'SYNC_LOG';
const SHEET_HISTORICO = 'ACT_HISTORICO';
const SHEET_SAUDE     = 'SAUDE_SISTEMA';

// ─────────────────────────────────────────────────────────────
// HEADER MAP — normaliza nomes de colunas para chaves internas
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

  'area': 'area',
  'área': 'area',

  'inicio': 'inicio',
  'início': 'inicio',
  'data_inicio': 'inicio',

  'termino': 'termino',
  'término': 'termino',
  'data_termino': 'termino',

  'prazo_indeterminado': 'prazoIndeterminado',
  'prazoindeterminado':  'prazoIndeterminado',

  'status': 'status',
  'situacao': 'status',
  'situação': 'status',

  'diasrestantes': 'diasRestantes',
  'dias_restantes': 'diasRestantes',

  'doe_no': 'doe',
  'doe_n':  'doe',   // corrige bug "DOE Nº" → doe_n
  'doe': 'doe',

  'dou_no': 'dou',
  'dou_n':  'dou',   // corrige bug "DOU Nº" → dou_n
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
  'observacao': 'obs',

  'data_assinatura':  'dataAssinatura',
  'dataassinatura':   'dataAssinatura',

  'data_publicacao':  'dataPublicacao',
  'data_publicaccao': 'dataPublicacao',
  'datapublicacao':   'dataPublicacao',

  'data_publicacao':  'dataPublicacao',

  'data_cadastro':    'dataCadastro',
  'datacadastro':     'dataCadastro',

  'data_atualizacao': 'dataAtualizacao',
  'dataatualizacao':  'dataAtualizacao',

  'responsavel':      'responsavel',
  'responsável':      'responsavel',
};

// ─────────────────────────────────────────────────────────────
// FORMULA COLS — geradores de fórmula que referenciam 2 colunas
// ─────────────────────────────────────────────────────────────

const FORMULA_COLS = {
  status: (row, cols) => {
    const T = cols.termino;
    const P = cols.prazoIndeterminado;
    if (!T) return null;
    const prazoCheck = P
      ? `OR(${P}${row}=TRUE;${T}${row}="")`
      : `${T}${row}=""`;
    return `=IF(${prazoCheck};"Prazo Indeterminado";IF(TODAY()>${T}${row};"Expirado";IF(${T}${row}-TODAY()<=30;"Vence em 30 dias";IF(${T}${row}-TODAY()<=90;"A vencer";"Vigente"))))`;
  },

  diasRestantes: (row, cols) => {
    const T = cols.termino;
    const P = cols.prazoIndeterminado;
    if (!T) return null;
    const skip = P
      ? `OR(${P}${row}=TRUE;${T}${row}="")`
      : `${T}${row}=""`;
    return `=IF(${skip};"";${T}${row}-TODAY())`;
  },
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function headerKey(label) {
  const norm = normHeader(label);
  return HEADER_MAP[norm] || norm;
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(64 + ((n - 1) % 26 + 1)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function isValidJsonpCallback(callback) {
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(String(callback || ''));
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
  if (!sheet) throw new Error(`Aba '${sheetName}' não encontrada`);
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// FORMULA HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Aplica fórmulas automáticas dinamicamente — sem limite fixo de linhas.
 * Detecta colunas Término e Prazo_Indeterminado por HEADER_MAP.
 */
function applyFormulaRangeDynamic(sheet, startRow, headers) {
  const terminoIdx    = headers.findIndex(h => headerKey(String(h)) === 'termino');
  const prazoIndIdx   = headers.findIndex(h => headerKey(String(h)) === 'prazoIndeterminado');
  if (terminoIdx < 0) return; // sem Término → sem fórmulas automáticas

  const cols = {
    termino:            colLetter(terminoIdx + 1),
    prazoIndeterminado: prazoIndIdx >= 0 ? colLetter(prazoIndIdx + 1) : null,
  };

  const maxRow = sheet.getMaxRows();
  const count  = Math.max(maxRow - startRow + 1, 1);

  headers.forEach((h, colIdx) => {
    const key = headerKey(String(h));
    const gen = FORMULA_COLS[key];
    if (!gen) return;

    const formulas = [];
    for (let r = 0; r < count; r++) {
      const f = gen(startRow + r, cols);
      formulas.push([f || '']);
    }
    const range = sheet.getRange(startRow, colIdx + 1, count, 1);
    range.setFormulas(formulas);
    if (key === 'diasRestantes') range.setNumberFormat('0');
  });
}

// ─────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────

function doGet(e) {
  const callback = e.parameter?.callback;
  const useJsonp = callback && isValidJsonpCallback(callback);
  const hasInvalidJsonpCallback = callback && !useJsonp;
  try {
    const action = (e.parameter?.action || 'list');
    let data;
    switch (action) {
      case 'ping':   data = handlePing();         break;
      case 'list':   data = handleList(e.parameter); break;
      case 'schema': data = handleSchema();        break;
      case 'status': data = handleStatus();        break;
      case 'export': return exportCsv();
      default:       data = { error: 'Ação desconhecida' };
    }

    if (hasInvalidJsonpCallback) return jsonResponse({ error: 'Callback JSONP inválido' });
    if (useJsonp) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonResponse(data);

  } catch (err) {
    logError('GET', err);
    const data = { error: err.message };
    if (hasInvalidJsonpCallback) return jsonResponse({ error: 'Callback JSONP inválido' });
    if (useJsonp) {
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
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_DADOS);
  const warnings = [];
  const requiredColumns = [
    { label: 'Tipo',                key: 'tipo'              },
    { label: 'Número',              key: 'num'               },
    { label: 'Objeto',              key: 'objeto'            },
    { label: 'Instituição',         key: 'inst'              },
    { label: 'Término',             key: 'termino'           },
    { label: 'Status',              key: 'status'            },
    { label: 'Dias_Restantes',      key: 'diasRestantes'     },
    { label: 'Prazo_Indeterminado', key: 'prazoIndeterminado'},
    { label: 'Data_Cadastro',       key: 'dataCadastro'      },
  ];

  let headers = [];
  let missingRequiredColumns = requiredColumns.map(c => c.label);
  let dataRows = 0;

  if (!sheet) {
    warnings.push(`Aba '${SHEET_DADOS}' não encontrada.`);
  } else {
    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();

    if (lastCol === 0) {
      warnings.push('A aba existe, mas não possui cabeçalhos na linha 2.');
    } else {
      headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0]
        .map(h => String(h || '').trim());

      const foundKeys = headers.reduce((acc, header) => {
        const key = headerKey(header);
        if (key) acc[key] = true;
        return acc;
      }, {});

      missingRequiredColumns = requiredColumns
        .filter(col => !foundKeys[col.key])
        .map(col => col.label);
    }

    if (lastRow >= 3 && lastCol > 0) {
      const rows = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
      dataRows = rows.filter(row =>
        row.some(cell => String(cell === undefined || cell === null ? '' : cell).trim())
      ).length;
    }
  }

  if (missingRequiredColumns.length) {
    warnings.push('Colunas obrigatórias ausentes: ' + missingRequiredColumns.join(', ') + '.');
  }

  const result = {
    ok: !!sheet && missingRequiredColumns.length === 0,
    version: '7.0',
    sheet: SHEET_DADOS,
    sheetExists: !!sheet,
    spreadsheetId: ss.getId().replace(/.{30}$/, '…'),
    headers,
    missingRequiredColumns,
    dataRows,
    warnings,
  };

  // Atualiza aba SAUDE_SISTEMA como efeito colateral do ping
  try { _atualizarSaude(ss, result, dataRows); } catch(_) {}

  return result;
}

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────

function handleList(params = {}) {
  const cache = CacheService.getScriptCache();
  const cKey  = 'list_public';
  const hit   = cache.get(cKey);
  if (hit) { try { return JSON.parse(hit); } catch (_) {} }

  const sheet   = getSheet(SHEET_DADOS);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const data    = sheet.getDataRange().getValues();

  if (data.length < 3) return { records: [], count: 0 };

  const keys    = headers.map(h => headerKey(h));
  const records = [];

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row.some(c => String(c).trim())) continue;

    const rec = {};
    keys.forEach((k, j) => {
      const v = row[j];
      if (k === 'num' || k === 'tipo') {
        rec[k] = numToStr(v);
      } else if (typeof v === 'boolean') {
        rec[k] = v ? 'TRUE' : 'FALSE';
      } else if (v instanceof Date) {
        rec[k] = Utilities.formatDate(v, 'America/Rio_Branco', 'yyyy-MM-dd');
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
  const sheet   = getSheet(SHEET_DADOS);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];

  const columns = headers.map((h, i) => ({
    key:     headerKey(h),
    label:   h,
    col:     i + 1,
    formula: !!FORMULA_COLS[headerKey(h)],
  }));

  return { columns, updated: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────

function handleStatus() {
  const sheet = getSheet(SHEET_DADOS);
  return {
    ok:      true,
    rows:    Math.max(sheet.getLastRow() - 2, 0),
    updated: new Date().toISOString(),
    version: '7.0',
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
      if (typeof v === 'boolean') return csvCell(v ? 'TRUE' : 'FALSE');
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
// LOG
// ─────────────────────────────────────────────────────────────

function ensureLogSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let log   = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    log.appendRow(['Timestamp', 'Level', 'Action', 'Message']);
  }
  return log;
}

function logError(action, err) {
  try {
    ensureLogSheet().appendRow([new Date(), 'ERROR', action, err.message || String(err)]);
  } catch (_) {}
}

function logInfo(action, msg) {
  try {
    ensureLogSheet().appendRow([new Date(), 'INFO', action, msg]);
    Logger.log('[INFO] ' + action + ': ' + msg);
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────
// BACKUP
// ─────────────────────────────────────────────────────────────

function _criarBackup(ss, sheetName) {
  const src = ss.getSheetByName(sheetName);
  if (!src) return null;
  const ts   = Utilities.formatDate(new Date(), 'America/Rio_Branco', 'yyyyMMdd_HHmmss');
  const name = 'ACT_BACKUP_' + ts;
  const copy = src.copyTo(ss);
  copy.setName(name);
  logInfo('_criarBackup', 'Backup criado: ' + name);
  return name;
}

// ─────────────────────────────────────────────────────────────
// ABAS AUXILIARES
// ─────────────────────────────────────────────────────────────

function _garantirAbasAuxiliares(ss) {
  // ACT_HISTORICO
  if (!ss.getSheetByName(SHEET_HISTORICO)) {
    const h = ss.insertSheet(SHEET_HISTORICO);
    h.appendRow(['Timestamp', 'Aba', 'Linha', 'Coluna', 'Valor_Anterior', 'Valor_Novo', 'Usuário']);
    h.setFrozenRows(1);
    h.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1FAD35').setFontColor('#FFFFFF');
  }

  // SAUDE_SISTEMA
  if (!ss.getSheetByName(SHEET_SAUDE)) {
    const s = ss.insertSheet(SHEET_SAUDE);
    s.appendRow(['Chave', 'Valor', 'Atualizado_em']);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#095C18').setFontColor('#FFFFFF');
    [['versao', '7.0', new Date()], ['totalRegistros', 0, ''], ['ultimaSincronizacao', '', ''],
     ['cacheSegundos', 30, ''], ['abas_ok', '', '']].forEach(row => s.appendRow(row));
  }
}

function _atualizarSaude(ss, pingResult, dataRows) {
  const sheet = ss.getSheetByName(SHEET_SAUDE);
  if (!sheet) return;
  const now = new Date();
  const data = sheet.getDataRange().getValues();
  const map  = {};
  data.forEach((row, i) => { if (i > 0 && row[0]) map[row[0]] = i + 1; });

  const set = (key, val) => {
    if (map[key]) sheet.getRange(map[key], 2, 1, 2).setValues([[val, now]]);
  };
  set('versao',             '7.0');
  set('totalRegistros',     dataRows);
  set('ultimaSincronizacao', now.toISOString());
  set('abas_ok', pingResult.ok ? 'SIM' : 'NÃO — ' + (pingResult.warnings || []).join('; '));
}

// ─────────────────────────────────────────────────────────────
// ON EDIT TRIGGER
// ─────────────────────────────────────────────────────────────

function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_DADOS) return;
    const row = e.range.getRow();
    if (row < 3) return;
    const col     = e.range.getColumn();
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    const colName = String(headers[col - 1] || ('Col ' + col));
    const key     = headerKey(colName);
    // Não registrar colunas de fórmula automática
    if (key === 'status' || key === 'diasRestantes') return;
    _appendHistorico(sheet.getName(), row, colName,
      String(e.oldValue !== undefined ? e.oldValue : ''),
      String(e.value    !== undefined ? e.value    : ''));
  } catch (_) {}
}

function _appendHistorico(aba, row, col, before, after) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  let hist   = ss.getSheetByName(SHEET_HISTORICO);
  if (!hist) { _garantirAbasAuxiliares(ss); hist = ss.getSheetByName(SHEET_HISTORICO); }
  if (!hist) return;
  hist.appendRow([new Date(), aba, row, col, before, after, '']);
}

function instalarTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onEdit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onEdit').forSpreadsheet(ss).onEdit().create();
  Logger.log('Trigger onEdit instalado com sucesso.');
}

// ─────────────────────────────────────────────────────────────
// CRIAR PLANILHA MODELO — v7.0 (reescrita completa)
// ─────────────────────────────────────────────────────────────

/**
 * Cria (ou recria) a aba 'ACT - PAINEL PUBLICO' com o modelo padrão v7.0.
 * Antes de recriar, faz backup automático se houver dados.
 * Usa delete+recreate para evitar bugs de clear/merge/proteção.
 *
 * Execute no Apps Script → Executar → criarPlanilhaModelo
 *
 * 21 colunas:
 * Tipo | Número | Objeto | Instituição | Esfera | Área |
 * Início | Término | Prazo_Indeterminado | Status* | Dias_Restantes* |
 * DOE | DOU | SEI | Link | Observação |
 * Data_Assinatura | Data_Publicação | Data_Cadastro | Data_Atualização | Responsável
 * (* = fórmula automática)
 */
function criarPlanilhaModelo() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHEET_DADOS;

  try {
    // 1. Backup se existirem dados
    const existing = ss.getSheetByName(tabName);
    if (existing && existing.getLastRow() >= 3) {
      _criarBackup(ss, tabName);
    }

    // 2. Delete + recreate (evita todos os problemas de clear/merge/proteção)
    if (existing) {
      const tempName = tabName + '_DEL_' + Date.now();
      existing.setName(tempName);
      ss.insertSheet(tabName, 0);
      SpreadsheetApp.flush();
      ss.deleteSheet(ss.getSheetByName(tempName));
    } else {
      ss.insertSheet(tabName, 0);
    }
    SpreadsheetApp.flush();

    const sh = ss.getSheetByName(tabName);

    const headers = [
      'Tipo', 'Número', 'Objeto', 'Instituição', 'Esfera', 'Área',
      'Início', 'Término', 'Prazo_Indeterminado', 'Status', 'Dias_Restantes',
      'DOE', 'DOU', 'SEI', 'Link', 'Observação',
      'Data_Assinatura', 'Data_Publicação', 'Data_Cadastro', 'Data_Atualização', 'Responsável',
    ];
    const nCols  = headers.length; // 21
    const maxRow = sh.getMaxRows();

    // 3. Linha 1: título decorativo
    sh.getRange(1, 1, 1, nCols).merge()
      .setValue('SEMA/AC — Acordos de Cooperação Técnica — Acre')
      .setFontSize(13).setFontWeight('bold')
      .setFontColor('#FFFFFF').setBackground('#095C18')
      .setHorizontalAlignment('center');

    // 4. Linha 2: cabeçalhos reais
    sh.getRange(2, 1, 1, nCols).setValues([headers])
      .setFontWeight('bold').setBackground('#1FAD35').setFontColor('#FFFFFF').setWrap(true);

    // 5. Linha 3: registro exemplo (colunas 1–8)
    sh.getRange(3, 1, 1, 8).setValues([[
      'ACT', '001/2025',
      'Cooperação técnica para monitoramento ambiental',
      'Exemplo Instituição', 'Estadual', 'Recursos Hídricos',
      new Date(2025, 0, 1), new Date(2027, 11, 31),
    ]]);

    // 6. Checkbox na coluna Prazo_Indeterminado (col 9) — todas as linhas de dados
    sh.getRange(3, 9, maxRow - 2, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

    // 7. Fórmulas dinâmicas (sem limite fixo)
    applyFormulaRangeDynamic(sh, 3, headers);

    // 8. Formatos de data: Início(7), Término(8), Data_Assinatura(17),
    //    Data_Publicação(18), Data_Cadastro(19), Data_Atualização(20)
    [7, 8, 17, 18, 19, 20].forEach(c =>
      sh.getRange(3, c, maxRow - 2, 1).setNumberFormat('dd/mm/yyyy'));
    // Número (col 2) como texto para preservar zeros à esquerda
    sh.getRange(3, 2, maxRow - 2, 1).setNumberFormat('@');

    // 9. Larguras de coluna
    // Tipo|Núm|Objeto|Inst|Esfera|Área|Iníc|Term|PrazoInd|Status|Dias|DOE|DOU|SEI|Link|Obs|Assina|Publ|Cad|Atual|Resp
    [80, 100, 300, 200, 110, 150, 90, 90, 120, 130, 80, 80, 80, 160, 180, 220, 90, 90, 90, 90, 140]
      .forEach((w, i) => sh.setColumnWidth(i + 1, w));

    // 10. Congelar 2 linhas; ajustar altura da linha de cabeçalhos
    sh.setFrozenRows(2);
    sh.setRowHeight(2, 30);

    // 11. Garantir abas auxiliares
    _garantirAbasAuxiliares(ss);

    logInfo('criarPlanilhaModelo', `Aba '${tabName}' criada com ${nCols} colunas e fórmulas dinâmicas.`);
    Logger.log('✅ criarPlanilhaModelo concluído com sucesso.');
    Logger.log('• ' + nCols + ' colunas criadas (linha 2)');
    Logger.log('• Linha 3: registro exemplo');
    Logger.log('• Fórmulas aplicadas dinamicamente (sem limite de linhas)');
    Logger.log('• Checkbox na coluna Prazo_Indeterminado');
    Logger.log('• Abas ACT_HISTORICO e SAUDE_SISTEMA garantidas');
    Logger.log('• Adicione seus dados a partir da linha 4.');
    Logger.log('• Execute instalarTriggers() para ativar o histórico automático.');

  } catch (err) {
    logError('criarPlanilhaModelo', err);
    Logger.log('❌ ERRO em criarPlanilhaModelo: ' + err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// MIGRAR PLANILHA ATUAL
// ─────────────────────────────────────────────────────────────

/**
 * Migra uma planilha existente (estrutura antiga 15-col ou qualquer variante)
 * para o modelo oficial v7.0 de 21 colunas.
 *
 * Preserva todos os dados existentes.
 * Cria backup automático antes de qualquer alteração.
 *
 * Execute no Apps Script → Executar → migrarPlanilhaAtual
 */
function migrarPlanilhaAtual() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHEET_DADOS;
  const sheet   = ss.getSheetByName(tabName);

  if (!sheet) {
    Logger.log('⚠️ Aba "' + tabName + '" não encontrada. Execute criarPlanilhaModelo() primeiro.');
    return;
  }

  // Verificar se já é o novo modelo (21 colunas)
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0
    ? sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim())
    : [];
  const existingKeys = existingHeaders.map(h => headerKey(h));

  // Detectar se já é o modelo novo
  const hasNewCols = existingKeys.includes('prazoIndeterminado') &&
                     existingKeys.includes('dataCadastro') &&
                     existingKeys.includes('responsavel');
  if (hasNewCols && lastCol >= 21) {
    Logger.log('ℹ️ Planilha já está no modelo v7.0 — nenhuma migração necessária.');
    return;
  }

  Logger.log('🔄 Iniciando migração para o modelo v7.0...');
  Logger.log('• Estrutura atual: ' + lastCol + ' colunas');
  Logger.log('• Cabeçalhos encontrados: ' + existingHeaders.join(' | '));

  // 1. Backup
  const backupName = _criarBackup(ss, tabName);
  Logger.log('• Backup criado: ' + backupName);

  // 2. Ler todos os dados (linhas 3+)
  const lastRow = sheet.getLastRow();
  let dados = [];
  if (lastRow >= 3 && lastCol > 0) {
    dados = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  }

  Logger.log('• ' + dados.length + ' linhas de dados lidas para migração');

  // 3. Recriar sheet com novo modelo (criarPlanilhaModelo faz o backup de novo — ok)
  criarPlanilhaModelo();

  // 4. Reescrever dados nas novas posições
  const newSheet = ss.getSheetByName(tabName);
  const newHeaders = newSheet.getRange(2, 1, 1, newSheet.getLastColumn()).getValues()[0];
  const newKeys    = newHeaders.map(h => headerKey(h));

  let migratedRows = 0;
  let skippedRows  = 0;

  dados.forEach((oldRow, idx) => {
    // Pular linhas totalmente vazias
    if (!oldRow.some(c => String(c).trim())) { skippedRows++; return; }

    const newRow = new Array(newHeaders.length).fill('');
    existingKeys.forEach((oldKey, oldColIdx) => {
      if (!oldKey) return;
      const newColIdx = newKeys.indexOf(oldKey);
      if (newColIdx < 0) return;
      newRow[newColIdx] = oldRow[oldColIdx];
    });

    const targetRow = 3 + idx + 1; // +1 porque linha 3 é o exemplo
    try {
      newSheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);
      migratedRows++;
    } catch (_) {}
  });

  // 5. Reaplicar fórmulas sobre os dados migrados
  applyFormulaRangeDynamic(newSheet, 3, newHeaders);

  Logger.log('✅ Migração concluída:');
  Logger.log('• ' + migratedRows + ' linhas migradas');
  Logger.log('• ' + skippedRows  + ' linhas em branco ignoradas');
  Logger.log('• Modelo v7.0 com ' + newHeaders.length + ' colunas');
  Logger.log('• Colunas novas (sem dados anteriores): Prazo_Indeterminado, Data_Assinatura,');
  Logger.log('  Data_Publicação, Data_Cadastro, Data_Atualização, Responsável');
  Logger.log('• Execute instalarTriggers() para ativar o histórico automático.');
}

// ─────────────────────────────────────────────────────────────
// FUNÇÕES DE TESTE / DIAGNÓSTICO
// ─────────────────────────────────────────────────────────────

function testGet() {
  Logger.log(JSON.stringify(handleList({ sheet: SHEET_DADOS }), null, 2));
}

function testSchema() {
  Logger.log(JSON.stringify(handleSchema(), null, 2));
}

function testPing() {
  Logger.log(JSON.stringify(handlePing(), null, 2));
}

function diagnostico() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_DADOS);
  Logger.log('=== DIAGNÓSTICO SEMA/AC v7.0 ===');
  Logger.log('Planilha: ' + ss.getName());
  Logger.log('ID: ' + ss.getId());
  Logger.log('Aba "' + SHEET_DADOS + '": ' + (sheet ? 'EXISTE' : 'NÃO ENCONTRADA'));
  if (sheet) {
    const lc = sheet.getLastColumn();
    const lr = sheet.getLastRow();
    Logger.log('Colunas: ' + lc + ' | Linhas: ' + lr);
    if (lc > 0) {
      const hdrs = sheet.getRange(2, 1, 1, lc).getValues()[0];
      Logger.log('Cabeçalhos: ' + hdrs.join(' | '));
      const keys = hdrs.map(h => headerKey(h));
      Logger.log('Chaves internas: ' + keys.join(' | '));
      const terminoOk = keys.includes('termino');
      const prazoOk   = keys.includes('prazoIndeterminado');
      Logger.log('Coluna Término: ' + (terminoOk ? 'OK' : 'AUSENTE'));
      Logger.log('Coluna Prazo_Indeterminado: ' + (prazoOk ? 'OK' : 'AUSENTE (modelo antigo)'));
    }
  }
  Logger.log('Aba ACT_HISTORICO: '  + (ss.getSheetByName(SHEET_HISTORICO) ? 'OK' : 'ausente'));
  Logger.log('Aba SAUDE_SISTEMA: '  + (ss.getSheetByName(SHEET_SAUDE)     ? 'OK' : 'ausente'));
  Logger.log('Aba SYNC_LOG: '       + (ss.getSheetByName(SHEET_LOG)        ? 'OK' : 'ausente'));
  Logger.log('================================');
}
