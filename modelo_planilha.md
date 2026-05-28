# Modelo de Planilha — SEMA/AC Termos de Cooperação Técnica

## Como usar este modelo

Execute a função `criarPlanilhaModelo()` no Google Apps Script para criar automaticamente
a aba `DADOS_TCT_MODELO` com toda a estrutura correta.

**Passos:**
1. No Google Sheets, abra **Extensões → Apps Script**
2. Cole o `SEMA_Code.gs` atualizado
3. Execute: **Executar → criarPlanilhaModelo**
4. Verifique a aba criada `DADOS_TCT_MODELO`
5. Renomeie para `DADOS_PÚBLICOS` (substitui a aba antiga)

---

## Estrutura da Aba `DADOS_PÚBLICOS`

| Col | Nome | Tipo | Obrigatório | Descrição |
|-----|------|------|-------------|-----------|
| A | **Tipo** | Texto | ✅ | Sigla do instrumento: `ACT`, `Convênio`, `Protocolo`, `TAD`, `TCU`, `TCT` |
| B | **Número** | Texto | ✅ | Identificador único no formato `NN/AAAA` (ex: `49/2025`). Formatar como **Texto** para evitar conversão automática de data |
| C | **Objeto** | Texto | ✅ | Descrição do objeto da cooperação |
| D | **Instituição** | Texto | ✅ | Nome da instituição parceira |
| E | **Esfera** | Texto | — | `Federal`, `Estadual`, `Municipal`, `Misto`, `Privado` |
| F | **Início** | Data | — | Data de início (formato `dd/mm/aaaa`) |
| G | **Término** | Data | — | Data de vencimento (formato `dd/mm/aaaa`). Usada para calcular KPIs |
| H | **Área** | Texto | — | Tema: `Gestão ambiental`, `Biodiversidade`, `Monitoramento`, etc. |
| I | **SEI** | Texto | — | Número do processo SEI (ex: `0820.000001/2025-00`) |
| J | **Link Documentação** | URL | — | Link para o PDF ou página do instrumento |
| K | **Observações** | Texto | — | Notas públicas (ex: `Publicado no DOE nº 14.000`) |
| L | **Status** | Fórmula | — | Calculado automaticamente: `Vigente`, `A vencer`, `Vence em 30 dias`, `Expirado` |
| M | **Dias Restantes** | Fórmula | — | Calculado automaticamente: dias até o vencimento (negativo = já venceu) |

> **Colunas adicionais são bem-vindas!** Qualquer coluna nova adicionada à direita
> aparecerá automaticamente no painel público sem necessidade de alterar código.

---

## Fórmulas recomendadas

### Status (coluna L, a partir de L3):
```
=SE(G3="";"";SE(HOJE()>G3;"Expirado";SE(G3-HOJE()<=30;"Vence em 30 dias";SE(G3-HOJE()<=90;"A vencer";"Vigente"))))
```

### Dias Restantes (coluna M, a partir de M3):
```
=SE(G3="";"";G3-HOJE())
```

---

## Configuração da coluna "Número"

Para evitar que o Google Sheets converta `"01/2025"` em data automaticamente:

1. Selecione toda a coluna B
2. Vá em **Formatar → Número → Texto simples**

Ou use o formato via script:
```javascript
sheet.getRange(3, 2, 1000, 1).setNumberFormat('@STRING@');
```

---

## Estrutura das linhas

| Linha | Conteúdo |
|-------|----------|
| 1 | Título decorativo (texto livre) |
| 2 | **Cabeçalhos** (lidos pela API para identificar as colunas) |
| 3+ | Dados (um instrumento por linha) |

---

## Campos mínimos para os KPIs do painel público

O painel detecta automaticamente os campos pelos nomes das colunas.
Para que os KPIs (Vigentes / A vencer / Expirados / Parceiros) funcionem, inclua:

| KPI | Campo necessário |
|-----|------------------|
| Vigentes / Expirados / A vencer | Coluna com **"Status"** ou **"Término"** |
| Parceiros únicos | Coluna com **"Instituição"** ou **"Inst"** |

Se não existirem esses campos, o painel ainda exibe a tabela — os KPIs ficam em `0`.

---

## Adicionando novas colunas

Basta adicionar uma coluna nova no Google Sheets (ex: `"Responsável"`, `"Valor R$"`).
O painel público irá detectá-la automaticamente no próximo ciclo de atualização (60s).

**Não é necessário alterar nenhum arquivo de código.**
