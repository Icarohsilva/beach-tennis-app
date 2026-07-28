# Cota de aulas por plano — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `subscription_plans.classes_per_week` valer de verdade — limitar quantas aulas o aluno de plano pode reservar por ciclo e por dia, sem bloquear as aulas fixas que ele assinou.

**Architecture:** A cota é **derivada**, não armazenada: um módulo puro (`lib/utils/classQuota.ts`) calcula a janela do ciclo e o limite, e um módulo de I/O (`features/aulas/quotaUsage.ts`) conta as reservas do aluno naquela janela. `resolveClassAccess` ganha os eixos de cota e teto diário. Nenhum crédito novo é emitido — crédito continua sendo só avulsa comprada.

**Tech Stack:** TypeScript · Next.js 14 App Router · Supabase (Postgres + PostgREST) · Vitest · date-fns

**Spec:** [`docs/superpowers/specs/2026-07-28-cota-de-aulas-por-plano-design.md`](../specs/2026-07-28-cota-de-aulas-por-plano-design.md)

---

## Escopo deste plano

Só a **cota**. A desativação de aluno (`contract_active`) é o plano 2 e não entra aqui — `AccessInput` não ganha `contractActive` nesta rodada. Cada plano precisa entregar software funcionando sozinho.

**Divergência deliberada do spec:** o spec esboça `canBookOn()` em `classQuota.ts`. Este plano não a implementa — a decisão de "pode reservar?" fica inteira em `resolveClassAccess`, que já é o ponto único de decisão de acesso. Duplicar a regra em dois módulos criaria duas fontes de verdade. `classQuota.ts` fica só com o cálculo.

## Ambiente

Rode os testes com a ferramenta **PowerShell**, não Bash — `vitest` via Bash falha aleatoriamente neste ambiente com `"config" undefined`.

`supabase db push` **não funciona** nesta máquina (falta autenticação). A migração é entregue como SQL para o usuário aplicar no SQL Editor do Supabase. Ver Task 1.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260728000000_plan_quota.sql` (novo) | enum `plan_cycle`, 3 colunas em `subscription_plans`, 2 chaves em `system_settings` |
| `lib/utils/classQuota.ts` (novo) | Puro: janela do ciclo, contagem de semanas, limite, uso |
| `lib/utils/classQuota.test.ts` (novo) | Testes do puro |
| `types/index.ts` (mod) | `PlanCycle`; campos novos em `SubscriptionPlan` |
| `lib/billing/planEligibility.ts` (mod) | `getActivePlan()` devolvendo a configuração, não booleano |
| `lib/billing/planEligibility.test.ts` (mod) | Teste de `getActivePlan` |
| `lib/utils/accessRules.ts` (mod) | Eixos de teto diário e cota |
| `lib/utils/accessRules.test.ts` (mod) | Matriz de precedência estendida |
| `features/aulas/quotaUsage.ts` (novo) | I/O: monta o retrato da cota de um aluno |
| `features/aulas/quotaUsage.test.ts` (novo) | Testes com stub de client |
| `features/aulas/actions.ts` (mod) | `bookSession` consulta a cota |
| `features/aulas/adminActions.ts` (mod) | `enrollStudentInClass` valida nº de fixas |
| `app/(admin)/admin/financeiro/adminActions.ts` (mod) | `createPlan`/`updatePlan` com os campos novos |
| `app/(admin)/admin/financeiro/PlansManager.tsx` (mod) | Formulário do plano |
| `app/(dashboard)/agendar/page.tsx` (mod) | "3 de 8 aulas neste mês" |

---

### Task 1: Migração de schema

**Files:**
- Create: `supabase/migrations/20260728000000_plan_quota.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20260728000000_plan_quota.sql
-- Cota de aulas por plano. Ver docs/superpowers/specs/2026-07-28-cota-de-aulas-por-plano-design.md

create type plan_cycle as enum ('weekly', 'monthly');

alter table subscription_plans
  add column cycle                plan_cycle not null default 'monthly',
  add column max_classes_per_day  int        not null default 2,
  add column refund_on_late_cancel boolean   not null default true;

-- Teto diário para aluno SEM plano (o do plano cobre quem tem).
insert into system_settings (organization_id, key, value)
select id, 'max_classes_per_day', '2' from organizations
on conflict (organization_id, key) do nothing;

-- A cota nasce DESLIGADA. Ligar numa migração bloquearia alunos no meio de um
-- ciclo em curso, sem aviso. Cada academia liga quando revisar seus planos.
insert into system_settings (organization_id, key, value)
select id, 'quota_enforcement_enabled', 'false' from organizations
on conflict (organization_id, key) do nothing;

-- Índice para a contagem de reservas do ciclo (student + janela de datas).
create index if not exists session_bookings_student_status_idx
  on session_bookings (student_id, status);
```

- [ ] **Step 2: Verificar a constraint única de system_settings**

Antes de confiar no `on conflict`, confirme que existe unique em `(organization_id, key)`:

Run: `Select-String -Path supabase/migrations/*.sql -Pattern "system_settings" -Context 0,8`
Expected: encontrar a definição da tabela com `unique (organization_id, key)`. Se **não** existir, troque os dois `insert ... on conflict` por `insert ... where not exists (select 1 from system_settings s where s.organization_id = organizations.id and s.key = '<chave>')`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260728000000_plan_quota.sql
git commit -m "feat(planos): schema da cota de aulas por plano"
```

- [ ] **Step 4: Entregar o SQL ao usuário**

Não tente aplicar. Diga ao usuário: "Migração pronta em `supabase/migrations/20260728000000_plan_quota.sql`. Aplique no SQL Editor do Supabase antes da Task 8, que é quando o código passa a ler as colunas novas."

---

### Task 2: Tipos

**Files:**
- Modify: `types/index.ts:262-269`

- [ ] **Step 1: Estender `SubscriptionPlan`**

Substitua a interface existente por:

```ts
export type PlanCycle = 'weekly' | 'monthly'

export interface SubscriptionPlan {
  id: string
  organization_id: string
  name: string
  description: string | null
  classes_per_week: number
  cycle: PlanCycle
  max_classes_per_day: number
  refund_on_late_cancel: boolean
  is_active: boolean
}
```

- [ ] **Step 2: Verificar que nada quebrou**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo em `features/`, `lib/` ou `app/`. Erros pré-existentes em `lib/branding/palette.test.ts`, `lib/torneios/schedule/americano.test.ts` e `types/index.test.ts` já existiam antes desta tarefa — ignore.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(planos): campos de cota no tipo SubscriptionPlan"
```

---

### Task 3: `cycleWindow` — janela do ciclo

**Files:**
- Create: `lib/utils/classQuota.ts`
- Create: `lib/utils/classQuota.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/utils/classQuota.test.ts
import { describe, it, expect } from 'vitest'
import { cycleWindow } from './classQuota'

describe('cycleWindow', () => {
  it('semanal: quarta-feira devolve a segunda e o domingo da mesma semana', () => {
    // 2026-07-29 é uma quarta-feira.
    expect(cycleWindow('2026-07-29', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: a própria segunda é o início da janela', () => {
    expect(cycleWindow('2026-07-27', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: domingo fecha a semana que começou na segunda anterior', () => {
    // 2026-08-02 é domingo. Não pode abrir uma semana nova.
    expect(cycleWindow('2026-08-02', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('mensal: devolve o primeiro e o último dia do mês', () => {
    expect(cycleWindow('2026-07-28', 'monthly')).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('mensal: fevereiro não-bissexto termina no dia 28', () => {
    expect(cycleWindow('2026-02-10', 'monthly')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (ferramenta PowerShell): `npm run test:run -- lib/utils/classQuota.test.ts`
Expected: FAIL — `Failed to resolve import "./classQuota"`

- [ ] **Step 3: Implementar**

```ts
// lib/utils/classQuota.ts
// Cota de aulas do plano. Puro, sem I/O — o caller busca os dados.
// Toda data é yyyy-MM-dd em BRT; nada de Date local (ver gridSchedule.ts).
import { addDaysStr } from './gridSchedule'

export type PlanCycle = 'weekly' | 'monthly'

/** Dia da semana (0=domingo) de uma data yyyy-MM-dd, em UTC puro. */
function dowOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Janela [from, to] do ciclo que contém `dateStr`.
 * Semanal = segunda a domingo. Mensal = mês calendário.
 */
export function cycleWindow(dateStr: string, cycle: PlanCycle): { from: string; to: string } {
  if (cycle === 'weekly') {
    const dow = dowOf(dateStr)
    // Domingo (0) fecha a semana que começou 6 dias antes, não abre uma nova.
    const backToMonday = dow === 0 ? 6 : dow - 1
    const from = addDaysStr(dateStr, -backToMonday)
    return { from, to: addDaysStr(from, 6) }
  }

  const [y, m] = dateStr.split('-').map(Number)
  // Dia 0 do mês seguinte = último dia deste mês.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/utils/classQuota.test.ts`
Expected: PASS — 5 testes

- [ ] **Step 5: Commit**

```bash
git add lib/utils/classQuota.ts lib/utils/classQuota.test.ts
git commit -m "feat(cota): janela do ciclo semanal e mensal"
```

---

### Task 4: `countCycleWeeks` — semanas do ciclo

**Files:**
- Modify: `lib/utils/classQuota.ts`
- Modify: `lib/utils/classQuota.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao arquivo de teste (e adicione `countCycleWeeks` ao import do topo):

```ts
describe('countCycleWeeks', () => {
  it('janela semanal tem exatamente 1 semana', () => {
    expect(countCycleWeeks('2026-07-27', '2026-08-02')).toBe(1)
  })

  it('julho/2026 tem 4 segundas-feiras', () => {
    // Segundas: 06, 13, 20, 27.
    expect(countCycleWeeks('2026-07-01', '2026-07-31')).toBe(4)
  })

  it('junho/2026 tem 5 segundas-feiras', () => {
    // Segundas: 01, 08, 15, 22, 29.
    expect(countCycleWeeks('2026-06-01', '2026-06-30')).toBe(5)
  })

  it('janela de um dia que não é segunda conta zero', () => {
    expect(countCycleWeeks('2026-07-28', '2026-07-28')).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/utils/classQuota.test.ts`
Expected: FAIL — `countCycleWeeks is not a function`

- [ ] **Step 3: Implementar**

Acrescente a `lib/utils/classQuota.ts`:

```ts
/**
 * Semanas seg–dom que COMEÇAM dentro de [from, to] — ou seja, quantas
 * segundas-feiras a janela contém. É a única contagem determinística de
 * "semanas do mês" (4 ou 5). O descasamento de até 1 para alunos com fixa em
 * outro dia da semana é absorvido pelo max() de resolveQuota.
 */
export function countCycleWeeks(from: string, to: string): number {
  let count = 0
  let cursor = from
  while (cursor <= to) {
    if (dowOf(cursor) === 1) count++
    cursor = addDaysStr(cursor, 1)
  }
  return count
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/utils/classQuota.test.ts`
Expected: PASS — 9 testes

- [ ] **Step 5: Commit**

```bash
git add lib/utils/classQuota.ts lib/utils/classQuota.test.ts
git commit -m "feat(cota): contagem de semanas do ciclo"
```

---

### Task 5: `resolveQuota` — limite e uso

**Files:**
- Modify: `lib/utils/classQuota.ts`
- Modify: `lib/utils/classQuota.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao teste (importe `resolveQuota` e os tipos):

```ts
const PLANO_2X: PlanQuota = {
  classesPerWeek: 2,
  cycle: 'monthly',
  maxClassesPerDay: 2,
  refundOnLateCancel: true,
}

function confirmada(sessionDate: string): QuotaBooking {
  return { sessionDate, status: 'confirmed', cancelledLate: false }
}

describe('resolveQuota', () => {
  it('limite = aulas por semana × semanas do ciclo', () => {
    const r = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 0,
    })
    expect(r).toEqual({ limit: 8, used: 0, remaining: 8 })
  })

  it('conta as reservas confirmadas como usadas', () => {
    const r = resolveQuota({
      plan: PLANO_2X,
      cycleWeeks: 4,
      bookings: [confirmada('2026-07-07'), confirmada('2026-07-09')],
      fixedSessionsInCycle: 0,
    })
    expect(r).toEqual({ limit: 8, used: 2, remaining: 6 })
  })

  it('as fixas do aluno elevam o limite quando passam do que o plano vende', () => {
    // Mês com 5 ocorrências do dia da fixa: 10 sessões contra cota de 8.
    // Sem o max(), o aluno seria barrado na própria aula que assinou.
    const r = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 10,
    })
    expect(r.limit).toBe(10)
  })

  it('as fixas NÃO reduzem o limite quando são menos que o plano vende', () => {
    const r = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 3,
    })
    expect(r.limit).toBe(8)
  })

  it('cancelamento tardio queima a vaga quando o plano não reembolsa', () => {
    const plano = { ...PLANO_2X, refundOnLateCancel: false }
    const r = resolveQuota({
      plan: plano,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'cancelled', cancelledLate: true }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(1)
  })

  it('cancelamento tardio devolve a vaga quando o plano reembolsa', () => {
    const r = resolveQuota({
      plan: PLANO_2X,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'cancelled', cancelledLate: true }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(0)
  })

  it('cancelamento dentro da janela nunca queima a vaga', () => {
    const plano = { ...PLANO_2X, refundOnLateCancel: false }
    const r = resolveQuota({
      plan: plano,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'cancelled', cancelledLate: false }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(0)
  })

  it('remaining nunca fica negativo', () => {
    const r = resolveQuota({
      plan: { ...PLANO_2X, classesPerWeek: 1 },
      cycleWeeks: 1,
      bookings: [confirmada('2026-07-07'), confirmada('2026-07-08'), confirmada('2026-07-09')],
      fixedSessionsInCycle: 0,
    })
    expect(r.remaining).toBe(0)
  })
})

describe('countOnDate', () => {
  it('conta só as confirmadas da data pedida', () => {
    const bookings: QuotaBooking[] = [
      confirmada('2026-07-28'),
      confirmada('2026-07-28'),
      confirmada('2026-07-29'),
      { sessionDate: '2026-07-28', status: 'cancelled', cancelledLate: false },
    ]
    expect(countOnDate(bookings, '2026-07-28')).toBe(2)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/utils/classQuota.test.ts`
Expected: FAIL — `resolveQuota is not a function`

- [ ] **Step 3: Implementar**

Acrescente a `lib/utils/classQuota.ts`:

```ts
export interface PlanQuota {
  classesPerWeek: number
  cycle: PlanCycle
  maxClassesPerDay: number
  refundOnLateCancel: boolean
}

export interface QuotaBooking {
  sessionDate: string
  status: 'confirmed' | 'cancelled'
  /** Cancelada fora da janela de cancelamento (creditRules.canCancelWithRefund). */
  cancelledLate: boolean
}

export interface QuotaResult {
  limit: number
  used: number
  remaining: number
}

/**
 * O max() é a peça central: a matrícula fixa NUNCA pode ser bloqueada pela
 * cota. Num mês com 5 ocorrências do dia da turma, o aluno de plano 2x/semana
 * tem 10 sessões fixas contra uma cota de 8 — sem o max() ele seria barrado na
 * própria aula que assinou. O primeiro termo cobre o caso oposto: aluno com
 * plano e nenhuma fixa, que só reserva avulso.
 */
export function resolveQuota(input: {
  plan: PlanQuota
  cycleWeeks: number
  bookings: QuotaBooking[]
  fixedSessionsInCycle: number
}): QuotaResult {
  const { plan, cycleWeeks, bookings, fixedSessionsInCycle } = input

  const limit = Math.max(plan.classesPerWeek * cycleWeeks, fixedSessionsInCycle)

  const used = bookings.filter(
    (b) =>
      b.status === 'confirmed' ||
      (b.status === 'cancelled' && b.cancelledLate && !plan.refundOnLateCancel),
  ).length

  return { limit, used, remaining: Math.max(0, limit - used) }
}

/** Reservas confirmadas do aluno numa data — insumo do teto diário. */
export function countOnDate(bookings: QuotaBooking[], dateStr: string): number {
  return bookings.filter((b) => b.status === 'confirmed' && b.sessionDate === dateStr).length
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/utils/classQuota.test.ts`
Expected: PASS — 18 testes

- [ ] **Step 5: Commit**

```bash
git add lib/utils/classQuota.ts lib/utils/classQuota.test.ts
git commit -m "feat(cota): calculo de limite e uso do ciclo"
```

---

### Task 6: `getActivePlan` — configuração do plano, não booleano

**Files:**
- Modify: `lib/billing/planEligibility.ts`
- Modify: `lib/billing/planEligibility.test.ts`

- [ ] **Step 1: Ler o teste existente para reusar o stub**

Run: `Get-Content lib/billing/planEligibility.test.ts`
Expected: ver o formato do stub de client já usado. Reaproveite-o — não invente outro.

- [ ] **Step 2: Escrever o teste que falha**

Acrescente ao arquivo, adaptando o nome do helper de stub ao que você viu no Step 1:

```ts
describe('getActivePlan', () => {
  it('devolve a configuração de cota do plano vigente', async () => {
    const client = makeClient({
      subscription: {
        gateway: 'manual',
        current_period_end: null,
        subscription_plans: {
          classes_per_week: 2,
          cycle: 'monthly',
          max_classes_per_day: 2,
          refund_on_late_cancel: true,
        },
      },
    })

    await expect(getActivePlan(client, 'stu-1', 'org-1')).resolves.toEqual({
      classesPerWeek: 2,
      cycle: 'monthly',
      maxClassesPerDay: 2,
      refundOnLateCancel: true,
    })
  })

  it('devolve null quando não há assinatura ativa', async () => {
    const client = makeClient({ subscription: null })
    await expect(getActivePlan(client, 'stu-1', 'org-1')).resolves.toBeNull()
  })

  it('devolve null quando a assinatura está ativa mas o período venceu', async () => {
    const client = makeClient({
      subscription: {
        gateway: 'mercadopago',
        current_period_end: '2020-01-01T00:00:00Z',
        subscription_plans: {
          classes_per_week: 2, cycle: 'monthly',
          max_classes_per_day: 2, refund_on_late_cancel: true,
        },
      },
    })
    await expect(getActivePlan(client, 'stu-1', 'org-1')).resolves.toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/planEligibility.test.ts`
Expected: FAIL — `getActivePlan is not exported`

- [ ] **Step 4: Implementar**

Substitua o corpo de `lib/billing/planEligibility.ts` por:

```ts
// "Tem plano ativo?" isolado num único ponto — extraído depois que o mesmo
// bloco de 6 linhas apareceu em 3 call sites (classDebt, enrollStudentInClass,
// bookSession) e uma 4ª cópia (addStudentToSession, Task 12) estava prestes a
// repetir. Aceita um client injetável para reusar a mesma instância do caller
// e para ser testável com o padrão de stub já usado em classDebt.test.ts.
import { isSubscriptionCurrent } from './periodicity'
import type { createAdminClient } from '@/lib/supabase/server'
import type { PlanQuota } from '@/lib/utils/classQuota'

type AdminClient = ReturnType<typeof createAdminClient>

interface PlanRow {
  classes_per_week: number
  cycle: 'weekly' | 'monthly'
  max_classes_per_day: number
  refund_on_late_cancel: boolean
}

/**
 * Configuração de cota do plano vigente do aluno, ou null.
 * 'active' com período vencido NÃO conta — mesmo critério em toda a spec
 * (docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md §1).
 */
export async function getActivePlan(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<PlanQuota | null> {
  const { data: sub } = await client
    .from('student_subscriptions')
    .select(
      'gateway, current_period_end, subscription_plans(classes_per_week, cycle, max_classes_per_day, refund_on_late_cancel)',
    )
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  if (!sub) return null

  const row = sub as unknown as {
    gateway: string
    current_period_end: string | null
    subscription_plans: PlanRow | PlanRow[] | null
  }
  if (!isSubscriptionCurrent(row, new Date())) return null

  // PostgREST devolve o embed como objeto ou array conforme a cardinalidade.
  const plan = Array.isArray(row.subscription_plans)
    ? row.subscription_plans[0]
    : row.subscription_plans
  if (!plan) return null

  return {
    classesPerWeek: plan.classes_per_week,
    cycle: plan.cycle,
    maxClassesPerDay: plan.max_classes_per_day,
    refundOnLateCancel: plan.refund_on_late_cancel,
  }
}

/** Mantida para os call sites que só querem o sim/não. */
export async function hasActiveSubscriptionPlan(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<boolean> {
  return (await getActivePlan(client, studentId, orgId)) !== null
}
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm run test:run`
Expected: PASS. `hasActiveSubscriptionPlan` mudou de implementação mas não de contrato — se algum teste de `classDebt`, `bookSession` ou `enrollStudentInClass` quebrar, é porque o stub dele não devolve o embed `subscription_plans`. Ajuste o stub, não a função.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/planEligibility.ts lib/billing/planEligibility.test.ts
git commit -m "feat(cota): getActivePlan devolve a configuracao do plano"
```

---

### Task 7: Eixos de cota em `resolveClassAccess`

**Files:**
- Modify: `lib/utils/accessRules.ts`
- Modify: `lib/utils/accessRules.test.ts:4`

- [ ] **Step 1: Escrever o teste que falha**

Substitua a linha 4 de `lib/utils/accessRules.test.ts`:

```ts
const base = {
  partner: null,
  hasActivePlan: false,
  creditsBalance: 0,
  hasOpenDebt: false,
  quotaEnforced: false,
  quotaRemaining: null,
  bookingsOnDate: 0,
  maxClassesPerDay: 2,
}
```

E acrescente ao fim do arquivo:

```ts
describe('resolveClassAccess — cota', () => {
  const comCota = { ...base, quotaEnforced: true, hasActivePlan: true }

  it('cota desligada preserva o comportamento anterior: plano é ilimitado', () => {
    expect(
      resolveClassAccess({ ...base, hasActivePlan: true, quotaRemaining: 0, bookingsOnDate: 9 }),
    ).toEqual({ grant: 'plan' })
  })

  it('plano com cota restante entra pelo plano', () => {
    expect(resolveClassAccess({ ...comCota, quotaRemaining: 3 })).toEqual({ grant: 'plan' })
  })

  it('cota estourada cai para crédito comprado antes de negar', () => {
    expect(
      resolveClassAccess({ ...comCota, quotaRemaining: 0, creditsBalance: 2 }),
    ).toEqual({ grant: 'credit' })
  })

  it('cota estourada sem crédito nega — não vira dívida', () => {
    expect(resolveClassAccess({ ...comCota, quotaRemaining: 0 })).toEqual({
      denied: 'quota_exhausted',
    })
  })

  it('teto diário nega mesmo com cota sobrando', () => {
    expect(
      resolveClassAccess({ ...comCota, quotaRemaining: 5, bookingsOnDate: 2 }),
    ).toEqual({ denied: 'daily_cap' })
  })

  it('teto diário nega mesmo com crédito comprado', () => {
    expect(
      resolveClassAccess({ ...base, quotaEnforced: true, creditsBalance: 9, bookingsOnDate: 2 }),
    ).toEqual({ denied: 'daily_cap' })
  })

  it('parceiro é isento da cota e do teto diário', () => {
    expect(
      resolveClassAccess({
        ...comCota, partner: 'wellhub', quotaRemaining: 0, bookingsOnDate: 5,
      }),
    ).toEqual({ grant: 'partner' })
  })

  it('dívida bloqueia antes de qualquer eixo de cota', () => {
    expect(
      resolveClassAccess({ ...comCota, hasOpenDebt: true, quotaRemaining: 5 }),
    ).toEqual({ denied: 'blocked_by_debt' })
  })

  it('aluno sem plano e sem crédito segue virando dívida', () => {
    expect(
      resolveClassAccess({ ...base, quotaEnforced: true, quotaRemaining: null }),
    ).toEqual({ grant: 'debt' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/utils/accessRules.test.ts`
Expected: FAIL — os testes de cota falham (`grant: 'plan'` onde se esperava negação)

- [ ] **Step 3: Implementar**

Substitua `lib/utils/accessRules.ts` por:

```ts
import type { CheckinPartner } from '@/types'

/** Como o aluno entra na aula e o que isso consome. */
export type AccessGrant =
  | 'partner' // Wellhub/TotalPass — não consome nada, isento de cota
  | 'plan' // assinatura vigente, dentro da cota
  | 'credit' // debita 1 crédito na reserva
  | 'debt' // entra; pendência nasce se houver presença

export type AccessDenial = 'blocked_by_debt' | 'quota_exhausted' | 'daily_cap'

export type AccessDecision = { grant: AccessGrant } | { denied: AccessDenial }

export interface AccessInput {
  partner: CheckinPartner | null
  /** status='active' E período vigente (isSubscriptionCurrent). Ver spec §1. */
  hasActivePlan: boolean
  creditsBalance: number
  /** payments pendente com session_id não-nulo. Ver spec §4. */
  hasOpenDebt: boolean
  /** system_settings.quota_enforcement_enabled da academia. */
  quotaEnforced: boolean
  /** Aulas que ainda cabem no ciclo. null = aluno sem plano. */
  quotaRemaining: number | null
  /** Reservas confirmadas do aluno na data da sessão pedida. */
  bookingsOnDate: number
  /** Teto do plano, ou o default da academia para quem não tem plano. */
  maxClassesPerDay: number
}

/**
 * Decide o acesso do aluno a uma aula. Pura: toda busca fica no caller.
 *
 * A dívida bloqueia ANTES de tudo, inclusive quem tem plano. O parceiro vem em
 * seguida e é isento da cota e do teto: quem tem Wellhub e plano ao mesmo
 * tempo, o Wellhub prevalece (spec de cota §4).
 *
 * O teto diário é avaliado ANTES da cota porque é um limite absoluto — nem
 * crédito comprado o compra. Sem essa ordem os eixos se sobreporiam quando o
 * teto estoura com cota ainda disponível.
 *
 * O admin ignora tudo isto: addStudentToSession não passa por aqui.
 */
export function resolveClassAccess(input: AccessInput): AccessDecision {
  if (input.hasOpenDebt) return { denied: 'blocked_by_debt' }
  if (input.partner) return { grant: 'partner' }

  if (input.quotaEnforced) {
    if (input.bookingsOnDate >= input.maxClassesPerDay) return { denied: 'daily_cap' }
    if (input.hasActivePlan && (input.quotaRemaining ?? 0) > 0) return { grant: 'plan' }
    if (input.creditsBalance >= 1) return { grant: 'credit' }
    // Plano exausto não vira dívida: cobrar avulsa de quem tem plano não é o
    // que a academia quer. Quem nunca teve plano segue no caminho de baixo.
    if (input.hasActivePlan) return { denied: 'quota_exhausted' }
    return { grant: 'debt' }
  }

  if (input.hasActivePlan) return { grant: 'plan' }
  if (input.creditsBalance >= 1) return { grant: 'credit' }
  return { grant: 'debt' }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/utils/accessRules.test.ts`
Expected: PASS — todos, inclusive os pré-existentes

- [ ] **Step 5: Corrigir os call sites que agora não compilam**

Run: `npx tsc --noEmit`
Expected: erros em `features/aulas/actions.ts` e onde mais `resolveClassAccess` for chamado, por falta dos 4 campos novos. **Não corrija ainda** — a Task 9 faz isso de forma completa. Anote os arquivos apontados e siga.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/accessRules.ts lib/utils/accessRules.test.ts
git commit -m "feat(cota): eixos de cota e teto diario no resolveClassAccess"
```

---

### Task 8: `quotaUsage.ts` — o retrato da cota de um aluno

**Files:**
- Create: `features/aulas/quotaUsage.ts`
- Create: `features/aulas/quotaUsage.test.ts`

> **Pré-requisito:** a migração da Task 1 precisa estar aplicada no Supabase antes de rodar isto contra o banco real. Os testes desta task usam stub e não dependem disso.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// features/aulas/quotaUsage.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getQuotaSnapshot } from './quotaUsage'
import type { PlanQuota } from '@/lib/utils/classQuota'

const PLANO: PlanQuota = {
  classesPerWeek: 2,
  cycle: 'monthly',
  maxClassesPerDay: 2,
  refundOnLateCancel: true,
}

/**
 * Stub escopado ao que getQuotaSnapshot consulta: reservas do aluno na janela
 * (com a data da sessão embutida) e matrículas fixas ativas com o dia da turma.
 * Mesma técnica de features/aulas/gridGeneration.test.ts.
 */
function makeClient(opts: {
  bookings?: { status: string; cancelled_at: string | null; class_sessions: { session_date: string } }[]
  enrollments?: { classes: { day_of_week: number } }[]
}) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      in: () => builder,
      then: (resolve: (v: { data: unknown }) => void) => {
        const data =
          table === 'session_bookings' ? opts.bookings ?? [] : opts.enrollments ?? []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })
  return { from } as never
}

describe('getQuotaSnapshot', () => {
  it('conta as reservas confirmadas do ciclo contra o limite do plano', async () => {
    const client = makeClient({
      bookings: [
        { status: 'confirmed', cancelled_at: null, class_sessions: { session_date: '2026-07-07' } },
        { status: 'confirmed', cancelled_at: null, class_sessions: { session_date: '2026-07-09' } },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    // Julho/2026 tem 4 segundas → limite 2×4 = 8.
    expect(snap.limit).toBe(8)
    expect(snap.used).toBe(2)
    expect(snap.remaining).toBe(6)
  })

  it('conta as reservas do aluno na data pedida para o teto diário', async () => {
    const client = makeClient({
      bookings: [
        { status: 'confirmed', cancelled_at: null, class_sessions: { session_date: '2026-07-28' } },
        { status: 'confirmed', cancelled_at: null, class_sessions: { session_date: '2026-07-28' } },
        { status: 'confirmed', cancelled_at: null, class_sessions: { session_date: '2026-07-29' } },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    expect(snap.bookingsOnDate).toBe(2)
  })

  it('as fixas elevam o limite quando o mês tem mais ocorrências que a cota', async () => {
    // 2 turmas fixas na quarta-feira; julho/2026 tem 5 quartas (01,08,15,22,29).
    const client = makeClient({
      bookings: [],
      enrollments: [{ classes: { day_of_week: 3 } }, { classes: { day_of_week: 3 } }],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    // 2 fixas × 5 quartas = 10 > 8 do plano.
    expect(snap.limit).toBe(10)
  })

  it('ignora as canceladas quando o plano reembolsa', async () => {
    const client = makeClient({
      bookings: [
        {
          status: 'cancelled',
          cancelled_at: '2026-07-07T10:00:00Z',
          class_sessions: { session_date: '2026-07-07' },
        },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    expect(snap.used).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/quotaUsage.test.ts`
Expected: FAIL — `Failed to resolve import "./quotaUsage"`

- [ ] **Step 3: Implementar**

```ts
// features/aulas/quotaUsage.ts
// I/O da cota: busca no banco o que lib/utils/classQuota (puro) precisa.
import type { createAdminClient } from '@/lib/supabase/server'
import {
  cycleWindow,
  countCycleWeeks,
  resolveQuota,
  countOnDate,
  type PlanQuota,
  type QuotaBooking,
} from '@/lib/utils/classQuota'
import { addDaysStr } from '@/lib/utils/gridSchedule'

type AdminClient = ReturnType<typeof createAdminClient>

export interface QuotaSnapshot {
  limit: number
  used: number
  remaining: number
  /** Reservas confirmadas do aluno na data pedida — insumo do teto diário. */
  bookingsOnDate: number
  /** Janela do ciclo, para exibir na UI ("neste mês" / "nesta semana"). */
  window: { from: string; to: string }
}

/** Quantas vezes `dayOfWeek` (0=domingo) ocorre em [from, to]. */
function occurrencesOfDay(from: string, to: string, dayOfWeek: number): number {
  let count = 0
  let cursor = from
  while (cursor <= to) {
    const [y, m, d] = cursor.split('-').map(Number)
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === dayOfWeek) count++
    cursor = addDaysStr(cursor, 1)
  }
  return count
}

export async function getQuotaSnapshot(
  client: AdminClient,
  studentId: string,
  orgId: string,
  plan: PlanQuota,
  targetDate: string,
): Promise<QuotaSnapshot> {
  const window = cycleWindow(targetDate, plan.cycle)

  const { data: bookingsRaw } = await client
    .from('session_bookings')
    .select('status, cancelled_at, class_sessions!inner(session_date)')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .gte('class_sessions.session_date', window.from)
    .lte('class_sessions.session_date', window.to)

  const bookings: QuotaBooking[] = (
    (bookingsRaw ?? []) as unknown as {
      status: string
      cancelled_at: string | null
      class_sessions: { session_date: string } | { session_date: string }[]
    }[]
  ).map((b) => {
    const sess = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions
    return {
      sessionDate: sess.session_date,
      status: b.status === 'confirmed' ? 'confirmed' : 'cancelled',
      // cancelledLate só muda o resultado quando o plano NÃO reembolsa; nos
      // demais casos resolveQuota descarta a cancelada de qualquer jeito.
      // Determinar "tarde" exige o horário da turma, então só pagamos esse
      // custo quando importa — ver a nota abaixo.
      cancelledLate: false,
    }
  })

  const { data: enrollRaw } = await client
    .from('enrollments')
    .select('classes!inner(day_of_week)')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const fixedSessionsInCycle = (
    (enrollRaw ?? []) as unknown as {
      classes: { day_of_week: number } | { day_of_week: number }[]
    }[]
  ).reduce((acc, e) => {
    const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
    return acc + occurrencesOfDay(window.from, window.to, cls.day_of_week)
  }, 0)

  const quota = resolveQuota({
    plan,
    cycleWeeks: countCycleWeeks(window.from, window.to),
    bookings,
    fixedSessionsInCycle,
  })

  return {
    ...quota,
    bookingsOnDate: countOnDate(bookings, targetDate),
    window,
  }
}
```

> **Nota deliberada sobre `cancelledLate`:** esta versão sempre grava `false`, o que faz cancelamento tardio **nunca** queimar a vaga. Isso torna `refund_on_late_cancel` inerte até a Task 8b. É seguro (erra a favor do aluno) e mantém esta task focada. A Task 8b fecha o buraco.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/quotaUsage.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Commit**

```bash
git add features/aulas/quotaUsage.ts features/aulas/quotaUsage.test.ts
git commit -m "feat(cota): retrato da cota do aluno a partir do banco"
```

---

### Task 8b: `cancelledLate` de verdade

**Files:**
- Modify: `features/aulas/quotaUsage.ts`
- Modify: `features/aulas/quotaUsage.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('cancelamento tardio queima a vaga quando o plano não reembolsa', async () => {
  const planoSemReembolso: PlanQuota = { ...PLANO, refundOnLateCancel: false }
  const client = makeClient({
    // Aula 2026-07-07 às 18:00 BRT = 21:00Z. Cancelou 20:00Z = 1h antes.
    bookings: [
      {
        status: 'cancelled',
        cancelled_at: '2026-07-07T20:00:00Z',
        class_sessions: { session_date: '2026-07-07', classes: { start_time: '18:00:00' } },
      },
    ],
    enrollments: [],
  })

  const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', planoSemReembolso, '2026-07-28')

  expect(snap.used).toBe(1)
})

it('cancelamento dentro da janela não queima a vaga', async () => {
  const planoSemReembolso: PlanQuota = { ...PLANO, refundOnLateCancel: false }
  const client = makeClient({
    // Cancelou 2 dias antes — muito além das 5h.
    bookings: [
      {
        status: 'cancelled',
        cancelled_at: '2026-07-05T12:00:00Z',
        class_sessions: { session_date: '2026-07-07', classes: { start_time: '18:00:00' } },
      },
    ],
    enrollments: [],
  })

  const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', planoSemReembolso, '2026-07-28')

  expect(snap.used).toBe(0)
})
```

Atualize também o tipo de `bookings` no `makeClient` para incluir `classes: { start_time: string }` dentro de `class_sessions`, e acrescente `classes: { start_time: '18:00:00' }` aos stubs dos testes já existentes.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/quotaUsage.test.ts`
Expected: FAIL — o primeiro teste novo dá `used: 0`, esperava 1

- [ ] **Step 3: Implementar**

Em `features/aulas/quotaUsage.ts`, troque o `select` das reservas e o cálculo de `cancelledLate`:

```ts
import { canCancelWithRefund } from '@/lib/utils/creditRules'
```

```ts
  const { data: bookingsRaw } = await client
    .from('session_bookings')
    .select('status, cancelled_at, class_sessions!inner(session_date, classes!inner(start_time))')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .gte('class_sessions.session_date', window.from)
    .lte('class_sessions.session_date', window.to)

  const bookings: QuotaBooking[] = (
    (bookingsRaw ?? []) as unknown as {
      status: string
      cancelled_at: string | null
      class_sessions:
        | { session_date: string; classes: { start_time: string } | { start_time: string }[] }
        | { session_date: string; classes: { start_time: string } | { start_time: string }[] }[]
    }[]
  ).map((b) => {
    const sess = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions
    const cls = Array.isArray(sess.classes) ? sess.classes[0] : sess.classes
    const confirmed = b.status === 'confirmed'

    // Horário da aula é hora de parede BRT (−03:00), igual gridSchedule.ts.
    const startIso = `${sess.session_date}T${cls.start_time}-03:00`

    return {
      sessionDate: sess.session_date,
      status: confirmed ? ('confirmed' as const) : ('cancelled' as const),
      cancelledLate:
        !confirmed && b.cancelled_at !== null
          ? !canCancelWithRefund(startIso, b.cancelled_at)
          : false,
    }
  })
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/quotaUsage.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 5: Commit**

```bash
git add features/aulas/quotaUsage.ts features/aulas/quotaUsage.test.ts
git commit -m "feat(cota): cancelamento tardio queima a vaga quando o plano nao reembolsa"
```

---

### Task 9: `bookSession` consulta a cota

**Files:**
- Modify: `features/aulas/actions.ts:182-219`

- [ ] **Step 1: Criar o módulo de settings**

Precisa vir antes: os Steps 2 e 3 importam destas funções, e a Task 10 também.

```ts
// features/aulas/quotaSettings.ts
// Chaves de system_settings da cota. Mesmo padrão de getDebtGraceDays
// (features/financeiro/debtQueries.ts:12).
import type { createAdminClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

const DEFAULT_MAX_PER_DAY = 2

async function readSetting(
  client: AdminClient, orgId: string, key: string,
): Promise<string | null> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', key)
    .maybeSingle()
  return (data as { value: string } | null)?.value ?? null
}

/** A cota nasce desligada; a academia liga quando revisar seus planos. */
export async function isQuotaEnforced(client: AdminClient, orgId: string): Promise<boolean> {
  return (await readSetting(client, orgId, 'quota_enforcement_enabled')) === 'true'
}

/** Teto diário de quem NÃO tem plano. Quem tem, usa o do plano. */
export async function getOrgMaxClassesPerDay(
  client: AdminClient, orgId: string,
): Promise<number> {
  const n = Number(await readSetting(client, orgId, 'max_classes_per_day'))
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_PER_DAY
}
```

- [ ] **Step 2: Ler o trecho atual de bookSession**

Run: `Get-Content features/aulas/actions.ts | Select-Object -Skip 150 -First 90`
Expected: ver o bloco que vai de `hasActiveSubscriptionPlan` até o `resolveClassAccess` e o `if ('denied' in decision)`.

- [ ] **Step 3: Substituir a chamada de plano e montar os insumos da cota**

Troque a linha `const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, user.id, orgId)` por:

```ts
  // getActivePlan devolve a configuração de cota, não só o sim/não — a cota
  // precisa de classes_per_week, cycle e max_classes_per_day.
  const plan = await getActivePlan(adminClient, user.id, orgId)
  const hasActivePlan = plan !== null

  const quotaEnforced = await isQuotaEnforced(adminClient, orgId)
  const orgDailyCap = await getOrgMaxClassesPerDay(adminClient, orgId)

  // Só paga o custo das duas queries da cota quando a academia ligou a regra.
  const snapshot =
    quotaEnforced && plan
      ? await getQuotaSnapshot(adminClient, user.id, orgId, plan, session.session_date)
      : null
```

E ajuste a chamada de `resolveClassAccess`:

```ts
  const decision = resolveClassAccess({
    partner: profile.partner,
    hasActivePlan,
    creditsBalance: profile.credits_balance,
    hasOpenDebt: debtSummary.isBlocked,
    quotaEnforced,
    quotaRemaining: snapshot?.remaining ?? null,
    bookingsOnDate: snapshot?.bookingsOnDate ?? 0,
    maxClassesPerDay: plan?.maxClassesPerDay ?? orgDailyCap,
  })
```

Ajuste os imports do topo do arquivo: troque `hasActiveSubscriptionPlan` por `getActivePlan` e adicione:

```ts
import { getQuotaSnapshot } from './quotaUsage'
import { isQuotaEnforced, getOrgMaxClassesPerDay } from './quotaSettings'
```

> `session.session_date` precisa estar disponível neste ponto. Se a variável da sessão tiver outro nome no arquivo, use o nome real — não invente.

- [ ] **Step 4: Mensagens de erro por motivo**

Substitua o bloco `if ('denied' in decision)` por:

```ts
  if ('denied' in decision) {
    if (decision.denied === 'daily_cap') {
      const teto = plan?.maxClassesPerDay ?? orgDailyCap
      return { error: `Você já tem ${teto} aulas reservadas neste dia — é o limite do seu plano.` }
    }
    if (decision.denied === 'quota_exhausted') {
      const periodo = plan?.cycle === 'weekly' ? 'desta semana' : 'deste mês'
      return {
        error: `Você já usou suas ${snapshot?.limit ?? 0} aulas ${periodo}. Cancele uma aula futura ou compre uma avulsa.`,
      }
    }
    return {
      error: `Você tem R$ ${debtSummary.total.toFixed(2).replace('.', ',')} em aberto. Regularize em Financeiro para voltar a agendar.`,
    }
  }
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm run test:run`
Expected: PASS — 563 testes anteriores + os novos. Se algum teste de `bookSession` quebrar por falta das chaves de `system_settings` no stub, acrescente-as ao stub devolvendo `null` (o default cobre).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo fora dos três arquivos de teste pré-existentes listados na Task 2.

- [ ] **Step 7: Commit**

```bash
git add features/aulas/actions.ts features/aulas/quotaSettings.ts
git commit -m "feat(cota): bookSession valida cota e teto diario"
```

---

### Task 10: `enrollStudentInClass` valida o número de fixas

**Files:**
- Modify: `features/aulas/adminActions.ts:66-128`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente a `features/aulas/adminActions.test.ts`, reusando o padrão de stub que já existe no arquivo:

```ts
describe('enrollStudentInClass — cota de fixas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN)
  })

  it('rejeita a fixa que ultrapassa classes_per_week do plano', async () => {
    // Plano 2x/semana, aluno já com 2 matrículas fixas ativas.
    const client = makeEnrollClient({
      plan: { classesPerWeek: 2, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true },
      activeEnrollments: 2,
      quotaEnforced: true,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await enrollStudentInClass('stu-1', 'class-3')

    expect(result.error).toContain('2 aulas fixas')
  })

  it('aceita a fixa que bate no limite exato', async () => {
    const client = makeEnrollClient({
      plan: { classesPerWeek: 2, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true },
      activeEnrollments: 1,
      quotaEnforced: true,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await expect(enrollStudentInClass('stu-1', 'class-2')).resolves.toEqual({})
  })

  it('não valida nada quando a cota está desligada', async () => {
    const client = makeEnrollClient({
      plan: { classesPerWeek: 1, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true },
      activeEnrollments: 5,
      quotaEnforced: false,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await expect(enrollStudentInClass('stu-1', 'class-9')).resolves.toEqual({})
  })
})
```

E escreva o stub no mesmo arquivo:

```ts
function makeEnrollClient(opts: {
  plan: PlanQuota
  activeEnrollments: number
  quotaEnforced: boolean
}) {
  const rpc = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      upsert: () => builder,
      maybeSingle: () => {
        if (table === 'system_settings') {
          return Promise.resolve({ data: { value: String(opts.quotaEnforced) } })
        }
        if (table === 'student_subscriptions') {
          return Promise.resolve({
            data: {
              gateway: 'manual',
              current_period_end: null,
              subscription_plans: {
                classes_per_week: opts.plan.classesPerWeek,
                cycle: opts.plan.cycle,
                max_classes_per_day: opts.plan.maxClassesPerDay,
                refund_on_late_cancel: opts.plan.refundOnLateCancel,
              },
            },
          })
        }
        return Promise.resolve({ data: null })
      },
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        // enrollments: N linhas de turmas DIFERENTES da que está sendo criada.
        const data =
          table === 'enrollments'
            ? Array.from({ length: opts.activeEnrollments }, (_, i) => ({
                class_id: `outra-turma-${i}`,
              }))
            : []
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return builder
  })

  return { from, rpc } as never
}
```

Importe `PlanQuota` de `@/lib/utils/classQuota` no topo do arquivo de teste.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/adminActions.test.ts`
Expected: FAIL — `result.error` é `undefined`, esperava conter "2 aulas fixas"

- [ ] **Step 3: Implementar**

Em `enrollStudentInClass`, logo depois da verificação de plano/parceiro existente e **antes** do `upsert` da matrícula:

```ts
  // Cota: o plano define quantas turmas fixas o aluno pode ter. Sem isto o
  // admin vincula um plano de 2x/semana a cinco turmas sem nenhum aviso.
  if (await isQuotaEnforced(adminClient, orgId)) {
    const plan = await getActivePlan(adminClient, studentId, orgId)
    if (plan) {
      const { data: activeRaw } = await adminClient
        .from('enrollments')
        .select('class_id')
        .eq('student_id', studentId)
        .eq('organization_id', orgId)
        .eq('is_active', true)

      const jaTem = ((activeRaw ?? []) as { class_id: string }[]).filter(
        (e) => e.class_id !== classId,
      ).length

      if (jaTem + 1 > plan.classesPerWeek) {
        return {
          error: `O plano deste aluno dá ${plan.classesPerWeek} aulas fixas por semana e ele já tem ${jaTem}. Troque o plano ou remova uma turma fixa.`,
        }
      }
    }
  }
```

O filtro `e.class_id !== classId` importa: `enrollStudentInClass` faz upsert por `(student_id, class_id)`, então rematricular na mesma turma não pode contar duas vezes.

Adicione ao topo do arquivo:

```ts
import { getActivePlan } from '@/lib/billing/planEligibility'
import { isQuotaEnforced } from './quotaSettings'
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/adminActions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add features/aulas/adminActions.ts features/aulas/adminActions.test.ts
git commit -m "feat(cota): matricula fixa respeita o limite do plano"
```

---

### Task 11: Campos de cota no formulário do plano

**Files:**
- Modify: `app/(admin)/admin/financeiro/adminActions.ts:49-79`
- Modify: `app/(admin)/admin/financeiro/PlansManager.tsx:24,136-137`

- [ ] **Step 1: Estender `CreatePlanData` e o insert**

Em `app/(admin)/admin/financeiro/adminActions.ts`:

```ts
export interface CreatePlanData {
  name: string
  description?: string
  classes_per_week: number
  cycle: 'weekly' | 'monthly'
  max_classes_per_day: number
  refund_on_late_cancel: boolean
}
```

E no `.insert({...})` de `createPlan`, acrescente as três linhas:

```ts
        classes_per_week: data.classes_per_week,
        cycle: data.cycle,
        max_classes_per_day: data.max_classes_per_day,
        refund_on_late_cancel: data.refund_on_late_cancel,
```

Faça o mesmo no `updatePlan` (a função logo acima, que termina na linha 47) — leia-a primeiro com `Get-Content app/(admin)/admin/financeiro/adminActions.ts | Select-Object -First 48` e acrescente os mesmos três campos ao `.update({...})`.

- [ ] **Step 2: Estender o formulário**

Em `PlansManager.tsx`, o estado inicial na linha 24 passa a:

```tsx
  classes_per_week: 2,
  cycle: 'monthly' as const,
  max_classes_per_day: 2,
  refund_on_late_cancel: true,
```

E acrescente os três controles junto do campo de `classes_per_week` existente (linha ~136), usando os primitivos de `components/ui/`:

```tsx
<label className="block text-sm text-slate-300 mb-1">Ciclo da cota</label>
<select
  value={createForm.cycle}
  onChange={(e) =>
    setCreateForm((f) => ({ ...f, cycle: e.target.value as 'weekly' | 'monthly' }))
  }
  className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-white"
>
  <option value="monthly">Mensal — remaneja aulas dentro do mês</option>
  <option value="weekly">Semanal — zera todo domingo</option>
</select>

<label className="block text-sm text-slate-300 mb-1 mt-3">Máximo de aulas por dia</label>
<Input
  type="number"
  min={1}
  value={createForm.max_classes_per_day}
  onChange={(e) =>
    setCreateForm((f) => ({ ...f, max_classes_per_day: parseInt(e.target.value) || 1 }))
  }
/>

<label className="flex items-center gap-2 mt-3 text-sm text-slate-300">
  <input
    type="checkbox"
    checked={createForm.refund_on_late_cancel}
    onChange={(e) =>
      setCreateForm((f) => ({ ...f, refund_on_late_cancel: e.target.checked }))
    }
  />
  Cancelamento fora do prazo devolve a aula
</label>
```

- [ ] **Step 3: Verificar no navegador**

Rode o dev server com `preview_start` (nunca com Bash), navegue até `/admin/financeiro/planos`, crie um plano e confirme com `read_page` que os três campos aparecem e que o plano é salvo sem erro no console (`read_console_messages`).

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/financeiro/adminActions.ts" "app/(admin)/admin/financeiro/PlansManager.tsx"
git commit -m "feat(cota): campos de cota no formulario do plano"
```

---

### Task 12: Mostrar a cota ao aluno

**Files:**
- Modify: `app/(dashboard)/agendar/page.tsx`

- [ ] **Step 1: Ler a página para achar onde o saldo de crédito é exibido**

Run: `Select-String -Path "app/(dashboard)/agendar/page.tsx" -Pattern "credits_balance|createAdminClient|orgId" -Context 3,3`
Expected: localizar o ponto onde a página já busca o perfil/membership e exibe o saldo.

- [ ] **Step 2: Buscar o retrato da cota**

No Server Component, depois de obter `orgId` e o usuário:

```tsx
import { getActivePlan } from '@/lib/billing/planEligibility'
import { getQuotaSnapshot } from '@/features/aulas/quotaUsage'
import { isQuotaEnforced } from '@/features/aulas/quotaSettings'
import { brtToday } from '@/lib/utils/gridSchedule'

  const plan = await getActivePlan(adminClient, user.id, orgId)
  const quotaOn = await isQuotaEnforced(adminClient, orgId)
  const quota =
    quotaOn && plan
      ? await getQuotaSnapshot(adminClient, user.id, orgId, plan, brtToday(new Date()))
      : null
```

- [ ] **Step 3: Exibir os dois números lado a lado**

Junto do saldo de créditos que a página já mostra:

```tsx
{quota && (
  <div className="rounded-xl border border-surface-border bg-surface-card px-4 py-3">
    <p className="text-sm text-slate-400">
      Aulas do plano {plan?.cycle === 'weekly' ? 'nesta semana' : 'neste mês'}
    </p>
    <p className="text-lg font-semibold text-white">
      {quota.used} de {quota.limit}
    </p>
    {quota.remaining === 0 && (
      <p className="text-xs text-brand-400 mt-1">
        Cota esgotada. Cancele uma aula futura ou compre uma avulsa.
      </p>
    )}
  </div>
)}
```

- [ ] **Step 4: Verificar no navegador**

Com `preview_start` rodando, navegue até `/agendar` como aluno com plano e confirme via `read_page` que o bloco aparece com os números certos. Confirme com `read_console_messages` que não há erro.

- [ ] **Step 5: Rodar tudo**

Run: `npm run test:run`
Expected: PASS

Run: `npm run lint`
Expected: só os avisos pré-existentes de `<img>` em `InviteCard.tsx`, `CreateTournamentForm.tsx`, `CoverImageCard.tsx` e `app/(public)/t/[id]/page.tsx`

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/agendar/page.tsx"
git commit -m "feat(cota): aluno ve quantas aulas do plano ja usou"
```

---

### Task 13: Cota na tela de Configurações

**Files:**
- Modify: `app/(admin)/admin/configuracoes/SystemSettingsForm.tsx:9-15,17-27,51-56`
- Modify: `features/financeiro/actions.ts` (função `updateSystemSettings`)
- Modify: `app/(admin)/admin/configuracoes/page.tsx`

Sem isto, ligar a cota exige SQL manual no Supabase — o admin da academia não faz isso.

- [ ] **Step 1: Estender o payload da action**

Run: `Select-String -Path features/financeiro/actions.ts -Pattern "updateSystemSettings" -Context 0,30`
Expected: ver a interface do payload e o loop/upsert que grava as chaves em `system_settings`.

Acrescente `quota_enforcement_enabled: boolean` e `max_classes_per_day: number` à interface do payload e às chaves gravadas, seguindo exatamente o formato das três chaves já existentes. Valores vão como texto: `String(payload.max_classes_per_day)` e `payload.quota_enforcement_enabled ? 'true' : 'false'`.

- [ ] **Step 2: Estender o formulário**

Em `SystemSettingsForm.tsx`, a prop passa a:

```tsx
interface SystemSettingsFormProps {
  settings: {
    credit_expiry_days: number
    cancellation_window_hours: number
    default_checkin_target: number
    quota_enforcement_enabled: boolean
    max_classes_per_day: number
  }
}
```

Estado novo, junto dos existentes:

```tsx
  const [quotaEnabled, setQuotaEnabled] = useState(settings.quota_enforcement_enabled)
  const [maxPerDay, setMaxPerDay] = useState(String(settings.max_classes_per_day))
```

Validação, junto das outras três:

```tsx
    const perDay = parseInt(maxPerDay, 10)
    if (isNaN(perDay) || perDay < 1) {
      setError('Máximo de aulas por dia deve ser um número inteiro positivo.')
      return
    }
```

E os dois campos no JSX do formulário:

```tsx
<label className="flex items-start gap-2 text-sm text-slate-300">
  <input
    type="checkbox"
    checked={quotaEnabled}
    onChange={(e) => setQuotaEnabled(e.target.checked)}
    className="mt-1"
  />
  <span>
    Limitar aulas pelo plano
    <span className="block text-xs text-slate-500">
      Cada plano passa a valer o número de aulas que vende. Revise os planos antes de ligar.
    </span>
  </span>
</label>

<label className="block text-sm text-slate-300 mb-1 mt-3">
  Máximo de aulas por dia (alunos sem plano)
</label>
<Input type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
```

Acrescente os dois ao objeto passado para `updateSystemSettings`:

```tsx
        quota_enforcement_enabled: quotaEnabled,
        max_classes_per_day: perDay,
```

- [ ] **Step 3: Carregar os valores na página**

Em `app/(admin)/admin/configuracoes/page.tsx`, onde as três chaves atuais são lidas de `system_settings`, acrescente as duas novas com os mesmos defaults da migração (`false` e `2`).

- [ ] **Step 4: Verificar no navegador**

Com `preview_start` rodando, vá a `/admin/configuracoes`, marque "Limitar aulas pelo plano", salve, recarregue e confirme via `read_page` que o estado persistiu. Confirme com `read_console_messages` que não há erro.

- [ ] **Step 5: Rodar tudo**

Run: `npm run test:run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/configuracoes/SystemSettingsForm.tsx" "app/(admin)/admin/configuracoes/page.tsx" features/financeiro/actions.ts
git commit -m "feat(cota): liga e desliga a cota pela tela de configuracoes"
```

---

## Ligar a cota em produção

A regra nasce desligada. Depois de tudo aplicado e a migração rodada, o admin liga em
`/admin/configuracoes` (Task 13). Antes de ligar, revise os planos: `classes_per_week` era
decorativo e pode estar com valor errado em planos antigos.

```sql
select name, classes_per_week, cycle, max_classes_per_day, refund_on_late_cancel
from subscription_plans where organization_id = '<id>' and is_active;
```

## Fora deste plano

- **Desativação de aluno** (`contract_active`) — plano 2. `AccessInput` ganha `contractActive` e o eixo 2 lá, não aqui.
- **Crédito bônus de período** ("semana de jogos") — spec próprio, ainda não escrito.
