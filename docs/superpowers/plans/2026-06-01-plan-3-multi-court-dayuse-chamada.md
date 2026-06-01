# Plan 3: Multi-Court, Day Use & Chamada UX

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar suporte a múltiplas quadras nas turmas, criar fluxo de day use (sem créditos) com gestão admin e booking pelo aluno, e melhorar o acesso rápido à chamada no painel admin.

**Architecture:** Três adições ao modelo de dados — coluna `court` em `classes`, tabelas `dayuse_slots` e `dayuse_bookings` — mais camadas de UI sobre os fluxos já existentes. Nenhuma alteração no sistema de créditos ou bookings de aulas regulares. Day use é completamente separado do fluxo de `session_bookings`.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (RLS + migrations) · Tailwind CSS · Vitest

---

## File Map

**Criar:**
- `supabase/migrations/004_multi_court_and_dayuse.sql`
- `features/dayuse/DayUseSlotCard.tsx`
- `features/dayuse/CreateDayUseForm.tsx`
- `features/dayuse/DayUseBookingCard.tsx`
- `features/dayuse/actions.ts`
- `features/aulas/ClassForm.tsx`
- `features/aulas/class-form-actions.ts`
- `app/(admin)/grade/nova-turma/page.tsx`
- `app/(admin)/grade/dayuse/page.tsx`
- `app/(dashboard)/agendar/dayuse/page.tsx`
- `supabase/seeds/classes.sql` *(placeholder — aguarda dados do usuário)*

**Modificar:**
- `types/index.ts` — adicionar `court` em `Class`, interfaces `DayUseSlot` e `DayUseBooking`
- `app/(admin)/grade/page.tsx` — tabs Quadra 1 / Quadra 2, link "Nova Turma", link "Day Use"
- `app/(admin)/grade/[sessionId]/page.tsx` — botão "Marcar Todos Presentes"
- `features/aulas/ClassCard.tsx` — badge de quadra
- `app/(dashboard)/agendar/page.tsx` — link/tab para day use

---

## Task 1: Migration — court em classes + tabelas de day use

**Files:**
- Create: `supabase/migrations/004_multi_court_and_dayuse.sql`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- supabase/migrations/004_multi_court_and_dayuse.sql

-- 1. Adicionar quadra às turmas existentes (padrão = 1)
ALTER TABLE classes ADD COLUMN IF NOT EXISTS court int NOT NULL DEFAULT 1;

-- 2. Slots de day use (criados pelo admin por data/horário/quadra)
CREATE TABLE IF NOT EXISTS dayuse_slots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court      int NOT NULL DEFAULT 1,
  date       date NOT NULL,
  start_time time NOT NULL,
  end_time   time NOT NULL,
  capacity   int NOT NULL DEFAULT 8,
  notes      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Bookings de day use (sem crédito, sem session_bookings)
CREATE TABLE IF NOT EXISTS dayuse_bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id      uuid NOT NULL REFERENCES dayuse_slots(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES profiles(id),
  status       text NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'cancelled')),
  booked_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

-- Um aluno só pode ter 1 booking confirmado por slot
CREATE UNIQUE INDEX IF NOT EXISTS dayuse_bookings_unique_confirmed
  ON dayuse_bookings(slot_id, student_id)
  WHERE status = 'confirmed';

-- RLS: dayuse_slots
ALTER TABLE dayuse_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dayuse_slots_select_active"
  ON dayuse_slots FOR SELECT
  USING (is_active = true);

CREATE POLICY "dayuse_slots_admin_all"
  ON dayuse_slots FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- RLS: dayuse_bookings
ALTER TABLE dayuse_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dayuse_bookings_select"
  ON dayuse_bookings FOR SELECT
  USING (
    student_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "dayuse_bookings_insert_own"
  ON dayuse_bookings FOR INSERT
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "dayuse_bookings_update_own"
  ON dayuse_bookings FOR UPDATE
  USING (student_id = auth.uid());

CREATE POLICY "dayuse_bookings_admin_all"
  ON dayuse_bookings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));
```

- [ ] **Step 2: Aplicar a migration**

```bash
npx supabase db push
```

Saída esperada: `Applying migration 004_multi_court_and_dayuse.sql... done`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/004_multi_court_and_dayuse.sql
git commit -m "feat: migration para court em classes e tabelas de day use"
```

---

## Task 2: Tipos TypeScript

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Escrever teste que valida as novas interfaces compilam**

```typescript
// types/index.test.ts
import type { Class, DayUseSlot, DayUseBooking } from './index'

describe('types', () => {
  it('Class has court field', () => {
    const c: Class = {
      id: '1', name: 'Turma A', description: null,
      level: 'A', type: 'adult', day_of_week: 1,
      start_time: '07:00', end_time: '08:00',
      max_students: 6, is_active: true, court: 1
    }
    expect(c.court).toBe(1)
  })

  it('DayUseSlot has required fields', () => {
    const s: DayUseSlot = {
      id: '1', court: 2, date: '2026-06-10',
      start_time: '09:00', end_time: '10:00',
      capacity: 8, notes: null, is_active: true,
      created_by: 'uuid', created_at: new Date().toISOString()
    }
    expect(s.court).toBe(2)
  })

  it('DayUseBooking has status union', () => {
    const b: DayUseBooking = {
      id: '1', slot_id: '2', student_id: '3',
      status: 'confirmed',
      booked_at: new Date().toISOString(),
      cancelled_at: null
    }
    expect(b.status).toBe('confirmed')
  })
})
```

- [ ] **Step 2: Rodar teste — espera falhar (tipos não existem ainda)**

```bash
npm run test:run -- types/index.test.ts
```

Saída esperada: erro de compilação TypeScript

- [ ] **Step 3: Atualizar `types/index.ts`**

Adicionar `court: number` na interface `Class` existente:

```typescript
export interface Class {
  id: string
  name: string
  description: string | null
  level: StudentLevel
  type: ClassType
  day_of_week: number
  start_time: string
  end_time: string
  max_students: number
  is_active: boolean
  court: number // 1 ou 2
}
```

Adicionar ao final do arquivo (antes dos joined types):

```typescript
export interface DayUseSlot {
  id: string
  court: number        // 1 ou 2
  date: string         // YYYY-MM-DD
  start_time: string   // HH:MM
  end_time: string     // HH:MM
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

- [ ] **Step 5: Build completo para verificar sem erros de tipo**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

Se aparecerem erros `Property 'court' does not exist`, procurar todos os usos de `Class` no código (principalmente `features/aulas/ClassCard.tsx` e `app/(admin)/grade/page.tsx`) e garantir que `court` é tratado como opcional onde não era selecionado do banco.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts types/index.test.ts
git commit -m "feat: adicionar court a Class e interfaces DayUseSlot/DayUseBooking"
```

---

## Task 3: Badge de quadra no ClassCard e grade admin

**Files:**
- Modify: `features/aulas/ClassCard.tsx`
- Modify: `app/(admin)/grade/page.tsx`

- [ ] **Step 1: Adicionar badge de quadra no `ClassCard.tsx`**

Localizar a área de badges (nível e kids) em `features/aulas/ClassCard.tsx` e adicionar logo após o badge de nível:

```tsx
{/* Badge de quadra — só mostrar se > 1 quadra (quando court existe) */}
{c.court === 2 && (
  <Badge variant="default" className="bg-blue-900/40 text-blue-300 border-blue-700">
    Quadra 2
  </Badge>
)}
```

- [ ] **Step 2: Atualizar `app/(admin)/grade/page.tsx` — tabs por quadra e links de ação**

Substituir o `<div className="flex items-center justify-between">` do header por:

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

Adicionar separação por quadra na grade semanal — substituir `{[1,2,3,4,5,6,0].map(...)` por query agrupada por court. Buscar classes agrupando por court e renderizar "Quadra 1" e "Quadra 2" como seções:

```tsx
{/* Seção por quadra */}
{[1, 2].map((courtNum) => {
  const courtClasses = allClasses.filter((c) => (c.court ?? 1) === courtNum)
  if (courtClasses.length === 0) return null
  return (
    <div key={courtNum} className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        Grade Semanal
        <span className="text-sm font-normal bg-blue-900/40 text-blue-300 border border-blue-700 px-2 py-0.5 rounded">
          Quadra {courtNum}
        </span>
      </h2>
      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const dayClasses = courtClasses.filter((c) => c.day_of_week === day)
        if (dayClasses.length === 0) return null
        return (
          <div key={day} className="mb-4">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
              {DAY_ABBR[day]}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {dayClasses.map((c) => {
                const enrolled = enrollCountMap.get(c.id) ?? 0
                const spotsLeft = c.max_students - enrolled
                return (
                  <Card key={c.id}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-white text-sm font-medium truncate">{c.name}</span>
                      <div className="flex gap-1 shrink-0">
                        {c.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                        <Badge variant="level">{c.level.toUpperCase()}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{formatTime(c.start_time)} – {formatTime(c.end_time)}</span>
                      <span className={spotsLeft <= 0 ? 'text-red-400' : spotsLeft <= 3 ? 'text-yellow-400' : 'text-green-400'}>
                        {enrolled}/{c.max_students}
                      </span>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})}
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add features/aulas/ClassCard.tsx app/\(admin\)/grade/page.tsx
git commit -m "feat: badge de quadra em ClassCard e separação por quadra na grade admin"
```

---

## Task 4: Admin — formulário de criação de turma

**Files:**
- Create: `features/aulas/class-form-actions.ts`
- Create: `features/aulas/ClassForm.tsx`
- Create: `app/(admin)/grade/nova-turma/page.tsx`

- [ ] **Step 1: Criar Server Actions para gerenciar turmas**

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
  const adminClient = createAdminClient()
  const { error } = await adminClient.from('classes').insert({
    ...data,
    is_active: true,
  })
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

- [ ] **Step 2: Criar componente de formulário**

```tsx
// features/aulas/ClassForm.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClass } from './class-form-actions'
import { useRouter } from 'next/navigation'
import type { StudentLevel, ClassType } from '@/types'

const LEVELS: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

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
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div>
        <label className="text-sm text-slate-400 block mb-1">Nome da turma</label>
        <Input name="name" required placeholder="Ex: Beach Intermediário Segunda" />
      </div>

      <div>
        <label className="text-sm text-slate-400 block mb-1">Descrição (opcional)</label>
        <Input name="description" placeholder="Detalhes da turma" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Nível</label>
          <select name="level" required className="w-full bg-surface-card border border-surface-border rounded-md px-3 py-2 text-white text-sm">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Tipo</label>
          <select name="type" required className="w-full bg-surface-card border border-surface-border rounded-md px-3 py-2 text-white text-sm">
            <option value="adult">Adulto</option>
            <option value="kids">Kids</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Dia da semana</label>
          <select name="day_of_week" required className="w-full bg-surface-card border border-surface-border rounded-md px-3 py-2 text-white text-sm">
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Quadra</label>
          <select name="court" required className="w-full bg-surface-card border border-surface-border rounded-md px-3 py-2 text-white text-sm">
            <option value="1">Quadra 1</option>
            <option value="2">Quadra 2</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Início</label>
          <Input name="start_time" type="time" required />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Fim</label>
          <Input name="end_time" type="time" required />
        </div>
      </div>

      <div>
        <label className="text-sm text-slate-400 block mb-1">Vagas máximas</label>
        <Input name="max_students" type="number" required min="1" max="20" defaultValue="6" />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando...' : 'Criar Turma'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/admin/grade')}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Criar a página**

```tsx
// app/(admin)/grade/nova-turma/page.tsx
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
      <h1 className="text-2xl font-bold text-white">Nova Turma</h1>
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
git add features/aulas/class-form-actions.ts features/aulas/ClassForm.tsx app/\(admin\)/grade/nova-turma/page.tsx
git commit -m "feat: formulário de criação de turma com seleção de quadra"
```

---

## Task 5: Admin — gestão de day use

**Files:**
- Create: `features/dayuse/actions.ts`
- Create: `features/dayuse/CreateDayUseForm.tsx`
- Create: `features/dayuse/DayUseSlotCard.tsx`
- Create: `app/(admin)/grade/dayuse/page.tsx`

- [ ] **Step 1: Escrever testes para as Server Actions de day use**

```typescript
// features/dayuse/actions.test.ts
import { describe, it, expect, vi } from 'vitest'
import { validateDayUseSlot } from './actions'

describe('validateDayUseSlot', () => {
  it('rejeita quando start_time >= end_time', () => {
    const result = validateDayUseSlot('10:00', '09:00')
    expect(result.error).toBeDefined()
    expect(result.error).toContain('fim deve ser depois do início')
  })

  it('rejeita capacidade menor que 1', () => {
    const result = validateDayUseSlot('09:00', '10:00', 0)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('capacidade')
  })

  it('aceita slot válido', () => {
    const result = validateDayUseSlot('09:00', '10:00', 4)
    expect(result.error).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar teste — espera falhar**

```bash
npm run test:run -- features/dayuse/actions.test.ts
```

Saída esperada: `Cannot find module './actions'`

- [ ] **Step 3: Criar Server Actions de day use**

```typescript
// features/dayuse/actions.ts
'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Validação pura — exportada para testes
export function validateDayUseSlot(
  startTime: string,
  endTime: string,
  capacity = 1,
): { error?: string } {
  if (startTime >= endTime) return { error: 'Horário de fim deve ser depois do início' }
  if (capacity < 1) return { error: 'Capacidade deve ser pelo menos 1' }
  return {}
}

export interface CreateDayUseSlotData {
  court: number
  date: string     // YYYY-MM-DD
  start_time: string
  end_time: string
  capacity: number
  notes?: string
}

export async function createDayUseSlot(data: CreateDayUseSlotData): Promise<{ error?: string }> {
  const validation = validateDayUseSlot(data.start_time, data.end_time, data.capacity)
  if (validation.error) return validation

  const adminClient = createAdminClient()
  const { data: { user } } = await adminClient.auth.getUser()

  const { error } = await adminClient.from('dayuse_slots').insert({
    ...data,
    created_by: user?.id,
    is_active: true,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  return {}
}

export async function deactivateDayUseSlot(slotId: string): Promise<{ error?: string }> {
  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('dayuse_slots')
    .update({ is_active: false })
    .eq('id', slotId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  return {}
}

// Ação do aluno: reservar um slot de day use (sem crédito)
export async function bookDayUse(slotId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // Verificar capacidade
  const { count } = await supabase
    .from('dayuse_bookings')
    .select('*', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .eq('status', 'confirmed')

  const { data: slot } = await supabase
    .from('dayuse_slots')
    .select('capacity')
    .eq('id', slotId)
    .single()

  if (!slot) return { error: 'Slot não encontrado' }
  if ((count ?? 0) >= slot.capacity) return { error: 'Slot lotado' }

  const { error } = await supabase.from('dayuse_bookings').insert({
    slot_id: slotId,
    student_id: user.id,
    status: 'confirmed',
  })

  // Unique constraint violation = já reservado
  if (error?.code === '23505') return { error: 'Você já tem uma reserva neste horário' }
  if (error) return { error: error.message }

  revalidatePath('/agendar/dayuse')
  return {}
}

export async function cancelDayUseBooking(bookingId: string): Promise<{ error?: string }> {
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

- [ ] **Step 5: Criar `DayUseSlotCard.tsx` (card admin)**

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
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="default" className="bg-blue-900/40 text-blue-300 border-blue-700 text-xs">
            Quadra {slot.court}
          </Badge>
          {isFull && <Badge variant="danger">Lotado</Badge>}
        </div>
        <p className="text-white text-sm font-medium">
          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
        </p>
        {slot.notes && (
          <p className="text-slate-400 text-xs truncate mt-0.5">{slot.notes}</p>
        )}
        <p className="text-slate-500 text-xs mt-1">{bookingsCount}/{slot.capacity} reservas</p>
      </div>
      <Button
        variant="danger"
        size="sm"
        disabled={loading}
        onClick={handleRemove}
      >
        Remover
      </Button>
    </Card>
  )
}
```

- [ ] **Step 6: Criar `CreateDayUseForm.tsx`**

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
      notes: fd.get('notes') as string || undefined,
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    setSuccess(true)
    ;(e.target as HTMLFormElement).reset()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-card border border-surface-border rounded-lg p-4 space-y-3">
      <h3 className="text-white font-semibold text-sm">Novo Slot de Day Use</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Data</label>
          <Input name="date" type="date" required />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Quadra</label>
          <select name="court" className="w-full bg-surface border border-surface-border rounded-md px-3 py-2 text-white text-sm">
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
        <Input name="notes" placeholder="Ex: Apenas adultos" />
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

- [ ] **Step 7: Criar página admin de day use**

```tsx
// app/(admin)/grade/dayuse/page.tsx
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { DayUseSlotCard } from '@/features/dayuse/DayUseSlotCard'
import { CreateDayUseForm } from '@/features/dayuse/CreateDayUseForm'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'

export default async function DayUsePage() {
  const adminClient = createAdminClient()

  const today = new Date().toISOString().slice(0, 10)

  // Buscar slots futuros e de hoje
  const { data: slots } = await adminClient
    .from('dayuse_slots')
    .select('*')
    .eq('is_active', true)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const slotList = (slots ?? []) as DayUseSlot[]
  const slotIds = slotList.map((s) => s.id)

  // Contagem de reservas por slot
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

  // Agrupar por data
  const byDate = new Map<string, DayUseSlot[]>()
  for (const slot of slotList) {
    const arr = byDate.get(slot.date) ?? []
    arr.push(slot)
    byDate.set(slot.date, arr)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">← Grade</Link>
      </div>
      <h1 className="text-2xl font-bold text-white">Day Use</h1>

      <CreateDayUseForm />

      <div className="space-y-6">
        {byDate.size === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum slot de day use agendado.</p>
        ) : (
          Array.from(byDate.entries()).map(([date, dateSlots]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
                {formatDate(date, 'EEEE, dd/MM')}
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

- [ ] **Step 8: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 9: Commit**

```bash
git add features/dayuse/ app/\(admin\)/grade/dayuse/
git commit -m "feat: gestão admin de slots de day use (criar, listar, remover)"
```

---

## Task 6: Aluno — reservar day use

**Files:**
- Create: `features/dayuse/DayUseBookingCard.tsx`
- Create: `app/(dashboard)/agendar/dayuse/page.tsx`
- Modify: `app/(dashboard)/agendar/page.tsx`

- [ ] **Step 1: Criar `DayUseBookingCard.tsx` (card do aluno)**

```tsx
// features/dayuse/DayUseBookingCard.tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime } from '@/lib/utils/dateHelpers'
import { bookDayUse } from './actions'
import type { DayUseSlot } from '@/types'

interface Props {
  slot: DayUseSlot
  bookingsCount: number
  alreadyBooked: boolean
}

export function DayUseBookingCard({ slot, bookingsCount, alreadyBooked }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState(alreadyBooked)
  const isFull = bookingsCount >= slot.capacity

  async function handleBook() {
    setLoading(true)
    setError(null)
    const result = await bookDayUse(slot.id)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    setBooked(true)
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="default" className="bg-blue-900/40 text-blue-300 border-blue-700 text-xs">
              Quadra {slot.court}
            </Badge>
            <Badge variant="default" className="bg-green-900/40 text-green-300 border-green-700 text-xs">
              Day Use
            </Badge>
            {isFull && !booked && <Badge variant="danger">Lotado</Badge>}
          </div>
          <p className="text-white text-sm font-medium">
            {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
          </p>
          {slot.notes && (
            <p className="text-slate-400 text-xs mt-0.5">{slot.notes}</p>
          )}
          <p className="text-slate-500 text-xs mt-1">
            {bookingsCount}/{slot.capacity} reservas · <span className="text-green-400">Gratuito</span>
          </p>
        </div>
        {booked ? (
          <Badge variant="success">Reservado</Badge>
        ) : (
          <Button
            size="sm"
            disabled={loading || isFull}
            onClick={handleBook}
          >
            {loading ? '...' : 'Reservar'}
          </Button>
        )}
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </Card>
  )
}
```

- [ ] **Step 2: Criar página de day use do aluno**

```tsx
// app/(dashboard)/agendar/dayuse/page.tsx
import { createClient } from '@/lib/supabase/server'
import { DayUseBookingCard } from '@/features/dayuse/DayUseBookingCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'

export default async function AgendarDayUsePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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
          .select('slot_id, student_id')
          .in('slot_id', slotIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const countMap = new Map<string, number>()
  const mySlots = new Set<string>()
  for (const b of (allBookings ?? []) as { slot_id: string; student_id: string }[]) {
    countMap.set(b.slot_id, (countMap.get(b.slot_id) ?? 0) + 1)
    if (b.student_id === user?.id) mySlots.add(b.slot_id)
  }

  const byDate = new Map<string, DayUseSlot[]>()
  for (const slot of slotList) {
    const arr = byDate.get(slot.date) ?? []
    arr.push(slot)
    byDate.set(slot.date, arr)
  }

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xl font-bold text-white">Day Use</h1>
        <p className="text-slate-400 text-sm mt-1">Quadra disponível sem usar créditos</p>
      </div>

      {byDate.size === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum horário de day use disponível no momento.</p>
      ) : (
        Array.from(byDate.entries()).map(([date, dateSlots]) => (
          <div key={date}>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
              {formatDate(date, 'EEEE, dd/MM')}
            </h2>
            <div className="space-y-2">
              {dateSlots.map((slot) => (
                <DayUseBookingCard
                  key={slot.id}
                  slot={slot}
                  bookingsCount={countMap.get(slot.id) ?? 0}
                  alreadyBooked={mySlots.has(slot.id)}
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

- [ ] **Step 3: Adicionar link de day use na página de agendar**

Em `app/(dashboard)/agendar/page.tsx`, adicionar um banner/link no topo:

```tsx
import Link from 'next/link'

// Adicionar no JSX, no início do conteúdo:
<Link
  href="/agendar/dayuse"
  className="flex items-center justify-between bg-green-900/20 border border-green-700/40 rounded-lg px-4 py-3 mb-4 hover:bg-green-900/30 transition-colors"
>
  <div>
    <p className="text-green-300 text-sm font-medium">Day Use disponível</p>
    <p className="text-green-500 text-xs">Reservar quadra sem usar créditos →</p>
  </div>
  <span className="text-green-400 text-lg">🏖</span>
</Link>
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Saída esperada: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add features/dayuse/DayUseBookingCard.tsx app/\(dashboard\)/agendar/dayuse/ app/\(dashboard\)/agendar/page.tsx
git commit -m "feat: aluno pode reservar day use sem créditos"
```

---

## Task 7: Admin chamada — botão "Marcar Todos Presentes"

**Files:**
- Modify: `app/(admin)/grade/[sessionId]/page.tsx`
- Modify: `features/aulas/actions.ts`

- [ ] **Step 1: Adicionar Server Action de presença em massa**

Em `features/aulas/actions.ts`, adicionar ao final:

```typescript
export async function markAllPresent(sessionId: string, studentIds: string[]): Promise<{ error?: string }> {
  if (studentIds.length === 0) return {}
  const adminClient = createAdminClient()
  const now = new Date().toISOString()

  // Upsert de presença para todos os alunos (mantém registros já existentes)
  const records = studentIds.map((sid) => ({
    student_id: sid,
    session_id: sessionId,
    status: 'present' as const,
    source: 'manual' as const,
    checked_in_at: now,
  }))

  const { error } = await adminClient
    .from('attendance')
    .upsert(records, { onConflict: 'student_id,session_id', ignoreDuplicates: false })

  if (error) return { error: error.message }
  revalidatePath(`/admin/grade/${sessionId}`)
  return {}
}
```

- [ ] **Step 2: Adicionar botão na página da sessão**

Em `app/(admin)/grade/[sessionId]/page.tsx`, adicionar após o header da sessão e antes do `<AttendanceSheet>`:

```tsx
import { markAllPresent } from '@/features/aulas/actions'

// Adicionar dentro do JSX, após o bloco de data/horário:
{students.length > 0 && (
  <form
    action={async () => {
      'use server'
      await markAllPresent(params.sessionId, students.map((s) => s.student.id))
    }}
  >
    <button
      type="submit"
      className="w-full bg-green-700 hover:bg-green-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
    >
      ✓ Marcar Todos Presentes
    </button>
  </form>
)}
```

- [ ] **Step 3: Build + testes**

```bash
npm run build && npm run test:run
```

Saída esperada: `✓ Compiled successfully` · todos os testes passando

- [ ] **Step 4: Commit**

```bash
git add features/aulas/actions.ts app/\(admin\)/grade/\[sessionId\]/page.tsx
git commit -m "feat: botão marcar todos presentes na chamada admin"
```

---

## Task 8: Seed da grade de horários

**Files:**
- Create: `supabase/seeds/classes.sql`

> **BLOQUEADO:** Este task aguarda o usuário fornecer os dados da planilha de horários. Quando disponível, colar os horários no chat e este task será concluído com os INSERTs corretos.

- [ ] **Step 1: Criar arquivo de seed com placeholder**

```sql
-- supabase/seeds/classes.sql
-- AGUARDANDO DADOS DO USUÁRIO
-- Cole os horários aqui no formato:
-- INSERT INTO classes (name, level, type, day_of_week, start_time, end_time, max_students, court, is_active)
-- VALUES ('Nome da Turma', 'C', 'adult', 2, '07:00', '08:00', 6, 1, true);

-- Exemplo (remover quando os dados reais chegarem):
INSERT INTO classes (name, level, type, day_of_week, start_time, end_time, max_students, court, is_active)
VALUES
  ('Iniciante Segunda Manhã', 'iniciante', 'adult', 1, '07:00', '08:00', 6, 1, true),
  ('Nível D Terça Manhã',     'D',         'adult', 2, '07:00', '08:00', 6, 1, true);
```

- [ ] **Step 2: Quando os dados chegarem, rodar o seed**

```bash
npx supabase db reset --no-data   # só se quiser resetar
# ou
psql $DATABASE_URL < supabase/seeds/classes.sql
```

- [ ] **Step 3: Commit**

```bash
git add supabase/seeds/classes.sql
git commit -m "chore: seed placeholder de turmas — aguarda dados reais"
```

---

## Self-Review

### Cobertura da spec

| Requisito | Task |
|---|---|
| Múltiplas quadras (Quadra 1 / Quadra 2) | Task 1, 2, 3 |
| Criar turma com seleção de quadra | Task 4 |
| Admin lança day use por data/horário/quadra | Task 5 |
| Aluno reserva day use sem créditos | Task 6 |
| Chamada rápida — marcar todos presentes | Task 7 |
| Seed de horários reais | Task 8 (bloqueado) |

### Invariantes preservadas

- Day use usa tabelas separadas (`dayuse_slots`, `dayuse_bookings`) — zero impacto no fluxo de créditos existente
- `bookDayUse` nunca toca `credit_transactions` ou `profiles.credits_balance`
- Unique constraint no banco previne double booking mesmo em requisições concorrentes
- `markAllPresent` usa upsert com `onConflict` para não duplicar registros de presença
