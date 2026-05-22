/**
 * SEMA/AC — Módulo de Sincronização Central
 * Painel de Termos de Cooperação Técnica v4
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
  retryDelayMax: 10_000,      // cap máximo de backoff
  cacheKey:      'sema_tct_cache',
  logKey:        'sema_tct_logs',
  logMax:        100,
  conflictMode:  'newest',    // 'newest' | 'local' | 'remote'
  sheet:         'DADOS_PÚBLICOS',
  debounceMs:    800,         // debounce de push por registro
};

// ─── CLASSE PRINCIPAL ─────────────────────────────────────────────────────────
class SEMASync {
  constructor(cfg = {}) {
    this.cfg            = { ...SYNC_DEFAULTS, ...cfg };
    this._records       = [];        // estado local em memória
    this._dirty         = new Set(); // índices modificados localmente
    this._logs          = this._loadLogs();
    this._listeners     = [];        // callbacks de mudança
    this._timer         = null;
    this._status        = 'idle';    // idle|syncing|error|ok|offline
    this._lastSync      = null;
    this._errCount      = 0;
    this._retries       = 0;
    this._debounce      = new Map(); // debounce timers por chave de registro
    this._onlineHandler = null;
    this._offlineHandler= null;
  }

  // ─── API PÚBLICA ─────────────────────────────────────────────────────────

  /** Inicia sync automático */
  start() {
    this._loadCache();
    this._emit('status', this._status);

    // Detecção de online/offline
    if (typeof window !== 'undefined') {
      this._onlineHandler = () => {
        this.log('info', 'Conexão restaurada — iniciando sync');
        this._setStatus('idle');
        this.sync();
      };
      this._offlineHandler = () => {
        this.log('warn', 'Dispositivo offline — syncs suspensos');
        this._setStatus('offline');
      };
      window.addEventListener('online',  this._onlineHandler);
      window.addEventListener('offline', this._offlineHandler);
    }

    if (this.cfg.interval > 0) {
      this._timer = setInterval(() => this.sync(), this.cfg.interval);
    }
    return this.sync();   // sync imediato ao iniciar
  }

  /** Para sync automático */
  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (typeof window !== 'undefined') {
      if (this._onlineHandler)  window.removeEventListener('online',  this._onlineHandler);
      if (this._offlineHandler) window.removeEventListener('offline', this._offlineHandler);
    }
    this.log('info', 'Auto-sync parado');
  }

  /** Força sync manual bidirecional */
  async sync() {
    if (this._status === 'syncing') {
      this.log('warn', 'Sync já em andamento, ignorando chamada duplicada');
      return { ok: false, reason: 'already_syncing' };
    }
    // Verificar offline antes de tentar
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.log('warn', 'Dispositivo offline — sync cancelado');
      this._setStatus('offline');
      return { ok: false, reason: 'offline' };
    }
    this._setStatus('syncing');
    try {
      // Capturar chaves dirty ANTES do merge para evitar mismatch de índices
      const dirtyKeys = new Set(
        [...this._dirty].map(i => {
          const r = this._records[i];
          return r ? `${r.tipo}|${r.num}` : null;
        }).filter(Boolean)
      );
      const remote = await this._fetchRemote();
      const merged = this._merge(this._records, remote);
      if (dirtyKeys.size > 0) {
        const toSend = merged.filter(r => dirtyKeys.has(`${r.tipo}|${r.num}`));
        if (toSend.length > 0) await this._pushDirtyRecords(toSend);
      }
      this._saveCache(merged);
      this._records = merged;
      this._dirty.clear();
      this._lastSync = new Date();
      this._errCount = 0;
      this._retries  = 0;
      this._setStatus('ok');
      this._emit('data', merged);
      this.log('ok', `Sync concluído — ${merged.length} registros · ${dirtyKeys.size} enviados`);
      return { ok: true, count: merged.length, pushed: dirtyKeys.size };
    } catch (err) {
      this._errCount++;
      this._setStatus('error');
      this.log('error', `Sync falhou: ${err.message}`);
      if (this._retries < this.cfg.retryMax) {
        this._retries++;
        const delay = Math.min(this.cfg.retryDelay * Math.pow(2, this._retries - 1), this.cfg.retryDelayMax);
        this.log('warn', `Retry ${this._retries}/${this.cfg.retryMax} em ${delay / 1000}s`);
        await this._delay(delay);
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

  /** Salva um registro (cache local imediato + push remoto com debounce) */
  async save(record) {
    this._validateRecord(record);
    const idx = this._records.findIndex(
      r => r.tipo === record.tipo && r.num === record.num
    );
    record._ts = Date.now();
    let finalIdx;
    if (idx >= 0) {
      this._records[idx] = record;
      finalIdx = idx;
      this._dirty.add(idx);
    } else {
      this._records.push(record);
      finalIdx = this._records.length - 1;
      this._dirty.add(finalIdx);
    }
    this._saveCache(this._records);
    this.log('info', `Salvo localmente: ${record.tipo} ${record.num}`);

    // Push remoto com debounce (evita múltiplas requisições rápidas)
    if (this.cfg.appsScriptUrl && this._hasToken()) {
      const key = `${record.tipo}|${record.num}`;
      if (this._debounce.has(key)) clearTimeout(this._debounce.get(key));
      this._debounce.set(key, setTimeout(async () => {
        this._debounce.delete(key);
        try {
          await this._pushSingle(record);
          this._dirty.delete(finalIdx);  // usa valor capturado no momento do save
          this.log('ok', `Sincronizado com Sheets: ${record.tipo} ${record.num}`);
        } catch(e) {
          this.log('warn', `Push falhou (tentará na próxima sync): ${e.message}`);
        }
      }, this.cfg.debounceMs));
    } else if (!this._hasToken()) {
      this.log('warn', 'SYNC_TOKEN não configurado — salvo apenas localmente');
    }
  }

  /** Remove um registro pelo par tipo+num */
  async remove(tipo, num) {
    const idx = this._records.findIndex(r => r.tipo === tipo && r.num === num);
    if (idx < 0) return false;
    // Ajustar dirty: remover este índice e decrementar os posteriores
    const newDirty = new Set();
    for (const i of this._dirty) {
      if (i < idx) newDirty.add(i);
      else if (i > idx) newDirty.add(i - 1);
    }
    this._dirty = newDirty;
    this._records.splice(idx, 1);
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
      online:    typeof navigator !== 'undefined' ? navigator.onLine : true,
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

  async _pushDirtyRecords(records) {
    if (!this.cfg.appsScriptUrl || !this._hasToken()) return;
    await this._post({ action: 'upsertBatch', sheet: this.cfg.sheet, records });
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
    // Sem Content-Type → navegador envia text/plain;charset=UTF-8 → simple CORS request sem preflight
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
    return [...map.values()].sort((a, b) => {
      const t = (a.termino || '').localeCompare(b.termino || '');
      if (t !== 0) return t;
      return (`${a.tipo}|${a.num}`).localeCompare(`${b.tipo}|${b.num}`);
    });
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
      if (records?.length) {
        this._records = records;
        if (age < 900_000) {
          this.log('info', `Cache restaurado: ${records.length} registros (${Math.round(age/1000)}s atrás)`);
        } else {
          this.log('warn', `Cache expirado (${Math.round(age/60000)}min) — usando como fallback offline`);
        }
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
    // Suprimir logs verbose em produção (apenas error/warn)
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
