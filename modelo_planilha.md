# Modelo de Planilha — SEMA/AC Termos de Cooperação Técnica

## Como usar este modelo

Execute a função `criarPlanilhaModelo()` no Google Apps Script para criar automaticamente
a aba `ACT - PAINEL PUBLICO` com toda a estrutura esperada pelo painel.

**Passos:**
1. No Google Sheets, abra **Extensões → Apps Script**.
2. Cole o `SEMA_Code.gs` atualizado.
3. Execute: **Executar → criarPlanilhaModelo**.
4. Verifique a aba criada `ACT - PAINEL PUBLICO`.
5. Mantenha os dados reais a partir da linha 4, preservando a linha 1, a linha 2 e a linha 3 do modelo.

---

## Estrutura da Aba `ACT - PAINEL PUBLICO`

A aba padrão possui **15 colunas**, exatamente nesta ordem:

| Col | Nome | Tipo | Obrigatório | Descrição |
|-----|------|------|-------------|-----------|
| A | **Tipo** | Texto | ✅ | Sigla do instrumento: `ACT`, `Convênio`, `Protocolo`, `TAD`, `TCU`, `TCT` |
| B | **Número** | Texto | ✅ | Identificador único no formato `NNN/AAAA` (ex: `001/2025`). Formatar como **Texto** para evitar conversão automática de data |
| C | **Objeto** | Texto | ✅ | Descrição do objeto da cooperação |
| D | **Instituição** | Texto | ✅ | Nome da instituição parceira |
| E | **Esfera** | Texto | — | `Federal`, `Estadual`, `Municipal`, `Misto`, `Privado` |
| F | **Início** | Data | — | Data de início (formato `dd/mm/aaaa`) |
| G | **Término** | Data | — | Data de vencimento (formato `dd/mm/aaaa`). Usada para calcular `Status` e `Dias Restantes` |
| H | **Área** | Texto | — | Tema: `Recursos Hídricos`, `Gestão ambiental`, `Biodiversidade`, `Monitoramento`, etc. |
| I | **Status** | Fórmula | — | Calculado automaticamente com base na coluna `Término`: `Vigente`, `A vencer`, `Vence em 30 dias` ou `Expirado` |
| J | **Dias Restantes** | Fórmula | — | Calculado automaticamente: dias até o vencimento (negativo = já venceu) |
| K | **DOE Nº** | Texto | — | Número da publicação no Diário Oficial do Estado |
| L | **DOU Nº** | Texto | — | Número da publicação no Diário Oficial da União |
| M | **SEI** | Texto | — | Número do processo SEI (ex: `0820.000001/2025-00`) |
| N | **Link** | URL | — | Link para o PDF, página do instrumento ou página institucional relacionada |
| O | **Observação** | Texto | — | Notas públicas e informações complementares |

> A função `criarPlanilhaModelo()` aplica as fórmulas automaticamente nas colunas **I** e **J** até a linha 502, cobrindo 500 registros a partir da linha 3.
> Para mais linhas, arraste/copie as fórmulas de `Status` e `Dias Restantes` para baixo.

---

## Fórmulas recomendadas

As fórmulas abaixo são as mesmas geradas por `criarPlanilhaModelo()` via `applyFormulaRange()`.
Elas usam a coluna **G (`Término`)** como referência e devem ficar nas colunas **I (`Status`)** e **J (`Dias Restantes`)**.

### Status (coluna I, a partir de I3):
```spreadsheet
=IF(G3="","",IF(TODAY()>G3,"Expirado",IF(G3-TODAY()<=30,"Vence em 30 dias",IF(G3-TODAY()<=90,"A vencer","Vigente"))))
```

### Dias Restantes (coluna J, a partir de J3):
```spreadsheet
=IF(G3="","",G3-TODAY())
```

> Observação: o script grava as fórmulas com os nomes de função em inglês (`IF`, `TODAY`) porque esse é o formato aceito por `setFormulas()` no Google Apps Script. Se você editar manualmente em uma planilha configurada em português, o Google Sheets pode exibir ou aceitar a versão localizada equivalente (`SE`, `HOJE`).

---

## Configuração da coluna "Número"

Para evitar que o Google Sheets converta `"001/2025"` em data automaticamente:

1. Selecione toda a coluna B.
2. Vá em **Formatar → Número → Texto simples**.

Ou use o formato via script, como feito em `criarPlanilhaModelo()`:
```javascript
sheet.getRange(3, 2, 500, 1).setNumberFormat('@');
```

---

## Estrutura das linhas

| Linha | Conteúdo |
|-------|----------|
| 1 | **Título decorativo** mesclado nas 15 colunas (`SEMA/AC — Acordos de Cooperação Técnica — Acre`). Não é lido como cabeçalho pela API |
| 2 | **Cabeçalhos reais** lidos pela API: `Tipo`, `Número`, `Objeto`, `Instituição`, `Esfera`, `Início`, `Término`, `Área`, `Status`, `Dias Restantes`, `DOE Nº`, `DOU Nº`, `SEI`, `Link`, `Observação` |
| 3 | **Linha de exemplo** criada pelo script, já com fórmulas nas colunas `Status` e `Dias Restantes` |
| 4+ | **Dados reais**: um instrumento por linha |

---

## Campos mínimos para os KPIs do painel público

O painel detecta automaticamente os campos pelos nomes das colunas.
Para que os KPIs (Vigentes / A vencer / Expirados / Parceiros) funcionem, mantenha os cabeçalhos padrão:

| KPI | Campo necessário no modelo |
|-----|----------------------------|
| Vigentes / Expirados / A vencer | **Status** calculado na coluna I ou **Término** na coluna G |
| Parceiros únicos | **Instituição** na coluna D |

Se esses campos forem removidos ou renomeados para um nome não reconhecido, o painel ainda pode exibir a tabela, mas os KPIs podem ficar incompletos ou zerados.

---

## Adicionando novas colunas

A estrutura oficial criada por `criarPlanilhaModelo()` termina na coluna O (`Observação`).
Caso seja necessário incluir campos administrativos adicionais, adicione-os à direita da coluna O para não alterar a ordem das 15 colunas padrão usadas pelo painel público.
