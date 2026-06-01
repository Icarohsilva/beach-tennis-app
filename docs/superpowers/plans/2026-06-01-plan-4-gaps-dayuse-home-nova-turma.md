# Plan 4: Day Use UI + Home Melhorada + Nova Turma + Ajustes

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a UI completa de day use (404 hoje), corrigir o tipo `Class` (falta campo `court`), melhorar a Home com próximas aulas e créditos, e adicionar o formulário de nova turma no admin.

**Architecture:** Todas as features usam o padrão existente do projeto — Server Components buscam dados com `createClient()` ou `createAdminClient()`, Client Components recebem via props, Server Actions mutam. Day use usa tabelas `dayuse_slots` e `dayuse_bookings` já criadas na migration 004. Nenhuma nova tabela necessária.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase · Tailwind CSS · Vitest

---

## Diagnóstico atual

| Item | Estado | Impacto |
|---|---|---|
| `types/index.ts` — campo `court` ausente em `Class` | ❌ Bug de tipo | Grade admin compila com erro silencioso |
| `types/index.ts` — `DayUseSlot`, `DayUseBooking` ausentes | ❌ Missing | Bloqueia todo o day use |
| `features/dayuse/` — diretório não existe | ❌ Missing | Day use retorna 404 |
| `app/(dashboard)/agendar/dayuse/page.tsx` | ❌ Missing | 404 no aluno |
| `app/(admin)/admin/grade/dayuse/page.tsx` | ❌ Missing | 404 no admin |
| `app/(admin)/admin/grade/nova-turma/page.tsx` | ❌ Missing | Admin não consegue criar turmas |
| `features/aulas/ClassForm.tsx` | ❌ Missing | Sem form de nova turma |
| `app/(dashboard)/home/page.tsx` | ⚠️ Incompleto | Só mostra torneios, sem próximas aulas ou saldo |

---

## File Map

**Criar:**
- `features/dayuse/actions.ts`
- `features/dayuse/DayUseSlotCard.tsx`
- `features/dayuse/CreateDayUseForm.tsx`
- `features/dayuse/DayUseBookingCard.tsx`
- `features/aulas/class-form-actions.ts`
- `features/aulas/ClassForm.tsx`
- `app/(admin)/admin/grade/dayuse/page.tsx`
- `app/(admin)/admin/grade/nova-turma/page.tsx`
- `app/(dashboard)/agendar/dayuse/page.tsx`

**Modificar:**
- `types/index.ts` — adicionar `court` em `Class` + interfaces `DayUseSlot` e `DayUseBooking`
- `app/(dashboard)/home/page.tsx` — adicionar próximas aulas + saldo créditos
- `app/(dashboard)/agendar/page.tsx` — banner de day use
- `app/(admin)/admin/grade/page.tsx` — links "+ Nova Turma" e "Day Use"

---

## Task 1: Corrigir `types/index.ts`

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Escrever teste de tipo**

```typescript
// types/index.test.ts  (criar se não existir)
import type { Class, DayUseSlot, DayUseBooking } from './index'
import { describe, it, expect } from 'vitest'

describe('types', () => {
  it('Class has court field', () => {
    const c: Class = {
      id: '1', name: 'Terça 18h', description: null,
      level: 'iniciante', type: 'adult', day_of_week: 2,
      start_time: '18:00', end_time: '19:00',
      max_students: 8, is_active: true, court: 1,
    }
    expect(c.court).toBe(1)
  })

  it('DayUseSlot has required shape', () => {
    const s: DayUseSlot = {
      id: 'abc', court: 2, date: '2026-06-10',
      start_time: '09:00', end_time: '10:00',
      capacity: 8, notes: null, is_active: true,
      created_by: 'uid', created_at: '2026-06-01T00:00:00Z',
    }
    expect(s.court).toBe(2)
  })

  it('DayUseBooking status is union type', () => {
    const b: DayUseBooking = {
      id: 'x', slot_id: 'y', student_id: 'z',
      status: 'confirmed',
      booked_at: '2026-06-01T00:00:00Z',
      cancelled_at: null,
    }
    expect(b.status).toBe('confirmed')
  })
})
```

- [ ] **Step 2: Rodar teste — espera falhar**

```bash
npm run test:run -- types/index.test.ts
```

Saída esperada: erro de compilação TypeScript (`court` não existe em `Class`)

- [ ] **Step 3: Atualizar `types/index.ts`**

Substituir a interface `Class` existente (linhas 39–50):

```typescript
export interface Class {
  id: string
  name: string
  description: string | null
  level: StudentLevel
  type: ClassType
  day_of_week: number // 0=Sunday, 6=Saturday
  start_time: string  // HH:MM
  end_time: string
  max_students: number
  is_active: boolean
  court: number       // 1 ou 2
}
```

Adicionar antes do bloco `// Joined types for UI` no final do arquivo:

```typescript
export interface DayUseSlot {
  id: string
  court: number       // 1 ou 2
  date: string        // YYYY-MM-DD
  start_time: string  // HH:MM
  end_time: string
  capacity: number
  notes: string | null
  is_active: boolean
  created_by: string
  created_at: string
}

export interface DayUseBooking {
  id: string
  slot_id: string
  student_id: string
  status: 'confirmed' | 'cancelled'
  booked_at: string
  cancelled_at: string | null
}
```

- [ ] **Step 4: Rodar teste — espera passar**

```bash
npm run test:run -- types/index.test.ts
```

Saída esperada: `3 passed`

- [ ] **Step 5: Verificar build completo**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully` (sem erros de tipo)

- [ ] **Step 6: Commit**

```bash
git add types/index.ts types/index.test.ts
git commit -m "fix: adicionar court em Class e interfaces DayUseSlot/DayUseBooking"
```

---

## Task 2: Server Actions de day use

**Files:**
- Create: `features/dayuse/actions.ts`
- Test: `features/dayuse/actions.test.ts`

- [ ] **Step 1: Escrever testes para validação pura**

```typescript
// features/dayuse/actions.test.ts
import { describe, it, expect } from 'vitest'
import { validateDayUseSlot } from './actions'

describe('validateDayUseSlot', () => {
  it('rejeita quando end_time <= start_time', () => {
    expect(validateDayUseSlot('10:00', '09:00').error).toMatch(/fim/)
    expect(validateDayUseSlot('10:00', '10:00').error).toMatch(/fim/)
  })

  it('rejeita capacidade menor que 1', () => {
    expect(validateDayUseSlot('09:00', '10:00', 0).error).toMatch(/capacidade/)
  })

  it('aceita slot válido', () => {
    expect(validateDayUseSlot('09:00', '10:00', 4).error).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar — espera falhar**

```bash
npm run test:run -- features/dayuse/actions.test.ts
```

Saída esperada: `Cannot find module './actions'`

- [ ] **Step 3: Criar `features/dayuse/actions.ts`**

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'

// ── Validação pura (exportada para testes) ──────────────────────────────────
export function validateDayUseSlot(
  startTime: string,
  endTime: string,
  capacity = 1,
): { error?: string } {
  if (startTime >= endTime) return { error: 'Horário de fim deve ser depois do início' }
  if (capacity < 1) return { error: 'Capacidade mínima é 1' }
  return {}
}

// ── Admin: criar slot ────────────────────────────────────────────────────────
export interface CreateDayUseSlotData {
  court: number
  date: string       // YYYY-MM-DD
  start_time: string // HH:MM
  end_time: string   // HH:MM
  capacity: number
  notes?: string
}

export async function createDayUseSlot(
  data: CreateDayUseSlotData,
): Promise<{ error?: string }> {
  const validation = validateDayUseSlot(data.start_time, data.end_time, data.capacity)
  if (validation.error) return validation

  const adminClient = createAdminClient()
  const { data: { user } } = await adminClient.auth.getUser()

  const { error } = await adminClient.from('dayuse_slots').insert({
    ...data,
    notes: data.notes || null,
    created_by: user?.id,
    is_active: true,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  return {}
}

// ── Admin: desativar slot ────────────────────────────────────────────────────
export async function deactivateDayUseSlot(
  slotId: string,
): Promise<{ error?: string }> {
  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('dayuse_slots')
    .update({ is_active: false })
    .eq('id', slotId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  return {}
}

// ── Aluno: reservar slot (sem crédito) ───────────────────────────────────────
export async function bookDayUse(slotId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // Verificar capacidade disponível
  const { data: slot } = await supabase
    .from('dayuse_slots')
    .select('capacity')
    .eq('id', slotId)
    .single()
  if (!slot) return { error: 'Slot não encontrado' }

  const { count } = await supabase
    .from('dayuse_bookings')
    .select('*', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .eq('status', 'confirmed')

  if ((count ?? 0) >= slot.capacity) return { error: 'Slot lotado' }

  const { error } = await supabase.from('dayuse_bookings').insert({
    slot_id: slotId,
    student_id: user.id,
    status: 'confirmed',
  })

  if (error?.code === '23505') return { error: 'Você já tem uma reserva neste horário' }
  if (error) return { error: error.message }

  revalidatePath('/agendar/dayuse')
  return {}
}

// ── Aluno: cancelar reserva ──────────────────────────────────────────────────
export async function cancelDayUseBooking(
  bookingId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase
    .from('dayuse_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('student_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/agendar/dayuse')
  return {}
}
```

- [ ] **Step 4: Rodar testes — espera passar**

```bash
npm run test:run -- features/dayuse/actions.test.ts
```

Saída esperada: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add features/dayuse/actions.ts features/dayuse/actions.test.ts
git commit -m "feat: server actions de day use com validação testada"
```

---

## Task 3: Componentes admin de day use

**Files:**
- Create: `features/dayuse/CreateDayUseForm.tsx`
- Create: `features/dayuse/DayUseSlotCard.tsx`

- [ ] **Step 1: Criar `CreateDayUseForm.tsx`**

```tsx
// features/dayuse/CreateDayUseForm.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createDayUseSlot } from './actions'

export function CreateDayUseForm() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSuccess(false)
    const fd = new FormData(e.currentTarget)
    const result = await createDayUseSlot({
      court: Number(fd.get('court')),
      date: fd.get('date') as string,
      start_time: fd.get('start_time') as string,
      end_time: fd.get('end_time') as string,
      capacity: Number(fd.get('capacity')),
      notes: (fd.get('notes') as string) || undefined,
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    setSuccess(true);
    (e.target as HTMLFormElement).reset()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-card border border-surface-border rounded-xl p-4 space-y-3">
      <h3 className="text-white font-semibold text-sm">Novo Slot de Day Use</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Data</label>
          <Input name="date" type="date" required />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Quadra</label>
          <select name="court" className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="1">Quadra 1</option>
            <option value="2">Quadra 2</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Início</label>
          <Input name="start_time" type="time" required />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Fim</label>
          <Input name="end_time" type="time" required />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Vagas</label>
          <Input name="capacity" type="number" min="1" max="20" defaultValue="8" required />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 block mb-1">Observação (opcional)</label>
        <Input name="notes" placeholder="Ex: Aberto para todos os níveis" />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {success && <p className="text-green-400 text-xs">Slot criado com sucesso!</p>}
      <Button type="submit" disabled={pending} size="sm">
        {pending ? 'Criando...' : 'Criar Slot'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Criar `DayUseSlotCard.tsx`**

```tsx
// features/dayuse/DayUseSlotCard.tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime } from '@/lib/utils/dateHelpers'
import { deactivateDayUseSlot } from './actions'
import type { DayUseSlot } from '@/types'

interface Props {
  slot: DayUseSlot
  bookingsCount: number
}

export function DayUseSlotCard({ slot, bookingsCount }: Props) {
  const [loading, setLoading] = useState(false)
  const isFull = bookingsCount >= slot.capacity

  async function handleRemove() {
    if (!confirm('Remover este slot de day use?')) return
    setLoading(true)
    await deactivateDayUseSlot(slot.id)
  }

  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
            Quadra {slot.court}
          </span>
          {isFull
            ? <Badge variant="danger">Lotado</Badge>
            : <Badge variant="success">Disponível</Badge>
          }
        </div>
        <p className="text-white text-sm font-medium">
          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
        </p>
        {slot.notes && <p className="text-slate-400 text-xs mt-0.5 truncate">{slot.notes}</p>}
        <p className="text-slate-500 text-xs mt-1">{bookingsCount}/{slot.capacity} reservas</p>
      </div>
      <Button variant="danger" size="sm" disabled={loading} onClick={handleRemove}>
        {loading ? '...' : 'Remover'}
      </Button>
    </Card>
  )
}
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add features/dayuse/CreateDayUseForm.tsx features/dayuse/DayUseSlotCard.tsx
git commit -m "feat: componentes admin de day use (formulário e card)"
```

---

## Task 4: Componente aluno de day use

**Files:**
- Create: `features/dayuse/DayUseBookingCard.tsx`

- [ ] **Step 1: Criar `DayUseBookingCard.tsx`**

```tsx
// features/dayuse/DayUseBookingCard.tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime } from '@/lib/utils/dateHelpers'
import { bookDayUse, cancelDayUseBooking } from './actions'
import type { DayUseSlot } from '@/types'

interface Props {
  slot: DayUseSlot
  bookingsCount: number
  myBookingId: string | null  // null = não reservado ainda
}

export function DayUseBookingCard({ slot, bookingsCount, myBookingId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(myBookingId)
  const [localCount, setLocalCount] = useState(bookingsCount)
  const isFull = localCount >= slot.capacity

  async function handleBook() {
    setLoading(true)
    setError(null)
    const result = await bookDayUse(slot.id)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    // Optimistic: will revalidate via server, just update local state hint
    setLocalCount((c) => c + 1)
    setBookingId('pending') // real ID comes via revalidation
  }

  async function handleCancel() {
    if (!bookingId || bookingId === 'pending') return
    setLoading(true)
    setError(null)
    const result = await cancelDayUseBooking(bookingId)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    setBookingId(null)
    setLocalCount((c) => Math.max(0, c - 1))
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
              Quadra {slot.court}
            </span>
            <span className="text-xs bg-green-900/40 text-green-300 border border-green-700/50 px-2 py-0.5 rounded-full">
              Day Use · Gratuito
            </span>
            {isFull && !bookingId && <Badge variant="danger">Lotado</Badge>}
          </div>
          <p className="text-white text-sm font-medium">
            {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
          </p>
          {slot.notes && <p className="text-slate-400 text-xs mt-0.5">{slot.notes}</p>}
          <p className="text-slate-500 text-xs mt-1">{localCount}/{slot.capacity} reservas</p>
        </div>

        <div className="shrink-0">
          {bookingId ? (
            <div className="flex flex-col items-end gap-1">
              <Badge variant="success">Reservado</Badge>
              {bookingId !== 'pending' && (
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Cancelar
                </button>
              )}
            </div>
          ) : (
            <Button size="sm" disabled={loading || isFull} onClick={handleBook}>
              {loading ? '...' : 'Reservar'}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </Card>
  )
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add features/dayuse/DayUseBookingCard.tsx
git commit -m "feat: componente aluno para reservar/cancelar day use"
```

---

## Task 5: Página admin de day use

**Files:**
- Create: `app/(admin)/admin/grade/dayuse/page.tsx`
- Modify: `app/(admin)/admin/grade/page.tsx`

- [ ] **Step 1: Criar `app/(admin)/admin/grade/dayuse/page.tsx`**

```tsx
// app/(admin)/admin/grade/dayuse/page.tsx
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { CreateDayUseForm } from '@/features/dayuse/CreateDayUseForm'
import { DayUseSlotCard } from '@/features/dayuse/DayUseSlotCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'

export default async function AdminDayUsePage() {
  const adminClient = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: slots } = await adminClient
    .from('dayuse_slots')
    .select('*')
    .eq('is_active', true)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const slotList = (slots ?? []) as DayUseSlot[]
  const slotIds = slotList.map((s) => s.id)

  const { data: bookingsRaw } =
    slotIds.length > 0
      ? await adminClient
          .from('dayuse_bookings')
          .select('slot_id')
          .in('slot_id', slotIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const countMap = new Map<string, number>()
  for (const b of (bookingsRaw ?? []) as { slot_id: string }[]) {
    countMap.set(b.slot_id, (countMap.get(b.slot_id) ?? 0) + 1)
  }

  const byDate = new Map<string, DayUseSlot[]>()
  for (const slot of slotList) {
    const arr = byDate.get(slot.date) ?? []
    arr.push(slot)
    byDate.set(slot.date, arr)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">
          ← Grade
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Day Use</h1>
        <p className="text-slate-400 text-sm">{slotList.length} slots futuros</p>
      </div>

      <CreateDayUseForm />

      <div className="space-y-6">
        {byDate.size === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum slot de day use agendado. Crie um acima.</p>
        ) : (
          Array.from(byDate.entries()).map(([date, dateSlots]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
                {formatDate(date, "EEEE, dd 'de' MMMM")}
              </h2>
              <div className="space-y-2">
                {dateSlots.map((slot) => (
                  <DayUseSlotCard
                    key={slot.id}
                    slot={slot}
                    bookingsCount={countMap.get(slot.id) ?? 0}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Adicionar links na grade admin**

Em `app/(admin)/admin/grade/page.tsx`, substituir o header:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold text-white">Grade de Aulas</h1>
  <div className="flex gap-2">
    <Link
      href="/admin/grade/dayuse"
      className="text-sm bg-surface-card border border-surface-border text-slate-300 hover:text-white px-3 py-1.5 rounded-md transition-colors"
    >
      Day Use
    </Link>
    <Link
      href="/admin/grade/nova-turma"
      className="text-sm bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-md transition-colors"
    >
      + Nova Turma
    </Link>
  </div>
</div>
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/grade/dayuse/ app/\(admin\)/admin/grade/page.tsx
git commit -m "feat: página admin de day use e links na grade"
```

---

## Task 6: Página aluno de day use

**Files:**
- Create: `app/(dashboard)/agendar/dayuse/page.tsx`
- Modify: `app/(dashboard)/agendar/page.tsx`

- [ ] **Step 1: Criar `app/(dashboard)/agendar/dayuse/page.tsx`**

```tsx
// app/(dashboard)/agendar/dayuse/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DayUseBookingCard } from '@/features/dayuse/DayUseBookingCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'

export default async function AgendarDayUsePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)

  const { data: slots } = await supabase
    .from('dayuse_slots')
    .select('*')
    .eq('is_active', true)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const slotList = (slots ?? []) as DayUseSlot[]
  const slotIds = slotList.map((s) => s.id)

  const { data: allBookings } =
    slotIds.length > 0
      ? await supabase
          .from('dayuse_bookings')
          .select('id, slot_id, student_id')
          .in('slot_id', slotIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const countMap = new Map<string, number>()
  const myBookings = new Map<string, string>() // slotId → bookingId
  for (const b of (allBookings ?? []) as { id: string; slot_id: string; student_id: string }[]) {
    countMap.set(b.slot_id, (countMap.get(b.slot_id) ?? 0) + 1)
    if (b.student_id === user.id) myBookings.set(b.slot_id, b.id)
  }

  const byDate = new Map<string, DayUseSlot[]>()
  for (const slot of slotList) {
    const arr = byDate.get(slot.date) ?? []
    arr.push(slot)
    byDate.set(slot.date, arr)
  }

  return (
    <div className="p-4 space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Link href="/agendar" className="text-slate-400 hover:text-white text-sm">
          ← Agendar
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-bold text-white">Day Use</h1>
        <p className="text-slate-400 text-sm mt-1">
          Reserva de quadra sem usar créditos
        </p>
      </div>

      {byDate.size === 0 ? (
        <div className="bg-surface-card border border-surface-border rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">
            Nenhum horário de day use disponível no momento.
          </p>
          <p className="text-slate-500 text-xs mt-1">
            O professor divulga os horários com antecedência.
          </p>
        </div>
      ) : (
        Array.from(byDate.entries()).map(([date, dateSlots]) => (
          <div key={date}>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
              {formatDate(date, "EEEE, dd 'de' MMMM")}
            </h2>
            <div className="space-y-2">
              {dateSlots.map((slot) => (
                <DayUseBookingCard
                  key={slot.id}
                  slot={slot}
                  bookingsCount={countMap.get(slot.id) ?? 0}
                  myBookingId={myBookings.get(slot.id) ?? null}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 2: Adicionar banner de day use em `app/(dashboard)/agendar/page.tsx`**

Após o import block, localizar o JSX principal e adicionar antes da lista de turmas:

```tsx
import Link from 'next/link'

// Adicionar no início do return, após o <h1>:
<Link
  href="/agendar/dayuse"
  className="flex items-center justify-between bg-green-900/20 border border-green-700/40 rounded-xl px-4 py-3 hover:bg-green-900/30 transition-colors"
>
  <div>
    <p className="text-green-300 text-sm font-medium">Day Use disponível</p>
    <p className="text-green-500/80 text-xs mt-0.5">Reservar quadra sem usar créditos →</p>
  </div>
  <span className="text-2xl">🏖️</span>
</Link>
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/agendar/dayuse/ app/\(dashboard\)/agendar/page.tsx
git commit -m "feat: aluno pode ver e reservar slots de day use"
```

---

## Task 7: Nova turma — admin

**Files:**
- Create: `features/aulas/class-form-actions.ts`
- Create: `features/aulas/ClassForm.tsx`
- Create: `app/(admin)/admin/grade/nova-turma/page.tsx`

- [ ] **Step 1: Criar `features/aulas/class-form-actions.ts`**

```typescript
// features/aulas/class-form-actions.ts
'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StudentLevel, ClassType } from '@/types'

export interface ClassFormData {
  name: string
  description: string
  level: StudentLevel
  type: ClassType
  day_of_week: number
  start_time: string
  end_time: string
  max_students: number
  court: number
}

export async function createClass(data: ClassFormData): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Nome é obrigatório' }
  if (data.start_time >= data.end_time) return { error: 'Horário de fim deve ser depois do início' }

  const adminClient = createAdminClient()
  const { error } = await adminClient.from('classes').insert({ ...data, is_active: true })
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  return {}
}

export async function deactivateClass(classId: string): Promise<{ error?: string }> {
  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('classes')
    .update({ is_active: false })
    .eq('id', classId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  return {}
}
```

- [ ] **Step 2: Criar `features/aulas/ClassForm.tsx`**

```tsx
// features/aulas/ClassForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClass } from './class-form-actions'
import type { StudentLevel, ClassType } from '@/types'

const LEVELS: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

const SELECT_CLS =
  'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'

export function ClassForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const result = await createClass({
      name: fd.get('name') as string,
      description: fd.get('description') as string,
      level: fd.get('level') as StudentLevel,
      type: fd.get('type') as ClassType,
      day_of_week: Number(fd.get('day_of_week')),
      start_time: fd.get('start_time') as string,
      end_time: fd.get('end_time') as string,
      max_students: Number(fd.get('max_students')),
      court: Number(fd.get('court')),
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    router.push('/admin/grade')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div>
        <label className="text-sm text-slate-400 block mb-1">Nome da turma *</label>
        <Input name="name" required placeholder="Ex: Terça 18h — Intermediário" />
      </div>

      <div>
        <label className="text-sm text-slate-400 block mb-1">Descrição (opcional)</label>
        <Input name="description" placeholder="Detalhes ou observações" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Nível</label>
          <select name="level" required className={SELECT_CLS}>
            {LEVELS.map((l) => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Tipo</label>
          <select name="type" required className={SELECT_CLS}>
            <option value="adult">Adulto</option>
            <option value="kids">Kids</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Dia da semana</label>
          <select name="day_of_week" required className={SELECT_CLS}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Quadra</label>
          <select name="court" required className={SELECT_CLS}>
            <option value="1">Quadra 1</option>
            <option value="2">Quadra 2</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Início *</label>
          <Input name="start_time" type="time" required />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Fim *</label>
          <Input name="end_time" type="time" required />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Vagas *</label>
          <Input name="max_students" type="number" required min="1" max="20" defaultValue="8" />
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Criando...' : 'Criar Turma'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/admin/grade')}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Criar `app/(admin)/admin/grade/nova-turma/page.tsx`**

```tsx
// app/(admin)/admin/grade/nova-turma/page.tsx
import Link from 'next/link'
import { ClassForm } from '@/features/aulas/ClassForm'

export default function NovaTurmaPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">
          ← Grade
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-white">Nova Turma</h1>
        <p className="text-slate-400 text-sm mt-1">
          A turma ficará visível para alunos com nível compatível.
        </p>
      </div>
      <ClassForm />
    </div>
  )
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add features/aulas/class-form-actions.ts features/aulas/ClassForm.tsx app/\(admin\)/admin/grade/nova-turma/
git commit -m "feat: admin pode criar novas turmas com seleção de quadra e horário"
```

---

## Task 8: Home page — próximas aulas e créditos

**Files:**
- Modify: `app/(dashboard)/home/page.tsx`

- [ ] **Step 1: Atualizar `app/(dashboard)/home/page.tsx` com próximas aulas e saldo**

```tsx
// app/(dashboard)/home/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type { Tournament, Profile } from '@/types'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)

  const [
    { data: profileData },
    { data: tournamentsData },
    { data: nextSessionsData },
  ] = await Promise.all([
    // Perfil para saldo de créditos
    supabase
      .from('profiles')
      .select('full_name, credits_balance, payment_type')
      .eq('id', user.id)
      .single(),

    // Próximos 3 torneios abertos
    supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'open')
      .order('date', { ascending: true })
      .limit(3),

    // Próximas sessões confirmadas do aluno (hoje em diante, máx 5)
    supabase
      .from('session_bookings')
      .select('id, session:class_sessions(id, session_date, class:classes(name, start_time, end_time, level, type))')
      .eq('student_id', user.id)
      .eq('status', 'confirmed')
      .gte('session_date', today)
      .order('session_date', { referencedTable: 'class_sessions', ascending: true })
      .limit(5),
  ])

  const profile = profileData as Pick<Profile, 'full_name' | 'credits_balance' | 'payment_type'> | null
  const tournaments = (tournamentsData ?? []) as Tournament[]

  type NextSession = {
    id: string
    session: {
      id: string
      session_date: string
      class: { name: string; start_time: string; end_time: string; level: string; type: string }
    }
  }
  const nextSessions = (nextSessionsData ?? []) as NextSession[]
  const showCredits = profile?.payment_type !== 'wellhub' && profile?.payment_type !== 'totalpass'

  return (
    <div className="p-4 space-y-6 pb-24">
      {/* Saudação */}
      <div>
        <h1 className="text-xl font-bold text-white">
          Olá{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}!
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">Bom treino hoje 🎾</p>
      </div>

      {/* Saldo de créditos */}
      {showCredits && (
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-xs">Créditos disponíveis</p>
            <p className="text-3xl font-bold text-brand-500">{profile?.credits_balance ?? 0}</p>
          </div>
          <Link href="/perfil" className="text-xs text-slate-400 hover:text-white transition-colors">
            Ver plano →
          </Link>
        </Card>
      )}

      {/* Próximas aulas */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Minhas Próximas Aulas</h2>
          <Link href="/aulas" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
            ver todas →
          </Link>
        </div>
        {nextSessions.length === 0 ? (
          <Card>
            <p className="text-slate-400 text-sm text-center py-2">
              Nenhuma aula agendada.{' '}
              <Link href="/agendar" className="text-brand-500 hover:underline">
                Agendar agora →
              </Link>
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {nextSessions.map((item) => {
              const session = Array.isArray(item.session) ? item.session[0] : item.session
              const cls = Array.isArray(session?.class) ? session.class[0] : session?.class
              if (!session || !cls) return null
              return (
                <Card key={item.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{cls.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(session.session_date, "EEE, dd 'de' MMM")} · {formatTime(cls.start_time)}
                      </p>
                    </div>
                    {cls.type === 'kids'
                      ? <Badge variant="kids">KIDS</Badge>
                      : <Badge variant="level">{cls.level.toUpperCase()}</Badge>
                    }
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* Próximos Torneios */}
      {tournaments.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-white">Próximos Torneios</h2>
            <Link href="/torneios" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
              ver todos →
            </Link>
          </div>
          <div className="space-y-2">
            {tournaments.map((tournament) => (
              <Link key={tournament.id} href={`/torneios/${tournament.id}`}>
                <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{tournament.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(tournament.date, "dd 'de' MMMM")}
                      </p>
                    </div>
                    <Badge variant="level">Nível {tournament.level.toUpperCase()}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/home/page.tsx
git commit -m "feat: home mostra saudação, créditos e próximas aulas do aluno"
```

---

## Task 9: Push final + instruções de setup do banco

- [ ] **Step 1: Push para produção**

```bash
git push origin main
```

- [ ] **Step 2: Aplicar migrations no Supabase (ação do usuário)**

Acessar [SQL Editor](https://supabase.com/dashboard/project/fmzgsgwphsvkshzcnbwa/sql/new) e rodar em ordem:

**004 — quadras + day use (se ainda não rodou):**
```sql
-- cole o conteúdo de supabase/migrations/004_multi_court_and_dayuse.sql
```

**005 — ficha médica (se ainda não rodou):**
```sql
-- cole o conteúdo de supabase/migrations/005_medical_profiles.sql
```

**Seed das turmas (se ainda não rodou):**
```sql
-- cole o conteúdo de supabase/seeds/classes.sql
```

**Tornar conta admin:**
```sql
UPDATE profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'contatoicarosilva@outlook.com');
```

- [ ] **Step 3: Criar planos de assinatura no admin (ação do usuário)**

Após fazer login como admin:
1. Acessar `/admin/financeiro`
2. Na seção "Planos", criar pelo menos 1 plano (ex: "Plano Mensal", 2x/semana, 8 créditos/mês)
3. Sem planos no banco, o `PlanSelector` no perfil do aluno mostra vazio

Alternativamente, inserir direto no Supabase:
```sql
INSERT INTO subscription_plans (name, description, classes_per_week, credits_per_month, price_monthly, price_quarterly, price_annual, is_active)
VALUES
  ('Plano 2x', '2 aulas por semana', 2, 8, 0, 0, 0, true),
  ('Plano 3x', '3 aulas por semana', 3, 12, 0, 0, 0, true),
  ('Plano Livre', 'Sem limite fixo de dias', 5, 20, 0, 0, 0, true);
```

*(Preços em R$ 0,00 até confirmação com Hudson)*

---

## Self-Review

### Cobertura de requisitos

| Requisito | Task |
|---|---|
| Day use — 404 corrigido | Tasks 2, 3, 4, 5, 6 |
| Admin criar nova turma | Task 7 |
| Home com próximas aulas + créditos | Task 8 |
| `court` em `Class` — bug de tipo | Task 1 |
| `DayUseSlot` / `DayUseBooking` em types | Task 1 |
| Planos de assinatura — setup DB | Task 9 (usuário) |

### O que fica de fora deste plano (próxima iteração)

- Geração automática de `class_sessions` via cron (pg_cron) — hoje o admin precisaria criar manualmente via SQL
- Webhook do Mercado Pago — sem gateway ativo ainda
- Push notifications via Web Push API — Resend email é o canal disponível
- Busca de alunos com dia fixo na folha de presença de sessão
