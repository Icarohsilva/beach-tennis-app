# Créditos de matrícula fixa, proporção mensal e renovação no dia 1

**Data:** 2026-06-14
**Status:** Design aprovado (aguardando revisão do spec)

## Problema

1. **Bug:** ao vincular um aluno a uma aula fixa, o sistema não consome créditos de forma confiável. A função [enrollStudentInClass](../../../features/aulas/adminActions.ts) só olha a **próxima** sessão e, se `credits_balance > 0` for falso, **não reserva nada e não debita** — silenciosamente. O admin acha que matriculou e debitou, mas não houve débito.
2. **Sem validação de plano:** o admin consegue criar matrícula fixa para aluno sem assinatura ativa.
3. **Concessão de créditos não é proporcional:** [adminSubscribeStudentToPlan](../../../features/financeiro/actions.ts) e [subscribeToPlan](../../../features/financeiro/actions.ts) concedem `credits_per_month` cheio, mesmo quando o plano é vinculado no meio do mês.
4. **Sem renovação mensal automática:** não existe rotina no dia 1 que reconceda créditos e debite as aulas do mês para as matrículas fixas.
5. **Base atual inconsistente:** alunos ativos que já têm matrícula fixa não tiveram os créditos do mês corrente debitados.

## Decisões (confirmadas com o usuário)

- **Proporção:** por **sessões reais restantes** das turmas em que o aluno está matriculado (1 crédito por sessão). Os créditos batem exatamente com as aulas agendadas.
- **Validação:** matrícula fixa **exige assinatura ativa**, **exceto** alunos `wellhub`/`totalpass` (que agendam sem crédito, via check-in).
- **Virada do mês:** créditos restantes do mês anterior são **acumulados** (não expiram na renovação).

## Conceito central: reconciliação de créditos por matrícula

Toda a lógica converge para uma única função reaproveitável:

```
reconcileEnrollmentCredits(studentId, classId, { from, to }) -> { booked, granted, debited, skipped }
```

Para cada sessão **`scheduled` e ainda não reservada** (`session_bookings` sem registro confirmado) daquela turma no intervalo `[from, to]`:

- **Aluno com crédito (subscriber / per_class):**
  1. **Concede** 1 crédito — `adjust_credits(+1, type='renewed', reason='Plano <nome> — aula <dd/mm>')`
  2. **Reserva** a sessão — `book_session_atomic(...)` com `from_enrollment=true`, `credit_used=true`
  3. **Debita** 1 crédito — `adjust_credits(-1, type='used', reason='Matrícula fixa — aula <dd/mm>', p_session_id=<id>)`
- **Aluno `wellhub`/`totalpass`:** apenas reserva a sessão (`credit_used=false`), sem concessão nem débito.

**Efeito:** o saldo das aulas fixas fica exatamente zerado (créditos = aulas), e o ledger `credit_transactions` mantém o histórico completo de concessão + débito por aula. Saldo de créditos avulsos/makeup acumulados é preservado.

**Idempotência:** sessões já reservadas (qualquer status confirmado para `from_enrollment`) são puladas. Rodar de novo (cron, re-vínculo, backfill) não duplica reservas nem lançamentos.

### Onde mora o código

- **Helper puro** em `lib/utils/` para enumerar/contar sessões e calcular janelas de mês (testável com Vitest, sem Supabase). Reaproveita [dateHelpers.ts](../../../lib/utils/dateHelpers.ts).
- **Função com efeito** (`reconcileEnrollmentCredits`) num módulo de feature server-side — `features/aulas/creditReconciliation.ts` — que usa `createAdminClient()` e as RPCs `adjust_credits` / `book_session_atomic`. As server actions e o cron importam daqui.

## Mudanças por ponto de entrada

### 1. Vincular plano — `adminSubscribeStudentToPlan` / `subscribeToPlan`

- Mantém criação da assinatura e validação de Wellhub/TotalPass.
- **Remove** a concessão "cheia" de `credits_per_month`.
- Após criar a assinatura, roda `reconcileEnrollmentCredits` para **cada matrícula ativa existente** do aluno, no intervalo `[hoje, fim do mês]`.
- Se o aluno ainda não tem matrícula, nada é concedido (os créditos entram quando a matrícula for criada).

### 2. Vincular matrícula fixa — `enrollStudentInClass`

- **Nova validação:** busca assinatura ativa do aluno. Se não houver **e** `payment_type` não for `wellhub`/`totalpass`, retorna erro: `"Aluno não possui plano ativo. Vincule um plano antes de criar a matrícula fixa."`
- Substitui o bloco atual (próxima sessão + débito condicional) por uma chamada a `reconcileEnrollmentCredits(studentId, classId, { from: hoje, to: fimDoMês })`.
- A UI [StudentProfileClient.tsx](../../../app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx) exibe o erro de validação como hoje (mesmo padrão de retorno `{ error }`).

### 3. Renovação no dia 1 — novo cron

- Nova rota `app/api/cron/monthly-credit-renewal/route.ts`, mesmo padrão de [waitlist-notifications](../../../app/api/cron/waitlist-notifications/route.ts) (header `Authorization: Bearer ${CRON_SECRET}`).
- Entrada em `vercel.json`: `{ "path": "/api/cron/monthly-credit-renewal", "schedule": "0 1 1 * *" }` (01:00 do dia 1).
- Para cada matrícula **ativa** cujo aluno tem assinatura ativa (ou é Wellhub/TotalPass), roda `reconcileEnrollmentCredits` sobre o **mês novo inteiro** (`[primeiro dia, último dia do mês]`).
- Créditos restantes do mês anterior **permanecem** (acúmulo). Não há passo de expiração.
- Retorna resumo `{ processedEnrollments, booked, granted, debited, skipped }` para observabilidade.

### 4. Backfill — execução pontual para a base atual

- **Objetivo:** descontar os créditos das aulas do **mês corrente** para alunos ativos que **já têm matrícula fixa** e nunca tiveram o débito.
- Reaproveita a rota do cron aceitando um parâmetro de intervalo, **ou** uma rota dedicada `app/api/cron/credit-backfill/route.ts` que roda `reconcileEnrollmentCredits` para todas as matrículas ativas no intervalo `[hoje, fim do mês]`.
- Protegida pelo mesmo `CRON_SECRET`; disparada manualmente uma vez (curl). Idempotente — sessões já reservadas/debitadas são puladas, então é seguro reexecutar.
- Retorna o mesmo resumo do cron para conferência.

## Tabela de comportamento

| Ação | Validação plano | Concede | Reserva sessões | Debita | Janela |
|---|---|---|---|---|---|
| Vincular plano | n/a | sim (p/ matrículas existentes) | sim | sim | hoje → fim do mês |
| Vincular matrícula | exige (exceto WH/TP) | sim | sim | sim | hoje → fim do mês |
| Cron dia 1 | já garantida | sim | sim | sim | mês novo inteiro |
| Backfill | já garantida | sim | sim | sim | hoje → fim do mês |
| Wellhub/TotalPass (qualquer) | dispensada | não | sim | não | conforme ação |

## `generateWeeklyBookings`

A função [generateWeeklyBookings](../../../features/aulas/adminActions.ts) (14 dias, manual, na tela de grade) fica **redundante** com o cron + reconciliação. Decisão: **refatorar para chamar `reconcileEnrollmentCredits`** por turma (mantém o botão da grade útil para reservas ad-hoc), eliminando a lógica duplicada de débito. Não remover a tela.

## Tratamento de erros

- `reconcileEnrollmentCredits` trata `INSUFFICIENT_CREDITS` por sessão: como concede antes de debitar, isso não deve ocorrer no fluxo normal; se ocorrer (corrida), registra a sessão em `skipped` e segue, sem abortar o lote.
- Falhas de RPC isoladas não interrompem o processamento das demais matrículas no cron/backfill (log + contador `skipped`).
- Wellhub/TotalPass sem crédito: nunca chama `adjust_credits`.

## Testes

- **Unitários (Vitest):** helper de datas/contagem de sessões no mês (casos: início, meio, fim do mês; mês com 4 vs 5 ocorrências do dia da semana; sessões `cancelled` ignoradas).
- **Lógica de reconciliação:** testar contagem de concessões/débitos e idempotência (segunda execução = 0 novas reservas) com client Supabase mockado.
- **Validação de matrícula:** subscriber sem plano → erro; Wellhub/TotalPass sem plano → permitido.

## Fora de escopo

- Cobrança/gateway de pagamento na renovação (apenas créditos).
- Expiração de créditos mensais (decisão: acúmulo).
- UI nova de relatório do ledger (o histórico já existe em `credit_transactions`).
