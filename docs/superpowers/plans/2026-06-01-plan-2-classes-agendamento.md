# Beach Tennis App — Plano 2: Classes, Agendamento e Créditos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o núcleo do produto — admin gerencia turmas e sessões, alunos visualizam e agendam aulas, sistema de créditos controla uso e reembolso com regras de cancelamento.

**Architecture:** Server Actions para todas as mutações (`lib/actions/`). Server Components buscam dados direto no Supabase. Client Components para interatividade (booking form, cancel button). Admin usa `createAdminClient()` (bypassa RLS); aluno usa `createClient()` (respeita RLS + JWT do usuário).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (já configurado), Tailwind CSS, lucide-react, date-fns

**Spec:** `docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md` §4–§5

---

## Mapa de Arquivos

```
lib/actions/
  classes.ts         — admin CRUD de turmas
  sessions.ts        — gerar sessões do mês + queries
  bookings.ts        — agendar/cancelar sessão (validações + crédito)
  credits.ts         — adicionar/usar/reembolsar créditos
  enrollments.ts     — gerenciar horários fixos + auto-booking
  attendance.ts      — marcar presença (admin)
  trial.ts           — agendar aula experimental (público)

features/aulas/
  ClassCard.tsx      — card de turma com badge kids
  SessionCard.tsx    — card de sessão com estado de booking + botão cancelar
  CreditBadge.tsx    — exibe saldo de créditos

app/(admin)/
  dashboard/page.tsx            — visão geral admin
  grade/page.tsx                — lista de turmas
  grade/nova/page.tsx           — criar turma
  grade/[id]/page.tsx           — editar turma
  grade/sessoes/[sessionId]/page.tsx  — presença de uma sessão
  alunos/page.tsx               — lista de alunos (básico)
  alunos/[id]/page.tsx          — perfil do aluno + enrollments

app/(dashboard)/
  home/page.tsx      — próximas aulas + saldo créditos
  aulas/page.tsx     — minhas aulas (fixas + avulsas) + cancelar
  agendar/page.tsx   — turmas disponíveis + agendar

app/experimental/page.tsx      — formulário público (sem login)

app/api/
  sessions/generate/route.ts   — POST: gerar sessões de um mês
  credits/renew/route.ts       — POST: renovar créditos mensais (todos assinantes)
```

---

## Task 1: Server Actions — Classes (Admin CRUD)

**Files:**
- Create: `lib/actions/classes.ts`

- [ ] **1.1 Criar lib/actions/classes.ts**

```ts
// lib/actions/classes.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import type { Class, StudentLevel, ClassType } from '@/types'

export type ClassInput = {
  name: string
  description?: string
  level: StudentLevel
  type: ClassType
  day_of_week: number
  start_time: string
  end_time: string
  max_students: number
}

export async function getClasses(): Promise<Class[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .order('day_of_week')
    .order('start_time')
  if (error) return []
  return data
}

export async function getActiveClasses(): Promise<Class[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('is_active', true)
    .order('day_of_week')
    .order('start_time')
  if (error) return []
  return data
}

export async function createClass(input: ClassInput): Promise<{ error?: string; data?: Class }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('classes')
    .insert({ ...input, is_active: true })
    .select()
    .single()
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  return { data }
}

export async function updateClass(id: string, input: Partial<ClassInput>): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('classes').update(input).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  return {}
}

export async function toggleClassActive(id: string, isActive: boolean): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('classes').update({ is_active: isActive }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  return {}
}
```

- [ ] **1.2 Verificar TypeScript**

```bash
cd c:\beach-tennis-app && npx tsc --noEmit
```
Esperado: sem erros

- [ ] **1.3 Commit**

```bash
git add lib/actions/classes.ts
git commit -m "feat: add class management server actions"
```

---

## Task 2: Server Actions — Sessions

**Files:**
- Create: `lib/actions/sessions.ts`

- [ ] **2.1 Criar lib/actions/sessions.ts**

```ts
// lib/actions/sessions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getDatesForDayOfWeekInMonth, formatDate } from '@/lib/utils/dateHelpers'
import type { ClassSession, Class } from '@/types'

export type SessionWithClass = ClassSession & { class: Class; bookings_count: number }

/** Admin: gera todas as sessões de um mês para uma turma */
export async function generateSessionsForClass(
  classId: string,
  year: number,
  month: number, // 0-indexed
): Promise<{ error?: string; count?: number }> {
  const supabase = createAdminClient()

  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('day_of_week')
    .eq('id', classId)
    .single()
  if (clsErr || !cls) return { error: 'Turma não encontrada' }

  const dates = getDatesForDayOfWeekInMonth(year, month, cls.day_of_week)
  if (dates.length === 0) return { count: 0 }

  const sessions = dates.map((d) => ({
    class_id: classId,
    session_date: d.toISOString().split('T')[0],
    status: 'scheduled' as const,
  }))

  const { error } = await supabase
    .from('class_sessions')
    .upsert(sessions, { onConflict: 'class_id,session_date', ignoreDuplicates: true })
  if (error) return { error: error.message }

  revalidatePath('/admin/grade')
  return { count: sessions.length }
}

/** Admin: gera sessões de um mês para TODAS as turmas ativas */
export async function generateSessionsForMonth(
  year: number,
  month: number,
): Promise<{ error?: string; total?: number }> {
  const supabase = createAdminClient()
  const { data: classes, error } = await supabase
    .from('classes')
    .select('id, day_of_week')
    .eq('is_active', true)
  if (error) return { error: error.message }

  let total = 0
  for (const cls of classes ?? []) {
    const dates = getDatesForDayOfWeekInMonth(year, month, cls.day_of_week)
    if (dates.length === 0) continue
    const sessions = dates.map((d) => ({
      class_id: cls.id,
      session_date: d.toISOString().split('T')[0],
      status: 'scheduled' as const,
    }))
    const { error: upsertErr } = await supabase
      .from('class_sessions')
      .upsert(sessions, { onConflict: 'class_id,session_date', ignoreDuplicates: true })
    if (!upsertErr) total += sessions.length
  }

  revalidatePath('/admin/grade')
  revalidatePath('/agendar')
  return { total }
}

/** Sessões disponíveis para agendamento (não cheias, status=scheduled, futuras) */
export async function getAvailableSessions(): Promise<SessionWithClass[]> {
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('class_sessions')
    .select(`
      *,
      class:classes(*),
      bookings_count:session_bookings(count)
    `)
    .eq('status', 'scheduled')
    .gte('session_date', today)
    .order('session_date')
    .order('class(start_time)')
    .limit(60)
  if (error) return []

  return (data ?? []).map((s: any) => ({
    ...s,
    bookings_count: s.bookings_count?.[0]?.count ?? 0,
  }))
}

/** Sessões de uma turma específica */
export async function getSessionsForClass(classId: string): Promise<ClassSession[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('class_sessions')
    .select('*')
    .eq('class_id', classId)
    .order('session_date', { ascending: false })
    .limit(30)
  if (error) return []
  return data
}

/** Admin: detalhes de uma sessão com bookings e presença */
export async function getSessionDetail(sessionId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('class_sessions')
    .select(`
      *,
      class:classes(*),
      bookings:session_bookings(*, student:profiles(id, full_name, level, payment_type)),
      attendance:attendance(*, student:profiles(id, full_name))
    `)
    .eq('id', sessionId)
    .single()
  if (error) return null
  return data
}
```

- [ ] **2.2 TypeScript check**

```bash
npx tsc --noEmit
```
Esperado: sem erros

- [ ] **2.3 Commit**

```bash
git add lib/actions/sessions.ts
git commit -m "feat: add session generation and query server actions"
```

---

## Task 3: Server Actions — Bookings (agendar + cancelar)

**Files:**
- Create: `lib/actions/bookings.ts`
- Test: `lib/actions/bookings.test.ts`

- [ ] **3.1 Criar teste de validação de booking**

```ts
// lib/actions/bookings.test.ts
import { describe, it, expect } from 'vitest'
import { canBookSession } from './bookings'

describe('canBookSession', () => {
  const base = {
    studentLevel: 'C' as const,
    classLevel: 'C' as const,
    classType: 'adult' as const,
    isDependent: false,
    sessionStatus: 'scheduled' as const,
    bookingsCount: 3,
    maxStudents: 8,
    dailyBookings: 0,
    maxDailyBookings: 2,
    alreadyBooked: false,
  }

  it('allows valid booking', () => {
    const result = canBookSession(base)
    expect(result.allowed).toBe(true)
  })

  it('blocks when session is full', () => {
    const result = canBookSession({ ...base, bookingsCount: 8, maxStudents: 8 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('cheia')
  })

  it('blocks when daily limit reached', () => {
    const result = canBookSession({ ...base, dailyBookings: 2 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('limite diário')
  })

  it('blocks wrong level (D trying to book C)', () => {
    const result = canBookSession({ ...base, studentLevel: 'D', classLevel: 'C' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('nível')
  })

  it('blocks adult booking kids class', () => {
    const result = canBookSession({ ...base, classType: 'kids', isDependent: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('kids')
  })

  it('allows dependent booking kids class', () => {
    const result = canBookSession({ ...base, classType: 'kids', isDependent: true })
    expect(result.allowed).toBe(true)
  })

  it('blocks already booked', () => {
    const result = canBookSession({ ...base, alreadyBooked: true })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('já agendado')
  })

  it('blocks cancelled session', () => {
    const result = canBookSession({ ...base, sessionStatus: 'cancelled' })
    expect(result.allowed).toBe(false)
  })
})
```

- [ ] **3.2 Rodar teste — deve falhar**

```bash
cd c:\beach-tennis-app && npx vitest run lib/actions/bookings.test.ts
```
Esperado: FAIL "Cannot find module"

- [ ] **3.3 Criar lib/actions/bookings.ts**

```ts
// lib/actions/bookings.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import { canCancelWithRefund, getMakeupCreditExpiry } from '@/lib/utils/creditRules'
import type { StudentLevel, ClassType, SessionStatus } from '@/types'

// ─── Pure validation (exported for testing) ───────────────────────────────────

export type BookingValidationInput = {
  studentLevel: StudentLevel
  classLevel: StudentLevel
  classType: ClassType
  isDependent: boolean
  sessionStatus: SessionStatus
  bookingsCount: number
  maxStudents: number
  dailyBookings: number
  maxDailyBookings: number
  alreadyBooked: boolean
}

export function canBookSession(input: BookingValidationInput): { allowed: boolean; reason?: string } {
  if (input.sessionStatus !== 'scheduled')
    return { allowed: false, reason: 'Sessão não está disponível' }
  if (input.alreadyBooked)
    return { allowed: false, reason: 'Você já está agendado nesta aula' }
  if (input.bookingsCount >= input.maxStudents)
    return { allowed: false, reason: 'Turma cheia' }
  if (!canStudentAttendLevel(input.studentLevel, input.classLevel))
    return { allowed: false, reason: `Seu nível (${input.studentLevel}) não permite essa turma (${input.classLevel})` }
  if (input.classType === 'kids' && !input.isDependent)
    return { allowed: false, reason: 'Turma kids é exclusiva para alunos dependentes' }
  if (input.dailyBookings >= input.maxDailyBookings)
    return { allowed: false, reason: `Limite diário de ${input.maxDailyBookings} aulas atingido` }
  return { allowed: true }
}

// ─── Server Actions ────────────────────────────────────────────────────────────

export async function bookSession(sessionId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const adminClient = createAdminClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // Get student profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('level, is_dependent, payment_type, credits_balance')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Perfil não encontrado' }

  // Get session + class details
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('*, class:classes(*)')
    .eq('id', sessionId)
    .single()
  if (!session) return { error: 'Sessão não encontrada' }

  // Get system settings
  const { data: settings } = await adminClient
    .from('system_settings')
    .select('key, value')
    .in('key', ['max_daily_bookings'])
  const maxDaily = parseInt(settings?.find((s: any) => s.key === 'max_daily_bookings')?.value ?? '2')

  // Count existing confirmed bookings for that day
  const { count: dailyCount } = await supabase
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('status', 'confirmed')
    .in('session_id',
      (await adminClient
        .from('class_sessions')
        .select('id')
        .eq('session_date', session.session_date)
        .then(r => r.data?.map((s: any) => s.id) ?? []))
    )

  // Check if already booked this session
  const { count: alreadyBooked } = await supabase
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  // Count total confirmed bookings for this session
  const { count: bookingsCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  const validation = canBookSession({
    studentLevel: profile.level,
    classLevel: session.class.level,
    classType: session.class.type,
    isDependent: profile.is_dependent,
    sessionStatus: session.status,
    bookingsCount: bookingsCount ?? 0,
    maxStudents: session.class.max_students,
    dailyBookings: dailyCount ?? 0,
    maxDailyBookings: maxDaily,
    alreadyBooked: (alreadyBooked ?? 0) > 0,
  })

  if (!validation.allowed) return { error: validation.reason }

  // Check if student has makeup credits available (for non-subscriber/non-wellhub)
  const needsCredit = profile.payment_type === 'per_class'
  if (needsCredit && profile.credits_balance <= 0) {
    return { error: 'Saldo de créditos insuficiente' }
  }

  // Insert booking
  const { error: insertErr } = await supabase
    .from('session_bookings')
    .insert({
      student_id: user.id,
      session_id: sessionId,
      type: 'extra',
      status: 'confirmed',
      from_enrollment: false,
      credit_used: needsCredit,
    })
  if (insertErr) return { error: insertErr.message }

  // Deduct credit if needed
  if (needsCredit) {
    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'used',
      amount: -1,
      reason: `Aula agendada: ${session.class.name} em ${session.session_date}`,
      session_id: sessionId,
    })
    await adminClient
      .from('profiles')
      .update({ credits_balance: profile.credits_balance - 1 })
      .eq('id', user.id)
  }

  revalidatePath('/aulas')
  revalidatePath('/agendar')
  revalidatePath('/home')
  return {}
}

export async function cancelBooking(bookingId: string): Promise<{ error?: string; refunded?: boolean }> {
  const supabase = createClient()
  const adminClient = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // Get booking + session details
  const { data: booking } = await adminClient
    .from('session_bookings')
    .select('*, session:class_sessions(*, class:classes(*))')
    .eq('id', bookingId)
    .eq('student_id', user.id)
    .eq('status', 'confirmed')
    .single()
  if (!booking) return { error: 'Agendamento não encontrado' }

  const session = booking.session
  const sessionStart = `${session.session_date}T${session.class.start_time}`

  const refund = canCancelWithRefund(sessionStart, new Date().toISOString())

  // Cancel booking
  const { error } = await adminClient
    .from('session_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId)
  if (error) return { error: error.message }

  // Refund credit if cancelled in time AND a credit was used (or if subscriber missed a fixed class)
  if (refund) {
    const { data: settings } = await adminClient
      .from('system_settings')
      .select('value')
      .eq('key', 'credit_expiry_days')
      .single()
    const expiryDays = parseInt(settings?.value ?? '30')
    const expiresAt = getMakeupCreditExpiry(new Date(), expiryDays)

    // Refund makeup credit
    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'refunded',
      amount: 1,
      reason: `Cancelamento em prazo: ${session.class.name} em ${session.session_date}`,
      session_id: session.id,
      expires_at: expiresAt.toISOString(),
    })
    await adminClient.rpc('increment_credits', { user_id: user.id, amount: 1 })
  }

  revalidatePath('/aulas')
  revalidatePath('/agendar')
  revalidatePath('/home')
  return { refunded: refund }
}

export async function getStudentBookings(studentId?: string) {
  const supabase = createClient()
  const adminClient = createAdminClient()

  let uid = studentId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    uid = user.id
  }

  const today = new Date().toISOString().split('T')[0]
  const client = studentId ? adminClient : supabase

  const { data, error } = await client
    .from('session_bookings')
    .select('*, session:class_sessions(*, class:classes(*))')
    .eq('student_id', uid)
    .eq('status', 'confirmed')
    .gte('session(session_date)', today)
    .order('session(session_date)')
    .limit(30)
  if (error) return []
  return data
}
```

- [ ] **3.4 Criar RPC increment_credits no Supabase**

No dashboard do Supabase → SQL Editor, execute:
```sql
create or replace function increment_credits(user_id uuid, amount int)
returns void language sql security definer as $$
  update profiles set credits_balance = credits_balance + amount where id = user_id;
$$;
```

- [ ] **3.5 Rodar testes — deve passar**

```bash
cd c:\beach-tennis-app && npx vitest run lib/actions/bookings.test.ts
```
Esperado: PASS (8 tests)

- [ ] **3.6 TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **3.7 Commit**

```bash
git add lib/actions/bookings.ts lib/actions/bookings.test.ts
git commit -m "feat: add booking server actions with validation + credit deduction"
```

---

## Task 4: Server Actions — Créditos

**Files:**
- Create: `lib/actions/credits.ts`

- [ ] **4.1 Criar lib/actions/credits.ts**

```ts
// lib/actions/credits.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'

/** Admin: adicionar créditos manualmente a um aluno */
export async function addCreditsToStudent(
  studentId: string,
  amount: number,
  reason: string,
): Promise<{ error?: string }> {
  if (amount <= 0) return { error: 'Quantidade deve ser positiva' }
  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('credits_balance')
    .eq('id', studentId)
    .single()
  if (!profile) return { error: 'Aluno não encontrado' }

  const { error } = await supabase.from('credit_transactions').insert({
    student_id: studentId,
    type: 'renewed',
    amount,
    reason,
    expires_at: null, // expira na virada do mês
  })
  if (error) return { error: error.message }

  await supabase
    .from('profiles')
    .update({ credits_balance: profile.credits_balance + amount })
    .eq('id', studentId)

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

/** Renovar créditos de todos os assinantes ativos (chamado pelo cron no dia 1) */
export async function renewAllSubscriberCredits(): Promise<{ error?: string; renewed?: number }> {
  const supabase = createAdminClient()

  // Buscar todas as assinaturas ativas com o plano
  const { data: subscriptions, error } = await supabase
    .from('student_subscriptions')
    .select('student_id, plan:subscription_plans(credits_per_month)')
    .eq('status', 'active')
  if (error) return { error: error.message }

  let renewed = 0
  for (const sub of subscriptions ?? []) {
    const credits = (sub.plan as any)?.credits_per_month ?? 0
    if (credits <= 0) continue

    // Expirar créditos do mês anterior (type: renewed com expires_at null)
    await supabase
      .from('credit_transactions')
      .insert({
        student_id: sub.student_id,
        type: 'expired',
        amount: 0, // zerado por trigger/cálculo
        reason: 'Expiração mensal automática',
      })

    // Zerar saldo atual e adicionar novos créditos
    await supabase
      .from('profiles')
      .update({ credits_balance: credits })
      .eq('id', sub.student_id)

    await supabase.from('credit_transactions').insert({
      student_id: sub.student_id,
      type: 'renewed',
      amount: credits,
      reason: `Renovação mensal — ${credits} créditos`,
      expires_at: null,
    })
    renewed++
  }

  return { renewed }
}

/** Histórico de créditos do aluno logado */
export async function getCreditHistory(limit = 20) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return data
}
```

- [ ] **4.2 TypeScript check + commit**

```bash
npx tsc --noEmit
git add lib/actions/credits.ts
git commit -m "feat: add credit management server actions"
```

---

## Task 5: Server Actions — Enrollments + Attendance

**Files:**
- Create: `lib/actions/enrollments.ts`, `lib/actions/attendance.ts`

- [ ] **5.1 Criar lib/actions/enrollments.ts**

```ts
// lib/actions/enrollments.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'

/** Admin: matricular aluno em horário fixo */
export async function enrollStudent(
  studentId: string,
  classId: string,
): Promise<{ error?: string }> {
  const supabase = createAdminClient()

  // Verificar se já está matriculado
  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, is_active')
    .eq('student_id', studentId)
    .eq('class_id', classId)
    .single()

  if (existing?.is_active) return { error: 'Aluno já matriculado nesta turma' }

  if (existing && !existing.is_active) {
    // Reativar matrícula cancelada
    const { error } = await supabase
      .from('enrollments')
      .update({ is_active: true, cancelled_at: null })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('enrollments').insert({
      student_id: studentId,
      class_id: classId,
      is_active: true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

/** Admin: cancelar matrícula fixa */
export async function cancelEnrollment(enrollmentId: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('enrollments')
    .update({ is_active: false, cancelled_at: new Date().toISOString() })
    .eq('id', enrollmentId)
  if (error) return { error: error.message }
  revalidatePath('/admin/alunos')
  return {}
}

/** Admin: auto-gerar bookings do mês para alunos com horário fixo */
export async function autoBookEnrolledStudents(
  year: number,
  month: number,
): Promise<{ error?: string; created?: number }> {
  const supabase = createAdminClient()

  // Pegar todas as matrículas ativas
  const { data: enrollments, error } = await supabase
    .from('enrollments')
    .select('student_id, class_id, student:profiles(payment_type)')
    .eq('is_active', true)
  if (error) return { error: error.message }

  let created = 0
  for (const enr of enrollments ?? []) {
    // Pegar sessões do mês para essa turma
    const startDate = new Date(year, month, 1).toISOString().split('T')[0]
    const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0]

    const { data: sessions } = await supabase
      .from('class_sessions')
      .select('id')
      .eq('class_id', enr.class_id)
      .eq('status', 'scheduled')
      .gte('session_date', startDate)
      .lte('session_date', endDate)

    for (const session of sessions ?? []) {
      const { error: bookErr } = await supabase
        .from('session_bookings')
        .upsert(
          {
            student_id: enr.student_id,
            session_id: session.id,
            type: 'extra',
            status: 'confirmed',
            from_enrollment: true,
            credit_used: false,
          },
          { onConflict: 'student_id,session_id', ignoreDuplicates: true },
        )
      if (!bookErr) created++
    }
  }

  return { created }
}

/** Matrículas de um aluno */
export async function getStudentEnrollments(studentId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('enrollments')
    .select('*, class:classes(*)')
    .eq('student_id', studentId)
    .eq('is_active', true)
  if (error) return []
  return data
}
```

- [ ] **5.2 Criar lib/actions/attendance.ts**

```ts
// lib/actions/attendance.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import type { AttendanceStatus } from '@/types'

/** Admin: marcar presença de um aluno numa sessão */
export async function markAttendance(
  studentId: string,
  sessionId: string,
  status: AttendanceStatus,
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('attendance')
    .upsert(
      { student_id: studentId, session_id: sessionId, status, source: 'manual' },
      { onConflict: 'student_id,session_id' },
    )
  if (error) return { error: error.message }
  revalidatePath(`/admin/grade/sessoes/${sessionId}`)
  return {}
}

/** Admin: fechar sessão e marcar ausentes automaticamente */
export async function closeSession(sessionId: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()

  // Marcar sessão como completed
  await supabase
    .from('class_sessions')
    .update({ status: 'completed' })
    .eq('id', sessionId)

  // Pegar todos os bookings confirmados sem presença registrada
  const { data: bookings } = await supabase
    .from('session_bookings')
    .select('student_id')
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  const { data: attended } = await supabase
    .from('attendance')
    .select('student_id')
    .eq('session_id', sessionId)

  const attendedIds = new Set((attended ?? []).map((a: any) => a.student_id))

  for (const booking of bookings ?? []) {
    if (!attendedIds.has(booking.student_id)) {
      await supabase.from('attendance').upsert(
        { student_id: booking.student_id, session_id: sessionId, status: 'absent', source: 'manual' },
        { onConflict: 'student_id,session_id' },
      )
    }
  }

  revalidatePath(`/admin/grade/sessoes/${sessionId}`)
  revalidatePath('/admin/grade')
  return {}
}
```

- [ ] **5.3 TypeScript check + commit**

```bash
npx tsc --noEmit
git add lib/actions/enrollments.ts lib/actions/attendance.ts
git commit -m "feat: add enrollment and attendance server actions"
```

---

## Task 6: Server Actions — Trial + Feature Components

**Files:**
- Create: `lib/actions/trial.ts`
- Create: `features/aulas/ClassCard.tsx`, `features/aulas/SessionCard.tsx`, `features/aulas/CreditBadge.tsx`

- [ ] **6.1 Criar lib/actions/trial.ts**

```ts
// lib/actions/trial.ts
'use server'
import { createAdminClient } from '@/lib/supabase/server'
import type { TrialStatus } from '@/types'

export type TrialInput = {
  name: string
  email: string
  phone: string
  sessionId: string
}

export async function bookTrialClass(input: TrialInput): Promise<{ error?: string }> {
  const supabase = createAdminClient()

  // Verificar se email já tem aula experimental (pendente ou atendida)
  const { data: existing } = await supabase
    .from('trial_bookings')
    .select('id, status, must_pay_next')
    .eq('email', input.email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing?.must_pay_next) {
    return { error: 'Sua aula experimental anterior não foi cancelada no prazo. Entre em contato com a academia.' }
  }

  if (existing && ['pending', 'attended'].includes(existing.status)) {
    return { error: 'Este email já possui uma aula experimental agendada ou realizada.' }
  }

  // Verificar se sessão existe e tem vagas
  const { data: session } = await supabase
    .from('class_sessions')
    .select('*, class:classes(max_students)')
    .eq('id', input.sessionId)
    .eq('status', 'scheduled')
    .single()
  if (!session) return { error: 'Sessão não disponível' }

  const { count } = await supabase
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', input.sessionId)
    .eq('status', 'confirmed')
  if ((count ?? 0) >= session.class.max_students) return { error: 'Turma cheia' }

  const { error } = await supabase.from('trial_bookings').insert({
    name: input.name.trim(),
    email: input.email.toLowerCase().trim(),
    phone: input.phone.trim(),
    session_id: input.sessionId,
    status: 'pending',
    must_pay_next: false,
  })
  if (error) return { error: error.message }

  return {}
}

export async function updateTrialStatus(
  trialId: string,
  status: TrialStatus,
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const mustPayNext = status === 'no_show'
  const { error } = await supabase
    .from('trial_bookings')
    .update({ status, must_pay_next: mustPayNext })
    .eq('id', trialId)
  if (error) return { error: error.message }
  return {}
}

export async function getPendingTrials() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('trial_bookings')
    .select('*, session:class_sessions(session_date, class:classes(name, start_time))')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) return []
  return data
}
```

- [ ] **6.2 Criar features/aulas/ClassCard.tsx**

```tsx
// features/aulas/ClassCard.tsx
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils/cn'
import type { Class } from '@/types'

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface ClassCardProps {
  cls: Class
  onClick?: () => void
  action?: React.ReactNode
}

export function ClassCard({ cls, onClick, action }: ClassCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface-card rounded-xl border p-4 flex flex-col gap-2',
        cls.type === 'kids'
          ? 'border-yellow-500/60 shadow-yellow-500/10 shadow-lg'
          : 'border-surface-border',
        onClick && 'cursor-pointer hover:border-brand-600/50 transition-colors',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white text-sm">{cls.name}</span>
          {cls.type === 'kids' && (
            <Badge variant="kids">👶 KIDS</Badge>
          )}
          <Badge variant="level">Nível {cls.level}</Badge>
        </div>
        {action}
      </div>
      <div className="text-slate-400 text-xs flex gap-3">
        <span>📅 {DAY_NAMES[cls.day_of_week]}</span>
        <span>🕐 {cls.start_time.slice(0, 5)} – {cls.end_time.slice(0, 5)}</span>
        <span>👥 máx {cls.max_students}</span>
      </div>
      {cls.description && (
        <p className="text-slate-500 text-xs">{cls.description}</p>
      )}
    </div>
  )
}
```

- [ ] **6.3 Criar features/aulas/SessionCard.tsx**

```tsx
// features/aulas/SessionCard.tsx
'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils/cn'
import { canCancelWithRefund } from '@/lib/utils/creditRules'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Class, ClassSession } from '@/types'

export type SessionCardMode = 'book' | 'booked' | 'view'

interface SessionCardProps {
  session: ClassSession & { class: Class; bookings_count: number }
  mode: SessionCardMode
  bookingId?: string
  onBook?: (sessionId: string) => Promise<void>
  onCancel?: (bookingId: string) => Promise<{ refunded?: boolean }>
}

export function SessionCard({ session, mode, bookingId, onBook, onCancel }: SessionCardProps) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const cls = session.class
  const isFull = session.bookings_count >= cls.max_students
  const sessionStart = `${session.session_date}T${cls.start_time}`
  const canCancel = bookingId ? canCancelWithRefund(sessionStart, new Date().toISOString()) : false

  async function handleBook() {
    if (!onBook) return
    setLoading(true)
    setMsg('')
    await onBook(session.id)
    setLoading(false)
  }

  async function handleCancel() {
    if (!onCancel || !bookingId) return
    setLoading(true)
    const result = await onCancel(bookingId)
    setMsg(result?.refunded ? '✅ Crédito reembolsado' : '❌ Fora do prazo — crédito não reembolsado')
    setLoading(false)
  }

  return (
    <div className={cn(
      'bg-surface-card rounded-xl border p-4 flex flex-col gap-2',
      cls.type === 'kids' ? 'border-yellow-500/40' : 'border-surface-border',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{cls.name}</span>
            {cls.type === 'kids' && <Badge variant="kids">👶 KIDS</Badge>}
            <Badge variant="level">Nível {cls.level}</Badge>
          </div>
          <div className="text-slate-400 text-xs mt-1 flex gap-3">
            <span>📅 {formatDate(session.session_date)}</span>
            <span>🕐 {cls.start_time.slice(0, 5)}</span>
            <span className={cn(isFull && mode === 'book' ? 'text-red-400' : '')}>
              👥 {session.bookings_count}/{cls.max_students}
            </span>
          </div>
        </div>

        {mode === 'book' && (
          <Button
            size="sm"
            onClick={handleBook}
            loading={loading}
            disabled={isFull}
            variant={isFull ? 'secondary' : 'primary'}
          >
            {isFull ? 'Cheio' : 'Agendar'}
          </Button>
        )}

        {mode === 'booked' && (
          <Button
            size="sm"
            variant={canCancel ? 'danger' : 'ghost'}
            onClick={handleCancel}
            loading={loading}
            title={canCancel ? 'Cancelar com reembolso' : 'Cancelar sem reembolso (fora do prazo)'}
          >
            Cancelar
          </Button>
        )}
      </div>
      {msg && <p className="text-xs text-slate-300">{msg}</p>}
    </div>
  )
}
```

- [ ] **6.4 Criar features/aulas/CreditBadge.tsx**

```tsx
// features/aulas/CreditBadge.tsx
import { cn } from '@/lib/utils/cn'

interface CreditBadgeProps {
  balance: number
  className?: string
}

export function CreditBadge({ balance, className }: CreditBadgeProps) {
  const color = balance === 0
    ? 'text-red-400 bg-red-500/10 border-red-500/30'
    : balance <= 2
    ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
    : 'text-green-400 bg-green-500/10 border-green-500/30'

  return (
    <div className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold', color, className)}>
      <span>🎾</span>
      <span>{balance} crédito{balance !== 1 ? 's' : ''}</span>
    </div>
  )
}
```

- [ ] **6.5 TypeScript check + commit**

```bash
npx tsc --noEmit
git add lib/actions/trial.ts features/aulas/
git commit -m "feat: add trial booking action + ClassCard, SessionCard, CreditBadge components"
```

---

## Task 7: Admin — Grade (Gestão de Turmas)

**Files:**
- Create: `app/(admin)/grade/page.tsx`
- Create: `app/(admin)/grade/nova/page.tsx`

- [ ] **7.1 Criar app/(admin)/grade/page.tsx**

```tsx
// app/(admin)/grade/page.tsx
import Link from 'next/link'
import { getClasses } from '@/lib/actions/classes'
import { generateSessionsForMonth } from '@/lib/actions/sessions'
import { ClassCard } from '@/features/aulas/ClassCard'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

export default async function GradePage() {
  const classes = await getClasses()
  const now = new Date()

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Grade de Aulas</h1>
          <p className="text-slate-400 text-sm mt-1">{classes.length} turma{classes.length !== 1 ? 's' : ''} cadastrada{classes.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/admin/grade/nova">
          <Button size="sm">+ Nova turma</Button>
        </Link>
      </div>

      {/* Gerar sessões do mês */}
      <GenerateSessionsForm year={now.getFullYear()} month={now.getMonth()} />

      {/* Lista de turmas */}
      <div className="flex flex-col gap-3">
        {classes.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-8">
            Nenhuma turma cadastrada. Crie a primeira turma.
          </p>
        )}
        {classes.map((cls) => (
          <ClassCard
            key={cls.id}
            cls={cls}
            action={
              <div className="flex items-center gap-2">
                {!cls.is_active && <Badge variant="danger">Inativa</Badge>}
                <Link href={`/admin/grade/${cls.id}`}>
                  <Button size="sm" variant="secondary">Editar</Button>
                </Link>
                <Link href={`/admin/grade/${cls.id}/sessoes`}>
                  <Button size="sm" variant="ghost">Sessões</Button>
                </Link>
              </div>
            }
          />
        ))}
      </div>
    </div>
  )
}

function GenerateSessionsForm({ year, month }: { year: number; month: number }) {
  const monthName = new Date(year, month).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
  async function generate() {
    'use server'
    const { generateSessionsForMonth } = await import('@/lib/actions/sessions')
    await generateSessionsForMonth(year, month)
  }

  return (
    <form action={generate} className="bg-surface-card rounded-xl border border-surface-border p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-white text-sm font-medium">Gerar sessões de {monthName}</p>
        <p className="text-slate-400 text-xs mt-0.5">Cria todas as datas para as turmas ativas</p>
      </div>
      <Button type="submit" size="sm" variant="secondary">Gerar</Button>
    </form>
  )
}
```

- [ ] **7.2 Criar app/(admin)/grade/nova/page.tsx**

```tsx
// app/(admin)/grade/nova/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClass } from '@/lib/actions/classes'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import type { StudentLevel, ClassType } from '@/types'

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export default function NovaTurmaPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '', description: '', level: 'iniciante' as StudentLevel,
    type: 'adult' as ClassType, day_of_week: 1, start_time: '07:00',
    end_time: '08:00', max_students: 8,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await createClass(form)
    if (result.error) { setError(result.error); setLoading(false); return }
    router.push('/admin/grade')
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: field === 'day_of_week' || field === 'max_students' ? Number(e.target.value) : e.target.value }))

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-white mb-6">Nova Turma</h1>
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="Nome da turma" value={form.name} onChange={set('name')} required placeholder="Ex: Beach Tennis Iniciante" />
          <Input label="Descrição (opcional)" value={form.description} onChange={set('description')} placeholder="Informações adicionais" />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Nível</label>
            <select value={form.level} onChange={set('level')} className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              {(['A','B','C','D','iniciante'] as StudentLevel[]).map(l => <option key={l} value={l}>Nível {l}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Tipo</label>
            <select value={form.type} onChange={set('type')} className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="adult">Adulto</option>
              <option value="kids">👶 Kids</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Dia da semana</label>
            <select value={form.day_of_week} onChange={set('day_of_week')} className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Início" type="time" value={form.start_time} onChange={set('start_time')} required />
            <Input label="Fim" type="time" value={form.end_time} onChange={set('end_time')} required />
          </div>

          <Input label="Máx. alunos" type="number" min={1} max={20} value={form.max_students} onChange={set('max_students')} required />

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => router.back()} className="flex-1">Cancelar</Button>
            <Button type="submit" loading={loading} className="flex-1">Criar turma</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **7.3 TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/(admin)/grade/
git commit -m "feat: add admin grade pages (class list + create form)"
```

---

## Task 8: Admin — Sessão / Presença

**Files:**
- Create: `app/(admin)/grade/[id]/page.tsx`
- Create: `app/(admin)/grade/[id]/sessoes/page.tsx`
- Create: `app/(admin)/grade/sessoes/[sessionId]/page.tsx`

- [ ] **8.1 Criar app/(admin)/grade/[id]/page.tsx**

```tsx
// app/(admin)/grade/[id]/page.tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { updateClass, toggleClassActive } from '@/lib/actions/classes'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import type { Class, StudentLevel, ClassType } from '@/types'

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export default function EditarTurmaPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [cls, setCls] = useState<Class | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.from('classes').select('*').eq('id', params.id).single()
      .then(({ data }) => { if (data) setCls(data) })
  }, [params.id])

  if (!cls) return <div className="text-slate-400 p-8 text-center">Carregando...</div>

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!cls) return
    setLoading(true)
    const result = await updateClass(cls.id, {
      name: cls.name, description: cls.description ?? undefined,
      level: cls.level, type: cls.type, day_of_week: cls.day_of_week,
      start_time: cls.start_time, end_time: cls.end_time, max_students: cls.max_students,
    })
    if (result.error) { setError(result.error) } else { setMsg('Salvo!') }
    setLoading(false)
  }

  async function handleToggle() {
    if (!cls) return
    await toggleClassActive(cls.id, !cls.is_active)
    setCls({ ...cls, is_active: !cls.is_active })
  }

  const set = (field: keyof Class) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCls((c) => c ? ({ ...c, [field]: ['day_of_week','max_students'].includes(field) ? Number(e.target.value) : e.target.value }) : c)

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Editar Turma</h1>
        <Button size="sm" variant={cls.is_active ? 'danger' : 'secondary'} onClick={handleToggle}>
          {cls.is_active ? 'Desativar' : 'Ativar'}
        </Button>
      </div>
      <Card>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <Input label="Nome" value={cls.name} onChange={set('name')} required />
          <Input label="Descrição" value={cls.description ?? ''} onChange={set('description')} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Nível</label>
            <select value={cls.level} onChange={set('level')} className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              {(['A','B','C','D','iniciante'] as StudentLevel[]).map(l => <option key={l} value={l}>Nível {l}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Tipo</label>
            <select value={cls.type} onChange={set('type')} className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="adult">Adulto</option>
              <option value="kids">👶 Kids</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Dia da semana</label>
            <select value={cls.day_of_week} onChange={set('day_of_week')} className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Início" type="time" value={cls.start_time.slice(0,5)} onChange={set('start_time')} />
            <Input label="Fim" type="time" value={cls.end_time.slice(0,5)} onChange={set('end_time')} />
          </div>
          <Input label="Máx. alunos" type="number" min={1} max={20} value={cls.max_students} onChange={set('max_students')} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {msg && <p className="text-sm text-green-400">{msg}</p>}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => router.back()} className="flex-1">Voltar</Button>
            <Button type="submit" loading={loading} className="flex-1">Salvar</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **8.2 Criar app/(admin)/grade/sessoes/[sessionId]/page.tsx**

```tsx
// app/(admin)/grade/sessoes/[sessionId]/page.tsx
import { getSessionDetail } from '@/lib/actions/sessions'
import { closeSession } from '@/lib/actions/attendance'
import { AttendanceForm } from './AttendanceForm'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'

export default async function SessionAtendancePage({ params }: { params: { sessionId: string } }) {
  const session = await getSessionDetail(params.sessionId)
  if (!session) return <div className="text-slate-400 p-8 text-center">Sessão não encontrada</div>

  const cls = session.class as any
  const bookings = session.bookings as any[] ?? []
  const attendanceMap = new Map((session.attendance as any[] ?? []).map((a: any) => [a.student_id, a.status]))

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">{cls.name}</h1>
        <p className="text-slate-400 text-sm mt-1">
          {formatDate(session.session_date)} · {cls.start_time?.slice(0,5)} · {bookings.length} aluno{bookings.length !== 1 ? 's' : ''}
        </p>
        <div className="mt-2">
          <Badge variant={session.status === 'completed' ? 'success' : session.status === 'cancelled' ? 'danger' : 'default'}>
            {session.status}
          </Badge>
        </div>
      </div>

      {session.status === 'scheduled' && (
        <form action={async () => { 'use server'; await closeSession(params.sessionId) }}>
          <Button type="submit" variant="secondary" size="sm">✓ Fechar sessão</Button>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {bookings.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-8">Nenhum aluno agendado</p>
        )}
        {bookings.map((booking: any) => {
          const student = booking.student
          const currentStatus = attendanceMap.get(student.id)
          return (
            <AttendanceForm
              key={booking.id}
              studentId={student.id}
              studentName={student.full_name}
              studentLevel={student.level}
              sessionId={params.sessionId}
              currentStatus={currentStatus}
              sessionClosed={session.status === 'completed'}
            />
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **8.3 Criar app/(admin)/grade/sessoes/[sessionId]/AttendanceForm.tsx**

```tsx
// app/(admin)/grade/sessoes/[sessionId]/AttendanceForm.tsx
'use client'
import { useState } from 'react'
import { markAttendance } from '@/lib/actions/attendance'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils/cn'
import type { AttendanceStatus } from '@/types'

interface AttendanceFormProps {
  studentId: string
  studentName: string
  studentLevel: string
  sessionId: string
  currentStatus?: AttendanceStatus
  sessionClosed: boolean
}

export function AttendanceForm({ studentId, studentName, studentLevel, sessionId, currentStatus, sessionClosed }: AttendanceFormProps) {
  const [status, setStatus] = useState<AttendanceStatus | undefined>(currentStatus)
  const [loading, setLoading] = useState(false)

  async function handle(s: AttendanceStatus) {
    setLoading(true)
    await markAttendance(studentId, sessionId, s)
    setStatus(s)
    setLoading(false)
  }

  return (
    <div className="bg-surface-card rounded-xl border border-surface-border p-3 flex items-center justify-between gap-3">
      <div>
        <span className="text-white text-sm font-medium">{studentName}</span>
        <Badge variant="level" className="ml-2">{studentLevel}</Badge>
      </div>
      <div className="flex gap-2">
        {!sessionClosed && (
          <>
            <Button size="sm" variant={status === 'present' ? 'primary' : 'secondary'} loading={loading} onClick={() => handle('present')}>✓</Button>
            <Button size="sm" variant={status === 'absent' ? 'danger' : 'secondary'} loading={loading} onClick={() => handle('absent')}>✗</Button>
            <Button size="sm" variant={status === 'late' ? 'secondary' : 'ghost'} loading={loading} onClick={() => handle('late')}>⏰</Button>
          </>
        )}
        {(sessionClosed || status) && (
          <Badge variant={status === 'present' ? 'success' : status === 'absent' ? 'danger' : 'warning'}>
            {status === 'present' ? 'Presente' : status === 'absent' ? 'Ausente' : 'Atrasado'}
          </Badge>
        )}
      </div>
    </div>
  )
}
```

- [ ] **8.4 TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/(admin)/grade/
git commit -m "feat: add admin session attendance pages"
```

---

## Task 9: Admin Dashboard + Alunos

**Files:**
- Create: `app/(admin)/dashboard/page.tsx`
- Create: `app/(admin)/alunos/page.tsx`

- [ ] **9.1 Criar app/(admin)/dashboard/page.tsx**

```tsx
// app/(admin)/dashboard/page.tsx
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { getPendingTrials } from '@/lib/actions/trial'
import { formatDate } from '@/lib/utils/dateHelpers'
import Link from 'next/link'

async function getDashboardStats() {
  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]

  const [students, todaySessions, trials] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('contract_active', true),
    supabase.from('class_sessions').select('id, class:classes(name, start_time), bookings:session_bookings(count)').eq('session_date', today).eq('status', 'scheduled'),
    getPendingTrials(),
  ])

  return {
    activeStudents: students.count ?? 0,
    todaySessions: todaySessions.data ?? [],
    pendingTrials: trials,
  }
}

export default async function AdminDashboardPage() {
  const stats = await getDashboardStats()

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-xl font-bold text-white">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-slate-400 text-xs uppercase tracking-wide">Alunos ativos</p>
          <p className="text-3xl font-bold text-white mt-1">{stats.activeStudents}</p>
        </Card>
        <Card>
          <p className="text-slate-400 text-xs uppercase tracking-wide">Aulas hoje</p>
          <p className="text-3xl font-bold text-white mt-1">{stats.todaySessions.length}</p>
        </Card>
      </div>

      {/* Aulas de hoje */}
      {stats.todaySessions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Aulas de hoje</h2>
          <div className="flex flex-col gap-2">
            {stats.todaySessions.map((s: any) => (
              <Link key={s.id} href={`/admin/grade/sessoes/${s.id}`}>
                <Card className="hover:border-brand-600/50 cursor-pointer">
                  <div className="flex justify-between items-center">
                    <span className="text-white text-sm">{s.class.name}</span>
                    <span className="text-slate-400 text-xs">{s.class.start_time?.slice(0,5)} · {s.bookings?.[0]?.count ?? 0} aluno(s)</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Experimentais pendentes */}
      {stats.pendingTrials.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">
            Aulas experimentais pendentes ({stats.pendingTrials.length})
          </h2>
          <div className="flex flex-col gap-2">
            {stats.pendingTrials.map((t: any) => (
              <Card key={t.id}>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-white text-sm font-medium">{t.name}</p>
                    <p className="text-slate-400 text-xs">{t.email} · {t.phone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-300 text-xs">{t.session?.class?.name}</p>
                    <p className="text-slate-400 text-xs">{t.session ? formatDate(t.session.session_date) : ''}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **9.2 Criar app/(admin)/alunos/page.tsx**

```tsx
// app/(admin)/alunos/page.tsx
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import Link from 'next/link'

export default async function AlunosPage() {
  const supabase = createAdminClient()
  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name, level, payment_type, credits_balance, contract_active')
    .eq('role', 'student')
    .order('full_name')

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <h1 className="text-xl font-bold text-white">Alunos ({students?.length ?? 0})</h1>
      <div className="flex flex-col gap-2">
        {(students ?? []).map((s) => (
          <Link key={s.id} href={`/admin/alunos/${s.id}`}>
            <Card className="hover:border-brand-600/50 cursor-pointer">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">{s.full_name}</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="level">Nível {s.level}</Badge>
                    <Badge variant="default">{s.payment_type}</Badge>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-slate-300 text-sm">🎾 {s.credits_balance} créditos</p>
                  {!s.contract_active && <Badge variant="danger" className="mt-1">Inativo</Badge>}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **9.3 Criar app/(admin)/alunos/[id]/page.tsx**

```tsx
// app/(admin)/alunos/[id]/page.tsx
import { createAdminClient } from '@/lib/supabase/server'
import { getStudentEnrollments } from '@/lib/actions/enrollments'
import { addCreditsToStudent, enrollStudent, cancelEnrollment } from '@/lib/actions/enrollments'
import { addCreditsToStudent as addCredits } from '@/lib/actions/credits'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ClassCard } from '@/features/aulas/ClassCard'
import { CreditBadge } from '@/features/aulas/CreditBadge'
import { getActiveClasses } from '@/lib/actions/classes'

export default async function StudentProfilePage({ params }: { params: { id: string } }) {
  const supabase = createAdminClient()

  const [{ data: student }, enrollments, allClasses] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', params.id).single(),
    getStudentEnrollments(params.id),
    getActiveClasses(),
  ])

  if (!student) return <div className="text-slate-400 p-8">Aluno não encontrado</div>

  const enrolledClassIds = new Set(enrollments.map((e: any) => e.class_id))
  const availableClasses = allClasses.filter((c) => !enrolledClassIds.has(c.id))

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      {/* Perfil */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">{student.full_name}</h1>
            <p className="text-slate-400 text-sm">{student.email ?? ''}</p>
            <div className="flex gap-2 mt-2">
              <Badge variant="level">Nível {student.level}</Badge>
              <Badge variant="default">{student.payment_type}</Badge>
            </div>
          </div>
          <CreditBadge balance={student.credits_balance} />
        </div>
      </Card>

      {/* Adicionar créditos */}
      <Card>
        <h2 className="text-sm font-semibold text-white mb-3">Adicionar créditos</h2>
        <form action={async (fd: FormData) => {
          'use server'
          const amount = parseInt(fd.get('amount') as string)
          const reason = fd.get('reason') as string
          const { addCreditsToStudent } = await import('@/lib/actions/credits')
          await addCreditsToStudent(params.id, amount, reason || 'Adicionado pelo admin')
        }} className="flex gap-3">
          <input name="amount" type="number" min={1} max={50} defaultValue={4}
            className="w-24 rounded-lg bg-surface border border-surface-border px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <input name="reason" type="text" placeholder="Motivo" defaultValue="Mensalidade"
            className="flex-1 rounded-lg bg-surface border border-surface-border px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <Button type="submit" size="sm">+ Créditos</Button>
        </form>
      </Card>

      {/* Horários fixos */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-3">Horários fixos ({enrollments.length})</h2>
        <div className="flex flex-col gap-2">
          {enrollments.map((enr: any) => (
            <ClassCard key={enr.id} cls={enr.class} action={
              <form action={async () => {
                'use server'
                const { cancelEnrollment } = await import('@/lib/actions/enrollments')
                await cancelEnrollment(enr.id)
              }}>
                <Button type="submit" size="sm" variant="danger">Remover</Button>
              </form>
            } />
          ))}
          {enrollments.length === 0 && <p className="text-slate-400 text-sm">Sem horários fixos</p>}
        </div>
      </div>

      {/* Adicionar horário fixo */}
      {availableClasses.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-white mb-3">Adicionar horário fixo</h2>
          <div className="flex flex-col gap-2">
            {availableClasses.map((cls) => (
              <ClassCard key={cls.id} cls={cls} action={
                <form action={async () => {
                  'use server'
                  const { enrollStudent } = await import('@/lib/actions/enrollments')
                  await enrollStudent(params.id, cls.id)
                }}>
                  <Button type="submit" size="sm" variant="secondary">+ Fixar</Button>
                </form>
              } />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **9.4 TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/(admin)/dashboard/ app/(admin)/alunos/
git commit -m "feat: add admin dashboard and student management pages"
```

---

## Task 10: Student — Home Page

**Files:**
- Modify: `app/(dashboard)/home/page.tsx`

- [ ] **10.1 Substituir app/(dashboard)/home/page.tsx**

```tsx
// app/(dashboard)/home/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getStudentBookings } from '@/lib/actions/bookings'
import { Card } from '@/components/ui/Card'
import { CreditBadge } from '@/features/aulas/CreditBadge'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, credits_balance, level, payment_type')
    .eq('id', user.id)
    .single()

  const bookings = await getStudentBookings()

  const firstName = profile?.full_name?.split(' ')[0] ?? 'Aluno'

  return (
    <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Olá, {firstName}! 🎾</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="level">Nível {profile?.level}</Badge>
          </div>
        </div>
        {profile?.payment_type !== 'wellhub' && profile?.payment_type !== 'totalpass' && (
          <CreditBadge balance={profile?.credits_balance ?? 0} />
        )}
      </div>

      {/* Próximas aulas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300">Próximas aulas</h2>
          <Link href="/aulas" className="text-brand-400 text-xs hover:text-brand-300">Ver todas →</Link>
        </div>
        {bookings.length === 0 ? (
          <Card>
            <p className="text-slate-400 text-sm text-center py-4">
              Nenhuma aula agendada.{' '}
              <Link href="/agendar" className="text-brand-400 hover:text-brand-300">Agendar agora →</Link>
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {bookings.slice(0, 3).map((b: any) => {
              const s = b.session
              const cls = s.class
              return (
                <Card key={b.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium">{cls.name}</p>
                      <p className="text-slate-400 text-xs mt-0.5">
                        {formatDate(s.session_date)} · {cls.start_time?.slice(0, 5)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {cls.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                      <Badge variant="level">{cls.level}</Badge>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* CTA Agendar */}
      <Link href="/agendar">
        <Card className="border-brand-600/40 bg-brand-600/10 cursor-pointer hover:bg-brand-600/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-brand-400 font-semibold text-sm">+ Agendar aula extra</p>
              <p className="text-slate-400 text-xs mt-0.5">Ver turmas disponíveis</p>
            </div>
            <span className="text-brand-400 text-xl">→</span>
          </div>
        </Card>
      </Link>
    </div>
  )
}
```

- [ ] **10.2 TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/(dashboard)/home/page.tsx
git commit -m "feat: implement student home page with upcoming classes"
```

---

## Task 11: Student — Minhas Aulas

**Files:**
- Modify: `app/(dashboard)/aulas/page.tsx`
- Create: `app/(dashboard)/aulas/CancelButton.tsx`

- [ ] **11.1 Criar app/(dashboard)/aulas/CancelButton.tsx**

```tsx
// app/(dashboard)/aulas/CancelButton.tsx
'use client'
import { useState } from 'react'
import { cancelBooking } from '@/lib/actions/bookings'
import { Button } from '@/components/ui/Button'

interface CancelButtonProps {
  bookingId: string
  sessionStart: string // ISO datetime
}

export function CancelButton({ bookingId, sessionStart }: CancelButtonProps) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const fiveHoursMs = 5 * 60 * 60 * 1000
  const canRefund = new Date(sessionStart).getTime() - Date.now() > fiveHoursMs

  async function handleCancel() {
    if (!confirm('Cancelar este agendamento?')) return
    setLoading(true)
    const result = await cancelBooking(bookingId)
    if (result.error) {
      setMsg(`Erro: ${result.error}`)
    } else {
      setMsg(result.refunded ? '✅ Crédito reembolsado' : '❌ Fora do prazo — sem reembolso')
    }
    setLoading(false)
  }

  if (msg) return <p className="text-xs text-slate-300">{msg}</p>

  return (
    <Button
      size="sm"
      variant="danger"
      loading={loading}
      onClick={handleCancel}
      title={canRefund ? 'Cancelar e receber crédito' : 'Cancelar sem reembolso (menos de 5h)'}
    >
      Cancelar{canRefund ? ' ✓' : ''}
    </Button>
  )
}
```

- [ ] **11.2 Substituir app/(dashboard)/aulas/page.tsx**

```tsx
// app/(dashboard)/aulas/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import { CancelButton } from './CancelButton'

export default async function AulasPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().split('T')[0]

  const { data: bookings } = await supabase
    .from('session_bookings')
    .select('id, type, from_enrollment, session:class_sessions(id, session_date, status, class:classes(name, start_time, end_time, level, type))')
    .eq('student_id', user.id)
    .eq('status', 'confirmed')
    .gte('session(session_date)', today)
    .order('session(session_date)')
    .limit(30)

  const upcoming = (bookings ?? []).filter((b: any) => b.session?.status === 'scheduled')
  const past = (bookings ?? []).filter((b: any) => b.session?.status !== 'scheduled')

  return (
    <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-6">
      <h1 className="text-xl font-bold text-white">Minhas Aulas</h1>

      {upcoming.length === 0 && (
        <Card>
          <p className="text-slate-400 text-sm text-center py-4">Nenhuma aula agendada</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {upcoming.map((b: any) => {
          const s = b.session
          const cls = s.class
          const sessionStart = `${s.session_date}T${cls.start_time}`
          return (
            <Card key={b.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-white text-sm font-medium">{cls.name}</p>
                    {cls.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                    <Badge variant="level">{cls.level}</Badge>
                    {b.from_enrollment && <Badge variant="success">Fixo</Badge>}
                    {b.type === 'makeup' && <Badge variant="warning">Reposição</Badge>}
                  </div>
                  <p className="text-slate-400 text-xs mt-1">
                    {formatDate(s.session_date)} · {cls.start_time?.slice(0,5)} – {cls.end_time?.slice(0,5)}
                  </p>
                </div>
                <CancelButton bookingId={b.id} sessionStart={sessionStart} />
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **11.3 TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/(dashboard)/aulas/
git commit -m "feat: implement student my-classes page with cancel functionality"
```

---

## Task 12: Student — Agendar Aula

**Files:**
- Modify: `app/(dashboard)/agendar/page.tsx`
- Create: `app/(dashboard)/agendar/BookButton.tsx`

- [ ] **12.1 Criar app/(dashboard)/agendar/BookButton.tsx**

```tsx
// app/(dashboard)/agendar/BookButton.tsx
'use client'
import { useState } from 'react'
import { bookSession } from '@/lib/actions/bookings'
import { Button } from '@/components/ui/Button'
import { useRouter } from 'next/navigation'

interface BookButtonProps {
  sessionId: string
  isFull: boolean
}

export function BookButton({ sessionId, isFull }: BookButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleBook() {
    setLoading(true)
    setError('')
    const result = await bookSession(sessionId)
    if (result.error) {
      setError(result.error)
    } else {
      setDone(true)
      router.refresh()
    }
    setLoading(false)
  }

  if (done) return <span className="text-green-400 text-xs font-medium">✓ Agendado</span>
  if (error) return <span className="text-red-400 text-xs">{error}</span>

  return (
    <Button
      size="sm"
      onClick={handleBook}
      loading={loading}
      disabled={isFull}
      variant={isFull ? 'ghost' : 'primary'}
    >
      {isFull ? 'Cheio' : 'Agendar'}
    </Button>
  )
}
```

- [ ] **12.2 Substituir app/(dashboard)/agendar/page.tsx**

```tsx
// app/(dashboard)/agendar/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getAvailableSessions } from '@/lib/actions/sessions'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { CreditBadge } from '@/features/aulas/CreditBadge'
import { BookButton } from './BookButton'
import { formatDate } from '@/lib/utils/dateHelpers'
import { cn } from '@/lib/utils/cn'

export default async function AgendarPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [sessions, { data: profile }] = await Promise.all([
    getAvailableSessions(),
    supabase.from('profiles').select('level, credits_balance, payment_type, is_dependent').eq('id', user.id).single(),
  ])

  // Buscar sessões já agendadas pelo aluno
  const today = new Date().toISOString().split('T')[0]
  const { data: myBookings } = await supabase
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', user.id)
    .eq('status', 'confirmed')

  const myBookedSessionIds = new Set((myBookings ?? []).map((b: any) => b.session_id))

  return (
    <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Agendar Aula</h1>
        {profile?.payment_type !== 'wellhub' && profile?.payment_type !== 'totalpass' && (
          <CreditBadge balance={profile?.credits_balance ?? 0} />
        )}
      </div>

      <p className="text-slate-400 text-xs">
        Máx. 2 aulas extras/dia · Nível {profile?.level} pode agendar turmas {profile?.level} e abaixo
      </p>

      {sessions.length === 0 && (
        <Card>
          <p className="text-slate-400 text-sm text-center py-6">
            Nenhuma sessão disponível. O admin precisa gerar as sessões do mês.
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {sessions.map((session: any) => {
          const cls = session.class
          const isFull = session.bookings_count >= cls.max_students
          const alreadyBooked = myBookedSessionIds.has(session.id)

          return (
            <div
              key={session.id}
              className={cn(
                'bg-surface-card rounded-xl border p-4',
                cls.type === 'kids' ? 'border-yellow-500/40' : 'border-surface-border',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-medium">{cls.name}</span>
                    {cls.type === 'kids' && <Badge variant="kids">👶 KIDS</Badge>}
                    <Badge variant="level">Nível {cls.level}</Badge>
                    {isFull && <Badge variant="danger">Cheio</Badge>}
                  </div>
                  <p className="text-slate-400 text-xs mt-1">
                    {formatDate(session.session_date)} · {cls.start_time?.slice(0,5)} · {session.bookings_count}/{cls.max_students} alunos
                  </p>
                </div>
                {alreadyBooked ? (
                  <Badge variant="success">✓ Agendado</Badge>
                ) : (
                  <BookButton sessionId={session.id} isFull={isFull} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **12.3 TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/(dashboard)/agendar/
git commit -m "feat: implement student booking page with session list"
```

---

## Task 13: Formulário de Aula Experimental (Público)

**Files:**
- Modify: `app/experimental/page.tsx`

- [ ] **13.1 Substituir app/experimental/page.tsx**

```tsx
// app/experimental/page.tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { bookTrialClass } from '@/lib/actions/trial'
import { getAvailableSessions } from '@/lib/actions/sessions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'

type Session = Awaited<ReturnType<typeof getAvailableSessions>>[0]

export default function ExperimentalPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', sessionId: '' })
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    getAvailableSessions().then((data) => {
      // Mostrar só turmas adulto para experimental
      setSessions(data.filter((s) => s.class.type === 'adult').slice(0, 10))
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.sessionId) { setError('Selecione uma turma'); return }
    setLoading(true)
    setError('')
    const result = await bookTrialClass(form)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    setSuccess(true)
    setLoading(false)
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  if (success) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <div className="text-4xl mb-4">🎾</div>
          <h2 className="text-lg font-bold text-white mb-2">Aula agendada!</h2>
          <p className="text-slate-400 text-sm mb-4">
            Sua aula experimental foi agendada com sucesso. Chegue alguns minutos antes.
          </p>
          <p className="text-slate-500 text-xs">
            Precisa cancelar? Entre em contato com pelo menos 5h de antecedência.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="max-w-sm mx-auto px-4 py-8 flex flex-col gap-6">
        <div>
          <Link href="/" className="text-slate-400 text-sm hover:text-white">← Voltar</Link>
          <h1 className="text-2xl font-bold text-white mt-4">Aula Experimental</h1>
          <p className="text-slate-400 text-sm mt-1">Gratuita · Sem criar conta</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input label="Seu nome" value={form.name} onChange={set('name')} required placeholder="Nome completo" />
            <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
            <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} required placeholder="(11) 99999-9999" />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-300">Escolha uma turma</label>
              {sessions.length === 0 && (
                <p className="text-slate-400 text-xs">Nenhuma sessão disponível no momento</p>
              )}
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {sessions.map((s) => (
                  <label key={s.id} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value={s.id}
                      onChange={() => setForm((f) => ({ ...f, sessionId: s.id }))}
                      className="accent-brand-600"
                    />
                    <div>
                      <p className="text-white text-sm">{s.class.name}</p>
                      <p className="text-slate-400 text-xs">
                        {formatDate(s.session_date)} · {s.class.start_time?.slice(0,5)} · {s.bookings_count}/{s.class.max_students}
                        <Badge variant="level" className="ml-1">Nível {s.class.level}</Badge>
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button type="submit" loading={loading} size="lg" className="w-full" disabled={sessions.length === 0}>
              Agendar aula gratuita
            </Button>
          </form>
        </Card>

        <p className="text-slate-500 text-xs text-center">
          Se não comparecer sem cancelar com 5h de antecedência, a próxima experimental será cobrada.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **13.2 TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/experimental/page.tsx
git commit -m "feat: implement public trial class booking form"
```

---

## Task 14: API Routes — Session Generation + Credit Renewal

**Files:**
- Create: `app/api/sessions/generate/route.ts`
- Create: `app/api/credits/renew/route.ts`
- Create: `vercel.json` (cron jobs)

- [ ] **14.1 Criar app/api/sessions/generate/route.ts**

```ts
// app/api/sessions/generate/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { generateSessionsForMonth } from '@/lib/actions/sessions'
import { autoBookEnrolledStudents } from '@/lib/actions/enrollments'

export async function POST(request: NextRequest) {
  // Protect with secret
  const secret = request.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const now = new Date()
  const year = body.year ?? now.getFullYear()
  const month = body.month ?? now.getMonth() // 0-indexed

  const [sessionsResult, bookingsResult] = await Promise.all([
    generateSessionsForMonth(year, month),
    autoBookEnrolledStudents(year, month),
  ])

  return NextResponse.json({
    sessions: sessionsResult,
    bookings: bookingsResult,
  })
}
```

- [ ] **14.2 Criar app/api/credits/renew/route.ts**

```ts
// app/api/credits/renew/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { renewAllSubscriberCredits } from '@/lib/actions/credits'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await renewAllSubscriberCredits()
  return NextResponse.json(result)
}
```

- [ ] **14.3 Criar vercel.json com cron jobs**

```json
{
  "crons": [
    {
      "path": "/api/sessions/generate",
      "schedule": "0 9 28 * *"
    },
    {
      "path": "/api/credits/renew",
      "schedule": "0 6 1 * *"
    }
  ]
}
```

- [ ] **14.4 Adicionar CRON_SECRET às env vars**

No terminal:
```bash
cd c:\beach-tennis-app
npx vercel env add CRON_SECRET production --token <VERCEL_TOKEN> --scope icarohsilvas-projects
```
Quando solicitado, digite um segredo forte (ex: `bt-cron-2026-secret-xyz`). Salve também em `.env.local`:
```env
CRON_SECRET=bt-cron-2026-secret-xyz
```

- [ ] **14.5 TypeScript check + testes**

```bash
npx tsc --noEmit
npx vitest run
```
Esperado: todos os testes passando

- [ ] **14.6 Commit + push + deploy**

```bash
git add -A
git commit -m "feat: add API routes for session generation and credit renewal + vercel cron"
git push origin main
vercel --prod --token <VERCEL_TOKEN> --scope icarohsilvas-projects --yes
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Admin cria/edita turmas com nível, tipo kids/adult, dia, horário, capacidade
- ✅ Admin gera sessões do mês para turmas ativas
- ✅ Admin matricula aluno em horário fixo (enrollments)
- ✅ Admin adiciona créditos manualmente
- ✅ Admin visualiza presença por sessão + marca presente/ausente/atrasado
- ✅ Admin fecha sessão (marca ausentes automático)
- ✅ Admin dashboard: alunos ativos, aulas hoje, experimentais pendentes
- ✅ Aluno agenda sessão extra (validação: nível, kids, cheio, limite 2/dia)
- ✅ Aluno cancela com/sem reembolso (regra 5h)
- ✅ Aluno vê próximas aulas na Home
- ✅ Aluno vê minhas aulas + pode cancelar
- ✅ Badge kids visível no card da turma
- ✅ Crédito reembolsado como makeup (30 dias) no cancelamento antecipado
- ✅ Aula experimental pública (sem login)
- ✅ Cron jobs configurados: dia 28 gera sessões do mês seguinte, dia 1 renova créditos
- ✅ Testes unitários para `canBookSession` (8 casos)

**Fora do escopo deste plano (Planos 3+):**
- Pagamento via Mercado Pago
- Wellhub/TotalPass webhooks
- Notificações push/email/WhatsApp
- Lembrete automático de aula
