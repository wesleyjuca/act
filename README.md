# SEMA/AC — Painel de Acordos de Cooperação Técnica

Painel público de transparência dos Acordos de Cooperação Técnica da **Secretaria de Estado do Meio Ambiente do Acre — SEMA/AC**.

Sistema **somente leitura**: os dados são editados diretamente na planilha Google Sheets e exibidos no painel público em tempo real.

---

## Arquitetura

```
[Google Sheets]  ──▶  [Apps Script Web App]  ──GET (JSONP)──▶  [index.html]
  (edição direta)         (API somente leitura)                  (GitHub Pages)
```

| Componente | Arquivo | Função |
|---|---|---|
| Painel público | `index.html` | Exibe os dados ao cidadão (tabela, KPIs, gráficos, alertas, PDF) |
| Configuração | `js/config.js` | URL do Apps Script e parâmetros do painel |
| API REST | `SEMA_Code.gs` | Google Apps Script — lê o Sheets e responde via JSONP |
| CI/CD | `.github/workflows/deploy.yml` | Deploy automático no GitHub Pages |

---

## Setup (3 passos)

### 1. Configurar o Google Apps Script

1. Abra a planilha no Google Drive → **Extensões → Apps Script**
2. Cole o conteúdo de `SEMA_Code.gs` e salve (Ctrl+S)
3. Execute `criarPlanilhaModelo()` uma vez (▶ Executar) — cria a aba `ACT - PAINEL PUBLICO` com as 15 colunas e fórmulas de Status/Dias Restantes
4. **Implantar → Nova implantação**:
   - Tipo: **Aplicativo da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
   - Copie a **URL do aplicativo da Web** (`/exec`)
5. Cole essa URL em `js/config.js` → `appsScriptUrl`

### 2. Habilitar GitHub Pages

**Settings → Pages** → Source: **GitHub Actions**

### 3. Publicar

```bash
git push origin main
```

O GitHub Actions valida os arquivos e publica no GitHub Pages automaticamente.

---

## Como alimentar os dados

Edite diretamente a aba **`ACT - PAINEL PUBLICO`** na planilha, a partir da **linha 4**:

| Col | Cabeçalho | Observação |
|-----|-----------|------------|
| A | Tipo | ACT, etc. |
| B | Número | texto (ex.: `001/2025`) |
| C | Objeto | descrição |
| D | Instituição | parceiro |
| E | Esfera | Federal / Estadual / Municipal / Internacional |
| F | Início | data `dd/mm/aaaa` |
| G | Término | data `dd/mm/aaaa` — base das fórmulas |
| H | Área | área temática |
| I | Status | **fórmula automática** (não editar) |
| J | Dias Restantes | **fórmula automática** (não editar) |
| K | DOE Nº | — |
| L | DOU Nº | — |
| M | SEI | — |
| N | Link | URL |
| O | Observação | — |

As colunas **Status** e **Dias Restantes** se calculam sozinhas a partir da data de **Término**.

---

## Estrutura do repositório

```
/
├── index.html                  # Painel público
├── js/
│   └── config.js               # Configuração (URL do Apps Script)
├── SEMA_Code.gs                # Código do Google Apps Script (somente leitura)
├── modelo_planilha.md          # Referência do modelo de planilha
├── .github/workflows/deploy.yml
└── README.md
```

---

## Endpoints da API (Apps Script — somente GET)

Todos suportam JSONP via `?callback=nome`.

| Endpoint | Descrição |
|---|---|
| `?action=ping` | Diagnóstico (versão, existência da aba) |
| `?action=list` | Lista todos os registros |
| `?action=schema` | Estrutura das colunas |
| `?action=status` | Contagem de linhas + timestamp |
| `?action=export` | Download CSV |

---

## Recursos do painel público

- Tabela responsiva com ordenação, busca (com debounce) e paginação
- KPIs clicáveis (Vigentes / A vencer / Urgente / Expirados / Parceiros)
- Gráficos (situação, por tipo, vencimentos por ano)
- **Alertas de vencimento** (≤30 dias / expirados) no topo
- **Exportação CSV** e **PDF/Impressão** da visão filtrada
- Tema claro/escuro, cache local e reconexão automática

---

## Suporte

**ASJUR/SEMA/AC** — Rio Branco - AC · sema.gabin@gmail.com
