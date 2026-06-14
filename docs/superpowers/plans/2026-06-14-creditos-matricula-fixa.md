# Créditos de Matrícula Fixa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que matrícula fixa exija plano ativo, conceda e debite créditos proporcionais às sessões reais do mês (com log no ledger), renove automaticamente no dia 1 e ofereça um backfill para a base atual.

**Architecture:** Toda a movimentação de créditos converge para uma função compartilhada `reconcileEnrollmentCredits` (concede → reserva → debita por sessão, idempotente). Server actions de matrícula/plano, dois cron routes (renovação dia 1 e backfill) e a geração semanal da grade chamam essa função. A lógica pura (janela do mês, montagem das operações) fica em `lib/utils/` com testes Vitest; a parte com efeito (Supabase) fica em `features/aulas/`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (RPCs `adjust_credits` e `book_session_atomic`), date-fns, Vitest, Vercel Cron.

**Spec:** [docs/superpowers/specs/2026-06-14-creditos-matricula-fixa-design.md](../specs/2026-06-14-creditos-matricula-fixa-design.md)

---

## File Structure

**Create:**
- `lib/utils/monthWindow.ts` — janelas de datas (mês corrente; restante do mês). Puro.
- `lib/utils/monthWindow.test.ts` — testes.
- `lib/utils/reconciliationOps.ts` — `requiresCredit`, `buildReconciliationOps`. Puro.
- `lib/utils/reconciliationOps.test.ts` — testes.
- `features/aulas/creditReconciliation.ts` — `reconcileEnrollmentCredits`, `reconcileAllActiveEnrollments`. Com efeito (Supabase).
- `app/api/cron/monthly-credit-renewal/route.ts` — cron dia 1.
- `app/api/cron/credit-backfill/route.ts` — execução pontual.

**Modify:**
- `features/aulas/adminActions.ts` — `enrollStudentInClass` (validação + reconcile); `generateWeeklyBookings` (delega ao helper).
- `features/financeiro/actions.ts` — `adminSubscribeStudentToPlan` e `subscribeToPlan` (remover concessão cheia; reconciliar matrículas existentes).
- `vercel.json` — adicionar cron.

---

## Task 1: Janelas de mês (puro)

**Files:**
- Create: `lib/utils/monthWindow.ts`
- Test: `lib/utils/monthWindow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/utils/monthWindow.test.ts
import { describe, it, expect } from 'vitest'
import { getMonthWindow, getRemainingMonthWindow } from './monthWindow'

describe('getMonthWindow', () => {
  it('returns first and last day of the month', () => {
    expect(getMonthWindow(new Date(2026, 5, 14))).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })

  it('handles February in a non-leap year', () => {
    expect(getMonthWindow(new Date(2026, 1, 10))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})

describe('getRemainingMonthWindow', () => {
  it('returns today through the last day of the month', () => {
    expect(getRemainingMonthWindow(new Date(2026, 5, 14))).toEqual({
      from: '2026-06-14',
      to: '2026-06-30',
    })
  })

  it('on the first day returns the whole month', () => {
    expect(getRemainingMonthWindow(new Date(2026, 5, 1))).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/monthWindow.test.ts`
Expected: FAIL — `Failed to resolve import './monthWindow'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/utils/monthWindow.ts
import { format, startOfMonth, endOfMonth } from 'date-fns'

export interface DateWindow {
  from: string // yyyy-MM-dd
  to: string // yyyy-MM-dd
}

/** Primeiro e último dia do mês de `now` (yyyy-MM-dd). */
export function getMonthWindow(now: Date): DateWindow {
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  }
}

/** Data de `now` até o último dia do mês (yyyy-MM-dd). */
export function getRemainingMonthWindow(now: Date): DateWindow {
  return {
    from: format(now, 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/utils/monthWindow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/monthWindow.ts lib/utils/monthWindow.test.ts
git commit -m "feat(creditos): helpers puros de janela de mes"
```

---

## Task 2: Montagem das operações de reconciliação (puro)

**Files:**
- Create: `lib/utils/reconciliationOps.ts`
- Test: `lib/utils/reconciliationOps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/utils/reconciliationOps.test.ts
import { describe, it, expect } from 'vitest'
import { requiresCredit, buildReconciliationOps } from './reconciliationOps'

describe('requiresCredit', () => {
  it('is true for subscriber and per_class', () => {
    expect(requiresCredit('subscriber')).toBe(true)
    expect(requiresCredit('per_class')).toBe(true)
  })
  it('is false for wellhub and totalpass', () => {
    expect(requiresCredit('wellhub')).toBe(false)
    expect(requiresCredit('totalpass')).toBe(false)
  })
})

describe('buildReconciliationOps', () => {
  const sessions = [
    { id: 's1', session_date: '2026-06-18' },
    { id: 's2', session_date: '2026-06-25' },
  ]

  it('creates one op per not-yet-booked session with credit flag and reasons', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), 'subscriber', 'Mensal 1x')
    expect(ops).toEqual([
      {
        sessionId: 's1',
        sessionDate: '2026-06-18',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 18/06',
        debitReason: 'Matrícula fixa — aula 18/06',
      },
      {
        sessionId: 's2',
        sessionDate: '2026-06-25',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 25/06',
        debitReason: 'Matrícula fixa — aula 25/06',
      },
    ])
  })

  it('skips sessions already booked', () => {
    const ops = buildReconciliationOps(sessions, new Set(['s1']), 'subscriber', 'Mensal 1x')
    expect(ops.map((o) => o.sessionId)).toEqual(['s2'])
  })

  it('marks needsCredit false for wellhub', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), 'wellhub', 'Mensal 1x')
    expect(ops.every((o) => o.needsCredit === false)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/reconciliationOps.test.ts`
Expected: FAIL — `Failed to resolve import './reconciliationOps'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/utils/reconciliationOps.ts
import { formatDate } from './dateHelpers'

export interface SessionLite {
  id: string
  session_date: string // yyyy-MM-dd
}

export interface ReconciliationOp {
  sessionId: string
  sessionDate: string
  needsCredit: boolean
  grantReason: string
  debitReason: string
}

/** Wellhub/TotalPass agendam via check-in, sem crédito. */
export function requiresCredit(paymentType: string): boolean {
  return paymentType !== 'wellhub' && paymentType !== 'totalpass'
}

/**
 * Para cada sessão ainda não reservada, monta a operação de reconciliação
 * (conceder + reservar + debitar). Puro: não toca no banco.
 */
export function buildReconciliationOps(
  sessions: SessionLite[],
  bookedSessionIds: Set<string>,
  paymentType: string,
  planName: string,
): ReconciliationOp[] {
  const needsCredit = requiresCredit(paymentType)
  return sessions
    .filter((s) => !bookedSessionIds.has(s.id))
    .map((s) => {
      const ddmm = formatDate(s.session_date, 'dd/MM')
      return {
        sessionId: s.id,
        sessionDate: s.session_date,
        needsCredit,
        grantReason: `Plano ${planName} — aula ${ddmm}`,
        debitReason: `Matrícula fixa — aula ${ddmm}`,
      }
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/utils/reconciliationOps.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/reconciliationOps.ts lib/utils/reconciliationOps.test.ts
git commit -m "feat(creditos): montagem pura das operacoes de reconciliacao"
```

---

## Task 3: Módulo de reconciliação (Supabase)

**Files:**
- Create: `features/aulas/creditReconciliation.ts`

Sem teste unitário (orquestra RPCs do Supabase; coberto pela lógica pura das Tasks 1–2 e pela verificação manual via endpoints na Task 9). A função aceita um client injetável para futura testabilidade.

- [ ] **Step 1: Write the module**

```ts
// features/aulas/creditReconciliation.ts
import { createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildReconciliationOps, requiresCredit } from '@/lib/utils/reconciliationOps'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'

export interface ReconcileResult {
  booked: number
  granted: number
  debited: number
  skipped: number
}

const EMPTY: ReconcileResult = { booked: 0, granted: 0, debited: 0, skipped: 0 }

/**
 * Reconcilia os créditos de UMA matrícula (aluno+turma) no intervalo [from, to]:
 * para cada sessão scheduled ainda não reservada, concede 1 crédito, reserva a
 * sessão e debita 1 crédito (Wellhub/TotalPass: só reserva). Idempotente.
 */
export async function reconcileEnrollmentCredits(
  studentId: string,
  classId: string,
  from: string,
  to: string,
  injectedClient?: SupabaseClient,
): Promise<ReconcileResult> {
  const adminClient = injectedClient ?? createAdminClient()
  const result: ReconcileResult = { ...EMPTY }

  // Perfil (payment_type) e turma (capacidade)
  const { data: profile } = await adminClient
    .from('profiles')
    .select('payment_type')
    .eq('id', studentId)
    .single()
  if (!profile) return result

  const { data: cls } = await adminClient
    .from('classes')
    .select('max_students')
    .eq('id', classId)
    .single()
  if (!cls) return result

  const paymentType = profile.payment_type as string
  const needsCredit = requiresCredit(paymentType)

  // Nome do plano para o log (só relevante quando há crédito)
  let planName = 'Mensal'
  if (needsCredit) {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('subscription_plans(name)')
      .eq('student_id', studentId)
      .eq('status', 'active')
      .maybeSingle()
    const planRel = (sub as { subscription_plans: { name: string } | { name: string }[] } | null)
      ?.subscription_plans
    const planObj = Array.isArray(planRel) ? planRel[0] : planRel
    if (planObj?.name) planName = planObj.name
  }

  // Sessões agendadas no intervalo
  const { data: sessionsRaw } = await adminClient
    .from('class_sessions')
    .select('id, session_date')
    .eq('class_id', classId)
    .eq('status', 'scheduled')
    .gte('session_date', from)
    .lte('session_date', to)
    .order('session_date', { ascending: true })

  const sessions = (sessionsRaw ?? []) as { id: string; session_date: string }[]
  if (sessions.length === 0) return result

  // Reservas confirmadas existentes do aluno entre essas sessões
  const sessionIds = sessions.map((s) => s.id)
  const { data: existingRaw } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', sessionIds)
  const bookedSessionIds = new Set(
    (existingRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )

  const ops = buildReconciliationOps(sessions, bookedSessionIds, paymentType, planName)

  for (const op of ops) {
    // 1. Reserva (atômica: respeita capacidade e reativa cancelado)
    const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
      p_student_id: studentId,
      p_session_id: op.sessionId,
      p_max_students: cls.max_students,
      p_type: 'extra',
      p_from_enrollment: true,
      p_credit_used: op.needsCredit,
    })
    if (bookErr) {
      // SESSION_FULL ou ALREADY_BOOKED (corrida): pula sem mexer em crédito
      result.skipped++
      continue
    }
    result.booked++

    if (!op.needsCredit) continue

    // 2. Concede 1 crédito (log)
    const { error: grantErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_delta: 1,
      p_type: 'renewed',
      p_reason: op.grantReason,
    })
    if (!grantErr) result.granted++

    // 3. Debita 1 crédito (log, vinculado à sessão)
    const { error: debitErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_delta: -1,
      p_type: 'used',
      p_reason: op.debitReason,
      p_session_id: op.sessionId,
    })
    if (!debitErr) result.debited++
  }

  return result
}

/**
 * Reconcilia TODAS as matrículas ativas no intervalo [from, to].
 * Inclui apenas alunos com assinatura ativa OU Wellhub/TotalPass.
 */
export async function reconcileAllActiveEnrollments(
  from: string,
  to: string,
): Promise<ReconcileResult & { processedEnrollments: number }> {
  const adminClient = createAdminClient()

  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('student_id, class_id, profiles(payment_type)')
    .eq('is_active', true)

  type Row = {
    student_id: string
    class_id: string
    profiles: { payment_type: string } | { payment_type: string }[] | null
  }
  const enrollments = (enrollmentsRaw ?? []) as unknown as Row[]

  // Alunos com assinatura ativa
  const { data: subsRaw } = await adminClient
    .from('student_subscriptions')
    .select('student_id')
    .eq('status', 'active')
  const activeSubStudents = new Set(
    (subsRaw ?? []).map((s: { student_id: string }) => s.student_id),
  )

  const totals = { ...EMPTY, processedEnrollments: 0 }

  for (const e of enrollments) {
    const prof = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    const paymentType = prof?.payment_type ?? 'subscriber'
    const eligible = !requiresCredit(paymentType) || activeSubStudents.has(e.student_id)
    if (!eligible) continue

    const r = await reconcileEnrollmentCredits(e.student_id, e.class_id, from, to, adminClient)
    totals.booked += r.booked
    totals.granted += r.granted
    totals.debited += r.debited
    totals.skipped += r.skipped
    totals.processedEnrollments++
  }

  return totals
}

/** Janela "restante do mês" reexportada para conveniência dos callers. */
export { getRemainingMonthWindow }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (sem erros). Se `@supabase/supabase-js` não exporta `SupabaseClient` no contexto, trocar o tipo do parâmetro `injectedClient` por `ReturnType<typeof createAdminClient>`.

- [ ] **Step 3: Commit**

```bash
git add features/aulas/creditReconciliation.ts
git commit -m "feat(creditos): modulo de reconciliacao por matricula"
```

---

## Task 4: Validação de plano + reconcile em `enrollStudentInClass`

**Files:**
- Modify: `features/aulas/adminActions.ts:53-167`

- [ ] **Step 1: Add imports**

No topo de `features/aulas/adminActions.ts`, após os imports existentes, adicionar:

```ts
import { endOfMonth } from 'date-fns'
import { reconcileEnrollmentCredits } from './creditReconciliation'
import { requiresCredit } from '@/lib/utils/reconciliationOps'
```

- [ ] **Step 2: Insert plan validation before the enrollment upsert**

Em `enrollStudentInClass`, logo após o bloco de checagem de capacidade (`if ((enrolled ?? 0) >= cls.max_students) return { error: 'Turma lotada.' }`) e **antes** do `upsert` de `enrollments`, inserir:

```ts
  // Validação: matrícula fixa exige plano ativo (exceto Wellhub/TotalPass)
  const { data: validationProfile } = await adminClient
    .from('profiles')
    .select('payment_type')
    .eq('id', studentId)
    .single()

  if (requiresCredit((validationProfile?.payment_type as string) ?? 'subscriber')) {
    const { count: activeSubs } = await adminClient
      .from('student_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .eq('status', 'active')
    if ((activeSubs ?? 0) === 0) {
      return {
        error: 'Aluno não possui plano ativo. Vincule um plano antes de criar a matrícula fixa.',
      }
    }
  }
```

- [ ] **Step 3: Replace the old single-session credit block with a reconcile call**

Remover todo o bloco que vai de `// Deduct 1 credit and book the next upcoming session (if any)` até o fechamento do `if (nextSession && balance > 0) { ... }` (linhas ~104–162 do arquivo original) e substituir por:

```ts
  // Concede + reserva + debita todas as sessões restantes do mês para esta turma
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')
  await reconcileEnrollmentCredits(studentId, classId, today, monthEnd)
```

(Mantém o `revalidatePath(...)` e `return {}` que já existem no fim da função.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Não deve restar referência a `nextSession`, `studentProfile` ou `balance` na função.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "fix(creditos): matricula fixa valida plano e debita sessoes do mes"
```

---

## Task 5: Concessão proporcional ao vincular plano

**Files:**
- Modify: `features/financeiro/actions.ts` (`adminSubscribeStudentToPlan`, `subscribeToPlan`)

- [ ] **Step 1: Add imports**

No topo de `features/financeiro/actions.ts`, após os imports existentes:

```ts
import { reconcileEnrollmentCredits } from '@/features/aulas/creditReconciliation'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
```

- [ ] **Step 2: Replace flat grant in `adminSubscribeStudentToPlan`**

Substituir o bloco que concede `credits_per_month` (o `if (creditsToGrant > 0 && newSub) { ... }`, linhas ~182–192) por:

```ts
  // Concede créditos proporcionais reconciliando as matrículas ativas do aluno
  if (newSub) {
    const { data: activeEnrolls } = await adminClient
      .from('enrollments')
      .select('class_id')
      .eq('student_id', studentId)
      .eq('is_active', true)

    const { from, to } = getRemainingMonthWindow(new Date())
    for (const e of (activeEnrolls ?? []) as { class_id: string }[]) {
      await reconcileEnrollmentCredits(studentId, e.class_id, from, to)
    }
  }
```

O `select` do plano pode manter apenas `id, is_active` (não precisa mais de `credits_per_month`), mas deixá-lo como está também é inofensivo.

- [ ] **Step 3: Replace flat grant in `subscribeToPlan`**

Em `subscribeToPlan`, substituir o bloco `const credits = plan.credits_per_month as number; if (credits > 0) { ... }` (linhas ~83–92) por:

```ts
  // Concede créditos proporcionais reconciliando as matrículas ativas do aluno
  const { data: activeEnrolls } = await adminClient
    .from('enrollments')
    .select('class_id')
    .eq('student_id', user.id)
    .eq('is_active', true)

  const { from, to } = getRemainingMonthWindow(new Date())
  for (const e of (activeEnrolls ?? []) as { class_id: string }[]) {
    await reconcileEnrollmentCredits(user.id, e.class_id, from, to)
  }
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/financeiro/actions.ts
git commit -m "feat(creditos): vincular plano concede creditos proporcionais via reconcile"
```

---

## Task 6: Cron de renovação no dia 1

**Files:**
- Create: `app/api/cron/monthly-credit-renewal/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the route**

```ts
// app/api/cron/monthly-credit-renewal/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getMonthWindow } from '@/lib/utils/monthWindow'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Roda no dia 1 → janela = mês inteiro corrente.
  const { from, to } = getMonthWindow(new Date())
  const summary = await reconcileAllActiveEnrollments(from, to)

  return NextResponse.json({ window: { from, to }, ...summary })
}
```

- [ ] **Step 2: Add the cron entry to `vercel.json`**

Substituir o conteúdo de `vercel.json` por:

```json
{
  "crons": [
    {
      "path": "/api/cron/waitlist-notifications",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/monthly-credit-renewal",
      "schedule": "0 1 1 * *"
    }
  ]
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/monthly-credit-renewal/route.ts vercel.json
git commit -m "feat(creditos): cron de renovacao mensal no dia 1"
```

---

## Task 7: Rota de backfill (execução pontual)

**Files:**
- Create: `app/api/cron/credit-backfill/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/cron/credit-backfill/route.ts
// Execução pontual: desconta os créditos das aulas do mês corrente para
// alunos ativos que já têm matrícula fixa. Idempotente (pula sessões já
// reservadas). Disparar manualmente via curl com o CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { from, to } = getRemainingMonthWindow(new Date())
  const summary = await reconcileAllActiveEnrollments(from, to)

  return NextResponse.json({ window: { from, to }, ...summary })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/credit-backfill/route.ts
git commit -m "feat(creditos): rota de backfill de creditos da base atual"
```

---

## Task 8: Refatorar `generateWeeklyBookings` para usar o helper

**Files:**
- Modify: `features/aulas/adminActions.ts` (`generateWeeklyBookings`, ~391-515)

Mantém a assinatura de retorno `{ booked: string[]; skipped: string[] }` consumida por [GenerateSessionsButton.tsx](../../../app/(admin)/admin/grade/GenerateSessionsButton.tsx). `booked` = alunos com ao menos 1 sessão reservada; `skipped` = alunos cujas sessões foram todas puladas (ex.: turma lotada).

- [ ] **Step 1: Replace the function body**

Substituir o corpo de `generateWeeklyBookings` (após o `requireAdmin`) por:

```ts
  const adminClient = createAdminClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const in14 = new Date()
  in14.setDate(in14.getDate() + 14)
  const in14Str = format(in14, 'yyyy-MM-dd')

  // Matrículas ativas da turma com nome do aluno
  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('student_id, profiles(full_name)')
    .eq('class_id', classId)
    .eq('is_active', true)

  type EnrollRow = {
    student_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }
  const enrollments = (enrollmentsRaw ?? []) as unknown as EnrollRow[]
  if (enrollments.length === 0) return { booked: [], skipped: [] }

  const bookedNames: string[] = []
  const skippedNames: string[] = []

  for (const enroll of enrollments) {
    const prof = Array.isArray(enroll.profiles) ? enroll.profiles[0] : enroll.profiles
    const name = prof?.full_name ?? 'Aluno'

    const r = await reconcileEnrollmentCredits(
      enroll.student_id,
      classId,
      today,
      in14Str,
      adminClient,
    )

    if (r.booked > 0) {
      if (!bookedNames.includes(name)) bookedNames.push(name)
    } else if (r.skipped > 0) {
      if (!skippedNames.includes(name)) skippedNames.push(name)
    }
  }

  revalidatePath('/admin/grade')
  return { booked: bookedNames, skipped: skippedNames }
```

`reconcileEnrollmentCredits` já está importado pela Task 4.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Não deve restar código morto (loop antigo de sessões, checagem de `credits_balance`, inserts diretos de `session_bookings`/`notifications` dentro desta função).

- [ ] **Step 3: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "refactor(creditos): generateWeeklyBookings delega ao reconcile"
```

---

## Task 9: Verificação final

- [ ] **Step 1: Run full test suite**

Run: `npm run test:run`
Expected: PASS — incluindo `monthWindow.test.ts` e `reconciliationOps.test.ts`, sem regressões.

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: PASS (build conclui sem erros).

- [ ] **Step 3: Manual smoke (ambiente de dev/staging)**

Com `npm run dev` rodando e `CRON_SECRET` definido:

1. Como admin, em `/admin/alunos/<id>` de um aluno **sem plano**, tentar criar matrícula fixa → deve falhar com "Aluno não possui plano ativo...".
2. Vincular um plano ao aluno; criar a matrícula fixa → conferir em `credit_transactions` os pares `renewed (+1)` / `used (-1)` por sessão do mês, e `session_bookings` confirmados.
3. Disparar o backfill e conferir o resumo retornado:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/credit-backfill
```

Esperado: JSON `{ window, processedEnrollments, booked, granted, debited, skipped }`. Reexecutar → `booked`/`granted`/`debited` devem cair para ~0 (idempotência).

4. Validar o cron de renovação (mesma forma):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/monthly-credit-renewal
```

- [ ] **Step 4: Final commit (se houver ajustes do smoke)**

```bash
git add -A
git commit -m "test(creditos): ajustes apos verificacao manual"
```

---

## Self-Review — cobertura do spec

- Bug do débito → Task 4 (substitui o bloco de sessão única por reconcile do mês).
- Validação de plano (exceto WH/TP) → Task 4 (usa `requiresCredit`).
- Proporção por sessões reais → Tasks 1–3 (janela + ops + reconcile).
- Vincular plano concede proporcional → Task 5.
- Renovação dia 1 + log + acúmulo → Task 6 (sem passo de expiração).
- Backfill da base atual → Task 7.
- `generateWeeklyBookings` redundante → Task 8 (refatorado, UI preservada).
- Testes → Tasks 1, 2 (puros) + Task 9 (suite + smoke).
