# Melhorias Beach Tennis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar 5 melhorias independentes: limpeza de banco, bug fix plano avulso, visualização de colegas por sessão, lista de espera com notificações progressivas via Vercel Cron, e créditos extras não-expiráveis para cancelamentos de aula fixa.

**Architecture:** Cada item é independente. A lista de espera (item 4) é a mais complexa: nova tabela `waitlists`, server actions em `waitlistActions.ts` (sem circular dependency com `actions.ts`), e Vercel Cron a cada 15 min. Créditos extras são uma extensão do `cancelBooking` existente. Ver colegas é um novo componente client-side alimentado pelo server component de agendamento.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (PostgreSQL + RLS), Vitest, Tailwind CSS, Vercel Cron

**Spec:** `docs/superpowers/specs/2026-06-02-melhorias-beach-tennis.md`

---

## File Map

| Arquivo | Ação | Task |
|---|---|---|
| `scripts/cleanup-db.sql` | Criar | 1 |
| `app/(admin)/alunos/page.tsx` | Modificar | 2 |
| `features/aulas/actions.ts` | Modificar | 3, 8 |
| `app/(dashboard)/perfil/page.tsx` | Modificar | 3 |
| `features/aulas/SessionAttendees.tsx` | Criar | 4 |
| `app/(dashboard)/agendar/page.tsx` | Modificar | 4, 7 |
| `features/aulas/AgendarClient.tsx` | Modificar | 4, 7 |
| `features/aulas/BookingForm.tsx` | Modificar | 7 |
| `supabase/migrations/20260602000000_waitlists.sql` | Criar | 5 |
| `types/index.ts` | Modificar | 5 |
| `features/aulas/waitlistActions.ts` | Criar | 6 |
| `app/api/cron/waitlist-notifications/route.ts` | Criar | 9 |
| `vercel.json` | Criar | 9 |

---

## Task 1: Script de limpeza de banco

**Files:**
- Create: `scripts/cleanup-db.sql`

- [ ] **Step 1: Criar o script**

```sql
-- scripts/cleanup-db.sql
-- ATENÇÃO: Execute apenas no Supabase SQL Editor. Irreversível.
-- Mantém apenas o usuário admin Hudson Barros.

-- ============================================================
-- PASSO 1: Verificação — confirme o que será deletado
-- ============================================================
SELECT id, email, created_at
FROM auth.users
ORDER BY created_at;

-- ============================================================
-- PASSO 2: Verificação — confirme que Hudson Barros existe
-- ============================================================
SELECT au.id, au.email, p.full_name, p.role
FROM auth.users au
JOIN public.profiles p ON p.id = au.id
WHERE p.full_name ILIKE '%hudson%' OR au.email ILIKE '%hudson%';

-- ============================================================
-- PASSO 3: DELETE — substitua 'EMAIL_DO_HUDSON' pelo email real
-- ============================================================
-- Descomente e execute SOMENTE após confirmar os passos 1 e 2:

-- DELETE FROM auth.users
-- WHERE email != 'EMAIL_DO_HUDSON';

-- O cascade de FK apaga automaticamente:
--   profiles, enrollments, student_subscriptions,
--   session_bookings, credit_transactions, waitlists, payments, etc.

-- ============================================================
-- PASSO 4 (opcional): Limpar planos inativos
-- ============================================================
-- DELETE FROM public.subscription_plans WHERE is_active = false;

-- ============================================================
-- PASSO 5: Verificação final
-- ============================================================
SELECT au.email, p.full_name, p.role
FROM auth.users au
JOIN public.profiles p ON p.id = au.id;
```

- [ ] **Step 2: Commit**

```bash
git add scripts/cleanup-db.sql
git commit -m "chore: script de limpeza de banco de dados de desenvolvimento"
```

- [ ] **Step 3: Executar o script**

1. Abra o Supabase Dashboard → SQL Editor
2. Cole o conteúdo de `scripts/cleanup-db.sql`
3. Execute o Passo 1 (SELECT) para ver todos os usuários
4. Execute o Passo 2 para confirmar o email de Hudson Barros
5. Edite o Passo 3 com o email real, descomente e execute
6. Execute o Passo 5 para verificar que apenas Hudson permanece

---

## Task 2: Bug fix "plano avulso" na lista de alunos

**Files:**
- Modify: `app/(admin)/alunos/page.tsx:47-60` (adicionar query de subscriptions)

O bug: a lista exibe `payment_type` (`per_class` → "Avulso") mesmo para assinantes que têm um plano real. Fix: buscar plano ativo da `student_subscriptions`.

- [ ] **Step 1: Adicionar query de subscriptions após a query de enrollments (linha ~57)**

No arquivo `app/(admin)/alunos/page.tsx`, após o bloco `const enrollCountMap = ...` (linha ~64), adicione:

```typescript
  // Fetch active plan name per subscriber student
  const { data: subsRaw } =
    studentIds.length > 0
      ? await adminClient
          .from('student_subscriptions')
          .select('student_id, plan:subscription_plans(name)')
          .in('student_id', studentIds)
          .eq('status', 'active')
      : { data: [] }

  const planNameMap = new Map<string, string>()
  for (const s of (subsRaw ?? []) as { student_id: string; plan: { name: string } | { name: string }[] | null }[]) {
    const planObj = Array.isArray(s.plan) ? s.plan[0] : s.plan
    if (planObj?.name) planNameMap.set(s.student_id, planObj.name)
  }
```

- [ ] **Step 2: Atualizar a lógica de exibição do campo "Plano" no card (dentro do `.map()`)**

Substitua o trecho que exibe o plano no card (dentro do `students.map(...)`):

```typescript
// ANTES (linha ~144):
<span className={student.contract_active ? 'text-green-400' : 'text-red-400'}>
  {paymentLabel[student.payment_type] ?? student.payment_type}
  {!student.contract_active && ' (inativo)'}
</span>

// DEPOIS:
<span className={student.contract_active ? 'text-green-400' : 'text-red-400'}>
  {student.payment_type === 'subscriber'
    ? (planNameMap.get(student.id) ?? 'Mensalista (sem plano)')
    : (paymentLabel[student.payment_type] ?? student.payment_type)}
  {!student.contract_active && ' (inativo)'}
</span>
```

- [ ] **Step 3: Verificar manualmente no browser**

Abra `/admin/alunos`. Alunos `subscriber` devem mostrar o nome do plano (ex: "Plano 2x/sem") e não "Avulso".

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/alunos/page.tsx
git commit -m "fix: exibir nome do plano real em vez de 'Avulso' na lista de alunos"
```

---

## Task 3: Créditos extras não-expiráveis + seção "Meus Créditos"

**Files:**
- Modify: `features/aulas/actions.ts` (função `cancelBooking`)
- Modify: `app/(dashboard)/perfil/page.tsx`

- [ ] **Step 1: Atualizar `cancelBooking` em `features/aulas/actions.ts`**

Localize o bloco `// Refund credit if applicable` (por volta da linha 222). Substitua o bloco inteiro:

```typescript
  // Refund credit if applicable
  if (refundEligible && booking.credit_used) {
    // Fetch credit_expiry_days from system_settings (default 30)
    let expiryDays = 30
    const { data: settings } = await adminClient
      .from('system_settings')
      .select('credit_expiry_days')
      .single()
    if (settings?.credit_expiry_days) expiryDays = settings.credit_expiry_days

    const expiry = getMakeupCreditExpiry(new Date(), expiryDays)

    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'refunded',
      amount: 1,
      reason: `Cancelamento com reposição — sessão ${session.session_date}`,
      session_id: booking.session_id,
      expires_at: expiry.toISOString(),
    })

    // Update cached balance
    const { data: profile } = await adminClient
      .from('profiles')
      .select('credits_balance')
      .eq('id', user.id)
      .single()

    if (profile) {
      await adminClient
        .from('profiles')
        .update({ credits_balance: profile.credits_balance + 1 })
        .eq('id', user.id)
    }
  }
```

pelo novo bloco:

```typescript
  // Credit logic: extra (non-expiring) for fixed enrollment; makeup (30 days) for paid avulso
  if (refundEligible) {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('credits_balance, payment_type')
      .eq('id', user.id)
      .single()

    if (profile) {
      if (booking.from_enrollment && profile.payment_type === 'subscriber') {
        // Extra credit: does not expire while contract is active
        await adminClient.from('credit_transactions').insert({
          student_id: user.id,
          type: 'refunded',
          amount: 1,
          reason: `Cancelamento de aula fixa — crédito extra (${session.session_date})`,
          session_id: booking.session_id,
          expires_at: null,
        })
        await adminClient
          .from('profiles')
          .update({ credits_balance: profile.credits_balance + 1 })
          .eq('id', user.id)
      } else if (booking.credit_used) {
        // Makeup credit for paid avulso booking: expires in N days
        let expiryDays = 30
        const { data: settings } = await adminClient
          .from('system_settings')
          .select('credit_expiry_days')
          .single()
        if (settings?.credit_expiry_days) expiryDays = settings.credit_expiry_days

        const expiry = getMakeupCreditExpiry(new Date(), expiryDays)
        await adminClient.from('credit_transactions').insert({
          student_id: user.id,
          type: 'refunded',
          amount: 1,
          reason: `Cancelamento com reposição — sessão ${session.session_date}`,
          session_id: booking.session_id,
          expires_at: expiry.toISOString(),
        })
        await adminClient
          .from('profiles')
          .update({ credits_balance: profile.credits_balance + 1 })
          .eq('id', user.id)
      }
    }
  }
```

- [ ] **Step 2: Adicionar seção "Meus Créditos" em `app/(dashboard)/perfil/page.tsx`**

Após a query de `payments` (linha ~86), adicione a query de créditos:

```typescript
  // Fetch credit transactions (refunded credits available to use)
  const { data: creditTransactionsRaw } = await adminClient
    .from('credit_transactions')
    .select('id, type, amount, reason, created_at, expires_at')
    .eq('student_id', user.id)
    .eq('type', 'refunded')
    .gt('amount', 0)
    .order('created_at', { ascending: false })
    .limit(20)

  const creditTransactions = (creditTransactionsRaw ?? []) as {
    id: string
    type: string
    amount: number
    reason: string
    created_at: string
    expires_at: string | null
  }[]
```

Depois, dentro do JSX, após a seção "Créditos" existente (linha ~124), adicione:

```tsx
      {/* Histórico de Créditos Extras */}
      {!isWellhubOrTotalpass && creditTransactions.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Meus Créditos
          </h2>
          <div className="space-y-2">
            {creditTransactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-card border border-surface-border rounded-xl text-sm"
              >
                <div className="min-w-0">
                  <p className="text-white text-sm truncate">{t.reason}</p>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {new Date(t.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-green-400 font-semibold">+{t.amount}</p>
                  {t.expires_at ? (
                    <p className="text-xs text-slate-500">
                      Expira {new Date(t.expires_at).toLocaleDateString('pt-BR')}
                    </p>
                  ) : (
                    <p className="text-xs text-green-500">Sem vencimento</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 3: Commit**

```bash
git add features/aulas/actions.ts app/\(dashboard\)/perfil/page.tsx
git commit -m "feat: créditos extras não-expiráveis para cancelamento de aula fixa"
```

---

## Task 4: Componente SessionAttendees + ver colegas na página de agendamento

**Files:**
- Create: `features/aulas/SessionAttendees.tsx`
- Modify: `app/(dashboard)/agendar/page.tsx`
- Modify: `features/aulas/AgendarClient.tsx`

- [ ] **Step 1: Criar `features/aulas/SessionAttendees.tsx`**

```typescript
'use client'
// features/aulas/SessionAttendees.tsx

import { useState } from 'react'

interface SessionAttendeesProps {
  attendees: string[]
  totalSpots: number
  sessionDate: string
}

export function SessionAttendees({ attendees, totalSpots, sessionDate }: SessionAttendeesProps) {
  const [open, setOpen] = useState(false)
  const count = attendees.length

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1"
      >
        <span>👥 {count}/{totalSpots} alunos</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="mt-2 pl-2 space-y-1">
          {count === 0 ? (
            <li className="text-xs text-slate-500">Nenhum aluno confirmado ainda.</li>
          ) : (
            attendees.map((name, i) => (
              <li key={i} className="text-xs text-slate-300">
                {name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Adicionar import de `createAdminClient` e fetch de attendees em `app/(dashboard)/agendar/page.tsx`**

No topo do arquivo, adicione `createAdminClient` ao import existente do Supabase:

```typescript
import { createClient, createAdminClient } from '@/lib/supabase/server'
```

Após o bloco `const sessionsByClass = ...` (linha ~107), adicione (usando `adminClient` para acessar dados de outros alunos sem bloqueio de RLS):

```typescript
  const adminClient = createAdminClient()

  // Fetch confirmed booking attendees per session (adminClient — outros alunos, bypassa RLS)
  const { data: bookingAttendeesRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('session_bookings')
          .select('session_id, profiles(full_name)')
          .in('session_id', sessionIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const sessionAttendeesMap: Record<string, string[]> = {}
  for (const b of (bookingAttendeesRaw ?? []) as { session_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const profile = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
    if (profile?.full_name) {
      sessionAttendeesMap[b.session_id] = [
        ...(sessionAttendeesMap[b.session_id] ?? []),
        profile.full_name,
      ]
    }
  }

  // Enrollment fallback: fixed students per class (used when no explicit bookings yet)
  const { data: enrollAttendeesRaw } =
    classIds.length > 0
      ? await adminClient
          .from('enrollments')
          .select('class_id, profiles(full_name)')
          .in('class_id', classIds)
          .eq('is_active', true)
      : { data: [] }

  const classAttendeesMap: Record<string, string[]> = {}
  for (const e of (enrollAttendeesRaw ?? []) as { class_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const profile = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    if (profile?.full_name) {
      classAttendeesMap[e.class_id] = [
        ...(classAttendeesMap[e.class_id] ?? []),
        profile.full_name,
      ]
    }
  }
```

- [ ] **Step 3: Passar `sessionAttendeesMap` e `classAttendeesMap` para `AgendarClient`**

No JSX de `agendar/page.tsx`, atualize a chamada do `AgendarClient`:

```tsx
                {classSessions.length > 0 && (
                  <AgendarClient
                    class_={c}
                    sessions={classSessions}
                    studentId={user.id}
                    studentLevel={studentProfile.level}
                    isDependent={studentProfile.is_dependent}
                    dailyBookingCounts={dailyBookingCounts}
                    sessionAttendeesMap={sessionAttendeesMap}
                    classAttendeesMap={classAttendeesMap}
                  />
                )}
```

- [ ] **Step 4: Atualizar `features/aulas/AgendarClient.tsx` para aceitar e renderizar attendees**

Substitua o conteúdo completo do arquivo:

```typescript
'use client'
// features/aulas/AgendarClient.tsx

import { useState } from 'react'
import { BookingForm } from './BookingForm'
import { bookSession } from './actions'
import { SessionAttendees } from './SessionAttendees'
import { Button } from '@/components/ui/Button'
import type { Class, ClassSession, StudentLevel } from '@/types'

interface AgendarClientProps {
  class_: Class
  sessions: ClassSession[]
  studentId: string
  studentLevel: StudentLevel
  isDependent: boolean
  dailyBookingCounts: Record<string, number>
  sessionAttendeesMap: Record<string, string[]>
  classAttendeesMap: Record<string, string[]>
}

export function AgendarClient({
  class_: c,
  sessions,
  studentLevel,
  isDependent,
  dailyBookingCounts,
  sessionAttendeesMap,
  classAttendeesMap,
}: AgendarClientProps) {
  const [expanded, setExpanded] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleBook(sessionId: string): Promise<{ error?: string }> {
    const result = await bookSession(sessionId)
    if (!result.error) {
      setSuccess(true)
      setExpanded(false)
    }
    return result
  }

  if (success) {
    return (
      <div className="px-1 py-2">
        <p className="text-xs text-green-400">Agendamento confirmado!</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSuccess(false)}
          className="mt-1"
        >
          Agendar outra sessão
        </Button>
      </div>
    )
  }

  return (
    <div className="px-1">
      {/* Attendees per session (always visible, collapsed by default) */}
      <div className="mb-2 space-y-1">
        {sessions.map((s) => {
          const attendees = sessionAttendeesMap[s.id] ?? classAttendeesMap[c.id] ?? []
          return (
            <SessionAttendees
              key={s.id}
              attendees={attendees}
              totalSpots={c.max_students}
              sessionDate={s.session_date}
            />
          )
        })}
      </div>

      {!expanded ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setExpanded(true)}
          className="w-full mt-1"
        >
          Ver sessões disponíveis
        </Button>
      ) : (
        <div>
          <BookingForm
            class_={c}
            sessions={sessions}
            studentLevel={studentLevel}
            isDependent={isDependent}
            dailyBookingCounts={dailyBookingCounts}
            onBook={handleBook}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
            className="w-full mt-2"
          >
            Fechar
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Verificar no browser**

Abra `/agendar`. Para cada turma, deve aparecer "👥 X/Y alunos" por sessão, clicável para expandir a lista de nomes.

- [ ] **Step 6: Commit**

```bash
git add features/aulas/SessionAttendees.tsx features/aulas/AgendarClient.tsx app/\(dashboard\)/agendar/page.tsx
git commit -m "feat: ver colegas confirmados por sessão na página de agendamento"
```

---

## Task 5: Migration `waitlists` + tipo TypeScript

**Files:**
- Create: `supabase/migrations/20260602000000_waitlists.sql`
- Modify: `types/index.ts`

- [ ] **Step 1: Criar a migration**

```sql
-- supabase/migrations/20260602000000_waitlists.sql

create table waitlists (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references class_sessions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  position int not null default 1,
  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'accepted', 'expired', 'cancelled')),
  joined_at timestamptz not null default now(),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(session_id, student_id)
);

create index waitlists_session_status_idx on waitlists (session_id, status, position, joined_at);
create index waitlists_student_idx on waitlists (student_id);

-- RLS
alter table waitlists enable row level security;

-- Students can see their own waitlist entries
create policy "student_select_own_waitlist"
  on waitlists for select
  using (student_id = auth.uid());

-- Students can insert their own waitlist entries (server action uses service role, so this is for safety)
create policy "student_insert_own_waitlist"
  on waitlists for insert
  with check (student_id = auth.uid());

-- Students can update their own waitlist entries
create policy "student_update_own_waitlist"
  on waitlists for update
  using (student_id = auth.uid());

-- Admins can see all
create policy "admin_all_waitlists"
  on waitlists for all
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );
```

- [ ] **Step 2: Adicionar tipo `Waitlist` em `types/index.ts`**

Após a interface `DayUseBooking`, adicione:

```typescript
export type WaitlistStatus = 'waiting' | 'offered' | 'accepted' | 'expired' | 'cancelled'

export interface Waitlist {
  id: string
  session_id: string
  student_id: string
  position: number
  status: WaitlistStatus
  joined_at: string
  notified_at: string | null
  created_at: string
}
```

- [ ] **Step 3: Aplicar a migration**

Execute no Supabase SQL Editor ou via CLI:
```bash
# Se tiver supabase CLI configurado:
npx supabase db push

# Ou cole o conteúdo da migration no SQL Editor do Supabase Dashboard
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602000000_waitlists.sql types/index.ts
git commit -m "feat: migration e tipos para tabela waitlists"
```

---

## Task 6: Server actions da lista de espera

**Files:**
- Create: `features/aulas/waitlistActions.ts`

Esta task implementa: `offerWaitlistSpot`, `joinWaitlist`, `leaveWaitlist`, `acceptWaitlistSpot`.
**Importante:** `waitlistActions.ts` não importa de `actions.ts` — sem circular dependency.

- [ ] **Step 1: Criar `features/aulas/waitlistActions.ts`**

```typescript
'use server'
// features/aulas/waitlistActions.ts

import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { WaitlistStatus } from '@/types'

// ---------------------------------------------------------------------------
// offerWaitlistSpot — chamado ao abrir uma vaga (cancelamento ou cron)
// ---------------------------------------------------------------------------

export async function offerWaitlistSpot(sessionId: string): Promise<void> {
  const adminClient = createAdminClient()

  // Find next 'waiting' entry (lowest position, then earliest joined_at)
  const { data: next } = await adminClient
    .from('waitlists')
    .select('id, student_id, session_id')
    .eq('session_id', sessionId)
    .eq('status', 'waiting')
    .order('position', { ascending: true })
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!next) return // No one waiting

  const now = new Date().toISOString()

  // Offer the spot
  await adminClient
    .from('waitlists')
    .update({ status: 'offered' as WaitlistStatus, notified_at: now })
    .eq('id', next.id)

  // Fetch session info for notification body
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('session_date, class:classes(name)')
    .eq('id', sessionId)
    .single()

  const classRaw = Array.isArray(session?.class) ? session!.class[0] : session?.class
  const className = (classRaw as { name: string } | null)?.name ?? 'sua aula'

  const deadline = new Date(Date.now() + 60 * 60 * 1000)
  const deadlineStr = deadline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  // Insert in-app notification
  await adminClient.from('notifications').insert({
    user_id: next.student_id,
    type: 'waitlist_offer',
    title: 'Vaga disponível!',
    body: `Uma vaga abriu em ${className} (${session?.session_date}). Confirme sua presença até ${deadlineStr}.`,
    read: false,
  })
}

// ---------------------------------------------------------------------------
// joinWaitlist — aluno entra na fila de espera de uma sessão cheia
// ---------------------------------------------------------------------------

export async function joinWaitlist(sessionId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Fetch session + class
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students)')
    .eq('id', sessionId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta sessão não está disponível.' }

  const classRaw = Array.isArray(session.class) ? session.class[0] : session.class
  const maxStudents = (classRaw as { max_students: number } | null)?.max_students ?? 0

  // Confirm session is actually full
  const { count: bookedCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((bookedCount ?? 0) < maxStudents) {
    return { error: 'Esta sessão ainda tem vagas. Use o agendamento normal.' }
  }

  // Check no existing booking
  const { count: existingBooking } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('student_id', user.id)
    .eq('status', 'confirmed')

  if ((existingBooking ?? 0) > 0) {
    return { error: 'Você já tem um agendamento nesta sessão.' }
  }

  // Check no existing waitlist entry
  const { count: existingWaitlist } = await adminClient
    .from('waitlists')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('student_id', user.id)
    .in('status', ['waiting', 'offered'])

  if ((existingWaitlist ?? 0) > 0) {
    return { error: 'Você já está na lista de espera desta sessão.' }
  }

  // Calculate position (count of active waitlist entries + 1)
  const { count: activeCount } = await adminClient
    .from('waitlists')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .in('status', ['waiting', 'offered'])

  const position = (activeCount ?? 0) + 1

  // Check waitlist capacity (max = max_students)
  if (position > maxStudents) {
    return { error: 'A lista de espera para esta sessão está cheia.' }
  }

  const { error: insertErr } = await adminClient.from('waitlists').insert({
    session_id: sessionId,
    student_id: user.id,
    position,
  })

  if (insertErr) return { error: 'Erro ao entrar na lista de espera. Tente novamente.' }

  return {}
}

// ---------------------------------------------------------------------------
// leaveWaitlist — aluno sai voluntariamente da fila
// ---------------------------------------------------------------------------

export async function leaveWaitlist(waitlistId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  const { data: entry } = await adminClient
    .from('waitlists')
    .select('id, student_id, status, session_id')
    .eq('id', waitlistId)
    .single()

  if (!entry) return { error: 'Entrada não encontrada.' }
  if (entry.student_id !== user.id) return { error: 'Sem permissão.' }
  if (!['waiting', 'offered'].includes(entry.status)) {
    return { error: 'Você não está mais na lista de espera.' }
  }

  await adminClient
    .from('waitlists')
    .update({ status: 'cancelled' as WaitlistStatus })
    .eq('id', waitlistId)

  // If they had an offered spot, advance queue to next person
  if (entry.status === 'offered') {
    await offerWaitlistSpot(entry.session_id)
  }

  return {}
}

// ---------------------------------------------------------------------------
// acceptWaitlistSpot — aluno confirma a vaga oferecida
// ---------------------------------------------------------------------------

export async function acceptWaitlistSpot(waitlistId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Fetch waitlist entry
  const { data: entry } = await adminClient
    .from('waitlists')
    .select('id, session_id, student_id, status, notified_at')
    .eq('id', waitlistId)
    .single()

  if (!entry) return { error: 'Entrada não encontrada.' }
  if (entry.student_id !== user.id) return { error: 'Sem permissão.' }
  if (entry.status !== 'offered') return { error: 'Esta vaga não está mais disponível.' }

  // Check 1-hour acceptance window
  if (!entry.notified_at) return { error: 'Erro interno: notified_at ausente.' }
  const notifiedAt = new Date(entry.notified_at)
  const deadline = new Date(notifiedAt.getTime() + 60 * 60 * 1000)
  if (new Date() > deadline) {
    return { error: 'O prazo para confirmar a vaga expirou.' }
  }

  // Verify session still has capacity
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students)')
    .eq('id', entry.session_id)
    .single()

  if (!session || session.status !== 'scheduled') {
    return { error: 'Esta sessão não está mais disponível.' }
  }

  const classRaw = Array.isArray(session.class) ? session.class[0] : session.class
  const maxStudents = (classRaw as { max_students: number } | null)?.max_students ?? 0

  const { count: bookedCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', entry.session_id)
    .eq('status', 'confirmed')

  if ((bookedCount ?? 0) >= maxStudents) {
    // Another booking slipped in — expire and advance queue
    await adminClient
      .from('waitlists')
      .update({ status: 'expired' as WaitlistStatus })
      .eq('id', waitlistId)
    await offerWaitlistSpot(entry.session_id)
    return { error: 'A vaga foi preenchida. O próximo da fila será notificado.' }
  }

  // Create the booking directly (validations already passed at joinWaitlist time)
  const { error: bookingErr } = await adminClient.from('session_bookings').insert({
    student_id: user.id,
    session_id: entry.session_id,
    type: 'extra',
    status: 'confirmed',
    from_enrollment: false,
    credit_used: false,
    booked_at: new Date().toISOString(),
  })

  if (bookingErr) return { error: 'Erro ao criar agendamento. Tente novamente.' }

  // Mark waitlist entry as accepted
  await adminClient
    .from('waitlists')
    .update({ status: 'accepted' as WaitlistStatus })
    .eq('id', waitlistId)

  return {}
}
```

- [ ] **Step 2: Commit**

```bash
git add features/aulas/waitlistActions.ts
git commit -m "feat: server actions para lista de espera (join, leave, accept, offer)"
```

---

## Task 7: UI da lista de espera — AgendarClient + agendar/page data

**Files:**
- Modify: `features/aulas/BookingForm.tsx`
- Modify: `features/aulas/AgendarClient.tsx`
- Modify: `app/(dashboard)/agendar/page.tsx`

- [ ] **Step 1: Adicionar `sessionBookedCounts` ao `BookingForm` para marcar sessões lotadas**

Em `features/aulas/BookingForm.tsx`, adicione a prop e atualize o warning:

```typescript
interface BookingFormProps {
  class_: Class
  sessions: ClassSession[]
  studentLevel: StudentLevel
  isDependent: boolean
  dailyBookingCounts: Record<string, number>
  sessionBookedCounts: Record<string, number>  // NEW
  onBook: (sessionId: string) => Promise<{ error?: string }>
}

export function BookingForm({
  class_: c,
  sessions,
  studentLevel,
  isDependent,
  dailyBookingCounts,
  sessionBookedCounts,  // NEW
  onBook,
}: BookingFormProps) {
  // ... (existing state unchanged)

  function getSessionWarning(session: ClassSession): string | null {
    if ((sessionBookedCounts[session.id] ?? 0) >= c.max_students) return 'Lotada'
    const count = dailyBookingCounts[session.session_date] ?? 0
    if (count >= 2) return '2 aulas nesse dia'
    return null
  }

  // ... rest of component unchanged
```

- [ ] **Step 2: Atualizar `AgendarClient` com props de waitlist e UI completa**

Substitua o conteúdo completo de `features/aulas/AgendarClient.tsx`:

```typescript
'use client'
// features/aulas/AgendarClient.tsx

import { useState, useTransition } from 'react'
import { BookingForm } from './BookingForm'
import { bookSession } from './actions'
import { joinWaitlist, leaveWaitlist, acceptWaitlistSpot } from './waitlistActions'
import { SessionAttendees } from './SessionAttendees'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Class, ClassSession, StudentLevel } from '@/types'

interface WaitlistEntry {
  id: string
  position: number
  status: 'waiting' | 'offered'
  notified_at: string | null
}

interface AgendarClientProps {
  class_: Class
  sessions: ClassSession[]
  studentId: string
  studentLevel: StudentLevel
  isDependent: boolean
  dailyBookingCounts: Record<string, number>
  sessionBookedCounts: Record<string, number>
  studentWaitlist: Record<string, WaitlistEntry>
  sessionWaitlistCounts: Record<string, number>
  sessionAttendeesMap: Record<string, string[]>
  classAttendeesMap: Record<string, string[]>
}

export function AgendarClient({
  class_: c,
  sessions,
  studentLevel,
  isDependent,
  dailyBookingCounts,
  sessionBookedCounts,
  studentWaitlist,
  sessionWaitlistCounts,
  sessionAttendeesMap,
  classAttendeesMap,
}: AgendarClientProps) {
  const [expanded, setExpanded] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  async function handleBook(sessionId: string): Promise<{ error?: string }> {
    const result = await bookSession(sessionId)
    if (!result.error) {
      setSuccess(true)
      setExpanded(false)
    }
    return result
  }

  function handleJoin(sessionId: string) {
    startTransition(async () => {
      const result = await joinWaitlist(sessionId)
      if (result.error) setErrors((e) => ({ ...e, [sessionId]: result.error! }))
      else setErrors((e) => { const n = { ...e }; delete n[sessionId]; return n })
    })
  }

  function handleLeave(waitlistId: string, sessionId: string) {
    startTransition(async () => {
      const result = await leaveWaitlist(waitlistId)
      if (result.error) setErrors((e) => ({ ...e, [sessionId]: result.error! }))
      else setErrors((e) => { const n = { ...e }; delete n[sessionId]; return n })
    })
  }

  function handleAccept(waitlistId: string, sessionId: string) {
    startTransition(async () => {
      const result = await acceptWaitlistSpot(waitlistId)
      if (result.error) setErrors((e) => ({ ...e, [sessionId]: result.error! }))
      else { setSuccess(true); setExpanded(false) }
    })
  }

  const fullSessions = sessions.filter(
    (s) => (sessionBookedCounts[s.id] ?? 0) >= c.max_students,
  )

  if (success) {
    return (
      <div className="px-1 py-2">
        <p className="text-xs text-green-400">Agendamento confirmado!</p>
        <Button variant="ghost" size="sm" onClick={() => setSuccess(false)} className="mt-1">
          Agendar outra sessão
        </Button>
      </div>
    )
  }

  return (
    <div className="px-1 space-y-2">
      {/* Attendees per session */}
      <div className="space-y-1">
        {sessions.map((s) => {
          const attendees = sessionAttendeesMap[s.id] ?? classAttendeesMap[c.id] ?? []
          return (
            <SessionAttendees
              key={s.id}
              attendees={attendees}
              totalSpots={c.max_students}
              sessionDate={s.session_date}
            />
          )
        })}
      </div>

      {/* Waitlist banners for full sessions */}
      {fullSessions.map((s) => {
        const entry = studentWaitlist[s.id]
        const waitlistCount = sessionWaitlistCounts[s.id] ?? 0
        const sessionLabel = formatDate(s.session_date, 'EEE, dd/MM')
        const err = errors[s.id]

        if (entry?.status === 'offered') {
          const deadline = entry.notified_at
            ? new Date(new Date(entry.notified_at).getTime() + 60 * 60 * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '--:--'
          return (
            <div key={s.id} className="bg-brand-600/20 border border-brand-500/50 rounded-xl px-3 py-2">
              <p className="text-xs text-brand-400 font-semibold mb-1">
                🔔 Vaga disponível! {sessionLabel} — confirme até {deadline}
              </p>
              {err && <p className="text-xs text-red-400 mb-1">{err}</p>}
              <Button
                variant="primary"
                size="sm"
                loading={isPending}
                onClick={() => handleAccept(entry.id, s.id)}
              >
                Confirmar presença
              </Button>
            </div>
          )
        }

        if (entry?.status === 'waiting') {
          return (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-surface-card border border-surface-border rounded-xl">
              <p className="text-xs text-slate-400">
                {sessionLabel} — Fila: {entry.position}º de {waitlistCount}
              </p>
              {err && <p className="text-xs text-red-400">{err}</p>}
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleLeave(entry.id, s.id)}
                className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
              >
                Sair da fila
              </button>
            </div>
          )
        }

        return (
          <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-surface-card border border-surface-border rounded-xl">
            <p className="text-xs text-slate-400">
              {sessionLabel} — Lotada · Fila: {waitlistCount}/{c.max_students}
            </p>
            {err && <p className="text-xs text-red-400">{err}</p>}
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleJoin(s.id)}
              className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
            >
              Entrar na fila
            </button>
          </div>
        )
      })}

      {/* Booking form for non-full sessions */}
      {!expanded ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setExpanded(true)}
          className="w-full mt-1"
        >
          Ver sessões disponíveis
        </Button>
      ) : (
        <div>
          <BookingForm
            class_={c}
            sessions={sessions}
            studentLevel={studentLevel}
            isDependent={isDependent}
            dailyBookingCounts={dailyBookingCounts}
            sessionBookedCounts={sessionBookedCounts}
            onBook={handleBook}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
            className="w-full mt-2"
          >
            Fechar
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Adicionar queries de waitlist e session booked counts em `app/(dashboard)/agendar/page.tsx`**

Após o bloco `const classAttendeesMap` (do Task 4), adicione (`adminClient` já existe da Task 4, reutilize-o):

```typescript
  // Session confirmed booking counts — adminClient bypassa RLS (contagem de todos alunos)
  const { data: sessionBookedCountsRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('session_bookings')
          .select('session_id')
          .in('session_id', sessionIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const sessionBookedCounts: Record<string, number> = {}
  for (const b of (sessionBookedCountsRaw ?? []) as { session_id: string }[]) {
    sessionBookedCounts[b.session_id] = (sessionBookedCounts[b.session_id] ?? 0) + 1
  }

  // Student's own waitlist entries — supabase (user-scoped) é suficiente aqui
  const { data: studentWaitlistRaw } =
    sessionIds.length > 0
      ? await supabase
          .from('waitlists')
          .select('id, session_id, position, status, notified_at')
          .eq('student_id', user.id)
          .in('session_id', sessionIds)
          .in('status', ['waiting', 'offered'])
      : { data: [] }

  const studentWaitlist: Record<string, { id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }> = {}
  for (const w of (studentWaitlistRaw ?? []) as { id: string; session_id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }[]) {
    studentWaitlist[w.session_id] = w
  }

  // Waitlist counts per session — adminClient para ver todos na fila (não só o aluno atual)
  const { data: waitlistCountsRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('waitlists')
          .select('session_id')
          .in('session_id', sessionIds)
          .in('status', ['waiting', 'offered'])
      : { data: [] }

  const sessionWaitlistCounts: Record<string, number> = {}
  for (const w of (waitlistCountsRaw ?? []) as { session_id: string }[]) {
    sessionWaitlistCounts[w.session_id] = (sessionWaitlistCounts[w.session_id] ?? 0) + 1
  }
```

- [ ] **Step 4: Atualizar chamada do `AgendarClient` no JSX para passar todas as novas props**

No return do `agendar/page.tsx`, substitua a chamada do `AgendarClient`:

```tsx
                {classSessions.length > 0 && (
                  <AgendarClient
                    class_={c}
                    sessions={classSessions}
                    studentId={user.id}
                    studentLevel={studentProfile.level}
                    isDependent={studentProfile.is_dependent}
                    dailyBookingCounts={dailyBookingCounts}
                    sessionBookedCounts={sessionBookedCounts}
                    studentWaitlist={studentWaitlist}
                    sessionWaitlistCounts={sessionWaitlistCounts}
                    sessionAttendeesMap={sessionAttendeesMap}
                    classAttendeesMap={classAttendeesMap}
                  />
                )}
```

- [ ] **Step 5: Verificar no browser**

1. Para sessão com vagas: lista de alunos visível + botão "Ver sessões disponíveis" normal
2. Para sessão lotada: mostrar "Lotada · Fila: X/Y" + botão "Entrar na fila"
3. Ao entrar na fila: mostra posição + "Sair da fila"

- [ ] **Step 6: Commit**

```bash
git add features/aulas/BookingForm.tsx features/aulas/AgendarClient.tsx app/\(dashboard\)/agendar/page.tsx
git commit -m "feat: UI de lista de espera integrada na página de agendamento"
```

---

## Task 8: Integrar `offerWaitlistSpot` no `cancelBooking`

**Files:**
- Modify: `features/aulas/actions.ts`

- [ ] **Step 1: Adicionar import de `offerWaitlistSpot` no topo de `actions.ts`**

Após a linha `import type { StudentLevel, ClassType, BookingStatus, SessionStatus } from '@/types'`, adicione:

```typescript
import { offerWaitlistSpot } from './waitlistActions'
```

- [ ] **Step 2: Chamar `offerWaitlistSpot` ao final de `cancelBooking` antes do `return {}`**

Localize o `return {}` final de `cancelBooking` (após o bloco de créditos). Substitua:

```typescript
  return {}
}
```

por:

```typescript
  // Notify next person on waitlist if any
  await offerWaitlistSpot(booking.session_id)

  return {}
}
```

- [ ] **Step 3: Verificar comportamento**

1. Aluno A e aluno B: B entra na waitlist de uma sessão lotada
2. Aluno A cancela a aula → B recebe notificação na tabela `notifications`
3. Verificar no Supabase: `waitlists` entry de B com `status = 'offered'` e `notified_at` preenchido

- [ ] **Step 4: Commit**

```bash
git add features/aulas/actions.ts
git commit -m "feat: notificar lista de espera ao cancelar agendamento"
```

---

## Task 9: Vercel Cron endpoint + configuração

**Files:**
- Create: `app/api/cron/waitlist-notifications/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Criar o endpoint do cron**

```typescript
// app/api/cron/waitlist-notifications/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { offerWaitlistSpot } from '@/features/aulas/waitlistActions'

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  // Find 'offered' entries older than 1 hour
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: expired, error } = await adminClient
    .from('waitlists')
    .select('id, session_id')
    .eq('status', 'offered')
    .lt('notified_at', cutoff)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let processed = 0
  for (const entry of expired ?? []) {
    // Expire the current offered entry
    await adminClient
      .from('waitlists')
      .update({ status: 'expired' })
      .eq('id', entry.id)

    // Offer to next in queue
    await offerWaitlistSpot(entry.session_id)
    processed++
  }

  return NextResponse.json({ processed })
}
```

- [ ] **Step 2: Criar `vercel.json` na raiz do projeto**

```json
{
  "crons": [
    {
      "path": "/api/cron/waitlist-notifications",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Configurar variável de ambiente `CRON_SECRET`**

1. No Vercel Dashboard → seu projeto → Settings → Environment Variables
2. Adicione `CRON_SECRET` com um valor aleatório seguro (ex: `openssl rand -base64 32`)
3. Para desenvolvimento local, adicione ao `.env.local`:
   ```
   CRON_SECRET=seu_valor_aqui
   ```

- [ ] **Step 4: Verificar o endpoint localmente**

```bash
# Inicie o dev server
npm run dev

# Em outro terminal, teste o endpoint (substitua o secret):
curl -H "Authorization: Bearer seu_cron_secret" http://localhost:3000/api/cron/waitlist-notifications
# Esperado: {"processed":0}  (ou número de entradas expiradas processadas)
```

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/waitlist-notifications/route.ts vercel.json
git commit -m "feat: vercel cron para avançar fila de espera a cada 15 minutos"
```

---

## Checklist de verificação final

- [ ] Script de limpeza criado em `scripts/cleanup-db.sql` e executado no Supabase
- [ ] Lista de alunos mostra nome do plano real para subscribers
- [ ] Cancelamento de aula fixa (from_enrollment=true, subscriber) gera crédito sem expiração
- [ ] Seção "Meus Créditos" no perfil do aluno mostra créditos com/sem vencimento
- [ ] "👥 X/Y alunos" visível por sessão na página de agendamento
- [ ] Lista de nomes expande ao clicar
- [ ] Sessão lotada mostra "Entrar na fila" + contador da fila
- [ ] Entrar na fila → mostra posição + "Sair da fila"
- [ ] Vaga ofertada → banner com deadline + botão "Confirmar presença"
- [ ] Cancelamento de booking aciona notificação ao 1º da fila
- [ ] Cron expira entradas oferecidas há +1h e avança para o próximo
- [ ] `npm run build` sem erros de TypeScript
- [ ] `npm run lint` sem warnings
