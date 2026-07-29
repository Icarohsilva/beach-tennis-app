# Checkin diário único conta pra meta mensal — Design

**Goal:** Aluno Wellhub/TotalPass que entra em mais de uma aula no mesmo dia continua entrando normalmente nas duas (parceiro nunca é bloqueado) — mas só o primeiro checkin do dia soma pra meta mensal (`monthly_checkin_target`). O segundo (e qualquer outro no mesmo dia) não conta; o aluno precisaria ir em outro dia pra bater a meta.

**Contexto:** Motivado por uma observação no dashboard — hoje a contagem de progresso é "quantas linhas em `checkins` este mês", não "quantos dias distintos". Um aluno que faz 2 aulas na terça e nenhuma na quarta aparece com 2 de progresso, quando deveria aparecer com 1.

## Escopo

**Dentro:** as 3 telas que mostram "quantos checkins o aluno já fez pra bater a meta mensal":
1. `app/(dashboard)/home/page.tsx` — o próprio aluno vê no dashboard.
2. `app/(admin)/admin/alunos/[id]/page.tsx` + `StudentProfileClient.tsx` — o admin vê na ficha do aluno.
3. `features/checkin/actions.ts`'s `monthlyProgress()` — recalculado depois de um checkin novo (webhook).

**Fora:** `features/financeiro/partnerRevenueActions.ts` — o cálculo de quanto a academia recebe do parceiro continua contando linha por linha. Isso é uma decisão de negócio separada (quantos checkins o Wellhub/TotalPass realmente reembolsa por dia) que não foi validada agora — mudar isso seria alterar quanto a academia espera receber sem confirmação.

## Arquitetura

Novo helper puro-de-I/O em `lib/checkin/monthlyProgress.ts`:

```ts
export async function countDistinctCheckinDays(
  client: AdminClient,
  studentId: string,
  orgId: string,
  window: { from: string; to: string },
): Promise<number>
```

Busca as linhas de `checkins` no intervalo (como já é feito hoje) e conta **dias distintos** (`new Set(checkin_date)`), não linhas. `lib/checkin/progress.ts`'s `computeProgress(target, done)` não muda — continua puro, só passa a receber `done` = dias distintos em vez de linhas.

Os 3 locais dentro do escopo passam a usar esse helper (ou, no caso da ficha do admin, que já busca as linhas completas pra exibir o histórico, aplicam a mesma lógica de `Set` sobre os dados já buscados, sem uma query nova).

## Fora deste design

- Qualquer indicação visual de "esse checkin específico não contou" no histórico do admin — não foi pedido.
- Mudança no cálculo de receita do parceiro (`partnerRevenueActions.ts`).
- Qualquer bloqueio de entrada — parceiro nunca é impedido de entrar, isso não muda.
