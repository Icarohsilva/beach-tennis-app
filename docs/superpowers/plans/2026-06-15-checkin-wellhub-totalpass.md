# Check-in Wellhub/TotalPass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir vincular alunos a Wellhub/TotalPass (com ID e meta mensal de check-ins) e registrar check-ins (validação manual por ora) que somam na meta do mês e, em dia de aula fixa, confirmam presença.

**Architecture:** A regra de check-in fala apenas com uma interface `CheckinValidator` (validador manual agora; adaptadores reais Wellhub/TotalPass no follow-up). Lógica pura (progresso mensal, validador) em `lib/checkin/` com testes Vitest; efeitos (Supabase) em `features/checkin/`; UI no perfil do aluno (admin). Check-ins ficam numa tabela própria `checkins` (não em `attendance`, que exige `session_id`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (RPC não necessária aqui; uso de `createAdminClient`), date-fns, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-15-checkin-wellhub-totalpass-design.md](../specs/2026-06-15-checkin-wellhub-totalpass-design.md)

---

## File Structure

**Create:**
- `supabase/migrations/20260615000000_checkins.sql` — enum, tabela `checkins`, coluna `monthly_checkin_target`, índices, RLS.
- `lib/checkin/validator.ts` — interface + `manualValidator` + `getValidator`. Puro.
- `lib/checkin/validator.test.ts`
- `lib/checkin/progress.ts` — `computeProgress`. Puro.
- `lib/checkin/progress.test.ts`
- `features/checkin/actions.ts` — `recordCheckin`, `setStudentPartner` (server actions).

**Modify:**
- `types/index.ts` — `CheckinPartner`, `Checkin`, e `monthly_checkin_target` em `Profile`.
- `app/(admin)/admin/alunos/[id]/page.tsx` — buscar check-ins do mês + passar dados de parceiro ao client.
- `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx` — seção de vínculo + painel de check-in.

---

## Task 1: Migration — tabela `checkins` e meta mensal

**Files:**
- Create: `supabase/migrations/20260615000000_checkins.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Check-ins Wellhub/TotalPass.
-- Tabela própria (attendance exige session_id NOT NULL; check-in avulso não tem sessão).

create type checkin_partner as enum ('wellhub', 'totalpass');

alter table profiles
  add column if not exists monthly_checkin_target int not null default 0;

create table checkins (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  partner checkin_partner not null,
  checkin_date date not null,
  session_id uuid references class_sessions(id) on delete set null,
  external_ref text,
  validation text not null default 'manual',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index checkins_student_date_idx on checkins (student_id, checkin_date);
create unique index checkins_partner_ref_idx
  on checkins (partner, external_ref) where external_ref is not null;

alter table checkins enable row level security;

-- Espelha o padrão de attendance: aluno vê os próprios; admin gerencia tudo.
create policy "Students view own checkins" on checkins
  for select using (student_id = auth.uid());
create policy "Admin manages all checkins" on checkins
  for all using (is_admin());
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: aplica sem erro; tabela `checkins` e coluna `profiles.monthly_checkin_target` criadas.

> Se `supabase db push` não estiver disponível no ambiente, aplicar o SQL no editor SQL do Supabase. A função `is_admin()` já existe (usada por outras policies em `002_rls_policies.sql`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260615000000_checkins.sql
git commit -m "feat(checkin): migration de checkins e meta mensal"
```

---

## Task 2: Tipos

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the partner type near the other unions**

Logo após a linha `export type AttendanceSource = 'manual' | 'wellhub' | 'totalpass'`, adicionar:

```ts
export type CheckinPartner = 'wellhub' | 'totalpass'
```

- [ ] **Step 2: Add `monthly_checkin_target` to `Profile`**

No `interface Profile`, logo após a linha `credits_balance: number // cached; source of truth = credit_transactions`, adicionar:

```ts
  monthly_checkin_target: number
```

- [ ] **Step 3: Add the `Checkin` interface**

Após o `interface Attendance { ... }`, adicionar:

```ts
export interface Checkin {
  id: string
  student_id: string
  partner: CheckinPartner
  checkin_date: string // YYYY-MM-DD
  session_id: string | null
  external_ref: string | null
  validation: 'manual' | CheckinPartner
  created_by: string | null
  created_at: string
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts
git commit -m "feat(checkin): tipos Checkin, CheckinPartner e meta no Profile"
```

---

## Task 3: Validador (puro) + adaptador

**Files:**
- Create: `lib/checkin/validator.ts`
- Test: `lib/checkin/validator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/checkin/validator.test.ts
import { describe, it, expect } from 'vitest'
import { manualValidator, getValidator } from './validator'

describe('manualValidator', () => {
  it('always validates and propagates the code as externalRef', async () => {
    const r = await manualValidator.validate({
      partner: 'wellhub',
      studentId: 's1',
      partnerMemberId: 'WH123',
      code: 'ABC',
    })
    expect(r).toEqual({ valid: true, validation: 'manual', externalRef: 'ABC' })
  })

  it('validates without a code (externalRef undefined)', async () => {
    const r = await manualValidator.validate({
      partner: 'totalpass',
      studentId: 's1',
      partnerMemberId: null,
    })
    expect(r.valid).toBe(true)
    expect(r.validation).toBe('manual')
    expect(r.externalRef).toBeUndefined()
  })
})

describe('getValidator', () => {
  it('returns the manual validator for both partners (for now)', () => {
    expect(getValidator('wellhub')).toBe(manualValidator)
    expect(getValidator('totalpass')).toBe(manualValidator)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/checkin/validator.test.ts`
Expected: FAIL — cannot resolve import.

- [ ] **Step 3: Write the implementation**

```ts
// lib/checkin/validator.ts
import type { CheckinPartner } from '@/types'

export interface CheckinValidationInput {
  partner: CheckinPartner
  studentId: string
  partnerMemberId: string | null // wellhub_id / totalpass_id do perfil
  code?: string // código do app do parceiro (futuro)
}

export interface CheckinValidationResult {
  valid: boolean
  validation: 'manual' | CheckinPartner
  externalRef?: string
  error?: string
}

export interface CheckinValidator {
  validate(input: CheckinValidationInput): Promise<CheckinValidationResult>
}

/** Validador manual: usado quando o admin registra o check-in. Sempre válido. */
export const manualValidator: CheckinValidator = {
  async validate(input) {
    return { valid: true, validation: 'manual', externalRef: input.code }
  },
}

/**
 * Devolve o validador do parceiro. Hoje, manual para ambos.
 * No follow-up, retorna os adaptadores reais Wellhub/TotalPass.
 */
export function getValidator(_partner: CheckinPartner): CheckinValidator {
  return manualValidator
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/checkin/validator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/checkin/validator.ts lib/checkin/validator.test.ts
git commit -m "feat(checkin): interface de validacao + validador manual"
```

---

## Task 4: Progresso mensal (puro)

**Files:**
- Create: `lib/checkin/progress.ts`
- Test: `lib/checkin/progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/checkin/progress.test.ts
import { describe, it, expect } from 'vitest'
import { computeProgress } from './progress'

describe('computeProgress', () => {
  it('below target: remaining > 0, ahead = 0', () => {
    expect(computeProgress(8, 3)).toEqual({ target: 8, done: 3, remaining: 5, ahead: 0 })
  })
  it('on target: remaining = 0, ahead = 0', () => {
    expect(computeProgress(8, 8)).toEqual({ target: 8, done: 8, remaining: 0, ahead: 0 })
  })
  it('above target: remaining = 0, ahead > 0', () => {
    expect(computeProgress(8, 10)).toEqual({ target: 8, done: 10, remaining: 0, ahead: 2 })
  })
  it('zero target: remaining = 0, ahead = done', () => {
    expect(computeProgress(0, 2)).toEqual({ target: 0, done: 2, remaining: 0, ahead: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/checkin/progress.test.ts`
Expected: FAIL — cannot resolve import.

- [ ] **Step 3: Write the implementation**

```ts
// lib/checkin/progress.ts
export interface CheckinProgress {
  target: number
  done: number
  remaining: number
  ahead: number
}

/** Progresso da meta mensal de check-ins. */
export function computeProgress(target: number, done: number): CheckinProgress {
  return {
    target,
    done,
    remaining: Math.max(target - done, 0),
    ahead: Math.max(done - target, 0),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/checkin/progress.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/checkin/progress.ts lib/checkin/progress.test.ts
git commit -m "feat(checkin): calculo puro de progresso mensal"
```

---

## Task 5: Action `setStudentPartner`

**Files:**
- Create: `features/checkin/actions.ts`

- [ ] **Step 1: Write the file with `setStudentPartner`**

```ts
'use server'
// features/checkin/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'

async function requireAdmin(): Promise<{ ok: boolean }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return { ok: profile?.role === 'admin' }
}

/**
 * Vincula um aluno a um parceiro (Wellhub/TotalPass): define payment_type,
 * o ID do parceiro no campo correspondente e a meta mensal de check-ins.
 */
export async function setStudentPartner(
  studentId: string,
  input: { partner: CheckinPartner; partnerId: string; monthlyTarget: number },
): Promise<{ error?: string }> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  if (!Number.isInteger(input.monthlyTarget) || input.monthlyTarget < 0) {
    return { error: 'Meta mensal inválida.' }
  }

  const adminClient = createAdminClient()
  const idColumn = input.partner === 'wellhub' ? 'wellhub_id' : 'totalpass_id'

  const { error } = await adminClient
    .from('profiles')
    .update({
      payment_type: input.partner,
      [idColumn]: input.partnerId.trim() || null,
      monthly_checkin_target: input.monthlyTarget,
    })
    .eq('id', studentId)

  if (error) return { error: 'Erro ao vincular parceiro.' }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add features/checkin/actions.ts
git commit -m "feat(checkin): action setStudentPartner (vincular parceiro + meta)"
```

---

## Task 6: Action `recordCheckin`

**Files:**
- Modify: `features/checkin/actions.ts`

- [ ] **Step 1: Add imports for the validator, progress and month window**

No topo de `features/checkin/actions.ts`, após os imports existentes, adicionar:

```ts
import { format } from 'date-fns'
import { getValidator } from '@/lib/checkin/validator'
import { computeProgress, type CheckinProgress } from '@/lib/checkin/progress'
import { getMonthWindow } from '@/lib/utils/monthWindow'
```

- [ ] **Step 2: Append `recordCheckin` to the file**

```ts
/**
 * Registra um check-in do aluno no parceiro. Valida via getValidator (manual
 * por ora). Se a data cair numa aula fixa do aluno com reserva confirmada,
 * também marca presença. Idempotente por external_ref. Retorna o progresso do mês.
 */
export async function recordCheckin(
  studentId: string,
  partner: CheckinPartner,
  opts?: { date?: string; code?: string; createdBy?: string },
): Promise<{ error?: string; progress?: CheckinProgress }> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  const date = opts?.date ?? format(new Date(), 'yyyy-MM-dd')

  // Perfil: precisa estar vinculado ao parceiro
  const { data: profile } = await adminClient
    .from('profiles')
    .select('payment_type, wellhub_id, totalpass_id, monthly_checkin_target')
    .eq('id', studentId)
    .single()

  if (!profile) return { error: 'Aluno não encontrado.' }
  if (profile.payment_type !== partner) {
    return { error: 'Aluno não está vinculado a este parceiro.' }
  }

  const partnerMemberId = (partner === 'wellhub' ? profile.wellhub_id : profile.totalpass_id) as
    | string
    | null

  // Validação (manual por ora)
  const result = await getValidator(partner).validate({
    partner,
    studentId,
    partnerMemberId,
    code: opts?.code,
  })
  if (!result.valid) return { error: result.error ?? 'Check-in inválido.' }

  // Idempotência por external_ref
  if (result.externalRef) {
    const { data: existing } = await adminClient
      .from('checkins')
      .select('id')
      .eq('partner', partner)
      .eq('external_ref', result.externalRef)
      .maybeSingle()
    if (existing) {
      return { progress: await monthlyProgress(adminClient, studentId, profile.monthly_checkin_target) }
    }
  }

  // Liga a uma aula fixa do dia, se houver reserva confirmada
  const linkedSessionId = await findLinkedSession(adminClient, studentId, date)

  const { error: insertErr } = await adminClient.from('checkins').insert({
    student_id: studentId,
    partner,
    checkin_date: date,
    session_id: linkedSessionId,
    external_ref: result.externalRef ?? null,
    validation: result.validation,
    created_by: opts?.createdBy ?? null,
  })
  if (insertErr) return { error: 'Erro ao registrar check-in.' }

  if (linkedSessionId) {
    await adminClient.from('attendance').upsert(
      {
        student_id: studentId,
        session_id: linkedSessionId,
        status: 'present',
        source: partner,
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,session_id' },
    )
  }

  revalidatePath(`/admin/alunos/${studentId}`)
  return { progress: await monthlyProgress(adminClient, studentId, profile.monthly_checkin_target) }
}

/** Sessão agendada na data, de turma com matrícula ativa e reserva confirmada. */
async function findLinkedSession(
  adminClient: ReturnType<typeof createAdminClient>,
  studentId: string,
  date: string,
): Promise<string | null> {
  const { data: enrolls } = await adminClient
    .from('enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('is_active', true)
  const classIds = (enrolls ?? []).map((e: { class_id: string }) => e.class_id)
  if (classIds.length === 0) return null

  const { data: sessions } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('session_date', date)
    .eq('status', 'scheduled')
    .in('class_id', classIds)
  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)
  if (sessionIds.length === 0) return null

  const { data: booking } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', sessionIds)
    .limit(1)
    .maybeSingle()

  return (booking?.session_id as string | undefined) ?? null
}

/** Conta os check-ins do mês corrente e calcula o progresso. */
async function monthlyProgress(
  adminClient: ReturnType<typeof createAdminClient>,
  studentId: string,
  target: number,
): Promise<CheckinProgress> {
  const { from, to } = getMonthWindow(new Date())
  const { count } = await adminClient
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .gte('checkin_date', from)
    .lte('checkin_date', to)
  return computeProgress(target, count ?? 0)
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add features/checkin/actions.ts
git commit -m "feat(checkin): action recordCheckin com presenca e progresso"
```

---

## Task 7: UI no perfil do aluno (admin)

**Files:**
- Modify: `app/(admin)/admin/alunos/[id]/page.tsx`
- Modify: `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx`

- [ ] **Step 1: page.tsx — buscar check-ins do mês e passar ao client**

Em `app/(admin)/admin/alunos/[id]/page.tsx`, adicionar o import no topo:

```ts
import { getMonthWindow } from '@/lib/utils/monthWindow'
```

Antes do `return (`, após o bloco de `credits`, adicionar:

```ts
  // Check-ins do mês corrente (Wellhub/TotalPass)
  const { from: monthFrom, to: monthTo } = getMonthWindow(new Date())
  const { data: checkinsRaw } = await adminClient
    .from('checkins')
    .select('id, partner, checkin_date, session_id, validation, created_at')
    .eq('student_id', params.id)
    .gte('checkin_date', monthFrom)
    .lte('checkin_date', monthTo)
    .order('checkin_date', { ascending: false })

  const checkins = (checkinsRaw ?? []) as {
    id: string
    partner: 'wellhub' | 'totalpass'
    checkin_date: string
    session_id: string | null
    validation: string
    created_at: string
  }[]
```

E passar as props novas ao `<StudentProfileClient ... />` (adicionar dentro do JSX existente, junto das outras props):

```tsx
          paymentType={student.payment_type}
          wellhubId={student.wellhub_id}
          totalpassId={student.totalpass_id}
          monthlyTarget={student.monthly_checkin_target}
          checkins={checkins}
```

- [ ] **Step 2: StudentProfileClient.tsx — props, estado e handlers**

Adicionar ao import de actions (após a linha do `adminSubscribeStudentToPlan`):

```ts
import { setStudentPartner, recordCheckin } from '@/features/checkin/actions'
```

Adicionar à `interface StudentProfileClientProps` (antes do fechamento `}`):

```ts
  paymentType: string
  wellhubId: string | null
  totalpassId: string | null
  monthlyTarget: number
  checkins: {
    id: string
    partner: 'wellhub' | 'totalpass'
    checkin_date: string
    session_id: string | null
    validation: string
    created_at: string
  }[]
```

Adicionar os parâmetros desestruturados na função (após `currentSubscription = null,`):

```ts
  paymentType,
  wellhubId,
  totalpassId,
  monthlyTarget,
  checkins,
```

Adicionar os estados (após `const [showCancelPlanDialog, ...]`):

```ts
  const [partner, setPartner] = useState<'wellhub' | 'totalpass'>(
    paymentType === 'totalpass' ? 'totalpass' : 'wellhub',
  )
  const [partnerId, setPartnerId] = useState(
    (paymentType === 'totalpass' ? totalpassId : wellhubId) ?? '',
  )
  const [targetInput, setTargetInput] = useState(String(monthlyTarget))
  const [linkedPartner, setLinkedPartner] = useState<string>(paymentType)
  const [checkinList, setCheckinList] = useState(checkins)
```

Adicionar os handlers (junto dos outros `handle...`):

```ts
  function handleSavePartner() {
    const target = parseInt(targetInput, 10)
    if (Number.isNaN(target) || target < 0) {
      setError('Meta mensal inválida.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await setStudentPartner(studentId, { partner, partnerId, monthlyTarget: target })
      if (result.error) {
        setError(result.error)
        return
      }
      setLinkedPartner(partner)
      notify('Parceiro vinculado.')
    })
  }

  function handleRecordCheckin() {
    if (linkedPartner !== 'wellhub' && linkedPartner !== 'totalpass') return
    setError(null)
    startTransition(async () => {
      const result = await recordCheckin(studentId, linkedPartner as 'wellhub' | 'totalpass')
      if (result.error) {
        setError(result.error)
        return
      }
      setCheckinList((prev) => [
        {
          id: crypto.randomUUID(),
          partner: linkedPartner as 'wellhub' | 'totalpass',
          checkin_date: new Date().toISOString().slice(0, 10),
          session_id: null,
          validation: 'manual',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ])
      notify('Check-in registrado.')
    })
  }
```

- [ ] **Step 3: StudentProfileClient.tsx — a seção visual**

Adicionar este bloco JSX dentro do return do componente, logo antes do fechamento do container (perto das outras seções, ex.: após a seção de plano/assinatura):

```tsx
      {/* Wellhub / TotalPass */}
      <section className="pt-4 border-t border-surface-border">
        <h3 className="text-sm font-semibold text-white mb-2">Wellhub / TotalPass</h3>

        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-400">
            Parceiro
            <select
              value={partner}
              onChange={(e) => setPartner(e.target.value as 'wellhub' | 'totalpass')}
              className="mt-1 block bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="wellhub">Wellhub</option>
              <option value="totalpass">TotalPass</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">
            ID do parceiro
            <Input value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="mt-1" />
          </label>
          <label className="text-xs text-slate-400">
            Meta mensal
            <Input
              type="number"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="mt-1 w-24"
            />
          </label>
          <Button onClick={handleSavePartner} disabled={isPending} variant="secondary">
            Salvar vínculo
          </Button>
        </div>

        {(linkedPartner === 'wellhub' || linkedPartner === 'totalpass') && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-300">
                {checkinList.length} / {monthlyTarget} check-ins no mês
                {checkinList.length < monthlyTarget && (
                  <span className="text-yellow-400"> · faltam {monthlyTarget - checkinList.length}</span>
                )}
                {checkinList.length > monthlyTarget && monthlyTarget > 0 && (
                  <span className="text-green-400"> · {checkinList.length - monthlyTarget} adiantado(s)</span>
                )}
              </p>
              <Button onClick={handleRecordCheckin} disabled={isPending}>
                Registrar check-in
              </Button>
            </div>
            <ul className="space-y-1">
              {checkinList.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between text-xs px-3 py-2 bg-surface-card border border-surface-border rounded-lg"
                >
                  <span className="text-white">
                    {new Date(c.checkin_date).toLocaleDateString('pt-BR')}
                    {c.session_id && <span className="text-green-400"> · presença em aula</span>}
                  </span>
                  <Badge variant={c.partner === 'wellhub' ? 'success' : 'warning'}>
                    {c.partner === 'wellhub' ? 'Wellhub' : 'TotalPass'}
                  </Badge>
                </li>
              ))}
              {checkinList.length === 0 && (
                <li className="text-slate-500 text-xs px-1">Nenhum check-in neste mês.</li>
              )}
            </ul>
          </div>
        )}
      </section>
```

> Observação: confirme que `Badge` aceita as variantes `success`/`warning` (usadas em [AttendanceSheet.tsx](../../app/(admin)/admin/alunos/[id]/../../../features/aulas/AttendanceSheet.tsx)). Se os nomes diferirem em `components/ui/Badge.tsx`, use as variantes existentes equivalentes.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/(admin)/admin/alunos/[id]/page.tsx app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx
git commit -m "feat(checkin): UI de vinculo e registro de check-in no perfil do aluno"
```

---

## Task 8: Verificação final

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — incluindo `lib/checkin/validator.test.ts` e `lib/checkin/progress.test.ts`. (Falhas no diretório aninhado `octogent/` são alheias a esta mudança — ignorar.)

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (dev/staging)**

Com `npm run dev`, como admin em `/admin/alunos/<id>`:
1. Vincular o aluno a Wellhub com um ID e meta mensal (ex.: 8) → salvar; conferir que `payment_type` virou `wellhub`.
2. Clicar "Registrar check-in" num dia sem aula → aparece na lista, contador sobe, **sem** "presença em aula".
3. Garantir uma matrícula fixa + reserva confirmada numa sessão de hoje; registrar check-in hoje → aparece com "presença em aula" e cria `attendance` (source=wellhub).
4. Repetir além da meta → mostra "adiantado(s)".

- [ ] **Step 4: Commit (se houver ajustes do smoke)**

```bash
git add -A
git commit -m "test(checkin): ajustes apos verificacao manual"
```

---

## Self-Review — cobertura do spec

- Tabela `checkins` + enum + meta + RLS → Task 1.
- Tipos → Task 2.
- Adaptador/validação (manual agora) → Task 3.
- Progresso mensal → Task 4.
- Vincular aluno (payment_type + ID + meta) → Task 5 + UI Task 7.
- `recordCheckin` (validação, idempotência, presença em aula, progresso) → Task 6.
- Painel feitos × faltantes + registro de check-in → Task 7.
- Testes → Tasks 3, 4 (puros) + Task 8 (suite + smoke).
- Fora de escopo (adaptadores reais, self-service) → não incluídos, conforme spec.
