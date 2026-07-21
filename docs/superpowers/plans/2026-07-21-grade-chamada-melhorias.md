# Melhorias de Grade & Chamada + Push de geração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar a Grade & Chamada do admin clara (status do aluno, números, gestão de alunos, info de geração) e disparar push por academia ao gerar a grade.

**Architecture:** Um helper puro classifica o status do aluno (elegível/a confirmar/sem plano). Um helper de roster (query) reusa isso na grade, no editar-turma, no feedback do "Gerar" e no chamada. `generateGrid` passa a contar inserções reais (habilita o gate anti-spam do push). Push sai nos callers de dia/semana e no cron (não no core), com conteúdo por-org. Migration adiciona `class_sessions.created_at` pra "data da geração".

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase, Vitest. Spec: [docs/superpowers/specs/2026-07-21-grade-chamada-melhorias-design.md](../specs/2026-07-21-grade-chamada-melhorias-design.md).

---

## File Structure

**Create:**
- `lib/utils/enrollmentStatus.ts` (+ `.test.ts`) — classificação pura do status.
- `features/aulas/enrollmentRoster.ts` (+ `.test.ts`) — roster de alunos por turma com status.
- `features/aulas/gridNotify.ts` — push/inapp por-academia ao gerar.
- `features/aulas/ClassRosterSection.tsx` — lista de alunos + "Faltar em…" (server component).
- `features/aulas/SkipDateButton.tsx` — menu client "Faltar em…".
- `app/(admin)/admin/grade/RegenerateTodayButton.tsx` — botão "Regerar hoje".
- `supabase/migrations/20260721000000_class_sessions_created_at.sql` — coluna created_at.

**Modify:**
- `features/aulas/gridGeneration.ts` — inserções reais.
- `features/aulas/gridActions.ts` — retorna breakdown + dispara push (gate em inserções).
- `app/(admin)/admin/grade/GridGenerateButtons.tsx` — feedback detalhado.
- `app/(admin)/admin/grade/page.tsx` — roster (counts/pills), números rotulados, info de geração, "Ver alunos".
- `app/(admin)/admin/grade/[sessionId]/editar/page.tsx` — inclui ClassRosterSection.
- `app/(admin)/admin/grade/[sessionId]/page.tsx` — estado vazio + "Regerar hoje".
- `features/aulas/adminActions.ts` — `adminSkipEnrollmentDate`, `adminUnskipEnrollmentDate`, `getClassUpcomingSessions`.
- `app/api/cron/weekly-grid-generation/route.ts` — push por-org (gate em inserções).

---

### Task 1: Helper puro de status do aluno

**Files:**
- Create: `lib/utils/enrollmentStatus.ts`
- Test: `lib/utils/enrollmentStatus.test.ts`

- [ ] **Step 1: Test**

```ts
// lib/utils/enrollmentStatus.test.ts
import { describe, it, expect } from 'vitest'
import { classifyEnrollment } from './enrollmentStatus'

describe('classifyEnrollment', () => {
  it('parceiro confirmado → elegivel', () => {
    expect(classifyEnrollment({ partner: 'wellhub', pendingPartner: null, hasActivePlan: false })).toBe('elegivel')
  })
  it('plano ativo → elegivel', () => {
    expect(classifyEnrollment({ partner: null, pendingPartner: null, hasActivePlan: true })).toBe('elegivel')
  })
  it('pending_partner sem confirmar → a_confirmar', () => {
    expect(classifyEnrollment({ partner: null, pendingPartner: 'wellhub', hasActivePlan: false })).toBe('a_confirmar')
  })
  it('nada → sem_plano', () => {
    expect(classifyEnrollment({ partner: null, pendingPartner: null, hasActivePlan: false })).toBe('sem_plano')
  })
  it('partner vazio ("") NÃO conta como parceiro', () => {
    expect(classifyEnrollment({ partner: '', pendingPartner: 'totalpass', hasActivePlan: false })).toBe('a_confirmar')
  })
})
```

- [ ] **Step 2: Rodar (falha)** — `npm run test:run -- lib/utils/enrollmentStatus.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// lib/utils/enrollmentStatus.ts
// Puro: classifica como o aluno fixo entra na grade. A reserva só acontece pra
// 'elegivel' (spec 2026-07-21 §1). 'a_confirmar' = Wellhub/TotalPass declarado
// mas ainda não confirmado — exibição honesta, NÃO reserva.
export type EnrollmentStatus = 'elegivel' | 'a_confirmar' | 'sem_plano'

export function classifyEnrollment(input: {
  partner: string | null
  pendingPartner: string | null
  hasActivePlan: boolean
}): EnrollmentStatus {
  if ((input.partner && input.partner.length > 0) || input.hasActivePlan) return 'elegivel'
  if (input.pendingPartner && input.pendingPartner.length > 0) return 'a_confirmar'
  return 'sem_plano'
}
```

- [ ] **Step 4: Rodar (passa)** — `npm run test:run -- lib/utils/enrollmentStatus.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/enrollmentStatus.ts lib/utils/enrollmentStatus.test.ts
git commit -m "feat(grade): helper puro de status do aluno (elegivel/a confirmar/sem plano)"
```

---

### Task 2: `generateGrid` conta inserções reais

**Files:**
- Modify: `features/aulas/gridGeneration.ts`
- Test: `features/aulas/gridGeneration.test.ts`

Contexto: hoje `sessionsCreated = rows.length` (tentadas). Com `ignoreDuplicates`, o upsert com `.select()` retorna **só as inseridas** → contagem real, que também vira o gate anti-spam do push.

- [ ] **Step 1: Ajustar o upsert em `gridGeneration.ts`**

Trocar o bloco do upsert por:

```ts
  const rows = classes.flatMap((c) => buildSessionRows(c.id, c.day_of_week, from, to))
  let sessionsCreated = 0
  if (rows.length > 0) {
    // .select() com ignoreDuplicates retorna SÓ as linhas inseridas (conflitos
    // são pulados e não voltam) → contagem real de sessões novas.
    const { data: inserted, error: upsertErr } = await client
      .from('class_sessions')
      .upsert(rows, { onConflict: 'class_id,session_date', ignoreDuplicates: true })
      .select('id')

    if (upsertErr) {
      console.error('[generateGrid] upsert de class_sessions falhou', {
        orgId, from, to, error: upsertErr.message,
      })
      return { sessionsCreated: 0, studentsBooked: 0, error: upsertErr.message }
    }
    sessionsCreated = inserted?.length ?? 0
  }

  const rec = await reconcileAllActiveEnrollments(from, to, orgId)

  return { sessionsCreated, studentsBooked: rec.booked }
```

- [ ] **Step 2: Atualizar o fake client do teste**

Em `features/aulas/gridGeneration.test.ts`, o fake `.upsert()` precisa suportar `.select()` retornando as linhas. Ler o arquivo e ajustar o mock do `class_sessions.upsert` pra devolver um thenable/objeto com `.select()` que resolve `{ data: <linhas inseridas>, error }`. Nos testes de sucesso, `data` = as `rows` passadas (simulando todas novas); no teste de falha do upsert, manter `{ error: {...} }` (e `.select()` também resolve o erro). Ajustar as asserções de `sessionsCreated` pra refletir a contagem real (ex.: 1 sessão nova → `sessionsCreated: 1`).

- [ ] **Step 3: Rodar** — `npm run test:run -- features/aulas/gridGeneration.test.ts` → PASS (todos, incluindo o de erro do upsert e o filtro dayOfWeek/classId).

- [ ] **Step 4: Commit**

```bash
git add features/aulas/gridGeneration.ts features/aulas/gridGeneration.test.ts
git commit -m "feat(grade): generateGrid conta insercoes reais (habilita gate anti-spam)"
```

---

### Task 3: Helper de roster por turma (com status)

**Files:**
- Create: `features/aulas/enrollmentRoster.ts`
- Test: `features/aulas/enrollmentRoster.test.ts`

Reúne, por turma, os alunos matriculados ativos com seu status. Usado pela grade, pelo feedback do "Gerar", pelo editar-turma.

- [ ] **Step 1: Test** (injeta um fake client que devolve enrollments/memberships/subscriptions)

```ts
// features/aulas/enrollmentRoster.test.ts
import { describe, it, expect } from 'vitest'
import { getClassRoster } from './enrollmentRoster'

// Fake client mínimo: responde por tabela com filtros irrelevantes ignorados.
function makeClient(data: {
  classes: { id: string; day_of_week: number }[]
  enrollments: { class_id: string; student_id: string }[]
  memberships: { user_id: string; partner: string | null; pending_partner: string | null }[]
  subs: { student_id: string; gateway: string; current_period_end: string | null }[]
}) {
  return {
    from(table: string) {
      const rowsByTable: Record<string, unknown[]> = {
        classes: data.classes,
        enrollments: data.enrollments,
        memberships: data.memberships,
        student_subscriptions: data.subs,
      }
      const builder: any = {
        _rows: rowsByTable[table] ?? [],
        select() { return builder },
        eq() { return builder },
        in() { return builder },
        then(resolve: (v: { data: unknown[] }) => void) { resolve({ data: builder._rows }) },
      }
      return builder
    },
  } as any
}

describe('getClassRoster', () => {
  it('classifica cada matriculado por status', async () => {
    const client = makeClient({
      classes: [{ id: 'c1', day_of_week: 2 }],
      enrollments: [
        { class_id: 'c1', student_id: 'a' },
        { class_id: 'c1', student_id: 'b' },
        { class_id: 'c1', student_id: 'd' },
      ],
      memberships: [
        { user_id: 'a', partner: null, pending_partner: null }, // plano → elegivel
        { user_id: 'b', partner: null, pending_partner: 'wellhub' }, // a_confirmar
        { user_id: 'd', partner: null, pending_partner: null }, // sem_plano
      ],
      subs: [{ student_id: 'a', gateway: 'manual', current_period_end: null }], // manual = vigente
    })
    const roster = await getClassRoster(client, 'org1')
    const c1 = roster.byClass.get('c1')!
    expect(c1.elegivel).toBe(1)
    expect(c1.aConfirmar).toBe(1)
    expect(c1.semPlano).toBe(1)
    expect(c1.matriculados).toBe(3)
  })

  it('filtra por dayOfWeek', async () => {
    const client = makeClient({
      classes: [{ id: 'c1', day_of_week: 2 }],
      enrollments: [{ class_id: 'c1', student_id: 'a' }],
      memberships: [{ user_id: 'a', partner: 'wellhub', pending_partner: null }],
      subs: [],
    })
    const roster = await getClassRoster(client, 'org1', { dayOfWeek: 2 })
    expect(roster.totals.elegivel).toBe(1)
  })
})
```

- [ ] **Step 2: Rodar (falha)** — `npm run test:run -- features/aulas/enrollmentRoster.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// features/aulas/enrollmentRoster.ts
// Roster de alunos por turma com status (spec 2026-07-21 §1). Fonte única
// reusada pela grade, pelo feedback do "Gerar" e pelo editar-turma.
import type { createAdminClient } from '@/lib/supabase/server'
import { classifyEnrollment, type EnrollmentStatus } from '@/lib/utils/enrollmentStatus'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'

type AdminClient = ReturnType<typeof createAdminClient>

export interface RosterStudent {
  studentId: string
  classId: string
  status: EnrollmentStatus
}
export interface ClassRosterCounts {
  matriculados: number
  elegivel: number
  aConfirmar: number
  semPlano: number
  students: RosterStudent[]
}
export interface Roster {
  byClass: Map<string, ClassRosterCounts>
  totals: { matriculados: number; elegivel: number; aConfirmar: number; semPlano: number }
}

export async function getClassRoster(
  client: AdminClient,
  orgId: string,
  opts: { dayOfWeek?: number; classId?: string } = {},
): Promise<Roster> {
  let clsQ = client.from('classes').select('id, day_of_week').eq('organization_id', orgId).eq('is_active', true)
  if (opts.dayOfWeek !== undefined) clsQ = clsQ.eq('day_of_week', opts.dayOfWeek)
  if (opts.classId !== undefined) clsQ = clsQ.eq('id', opts.classId)
  const { data: classesRaw } = await clsQ
  const classIds = ((classesRaw ?? []) as { id: string }[]).map((c) => c.id)

  const empty: Roster = { byClass: new Map(), totals: { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0 } }
  if (classIds.length === 0) return empty

  const { data: enrollRaw } = await client
    .from('enrollments').select('class_id, student_id')
    .in('class_id', classIds).eq('organization_id', orgId).eq('is_active', true)
  const enrolls = (enrollRaw ?? []) as { class_id: string; student_id: string }[]
  if (enrolls.length === 0) {
    for (const id of classIds) empty.byClass.set(id, { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0, students: [] })
    return empty
  }

  const studentIds = Array.from(new Set(enrolls.map((e) => e.student_id)))

  const { data: memsRaw } = await client
    .from('memberships').select('user_id, partner, pending_partner')
    .in('user_id', studentIds).eq('organization_id', orgId)
  const memById = new Map(
    ((memsRaw ?? []) as { user_id: string; partner: string | null; pending_partner: string | null }[])
      .map((m) => [m.user_id, m]),
  )

  const { data: subsRaw } = await client
    .from('student_subscriptions').select('student_id, gateway, current_period_end')
    .in('student_id', studentIds).eq('organization_id', orgId).eq('status', 'active')
  const now = new Date()
  const planStudents = new Set(
    ((subsRaw ?? []) as { student_id: string; gateway: string; current_period_end: string | null }[])
      .filter((s) => isSubscriptionCurrent(s, now)).map((s) => s.student_id),
  )

  const byClass = new Map<string, ClassRosterCounts>()
  for (const id of classIds) byClass.set(id, { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0, students: [] })
  const totals = { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0 }

  for (const e of enrolls) {
    const mem = memById.get(e.student_id)
    const status = classifyEnrollment({
      partner: mem?.partner ?? null,
      pendingPartner: mem?.pending_partner ?? null,
      hasActivePlan: planStudents.has(e.student_id),
    })
    const c = byClass.get(e.class_id)!
    c.matriculados++; totals.matriculados++
    if (status === 'elegivel') { c.elegivel++; totals.elegivel++ }
    else if (status === 'a_confirmar') { c.aConfirmar++; totals.aConfirmar++ }
    else { c.semPlano++; totals.semPlano++ }
    c.students.push({ studentId: e.student_id, classId: e.class_id, status })
  }

  return { byClass, totals }
}
```

- [ ] **Step 4: Rodar (passa)** — `npm run test:run -- features/aulas/enrollmentRoster.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/enrollmentRoster.ts features/aulas/enrollmentRoster.test.ts
git commit -m "feat(grade): roster de alunos por turma com status"
```

---

### Task 4: Migration `class_sessions.created_at`

**Files:**
- Create: `supabase/migrations/20260721000000_class_sessions_created_at.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260721000000_class_sessions_created_at.sql
-- Adiciona created_at para exibir "gerada em/há X" por turma (spec 2026-07-21 §4).
-- Linhas existentes recebem now() no deploy (a data de geração passada se perde —
-- aceitável, sem risco destrutivo).
alter table class_sessions
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_class_sessions_class_created on class_sessions (class_id, created_at desc);
```

- [ ] **Step 2: Verify (não aplicar)** — `node -e "const s=require('fs').readFileSync('supabase/migrations/20260721000000_class_sessions_created_at.sql','utf8'); if(!/add column if not exists created_at/.test(s)) throw new Error('faltou coluna'); console.log('ok')"` → `ok`. Aplicada manualmente pelo usuário (padrão do projeto).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721000000_class_sessions_created_at.sql
git commit -m "feat(db): class_sessions.created_at para data de geracao"
```

---

### Task 5: Helper de push por academia

**Files:**
- Create: `features/aulas/gridNotify.ts`

Best-effort: nunca lança (não pode derrubar a geração). `notifyUsers` já isola falhas de push por-subscription; aqui envolvo tudo em try/catch + Sentry pra também blindar o insert in-app.

- [ ] **Step 1: Implementar**

```ts
// features/aulas/gridNotify.ts
// Push + in-app por academia ao gerar a grade (spec 2026-07-21 §8). Multi-tenant:
// puxa o nome da org e notifica só os alunos DELA. Best-effort: nunca lança.
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'

type AdminClient = ReturnType<typeof createAdminClient>

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export async function notifyGridGenerated(
  orgId: string,
  scope: { kind: 'week' } | { kind: 'day'; dayOfWeek: number },
  client: AdminClient = createAdminClient(),
): Promise<void> {
  try {
    const { data: org } = await client.from('organizations').select('name').eq('id', orgId).single()
    const academia = (org as { name: string } | null)?.name ?? 'sua academia'

    const title =
      scope.kind === 'week'
        ? `Novas aulas na ${academia} 🎾`
        : `Aulas de ${DIAS[scope.dayOfWeek] ?? 'sua turma'} na ${academia} 🎾`
    const body =
      scope.kind === 'week'
        ? 'A grade da semana já está disponível. Agende sua aula!'
        : 'Já dá pra agendar. Bora treinar!'

    const { data: mems } = await client
      .from('memberships')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'student')
      .eq('contract_active', true)
    const recipients = ((mems ?? []) as { user_id: string }[]).map((m) => ({ userId: m.user_id }))
    if (recipients.length === 0) return

    await notifyUsers(client, {
      orgId,
      recipients,
      type: 'grade_disponivel',
      title,
      body,
      channels: ['push', 'inapp'],
    })
  } catch (err) {
    console.error('[notifyGridGenerated] falhou', { orgId, error: err instanceof Error ? err.message : String(err) })
    Sentry.captureException(err, { tags: { feature: 'gridNotify' }, extra: { orgId } })
  }
}
```

- [ ] **Step 2: Verify** — `npm run build` → compila (a rota/módulo importa ok).

- [ ] **Step 3: Commit**

```bash
git add features/aulas/gridNotify.ts
git commit -m "feat(grade): helper de push por academia ao gerar grade"
```

---

### Task 6: `gridActions` retorna breakdown + dispara push

**Files:**
- Modify: `features/aulas/gridActions.ts`

- [ ] **Step 1: Reescrever `gridActions.ts`**

```ts
// features/aulas/gridActions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from './authGuards'
import { generateGrid } from './gridGeneration'
import { getClassRoster } from './enrollmentRoster'
import { notifyGridGenerated } from './gridNotify'
import { brtToday, addDaysStr, nextDateForDayOfWeek } from '@/lib/utils/gridSchedule'

interface GridActionResult {
  error?: string
  sessionsCreated?: number
  reservados?: number
  aConfirmar?: number
  semPlano?: number
}

export async function generateGridDay(dayOfWeek: number): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return { error: 'Dia inválido.' }

  const target = nextDateForDayOfWeek(brtToday(new Date()), dayOfWeek)
  const r = await generateGrid(orgId, target, target, { dayOfWeek })
  if (r.error) return { error: r.error }

  const roster = await getClassRoster(createAdminClient(), orgId, { dayOfWeek })
  if (r.sessionsCreated > 0) await notifyGridGenerated(orgId, { kind: 'day', dayOfWeek })

  revalidatePath('/admin/grade')
  return {
    sessionsCreated: r.sessionsCreated,
    reservados: roster.totals.elegivel,
    aConfirmar: roster.totals.aConfirmar,
    semPlano: roster.totals.semPlano,
  }
}

export async function generateGridWeek(): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  const from = brtToday(new Date())
  const r = await generateGrid(orgId, from, addDaysStr(from, 6))
  if (r.error) return { error: r.error }

  const roster = await getClassRoster(createAdminClient(), orgId)
  if (r.sessionsCreated > 0) await notifyGridGenerated(orgId, { kind: 'week' })

  revalidatePath('/admin/grade')
  return {
    sessionsCreated: r.sessionsCreated,
    reservados: roster.totals.elegivel,
    aConfirmar: roster.totals.aConfirmar,
    semPlano: roster.totals.semPlano,
  }
}
```

Nota: `reservados` usa o roster (matriculados elegíveis) — número estável e consistente com os pills da grade. O push só dispara com `sessionsCreated > 0` (inserção real).

- [ ] **Step 2: Verify** — `npm run build` → compila. `npm run test:run` → suíte passa.

- [ ] **Step 3: Commit**

```bash
git add features/aulas/gridActions.ts
git commit -m "feat(grade): gridActions retorna breakdown de status e dispara push"
```

---

### Task 7: Feedback detalhado nos botões

**Files:**
- Modify: `app/(admin)/admin/grade/GridGenerateButtons.tsx`

- [ ] **Step 1: Atualizar o `feedback()`**

Trocar a função `feedback` (e o tipo do resultado) por:

```tsx
function feedback(r: {
  error?: string
  sessionsCreated?: number
  reservados?: number
  aConfirmar?: number
  semPlano?: number
}): string {
  if (r.error) return `Erro: ${r.error}`
  const parts = [`${r.sessionsCreated ?? 0} sessões`, `${r.reservados ?? 0} reservados`]
  if ((r.aConfirmar ?? 0) > 0) parts.push(`${r.aConfirmar} a confirmar`)
  if ((r.semPlano ?? 0) > 0) parts.push(`${r.semPlano} sem plano`)
  return parts.join(' · ')
}
```

(O resto do componente — os dois botões — permanece; só o tipo/uso de `feedback` muda.)

- [ ] **Step 2: Verify** — `npm run build` → compila.

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/grade/GridGenerateButtons.tsx
git commit -m "feat(grade): botao Gerar mostra reservados/a confirmar/sem plano"
```

---

### Task 8: Redesenho da grade (roster, números, info de geração)

**Files:**
- Modify: `app/(admin)/admin/grade/page.tsx`

Substituir o cálculo inline de matrícula/plano/parceiro pelo `getClassRoster`, adicionar a info de geração por turma, rotular os números e trocar o card semanal pelo layout do mockup.

- [ ] **Step 1: Trocar a coleta de dados das turmas semanais**

Remover os blocos que montam `enrollRows`, `partnerByStudent`, `planStudents`, `enrollCountMap`, `noPlanMap` (lines ~74-129 do arquivo atual) e, no lugar, usar o roster + a info de geração:

```tsx
import { getClassRoster } from '@/features/aulas/enrollmentRoster'
// ...
const roster = await getClassRoster(adminClient, orgId)

// Info de geração por turma: maior session_date e maior created_at (scheduled).
const { data: genRaw } = classIds.length > 0
  ? await adminClient
      .from('class_sessions')
      .select('class_id, session_date, created_at')
      .in('class_id', classIds)
      .eq('status', 'scheduled')
  : { data: [] }
const genByClass = new Map<string, { lastDate: string; lastCreated: string }>()
for (const s of (genRaw ?? []) as { class_id: string; session_date: string; created_at: string }[]) {
  const cur = genByClass.get(s.class_id)
  if (!cur || s.session_date > cur.lastDate) {
    genByClass.set(s.class_id, { lastDate: s.session_date, lastCreated: s.created_at })
  }
}
```

(`classIds` já existe no arquivo. Manter a coleta de `sessionsToday`/`bookingCountMap` da seção "Hoje" como está — lá o número é bookings confirmados reais.)

- [ ] **Step 2: Um helper de "há X" e os pills**

Adicionar no topo do arquivo (fora do componente):

```tsx
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'há minutos'
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}
```

- [ ] **Step 3: Novo card semanal**

Trocar o `dayClasses.map((c) => { const enrolled = ...; return (<Card>...)} )` pelo card do mockup, lendo do roster e da info de geração:

```tsx
{dayClasses.map((c) => {
  const rc = roster.byClass.get(c.id) ?? { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0, students: [] }
  const gen = genByClass.get(c.id)
  return (
    <Card key={c.id}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-white text-sm font-medium truncate">{c.name}</span>
        <div className="flex items-center gap-1 shrink-0">
          {c.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
          <Link href={`/admin/grade/${c.id}/editar`} className="text-xs text-slate-400 hover:text-brand-500 ml-1">Editar</Link>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-1">{formatTime(c.start_time)} – {formatTime(c.end_time)}</p>

      <p className="text-xs text-slate-400 mb-2">
        <span className="text-sm font-extrabold text-white">{rc.matriculados}</span> matriculados ·{' '}
        <span className="text-sm font-extrabold text-green-400">{rc.elegivel}</span> reservados{' '}
        <span className="text-slate-500">/ {c.max_students}</span>
      </p>

      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-green-400 bg-green-500/10 border border-green-500/30">✅ {rc.elegivel} elegíveis</span>
        {rc.aConfirmar > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-blue-400 bg-blue-500/10 border border-blue-500/30">🔵 {rc.aConfirmar} a confirmar</span>}
        {rc.semPlano > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-yellow-400 bg-yellow-500/10 border border-yellow-500/30">⚠️ {rc.semPlano} sem plano</span>}
      </div>

      <p className="text-xs text-slate-500 mb-2">
        {gen ? <>Próxima gerada: <span className="text-slate-400">{formatDate(gen.lastDate)}</span> · gerada {ago(gen.lastCreated)}</> : 'Ainda não gerada'}
      </p>

      <div className="flex items-center justify-between pt-2 border-t border-surface-border">
        <Link href={`/admin/grade/${c.id}/editar`} className="text-xs font-semibold text-brand-500 hover:underline">Ver alunos →</Link>
        <DeleteClassButton classId={c.id} className={c.name} />
      </div>
    </Card>
  )
})}
```

Adicionar `formatDate` ao import de `@/lib/utils/dateHelpers` (já importa `formatTime`).

- [ ] **Step 4: Verify** — `npm run build` → compila. `npm run lint` → sem novo erro. Abrir mentalmente: números rotulados, pills, "gerada há X", "Ver alunos →".

- [ ] **Step 5: Commit**

```bash
git add app/(admin)/admin/grade/page.tsx
git commit -m "feat(grade): card redesenhado com status, numeros claros e info de geracao"
```

---

### Task 9: Actions de skip por data (admin)

**Files:**
- Modify: `features/aulas/adminActions.ts`
- Test: `features/aulas/adminActions.test.ts` (criar se não existir; senão adicionar)

- [ ] **Step 1: Adicionar as actions em `adminActions.ts`**

```ts
/** Próximas sessões geradas (scheduled, hoje em diante) de uma turma. */
export async function getClassUpcomingSessions(
  classId: string,
): Promise<{ error?: string; sessions?: { id: string; session_date: string }[] }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  const adminClient = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await adminClient
    .from('class_sessions')
    .select('id, session_date')
    .eq('class_id', classId)
    .eq('organization_id', orgId)
    .eq('status', 'scheduled')
    .gte('session_date', today)
    .order('session_date', { ascending: true })
  return { sessions: (data ?? []) as { id: string; session_date: string }[] }
}

/** Admin tira o aluno de UMA data (falta pontual): reserva 'cancelled' na sessão. */
export async function adminSkipEnrollmentDate(
  studentId: string,
  sessionId: string,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  const adminClient = createAdminClient()

  // Escopo: a sessão é desta academia.
  const { data: session } = await adminClient
    .from('class_sessions').select('id').eq('id', sessionId).eq('organization_id', orgId).maybeSingle()
  if (!session) return { error: 'Sessão não encontrada.' }

  // Reserva 'cancelled' (unique student_id,session_id): a reconciliação não
  // re-reserva quem tem QUALQUER reserva na sessão (creditReconciliation).
  const { error } = await adminClient.from('session_bookings').upsert(
    {
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      status: 'cancelled',
      from_enrollment: true,
      credit_used: false,
    },
    { onConflict: 'student_id,session_id' },
  )
  if (error) return { error: `Erro ao registrar falta: ${error.message}` }
  revalidatePath('/admin/grade')
  return {}
}

/** Desfaz a falta: remove a reserva 'cancelled' daquela data (volta a poder reservar). */
export async function adminUnskipEnrollmentDate(
  studentId: string,
  sessionId: string,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('session_bookings')
    .delete()
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .eq('organization_id', orgId)
    .eq('status', 'cancelled')
  if (error) return { error: `Erro ao desfazer: ${error.message}` }
  revalidatePath('/admin/grade')
  return {}
}
```

- [ ] **Step 2: Verify** — `npm run build` → compila. `npm run test:run` → suíte passa.

- [ ] **Step 3: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "feat(grade): actions admin de falta pontual por data"
```

---

### Task 10: UI de alunos no editar-turma

**Files:**
- Create: `features/aulas/ClassRosterSection.tsx`
- Create: `features/aulas/SkipDateButton.tsx`
- Modify: `app/(admin)/admin/grade/[sessionId]/editar/page.tsx`

- [ ] **Step 1: `SkipDateButton.tsx` (client)** — menu "Faltar em…"

```tsx
// features/aulas/SkipDateButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { adminSkipEnrollmentDate, adminUnskipEnrollmentDate } from './adminActions'
import { formatDate } from '@/lib/utils/dateHelpers'

interface SessionOpt { id: string; session_date: string; skipped: boolean }

export function SkipDateButton({ studentId, sessions }: { studentId: string; sessions: SessionOpt[] }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle(s: SessionOpt) {
    start(async () => {
      const r = s.skipped
        ? await adminUnskipEnrollmentDate(studentId, s.id)
        : await adminSkipEnrollmentDate(studentId, s.id)
      setMsg(r.error ? `Erro: ${r.error}` : s.skipped ? 'Falta desfeita.' : 'Falta registrada.')
      setOpen(false)
    })
  }

  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((v) => !v)} disabled={pending}
        className="text-xs font-semibold text-slate-300 border border-surface-border rounded-lg px-3 py-1.5 hover:border-brand-500 hover:text-brand-500 disabled:opacity-50"
      >
        Faltar em… ▾
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-60 bg-surface border border-surface-border rounded-lg p-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 px-2 pb-1">Tirar de qual data?</p>
          {sessions.length === 0 && <p className="text-xs text-slate-500 px-2 py-1">Sem datas geradas.</p>}
          {sessions.map((s) => (
            <button
              key={s.id} type="button" onClick={() => toggle(s)}
              className="w-full flex items-center justify-between text-sm px-2 py-1.5 rounded-md hover:bg-surface-card"
            >
              <span className={s.skipped ? 'text-slate-500 line-through' : 'text-slate-200'}>{formatDate(s.session_date)}</span>
              {s.skipped && <span className="text-[11px] text-brand-500">desfazer</span>}
            </button>
          ))}
        </div>
      )}
      {msg && <span className="block text-xs text-slate-400 mt-1">{msg}</span>}
    </div>
  )
}
```

- [ ] **Step 2: `ClassRosterSection.tsx` (server component)** — lista alunos com status

```tsx
// features/aulas/ClassRosterSection.tsx
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { getClassRoster } from './enrollmentRoster'
import { getClassUpcomingSessions } from './adminActions'
import { SkipDateButton } from './SkipDateButton'
import type { EnrollmentStatus } from '@/lib/utils/enrollmentStatus'

const STATUS_META: Record<EnrollmentStatus, { label: string; cls: string }> = {
  elegivel: { label: '✅ Elegível', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  a_confirmar: { label: '🔵 Wellhub a confirmar', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  sem_plano: { label: '⚠️ Sem plano', cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
}

export async function ClassRosterSection({ classId }: { classId: string }) {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  const roster = await getClassRoster(adminClient, orgId!, { classId })
  const students = roster.byClass.get(classId)?.students ?? []

  const ids = students.map((s) => s.studentId)
  const { data: profs } = ids.length > 0
    ? await adminClient.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] }
  const nameById = new Map(((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))

  const upcoming = await getClassUpcomingSessions(classId)
  const upSessions = upcoming.sessions ?? []

  // Datas que cada aluno já está pulando (reserva 'cancelled') → pra oferecer "desfazer".
  const upIds = upSessions.map((s) => s.id)
  const { data: skipsRaw } = ids.length > 0 && upIds.length > 0
    ? await adminClient.from('session_bookings').select('student_id, session_id')
        .in('session_id', upIds).in('student_id', ids).eq('status', 'cancelled')
    : { data: [] }
  const skippedByStudent = new Map<string, Set<string>>()
  for (const b of (skipsRaw ?? []) as { student_id: string; session_id: string }[]) {
    const set = skippedByStudent.get(b.student_id) ?? new Set<string>()
    set.add(b.session_id); skippedByStudent.set(b.student_id, set)
  }

  if (students.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum aluno matriculado nesta turma.</p>
  }

  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
        Alunos da turma <span className="text-slate-500 font-normal">({students.length})</span>
      </h2>
      {students
        .slice()
        .sort((a, b) => (nameById.get(a.studentId) ?? '').localeCompare(nameById.get(b.studentId) ?? '', 'pt-BR'))
        .map((s) => {
          const meta = STATUS_META[s.status]
          return (
            <div key={s.studentId} className="flex items-center gap-3 py-3 border-b border-surface-border last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{nameById.get(s.studentId) ?? 'Aluno'}</p>
                <span className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
              </div>
              <SkipDateButton
                studentId={s.studentId}
                sessions={upSessions.map((u) => ({ ...u, skipped: skippedByStudent.get(s.studentId)?.has(u.id) ?? false }))}
              />
            </div>
          )
        })}
    </div>
  )
}
```

- [ ] **Step 3: Incluir no editar-turma**

Em `app/(admin)/admin/grade/[sessionId]/editar/page.tsx`, importar e renderizar após o form:

```tsx
import { ClassRosterSection } from '@/features/aulas/ClassRosterSection'
// ...
      <EditClassForm class_={data as Class} />
      <div className="border-t border-surface-border pt-6">
        <ClassRosterSection classId={classId} />
      </div>
```

- [ ] **Step 4: Verify** — `npm run build` → compila. `npm run lint` → sem novo erro.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/ClassRosterSection.tsx features/aulas/SkipDateButton.tsx "app/(admin)/admin/grade/[sessionId]/editar/page.tsx"
git commit -m "feat(grade): editar-turma lista alunos com status e falta por data"
```

---

### Task 11: Chamada — estado vazio + "Regerar hoje"

**Files:**
- Create: `app/(admin)/admin/grade/RegenerateTodayButton.tsx`
- Modify: `app/(admin)/admin/grade/[sessionId]/page.tsx`

- [ ] **Step 1: `RegenerateTodayButton.tsx` (client)**

```tsx
// app/(admin)/admin/grade/RegenerateTodayButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { generateGridDay } from '@/features/aulas/gridActions'

/** Re-roda a geração/reserva do dia-da-semana informado (reserva quem virou elegível). */
export function RegenerateTodayButton({ dayOfWeek }: { dayOfWeek: number }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm" variant="secondary" loading={pending}
        onClick={() => start(async () => {
          const r = await generateGridDay(dayOfWeek)
          setMsg(r.error ? `Erro: ${r.error}` : `${r.reservados ?? 0} reservados.`)
          router.refresh()
        })}
      >
        Regerar hoje
      </Button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </div>
  )
}
```

- [ ] **Step 2: Estado vazio na chamada**

Em `app/(admin)/admin/grade/[sessionId]/page.tsx`, calcular o dia-da-semana da sessão e, quando não há alunos reservados, mostrar o estado claro antes/junto do `AttendanceSheet`:

```tsx
import { RegenerateTodayButton } from '@/app/(admin)/admin/grade/RegenerateTodayButton'
// ... dentro do return, após o header e o AddStudentToSession:
{students.length === 0 && (
  <div className="border border-dashed border-surface-border rounded-xl p-5 text-center space-y-3">
    <p className="text-sm text-slate-400">Ninguém reservado ainda para esta aula.</p>
    <p className="text-xs text-slate-500">Adicione um aluno avulso acima, ou regere o dia para reservar quem já tem plano/parceiro ativo.</p>
    <RegenerateTodayButton dayOfWeek={new Date(typedSession.session_date + 'T12:00:00').getDay()} />
  </div>
)}
```

(O `AttendanceSheet` e o `StartClassClient` continuam; ficam naturalmente vazios quando `students.length === 0`.)

- [ ] **Step 3: Verify** — `npm run build` → compila. `npm run lint` → sem novo erro.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/grade/RegenerateTodayButton.tsx" "app/(admin)/admin/grade/[sessionId]/page.tsx"
git commit -m "feat(grade): chamada com estado vazio util e regerar hoje"
```

---

### Task 12: Push no cron de auto-geração

**Files:**
- Modify: `app/api/cron/weekly-grid-generation/route.ts`

- [ ] **Step 1: Disparar push por-org quando gerou algo novo**

No laço por-org, após a geração bem-sucedida e o upsert da marca d'água, adicionar (gate em inserção real):

Adicionar o import no topo:

```ts
import { notifyGridGenerated } from '@/features/aulas/gridNotify'
```

E, dentro do `try` do laço por-org, **depois** do upsert da marca d'água:

```ts
        if (r.sessionsCreated > 0) {
          await notifyGridGenerated(orgId, { kind: 'week' }, admin)
        }
```

`notifyGridGenerated` é best-effort (não lança), então não precisa de try/catch extra. O gate `r.sessionsCreated > 0` garante que regerar a mesma semana num dia seguinte (0 inserções) não re-notifica.

- [ ] **Step 2: Verify** — `npm run build` → compila; rota `ƒ /api/cron/weekly-grid-generation` na tabela. `npm run test:run` → suíte passa.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/weekly-grid-generation/route.ts
git commit -m "feat(grade): cron dispara push por academia quando gera sessoes novas"
```

---

### Task 13: Verificação end-to-end

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte + build + lint**

Run: `npm run test:run` → todos passam (novos: enrollmentStatus, enrollmentRoster; gridGeneration atualizado).
Run: `npm run build` → compila.
Run: `npm run lint` → sem erro novo.

- [ ] **Step 2: Caçar sobras**

Run: `grep -rn "noPlanMap\|sem plano ativo" --include=*.tsx app/` → não deve haver resquício do cálculo antigo na grade (o novo usa o roster).

- [ ] **Step 3: Relatar**

Dizer o que foi verificado de verdade. Não exercitar contra o banco (é produção). Push real depende de VAPID configurado; `inapp` funciona. Lembrar o usuário das migrations pendentes a aplicar (`class_sessions.created_at` desta spec + a de expurgo da spec anterior).

---

## Ordem e dependências

```
1 (status)  ─┐
2 (inserts) ─┤ fundacionais
3 (roster)  ─┤ (usa 1)
4 (migration)┤
5 (gridNotify)┘
6 (gridActions) ── usa 2,3,5
7 (botoes) ── usa 6
8 (grade page) ── usa 3,4
9 (skip actions) ─┐
10 (editar UI) ── usa 3,9
11 (chamada) ── usa 6 (generateGridDay)
12 (cron push) ── usa 2,5
13 (verificacao) ── todas
```

## Cobertura do spec

| Spec § | Task |
|---|---|
| §1 status (elegível/a confirmar/sem plano) | 1, 3, 8, 10 |
| §2 feedback do Gerar | 6, 7 |
| §3 números consistentes | 8 |
| §4 card + info de geração | 4, 8 |
| §5 "Ver alunos" → editar | 8 |
| §6 editar: alunos + faltar em data | 9, 10 |
| §7 chamada vazia + regerar hoje | 11 |
| §8 push por academia | 5, 6, 12 |
| §9 inserções reais | 2 |
