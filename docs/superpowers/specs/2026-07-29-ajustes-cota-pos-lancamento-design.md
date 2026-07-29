# Ajustes de cota pós-lançamento — Design

**Goal:** Três ajustes relatados depois do lançamento da cota compartilhada: (1) rótulo do dashboard do aluno mostrando a cota mensal em vez de "aulas nesta semana"; (2) um bug real que a própria cota compartilhada introduziu — matricular um aluno fixo perto do fim do mês reserva o resto do mês sem checar quanto de cota já foi usado; (3) uma mudança de política — o admin, ao adicionar um aluno manualmente numa sessão específica, passa a respeitar o teto diário e a cota restante, com um botão de "forçar" pra quando quiser furar mesmo assim.

## 1. Dashboard: `Nesta semana` vira a cota mensal

`app/(dashboard)/home/page.tsx`: o `stats` do `HeroHeader` tem hoje `{ label: 'Nesta semana', value: mySessions.length }`, e logo abaixo um card separado mostra "Aulas do plano ... X de Y". Os dois viram um só: o stat `Nesta semana` some, e no lugar dele entra `{ label: 'Aulas do plano' + (mensal/semanal), value: '${quota.used}/${quota.limit}' }` — só quando `quota` existir (aluno com plano e cota ligada); quando não existir, o stat continua ausente (não aparece nem "0/0"). O card separado abaixo do `HeroHeader` é removido — a mensagem de "cota esgotada" que ele mostrava passa a aparecer como um aviso pequeno separado, só quando `quota.remaining === 0` (não faz sentido dentro de um stat de header).

## 2. Bug: matrícula fixa perto do fim do mês ignora a cota já usada

**O que está errado:** `enrollStudentInClass` (`features/aulas/adminActions.ts:147-149`), depois de criar a matrícula, chama `reconcileEnrollmentCredits(studentId, classId, today, monthEnd)` sem orçamento de cota — reserva TODAS as sessões da turma até o fim do mês incondicionalmente. Isso ignora quanto da cota mensal o aluno já gastou (avulsas, ou outras fixas) — exatamente o problema que a Task 4 da cota compartilhada resolveu para a geração semanal automática (`reconcileAllActiveEnrollments`), mas essa chamada de matrícula nunca foi atualizada pra usar o mesmo orçamento.

**A correção:** extrair o cálculo de orçamento (hoje só existe dentro de `reconcileAllActiveEnrollments`) para uma função pura reaproveitável, `computeQuotaBudget`, em `features/aulas/quotaBudget.ts`:

```ts
export async function computeQuotaBudget(
  client: AdminClient,
  studentId: string,
  orgId: string,
  quotaEnforced: boolean,
  partner: string | null,
  targetDate: string,
): Promise<{ budget: number | null; plan: PlanQuota | null }>
```

`reconcileAllActiveEnrollments` passa a chamar essa função (mantendo o cache de `isQuotaEnforced` por academia que já tem, só passando o booleano já resolvido). `enrollStudentInClass` passa a chamar a MESMA função antes do `reconcileEnrollmentCredits`, e passa o `budget` resultante como 6º argumento — igual a geração semanal já faz.

## 3. Admin respeita cota ao adicionar aluno manualmente, com botão de forçar

**Hoje:** `addStudentToSession` (`features/aulas/adminActions.ts:570-701`) chama `resolveClassAccess` com `quotaEnforced: false` fixo — o eixo de cota nunca é avaliado, documentado como decisão deliberada (spec de cota §5).

**Novo comportamento:** o eixo de cota/teto diário passa a ser avaliado de verdade (mesmos dados que `bookSession` usa: `getActivePlan`, `isQuotaEnforced`, `getOrgMaxClassesPerDay`, `getQuotaSnapshot`). Se a decisão vier `denied: 'daily_cap'` ou `denied: 'quota_exhausted'` **e a chamada não veio com `force: true`**, a action devolve `{ error: <mensagem>, quotaBlocked: true }` sem reservar nada. Com `force: true`, a action ignora essa negação especificamente e segue o fluxo de sempre (capacidade, duplicidade, crédito/dívida) — **dívida continua sempre furada pelo admin, isso não muda** (só o eixo de cota/teto diário ganha o gate).

**UI** (`features/aulas/AddStudentToSession.tsx`): `onAdd` ganha um parâmetro `force` (default `false`, não exposto ao usuário na primeira tentativa). Quando o resultado vem com `quotaBlocked: true`, em vez do erro genérico aparece a mensagem mais um botão "Adicionar mesmo assim" que rechama `onAdd` com `force: true`.

## Fora deste design

- Comportamento de `bookSession` (o aluno reservando por conta própria) — inalterado.
- Bloqueio por dívida em `addStudentToSession` — continua sempre furado pelo admin, sem botão de forçar (já não é bloqueado hoje).
- Qualquer mudança em `resolveClassAccess`/`resolveQuota` — a mudança é só nos dois call sites (`enrollStudentInClass`, `addStudentToSession`), a lógica de decisão em si não muda.
