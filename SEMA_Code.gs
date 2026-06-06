/**
 * SEMA/AC — Google Apps Script
 * API REST (somente leitura) para o Painel Público de Acordos de Cooperação Técnica
 *
 * Endpoints GET (JSONP via ?callback=): ping | list | schema | status | export
 * Os dados são editados diretamente na planilha; Status e Dias Restantes
 * são calculados por fórmula automática na aba.
 *
 * VERSÃO 8.0 — 19 colunas (sem Esfera/Área), correção de linhas fantasma,
 *              menu personalizado, backup automático, migração robusta.
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
  if (terminoIdx < 0) return;

  const cols = {
    termino:            colLetter(terminoIdx + 1),
    prazoIndeterminado: prazoIndIdx >= 0 ? colLetter(prazoIndIdx + 1) : null,
  };

  // Usa getLastRow() para não pré-preencher 1000+ linhas vazias com fórmulas
  // (causa raiz do bug dos 900+ ACTs fantasmas)
  const lastDataRow = Math.max(sheet.getLastRow(), startRow - 1);
  const count       = Math.max(lastDataRow - startRow + 1, 0);
  if (count === 0) return; // planilha vazia — não aplicar fórmulas

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
      const hdrs = headers.map(h => headerKey(h));
      const ANCHOR_KEYS = new Set(['tipo','num','objeto','inst','termino','inicio','link','sei','doe','dou']);
      const rows = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
      dataRows = rows.filter(row => {
        const rec = {};
        hdrs.forEach((k, j) => { rec[k] = String(row[j] ?? '').trim(); });
        return [...ANCHOR_KEYS].some(k => rec[k]);
      }).length;
    }
  }

  if (missingRequiredColumns.length) {
    warnings.push('Colunas obrigatórias ausentes: ' + missingRequiredColumns.join(', ') + '.');
  }

  const result = {
    ok: !!sheet && missingRequiredColumns.length === 0,
    version: '8.0',
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

  // Colunas âncora: registro válido somente quando ao menos uma tem conteúdo.
  // Evita incluir linhas onde só fórmulas (Status="Prazo Indeterminado") estão preenchidas.
  const ANCHOR_KEYS = new Set(['tipo','num','objeto','inst','termino','inicio','link','sei','doe','dou']);

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

    // Pular linhas fantasma (só fórmulas, sem dados reais em colunas âncora)
    const hasData = [...ANCHOR_KEYS].some(k => rec[k] && String(rec[k]).trim());
    if (!hasData) continue;

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
    version: '8.0',
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

  const ANCHOR_KEYS_CSV = new Set(['tipo','num','objeto','inst','termino','inicio','link','sei','doe','dou']);
  const hdrsKeys = hdrs.map(h => headerKey(h));

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row.some(c => String(c).trim())) continue;
    // Pular linhas fantasma (só fórmulas, sem dados âncora)
    const tmpRec = {};
    hdrsKeys.forEach((k, j) => { tmpRec[k] = String(row[j] ?? '').trim(); });
    if (![...ANCHOR_KEYS_CSV].some(k => tmpRec[k])) continue;
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
  set('versao',             '8.0');
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
// MENU PERSONALIZADO
// ─────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ACT')
    .addItem('Criar Planilha Modelo',       'criarPlanilhaModelo')
    .addItem('Migrar Dados (antigo→novo)',  'migrarPlanilhaAtual')
    .addItem('Reaplicar Fórmulas',          'reaplicarFormulas')
    .addSeparator()
    .addItem('Instalar Triggers',           'instalarTriggers')
    .addItem('Diagnóstico',                 'diagnostico')
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// CRIAR PLANILHA MODELO — v8.0
// ─────────────────────────────────────────────────────────────

/**
 * Cria (ou recria) a aba 'ACT - PAINEL PUBLICO' com o modelo padrão v8.0.
 * Antes de recriar com dados, exibe diálogo de confirmação.
 * Usa delete+recreate para evitar bugs de clear/merge/proteção.
 *
 * Execute via: menu ACT ▸ Criar Planilha Modelo
 *
 * 19 colunas:
 * Tipo | Número | Objeto | Instituição |
 * Início | Término | Prazo_Indeterminado | Status* | Dias_Restantes* |
 * DOE | DOU | SEI | Link | Observação |
 * Data_Assinatura | Data_Publicação | Data_Cadastro | Data_Atualização | Responsável
 * (* = fórmula automática — só aplicada a linhas com dados)
 */
function criarPlanilhaModelo() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHEET_DADOS;

  try {
    const existing = ss.getSheetByName(tabName);
    const hasData  = existing && existing.getLastRow() >= 3;

    if (hasData) {
      const action = _dialogCriarOuMigrar(ss, tabName);
      if (action === 'migrated') return; // migrarPlanilhaAtual() já foi chamado
      if (action === 'cancelled') { Logger.log('ℹ️ Operação cancelada pelo usuário.'); return; }
      // action === 'empty' → continua para criar vazia (backup já feito no dialog)
    }

    _criarAba(ss, tabName, existing, hasData);

  } catch (err) {
    logError('criarPlanilhaModelo', err);
    Logger.log('❌ ERRO em criarPlanilhaModelo: ' + err.message);
    throw err;
  }
}

function _dialogCriarOuMigrar(ss, tabName) {
  const ui  = SpreadsheetApp.getUi();
  const res = ui.alert(
    'Planilha existente com dados',
    'Foi identificada uma planilha com registros.\n\n' +
    '• SIM — Migrar dados para o novo modelo (19 colunas)\n' +
    '• NÃO — Criar planilha VAZIA (um backup será feito antes)\n' +
    '• CANCELAR — Abortar sem alterações',
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (res === ui.Button.YES) {
    migrarPlanilhaAtual();
    return 'migrated';
  }
  if (res === ui.Button.NO) {
    const conf = ui.alert(
      'Confirmar criação vazia',
      'Todos os dados atuais serão perdidos.\nUm backup automático será criado primeiro.\n\nContinuar?',
      ui.ButtonSet.OK_CANCEL
    );
    if (conf === ui.Button.OK) {
      _criarBackup(ss, tabName);
      return 'empty';
    }
  }
  return 'cancelled';
}

function _criarAba(ss, tabName, existing, hasData) {
  // Delete + recreate (evita problemas de clear/merge/proteção)
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

  // 19 colunas (sem Esfera e Área)
  const headers = [
    'Tipo', 'Número', 'Objeto', 'Instituição',
    'Início', 'Término', 'Prazo_Indeterminado', 'Status', 'Dias_Restantes',
    'DOE', 'DOU', 'SEI', 'Link', 'Observação',
    'Data_Assinatura', 'Data_Publicação', 'Data_Cadastro', 'Data_Atualização', 'Responsável',
  ];
  const nCols  = headers.length; // 19
  const maxRow = sh.getMaxRows();

  // Linha 1: título
  sh.getRange(1, 1, 1, nCols).merge()
    .setValue('SEMA/AC — Acordos de Cooperação Técnica — Acre')
    .setFontSize(13).setFontWeight('bold')
    .setFontColor('#FFFFFF').setBackground('#095C18')
    .setHorizontalAlignment('center');

  // Linha 2: cabeçalhos
  sh.getRange(2, 1, 1, nCols).setValues([headers])
    .setFontWeight('bold').setBackground('#1FAD35').setFontColor('#FFFFFF').setWrap(true);

  // Checkbox na coluna Prazo_Indeterminado (col 7) — todas as linhas de dados
  sh.getRange(3, 7, maxRow - 2, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  // Fórmulas dinâmicas — apenas se houver dados (count=0 em planilha vazia → skip)
  applyFormulaRangeDynamic(sh, 3, headers);

  // Formatos de data: Início(5), Término(6), Data_Assinatura(15),
  //                  Data_Publicação(16), Data_Cadastro(17), Data_Atualização(18)
  [5, 6, 15, 16, 17, 18].forEach(c =>
    sh.getRange(3, c, maxRow - 2, 1).setNumberFormat('dd/mm/yyyy'));
  sh.getRange(3, 2, maxRow - 2, 1).setNumberFormat('@'); // Número como texto

  // Larguras: Tipo|Núm|Objeto|Inst|Iníc|Term|PrazoInd|Status|Dias|DOE|DOU|SEI|Link|Obs|Assina|Publ|Cad|Atual|Resp
  [80, 100, 300, 200, 90, 90, 120, 130, 80, 80, 80, 160, 180, 220, 90, 90, 90, 90, 140]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  sh.setFrozenRows(2);
  sh.setRowHeight(2, 30);

  _garantirAbasAuxiliares(ss);

  logInfo('criarPlanilhaModelo', `Aba '${tabName}' criada com ${nCols} colunas.`);
  Logger.log('✅ criarPlanilhaModelo concluído.');
  Logger.log('• ' + nCols + ' colunas (sem Esfera e Área)');
  Logger.log('• Planilha vazia — adicione dados a partir da linha 3.');
  Logger.log('• Após inserir dados, execute ACT ▸ Reaplicar Fórmulas.');
  Logger.log('• Execute ACT ▸ Instalar Triggers para ativar o histórico automático.');
}

/**
 * Reaplica fórmulas de Status e Dias_Restantes para todas as linhas com dados.
 * Execute após inserir dados manualmente ou importar via CSV.
 */
function reaplicarFormulas() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(SHEET_DADOS);
  if (!sh) throw new Error('Aba não encontrada: ' + SHEET_DADOS);
  const headers = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  applyFormulaRangeDynamic(sh, 3, headers);
  logInfo('reaplicarFormulas', 'Fórmulas reaplicadas até linha ' + sh.getLastRow());
  Logger.log('✅ Fórmulas reaplicadas até linha ' + sh.getLastRow());
}

// ─────────────────────────────────────────────────────────────
// MIGRAR PLANILHA ATUAL
// ─────────────────────────────────────────────────────────────

/**
 * Migra uma planilha existente (qualquer estrutura anterior) para o modelo v8.0 de 19 colunas.
 * Colunas Esfera e Área são descartadas (não existem no novo modelo).
 * Preserva todos os demais dados. Cria backup automático.
 *
 * Execute via: menu ACT ▸ Migrar Dados (antigo→novo)
 */
function migrarPlanilhaAtual() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHEET_DADOS;
  const sheet   = ss.getSheetByName(tabName);

  if (!sheet) {
    Logger.log('⚠️ Aba "' + tabName + '" não encontrada. Execute criarPlanilhaModelo() primeiro.');
    return;
  }

  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0
    ? sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim())
    : [];
  const existingKeys = existingHeaders.map(h => headerKey(h));

  // Detectar se já é o modelo v8.0 (19 colunas sem Esfera/Área)
  const hasNewCols   = existingKeys.includes('prazoIndeterminado') &&
                       existingKeys.includes('dataCadastro') &&
                       existingKeys.includes('responsavel');
  const hasEsferaArea = existingKeys.includes('esfera') || existingKeys.includes('area');

  if (hasNewCols && !hasEsferaArea && lastCol >= 19) {
    Logger.log('ℹ️ Planilha já está no modelo v8.0 — nenhuma migração necessária.');
    return;
  }

  Logger.log('🔄 Iniciando migração para o modelo v8.0...');
  Logger.log('• Estrutura atual: ' + lastCol + ' colunas');
  Logger.log('• Cabeçalhos: ' + existingHeaders.join(' | '));
  if (hasEsferaArea) Logger.log('• Colunas Esfera e/ou Área serão descartadas (removidas do modelo)');

  const backupName = _criarBackup(ss, tabName);
  Logger.log('• Backup criado: ' + backupName);

  // Ler todos os dados (linhas 3+)
  const lastRow = sheet.getLastRow();
  let dados = [];
  if (lastRow >= 3 && lastCol > 0) {
    dados = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  }
  Logger.log('• ' + dados.length + ' linhas lidas para migração');

  // Recriar aba com novo modelo (sem diálogo — já confirmado pelo caller)
  _criarAba(ss, tabName, sheet, false);

  // Reescrever dados nas novas posições
  const newSheet   = ss.getSheetByName(tabName);
  const newHeaders = newSheet.getRange(2, 1, 1, newSheet.getLastColumn()).getValues()[0];
  const newKeys    = newHeaders.map(h => headerKey(h));

  const ANCHOR_KEYS = new Set(['tipo','num','objeto','inst','termino','inicio','link','sei','doe','dou']);
  let migratedRows = 0, skippedRows = 0, phantomRows = 0;

  dados.forEach((oldRow, idx) => {
    if (!oldRow.some(c => String(c).trim())) { skippedRows++; return; }

    // Montar rec temporário para testar se é linha fantasma
    const tmpRec = {};
    existingKeys.forEach((k, j) => { tmpRec[k] = String(oldRow[j] ?? '').trim(); });
    const hasData = [...ANCHOR_KEYS].some(k => tmpRec[k]);
    if (!hasData) { phantomRows++; return; }

    const newRow = new Array(newHeaders.length).fill('');
    existingKeys.forEach((oldKey, oldColIdx) => {
      if (!oldKey || oldKey === 'esfera' || oldKey === 'area') return; // descartar
      const newColIdx = newKeys.indexOf(oldKey);
      if (newColIdx < 0) return;
      newRow[newColIdx] = oldRow[oldColIdx];
    });

    const targetRow = 3 + migratedRows;
    try {
      newSheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);
      migratedRows++;
    } catch (_) {}
  });

  // Reaplicar fórmulas sobre os dados migrados
  applyFormulaRangeDynamic(newSheet, 3, newHeaders);

  Logger.log('✅ Migração concluída:');
  Logger.log('• ' + migratedRows + ' linhas migradas');
  Logger.log('• ' + skippedRows  + ' linhas em branco ignoradas');
  Logger.log('• ' + phantomRows  + ' linhas fantasma descartadas');
  Logger.log('• Modelo v8.0 com ' + newHeaders.length + ' colunas');
  Logger.log('• Colunas descartadas: Esfera, Área');
  Logger.log('• Execute ACT ▸ Instalar Triggers para ativar o histórico automático.');
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
  Logger.log('=== DIAGNÓSTICO SEMA/AC v8.0 ===');
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
