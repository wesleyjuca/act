# SEMA/AC — Painel de Termos de Cooperação Técnica

Sistema público de gestão e transparência dos Termos de Cooperação Técnica da **Secretaria de Estado do Meio Ambiente do Acre — SEMA/AC**.

---

## Arquitetura

```
[admin.html]  ──POST──▶  [Apps Script Web App]  ──▶  [Google Sheets]
[index.html]  ◀──GET───  [Apps Script Web App]  ◀──  [Google Sheets]
      ↑                            ↑
 GitHub Pages               Dados em tempo real
```

| Componente | Arquivo | Função |
|---|---|---|
| Painel público | `index.html` | Exibe dados ao cidadão |
| Painel admin | `admin.html` | Gestão interna ASJUR (senha protegido) |
| Módulo sync | `js/sync.js` | Comunicação bidirecional com a API |
| Configuração | `js/config.js` | Credenciais (preenchidas pelos Secrets) |
| API REST | `SEMA_Code.gs` | Google Apps Script — lê/escreve no Sheets |
| CI/CD | `.github/workflows/deploy.yml` | Deploy automático via GitHub Actions |

---

## Setup completo (5 passos)

### 1. Configurar o Google Apps Script

1. Abra a planilha TCT no Google Drive
2. Menu **Extensões → Apps Script**
3. Cole o conteúdo de `SEMA_Code.gs`
4. Salve (Ctrl+S)
5. Execute `setupSyncToken()` uma vez:
   - Clique em ▶ Executar → escolha `setupSyncToken`
   - Copie o token exibido no log
6. **Implantar → Novo implantação**:
   - Tipo: **Aplicativo da Web**
   - Executar como: **Eu** (sua conta Google)
   - Quem tem acesso: **Qualquer pessoa**
   - Clique em **Implantar** → copie a **URL do aplicativo da Web**

### 2. Configurar GitHub Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Valor | Obrigatório |
|---|---|---|
| `APPS_SCRIPT_URL` | URL do Web App (passo 1.6) | Sim |
| `SYNC_TOKEN` | Token gerado pelo `setupSyncToken()` | Sim |
| `SENHA_HASH` | Hash SHA-256 da senha admin | Sim |
| `PUBLIC_URL` | `https://wesleyjuca.github.io/act/` | Opcional |
| `ADMIN_URL` | `https://wesleyjuca.github.io/act/admin.html` | Opcional |

**Gerar hash SHA-256 da senha admin** (execute no console do Chrome F12):
```javascript
crypto.subtle.digest('SHA-256', new TextEncoder().encode('SUA_SENHA_AQUI'))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
```

### 3. Habilitar GitHub Pages

**Settings → Pages**:
- Source: **GitHub Actions**
- Salvar

### 4. Fazer push para `main`

```bash
git push origin main
```

O GitHub Actions irá:
1. Verificar os Secrets
2. Injetar as credenciais em `js/config.js`
3. Validar os HTMLs
4. Publicar no GitHub Pages

### 5. Verificar funcionamento

Acesse o painel publico e observe o indicador de sync no cabecalho:
- Verde = conectado ao Google Sheets
- Vermelho = erro de conexao (verifique os Secrets e a URL do Apps Script)

---

## Estrutura do repositorio

```
/
├── index.html                        # Painel publico (cidadao)
├── admin.html                        # Painel admin (ASJUR)
├── js/
│   ├── config.js                     # Configuracao (placeholders → Secrets)
│   └── sync.js                       # Modulo SEMASync
├── SEMA_Code.gs                      # Codigo do Google Apps Script
├── .github/
│   └── workflows/
│       └── deploy.yml                # CI/CD GitHub Actions
└── README.md
```

---

## Endpoints da API (Apps Script)

| Metodo | Parametros | Descricao |
|---|---|---|
| GET | `?action=list&sheet=DADOS_PUBLICOS` | Lista todos os registros |
| GET | `?action=status` | Verifica saude da API |
| GET | `?action=schema` | Retorna estrutura de colunas |
| POST | `{action:'upsert', token, record}` | Cria/atualiza 1 registro |
| POST | `{action:'upsertBatch', token, records[]}` | Cria/atualiza N registros |
| POST | `{action:'delete', token, tipo, num}` | Remove 1 registro |

---

## Suporte

**ASJUR/SEMA/AC** — Wesley de Oliveira Juca · OAB/AC 6.157
sema.gabin@gmail.com · Rua Benjamin Constant, 856 · Rio Branco - AC
