# Modelo de Planilha — SEMA/AC Termos de Cooperação Técnica

> Este documento deve refletir literalmente os headers gerados por `_criarAba()` em
> `SEMA_Code.gs`. Ao alterar `HEADER_MAP`/`_criarAba`, atualize este arquivo no mesmo commit.

## Como usar este modelo

Execute a função `criarPlanilhaModelo()` no Google Apps Script para criar automaticamente
a aba `ACT - PAINEL PUBLICO` com toda a estrutura esperada pelo painel.

**Passos:**
1. No Google Sheets, abra **Extensões → Apps Script**.
2. Cole o `SEMA_Code.gs` atualizado.
3. Execute: **Executar → criarPlanilhaModelo**.
4. Verifique a aba criada `ACT - PAINEL PUBLICO`.
5. Mantenha os dados reais a partir da linha 3, preservando a linha 1 (título) e a linha 2
   (cabeçalhos) do modelo — não há linha de exemplo separada.

---

## Estrutura da Aba `ACT - PAINEL PUBLICO`

A aba padrão possui **19 colunas** (sem Esfera/Área), exatamente nesta ordem:

| Col | Nome | Tipo | Obrigatório | Descrição |
|-----|------|------|-------------|-----------|
| A | **Tipo** | Texto | ✅ | Sigla do instrumento: `ACT`, `Convênio`, `Protocolo`, `TAD`, `TCU`, `TCT` |
| B | **Número** | Texto | ✅ | Identificador único no formato `NNN/AAAA` (ex: `001/2025`). Formatar como **Texto** para evitar conversão automática de data |
| C | **Objeto** | Texto | ✅ | Descrição do objeto da cooperação |
| D | **Instituição** | Texto | ✅ | Nome da instituição parceira |
| E | **Início** | Data | — | Data de início (formato `dd/mm/aaaa`) |
| F | **Término** | Data | — | Data de vencimento (formato `dd/mm/aaaa`). Usada para calcular `Status` e `Dias_Restantes` |
| G | **Prazo_Indeterminado** | Checkbox | — | Marque para acordos sem data de término; suprime o cálculo automático de `Status`/`Dias_Restantes` |
| H | **Status** | Fórmula | — | Calculado automaticamente com base na coluna `Término`: `Vigente`, `A vencer`, `Vence em 30 dias` ou `Expirado` |
| I | **Dias_Restantes** | Fórmula | — | Calculado automaticamente: dias até o vencimento (negativo = já venceu) |
| J | **DOE** | Texto | — | Número da publicação no Diário Oficial do Estado |
| K | **DOU** | Texto | — | Número da publicação no Diário Oficial da União |
| L | **SEI** | Texto | — | Número do processo SEI (ex: `0820.000001/2025-00`) |
| M | **Link** | URL | — | Link para o PDF, página do instrumento ou página institucional relacionada |
| N | **Observação** | Texto | — | Notas públicas e informações complementares |
| O | **Data_Assinatura** | Data | — | Data de assinatura do instrumento (formato `dd/mm/aaaa`) |
| P | **Data_Publicação** | Data | — | Data de publicação oficial (formato `dd/mm/aaaa`) |
| Q | **Data_Cadastro** | Data | — | Data de cadastro na planilha (formato `dd/mm/aaaa`) |
| R | **Data_Atualização** | Data | — | Data da última atualização do registro (formato `dd/mm/aaaa`) |
| S | **Responsável** | Texto | — | Servidor/setor responsável pelo acompanhamento |

> A função `criarPlanilhaModelo()` aplica as fórmulas de `Status`/`Dias_Restantes`
> **dinamicamente**, via `applyFormulaRangeDynamic()`, cobrindo exatamente as linhas com
> dados reais (`getLastRow()`) — sem limite fixo de linhas. Ao inserir novas linhas de
> dados manualmente (colar/importar CSV), execute **ACT ▸ Reaplicar Fórmulas** no menu
> personalizado da planilha para estender as fórmulas até a última linha preenchida.

---

## Fórmulas recomendadas

As fórmulas abaixo são as mesmas geradas dinamicamente por `applyFormulaRangeDynamic()`
(via `FORMULA_COLS` em `SEMA_Code.gs`). Elas usam as colunas **F (`Término`)** e
**G (`Prazo_Indeterminado`)** como referência e ficam nas colunas **H (`Status`)** e
**I (`Dias_Restantes`)**.

### Status (coluna H, a partir de H3):
```spreadsheet
=IF(OR(G3=TRUE;F3="");"Prazo Indeterminado";IF(TODAY()>F3;"Expirado";IF(F3-TODAY()<=30;"Vence em 30 dias";IF(F3-TODAY()<=90;"A vencer";"Vigente"))))
```

### Dias_Restantes (coluna I, a partir de I3):
```spreadsheet
=IF(OR(G3=TRUE;F3="");"";F3-TODAY())
```

> Observação: o script grava as fórmulas com os nomes de função em inglês (`IF`, `OR`,
> `TODAY`) e separador `;`, porque esse é o formato aceito por `setFormulas()` no Google
> Apps Script. Se você editar manualmente em uma planilha configurada em português, o
> Google Sheets pode exibir ou aceitar a versão localizada equivalente (`SE`, `OU`, `HOJE`).
> Não é preciso copiar essas fórmulas manualmente — execute **ACT ▸ Reaplicar Fórmulas**
> no menu personalizado da planilha após inserir novas linhas de dados.

---

## Configuração da coluna "Número"

Para evitar que o Google Sheets converta `"001/2025"` em data automaticamente:

1. Selecione toda a coluna B.
2. Vá em **Formatar → Número → Texto simples**.

Ou use o formato via script, como feito em `criarPlanilhaModelo()`:
```javascript
sheet.getRange(3, 2, maxRow - 2, 1).setNumberFormat('@');
```

---

## Estrutura das linhas

| Linha | Conteúdo |
|-------|----------|
| 1 | **Título decorativo** mesclado nas 19 colunas (`SEMA/AC — Acordos de Cooperação Técnica — Acre`). Não é lido como cabeçalho pela API |
| 2 | **Cabeçalhos reais** lidos pela API: `Tipo`, `Número`, `Objeto`, `Instituição`, `Início`, `Término`, `Prazo_Indeterminado`, `Status`, `Dias_Restantes`, `DOE`, `DOU`, `SEI`, `Link`, `Observação`, `Data_Assinatura`, `Data_Publicação`, `Data_Cadastro`, `Data_Atualização`, `Responsável` |
| 3+ | **Dados reais**: um instrumento por linha — não há linha de exemplo separada; a planilha vazia começa a receber dados diretamente na linha 3 |

---

## Campos mínimos para os KPIs do painel público

O painel detecta automaticamente os campos pelos nomes das colunas.
Para que os KPIs (Vigentes / A vencer / Expirados / Parceiros) funcionem, mantenha os cabeçalhos padrão:

| KPI | Campo necessário no modelo |
|-----|----------------------------|
| Vigentes / Expirados / A vencer | **Status** calculado na coluna H ou **Término** na coluna F |
| Parceiros únicos | **Instituição** na coluna D |

Se esses campos forem removidos ou renomeados para um nome não reconhecido, o painel ainda pode exibir a tabela, mas os KPIs podem ficar incompletos ou zerados.

---

## Adicionando novas colunas

A estrutura oficial criada por `criarPlanilhaModelo()` termina na coluna S (`Responsável`).
Caso seja necessário incluir campos administrativos adicionais, adicione-os à direita da
coluna S para não alterar a ordem das 19 colunas padrão usadas pelo painel público.
