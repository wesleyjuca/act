# SEMA/AC — Painel de Termos de Cooperação Técnica

[![Deploy](https://github.com/sema-ac/tct/actions/workflows/deploy.yml/badge.svg)](https://github.com/sema-ac/tct/actions)

Sistema público de gestão e transparência dos Termos de Cooperação Técnica da **Secretaria de Estado do Meio Ambiente do Acre — SEMA/AC**.

---

## 🏗️ Arquitetura

```
[admin.html]  ──POST──▶  [Apps Script Web App]  ──▶  [Google Sheets]
[index.html]  ◀──GET───  [Apps Script Web App]  ◀──  [Google Sheets]
      ↑                            ↑
 GitHub Pages               Sync automático
                             (config.interval)
```

| Componente | Tecnologia | Função |
|---|---|---|
| Painel público | HTML + SEMASync | Exibe dados ao cidadão |
| Painel admin | HTML + SEMASync | Gestão interna ASJUR |
| API REST | Google Apps Script | Lê/escreve no Sheets |
| Banco de dados | Google Sheets | Dados públicos e internos |
| Hospedagem | GitHub Pages | Gratuita, HTTPS automático |
| CI/CD | GitHub Actions | Deploy automático no push |

---

## ⚡ Setup em 5 passos

### 1. Fork / Clone este repositório

```bash
git clone https://github.com/SEU_USUARIO/sema-tct.git
cd sema-tct
```

### 2. Configurar o Google Apps Script

1. Abra a planilha **SEMA_Planilha_TCT_v2.xlsx** no Google Drive
2. Menu **Extensões → Apps Script**
3. Cole o conteúdo de `apps-script/Code.gs`
4. Salve (Ctrl+S)
5. Execute `setupSyncToken()` uma vez para gerar o token:
   - Clique em ▶ Executar → escolha `setupSyncToken`
   - Copie o token exibido no log (ícone 📋)
6. **Implantar → Novo implantação**:
   - Tipo: **Aplicativo da Web**
   - Executar como: **Eu** (sua conta Google)
   - Quem tem acesso: **Qualquer pessoa**
   - Clique em **Implantar** → copie a **URL do aplicativo da Web**

### 3. Configurar GitHub Secrets

No repositório GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `APPS_SCRIPT_URL` | URL do Web App copiada no passo 2 |
| `SYNC_TOKEN` | Token gerado pelo `setupSyncToken()` |
| `SENHA_HASH` | Hash SHA-256 da senha admin (veja abaixo) |
| `PUBLIC_URL` | `https://SEU_USUARIO.github.io/sema-tct/` |
| `ADMIN_URL` | `https://SEU_USUARIO.github.io/sema-tct/admin.html` |

**Gerar hash SHA-256 da senha admin** (execute no console do Chrome):
```javascript
crypto.subtle.digest('SHA-256', new TextEncoder().encode('SUA_SENHA_AQUI'))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
```

### 4. Habilitar GitHub Pages

**Settings → Pages**:
- Source: **GitHub Actions**
- Salvar

### 5. Fazer push e verificar

```bash
git add .
git commit -m "feat: initial deploy SEMA TCT v3"
git push origin main
```

O GitHub Actions irá:
1. Injetar os Secrets em `js/config.js`
2. Validar os arquivos HTML
3. Publicar no GitHub Pages

**URLs finais:**
- Público: `https://SEU_USUARIO.github.io/sema-tct/`
- Admin: `https://SEU_USUARIO.github.io/sema-tct/admin.html`

---

## 📁 Estrutura do repositório

```
/
├── index.html              # Painel público (cidadão)
├── admin.html              # Painel admin (ASJUR — senha protegido)
├── js/
│   ├── sync.js             # Módulo de sincronização (SEMASync class)
│   └── config.js           # Configuração (placeholders → Secrets)
├── apps-script/
│   └── Code.gs             # API REST Google Apps Script
├── .github/
│   └── workflows/
│       └── deploy.yml      # CI/CD GitHub Actions
└── README.md
```

---

## 🔄 Como a sincronização funciona

### Leitura (Sheets → Sistema)
```
Intervalo configurável (padrão 5 min)
  → GET {appsScriptUrl}?action=list
  → Apps Script lê DADOS_PÚBLICOS
  → Retorna JSON com registros
  → SEMASync faz merge (política: newest wins)
  → Cache em sessionStorage
  → UI atualizada
```

### Escrita (Sistema → Sheets)
```
Admin salva/exclui registro
  → SEMASync.save(record) / .remove(tipo, num)
  → POST {appsScriptUrl} {action:'upsert', token, record}
  → Apps Script valida token
  → Encontra linha por tipo+num ou insere nova
  → Retorna {ok, action, row}
  → Log registrado na aba SYNC_LOG
```

### Resolução de conflitos
- `newest` (padrão): registro com timestamp mais recente vence
- `local`: edições locais sempre prevalecem
- `remote`: versão do Sheets sempre prevalece

---

## 🔒 Segurança

| Camada | Implementação |
|---|---|
| Senha admin | Hash SHA-256 via Web Crypto API — nunca texto claro |
| Token de escrita | UUID aleatório em Propriedades do Apps Script |
| Sessão | sessionStorage (encerrada ao fechar aba) |
| HTTPS | Forçado pelo GitHub Pages e Google |
| Leitura pública | GET sem token — somente dados autorizados |
| Escrita | POST requer token — validado pelo Apps Script |
| Secrets | Nunca no código — injetados pelo GitHub Actions |

---

## 🛠️ Desenvolvimento local

```bash
# Servidor local simples (Python)
cd sema-tct
python3 -m http.server 8000
# Acessar: http://localhost:8000
```

Para testar com Apps Script real localmente, edite `js/config.js` diretamente com os valores reais (não commite).

---

## 📋 Endpoints da API (Apps Script)

| Método | Parâmetros | Descrição |
|---|---|---|
| GET | `?action=list&sheet=DADOS_PÚBLICOS` | Lista todos os registros |
| GET | `?action=status` | Verifica saúde da API |
| GET | `?action=schema` | Retorna estrutura de colunas |
| POST | `{action:'upsert', token, record}` | Cria/atualiza 1 registro |
| POST | `{action:'upsertBatch', token, records[]}` | Cria/atualiza N registros |
| POST | `{action:'delete', token, tipo, num}` | Remove 1 registro |

---

## 📞 Suporte

**ASJUR/SEMA/AC** — Wesley de Oliveira Jucá · OAB/AC 6.157  
sema.gabin@gmail.com · Rua Benjamin Constant, 856 · Rio Branco – AC
