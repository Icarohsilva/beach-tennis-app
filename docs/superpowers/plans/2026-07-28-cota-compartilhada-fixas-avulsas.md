# Cota compartilhada entre fixas e avulsas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a matrícula fixa competir pelo mesmo saldo mensal de cota que a reserva avulsa — hoje a fixa nunca é bloqueada (`max()` em `resolveQuota` garante isso). A geração da grade passa a checar a cota antes de vincular cada fixa; quando não sobra saldo, pula a vinculação daquela semana e avisa aluno + admin.

**Architecture:** Três mudanças em cascata. (1) `getQuotaSnapshot` para de somar TODAS as matrículas ativas no cálculo do limite — só conta até `classes_per_week` do plano atual, as mais antigas primeiro (`resolveQuota` em si não muda). (2) `reconcileEnrollmentCredits` (extraído para um arquivo próprio) ganha um orçamento opcional de cota — quando esgotado, para de reservar e conta como "pulado por cota" em vez de reservar. (3) `reconcileAllActiveEnrollments` agrupa as matrículas por aluno, calcula o orçamento uma vez (via `getQuotaSnapshot`), processa as turmas do aluno em ordem de dia da semana, e notifica aluno+admins quando algo é pulado.

**Tech Stack:** TypeScript · Next.js 14 App Router · Supabase · Vitest

**Spec:** [`docs/superpowers/specs/2026-07-28-cota-compartilhada-fixas-avulsas-design.md`](../specs/2026-07-28-cota-compartilhada-fixas-avulsas-design.md)

---

## Escopo deste plano

Fixa e avulsa passam a competir pela mesma cota mensal. Matrículas excedentes (mais fixas do que `classes_per_week` do plano atual permite) contam como 0 no cálculo do limite — as mais antigas (`enrolled_at`) são as que valem. **Fora do escopo:** aluno sem plano ativo e sem parceiro mas ainda com matrícula fixa (inconsistência pré-existente); qualquer mudança em `addStudentToSession` (admin continua furando a cota).

## Ambiente

Rode os testes com a ferramenta **PowerShell**, não Bash — `vitest` via Bash falha aleatoriamente neste ambiente com `"config" undefined`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `features/aulas/quotaUsage.ts` (mod) | `getQuotaSnapshot` só conta fixas até o limite do plano atual |
| `features/aulas/quotaUsage.test.ts` (mod) | Teste do cap |
| `features/aulas/reconcileEnrollment.ts` (novo) | `reconcileEnrollmentCredits` extraído de `creditReconciliation.ts`, ganha orçamento de cota |
| `features/aulas/reconcileEnrollment.test.ts` (novo) | Testes do orçamento |
| `features/aulas/adminActions.ts` (mod) | Import de `reconcileEnrollmentCredits` aponta pro arquivo novo |
| `features/financeiro/actions.ts` (mod) | Idem |
| `features/aulas/quotaSkipNotify.ts` (novo) | Notifica aluno + admins quando uma fixa é pulada por falta de cota |
| `features/aulas/quotaSkipNotify.test.ts` (novo) | Testes da notificação |
| `features/aulas/creditReconciliation.ts` (mod) | `reconcileAllActiveEnrollments` agrupa por aluno, aplica orçamento, notifica |
| `features/aulas/creditReconciliation.test.ts` (novo) | Testes do agrupamento/orçamento — arquivo não existia antes |
| `features/aulas/gridGeneration.ts` (mod) | Propaga `quotaSkipped` no retorno |
| `features/aulas/gridGeneration.test.ts` (mod) | Ajusta mocks/asserts pro campo novo |
| `features/aulas/gridActions.ts` (mod) | Propaga `semCota` no retorno |
| `features/aulas/gridActions.test.ts` (mod) | Idem |
| `app/(admin)/admin/grade/GridGenerateButtons.tsx` (mod) | Mostra "N sem cota" no resumo da geração |

---

### Task 1: `getQuotaSnapshot` só conta fixas até o limite do plano atual

**Files:**
- Modify: `features/aulas/quotaUsage.ts:81-95`
- Modify: `features/aulas/quotaUsage.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao fim do `describe('getQuotaSnapshot', ...)` em `features/aulas/quotaUsage.test.ts`:

```ts
  it('conta só as matrículas mais antigas até o limite do plano atual', async () => {
    // Plano foi reduzido pra 1x/semana, mas o aluno ainda tem 2 matrículas
    // ativas de quando o plano permitia mais. Só a mais antiga (enrolled_at
    // menor) conta pro limite — a mais nova é excedente.
    const planoReduzido: PlanQuota = { ...PLANO, classesPerWeek: 1 }
    const client = makeClient({
      bookings: [],
      enrollments: [
        { classes: { day_of_week: 3 }, enrolled_at: '2026-06-01T00:00:00Z' }, // quarta, mais antiga
        { classes: { day_of_week: 5 }, enrolled_at: '2026-07-15T00:00:00Z' }, // sexta, mais nova (excedente)
      ],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', planoReduzido, '2026-07-28')

    // Julho/2026 tem 5 quartas (01,08,15,22,29). Só a matrícula de quarta conta.
    // A de sexta (excedente) soma 0. max(1×4, 5) = 5.
    expect(snap.limit).toBe(5)
  })
```

Adapte a assinatura de `makeClient`'s `enrollments` (no topo do arquivo) pra aceitar `enrolled_at`:

```ts
  enrollments?: { classes: { day_of_week: number }; enrolled_at?: string }[]
```

E adicione `order: () => builder` na cadeia do `builder` dentro de `makeClient` (junto de `select`/`eq`/`gte`/`lte`/`in`), já que o código vai chamar `.order('enrolled_at', ...)`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/quotaUsage.test.ts`
Expected: FAIL — `snap.limit` vem 10 (5+5, sem o cap), esperava 5.

- [ ] **Step 3: Implementar**

Em `features/aulas/quotaUsage.ts`, troque:

```ts
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
```

por:

```ts
  const { data: enrollRaw } = await client
    .from('enrollments')
    .select('enrolled_at, classes!inner(day_of_week)')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('enrolled_at', { ascending: true })

  // Só conta pro limite as matrículas mais antigas, até o que o plano ATUAL
  // permite. Se o aluno tem mais fixas do que classes_per_week hoje (o plano
  // foi reduzido depois de matriculado), as excedentes (mais novas) não
  // entram aqui — competem pela cota igual uma reserva avulsa.
  const fixedSessionsInCycle = (
    (enrollRaw ?? []) as unknown as {
      enrolled_at: string
      classes: { day_of_week: number } | { day_of_week: number }[]
    }[]
  )
    .slice(0, plan.classesPerWeek)
    .reduce((acc, e) => {
      const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
      return acc + occurrencesOfDay(window.from, window.to, cls.day_of_week)
    }, 0)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/quotaUsage.test.ts`
Expected: PASS — 8 testes (7 existentes + 1 novo). O teste existente "as fixas elevam o limite" (2 matrículas, plano com `classesPerWeek: 2`) continua passando sem mudança: `.slice(0, 2)` em um array de 2 não corta nada.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm run test:run`
Expected: PASS — sem regressão em `bookSession`/`enrollStudentInClass`/outros consumidores de `getQuotaSnapshot`.

- [ ] **Step 6: Commit**

```bash
git add features/aulas/quotaUsage.ts features/aulas/quotaUsage.test.ts
git commit -m "feat(cota): so conta fixas ate o limite do plano atual"
```

---

### Task 2: Extrair `reconcileEnrollmentCredits` com orçamento de cota

**Files:**
- Create: `features/aulas/reconcileEnrollment.ts`
- Create: `features/aulas/reconcileEnrollment.test.ts`
- Modify: `features/aulas/creditReconciliation.ts` (remove a função, importa do arquivo novo)
- Modify: `features/aulas/adminActions.ts:8` (import)
- Modify: `features/financeiro/actions.ts:5` (import)

**Por que extrair:** `reconcileAllActiveEnrollments` (Task 4) precisa ser testável isolando `reconcileEnrollmentCredits` via `vi.mock(...)`. Isso só funciona de forma limpa se as duas funções estiverem em arquivos diferentes — mockar uma função chamada dentro do mesmo arquivo em que ela é definida não funciona com ESM/Vitest. `reconcileEnrollmentCredits` (reconciliar UMA matrícula) e `reconcileAllActiveEnrollments` (orquestrar TODAS) já são duas responsabilidades distintas — a extração só torna essa fronteira explícita.

- [ ] **Step 1: Escrever o teste que falha**

Crie `features/aulas/reconcileEnrollment.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { reconcileEnrollmentCredits } from './reconcileEnrollment'

/**
 * Stub escopado ao que reconcileEnrollmentCredits consulta: a turma
 * (max_students), as sessões agendadas no intervalo, e as reservas já
 * existentes do aluno nelas. `rpcCalls` captura as chamadas de
 * book_session_atomic; `bookErrors` simula falha (SESSION_FULL/corrida) pro
 * sessionId indicado.
 */
function makeClient(opts: {
  sessions: { id: string; session_date: string }[]
  alreadyBooked?: string[]
  bookErrors?: Set<string>
}) {
  const rpcCalls: { p_session_id: string }[] = []
  const rpc = vi.fn((_fn: string, args: { p_session_id: string }) => {
    rpcCalls.push(args)
    if (opts.bookErrors?.has(args.p_session_id)) {
      return Promise.resolve({ error: { message: 'SESSION_FULL' } })
    }
    return Promise.resolve({ error: null })
  })

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      single: () => Promise.resolve({ data: { max_students: 10, organization_id: 'org-1' } }),
      then: (resolve: (v: { data: unknown }) => void) => {
        const data =
          table === 'class_sessions'
            ? opts.sessions
            : table === 'session_bookings'
              ? (opts.alreadyBooked ?? []).map((id) => ({ session_id: id }))
              : []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })

  return { client: { from, rpc } as never, rpcCalls }
}

describe('reconcileEnrollmentCredits', () => {
  it('sem orçamento de cota, reserva todas as sessões pendentes (comportamento de sempre)', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client)

    expect(r).toEqual({ booked: 2, skipped: 0, quotaSkipped: 0 })
    expect(rpcCalls).toHaveLength(2)
  })

  it('orçamento 0 pula todas as sessões pendentes sem reservar nenhuma', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client, 0)

    expect(r).toEqual({ booked: 0, skipped: 0, quotaSkipped: 2 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('orçamento 1 com 2 pendentes reserva a primeira e pula a segunda', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client, 1)

    expect(r).toEqual({ booked: 1, skipped: 0, quotaSkipped: 1 })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].p_session_id).toBe('s1')
  })

  it('falha do RPC conta como skipped, não quotaSkipped, e não consome orçamento', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
      bookErrors: new Set(['s1']),
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client, 5)

    expect(r).toEqual({ booked: 1, skipped: 1, quotaSkipped: 0 })
    expect(rpcCalls).toHaveLength(2)
  })

  it('sessões já reservadas não entram nas operações (idempotente)', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
      alreadyBooked: ['s1'],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client)

    expect(r).toEqual({ booked: 1, skipped: 0, quotaSkipped: 0 })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].p_session_id).toBe('s2')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/reconcileEnrollment.test.ts`
Expected: FAIL — `Failed to resolve import "./reconcileEnrollment"`

- [ ] **Step 3: Criar o arquivo com a função extraída e o orçamento**

Crie `features/aulas/reconcileEnrollment.ts` com o conteúdo abaixo (é `reconcileEnrollmentCredits` tal como está hoje em `creditReconciliation.ts`, mais o parâmetro `quotaBudget` e o campo `quotaSkipped`):

```ts
// features/aulas/reconcileEnrollment.ts
// Reconcilia UMA matrícula (aluno+turma): reserva as sessões da janela que
// ainda não foram reservadas. Extraído de creditReconciliation.ts pra ficar
// mockável isoladamente nos testes de reconcileAllActiveEnrollments.
import { createAdminClient } from '@/lib/supabase/server'
import { buildReconciliationOps } from '@/lib/utils/reconciliationOps'

export interface ReconcileResult {
  booked: number
  skipped: number
  /** Pendente reservar, mas sem orçamento de cota — não é falha, é limite. */
  quotaSkipped: number
}

const EMPTY: ReconcileResult = { booked: 0, skipped: 0, quotaSkipped: 0 }

/**
 * Reserva as sessões da matrícula fixa (aluno+turma) no intervalo [from, to].
 * Idempotente.
 *
 * NÃO mexe em crédito: desde 2026-07 matrícula fixa exige plano ou parceiro, e
 * os dois entram de graça (spec §3). Antes daqui saía um par concede/debita por
 * sessão — era a mecânica de "plano dá crédito", que deixou de existir.
 *
 * `quotaBudget`: quantas sessões ainda podem ser reservadas nesta chamada por
 * causa da cota do aluno. `null` = sem limite (parceiro, cota desligada, ou
 * aluno sem plano ativo — ver reconcileAllActiveEnrollments). Sessões
 * pendentes além do orçamento contam em `quotaSkipped`, não em `skipped`
 * (que é reservado pra falha real de reserva — lotação ou corrida).
 */
export async function reconcileEnrollmentCredits(
  studentId: string,
  classId: string,
  from: string,
  to: string,
  injectedClient?: ReturnType<typeof createAdminClient>,
  quotaBudget: number | null = null,
): Promise<ReconcileResult> {
  const adminClient = injectedClient ?? createAdminClient()
  const result: ReconcileResult = { ...EMPTY }

  const { data: cls } = await adminClient
    .from('classes')
    .select('max_students, organization_id')
    .eq('id', classId)
    .single()
  if (!cls) return result

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

  // Reservas existentes em QUALQUER status. As canceladas entram de propósito:
  // opt-out de aula fixa (skipEnrollmentNoBooking) e saída com refund
  // (skipEnrollmentSession) deixam uma reserva 'cancelled', e reconciliar não
  // pode reativá-las. O unique student_id+session_id garante no máximo uma.
  const sessionIds = sessions.map((s) => s.id)
  const { data: existingRaw } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .in('session_id', sessionIds)
  const bookedSessionIds = new Set(
    (existingRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )

  const ops = buildReconciliationOps(sessions, bookedSessionIds)

  for (const op of ops) {
    if (quotaBudget !== null && result.booked >= quotaBudget) {
      result.quotaSkipped++
      continue
    }
    const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
      p_student_id: studentId,
      p_session_id: op.sessionId,
      p_max_students: cls.max_students,
      p_type: 'extra',
      p_from_enrollment: true,
      p_credit_used: false,
    })
    if (bookErr) {
      // SESSION_FULL ou ALREADY_BOOKED (corrida): pula.
      result.skipped++
      continue
    }
    result.booked++
  }

  return result
}
```

- [ ] **Step 4: Remover a função de `creditReconciliation.ts` e importar do arquivo novo**

Em `features/aulas/creditReconciliation.ts`, remova a interface `ReconcileResult`, a constante `EMPTY`, e toda a função `reconcileEnrollmentCredits` (linhas 7-85 do arquivo atual). No topo do arquivo, adicione:

```ts
import { reconcileEnrollmentCredits, type ReconcileResult } from './reconcileEnrollment'
```

Em `reconcileAllActiveEnrollments`, troque a linha `const totals = { ...EMPTY, processedEnrollments: 0, failed: 0 }` por:

```ts
  const totals = { booked: 0, skipped: 0, quotaSkipped: 0, processedEnrollments: 0, failed: 0 }
```

(Task 4 vai reescrever o resto do corpo de `reconcileAllActiveEnrollments` — por agora só garanta que o arquivo compila com a função extraída.)

- [ ] **Step 5: Atualizar os dois call sites externos**

Em `features/aulas/adminActions.ts`, linha 8, troque:

```ts
import { reconcileEnrollmentCredits } from './creditReconciliation'
```

por:

```ts
import { reconcileEnrollmentCredits } from './reconcileEnrollment'
```

Em `features/financeiro/actions.ts`, linha 5, troque:

```ts
import { reconcileEnrollmentCredits } from '@/features/aulas/creditReconciliation'
```

por:

```ts
import { reconcileEnrollmentCredits } from '@/features/aulas/reconcileEnrollment'
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/reconcileEnrollment.test.ts`
Expected: PASS — 5 testes.

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (o arquivo `creditReconciliation.ts` pode ainda ter um erro de tipo temporário no corpo de `reconcileAllActiveEnrollments`, já que ele referencia campos que a Task 4 introduz — se aparecer, é esperado e a Task 4 resolve; qualquer OUTRO erro novo fora desse não é esperado).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm run test:run`
Expected: PASS — sem regressão em `adminActions.test.ts`/outros que dependem de `reconcileEnrollmentCredits` continuar funcionando (só o import mudou, não o comportamento default).

- [ ] **Step 8: Commit**

```bash
git add features/aulas/reconcileEnrollment.ts features/aulas/reconcileEnrollment.test.ts features/aulas/creditReconciliation.ts features/aulas/adminActions.ts features/financeiro/actions.ts
git commit -m "refactor(cota): extrai reconcileEnrollmentCredits com orcamento de cota"
```

---

### Task 3: `quotaSkipNotify.ts` — avisa aluno e admins

**Files:**
- Create: `features/aulas/quotaSkipNotify.ts`
- Create: `features/aulas/quotaSkipNotify.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `features/aulas/quotaSkipNotify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications/dispatch', () => ({
  notifyUsers: vi.fn().mockResolvedValue(undefined),
}))

import { notifyQuotaSkips } from './quotaSkipNotify'
import { notifyUsers } from '@/lib/notifications/dispatch'

function makeClient(admins: { user_id: string }[], students: { id: string; full_name: string }[]) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      then: (resolve: (v: { data: unknown }) => void) => {
        const data = table === 'memberships' ? admins : table === 'profiles' ? students : []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })
  return { from } as never
}

describe('notifyQuotaSkips', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista vazia não faz nada', async () => {
    await notifyQuotaSkips([])
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('notifica o aluno individualmente e os admins com um resumo', async () => {
    const client = makeClient(
      [{ user_id: 'admin-1' }],
      [{ id: 'stu-1', full_name: 'Fulano' }],
    )

    await notifyQuotaSkips(
      [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma Terça', orgId: 'org-1' }],
      client,
    )

    expect(notifyUsers).toHaveBeenCalledTimes(2)
    expect(notifyUsers).toHaveBeenNthCalledWith(1, client, expect.objectContaining({
      orgId: 'org-1',
      recipients: [{ userId: 'stu-1' }],
      type: 'fixa_sem_cota',
      channels: ['push', 'inapp'],
    }))
    expect(notifyUsers).toHaveBeenNthCalledWith(2, client, expect.objectContaining({
      orgId: 'org-1',
      recipients: [{ userId: 'admin-1' }],
      type: 'fixa_sem_cota_admin',
      channels: ['inapp'],
      body: expect.stringContaining('Fulano'),
    }))
  })

  it('sem admin na academia, não tenta notificar admin (mas notifica o aluno)', async () => {
    const client = makeClient([], [{ id: 'stu-1', full_name: 'Fulano' }])

    await notifyQuotaSkips(
      [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma Terça', orgId: 'org-1' }],
      client,
    )

    expect(notifyUsers).toHaveBeenCalledTimes(1)
    expect(notifyUsers).toHaveBeenCalledWith(client, expect.objectContaining({ type: 'fixa_sem_cota' }))
  })

  it('erro em notifyUsers não propaga (best-effort)', async () => {
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error('boom'))
    const client = makeClient([{ user_id: 'admin-1' }], [{ id: 'stu-1', full_name: 'Fulano' }])
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      notifyQuotaSkips(
        [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma Terça', orgId: 'org-1' }],
        client,
      ),
    ).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/quotaSkipNotify.test.ts`
Expected: FAIL — `Failed to resolve import "./quotaSkipNotify"`

- [ ] **Step 3: Implementar**

```ts
// features/aulas/quotaSkipNotify.ts
// Avisa aluno + admins quando uma matrícula fixa é pulada por falta de cota na
// geração da grade. Best-effort: nunca lança (mesmo padrão de gridNotify.ts).
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'

type AdminClient = ReturnType<typeof createAdminClient>

export interface QuotaSkip {
  studentId: string
  classId: string
  className: string
  orgId: string
}

export async function notifyQuotaSkips(skips: QuotaSkip[], client?: AdminClient): Promise<void> {
  if (skips.length === 0) return

  try {
    const c = client ?? createAdminClient()

    // Um aluno pode aparecer mais de uma vez (mais de uma fixa pulada);
    // agrupa por academia pra mandar um único aviso resumido aos admins.
    const byOrg = new Map<string, QuotaSkip[]>()
    for (const s of skips) {
      byOrg.set(s.orgId, [...(byOrg.get(s.orgId) ?? []), s])
    }

    for (const [orgId, orgSkips] of byOrg) {
      for (const s of orgSkips) {
        await notifyUsers(c, {
          orgId,
          recipients: [{ userId: s.studentId }],
          type: 'fixa_sem_cota',
          title: 'Sem cota disponível',
          body: `Você não foi vinculado à aula de ${s.className} esta semana — sua cota mensal já foi usada.`,
          channels: ['push', 'inapp'],
        })
      }

      const { data: admins } = await c
        .from('memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('role', 'admin')
      const adminRecipients = ((admins ?? []) as { user_id: string }[]).map((m) => ({ userId: m.user_id }))
      if (adminRecipients.length === 0) continue

      const { data: students } = await c
        .from('profiles')
        .select('id, full_name')
        .in('id', orgSkips.map((s) => s.studentId))
      const nameById = new Map(
        ((students ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
      )
      const lista = orgSkips
        .map((s) => `${nameById.get(s.studentId) ?? 'Aluno'} (${s.className})`)
        .join(', ')

      await notifyUsers(c, {
        orgId,
        recipients: adminRecipients,
        type: 'fixa_sem_cota_admin',
        title: 'Aluno sem cota',
        body: `${orgSkips.length} matrícula(s) fixa(s) não foram vinculadas nesta geração por falta de cota: ${lista}.`,
        channels: ['inapp'],
      })
    }
  } catch (err) {
    console.error('[notifyQuotaSkips] falhou', { error: err instanceof Error ? err.message : String(err) })
    Sentry.captureException(err, { tags: { feature: 'quotaSkipNotify' } })
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/quotaSkipNotify.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/aulas/quotaSkipNotify.ts features/aulas/quotaSkipNotify.test.ts
git commit -m "feat(cota): notifica aluno e admins quando fixa e pulada por falta de cota"
```

---

### Task 4: `reconcileAllActiveEnrollments` agrupa, ordena e aplica o orçamento

**Files:**
- Modify: `features/aulas/creditReconciliation.ts`
- Create: `features/aulas/creditReconciliation.test.ts` (arquivo não existia)

- [ ] **Step 1: Escrever o teste que falha**

Crie `features/aulas/creditReconciliation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('./reconcileEnrollment', () => ({
  reconcileEnrollmentCredits: vi.fn(),
}))
vi.mock('@/lib/billing/planEligibility', () => ({
  getActivePlan: vi.fn(),
}))
vi.mock('./quotaSettings', () => ({
  isQuotaEnforced: vi.fn(),
}))
vi.mock('./quotaUsage', () => ({
  getQuotaSnapshot: vi.fn(),
}))
vi.mock('./quotaSkipNotify', () => ({
  notifyQuotaSkips: vi.fn().mockResolvedValue(undefined),
}))

import { createAdminClient } from '@/lib/supabase/server'
import { reconcileAllActiveEnrollments } from './creditReconciliation'
import { reconcileEnrollmentCredits } from './reconcileEnrollment'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { isQuotaEnforced } from './quotaSettings'
import { getQuotaSnapshot } from './quotaUsage'
import { notifyQuotaSkips } from './quotaSkipNotify'

type EnrollRow = {
  student_id: string
  class_id: string
  organization_id: string
  enrolled_at: string
  classes: { name: string; day_of_week: number; start_time: string }
}

function makeClient(opts: {
  enrollments: EnrollRow[]
  memberships?: { user_id: string; organization_id: string; partner: string | null }[]
  subscriptions?: {
    student_id: string
    organization_id: string
    gateway: string
    current_period_end: string | null
  }[]
}) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      then: (resolve: (v: { data: unknown }) => void) => {
        const data =
          table === 'enrollments'
            ? opts.enrollments
            : table === 'memberships'
              ? (opts.memberships ?? [])
              : table === 'student_subscriptions'
                ? (opts.subscriptions ?? [])
                : []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })
  return { from } as never
}

const PLANO = { classesPerWeek: 2, cycle: 'monthly' as const, maxClassesPerDay: 2, refundOnLateCancel: true }

describe('reconcileAllActiveEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(notifyQuotaSkips).mockResolvedValue(undefined)
  })

  it('processa as fixas do aluno em ordem de dia da semana, decrementando o orçamento', async () => {
    const client = makeClient({
      enrollments: [
        {
          student_id: 'stu-1', class_id: 'thu-class', organization_id: 'org-1',
          enrolled_at: '2026-01-01T00:00:00Z',
          classes: { name: 'Turma Quinta', day_of_week: 4, start_time: '18:00:00' },
        },
        {
          student_id: 'stu-1', class_id: 'tue-class', organization_id: 'org-1',
          enrolled_at: '2026-01-02T00:00:00Z',
          classes: { name: 'Turma Terça', day_of_week: 2, start_time: '18:00:00' },
        },
      ],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: null }],
      subscriptions: [{ student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(getActivePlan).mockResolvedValue(PLANO)
    vi.mocked(getQuotaSnapshot).mockResolvedValue({
      limit: 8, used: 7, remaining: 1, bookingsOnDate: 0, window: { from: '2026-07-01', to: '2026-07-31' },
    })
    vi.mocked(reconcileEnrollmentCredits).mockImplementation(async (_s, _c, _f, _t, _client, budget) => {
      const bookedNow = budget === null || budget > 0 ? 1 : 0
      return { booked: bookedNow, skipped: 0, quotaSkipped: bookedNow === 1 ? 0 : 1 }
    })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    // Terça (dia 2) processa antes de Quinta (dia 4), com orçamento inicial 1.
    expect(reconcileEnrollmentCredits).toHaveBeenNthCalledWith(
      1, 'stu-1', 'tue-class', '2026-07-27', '2026-08-02', client, 1,
    )
    // Depois de reservar a terça (orçamento decrementado pra 0), a quinta recebe orçamento 0.
    expect(reconcileEnrollmentCredits).toHaveBeenNthCalledWith(
      2, 'stu-1', 'thu-class', '2026-07-27', '2026-08-02', client, 0,
    )
  })

  it('cota desligada não aplica orçamento (comportamento de hoje, sem limite)', async () => {
    const client = makeClient({
      enrollments: [{
        student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1',
        enrolled_at: '2026-01-01T00:00:00Z',
        classes: { name: 'Turma', day_of_week: 2, start_time: '18:00:00' },
      }],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: null }],
      subscriptions: [{ student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(false)
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 1, skipped: 0, quotaSkipped: 0 })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(getActivePlan).not.toHaveBeenCalled()
    expect(reconcileEnrollmentCredits).toHaveBeenCalledWith(
      'stu-1', 'class-1', '2026-07-27', '2026-08-02', client, null,
    )
  })

  it('aluno parceiro nunca recebe orçamento, mesmo com cota ligada', async () => {
    const client = makeClient({
      enrollments: [{
        student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1',
        enrolled_at: '2026-01-01T00:00:00Z',
        classes: { name: 'Turma', day_of_week: 2, start_time: '18:00:00' },
      }],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: 'wellhub' }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 1, skipped: 0, quotaSkipped: 0 })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(getActivePlan).not.toHaveBeenCalled()
    expect(reconcileEnrollmentCredits).toHaveBeenCalledWith(
      'stu-1', 'class-1', '2026-07-27', '2026-08-02', client, null,
    )
  })

  it('notifica os alunos/turmas puladas por falta de cota', async () => {
    const client = makeClient({
      enrollments: [{
        student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1',
        enrolled_at: '2026-01-01T00:00:00Z',
        classes: { name: 'Turma X', day_of_week: 2, start_time: '18:00:00' },
      }],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: null }],
      subscriptions: [{ student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(getActivePlan).mockResolvedValue({ ...PLANO, classesPerWeek: 1 })
    vi.mocked(getQuotaSnapshot).mockResolvedValue({
      limit: 4, used: 4, remaining: 0, bookingsOnDate: 0, window: { from: '2026-07-01', to: '2026-07-31' },
    })
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 0, skipped: 0, quotaSkipped: 1 })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(notifyQuotaSkips).toHaveBeenCalledWith(
      [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma X', orgId: 'org-1' }],
      client,
    )
  })
})
```

Se algum detalhe de assinatura (ex: ordem exata dos argumentos de `reconcileEnrollmentCredits`, ou o shape do stub) não bater com o que você implementar no Step 3, ajuste o teste pra refletir a implementação real — o que importa é a garantia comportamental descrita em cada teste (ordem por dia da semana, orçamento decrementando, bypass de parceiro/cota-desligada, notificação disparada), não a forma exata da chamada.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/creditReconciliation.test.ts`
Expected: FAIL — a implementação atual de `reconcileAllActiveEnrollments` ainda não agrupa por aluno nem aplica orçamento.

- [ ] **Step 3: Implementar**

Em `features/aulas/creditReconciliation.ts`, adicione os imports:

```ts
import { getActivePlan } from '@/lib/billing/planEligibility'
import { isQuotaEnforced } from './quotaSettings'
import { getQuotaSnapshot } from './quotaUsage'
import { notifyQuotaSkips, type QuotaSkip } from './quotaSkipNotify'
```

Substitua o corpo de `reconcileAllActiveEnrollments` (a partir da query de `enrollments` até o `return totals`) por:

```ts
export async function reconcileAllActiveEnrollments(
  from: string,
  to: string,
  orgId?: string,
): Promise<ReconcileResult & { processedEnrollments: number; failed: number }> {
  const adminClient = createAdminClient()

  let enrollQuery = adminClient
    .from('enrollments')
    .select('student_id, class_id, organization_id, enrolled_at, classes!inner(name, day_of_week, start_time)')
    .eq('is_active', true)
  if (orgId) enrollQuery = enrollQuery.eq('organization_id', orgId)
  const { data: enrollmentsRaw } = await enrollQuery

  type ClassInfo = { name: string; day_of_week: number; start_time: string }
  type Row = {
    student_id: string
    class_id: string
    organization_id: string
    enrolled_at: string
    classes: ClassInfo | ClassInfo[]
  }
  const enrollments = ((enrollmentsRaw ?? []) as unknown as Row[]).map((e) => {
    const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
    return {
      studentId: e.student_id,
      classId: e.class_id,
      organizationId: e.organization_id,
      enrolledAt: e.enrolled_at,
      className: cls.name,
      dayOfWeek: cls.day_of_week,
      startTime: cls.start_time,
    }
  })

  // Eixo parceiro é por-academia: indexado por user_id+organization_id.
  let membershipsQuery = adminClient
    .from('memberships')
    .select('user_id, organization_id, partner')
  if (orgId) membershipsQuery = membershipsQuery.eq('organization_id', orgId)
  const { data: membershipsRaw } = await membershipsQuery
  const partnerByMember = new Map<string, string | null>(
    (membershipsRaw ?? []).map(
      (m: { user_id: string; organization_id: string; partner: string | null }) =>
        [`${m.user_id}:${m.organization_id}`, m.partner],
    ),
  )

  // Alunos com assinatura ativa E em dia (por-academia). Assinatura MP com
  // período vencido NÃO renova créditos (spec §3.3) — volta a renovar quando
  // o webhook confirmar a cobrança do período.
  let subsQuery = adminClient
    .from('student_subscriptions')
    .select('student_id, organization_id, gateway, current_period_end')
    .eq('status', 'active')
  if (orgId) subsQuery = subsQuery.eq('organization_id', orgId)
  const { data: subsRaw } = await subsQuery
  const now = new Date()
  const activeSubStudents = new Set(
    ((subsRaw ?? []) as {
      student_id: string
      organization_id: string
      gateway: string
      current_period_end: string | null
    }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => `${s.student_id}:${s.organization_id}`),
  )

  const totals = { booked: 0, skipped: 0, quotaSkipped: 0, processedEnrollments: 0, failed: 0 }
  const skips: QuotaSkip[] = []

  // Agrupa por aluno (dentro da mesma academia) pra aplicar um orçamento de
  // cota compartilhado entre as fixas dele nesta rodada, na ordem do dia da
  // semana — quem vem mais cedo tem prioridade sobre quem vem depois.
  const byStudent = new Map<string, typeof enrollments>()
  for (const e of enrollments) {
    const memberKey = `${e.studentId}:${e.organizationId}`
    const partner = partnerByMember.get(memberKey) ?? null
    // Elegível para renovar a fixa = tem parceiro OU plano vigente. É a mesma
    // regra que enrollStudentInClass aplica na entrada (spec §2).
    const eligible = partner !== null || activeSubStudents.has(memberKey)
    if (!eligible) continue
    byStudent.set(memberKey, [...(byStudent.get(memberKey) ?? []), e])
  }

  for (const [memberKey, studentEnrollments] of byStudent) {
    const { studentId, organizationId } = studentEnrollments[0]
    const partner = partnerByMember.get(memberKey) ?? null

    // Orçamento de cota: null = sem limite (parceiro, cota desligada, ou aluno
    // sem plano ativo — este último é uma inconsistência pré-existente fora
    // do escopo, tratada aqui como "sem limite").
    let budget: number | null = null
    if (!partner && (await isQuotaEnforced(adminClient, organizationId))) {
      const plan = await getActivePlan(adminClient, studentId, organizationId)
      if (plan) {
        const snapshot = await getQuotaSnapshot(adminClient, studentId, organizationId, plan, from)
        budget = snapshot.remaining
      }
    }

    const ordered = [...studentEnrollments].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    )

    for (const e of ordered) {
      try {
        const r = await reconcileEnrollmentCredits(e.studentId, e.classId, from, to, adminClient, budget)
        totals.booked += r.booked
        totals.skipped += r.skipped
        totals.quotaSkipped += r.quotaSkipped
        totals.processedEnrollments++
        if (budget !== null) budget -= r.booked
        if (r.quotaSkipped > 0) {
          skips.push({
            studentId: e.studentId, classId: e.classId, className: e.className, orgId: e.organizationId,
          })
        }
      } catch (err) {
        totals.failed++
        console.error('[reconcileAllActiveEnrollments] matrícula falhou', {
          studentId: e.studentId, classId: e.classId, organizationId: e.organizationId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  await notifyQuotaSkips(skips, adminClient)

  return totals
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/creditReconciliation.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm run test:run`
Expected: PASS. Se algum teste de `adminActions.ts`/`financeiro/actions.ts` que exercita `reconcileEnrollmentCredits` indiretamente quebrar, é porque o stub dele não devolve as tabelas novas que `reconcileAllActiveEnrollments` agora consulta (`system_settings`/`student_subscriptions` via `isQuotaEnforced`/`getActivePlan`) — mas note que esses dois arquivos chamam `reconcileEnrollmentCredits` diretamente (não `reconcileAllActiveEnrollments`), então não deveriam ser afetados por esta task.

- [ ] **Step 7: Commit**

```bash
git add features/aulas/creditReconciliation.ts features/aulas/creditReconciliation.test.ts
git commit -m "feat(cota): reconciliacao agrupa por aluno e aplica orcamento de cota"
```

---

### Task 5: Propagar o "sem cota" até a tela de gerar grade

**Files:**
- Modify: `features/aulas/gridGeneration.ts`
- Modify: `features/aulas/gridGeneration.test.ts`
- Modify: `features/aulas/gridActions.ts`
- Modify: `features/aulas/gridActions.test.ts`
- Modify: `app/(admin)/admin/grade/GridGenerateButtons.tsx`

- [ ] **Step 1: `gridGeneration.ts` propaga `quotaSkipped`**

Troque a interface:

```ts
export interface GenerateGridResult {
  /** Sessões efetivamente inseridas nesta chamada — não conta as que já existiam e foram puladas pelo upsert idempotente. */
  sessionsCreated: number
  studentsBooked: number
  /** Alunos fixos que ficaram sem vínculo nesta rodada por falta de cota. */
  quotaSkipped: number
  /** Presente quando o upsert de class_sessions falhou — chamador não deve tratar como sucesso. */
  error?: string
}
```

E os três `return` do corpo de `generateGrid`:

```ts
  if (classes.length === 0) return { sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0 }
```

```ts
    if (upsertErr) {
      console.error('[generateGrid] upsert de class_sessions falhou', {
        orgId, from, to, error: upsertErr.message,
      })
      return { sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0, error: upsertErr.message }
    }
```

```ts
  const rec = await reconcileAllActiveEnrollments(from, to, orgId)

  return { sessionsCreated, studentsBooked: rec.booked, quotaSkipped: rec.quotaSkipped }
```

- [ ] **Step 2: Atualizar `gridGeneration.test.ts`**

No mock do topo, acrescente `quotaSkipped: 0`:

```ts
vi.mock('./creditReconciliation', () => ({
  reconcileAllActiveEnrollments: vi.fn().mockResolvedValue({
    booked: 3, skipped: 0, quotaSkipped: 0, processedEnrollments: 3, failed: 0,
  }),
}))
```

No teste "quando o upsert de class_sessions falha", ajuste o `toEqual`:

```ts
    expect(r).toEqual({ sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0, error: 'upsert boom' })
```

- [ ] **Step 3: Rodar `gridGeneration.test.ts`**

Run: `npm run test:run -- features/aulas/gridGeneration.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 4: `gridActions.ts` propaga `semCota`**

Troque a interface:

```ts
interface GridActionResult {
  error?: string
  sessionsCreated?: number
  // reservados/aConfirmar/semPlano/semCota ficam em pt-BR de propósito: são o
  // shape direto do texto exibido ao admin (Task 7 do plano original / Task 5
  // deste), diferente do inglês interno de enrollmentRoster.ts.
  reservados?: number
  aConfirmar?: number
  semPlano?: number
  semCota?: number
}
```

`finishGeneration` ganha um parâmetro novo:

```ts
async function finishGeneration(
  orgId: string,
  sessionsCreated: number,
  quotaSkipped: number,
  rosterOpts: { dayOfWeek?: number },
  notifyScope: { kind: 'week' } | { kind: 'day'; dayOfWeek: number },
): Promise<GridActionResult> {
  const roster = await getRosterSafe(orgId, rosterOpts)
  if (sessionsCreated > 0) await notifyGridGenerated(orgId, notifyScope)

  revalidatePath('/admin/grade')
  return {
    sessionsCreated,
    reservados: roster.totals.eligible,
    aConfirmar: roster.totals.pendingConfirmation,
    semPlano: roster.totals.noPlan,
    semCota: quotaSkipped,
  }
}
```

E os dois call sites:

```ts
  return finishGeneration(orgId, r.sessionsCreated, r.quotaSkipped, { dayOfWeek }, { kind: 'day', dayOfWeek })
```

```ts
  return finishGeneration(orgId, r.sessionsCreated, r.quotaSkipped, {}, { kind: 'week' })
```

- [ ] **Step 5: Atualizar `gridActions.test.ts`**

Substitua o arquivo inteiro por (só os `mockResolvedValue`/`toEqual` ganharam os campos novos; o resto é idêntico):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('./authGuards', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('./gridGeneration', () => ({
  generateGrid: vi.fn(),
}))

vi.mock('./enrollmentRoster', () => ({
  getClassRoster: vi.fn(),
}))

vi.mock('./gridNotify', () => ({
  notifyGridGenerated: vi.fn(),
}))

import { generateGridDay, generateGridWeek } from './gridActions'
import { requireAdmin } from './authGuards'
import { generateGrid } from './gridGeneration'
import { getClassRoster, type Roster } from './enrollmentRoster'
import { notifyGridGenerated } from './gridNotify'

const SAMPLE_ROSTER: Roster = {
  byClass: new Map(),
  totals: { enrolled: 10, eligible: 6, pendingConfirmation: 3, noPlan: 1 },
}

describe('generateGridDay / generateGridWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'user-1', orgId: 'org-1' })
    vi.mocked(getClassRoster).mockResolvedValue(SAMPLE_ROSTER)
    vi.mocked(notifyGridGenerated).mockResolvedValue(undefined)
  })

  it('erro do generateGrid interrompe antes do roster e do notify', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0, error: 'boom' })

    const result = await generateGridWeek()

    expect(result).toEqual({ error: 'boom' })
    expect(getClassRoster).not.toHaveBeenCalled()
    expect(notifyGridGenerated).not.toHaveBeenCalled()
  })

  it('nao notifica quando sessionsCreated=0, mas ainda calcula e retorna o roster', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0 })

    const result = await generateGridDay(2)

    expect(notifyGridGenerated).not.toHaveBeenCalled()
    expect(getClassRoster).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      sessionsCreated: 0,
      reservados: 6,
      aConfirmar: 3,
      semPlano: 1,
      semCota: 0,
    })
  })

  it('notifica com escopo "day" (e roster escopado ao dia) quando generateGridDay cria sessões novas', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 2, studentsBooked: 5, quotaSkipped: 1 })

    const result = await generateGridDay(3)

    expect(getClassRoster).toHaveBeenCalledWith(expect.anything(), 'org-1', { dayOfWeek: 3 })
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'day', dayOfWeek: 3 })
    expect(result.semCota).toBe(1)
  })

  it('notifica com escopo "week" quando generateGridWeek cria sessões novas', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 4, studentsBooked: 9, quotaSkipped: 0 })

    await generateGridWeek()

    expect(getClassRoster).toHaveBeenCalledWith(expect.anything(), 'org-1', {})
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'week' })
  })

  it('falha do getClassRoster degrada para zeros em vez de rejeitar, e ainda assim notifica', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 1, studentsBooked: 1, quotaSkipped: 0 })
    vi.mocked(getClassRoster).mockRejectedValue(new Error('roster boom'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await generateGridWeek()

    expect(result).toEqual({
      sessionsCreated: 1,
      reservados: 0,
      aConfirmar: 0,
      semPlano: 0,
      semCota: 0,
    })
    // A falha do roster não pode bloquear o push: sessionsCreated>0 ainda notifica.
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'week' })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[gridActions] getClassRoster falhou',
      expect.objectContaining({ orgId: 'org-1' }),
    )
  })
})
```

- [ ] **Step 6: Rodar `gridActions.test.ts`**

Run: `npm run test:run -- features/aulas/gridActions.test.ts`
Expected: PASS — 5 testes.

- [ ] **Step 7: `GridGenerateButtons.tsx` mostra "N sem cota"**

Troque `feedback()`:

```ts
function feedback(r: {
  error?: string
  sessionsCreated?: number
  reservados?: number
  aConfirmar?: number
  semPlano?: number
  semCota?: number
}): string {
  if (r.error) return `Erro: ${r.error}`
  const parts = [`${r.sessionsCreated ?? 0} sessões`, `${r.reservados ?? 0} reservados`]
  if ((r.aConfirmar ?? 0) > 0) parts.push(`${r.aConfirmar} a confirmar`)
  if ((r.semPlano ?? 0) > 0) parts.push(`${r.semPlano} sem plano`)
  if ((r.semCota ?? 0) > 0) parts.push(`${r.semCota} sem cota`)
  return parts.join(' · ')
}
```

Não há arquivo de teste para este componente (nenhum dos botões de grade tem hoje) — segue a convenção existente.

- [ ] **Step 8: Rodar a suíte inteira e type-check**

Run: `npm run test:run`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: nenhum erro novo além dos pré-existentes (`lib/branding/*.test.ts`, `lib/torneios/schedule/americano.test.ts`, `types/index.test.ts`).

- [ ] **Step 9: Verificar no navegador (se possível)**

Com `preview_start` (nunca Bash), navegue a `/admin/grade`, clique em "Gerar semana", confirme com `read_page` que o resumo aparece (mesmo que "0 sem cota" na maioria dos casos, já que exige um cenário real de cota estourada pra aparecer diferente de zero). Se esbarrar em tela de login ou o preview não renderizar (já aconteceu nas últimas tasks de UI deste projeto), pule esta etapa e confie em `tsc` + suíte de testes.

- [ ] **Step 10: Commit**

```bash
git add features/aulas/gridGeneration.ts features/aulas/gridGeneration.test.ts features/aulas/gridActions.ts features/aulas/gridActions.test.ts "app/(admin)/admin/grade/GridGenerateButtons.tsx"
git commit -m "feat(cota): mostra quantos alunos ficaram sem cota ao gerar a grade"
```

---

### Task 6: Verificação final

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte inteira**

Run: `npm run test:run`
Expected: PASS — todos os testes, incluindo os ~15 novos deste plano.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo além dos 4 arquivos pré-existentes já documentados nos planos anteriores.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem warnings novos (se falhar por completo com conflito de plugin `@next/next` — problema de ambiente já visto em tasks anteriores, não bloqueia).

- [ ] **Step 4: Revisão manual do fluxo ponta a ponta**

Releia `reconcileAllActiveEnrollments` e confirme, com um exemplo à mão (aluno 2x/semana, terça e quinta, cota ligada, `remaining=1` no início da geração): a terça é processada primeiro (dia 2 < dia 4), reserva e decrementa o orçamento pra 0; a quinta recebe orçamento 0, não reserva, conta em `quotaSkipped`, e entra na lista notificada. Confirme que isso bate com o design (spec, seção "Fluxo de dados").

- [ ] **Step 5: Nenhum commit nesta task** — é só checagem.

---

## Fora deste plano

- Log persistido de gerações passadas (mantém o padrão efêmero já usado hoje).
- Aluno sem plano ativo e sem parceiro mas ainda com matrícula fixa (inconsistência pré-existente, fora do escopo).
- Qualquer mudança em `addStudentToSession` (admin adicionando aluno avulso numa sessão) — continua furando a cota, como sempre.
