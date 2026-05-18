/**
 * SEMA/AC — Módulo de Sincronização Central
 * Painel de Termos de Cooperação Técnica v3
 *
 * Arquitetura:
 *   Admin  ──POST──▶  Apps Script Web App  ──▶  Google Sheets
 *   Public ◀──GET───  Apps Script Web App  ◀──  Google Sheets
 *
 * O Apps Script atua como API REST sobre o Google Sheets.
 * Writes requerem SYNC_TOKEN. Reads são públicos.
 */

'use strict';

// ─── CONFIG (sobrescrita por config.js) ───────────────────────────────────────
const SYNC_DEFAULTS = {
  appsScriptUrl: '',          // URL do Web App (doGet/doPost)
  syncToken:     '',          // Token secreto para operações de escrita
  interval:      300_000,     // 5 min em ms (0 = apenas manual)
  retryMax:      3,
  retryDelay:    2_000,
  cacheKey:      'sema_tct_cache',
  logKey:        'sema_tct_logs',
  logMax:        100,
  conflictMode:  'newest',    // 'newest' | 'local' | 'remote'
  sheet:         'DADOS_PÚBLICOS',
};

// ─── CLASSE PRINCIPAL ─────────────────────────────────────────────────────────
class SEMASync {
  constructor(cfg = {}) {
    this.cfg        = { ...SYNC_DEFAULTS, ...cfg };
    this._records   = [];        // estado local em memória
    this._dirty     = new Set(); // índices modificados localmente
    this._logs      = this._loadLogs();
    this._listeners = [];        // callbacks de mudança
    this._timer     = null;
    this._status    = 'idle';    // idle|syncing|error|ok
    this._lastSync  = null;
    this._errCount  = 0;
    this._retries   = 0;
  }

  // ─── API PÚBLICA ─────────────────────────────────────────────────────────

  /** Inicia sync automático */
  start() {
    this._loadCache();
    this._emit('status', this._status);
    if (this.cfg.interval > 0) {
      this._timer = setInterval(() => this.sync(), this.cfg.interval);
    }
    return this.sync();   // sync imediato ao iniciar
  }

  /** Para sync automático */
  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.log('info', 'Auto-sync parado');
  }

  /** Força sync manual bidirecional */
  async sync() {
    if (this._status === 'syncing') {
      this.log('warn', 'Sync já em andamento, ignorando chamada duplicada');
      return { ok: false, reason: 'already_syncing' };
    }
    this._setStatus('syncing');
    try {
      const remote = await this._fetchRemote();
      const merged = this._merge(this._records, remote);
      const dirty  = [...this._dirty];
      if (dirty.length > 0) {
        await this._pushDirty(merged, dirty);
      }
      this._records = merged;
      this._dirty.clear();
      this._saveCache(merged);
      this._lastSync = new Date();
      this._errCount = 0;
      this._retries  = 0;
      this._setStatus('ok');
      this._emit('data', merged);
      this.log('ok', `Sync concluído — ${merged.length} registros · ${dirty.length} enviados`);
      return { ok: true, count: merged.length, pushed: dirty.length };
    } catch (err) {
      this._errCount++;
      this._setStatus('error');
      this.log('error', `Sync falhou: ${err.message}`);
      if (this._retries < this.cfg.retryMax) {
        this._retries++;
        this.log('warn', `Retry ${this._retries}/${this.cfg.retryMax} em ${this.cfg.retryDelay / 1000}s`);
        await this._delay(this.cfg.retryDelay * this._retries);
        return this.sync();
      }
      this._emit('error', err);
      return { ok: false, error: err.message };
    }
  }

  /** Retorna todos os registros (cache local) */
  getAll() { return [...this._records]; }

  /** Inicializa _records com dados externos para garantir merge correto no próximo sync */
  loadAll(records) {
    this._records = records.map(r => ({ ...r, _ts: r._ts || Date.now() }));
    this._saveCache(this._records);
    this.log('info', `${records.length} registros carregados no sync local`);
  }

  /** Salva um registro (atualiza cache local + push remoto se token configurado) */
  async save(record) {
    this._validateRecord(record);
    const idx = this._records.findIndex(
      r => r.tipo === record.tipo && r.num === record.num
    );
    record._ts = Date.now();
    if (idx >= 0) {
      this._records[idx] = record;
      this._dirty.add(idx);
    } else {
      this._records.push(record);
      this._dirty.add(this._records.length - 1);
    }
    this._saveCache(this._records);
    this.log('info', `Salvo localmente: ${record.tipo} ${record.num}`);
    // Push imediato ao Sheets se token configurado
    if (this.cfg.appsScriptUrl && this._hasToken()) {
      try {
        await this._pushSingle(record);
        this._dirty.delete(idx >= 0 ? idx : this._records.length - 1);
        this.log('ok', `Sincronizado com Sheets: ${record.tipo} ${record.num}`);
      } catch(e) {
        this.log('warn', `Push falhou (tentará na próxima sync): ${e.message}`);
      }
    } else if (!this._hasToken()) {
      this.log('warn', 'SYNC_TOKEN não configurado — salvo apenas localmente');
    }
  }

  /** Remove um registro pelo par tipo+num */
  async remove(tipo, num) {
    const idx = this._records.findIndex(r => r.tipo === tipo && r.num === num);
    if (idx < 0) return false;
    this._records.splice(idx, 1);
    this._dirty.clear();
    this._saveCache(this._records);
    this.log('info', `Removido localmente: ${tipo} ${num}`);
    if (this.cfg.appsScriptUrl && this._hasToken()) {
      try {
        await this._deleteRemote(tipo, num);
        this.log('ok', `Removido do Sheets: ${tipo} ${num}`);
      } catch(e) {
        this.log('warn', `Remoção remota falhou: ${e.message}`);
      }
    } else if (!this._hasToken()) {
      this.log('warn', 'SYNC_TOKEN não configurado — removido apenas localmente');
    }
    return true;
  }

  /** Registra listener para eventos: 'data' | 'status' | 'error' | 'log' */
  on(event, fn) {
    this._listeners.push({ event, fn });
    return () => { this._listeners = this._listeners.filter(l => l.fn !== fn); };
  }

  /** Retorna estado atual */
  getStatus() {
    return {
      status:    this._status,
      lastSync:  this._lastSync,
      errCount:  this._errCount,
      records:   this._records.length,
      dirty:     this._dirty.size,
      connected: !!this.cfg.appsScriptUrl,
      interval:  this.cfg.interval,
    };
  }

  /** Retorna logs recentes */
  getLogs(n = 50) { return this._logs.slice(-n); }

  /** Atualiza configuração em runtime */
  updateConfig(patch) {
    Object.assign(this.cfg, patch);
    if (this._timer) { this.stop(); this.start(); }
    this.log('info', `Config atualizada: ${JSON.stringify(patch)}`);
  }

  // ─── REDE ─────────────────────────────────────────────────────────────────

  async _fetchRemote() {
    if (!this.cfg.appsScriptUrl) {
      // Sem URL: retorna cache ou array vazio
      this.log('warn', 'appsScriptUrl não configurado — usando cache local');
      return this._records.length ? this._records : [];
    }
    const url = `${this.cfg.appsScriptUrl}?action=list&sheet=${encodeURIComponent(this.cfg.sheet)}`;
    const r = await this._fetchWithTimeout(url, { method: 'GET' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    if (json.error) throw new Error(json.error);
    return (json.records || []).map(rec => ({ ...rec, _source: 'remote' }));
  }

  _hasToken() {
    return !!(this.cfg.syncToken && !this.cfg.syncToken.startsWith('%%'));
  }

  async _pushDirty(records, dirtyIdx) {
    if (!this.cfg.appsScriptUrl || !this._hasToken()) return;
    const toSend = dirtyIdx.map(i => records[i]).filter(Boolean);
    await this._post({ action: 'upsertBatch', sheet: this.cfg.sheet, records: toSend });
  }

  async _pushSingle(record) {
    if (!this.cfg.appsScriptUrl || !this._hasToken()) {
      throw new Error('Token de sincronização não configurado (Secret SYNC_TOKEN no GitHub)');
    }
    await this._post({ action: 'upsert', sheet: this.cfg.sheet, record });
  }

  async _deleteRemote(tipo, num) {
    if (!this.cfg.appsScriptUrl || !this._hasToken()) {
      throw new Error('Token de sincronização não configurado (Secret SYNC_TOKEN no GitHub)');
    }
    await this._post({ action: 'delete', sheet: this.cfg.sheet, tipo, num });
  }

  async _post(body) {
    // Sem Content-Type: application/json — evita preflight CORS (OPTIONS) que Apps Script não responde
    const r = await this._fetchWithTimeout(this.cfg.appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ ...body, token: this.cfg.syncToken }),
    });
    if (!r.ok) throw new Error(`POST HTTP ${r.status}`);
    const json = await r.json();
    if (json.error) throw new Error(json.error);
    return json;
  }

  async _fetchWithTimeout(url, opts = {}, ms = 15_000) {
    const ctrl = new AbortController();
    const id    = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(id);
    }
  }

  // ─── MERGE / CONFLITO ─────────────────────────────────────────────────────

  _merge(local, remote) {
    const map = new Map();
    // Base: remote
    for (const r of remote) {
      const k = `${r.tipo}|${r.num}`;
      map.set(k, { ...r, _source: 'remote' });
    }
    // Aplicar locais (com política de conflito)
    for (const l of local) {
      const k = `${l.tipo}|${l.num}`;
      if (!map.has(k)) {
        // Novo local — inclui
        map.set(k, { ...l, _source: 'local_new' });
      } else {
        const rem = map.get(k);
        const winner = this._resolveConflict(l, rem);
        if (winner !== rem) {
          map.set(k, { ...winner, _source: 'local_win', _conflict: true });
          this.log('warn', `Conflito resolvido (${this.cfg.conflictMode}): ${k}`);
        }
      }
    }
    return [...map.values()].sort((a, b) =>
      (a.termino || '').localeCompare(b.termino || '')
    );
  }

  _resolveConflict(local, remote) {
    switch (this.cfg.conflictMode) {
      case 'local':   return local;
      case 'remote':  return remote;
      case 'newest':
      default:
        return (local._ts || 0) >= (remote._ts || 0) ? local : remote;
    }
  }

  // ─── VALIDAÇÃO ────────────────────────────────────────────────────────────

  _validateRecord(r) {
    const required = ['tipo', 'num', 'objeto', 'inst'];
    const missing  = required.filter(f => !r[f]?.trim?.());
    if (missing.length) throw new Error(`Campos obrigatórios ausentes: ${missing.join(', ')}`);
    if (r.inicio && r.termino && r.termino <= r.inicio) {
      throw new Error('Data término deve ser posterior ao início');
    }
  }

  // ─── CACHE ────────────────────────────────────────────────────────────────

  _saveCache(records) {
    try {
      sessionStorage.setItem(this.cfg.cacheKey, JSON.stringify({
        ts: Date.now(), records
      }));
    } catch (_) { /* quota excedida — ignora */ }
  }

  _loadCache() {
    try {
      const raw = sessionStorage.getItem(this.cfg.cacheKey);
      if (!raw) return;
      const { ts, records } = JSON.parse(raw);
      const age = Date.now() - ts;
      if (age < 3_600_000 && records?.length) {   // cache válido por 1h
        this._records = records;
        this.log('info', `Cache restaurado: ${records.length} registros (${Math.round(age/1000)}s atrás)`);
        this._emit('data', records);
      }
    } catch (_) {}
  }

  // ─── LOGS ─────────────────────────────────────────────────────────────────

  log(level, msg) {
    const entry = {
      ts:    Date.now(),
      iso:   new Date().toLocaleTimeString('pt-BR'),
      level,
      msg,
    };
    this._logs.push(entry);
    if (this._logs.length > this.cfg.logMax) {
      this._logs = this._logs.slice(-this.cfg.logMax);
    }
    this._saveLogs();
    this._emit('log', entry);
    if (level === 'error') console.error(`[SEMA Sync] ${msg}`);
    else if (level === 'warn') console.warn(`[SEMA Sync] ${msg}`);
    else console.log(`[SEMA Sync] [${level}] ${msg}`);
  }

  _saveLogs() {
    try {
      sessionStorage.setItem(this.cfg.logKey, JSON.stringify(this._logs));
    } catch (_) {}
  }

  _loadLogs() {
    try {
      return JSON.parse(sessionStorage.getItem(this.cfg.logKey) || '[]');
    } catch (_) { return []; }
  }

  // ─── EVENTOS ─────────────────────────────────────────────────────────────

  _emit(event, data) {
    this._listeners
      .filter(l => l.event === event)
      .forEach(l => { try { l.fn(data); } catch (_) {} });
  }

  _setStatus(s) {
    this._status = s;
    this._emit('status', s);
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─── EXPORTAR ─────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined') module.exports = SEMASync;
if (typeof window !== 'undefined')  window.SEMASync = SEMASync;
