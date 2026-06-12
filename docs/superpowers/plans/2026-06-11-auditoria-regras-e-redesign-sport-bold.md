# Auditoria de Regras + Redesign Sport Bold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os bugs das regras de negócio (créditos, janela 5h, capacidade, fila) e aplicar o design system "Sport Bold" em todas as telas do aluno e do admin.

**Architecture:** Fundação primeiro — Fase 1 corrige regras com testes e RPCs atômicas no Postgres; Fase 2 evolui tokens Tailwind e componentes em `components/ui/` (as telas herdam automaticamente); Fases 3–4 trocam markup ad-hoc pelos novos primitivos, tela a tela.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase (RPC/plpgsql), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-auditoria-regras-e-redesign-sport-bold-design.md`

**Regras do projeto:** nunca importar `@supabase/supabase-js` direto (usar `lib/supabase/server.ts` / `client.ts`). Testes: `npm run test:run -- <arquivo>`. Migrations via `supabase db push`.

---

## FASE 1 — Auditoria de Regras

### Task 1: Janela de 5h — limite `>=` em vez de `>`

**Files:**
- Modify: `lib/utils/creditRules.ts:17`
- Test: `lib/utils/creditRules.test.ts`

- [ ] **Step 1: Atualizar o teste do limite exato (falha primeiro)**

Em `lib/utils/creditRules.test.ts`, substituir o teste `'blocks cancellation exactly at window limit'` por (timestamps fixos — determinístico):

```ts
  it('allows cancellation exactly at window limit (>= 5h)', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T13:00:00-03:00'),
    ).toBe(true)
  })

  it('blocks cancellation just inside the window', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T13:00:01-03:00'),
    ).toBe(false)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/utils/creditRules.test.ts`
Expected: FAIL — `allows cancellation exactly at window limit` recebe `false`.

- [ ] **Step 3: Corrigir a implementação**

Em `lib/utils/creditRules.ts`, trocar a última linha de `canCancelWithRefund`:

```ts
  return diffHours >= windowHours
```

E atualizar o comentário da função: `Returns true if cancellation is at least CANCELLATION_WINDOW_HOURS before session.`

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/utils/creditRules.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/creditRules.ts lib/utils/creditRules.test.ts
git commit -m "fix: janela de cancelamento inclui exatamente 5h (>=)"
```

### Task 2: Timezone — instante da sessão em horário de Brasília

**Files:**
- Create: `lib/utils/sessionTime.ts`
- Create: `lib/utils/sessionTime.test.ts`
- Modify: `features/aulas/actions.ts:441` (função `cancelBooking`)

Contexto: `cancelBooking` monta `` `${session_date}T${start_time}` `` sem offset. Na Vercel (UTC) isso desloca a janela de 5h em 3 horas. O Brasil não tem mais horário de verão, então offset fixo `-03:00` é correto.

- [ ] **Step 1: Escrever o teste que falha**

Criar `lib/utils/sessionTime.test.ts`:

```ts
// lib/utils/sessionTime.test.ts
import { describe, it, expect } from 'vitest'
import { sessionStartIso } from './sessionTime'

describe('sessionStartIso', () => {
  it('anexa offset de Brasília (-03:00)', () => {
    expect(sessionStartIso('2026-06-11', '18:00:00')).toBe('2026-06-11T18:00:00-03:00')
  })

  it('normaliza horário HH:MM para HH:MM:SS', () => {
    expect(sessionStartIso('2026-06-11', '18:00')).toBe('2026-06-11T18:00:00-03:00')
  })

  it('representa o instante UTC correto', () => {
    // 18:00 em Brasília = 21:00 UTC
    expect(new Date(sessionStartIso('2026-06-11', '18:00:00')).getTime())
      .toBe(Date.UTC(2026, 5, 11, 21, 0, 0))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/utils/sessionTime.test.ts`
Expected: FAIL — módulo `./sessionTime` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/utils/sessionTime.ts`:

```ts
// lib/utils/sessionTime.ts

/** Offset fixo de Brasília (sem horário de verão desde 2019). */
export const BRT_OFFSET = '-03:00'

/**
 * Monta o instante ISO do início de uma sessão a partir de
 * session_date (YYYY-MM-DD) e start_time (HH:MM ou HH:MM:SS),
 * ancorado no fuso de Brasília — independe do fuso do servidor.
 */
export function sessionStartIso(sessionDate: string, startTime: string): string {
  const time = startTime.length === 5 ? `${startTime}:00` : startTime
  return `${sessionDate}T${time}${BRT_OFFSET}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/utils/sessionTime.test.ts`
Expected: PASS.

- [ ] **Step 5: Usar em `cancelBooking`**

Em `features/aulas/actions.ts`, adicionar import no topo:

```ts
import { sessionStartIso } from '@/lib/utils/sessionTime'
```

E na função `cancelBooking`, substituir:

```ts
  const sessionStartIso = `${session.session_date}T${cls.start_time}`

  const now = new Date().toISOString()
  const refundEligible = canCancelWithRefund(sessionStartIso, now)
```

por:

```ts
  const sessionStart = sessionStartIso(session.session_date, cls.start_time)

  const now = new Date().toISOString()
  const refundEligible = canCancelWithRefund(sessionStart, now)
```

- [ ] **Step 6: Verificar build e commit**

Run: `npm run build` — Expected: sucesso, sem erros de tipo.

```bash
git add lib/utils/sessionTime.ts lib/utils/sessionTime.test.ts features/aulas/actions.ts
git commit -m "fix: janela de 5h calculada no fuso de Brasília, não no fuso do servidor"
```

### Task 3: Migration — RPCs atômicas de crédito e capacidade

**Files:**
- Create: `supabase/migrations/20260611000000_booking_and_credit_rpcs.sql`

Contexto: hoje saldo de créditos é read-modify-write (perde updates concorrentes) e a checagem de capacidade não é atômica (overbooking). Duas funções resolvem: `adjust_credits` (transação + saldo numa transação, bloqueia saldo negativo) e `book_session_atomic` (lock por sessão + checagem de lotação + insert).

- [ ] **Step 1: Criar a migration**

Criar `supabase/migrations/20260611000000_booking_and_credit_rpcs.sql`:

```sql
-- Atomicidade para créditos e capacidade de turma.

-- Insere a transação de crédito e atualiza o saldo na mesma transação.
-- Bloqueia saldo negativo (raise INSUFFICIENT_CREDITS).
create or replace function public.adjust_credits(
  p_student_id uuid,
  p_delta int,
  p_type text,
  p_reason text,
  p_session_id uuid default null,
  p_expires_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
  set credits_balance = credits_balance + p_delta
  where id = p_student_id
    and credits_balance + p_delta >= 0;

  if not found then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into credit_transactions (student_id, type, amount, reason, session_id, expires_at)
  values (p_student_id, p_type, p_delta, p_reason, p_session_id, p_expires_at);
end;
$$;

-- Checa lotação e insere o booking sob lock por sessão (sem overbooking).
create or replace function public.book_session_atomic(
  p_student_id uuid,
  p_session_id uuid,
  p_max_students int,
  p_type text default 'extra',
  p_from_enrollment boolean default false,
  p_credit_used boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_booking_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select count(*) into v_count
  from session_bookings
  where session_id = p_session_id and status = 'confirmed';

  if v_count >= p_max_students then
    raise exception 'SESSION_FULL';
  end if;

  insert into session_bookings (student_id, session_id, type, status, from_enrollment, credit_used)
  values (p_student_id, p_session_id, p_type, 'confirmed', p_from_enrollment, p_credit_used)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.adjust_credits(uuid, int, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.book_session_atomic(uuid, uuid, int, text, boolean, boolean) from public, anon, authenticated;
```

(As funções ficam acessíveis só via service role — as actions usam `createAdminClient()`.)

- [ ] **Step 2: Aplicar no Supabase**

Run: `npx supabase db push`
Expected: migration `20260611000000` aplicada sem erro. Se o CLI não estiver linkado, rodar o SQL no Supabase Dashboard (projeto `fmzgsgwphsvkshzcnbwa`) e registrar isso no commit.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260611000000_booking_and_credit_rpcs.sql
git commit -m "feat: RPCs atômicas adjust_credits e book_session_atomic"
```

### Task 4: Actions usam as RPCs (capacidade + saldo atômicos)

**Files:**
- Modify: `features/aulas/actions.ts` (funções `bookSession`, `cancelBooking`, `skipEnrollmentSession`)

- [ ] **Step 1: `bookSession` — insert atômico**

Em `features/aulas/actions.ts`, na função `bookSession`, **remover** os blocos "7. Capacity check", "Insert booking" e "Credit debit" (linhas ~188–238) e substituir por:

```ts
  // Decide credit usage
  const useCredit = useCreditArg ?? false
  if (useCredit && profile.credits_balance < 1) {
    return { error: 'Créditos insuficientes.' }
  }

  // Capacity check + insert na mesma transação (sem overbooking)
  const { data: bookingId, error: bookErr } = await adminClient.rpc('book_session_atomic', {
    p_student_id: user.id,
    p_session_id: sessionId,
    p_max_students: cls.max_students,
    p_credit_used: useCredit,
  })

  if (bookErr) {
    if (bookErr.message.includes('SESSION_FULL')) return { error: 'Esta turma está lotada.' }
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }

  // Débito atômico (transação + saldo juntos)
  if (useCredit) {
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: user.id,
      p_delta: -1,
      p_type: 'used',
      p_reason: `Agendamento avulso — ${cls.name} (${session.session_date})`,
      p_session_id: sessionId,
    })

    if (creditErr) {
      // Desfaz o booking se o débito falhou (saldo esgotado em corrida)
      await adminClient
        .from('session_bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', bookingId as string)
      return { error: 'Créditos insuficientes.' }
    }
  }
```

- [ ] **Step 2: `cancelBooking` — reembolsos via RPC**

Na função `cancelBooking`, substituir o bloco inteiro `if (refundEligible) { ... }` por:

```ts
  if (refundEligible) {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('payment_type')
      .eq('id', user.id)
      .single()

    if (profile) {
      if (booking.from_enrollment && profile.payment_type === 'subscriber') {
        // Crédito extra: não expira enquanto o contrato estiver ativo
        await adminClient.rpc('adjust_credits', {
          p_student_id: user.id,
          p_delta: 1,
          p_type: 'refunded',
          p_reason: `Cancelamento de aula fixa — crédito extra (${session.session_date})`,
          p_session_id: booking.session_id,
        })
      } else if (booking.credit_used) {
        // Crédito de reposição: expira em N dias
        let expiryDays = 30
        const { data: settings } = await adminClient
          .from('system_settings')
          .select('credit_expiry_days')
          .single()
        if (settings?.credit_expiry_days) expiryDays = settings.credit_expiry_days

        const expiry = getMakeupCreditExpiry(new Date(), expiryDays)
        await adminClient.rpc('adjust_credits', {
          p_student_id: user.id,
          p_delta: 1,
          p_type: 'refunded',
          p_reason: `Cancelamento com reposição — sessão ${session.session_date}`,
          p_session_id: booking.session_id,
          p_expires_at: expiry.toISOString(),
        })
      }
    }
  }
```

- [ ] **Step 3: `skipEnrollmentSession` — sempre devolve crédito (regra confirmada)**

Na função `skipEnrollmentSession`, substituir o bloco `if (booking.credit_used) { ... }` inteiro por (sem condição — aluno fixo sempre ganha reposição sem vencimento):

```ts
  // Aluno fixo sempre recebe crédito de reposição sem vencimento ao sair de uma aula
  await adminClient.rpc('adjust_credits', {
    p_student_id: user.id,
    p_delta: 1,
    p_type: 'refunded',
    p_reason: 'Falta em aula fixa — crédito reposição sem vencimento',
    p_session_id: booking.session_id,
  })
```

(Remover também o `select('credits_balance')` que só servia ao read-modify-write.)

- [ ] **Step 4: Verificar**

Run: `npm run test:run` — Expected: PASS.
Run: `npm run build` — Expected: sucesso.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/actions.ts
git commit -m "fix: capacidade e saldo de créditos atômicos via RPC; aluno fixo sempre ganha reposição"
```

### Task 5: Fila de espera — validações de nível/kids no join e limite diário no accept

**Files:**
- Modify: `features/aulas/waitlistActions.ts` (funções `joinWaitlist`, `acceptWaitlistSpot`)

Contexto (achado da auditoria): `joinWaitlist` não valida nível nem kids, e `acceptWaitlistSpot` cria o booking sem checar o limite de 2 aulas/dia — a fila vira um bypass das regras de agendamento.

- [ ] **Step 1: `joinWaitlist` valida nível e kids**

Em `features/aulas/waitlistActions.ts`, adicionar import:

```ts
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import type { StudentLevel, ClassType } from '@/types'
```

Na função `joinWaitlist`, ampliar o select da sessão:

```ts
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students, level, type)')
    .eq('id', sessionId)
    .single()
```

E logo após o check de `session.status !== 'scheduled'`, inserir:

```ts
  const clsInfo = (Array.isArray(session.class) ? session.class[0] : session.class) as {
    max_students: number
    level: StudentLevel
    type: ClassType
  } | null
  if (!clsInfo) return { error: 'Turma não encontrada.' }

  const { data: joinProfile } = await adminClient
    .from('profiles')
    .select('level, is_dependent')
    .eq('id', user.id)
    .single()
  if (!joinProfile) return { error: 'Perfil não encontrado.' }

  if (!canStudentAttendLevel(joinProfile.level as StudentLevel, clsInfo.level)) {
    return { error: `Seu nível (${joinProfile.level}) não permite participar desta turma (${clsInfo.level}).` }
  }
  if (clsInfo.type === 'kids' && !joinProfile.is_dependent) {
    return { error: 'Esta turma é exclusiva para alunos kids (dependentes).' }
  }
```

E ajustar a linha existente do `maxStudents` para usar `clsInfo`:

```ts
  const maxStudents = clsInfo.max_students
```

- [ ] **Step 2: `acceptWaitlistSpot` respeita limite diário e usa RPC atômica**

Na função `acceptWaitlistSpot`, substituir o bloco de capacidade + insert (do `const { count: bookedCount }` até o `if (bookingErr) ...`) por:

```ts
  // Limite diário: máx 2 aulas confirmadas na data da sessão
  const { data: sessionDateRow } = await adminClient
    .from('class_sessions')
    .select('session_date')
    .eq('id', entry.session_id)
    .single()

  if (sessionDateRow) {
    const { data: sameDaySessions } = await adminClient
      .from('class_sessions')
      .select('id')
      .eq('session_date', sessionDateRow.session_date)

    const sameDayIds = (sameDaySessions ?? []).map((s: { id: string }) => s.id)
    const { count: dailyCount } = await adminClient
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('status', 'confirmed')
      .in('session_id', sameDayIds)

    if ((dailyCount ?? 0) >= 2) {
      return { error: 'Você já atingiu o limite de 2 aulas nessa data.' }
    }
  }

  // Insert atômico — se outro booking entrou antes, expira e avança a fila
  const { error: bookingErr } = await adminClient.rpc('book_session_atomic', {
    p_student_id: user.id,
    p_session_id: entry.session_id,
    p_max_students: maxStudents,
  })

  if (bookingErr) {
    if (bookingErr.message.includes('SESSION_FULL')) {
      await adminClient
        .from('waitlists')
        .update({ status: 'expired' as WaitlistStatus })
        .eq('id', waitlistId)
      await offerWaitlistSpot(entry.session_id)
      return { error: 'A vaga foi preenchida. O próximo da fila será notificado.' }
    }
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }
```

(O `bookedCount` manual deixa de existir — a RPC faz a checagem sob lock.)

- [ ] **Step 3: Verificar e commitar**

Run: `npm run build` — Expected: sucesso.

```bash
git add features/aulas/waitlistActions.ts
git commit -m "fix: fila de espera valida nível/kids no join e limite diário no accept"
```

### Task 6: Documento de resultado da auditoria

**Files:**
- Create: `docs/superpowers/specs/2026-06-11-auditoria-regras-resultado.md`

- [ ] **Step 1: Revisar regras restantes e escrever o veredito**

Reler `features/aulas/actions.ts`, `features/aulas/waitlistActions.ts`, `features/dayuse/actions.ts`, `features/torneios/actions.ts`, `features/financeiro/actions.ts` e registrar, regra por regra (inventário da spec), o veredito **ok** ou **corrigida (commit X)**. Template:

```markdown
# Resultado da Auditoria de Regras — 2026-06-11

| Regra | Onde | Veredito |
|---|---|---|
| Hierarquia de nível no agendamento | bookSession | ok |
| Janela de 5h (>= e fuso Brasília) | cancelBooking | corrigida (Tasks 1–2) |
| Aluno fixo sempre ganha reposição | skipEnrollmentSession | corrigida (Task 4) |
| Capacidade sem overbooking | book_session_atomic | corrigida (Tasks 3–4) |
| Saldo de créditos atômico | adjust_credits | corrigida (Tasks 3–4) |
| Fila valida nível/kids/limite diário | waitlistActions | corrigida (Task 5) |
| ... (demais regras do inventário) | ... | ... |
```

Qualquer bug novo encontrado nesta releitura: corrigir no mesmo padrão (teste quando puro + correção + commit) antes de fechar a fase.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-11-auditoria-regras-resultado.md
git commit -m "docs: resultado da auditoria de regras"
```

---

## FASE 2 — Design System Sport Bold

### Task 7: Tokens Tailwind

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `CLAUDE.md` (tabela de tokens)

- [ ] **Step 1: Atualizar cores de superfície**

Em `tailwind.config.ts`, substituir o bloco `surface`:

```ts
        surface: {
          DEFAULT: '#0c1220',
          card:    '#151e31',
          border:  '#26334d',
        },
```

- [ ] **Step 2: Atualizar CLAUDE.md**

Na seção Design System do `CLAUDE.md`, substituir o bloco de tokens por:

```
bg-surface        #0c1220  (page background)
bg-surface-card   #151e31  (cards/panels)
border-surface-border  #26334d
text-brand-500    #f97316  (primary orange)
Gradiente de marca: bg-gradient-to-br from-brand-600 to-brand-800 (headers/CTAs de destaque)
```

- [ ] **Step 3: Verificar e commitar**

Run: `npm run build` — Expected: sucesso.

```bash
git add tailwind.config.ts CLAUDE.md
git commit -m "feat(design): tokens Sport Bold — superfícies mais profundas"
```

### Task 8: Button, Badge e Card evoluídos

**Files:**
- Modify: `components/ui/Button.tsx`
- Modify: `components/ui/Badge.tsx`
- Modify: `components/ui/Card.tsx`

- [ ] **Step 1: Button — gradiente no primary + micro-interação**

Em `components/ui/Button.tsx`, substituir `base` e `variants`:

```ts
    const base = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'
    const variants = {
      primary: 'bg-gradient-to-r from-brand-600 to-brand-700 text-white hover:from-brand-500 hover:to-brand-600 shadow-md shadow-brand-600/25',
      secondary: 'bg-surface-card text-white border border-surface-border hover:bg-surface-border',
      ghost: 'text-slate-300 hover:text-white hover:bg-surface-card',
      danger: 'bg-red-600 text-white hover:bg-red-700',
    }
```

- [ ] **Step 2: Badge — sólido, alto contraste**

Em `components/ui/Badge.tsx`, substituir `variants` e a linha do `span`:

```ts
  const variants = {
    default: 'bg-surface-border text-slate-200',
    kids: 'bg-yellow-400 text-surface animate-pulse',
    level: 'bg-brand-500 text-surface',
    success: 'bg-emerald-400 text-surface',
    warning: 'bg-yellow-400 text-surface',
    danger: 'bg-red-500 text-white',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-extrabold tracking-wide', variants[variant], className)}>
      {children}
    </span>
  )
```

- [ ] **Step 3: Card — prop `accent` (borda lateral laranja)**

Substituir `components/ui/Card.tsx` por:

```tsx
// components/ui/Card.tsx
import { cn } from '@/lib/utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  /** Borda lateral laranja para destacar o card (próxima aula, item ativo). */
  accent?: boolean
}

export function Card({ children, className, onClick, accent }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface-card rounded-xl border border-surface-border p-4',
        accent && 'border-l-[3px] border-l-brand-500',
        onClick && 'cursor-pointer hover:border-brand-600/50 transition-colors active:scale-[0.99]',
        className,
      )}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Verificar visualmente e commitar**

Run: `npm run build` — Expected: sucesso.
Run: `npm run dev` e abrir `http://localhost:3000/home` — botões com gradiente, badges sólidos, sem regressão de layout.

```bash
git add components/ui/Button.tsx components/ui/Badge.tsx components/ui/Card.tsx
git commit -m "feat(design): Button gradiente, Badge sólido e Card com accent"
```

### Task 9: Novos primitivos — SectionHeader, EmptyState, Skeleton, StatHeader, StatCard

**Files:**
- Create: `components/ui/SectionHeader.tsx`
- Create: `components/ui/EmptyState.tsx`
- Create: `components/ui/Skeleton.tsx`
- Create: `components/ui/StatHeader.tsx`
- Create: `components/ui/StatCard.tsx`

- [ ] **Step 1: SectionHeader**

```tsx
// components/ui/SectionHeader.tsx
import Link from 'next/link'

interface SectionHeaderProps {
  title: string
  href?: string
  linkLabel?: string
}

export function SectionHeader({ title, href, linkLabel = 'ver todos' }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-white">{title}</h2>
      {href && (
        <Link href={href} className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
          {linkLabel} →
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 2: EmptyState**

```tsx
// components/ui/EmptyState.tsx
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Card } from './Card'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  ctaHref?: string
  ctaLabel?: string
}

export function EmptyState({ icon: Icon, title, description, ctaHref, ctaLabel }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center text-center py-8">
      <Icon className="h-8 w-8 text-slate-600 mb-3" />
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && <p className="text-xs text-slate-400 mt-1 max-w-[240px]">{description}</p>}
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="mt-4 inline-flex items-center rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-2 text-sm font-semibold text-white hover:from-brand-500 hover:to-brand-600 transition-all active:scale-[0.98]"
        >
          {ctaLabel}
        </Link>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Skeleton**

```tsx
// components/ui/Skeleton.tsx
import { cn } from '@/lib/utils/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-card', className)} />
}

/** Página de loading padrão: header + 3 cards. */
export function PageSkeleton() {
  return (
    <div className="p-4 space-y-4 pb-24">
      <Skeleton className="h-24" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  )
}
```

- [ ] **Step 4: StatHeader**

```tsx
// components/ui/StatHeader.tsx

interface Stat {
  label: string
  value: string | number
}

interface StatHeaderProps {
  name: string
  stats: Stat[]
}

export function StatHeader({ name, stats }: StatHeaderProps) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 shadow-lg shadow-brand-900/30">
      <p className="text-lg font-extrabold text-white">Olá, {name} 🎾</p>
      <div className="mt-3 flex gap-6">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-100/80">{s.label}</p>
            <p className="text-xl font-extrabold text-white">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: StatCard**

```tsx
// components/ui/StatCard.tsx
import { Card } from './Card'

interface StatCardProps {
  label: string
  value: string | number
  hint?: string
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <Card>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-2xl font-extrabold text-brand-500 mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </Card>
  )
}
```

- [ ] **Step 6: Verificar e commitar**

Run: `npm run build` — Expected: sucesso.

```bash
git add components/ui/SectionHeader.tsx components/ui/EmptyState.tsx components/ui/Skeleton.tsx components/ui/StatHeader.tsx components/ui/StatCard.tsx
git commit -m "feat(design): primitivos SectionHeader, EmptyState, Skeleton, StatHeader, StatCard"
```

### Task 10: BottomNav com FAB em gradiente

**Files:**
- Modify: `components/ui/BottomNav.tsx:25-28`

- [ ] **Step 1: Trocar o fundo do FAB**

Em `components/ui/BottomNav.tsx`, substituir a div do FAB:

```tsx
          <div className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-600/40 border-4 border-surface transition-transform active:scale-95',
            pathname.startsWith('/agendar') && 'from-brand-400 to-brand-600',
          )}>
```

- [ ] **Step 2: Verificar e commitar**

Run: `npm run build` — Expected: sucesso.

```bash
git add components/ui/BottomNav.tsx
git commit -m "feat(design): FAB do BottomNav com gradiente Sport Bold"
```

---

## FASE 3 — Telas do Aluno

### Task 11: Home com StatHeader

**Files:**
- Modify: `app/(dashboard)/home/page.tsx`
- Create: `app/(dashboard)/home/loading.tsx`

- [ ] **Step 1: Buscar dados das estatísticas**

Em `app/(dashboard)/home/page.tsx`, adicionar ao `Promise.all` existente (após a query de `todayDayUseData`):

```ts
    supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('is_active', true),
```

e capturar como `{ count: weeklyClassesCount }` na desestruturação.

- [ ] **Step 2: Substituir saudação + card de créditos pelo StatHeader**

Adicionar import: `import { StatHeader } from '@/components/ui/StatHeader'` e `import { SectionHeader } from '@/components/ui/SectionHeader'` e `import { EmptyState } from '@/components/ui/EmptyState'` e `import { CalendarPlus } from 'lucide-react'`.

Substituir o bloco da saudação (`<div><h1>Olá...` até o fechamento do Card de créditos, linhas ~251–268) por:

```tsx
      <StatHeader
        name={profile?.full_name?.split(' ')[0] ?? 'atleta'}
        stats={[
          ...(showCredits
            ? [{ label: 'Créditos', value: profile?.credits_balance ?? 0 }]
            : [{ label: 'Plano', value: profile?.payment_type === 'wellhub' ? 'Wellhub' : 'TotalPass' }]),
          { label: 'Aulas/semana', value: weeklyClassesCount ?? 0 },
          { label: 'Nível', value: (profile?.level ?? '—').toUpperCase() },
        ]}
      />
```

- [ ] **Step 3: Padronizar títulos de seção**

Substituir os quatro blocos de título (`<h2 className="text-base font-semibold...">` com/sem link "ver todas/todos") por:

```tsx
<SectionHeader title="Aulas de hoje" />
<SectionHeader title="Day Use hoje" href="/agendar/dayuse" linkLabel="reservar" />
<SectionHeader title="Minhas Próximas Aulas" href="/aulas" linkLabel="ver todas" />
<SectionHeader title="Próximos Torneios" href="/torneios" />
```

- [ ] **Step 4: EmptyState para "nenhuma aula"**

Substituir o `<Card><p>Nenhuma aula agendada...` por:

```tsx
          <EmptyState
            icon={CalendarPlus}
            title="Nenhuma aula agendada"
            description="Garanta sua vaga na próxima aula da sua turma."
            ctaHref="/agendar"
            ctaLabel="Agendar agora"
          />
```

- [ ] **Step 5: loading.tsx**

Criar `app/(dashboard)/home/loading.tsx`:

```tsx
import { PageSkeleton } from '@/components/ui/Skeleton'
export default function Loading() {
  return <PageSkeleton />
}
```

- [ ] **Step 6: Verificar e commitar**

Run: `npm run build` — Expected: sucesso.
Run: `npm run dev`, abrir `/home` — StatHeader com gradiente, 3 estatísticas, seções padronizadas.

```bash
git add "app/(dashboard)/home/page.tsx" "app/(dashboard)/home/loading.tsx"
git commit -m "feat(design): Home com StatHeader, SectionHeader e EmptyState"
```

### Task 12: Agendar + Day Use

**Files:**
- Modify: `app/(dashboard)/agendar/page.tsx`
- Modify: `app/(dashboard)/agendar/dayuse/page.tsx`
- Modify: `features/aulas/AgendarClient.tsx` (estados visuais)
- Create: `app/(dashboard)/agendar/loading.tsx` (mesmo conteúdo do loading da Task 11)

- [ ] **Step 1: Ler os três arquivos e aplicar o mapeamento padrão**

Mapeamento mecânico (o "mapeamento padrão" — repetido nas Tasks 13 e 16):
- Títulos de seção ad-hoc (`<h2 className="text-base font-semibold ...">` + link opcional) → `<SectionHeader title=... href=... linkLabel=... />`
- Textos de vazio ad-hoc (`<p>Nenhum...</p>` dentro de Card) → `<EmptyState icon={...} title=... description=... />` (ícones lucide: `CalendarX`, `Users`, `Trophy` conforme contexto)
- Botões `<button className="bg-brand-600 ...">` fora do componente `Button` → `<Button>` do design system
- Cards onde o aluno **já tem reserva/matrícula** → adicionar prop `accent` ao `<Card>`
- Erros de actions exibidos via `alert()` ou texto solto → banner padronizado:

```tsx
{error && (
  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
    {error}
  </p>
)}
```

- [ ] **Step 2: Estados visuais no AgendarClient**

Em `features/aulas/AgendarClient.tsx`, garantir três estados visíveis no card de sessão (usando os componentes já existentes no arquivo):
- **Disponível**: `<Button>` primário "Agendar"
- **Lotada**: `<Badge variant="danger">LOTADA</Badge>` + botão de fila com contagem (`Fila de espera ({sessionWaitlistCount})`)
- **Agendado**: `<Badge variant="success">CONFIRMADO</Badge>` + Card pai com `accent`

Manter as actions e props atuais — mudança apenas de apresentação.

- [ ] **Step 3: loading.tsx**

Criar `app/(dashboard)/agendar/loading.tsx` com o mesmo conteúdo da Task 11 Step 5.

- [ ] **Step 4: Verificar e commitar**

Run: `npm run build`; `npm run dev` → `/agendar` e `/agendar/dayuse` — três estados distinguíveis à primeira vista.

```bash
git add "app/(dashboard)/agendar" features/aulas/AgendarClient.tsx
git commit -m "feat(design): agendar/day use com estados visuais claros"
```

### Task 13: Aulas, Comunidade e Perfil

**Files:**
- Modify: `app/(dashboard)/aulas/page.tsx`
- Modify: `app/(dashboard)/comunidade/ComunidadeClient.tsx` e `features/comunidade/PostCard.tsx`
- Modify: `app/(dashboard)/perfil/page.tsx`
- Create: `app/(dashboard)/aulas/loading.tsx`, `app/(dashboard)/comunidade/loading.tsx`, `app/(dashboard)/perfil/loading.tsx` (mesmo conteúdo da Task 11 Step 5)

Mapeamento padrão (mesmo da Task 12): títulos ad-hoc → `SectionHeader`; vazios ad-hoc → `EmptyState`; `<button>` cru → `Button`; card de reserva/matrícula ativa → `Card accent`; erro de action → banner `text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2`.

- [ ] **Step 1: Aulas** — aplicar o mapeamento padrão acima; card da próxima aula do aluno ganha `accent`; vazio → `<EmptyState icon={CalendarX} title="Você ainda não tem aulas" ctaHref="/agendar" ctaLabel="Agendar aula" />`.

- [ ] **Step 2: Comunidade** — `PostCard` passa a usar `<Card>`; feed vazio → `<EmptyState icon={Users} title="Nenhum post ainda" description="Seja o primeiro a compartilhar com a galera." />`.

- [ ] **Step 3: Perfil** — seção de créditos vira grid de `StatCard`s:

```tsx
<div className="grid grid-cols-2 gap-3">
  <StatCard label="Créditos" value={creditsBalance} />
  <StatCard label="Nível" value={level.toUpperCase()} />
</div>
```

(usar as variáveis já existentes na página; seções restantes seguem o mapeamento padrão).

- [ ] **Step 4: loading.tsx das três rotas** (conteúdo da Task 11 Step 5).

- [ ] **Step 5: Verificar e commitar**

Run: `npm run build`; verificação visual de `/aulas`, `/comunidade`, `/perfil`.

```bash
git add "app/(dashboard)/aulas" "app/(dashboard)/comunidade" "app/(dashboard)/perfil" features/comunidade/PostCard.tsx
git commit -m "feat(design): aulas, comunidade e perfil no padrão Sport Bold"
```

### Task 14: Login / Cadastro / Recuperar senha

**Files:**
- Modify: `app/(auth)/login/page.tsx`, `app/(auth)/cadastro/page.tsx`, `app/(auth)/recuperar-senha/page.tsx`

- [ ] **Step 1: Toque de marca**

Em cada página, envolver o card do formulário com um detalhe de gradiente — faixa no topo do card:

```tsx
<div className="h-1.5 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
```

(colocada imediatamente acima do container do formulário; manter formulários e lógica intactos — os `Button`/`Input` já herdam o novo estilo).

- [ ] **Step 2: Verificar e commitar**

Run: `npm run build`; visual em `/login`.

```bash
git add "app/(auth)"
git commit -m "feat(design): toque de gradiente nas telas de auth"
```

---

## FASE 4 — Telas do Admin

### Task 15: Dashboard admin com StatCards

**Files:**
- Modify: `app/(admin)/admin/dashboard/page.tsx`
- Modify: `app/(admin)/layout.tsx` (sidebar)

- [ ] **Step 1: StatCards no topo do dashboard**

Ler `app/(admin)/admin/dashboard/page.tsx`. Envolver as métricas existentes (e adicionar as ausentes) num grid:

```tsx
<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
  <StatCard label="Alunos ativos" value={activeStudents} />
  <StatCard label="Aulas hoje" value={todaySessionsCount} />
  <StatCard label="Matrículas ativas" value={activeEnrollments} />
  <StatCard label="Day use hoje" value={todayDayUseCount} />
</div>
```

Queries para métricas ausentes (padrão `count exact/head` com `createAdminClient()`):

```ts
const { count: activeStudents } = await adminClient
  .from('profiles').select('id', { count: 'exact', head: true })
  .eq('role', 'student').eq('is_active', true)

const { count: todaySessionsCount } = await adminClient
  .from('class_sessions').select('id', { count: 'exact', head: true })
  .eq('session_date', today).eq('status', 'scheduled')

const { count: activeEnrollments } = await adminClient
  .from('enrollments').select('id', { count: 'exact', head: true })
  .eq('is_active', true)

const { count: todayDayUseCount } = await adminClient
  .from('dayuse_slots').select('id', { count: 'exact', head: true })
  .eq('date', today).eq('is_active', true)
```

(Se alguma coluna não existir — ex.: `profiles.is_active` —, omitir esse filtro e anotar no commit.)

- [ ] **Step 2: Sidebar com gradiente da marca**

Em `app/(admin)/layout.tsx`, localizar o container do logo/topo da sidebar e aplicar:

```tsx
className="bg-gradient-to-br from-brand-600 to-brand-800"
```

no bloco do cabeçalho da sidebar (apenas o topo, não a sidebar inteira — manter navegação em `bg-surface-card`).

- [ ] **Step 3: Verificar e commitar**

Run: `npm run build`; visual em `/admin/dashboard` (login com usuário admin).

```bash
git add "app/(admin)/admin/dashboard/page.tsx" "app/(admin)/layout.tsx"
git commit -m "feat(design): dashboard admin com StatCards e sidebar com gradiente"
```

### Task 16: Grade e varredura de consistência nas demais telas admin

**Files:**
- Modify: `app/(admin)/admin/grade/page.tsx` (e subpáginas conforme a varredura)
- Modify: demais páginas em `app/(admin)/admin/` apontadas pela varredura

Mapeamento padrão (mesmo da Task 12): títulos ad-hoc → `SectionHeader`; vazios ad-hoc → `EmptyState`; `<button>` cru → `Button`; card de item ativo/destacado → `Card accent`; erro de action → banner `text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2`.

- [ ] **Step 1: Grade — cards escaneáveis**

Aplicar o mapeamento padrão acima em `app/(admin)/admin/grade/page.tsx`: badges de nível/kids já ficam sólidos via componente; destacar a contagem de vagas com:

```tsx
<span className="text-sm font-extrabold text-brand-500">{enrolledCount}/{maxStudents}</span>
```

- [ ] **Step 2: Varredura de cores hardcoded**

Buscar (ferramenta Grep ou ripgrep): padrão `#1e293b|#0f172a|#334155|bg-slate-800|bg-slate-900` em `app/`, `components/`, `features/`.

Para cada arquivo encontrado: trocar pelo token equivalente (`bg-surface-card`, `bg-surface`, `border-surface-border`). Nenhuma cor de superfície hardcoded deve sobrar.

- [ ] **Step 3: Vazios das telas admin**

Telas de lista (alunos, financeiro, torneios, notificações) com texto de vazio ad-hoc → `EmptyState` (ícones: `Users`, `DollarSign`, `Trophy`, `Bell`).

- [ ] **Step 4: Verificar e commitar**

Run: `npm run build` e `npm run test:run` — Expected: ambos verdes.

```bash
git add app components features
git commit -m "feat(design): grade admin e varredura de consistência de tokens"
```

---

## Verificação Final

### Task 17: Validação completa

- [ ] **Step 1: Suite completa**

Run: `npm run test:run` — Expected: PASS.
Run: `npm run lint` — Expected: sem erros.
Run: `npm run build` — Expected: sucesso.

- [ ] **Step 2: Passeio visual**

`npm run dev` e percorrer: `/login` → `/home` → `/agendar` → `/aulas` → `/comunidade` → `/perfil` → `/admin/dashboard` → `/admin/grade`. Conferir: gradientes, badges sólidos, estados vazios, loading (recarregar com rede lenta no DevTools).

- [ ] **Step 3: Confirmar migration aplicada**

Confirmar que `20260611000000_booking_and_credit_rpcs.sql` foi aplicada (Task 3 Step 2). Sem ela, agendamento e cancelamento quebram em produção.

- [ ] **Step 4: Commit final (se houver ajustes do passeio visual)**

```bash
git add -A
git commit -m "chore: ajustes finais do redesign Sport Bold"
```
