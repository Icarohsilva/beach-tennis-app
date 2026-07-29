# Ajustes de cota pós-lançamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três ajustes relatados depois do lançamento da cota compartilhada: rótulo do dashboard, um bug de fim de mês na matrícula fixa, e o admin passando a respeitar cota/teto diário ao adicionar aluno manualmente (com um jeito de forçar).

**Architecture:** Task 1 é só rearranjo de UI. Task 2 fecha uma inconsistência que a própria cota compartilhada introduziu: `enrollStudentInClass` reserva o resto do mês sem orçamento de cota, diferente da geração semanal (que já respeita). Task 3 estende `resolveClassAccess`'s eixo de cota pra `addStudentToSession`, com uma segunda chamada (`force: true`) pra o admin furar deliberadamente.

**Tech Stack:** TypeScript · Next.js 14 App Router · Supabase · Vitest

**Spec:** [`docs/superpowers/specs/2026-07-29-ajustes-cota-pos-lancamento-design.md`](../specs/2026-07-29-ajustes-cota-pos-lancamento-design.md)

---

## Ambiente

Rode os testes com a ferramenta **PowerShell**, não Bash — `vitest` via Bash falha aleatoriamente neste ambiente com `"config" undefined`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `app/(dashboard)/home/page.tsx` (mod) | Stat "Nesta semana" vira a cota mensal; remove o card duplicado |
| `features/aulas/adminActions.ts` (mod) | `enrollStudentInClass` passa orçamento de cota; `addStudentToSession` respeita cota/teto diário com `force` |
| `features/aulas/adminActions.test.ts` (mod) | Testes dos dois pontos acima |
| `features/aulas/AddStudentToSession.tsx` (mod) | Botão "Adicionar mesmo assim" quando bloqueado por cota |

---

### Task 1: Dashboard — "Nesta semana" vira a cota mensal

**Files:**
- Modify: `app/(dashboard)/home/page.tsx`

- [ ] **Step 1: Ler o estado atual**

Run: `Select-String -Path "app/(dashboard)/home/page.tsx" -Pattern "Nesta semana|Aulas do plano" -Context 5,10`
Expected: confirmar que o `stats` do `HeroHeader` tem `{ label: 'Nesta semana', value: mySessions.length }`, e que logo abaixo existe um bloco `{quota && (<Reveal step={1}>...</Reveal>)}` com o card "Aulas do plano ... X de Y". Se algo mudou desde este plano ter sido escrito, adapte os próximos steps ao que você encontrar.

- [ ] **Step 2: Trocar o stat**

Troque:

```jsx
              ...(showCredits
                ? [{ label: 'Créditos', value: membership?.credits_balance ?? 0 }]
                : [{ label: 'Plano', value: membership?.partner === 'wellhub' ? 'Wellhub' : 'TotalPass' }]),
              { label: 'Aulas/semana', value: weeklyClassesCount ?? 0 },
              { label: 'Nesta semana', value: mySessions.length },
            ]}
```

por:

```jsx
              ...(showCredits
                ? [{ label: 'Créditos', value: membership?.credits_balance ?? 0 }]
                : [{ label: 'Plano', value: membership?.partner === 'wellhub' ? 'Wellhub' : 'TotalPass' }]),
              { label: 'Aulas/semana', value: weeklyClassesCount ?? 0 },
              ...(quota
                ? [{
                    label: `Aulas do plano ${plan?.cycle === 'weekly' ? 'nesta semana' : 'neste mês'}`,
                    value: `${quota.used}/${quota.limit}`,
                  }]
                : []),
            ]}
```

- [ ] **Step 3: Remover o card duplicado e manter só o aviso de cota esgotada**

Troque:

```jsx
      {quota && (
        <Reveal step={1}>
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
        </Reveal>
      )}
```

por:

```jsx
      {quota?.remaining === 0 && (
        <Reveal step={1}>
          <p className="text-xs text-brand-400 -mt-2">
            Cota esgotada. Cancele uma aula futura ou compre uma avulsa.
          </p>
        </Reveal>
      )}
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo.

Run: `npm run test:run`
Expected: PASS — sem regressão (este arquivo não tem teste próprio).

- [ ] **Step 5: Verificar no navegador (se possível)**

Com `preview_start` (nunca Bash), navegue a `/home` como aluno com plano ativo e cota ligada, confirme com `read_page` que o header mostra "Aulas do plano neste mês: X/Y" no lugar de "Nesta semana", e que não há mais um card separado repetindo a mesma informação. Se esbarrar em tela de login sem credenciais disponíveis, pule esta etapa e confie em `tsc` + revisão de código.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/home/page.tsx"
git commit -m "feat(cota): mostra a cota mensal no lugar de nesta semana no dashboard"
```

---

### Task 2: `enrollStudentInClass` respeita a cota compartilhada

**Files:**
- Modify: `features/aulas/adminActions.ts:145-149`
- Modify: `features/aulas/adminActions.test.ts`

**O bug:** depois de criar a matrícula, `enrollStudentInClass` chama `reconcileEnrollmentCredits(studentId, classId, today, monthEnd)` sem orçamento — reserva tudo até o fim do mês incondicionalmente, ignorando quanto da cota mensal o aluno já usou. A geração semanal automática (`reconcileAllActiveEnrollments`, em `features/aulas/creditReconciliation.ts`) já resolve isso computando um orçamento (`isQuotaEnforced` + `getActivePlan` + `getQuotaSnapshot`) antes de reconciliar — essa chamada de matrícula nunca foi atualizada pra fazer o mesmo.

- [ ] **Step 1: Escrever o teste que falha**

Primeiro, adicione o mock de `reconcileEnrollmentCredits` no topo de `features/aulas/adminActions.test.ts` (isso NÃO muda o comportamento dos testes existentes de `enrollStudentInClass — cota de fixas`, que já não faziam asserções sobre reconciliação — só torna explícito o que antes era um no-op silencioso via stub vazio):

```ts
vi.mock('./reconcileEnrollment', () => ({
  reconcileEnrollmentCredits: vi.fn().mockResolvedValue({ booked: 0, skipped: 0, quotaSkipped: 0 }),
}))
```

Acrescente ao import de `./adminActions` (ou num import próprio) a função mockada:

```ts
import { reconcileEnrollmentCredits } from './reconcileEnrollment'
```

Estenda `makeEnrollClient` (a assinatura de `opts` e o `then` do builder) pra aceitar reservas existentes, usadas pelo cálculo de cota:

```ts
function makeEnrollClient(opts: {
  plan: PlanQuota
  activeEnrollments: number
  quotaEnforced: boolean
  maxStudents?: number
  sessionBookings?: {
    status: string
    cancelled_at: string | null
    class_sessions: { session_date: string; classes: { start_time: string } }
  }[]
}) {
```

E no `then` do builder, troque:

```ts
      then: (resolve: (v: { data: unknown; error: unknown; count?: number }) => void) => {
        const data =
          table === 'enrollments'
            ? Array.from({ length: opts.activeEnrollments }, (_, i) => ({
                class_id: `outra-turma-${i}`,
              }))
            : []
        return Promise.resolve({ data, error: null }).then(resolve)
      },
```

por:

```ts
      then: (resolve: (v: { data: unknown; error: unknown; count?: number }) => void) => {
        const data =
          table === 'enrollments'
            ? Array.from({ length: opts.activeEnrollments }, (_, i) => ({
                class_id: `outra-turma-${i}`,
              }))
            : table === 'session_bookings'
              ? (opts.sessionBookings ?? [])
              : []
        return Promise.resolve({ data, error: null }).then(resolve)
      },
```

Acrescente ao fim do arquivo (novo describe, depois de `enrollStudentInClass — cota de fixas`):

```ts
describe('enrollStudentInClass — orçamento de cota na reconciliação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00-03:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passa o orçamento restante da cota pra reconciliação, em vez de reservar sem limite', async () => {
    const planoSemanal: PlanQuota = {
      classesPerWeek: 1, cycle: 'weekly', maxClassesPerDay: 2, refundOnLateCancel: true,
    }
    const client = makeEnrollClient({
      plan: planoSemanal,
      activeEnrollments: 0,
      quotaEnforced: true,
      // Semana de 13 a 19/07 (segunda a domingo, já que 15/07/2026 é quarta).
      // Plano 1x/semana → limite 1. Já tem 1 confirmada nessa semana → sobra 0.
      sessionBookings: [
        {
          status: 'confirmed',
          cancelled_at: null,
          class_sessions: { session_date: '2026-07-14', classes: { start_time: '18:00:00' } },
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await enrollStudentInClass('stu-1', 'class-2')

    expect(reconcileEnrollmentCredits).toHaveBeenCalledWith(
      'stu-1', 'class-2', '2026-07-15', '2026-07-31', client, 0,
    )
  })

  it('cota desligada continua reservando sem limite (comportamento de hoje)', async () => {
    const plano: PlanQuota = {
      classesPerWeek: 1, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true,
    }
    const client = makeEnrollClient({
      plan: plano,
      activeEnrollments: 0,
      quotaEnforced: false,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await enrollStudentInClass('stu-1', 'class-2')

    expect(reconcileEnrollmentCredits).toHaveBeenCalledWith(
      'stu-1', 'class-2', '2026-07-15', '2026-07-31', client, null,
    )
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/adminActions.test.ts`
Expected: FAIL — o primeiro teste novo espera `reconcileEnrollmentCredits` chamado com `0` de orçamento, mas a implementação atual chama sem o 6º argumento (`undefined`, que o mock não distingue do `null` esperado — **verifique isto especificamente**: se o teste passar "sem querer" antes da implementação, é porque `toHaveBeenCalledWith` trata `undefined` como incompatível com `0`, então deve mesmo falhar; se por algum motivo passar, pare e avise, não prossiga cegamente).

- [ ] **Step 3: Implementar**

Em `features/aulas/adminActions.ts`, troque:

```ts
  // Reserva as sessões restantes do mês para esta turma. Não consome crédito:
  // quem chega aqui tem plano ou parceiro (spec §3).
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')
  await reconcileEnrollmentCredits(studentId, classId, today, monthEnd)
```

por:

```ts
  // Reserva as sessões restantes do mês para esta turma. Não consome crédito:
  // quem chega aqui tem plano ou parceiro (spec §3). Respeita a cota
  // compartilhada — mesma lógica de features/aulas/creditReconciliation.ts
  // (se mudar uma, mude a outra): sem isso, matricular perto do fim do mês
  // reservava tudo até o fim incondicionalmente, ignorando quanto da cota
  // mensal o aluno já tinha usado.
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')

  const partnerForBudget = (membership as { partner: string | null }).partner
  let quotaBudget: number | null = null
  if (!partnerForBudget && (await isQuotaEnforced(adminClient, orgId))) {
    const activePlan = await getActivePlan(adminClient, studentId, orgId)
    if (activePlan) {
      const snapshot = await getQuotaSnapshot(adminClient, studentId, orgId, activePlan, today)
      quotaBudget = snapshot.remaining
    }
  }

  await reconcileEnrollmentCredits(studentId, classId, today, monthEnd, adminClient, quotaBudget)
```

Adicione o import no topo do arquivo:

```ts
import { getQuotaSnapshot } from './quotaUsage'
```

(`getActivePlan` e `isQuotaEnforced` já estão importados nesse arquivo.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/adminActions.test.ts`
Expected: PASS — todos os testes do arquivo, incluindo os 2 novos.

- [ ] **Step 5: Type-check e suíte inteira**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo.

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/aulas/adminActions.ts features/aulas/adminActions.test.ts
git commit -m "fix(cota): matricula fixa perto do fim do mes respeita a cota ja usada"
```

---

### Task 3: `addStudentToSession` respeita cota/teto diário, com botão de forçar

**Files:**
- Modify: `features/aulas/adminActions.ts:570-701`
- Modify: `features/aulas/adminActions.test.ts`
- Modify: `features/aulas/AddStudentToSession.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao topo de `features/aulas/adminActions.test.ts`, junto dos outros imports de `./adminActions`:

```ts
import { addStudentToSession } from './adminActions'
```

Acrescente ao fim do arquivo:

```ts
/**
 * Stub escopado ao que addStudentToSession consulta: a sessão (com a data,
 * pro cálculo de cota), a membership do aluno, o plano ativo dele
 * (student_subscriptions), as duas chaves de system_settings (cota ligada e
 * teto diário — o stub não distingue qual chave foi pedida, então sempre
 * devolve `quotaEnforced`; isso é seguro pros testes deste plano porque
 * sempre há um `plan` com `maxClassesPerDay` próprio, que sempre vence o
 * default da academia), e as reservas existentes do aluno (pro cálculo de
 * cota/teto diário via getQuotaSnapshot).
 */
function makeAddStudentClient(opts: {
  session: { id: string; status: string; session_date: string; max_students: number }
  membership: { partner: string | null; credits_balance: number }
  plan: PlanQuota | null
  quotaEnforced: boolean
  sessionBookings?: {
    status: string
    cancelled_at: string | null
    class_sessions: { session_date: string; classes: { start_time: string } }
  }[]
  bookRpcError?: { message: string } | null
}) {
  const rpc = vi.fn((fn: string) => {
    if (fn === 'book_session_atomic') return Promise.resolve({ error: opts.bookRpcError ?? null })
    return Promise.resolve({ error: null, data: null })
  })

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      in: () => builder,
      single: () => {
        if (table === 'class_sessions') {
          return Promise.resolve({
            data: {
              id: opts.session.id,
              status: opts.session.status,
              session_date: opts.session.session_date,
              class: { max_students: opts.session.max_students },
            },
          })
        }
        return Promise.resolve({ data: null })
      },
      maybeSingle: () => {
        if (table === 'memberships') return Promise.resolve({ data: opts.membership })
        if (table === 'system_settings') {
          return Promise.resolve({ data: { value: String(opts.quotaEnforced) } })
        }
        if (table === 'student_subscriptions') {
          if (!opts.plan) return Promise.resolve({ data: null })
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
      then: (resolve: (v: { data: unknown }) => void) => {
        const data =
          table === 'session_bookings' ? (opts.sessionBookings ?? []) : []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })

  return { client: { from, rpc } as never, rpc }
}

describe('addStudentToSession — cota e teto diário', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN)
  })

  it('bloqueia sem force quando o teto diário já foi atingido, e libera com force', async () => {
    const plano: PlanQuota = {
      classesPerWeek: 2, cycle: 'weekly', maxClassesPerDay: 2, refundOnLateCancel: true,
    }
    const { client, rpc } = makeAddStudentClient({
      session: { id: 'session-1', status: 'scheduled', session_date: '2026-07-15', max_students: 10 },
      membership: { partner: null, credits_balance: 0 },
      plan: plano,
      quotaEnforced: true,
      sessionBookings: [
        {
          status: 'confirmed', cancelled_at: null,
          class_sessions: { session_date: '2026-07-15', classes: { start_time: '10:00:00' } },
        },
        {
          status: 'confirmed', cancelled_at: null,
          class_sessions: { session_date: '2026-07-15', classes: { start_time: '14:00:00' } },
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const blocked = await addStudentToSession('session-1', 'stu-1', 'open')
    expect(blocked.quotaBlocked).toBe(true)
    expect(blocked.error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()

    const forced = await addStudentToSession('session-1', 'stu-1', 'open', true)
    expect(forced.error).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith(
      'book_session_atomic',
      expect.objectContaining({ p_student_id: 'stu-1', p_session_id: 'session-1' }),
    )
  })

  it('bloqueia sem force quando a cota do ciclo está esgotada, e libera com force', async () => {
    const plano: PlanQuota = {
      classesPerWeek: 1, cycle: 'weekly', maxClassesPerDay: 2, refundOnLateCancel: true,
    }
    const { client, rpc } = makeAddStudentClient({
      session: { id: 'session-1', status: 'scheduled', session_date: '2026-07-15', max_students: 10 },
      membership: { partner: null, credits_balance: 0 },
      plan: plano,
      quotaEnforced: true,
      // Semana de 13 a 19/07. Limite 1x/semana = 1. Já usou em outro dia da
      // mesma semana (13/07) — o teto diário do dia 15 continua livre (0).
      sessionBookings: [
        {
          status: 'confirmed', cancelled_at: null,
          class_sessions: { session_date: '2026-07-13', classes: { start_time: '09:00:00' } },
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const blocked = await addStudentToSession('session-1', 'stu-1', 'open')
    expect(blocked.quotaBlocked).toBe(true)
    expect(blocked.error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()

    const forced = await addStudentToSession('session-1', 'stu-1', 'open', true)
    expect(forced.error).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith(
      'book_session_atomic',
      expect.objectContaining({ p_student_id: 'stu-1', p_session_id: 'session-1' }),
    )
  })

  it('cota desligada não bloqueia (comportamento de hoje)', async () => {
    const plano: PlanQuota = {
      classesPerWeek: 1, cycle: 'weekly', maxClassesPerDay: 1, refundOnLateCancel: true,
    }
    const { client, rpc } = makeAddStudentClient({
      session: { id: 'session-1', status: 'scheduled', session_date: '2026-07-15', max_students: 10 },
      membership: { partner: null, credits_balance: 0 },
      plan: plano,
      quotaEnforced: false,
      sessionBookings: [
        {
          status: 'confirmed', cancelled_at: null,
          class_sessions: { session_date: '2026-07-15', classes: { start_time: '10:00:00' } },
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await addStudentToSession('session-1', 'stu-1', 'open')
    expect(result.error).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith(
      'book_session_atomic',
      expect.objectContaining({ p_student_id: 'stu-1', p_session_id: 'session-1' }),
    )
  })
})
```

Importe `PlanQuota` já está importado no topo do arquivo (usado por `makeEnrollClient`); reaproveite.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- features/aulas/adminActions.test.ts`
Expected: FAIL — os 3 testes novos falham (hoje `addStudentToSession` sempre libera, nunca bloqueia por cota, e a assinatura não aceita `force`).

- [ ] **Step 3: Implementar em `addStudentToSession`**

Em `features/aulas/adminActions.ts`, troque a assinatura da função:

```ts
export async function addStudentToSession(
  sessionId: string,
  studentId: string,
  reason: AddStudentReason,
): Promise<{ error?: string }> {
```

por:

```ts
export async function addStudentToSession(
  sessionId: string,
  studentId: string,
  reason: AddStudentReason,
  force = false,
): Promise<{ error?: string; quotaBlocked?: boolean }> {
```

Troque a query da sessão pra incluir `session_date`:

```ts
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()
```

por:

```ts
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, session_date, class:classes(max_students)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()
```

Depois do `if ((session as { status: string }).status !== 'scheduled') { ... }`, adicione:

```ts
  const sessionDate = (session as { session_date: string }).session_date
```

Troque:

```ts
  const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, studentId, orgId)

  // Note o hasOpenDebt: false — o admin ignora o bloqueio (ver doc acima). Pela
  // mesma razão o admin também ignora a cota e o teto diário (spec de cota
  // §5, "addStudentToSession: inalterado"): quotaEnforced: false desliga todo
  // o eixo em resolveClassAccess, então os demais campos de cota nunca são
  // lidos — os valores abaixo só existem para satisfazer o tipo.
  const decision = resolveClassAccess({
    partner: mem.partner as CheckinPartner | null,
    hasActivePlan,
    creditsBalance: mem.credits_balance,
    hasOpenDebt: false,
    quotaEnforced: false,
    quotaRemaining: null,
    bookingsOnDate: 0,
    maxClassesPerDay: Infinity,
  })

  // 'denied' é inalcançável com hasOpenDebt: false, mas o TypeScript não sabe.
  if ('denied' in decision) return { error: 'Não foi possível adicionar o aluno.' }

  const useCredit = decision.grant === 'credit'
```

por:

```ts
  const plan = await getActivePlan(adminClient, studentId, orgId)
  const hasActivePlan = plan !== null

  // Dívida continua sempre furada pelo admin (hasOpenDebt: false) — isso não
  // muda. Cota e teto diário agora valem de verdade; com force: true o admin
  // fura especificamente essa negação (spec de ajustes pós-lançamento §3).
  const quotaEnforced = await isQuotaEnforced(adminClient, orgId)
  const orgDailyCap = await getOrgMaxClassesPerDay(adminClient, orgId)
  const snapshot =
    quotaEnforced && plan
      ? await getQuotaSnapshot(adminClient, studentId, orgId, plan, sessionDate)
      : null

  const decision = resolveClassAccess({
    partner: mem.partner as CheckinPartner | null,
    hasActivePlan,
    creditsBalance: mem.credits_balance,
    hasOpenDebt: false,
    quotaEnforced,
    quotaRemaining: snapshot?.remaining ?? null,
    bookingsOnDate: snapshot?.bookingsOnDate ?? 0,
    maxClassesPerDay: plan?.maxClassesPerDay ?? orgDailyCap,
  })

  if ('denied' in decision) {
    // Só 'daily_cap'/'quota_exhausted' são alcançáveis (hasOpenDebt é sempre
    // false, então 'blocked_by_debt' nunca aparece aqui).
    if (!force) {
      const teto = plan?.maxClassesPerDay ?? orgDailyCap
      const message =
        decision.denied === 'daily_cap'
          ? `Esse aluno já tem ${teto} aulas neste dia — é o limite do plano dele.`
          : `Esse aluno já usou toda a cota do plano ${plan?.cycle === 'weekly' ? 'desta semana' : 'deste mês'}.`
      return { error: message, quotaBlocked: true }
    }
    // force: true — segue o fluxo normal abaixo, sem grant (não debita crédito).
  }

  const useCredit = 'grant' in decision && decision.grant === 'credit'
```

Mais abaixo, troque:

```ts
  // Pré-declaração. Só para quem não tem plano/parceiro/crédito — para os outros
  // a aula já está paga e gravar payments aqui seria cobrança dupla.
  if (decision.grant === 'debt' && reason !== 'open') {
```

por:

```ts
  // Pré-declaração. Só para quem não tem plano/parceiro/crédito — para os outros
  // a aula já está paga e gravar payments aqui seria cobrança dupla.
  if ('grant' in decision && decision.grant === 'debt' && reason !== 'open') {
```

Adicione os imports no topo do arquivo:

```ts
import { isQuotaEnforced, getOrgMaxClassesPerDay } from './quotaSettings'
import { getQuotaSnapshot } from './quotaUsage'
```

(`isQuotaEnforced` já está importado — só acrescente `getOrgMaxClassesPerDay` ao mesmo import. `getQuotaSnapshot` já foi importado na Task 2 deste plano — não duplique a linha, só confirme que já está lá.)

**Não remova** `hasActiveSubscriptionPlan` do import — ainda é usado em `enrollStudentInClass`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- features/aulas/adminActions.test.ts`
Expected: PASS — todos os testes do arquivo.

- [ ] **Step 5: Atualizar a UI**

Em `features/aulas/AddStudentToSession.tsx`, troque a interface `Props`:

```ts
interface Props {
  sessionId: string
  students: AddableStudent[]
  onAdd: (
    sessionId: string,
    studentId: string,
    reason: AddStudentReason,
  ) => Promise<{ error?: string }>
}
```

por:

```ts
interface Props {
  sessionId: string
  students: AddableStudent[]
  onAdd: (
    sessionId: string,
    studentId: string,
    reason: AddStudentReason,
    force?: boolean,
  ) => Promise<{ error?: string; quotaBlocked?: boolean }>
}
```

Troque o corpo do componente (estado e `handleAdd`):

```ts
export function AddStudentToSession({ sessionId, students, onAdd }: Props) {
  const [studentId, setStudentId] = useState('')
  const [reason, setReason] = useState<AddStudentReason>('experimental')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const selected = students.find((s) => s.id === studentId)
  // O motivo só faz sentido para quem entraria devendo. Quem tem plano, parceiro
  // ou crédito já tem a aula paga — perguntar seria ruído (spec §6).
  const needsReason = selected?.wouldOweDebt ?? false

  function handleSelectStudent(id: string) {
    setStudentId(id)
    setReason('experimental')
  }

  function handleAdd() {
    if (!studentId) return
    setError(null)
    startTransition(async () => {
      const result = await onAdd(sessionId, studentId, needsReason ? reason : 'open')
      if (result.error) setError(result.error)
      else {
        setStudentId('')
        setReason('experimental')
      }
    })
  }
```

por:

```ts
export function AddStudentToSession({ sessionId, students, onAdd }: Props) {
  const [studentId, setStudentId] = useState('')
  const [reason, setReason] = useState<AddStudentReason>('experimental')
  const [error, setError] = useState<string | null>(null)
  const [quotaBlocked, setQuotaBlocked] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selected = students.find((s) => s.id === studentId)
  // O motivo só faz sentido para quem entraria devendo. Quem tem plano, parceiro
  // ou crédito já tem a aula paga — perguntar seria ruído (spec §6).
  const needsReason = selected?.wouldOweDebt ?? false

  function handleSelectStudent(id: string) {
    setStudentId(id)
    setReason('experimental')
    setError(null)
    setQuotaBlocked(false)
  }

  function handleAdd(force = false) {
    if (!studentId) return
    setError(null)
    startTransition(async () => {
      const result = await onAdd(sessionId, studentId, needsReason ? reason : 'open', force)
      if (result.error) {
        setError(result.error)
        setQuotaBlocked(!!result.quotaBlocked)
      } else {
        setStudentId('')
        setReason('experimental')
        setQuotaBlocked(false)
      }
    })
  }
```

Por fim, troque o botão de adicionar:

```jsx
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      <Button
        size="sm"
        loading={isPending}
        disabled={!studentId || isPending}
        onClick={handleAdd}
        className="w-full"
      >
        Adicionar à aula
      </Button>
```

por:

```jsx
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      {quotaBlocked ? (
        <Button
          size="sm"
          variant="danger"
          loading={isPending}
          onClick={() => handleAdd(true)}
          className="w-full"
        >
          Adicionar mesmo assim
        </Button>
      ) : (
        <Button
          size="sm"
          loading={isPending}
          disabled={!studentId || isPending}
          onClick={() => handleAdd(false)}
          className="w-full"
        >
          Adicionar à aula
        </Button>
      )}
```

- [ ] **Step 6: Type-check e suíte inteira**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo além dos pré-existentes já documentados (branding/torneios/types test files).

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 7: Verificar no navegador (se possível)**

Com `preview_start` (nunca Bash), navegue a `/admin/grade/[sessionId]` de uma sessão real, com um aluno que já esgotou a cota. Tente adicionar — confirme com `read_page` que aparece a mensagem de bloqueio e o botão "Adicionar mesmo assim", e que clicar nele efetivamente adiciona o aluno. Se esbarrar em tela de login sem credenciais disponíveis, pule esta etapa e confie em `tsc` + testes.

- [ ] **Step 8: Commit**

```bash
git add features/aulas/adminActions.ts features/aulas/adminActions.test.ts features/aulas/AddStudentToSession.tsx
git commit -m "feat(cota): admin respeita cota e teto diario ao adicionar aluno, com opcao de forcar"
```

---

### Task 4: Verificação final

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte inteira**

Run: `npm run test:run`
Expected: PASS — todos os testes, incluindo os novos deste plano.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo além dos 4 arquivos pré-existentes já documentados nos planos anteriores.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem warnings novos.

- [ ] **Step 4: Revisão manual**

Releia `enrollStudentInClass` e `addStudentToSession` lado a lado e confirme que o cálculo de orçamento/cota nos dois bate com o que `reconcileAllActiveEnrollments` (em `creditReconciliation.ts`) já faz — mesmos quatro insumos (parceiro, cota ligada, plano ativo, retrato da cota), mesma prioridade (parceiro/cota desligada/sem plano → sem limite).

- [ ] **Step 5: Nenhum commit nesta task** — é só checagem.

---

## Fora deste plano

- Qualquer mudança em `bookSession` (o aluno reservando por conta própria) — já respeita a cota desde o plano original, inalterado aqui.
- Bloqueio por dívida em `addStudentToSession` — continua sempre furado pelo admin, sem botão de forçar (nunca foi bloqueado).
- Log/histórico de quando o admin usa `force: true` — não foi pedido; se quiser auditoria disso depois, é um plano à parte.
