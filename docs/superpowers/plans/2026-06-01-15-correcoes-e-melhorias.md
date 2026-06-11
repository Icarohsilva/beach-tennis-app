# 15 Correções e Melhorias — Beach Tennis App

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir 15 bugs e melhorias reportadas pelo usuário, agrupadas em 10 tasks que produzem código funcional testável individualmente.

**Architecture:** Next.js 14 App Router com Server Actions, Supabase (Postgres + RLS), TypeScript. Server actions ficam em `features/*/actions.ts` ou `features/*/adminActions.ts`. Páginas são Server Components com Client Components pontuais para interatividade.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Supabase, date-fns, Vitest

---

## Mapeamento de Issues → Tasks

| Issue | Descrição | Task |
|-------|-----------|------|
| #11 | Aula de hoje não aparece | Task 1 |
| #12 | Experimental: nenhuma turma encontrada | Task 1 |
| #13 | Aluno não consegue se vincular a aula com vaga | Task 1 |
| #1  | Não é possível editar turma já lançada | Task 2 |
| #8  | Datas da nova turma sobrepostas (layout) | Task 2 |
| #6  | Mobile sem opção de voltar ao menu inicial | Task 3 |
| #5  | Sem opção de remover nome de uma aula | Task 4 |
| #4  | Iniciar aula com chamada/confirmação de presença | Task 5 |
| #7  | Assinatura não calcula créditos iniciais | Task 6 |
| #2  | Day Use não é grátis — remover texto "sem créditos" | Task 7 |
| #9  | Day Use deve aceitar ilimitados participantes | Task 7 |
| #10 | Aulas do aluno só aparecem após recarregar a página | Task 8 |
| #3  | Dependentes devem ser vinculados pelo responsável | Task 9 |
| #14 | Possível definir planos para dependentes | Task 9 |
| #15 | CRUD de planos via app | Task 10 |

---

## File Map

```
features/aulas/class-form-actions.ts          ← Task 1 + Task 2 (generateSessions, updateClass)
features/aulas/adminActions.ts                ← Task 1 (gerar sessões para turmas existentes) + Task 8 (revalidatePath)
app/(admin)/admin/grade/page.tsx              ← Task 1 (botão gerar sessões) + Task 2 (link editar)
app/(admin)/admin/grade/[sessionId]/page.tsx  ← Task 5 (Iniciar Aula)
app/(admin)/admin/grade/[classId]/editar/page.tsx  ← Task 2 (nova página)
features/aulas/EditClassForm.tsx              ← Task 2 (novo componente)
features/aulas/StartClassClient.tsx           ← Task 5 (novo componente)
app/(admin)/layout.tsx                        ← Task 3 (mobile nav)
features/aulas/SessionList.tsx                ← Task 4 (botão cancelar)
features/financeiro/actions.ts                ← Task 6 (créditos na assinatura)
app/(dashboard)/agendar/page.tsx              ← Task 7 (remover texto day use)
features/dayuse/actions.ts                    ← Task 7 (remover limite capacidade)
app/(admin)/admin/alunos/[id]/page.tsx        ← Task 8 (revalidatePath)
features/aulas/adminActions.ts                ← Task 8 (revalidatePath) + Task 9 (addDependentSelf)
app/(dashboard)/perfil/page.tsx               ← Task 9 (seção dependentes)
app/(admin)/admin/financeiro/PlansManager.tsx ← Task 10 (criar plano)
app/(admin)/admin/financeiro/adminActions.ts  ← Task 10 (createPlan action)
```

---

## Task 1: Geração Automática de Sessões (Crítico — corrige #11, #12, #13)

**Root cause:** `createClass` insere apenas em `classes`. Nenhuma linha em `class_sessions` é criada, então a agenda do dia, o agendamento experimental e o vínculo de alunos sempre encontram zero sessões.

**Files:**
- Modify: `features/aulas/class-form-actions.ts`
- Modify: `features/aulas/adminActions.ts`
- Modify: `app/(admin)/admin/grade/page.tsx`

- [ ] **Step 1: Escrever o teste de geração de sessões**

Crie `features/aulas/class-form-actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase admin client
const insertMock = vi.fn().mockResolvedValue({ error: null })
const fromMock = vi.fn().mockReturnValue({ insert: insertMock })
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: fromMock }),
}))

import { buildSessionRows } from './class-form-actions'

describe('buildSessionRows', () => {
  it('returns weekly rows for the given day_of_week', () => {
    // day_of_week=1 (Monday), from 2026-06-01 to 2026-06-30
    const rows = buildSessionRows('class-uuid', 1, '2026-06-01', '2026-06-30')
    // Mondays in June 2026: 1,8,15,22,29
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({
      class_id: 'class-uuid',
      session_date: '2026-06-01',
      status: 'scheduled',
      notes: null,
    })
    expect(rows[4].session_date).toBe('2026-06-29')
  })

  it('returns empty array when no matching days in range', () => {
    // day_of_week=0 (Sunday), from Mon to Sat
    const rows = buildSessionRows('class-uuid', 0, '2026-06-01', '2026-06-06')
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
npm run test:run -- features/aulas/class-form-actions.test.ts
```
Esperado: FAIL — `buildSessionRows is not exported`

- [ ] **Step 3: Implementar `buildSessionRows` e `generateSessionsForClass` em `class-form-actions.ts`**

Adicione no topo do arquivo o import de date-fns (já usado em `dateHelpers.ts`, disponível no projeto):

```typescript
import { eachDayOfInterval, getDay, addMonths, format } from 'date-fns'
```

Adicione antes da função `createClass`:

```typescript
/** Pure helper — returns session rows to insert for a class */
export function buildSessionRows(
  classId: string,
  dayOfWeek: number,
  fromDateStr: string,
  toDateStr: string,
): Array<{ class_id: string; session_date: string; status: string; notes: null }> {
  const from = new Date(fromDateStr)
  const to = new Date(toDateStr)
  return eachDayOfInterval({ start: from, end: to })
    .filter((d) => getDay(d) === dayOfWeek)
    .map((d) => ({
      class_id: classId,
      session_date: format(d, 'yyyy-MM-dd'),
      status: 'scheduled',
      notes: null,
    }))
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

```bash
npm run test:run -- features/aulas/class-form-actions.test.ts
```
Esperado: PASS (2 testes)

- [ ] **Step 5: Chamar `buildSessionRows` no final de `createClass`**

Em `createClass`, após o `insert` na tabela `classes` retornar sem erro, adicione a geração de sessões para os próximos 90 dias:

```typescript
export async function createClass(data: ClassFormData): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Nome é obrigatório' }
  if (data.start_time >= data.end_time) return { error: 'Horário de fim deve ser depois do início' }

  const adminClient = createAdminClient()
  const { data: newClass, error } = await adminClient
    .from('classes')
    .insert({ ...data, is_active: true })
    .select('id')
    .single()
  if (error) return { error: error.message }

  // Auto-generate sessions for the next 90 days
  const today = new Date()
  const end = new Date()
  end.setDate(today.getDate() + 90)
  const rows = buildSessionRows(
    newClass.id,
    data.day_of_week,
    format(today, 'yyyy-MM-dd'),
    format(end, 'yyyy-MM-dd'),
  )
  if (rows.length > 0) {
    await adminClient.from('class_sessions').insert(rows)
  }

  revalidatePath('/admin/grade')
  return {}
}
```

- [ ] **Step 6: Adicionar `generateSessionsForExistingClass` em `adminActions.ts`**

Adicione ao final de `features/aulas/adminActions.ts`:

```typescript
import { buildSessionRows } from './class-form-actions'
import { format } from 'date-fns'

/**
 * Gera sessões para uma turma existente nos próximos 90 dias.
 * Ignora datas que já têm sessão (upsert por class_id+session_date).
 */
export async function generateSessionsForExistingClass(
  classId: string,
): Promise<{ error?: string; count?: number }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: cls } = await adminClient
    .from('classes')
    .select('day_of_week, is_active')
    .eq('id', classId)
    .single()

  if (!cls) return { error: 'Turma não encontrada.' }
  if (!cls.is_active) return { error: 'Turma inativa.' }

  const today = new Date()
  const end = new Date()
  end.setDate(today.getDate() + 90)

  const rows = buildSessionRows(
    classId,
    cls.day_of_week,
    format(today, 'yyyy-MM-dd'),
    format(end, 'yyyy-MM-dd'),
  )

  if (rows.length === 0) return { count: 0 }

  // upsert — ignores conflicts on (class_id, session_date)
  const { error } = await adminClient
    .from('class_sessions')
    .upsert(rows, { onConflict: 'class_id,session_date', ignoreDuplicates: true })

  if (error) return { error: error.message }

  revalidatePath('/admin/grade')
  return { count: rows.length }
}
```

> **Nota sobre upsert:** Para que `ignoreDuplicates` funcione, a tabela `class_sessions` precisa ter constraint `UNIQUE(class_id, session_date)`. Se não existir, adicione a migration:
> ```sql
> ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_class_id_session_date_key UNIQUE (class_id, session_date);
> ```

- [ ] **Step 7: Adicionar botão "Gerar Sessões" em cada card da grade semanal**

Em `app/(admin)/admin/grade/page.tsx`, transforme o card semanal em um componente que exibe um botão de ação. Primeiro, crie um pequeno Client Component inline no arquivo. Adicione no topo:

```typescript
import { GenerateSessionsButton } from './GenerateSessionsButton'
```

Crie `app/(admin)/admin/grade/GenerateSessionsButton.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { generateSessionsForExistingClass } from '@/features/aulas/adminActions'

export function GenerateSessionsButton({ classId }: { classId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, start] = useTransition()

  function handleClick() {
    start(async () => {
      const result = await generateSessionsForExistingClass(classId)
      if (result.error) setMsg(`Erro: ${result.error}`)
      else setMsg(`${result.count} sessões geradas`)
      setTimeout(() => setMsg(null), 3000)
    })
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
      >
        {isPending ? 'Gerando...' : 'Gerar sessões (90 dias)'}
      </button>
      {msg && <p className="text-xs text-green-400 mt-1">{msg}</p>}
    </div>
  )
}
```

Em `grade/page.tsx`, no loop de cards semanais, adicione o botão dentro do `<Card>`:

```tsx
<Card key={c.id}>
  <div className="flex items-center justify-between gap-2 mb-1">
    <span className="text-white text-sm font-medium truncate">{c.name}</span>
    <div className="flex gap-1 shrink-0">
      {c.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
      <Badge variant="level">{c.level.toUpperCase()}</Badge>
    </div>
  </div>
  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
    <span>{formatTime(c.start_time)} – {formatTime(c.end_time)}</span>
    <span className={spotsLeft <= 0 ? 'text-red-400' : spotsLeft <= 3 ? 'text-yellow-400' : 'text-green-400'}>
      {enrolled}/{c.max_students} vagas
    </span>
  </div>
  <GenerateSessionsButton classId={c.id} />
</Card>
```

- [ ] **Step 8: Testar manualmente**

1. `npm run dev`
2. Vá em `/admin/grade`
3. Clique "Gerar sessões (90 dias)" em uma turma existente
4. Observe a mensagem de sucesso
5. Vá em `/admin/grade` — a seção "Hoje" deve mostrar a turma se hoje for o dia correto
6. Acesse `/agendar` como aluno — sessões devem aparecer
7. Acesse `/experimental` — sessões devem aparecer

- [ ] **Step 9: Commit**

```bash
git add features/aulas/class-form-actions.ts features/aulas/class-form-actions.test.ts features/aulas/adminActions.ts app/(admin)/admin/grade/page.tsx app/(admin)/admin/grade/GenerateSessionsButton.tsx
git commit -m "feat: gerar class_sessions automaticamente ao criar turma e para turmas existentes"
```

---

## Task 2: Edição de Turma + Layout da Grade (#1, #8)

**Files:**
- Modify: `features/aulas/class-form-actions.ts` — adicionar `updateClass`
- Create: `features/aulas/EditClassForm.tsx`
- Create: `app/(admin)/admin/grade/[classId]/editar/page.tsx`
- Modify: `app/(admin)/admin/grade/page.tsx` — link editar nos cards semanais

> **Nota:** A rota usa `[classId]` (UUID da turma), diferente de `[sessionId]` (UUID da sessão) que já existe.

- [ ] **Step 1: Adicionar `updateClass` em `class-form-actions.ts`**

```typescript
export async function updateClass(
  classId: string,
  data: Partial<ClassFormData>,
): Promise<{ error?: string }> {
  if (data.name !== undefined && !data.name.trim()) return { error: 'Nome é obrigatório' }
  if (data.start_time && data.end_time && data.start_time >= data.end_time) {
    return { error: 'Horário de fim deve ser depois do início' }
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('classes')
    .update(data)
    .eq('id', classId)

  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  revalidatePath(`/admin/grade/${classId}/editar`)
  return {}
}
```

- [ ] **Step 2: Criar `EditClassForm.tsx`**

Crie `features/aulas/EditClassForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateClass } from './class-form-actions'
import type { Class, StudentLevel } from '@/types'

const LEVELS: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'

export function EditClassForm({ class_ }: { class_: Class }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const result = await updateClass(class_.id, {
      name: fd.get('name') as string,
      description: fd.get('description') as string,
      level: fd.get('level') as StudentLevel,
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
        <Input name="name" required defaultValue={class_.name} />
      </div>
      <div>
        <label className="text-sm text-slate-400 block mb-1">Descrição (opcional)</label>
        <Input name="description" defaultValue={class_.description ?? ''} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Nível</label>
          <select name="level" required defaultValue={class_.level} className={SELECT_CLS}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l === 'iniciante' ? 'Iniciante' : `Nível ${l}`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Dia da semana</label>
          <select name="day_of_week" required defaultValue={class_.day_of_week} className={SELECT_CLS}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Quadra</label>
          <select name="court" required defaultValue={class_.court} className={SELECT_CLS}>
            <option value="1">Quadra 1</option>
            <option value="2">Quadra 2</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Vagas *</label>
          <Input name="max_students" type="number" required min="1" max="20" defaultValue={class_.max_students} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Início *</label>
          <Input name="start_time" type="time" required defaultValue={class_.start_time.slice(0, 5)} />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Fim *</label>
          <Input name="end_time" type="time" required defaultValue={class_.end_time.slice(0, 5)} />
        </div>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando...' : 'Salvar Alterações'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/admin/grade')}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Criar página de edição `/admin/grade/[classId]/editar/page.tsx`**

```
mkdir -p "app/(admin)/admin/grade/[classId]/editar"
```

Crie `app/(admin)/admin/grade/[classId]/editar/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { EditClassForm } from '@/features/aulas/EditClassForm'
import type { Class } from '@/types'

interface Props {
  params: { classId: string }
}

export default async function EditClassPage({ params }: Props) {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .from('classes')
    .select('*')
    .eq('id', params.classId)
    .single()

  if (!data) notFound()

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">
          ← Grade
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-white">Editar Turma</h1>
      <EditClassForm class_={data as Class} />
    </div>
  )
}
```

- [ ] **Step 4: Adicionar link "Editar" nos cards semanais da grade**

Em `app/(admin)/admin/grade/page.tsx`, dentro do loop semanal, envolva o Card com um link para edição. Substitua o `<Card key={c.id}>` atual por:

```tsx
<Card key={c.id}>
  <div className="flex items-start justify-between gap-2 mb-1">
    <span className="text-white text-sm font-medium">{c.name}</span>
    <div className="flex gap-1 shrink-0 items-center">
      {c.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
      <Badge variant="level">{c.level.toUpperCase()}</Badge>
      <Link
        href={`/admin/grade/${c.id}/editar`}
        className="text-xs text-slate-500 hover:text-brand-400 ml-1"
        onClick={(e) => e.stopPropagation()}
      >
        Editar
      </Link>
    </div>
  </div>
  <div className="flex items-center justify-between text-xs text-slate-400">
    <span>{formatTime(c.start_time)} – {formatTime(c.end_time)}</span>
  </div>
  <div className="text-xs text-right mt-0.5">
    <span className={spotsLeft <= 0 ? 'text-red-400' : spotsLeft <= 3 ? 'text-yellow-400' : 'text-green-400'}>
      {enrolled}/{c.max_students} vagas
    </span>
  </div>
  <GenerateSessionsButton classId={c.id} />
</Card>
```

> Isso resolve #8 (layout cramped): nome e badges na primeira linha, horário na segunda, vagas na terceira.

- [ ] **Step 5: Testar**

1. `npm run dev`
2. Vá em `/admin/grade` → clique "Editar" em qualquer turma
3. Altere o nome e salve — deve voltar para `/admin/grade` com nome atualizado
4. Verifique que os cards semanais não estão mais com layout comprimido

- [ ] **Step 6: Commit**

```bash
git add features/aulas/class-form-actions.ts features/aulas/EditClassForm.tsx "app/(admin)/admin/grade/[classId]/editar/page.tsx" "app/(admin)/admin/grade/page.tsx"
git commit -m "feat: editar turma existente e corrigir layout de cards na grade semanal"
```

---

## Task 3: Navegação Mobile no Admin (#6)

**Contexto:** O `aside` no admin layout tem `hidden md:flex`, portanto em telas mobile (< 768px) não há nenhuma navegação. O aluno/admin fica preso em sub-páginas sem como voltar ao menu.

**Files:**
- Modify: `app/(admin)/layout.tsx` — adicionar mobile topbar

- [ ] **Step 1: Adicionar barra de navegação mobile ao admin layout**

Substitua o conteúdo de `app/(admin)/layout.tsx`:

```tsx
// app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { Logo } from '@/components/ui/Logo'
import { AdminMobileNav } from '@/components/ui/AdminMobileNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/home')

  const navLinks = [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/alunos', label: 'Alunos' },
    { href: '/admin/grade', label: 'Grade de Aulas' },
    { href: '/admin/financeiro', label: 'Financeiro' },
    { href: '/admin/notificacoes', label: 'Notificações' },
    { href: '/admin/torneios', label: 'Torneios' },
  ]

  return (
    <div className="min-h-screen bg-surface text-white flex flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="w-64 bg-surface-card border-r border-surface-border min-h-screen p-4 hidden md:flex flex-col">
        <div className="mb-6">
          <Logo variant="full" size="sm" />
          <span className="text-xs text-slate-500 mt-1 block">Painel Admin</span>
        </div>
        <nav className="flex flex-col gap-1 text-sm text-slate-400 flex-1">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>
        <LogoutButton className="mt-4 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors text-left w-full">
          Sair
        </LogoutButton>
      </aside>

      {/* Mobile topbar */}
      <AdminMobileNav links={navLinks} />

      <main className="flex-1 p-4 md:p-6 mt-14 md:mt-0">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Criar `AdminMobileNav` component**

Crie `components/ui/AdminMobileNav.tsx`:

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { LogoutButton } from './LogoutButton'

interface NavLink { href: string; label: string }

export function AdminMobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile topbar */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-surface-card border-b border-surface-border md:hidden">
        <span className="text-white font-semibold text-sm">Painel Admin</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-slate-400 hover:text-white p-1"
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Dropdown menu */}
      {open && (
        <div className="fixed top-12 left-0 right-0 z-40 bg-surface-card border-b border-surface-border shadow-lg md:hidden">
          <nav className="flex flex-col py-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="px-4 py-3 text-sm text-slate-300 hover:bg-surface-border hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <div className="border-t border-surface-border mt-2 pt-2">
              <LogoutButton className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-900/20 transition-colors">
                Sair
              </LogoutButton>
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: Testar em viewport mobile**

1. `npm run dev`
2. Abra as DevTools → responsive mode → iPhone (390px)
3. Acesse `/admin/grade`
4. Deve aparecer topbar com "Painel Admin" e ícone ☰
5. Clicar no ícone abre o menu com todos os links
6. Clicar em um link fecha o menu e navega

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/layout.tsx" components/ui/AdminMobileNav.tsx
git commit -m "feat: adicionar navegação mobile ao painel admin"
```

---

## Task 4: Cancelamento de Reserva pelo Aluno (#5)

**Contexto:** `cancelBooking(bookingId)` existe em `features/aulas/actions.ts` mas `SessionList.tsx` é read-only. Nenhum botão de cancelamento existe para o aluno.

**Files:**
- Modify: `features/aulas/SessionList.tsx` — converter para client component com botão cancelar
- Modify: `app/(dashboard)/aulas/page.tsx` — passar `canCancel` flag

- [ ] **Step 1: Converter `SessionList` para client component com botão cancelar**

Substitua o conteúdo de `features/aulas/SessionList.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import { cancelBooking } from './actions'
import type { ClassSession, SessionBooking } from '@/types'

interface SessionListProps {
  sessions: ClassSession[]
  bookings: SessionBooking[]
  maxDisplay?: number
  showCancelButton?: boolean
}

export function SessionList({ sessions, bookings, maxDisplay = 4, showCancelButton = false }: SessionListProps) {
  const bookingBySession = new Map(bookings.map((b) => [b.session_id, b]))
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  const upcoming = sessions
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .slice(0, maxDisplay)

  function handleCancel(bookingId: string) {
    startTransition(async () => {
      const result = await cancelBooking(bookingId)
      if (result.error) {
        setErrors((prev) => ({ ...prev, [bookingId]: result.error! }))
        return
      }
      setCancelledIds((prev) => new Set([...prev, bookingId]))
    })
  }

  if (upcoming.length === 0) {
    return <p className="text-slate-500 text-xs py-2">Sem sessões próximas.</p>
  }

  return (
    <ul className="space-y-1 mt-2">
      {upcoming.map((session) => {
        const booking = bookingBySession.get(session.id)
        const isCancelledLocally = booking ? cancelledIds.has(booking.id) : false
        const isConfirmed = booking?.status === 'confirmed' && !isCancelledLocally
        const isCancelled = booking?.status === 'cancelled' || isCancelledLocally

        return (
          <li
            key={session.id}
            className="flex items-center justify-between text-xs text-slate-300 py-1.5 border-b border-surface-border last:border-0 gap-2"
          >
            <span>{formatDate(session.session_date, 'EEE, dd/MM')}</span>
            <div className="flex items-center gap-2">
              {isConfirmed && <Badge variant="success">Confirmado</Badge>}
              {isCancelled && <Badge variant="danger">Cancelado</Badge>}
              {!booking && <Badge variant="default">Sem booking</Badge>}
              {isConfirmed && showCancelButton && booking && (
                <button
                  onClick={() => handleCancel(booking.id)}
                  disabled={isPending}
                  className="text-red-400 hover:text-red-300 text-xs underline disabled:opacity-50"
                >
                  Cancelar
                </button>
              )}
            </div>
          </li>
        )
      })}
      {Object.entries(errors).map(([id, msg]) => (
        <li key={`err-${id}`} className="text-red-400 text-xs py-1">{msg}</li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Passar `showCancelButton` na página `/aulas`**

Em `app/(dashboard)/aulas/page.tsx`, na chamada de `<SessionList>`, adicione a prop:

```tsx
<SessionList
  sessions={classSessions}
  bookings={studentBookings.filter((b) =>
    classSessions.some((s) => s.id === b.session_id),
  )}
  showCancelButton={true}
/>
```

- [ ] **Step 3: Testar**

1. `npm run dev`
2. Login como aluno com reservas confirmadas
3. Vá em `/aulas`
4. Nas sessões confirmadas deve aparecer botão "Cancelar"
5. Clicar → booking muda para "Cancelado" (otimista)
6. Verificar no Supabase que `session_bookings.status` = 'cancelled'

- [ ] **Step 4: Commit**

```bash
git add features/aulas/SessionList.tsx "app/(dashboard)/aulas/page.tsx"
git commit -m "feat: permitir aluno cancelar reserva diretamente na lista de sessões"
```

---

## Task 5: Iniciar Aula com Chamada (#4)

**Contexto:** A página de detalhe da sessão `/admin/grade/[sessionId]` exibe `AttendanceSheet` com marcação individual. O usuário quer um fluxo de "Iniciar Aula" que mostre todos os alunos de uma vez, permita alternar presença/falta e confirme em lote.

**Files:**
- Create: `features/aulas/StartClassClient.tsx`
- Modify: `app/(admin)/admin/grade/[sessionId]/page.tsx` — incluir `StartClassClient`
- Modify: `features/aulas/actions.ts` — adicionar `markAttendanceBulk`

- [ ] **Step 1: Adicionar `markAttendanceBulk` em `actions.ts`**

Adicione ao final de `features/aulas/actions.ts`:

```typescript
/**
 * Marca presença em lote para uma sessão.
 * presentIds: IDs de alunos presentes; ausentes = todos os demais no array allStudentIds.
 */
export async function markAttendanceBulk(
  sessionId: string,
  allStudentIds: string[],
  presentIds: string[],
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Verify caller is admin
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return { error: 'Sem permissão.' }

  const now = new Date().toISOString()
  const presentSet = new Set(presentIds)

  const rows = allStudentIds.map((studentId) => ({
    session_id: sessionId,
    student_id: studentId,
    status: presentSet.has(studentId) ? 'present' : ('absent' as 'present' | 'absent'),
    source: 'manual' as const,
    checked_in_at: now,
  }))

  const { error } = await adminClient
    .from('attendance')
    .upsert(rows, { onConflict: 'session_id,student_id' })

  if (error) return { error: error.message }

  // Update session status to 'completed'
  await adminClient
    .from('class_sessions')
    .update({ status: 'completed' })
    .eq('id', sessionId)

  revalidatePath(`/admin/grade/${sessionId}`)
  return {}
}
```

> **Nota:** Adicione `import { revalidatePath } from 'next/cache'` se não existir em `actions.ts`.

- [ ] **Step 2: Criar `StartClassClient.tsx`**

Crie `features/aulas/StartClassClient.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { markAttendanceBulk } from './actions'
import type { Profile } from '@/types'

interface Student {
  student: Pick<Profile, 'id' | 'full_name' | 'level' | 'payment_type'>
}

interface Props {
  sessionId: string
  students: Student[]
  isCompleted: boolean
}

export function StartClassClient({ sessionId, students, isCompleted }: Props) {
  const [started, setStarted] = useState(isCompleted)
  const [presentIds, setPresentIds] = useState<Set<string>>(
    new Set(students.map((s) => s.student.id)),
  )
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(isCompleted)

  function toggle(id: string) {
    setPresentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleConfirm() {
    startTransition(async () => {
      const allIds = students.map((s) => s.student.id)
      const result = await markAttendanceBulk(sessionId, allIds, [...presentIds])
      if (result.error) { setError(result.error); return }
      setDone(true)
    })
  }

  if (done) {
    return (
      <div className="bg-green-900/20 border border-green-700/40 rounded-xl px-4 py-3">
        <p className="text-green-300 text-sm font-medium">Aula encerrada — chamada confirmada</p>
        <p className="text-green-500/80 text-xs mt-0.5">
          {presentIds.size} presentes · {students.length - presentIds.size} ausentes
        </p>
      </div>
    )
  }

  if (!started) {
    return (
      <Button onClick={() => setStarted(true)} variant="primary">
        Iniciar Aula
      </Button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Chamada</h2>
        <button
          onClick={() => setPresentIds(new Set(students.map((s) => s.student.id)))}
          className="text-xs text-brand-400 hover:text-brand-300"
        >
          Marcar todos presentes
        </button>
      </div>

      <ul className="space-y-2">
        {students.map(({ student }) => {
          const present = presentIds.has(student.id)
          return (
            <li
              key={student.id}
              onClick={() => toggle(student.id)}
              className={[
                'flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer transition-colors',
                present
                  ? 'bg-green-900/20 border-green-700/40'
                  : 'bg-red-900/10 border-red-700/30',
              ].join(' ')}
            >
              <span className="text-white text-sm">{student.full_name}</span>
              <span className={present ? 'text-green-400 text-xs font-medium' : 'text-red-400 text-xs font-medium'}>
                {present ? 'Presente' : 'Falta'}
              </span>
            </li>
          )
        })}
      </ul>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Button onClick={handleConfirm} disabled={isPending} variant="primary">
        {isPending ? 'Confirmando...' : 'Confirmar Chamada'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Integrar `StartClassClient` na página de sessão**

Em `app/(admin)/admin/grade/[sessionId]/page.tsx`, adicione import e renderize abaixo do `AttendanceSheet`:

```tsx
import { StartClassClient } from '@/features/aulas/StartClassClient'

// ... (no return, abaixo do <AttendanceSheet>)
<StartClassClient
  sessionId={params.sessionId}
  students={students}
  isCompleted={typedSession.status === 'completed'}
/>
```

- [ ] **Step 4: Testar**

1. Acesse `/admin/grade` → clique em uma sessão de hoje
2. Botão "Iniciar Aula" deve aparecer
3. Clicar abre a lista de alunos, todos marcados como presentes
4. Clicar em um aluno alterna para "Falta"
5. "Marcar todos presentes" restaura todos
6. "Confirmar Chamada" → mensagem de sucesso
7. Verificar na tabela `attendance` do Supabase

- [ ] **Step 5: Commit**

```bash
git add features/aulas/StartClassClient.tsx features/aulas/actions.ts "app/(admin)/admin/grade/[sessionId]/page.tsx"
git commit -m "feat: fluxo de iniciar aula com chamada em lote"
```

---

## Task 6: Créditos na Assinatura (#7)

**Contexto:** `subscribeToPlan` em `features/financeiro/actions.ts` cria a `student_subscription` mas **não** insere um `credit_transaction` nem atualiza `profiles.credits_balance`. O aluno fica com 0 créditos após se inscrever.

**Files:**
- Modify: `features/financeiro/actions.ts`

- [ ] **Step 1: Atualizar `subscribeToPlan` para gravar créditos iniciais**

Substitua a função `subscribeToPlan` (linhas 17–81 do arquivo atual):

```typescript
export async function subscribeToPlan(
  planId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id, payment_type, is_dependent, parent_id, contract_active')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) return { error: 'Perfil não encontrado.' }

  const paymentType = profile.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }

  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, credits_per_month, name')
    .eq('id', planId)
    .single()

  if (planErr || !plan) return { error: 'Plano não encontrado.' }
  if (!plan.is_active) return { error: 'Este plano não está disponível.' }

  const payerId = profile.is_dependent && profile.parent_id ? profile.parent_id : user.id

  // Cancel existing active subscriptions
  await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', user.id)
    .eq('status', 'active')

  const now = new Date()
  const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const { data: newSub, error: insertErr } = await adminClient
    .from('student_subscriptions')
    .insert({
      student_id: user.id,
      payer_id: payerId,
      plan_id: planId,
      status: 'active',
      starts_at: now.toISOString(),
      ends_at: null,
      next_billing_at: nextBilling.toISOString(),
      discount_pct: 0,
      gateway_subscription_id: null,
    })
    .select('id')
    .single()

  if (insertErr || !newSub) return { error: 'Erro ao criar assinatura. Tente novamente.' }

  // Grant initial monthly credits
  const credits = plan.credits_per_month as number
  if (credits > 0) {
    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'renewed',
      amount: credits,
      reason: `Créditos iniciais — plano ${plan.name}`,
      session_id: null,
      subscription_id: newSub.id,
      expires_at: null,
    })

    await adminClient
      .from('profiles')
      .update({ credits_balance: credits })
      .eq('id', user.id)
  }

  return {}
}
```

- [ ] **Step 2: Testar**

1. Faça login como aluno com 0 créditos
2. Acesse a página de planos e assine um plano
3. Verifique que `profiles.credits_balance` foi atualizado no Supabase
4. Verifique que existe uma linha em `credit_transactions` com `type='renewed'`

- [ ] **Step 3: Commit**

```bash
git add features/financeiro/actions.ts
git commit -m "fix: conceder créditos iniciais ao aluno ao assinar plano"
```

---

## Task 7: Day Use — Texto e Capacidade Ilimitada (#2, #9)

**Contexto:** #2 — O card na `/agendar` diz "Reservar quadra sem usar créditos →", sugerindo que é gratuito. Day Use terá custo (a ser cobrado futuramente). #9 — Day use deve aceitar participantes ilimitados; remover verificação de capacidade.

**Files:**
- Modify: `app/(dashboard)/agendar/page.tsx` — corrigir texto do card
- Modify: `features/dayuse/actions.ts` — remover checagem de capacity em `bookDayUse`

- [ ] **Step 1: Corrigir texto no card de day use**

Em `app/(dashboard)/agendar/page.tsx`, substitua o bloco do link de Day Use:

```tsx
<Link
  href="/agendar/dayuse"
  className="flex items-center justify-between bg-green-900/20 border border-green-700/40 rounded-xl px-4 py-3 hover:bg-green-900/30 transition-colors"
>
  <div>
    <p className="text-green-300 text-sm font-medium">Day Use disponível</p>
    <p className="text-green-500/80 text-xs mt-0.5">Reserve uma quadra avulsa →</p>
  </div>
  <span className="text-2xl">🏖️</span>
</Link>
```

- [ ] **Step 2: Remover verificação de capacidade em `bookDayUse`**

Em `features/dayuse/actions.ts`, remova as linhas que verificam capacidade dentro de `bookDayUse`. O trecho:

```typescript
// REMOVER ESTE BLOCO:
const { count } = await supabase
  .from('dayuse_bookings')
  .select('*', { count: 'exact', head: true })
  .eq('slot_id', slotId)
  .eq('status', 'confirmed')

if ((count ?? 0) >= slot.capacity) return { error: 'Slot lotado' }
```

A função `bookDayUse` simplificada fica:

```typescript
export async function bookDayUse(slotId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { data: slot } = await supabase
    .from('dayuse_slots')
    .select('id')
    .eq('id', slotId)
    .single()
  if (!slot) return { error: 'Slot não encontrado' }

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
```

- [ ] **Step 3: Testar**

1. `/agendar` — o card de day use deve mostrar "Reserve uma quadra avulsa →" sem mencionar créditos
2. Reservar um day use como aluno → deve funcionar sem limite de vagas
3. Reservar o mesmo slot como outro aluno → também deve funcionar

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/agendar/page.tsx" features/dayuse/actions.ts
git commit -m "fix: day use com participantes ilimitados e texto sem implicar gratuidade"
```

---

## Task 8: Dados Desatualizados no Perfil do Aluno (#10)

**Contexto:** Depois que o admin matrícula ou cancela matrícula de um aluno, a página `/admin/alunos/[id]` não reflete a mudança até F5. Isso ocorre porque `enrollStudentInClass` e `cancelEnrollment` em `adminActions.ts` não chamam `revalidatePath` para a URL específica do aluno.

**Files:**
- Modify: `features/aulas/adminActions.ts`

- [ ] **Step 1: Adicionar `revalidatePath` nas actions de matrícula**

Em `features/aulas/adminActions.ts`, localize `enrollStudentInClass` e `cancelEnrollment`. Verifique que `revalidatePath` está importado no topo do arquivo:

```typescript
import { revalidatePath } from 'next/cache'
```

Em `enrollStudentInClass`, após o insert bem-sucedido, adicione:
```typescript
revalidatePath(`/admin/alunos/${studentId}`)
revalidatePath('/admin/alunos')
return {}
```

Em `cancelEnrollment`, antes do `return {}` final, adicione:
```typescript
// Fetch the studentId from the enrollment to revalidate the correct page
const { data: enrollment } = await adminClient
  .from('enrollments')
  .select('student_id')
  .eq('id', enrollmentId)
  .single()

if (enrollment) {
  revalidatePath(`/admin/alunos/${enrollment.student_id}`)
}
revalidatePath('/admin/alunos')
return {}
```

> **Nota:** `cancelEnrollment` recebe `enrollmentId`, não `studentId`. Precisamos fazer um select para obter o studentId antes de revalidar. Certifique-se de que esse select seja feito ANTES do update/delete, ou adicione um segundo select após.

A implementação correta de `cancelEnrollment` passa a ser:

```typescript
export async function cancelEnrollment(enrollmentId: string): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  // Fetch student_id before cancelling for revalidation
  const { data: enrollment } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('id', enrollmentId)
    .single()

  const { error } = await adminClient
    .from('enrollments')
    .update({ is_active: false, cancelled_at: new Date().toISOString() })
    .eq('id', enrollmentId)

  if (error) return { error: 'Erro ao cancelar matrícula.' }

  if (enrollment) {
    revalidatePath(`/admin/alunos/${enrollment.student_id}`)
  }
  revalidatePath('/admin/alunos')
  return {}
}
```

- [ ] **Step 2: Testar**

1. Abrir perfil de um aluno em `/admin/alunos/[id]`
2. Matricular o aluno em uma turma
3. A lista de matrículas deve atualizar sem F5 (via `useTransition` no cliente + revalidação server)
4. Cancelar uma matrícula → deve sumir da lista imediatamente

- [ ] **Step 3: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "fix: revalidar cache da página do aluno após matrícula/cancelamento"
```

---

## Task 9: Dependentes pelo Responsável + Plano para Dependentes (#3, #14)

**Contexto:**
- #3: Atualmente só o admin pode adicionar dependentes (`requireAdmin()` em `adminActions.ts`). O responsável deve poder adicionar a partir do próprio perfil (`/perfil`).
- #14: Não existe UI para associar um plano a um dependente via admin.

**Files:**
- Modify: `features/aulas/adminActions.ts` — adicionar `addDependentSelf` (sem requireAdmin)
- Modify: `app/(dashboard)/perfil/page.tsx` — adicionar seção de dependentes
- Modify: `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx` — adicionar seleção de plano para dependente

- [ ] **Step 1: Criar `addDependentSelf` em `adminActions.ts`**

Adicione ao final de `features/aulas/adminActions.ts`:

```typescript
/**
 * Permite que um responsável autenticado adicione um dependente a si mesmo.
 * Não requer papel de admin.
 */
export async function addDependentSelf(
  name: string,
  level: StudentLevel,
): Promise<{ error?: string; dependentId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!name.trim()) return { error: 'Nome é obrigatório.' }

  const adminClient = createAdminClient()

  // Verify caller is not a dependent themselves
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('is_dependent, role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.is_dependent) {
    return { error: 'Dependentes não podem adicionar outros dependentes.' }
  }

  const { data: newDep, error } = await adminClient
    .from('profiles')
    .insert({
      id: crypto.randomUUID(),
      full_name: name.trim(),
      level,
      role: 'student',
      is_dependent: true,
      parent_id: user.id,
      payment_type: 'subscriber',
      credits_balance: 0,
      contract_active: false,
    })
    .select('id')
    .single()

  if (error) return { error: 'Erro ao adicionar dependente.' }

  revalidatePath('/perfil')
  return { dependentId: newDep.id }
}
```

> **Nota:** Dependentes não têm `auth.users` — são apenas entradas na tabela `profiles`. O pai gerencia tudo por eles.

- [ ] **Step 2: Adicionar seção de dependentes em `/perfil`**

Leia o conteúdo atual de `app/(dashboard)/perfil/page.tsx` e adicione a seção ao final do JSX, antes de fechar o `<div>` principal.

Primeiro, verifique o conteúdo atual do arquivo e como ele está estruturado. Depois, adicione a busca de dependentes no Server Component:

```typescript
// Dentro do Server Component, buscar dependentes
const { data: dependents } = await supabase
  .from('profiles')
  .select('id, full_name, level')
  .eq('parent_id', user.id)
  .eq('is_dependent', true)
```

E no JSX adicione o `DependentsSection` client component. Crie `features/aulas/DependentsSection.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { addDependentSelf } from './adminActions'
import type { StudentLevel } from '@/types'

const LEVELS: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']
const SELECT_CLS = 'bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'

interface Dependent { id: string; full_name: string; level: StudentLevel }

export function DependentsSection({ initialDependents }: { initialDependents: Dependent[] }) {
  const [list, setList] = useState(initialDependents)
  const [name, setName] = useState('')
  const [level, setLevel] = useState<StudentLevel>('iniciante')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd() {
    if (!name.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addDependentSelf(name.trim(), level)
      if (result.error) { setError(result.error); return }
      setList((prev) => [...prev, { id: result.dependentId!, full_name: name.trim(), level }])
      setName('')
    })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-white">Meus Dependentes (Kids)</h2>

      {list.length === 0 ? (
        <p className="text-slate-500 text-sm">Nenhum dependente cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-2 bg-surface-card border border-surface-border rounded-xl">
              <span className="text-white text-sm">{d.full_name}</span>
              <Badge variant="kids">KIDS · {d.level.toUpperCase()}</Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 items-end pt-1">
        <div className="flex-1">
          <Input
            label="Nome do dependente"
            placeholder="Nome completo..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nível</label>
          <select value={level} onChange={(e) => setLevel(e.target.value as StudentLevel)} className={SELECT_CLS}>
            {LEVELS.map((l) => <option key={l} value={l}>{l === 'iniciante' ? 'Iniciante' : l}</option>)}
          </select>
        </div>
        <Button variant="secondary" size="sm" loading={isPending} onClick={handleAdd} disabled={!name.trim()}>
          Adicionar
        </Button>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
    </section>
  )
}
```

- [ ] **Step 3: Adicionar seleção de plano para dependentes no admin**

Em `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx`, adicione um novo `SubscribeDependentSection`. Mas primeiro, crie uma server action para o admin assinar um plano **em nome de** um aluno específico (usado para dependentes).

Adicione em `features/financeiro/actions.ts`:

```typescript
/**
 * Admin assina um plano em nome de um aluno (ex: dependente).
 * Apenas admin pode chamar.
 */
export async function adminSubscribeStudentToPlan(
  studentId: string,
  planId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (callerProfile?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: studentProfile } = await adminClient
    .from('profiles')
    .select('id, is_dependent, parent_id')
    .eq('id', studentId)
    .single()
  if (!studentProfile) return { error: 'Aluno não encontrado.' }

  const { data: plan } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, credits_per_month, name')
    .eq('id', planId)
    .single()
  if (!plan || !plan.is_active) return { error: 'Plano não encontrado ou inativo.' }

  const payerId = studentProfile.is_dependent && studentProfile.parent_id
    ? studentProfile.parent_id
    : studentId

  await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', studentId)
    .eq('status', 'active')

  const now = new Date()
  const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const { data: newSub, error: insertErr } = await adminClient
    .from('student_subscriptions')
    .insert({
      student_id: studentId,
      payer_id: payerId,
      plan_id: planId,
      status: 'active',
      starts_at: now.toISOString(),
      ends_at: null,
      next_billing_at: nextBilling.toISOString(),
      discount_pct: 0,
      gateway_subscription_id: null,
    })
    .select('id')
    .single()

  if (insertErr || !newSub) return { error: 'Erro ao criar assinatura.' }

  const credits = plan.credits_per_month as number
  if (credits > 0) {
    await adminClient.from('credit_transactions').insert({
      student_id: studentId,
      type: 'renewed',
      amount: credits,
      reason: `Créditos iniciais (admin) — plano ${plan.name}`,
      session_id: null,
      subscription_id: newSub.id,
      expires_at: null,
    })
    await adminClient
      .from('profiles')
      .update({ credits_balance: credits })
      .eq('id', studentId)
  }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}
```

Em `StudentProfileClient.tsx`, adicione a importação e o novo `SubscribePlanSection` client para dependentes, passando as `availablePlans` do server component parent. No `page.tsx` do admin aluno, busque os planos disponíveis e passe como prop.

- [ ] **Step 4: Testar**

1. Login como aluno responsável → `/perfil` → seção "Meus Dependentes" → adicionar dependente → deve aparecer na lista
2. Login como admin → `/admin/alunos/[id]` de um dependente → seção "Plano" → selecionar plano → créditos devem ser concedidos

- [ ] **Step 5: Commit**

```bash
git add features/aulas/adminActions.ts features/aulas/DependentsSection.tsx "app/(dashboard)/perfil/page.tsx" features/financeiro/actions.ts "app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx" "app/(admin)/admin/alunos/[id]/page.tsx"
git commit -m "feat: responsável adiciona dependentes; admin associa plano a dependente"
```

---

## Task 10: CRUD de Planos via App (#15)

**Contexto:** `PlansManager.tsx` só tem toggle active e update prices. Não existe UI para criar um novo plano. O usuário não consegue gerenciar planos sem acesso direto ao banco.

**Files:**
- Modify: `app/(admin)/admin/financeiro/adminActions.ts` — adicionar `createPlan`
- Modify: `app/(admin)/admin/financeiro/PlansManager.tsx` — adicionar formulário de criação

- [ ] **Step 1: Verificar o arquivo `adminActions.ts` do financeiro**

Leia `app/(admin)/admin/financeiro/adminActions.ts` para entender as actions existentes (`togglePlanActive`, `updatePlanPrice`).

- [ ] **Step 2: Adicionar `createPlan` em `adminActions.ts`**

Adicione ao arquivo `app/(admin)/admin/financeiro/adminActions.ts`:

```typescript
export interface CreatePlanData {
  name: string
  description?: string
  classes_per_week: number
  credits_per_month: number
  price_monthly: number
  price_quarterly: number
  price_annual: number
}

export async function createPlan(data: CreatePlanData): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return { error: 'Sem permissão.' }

  if (!data.name.trim()) return { error: 'Nome é obrigatório.' }
  if (data.credits_per_month < 1) return { error: 'Créditos por mês deve ser ≥ 1.' }
  if (data.price_monthly < 0) return { error: 'Preço inválido.' }

  const { error } = await adminClient.from('subscription_plans').insert({
    name: data.name.trim(),
    description: data.description?.trim() || null,
    classes_per_week: data.classes_per_week,
    credits_per_month: data.credits_per_month,
    price_monthly: data.price_monthly,
    price_quarterly: data.price_quarterly,
    price_annual: data.price_annual,
    is_active: true,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/financeiro')
  return {}
}
```

- [ ] **Step 3: Adicionar formulário de criação em `PlansManager.tsx`**

Leia o conteúdo atual de `app/(admin)/admin/financeiro/PlansManager.tsx` e adicione um `CreatePlanForm` ao final da seção de planos:

```tsx
// Adicione ao componente PlansManager (ou criar subcomponente)
function CreatePlanForm() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createPlan({
        name: fd.get('name') as string,
        description: fd.get('description') as string,
        classes_per_week: Number(fd.get('classes_per_week')),
        credits_per_month: Number(fd.get('credits_per_month')),
        price_monthly: Number(fd.get('price_monthly')),
        price_quarterly: Number(fd.get('price_quarterly')),
        price_annual: Number(fd.get('price_annual')),
      })
      if (result.error) { setError(result.error); return }
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Novo Plano
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-card border border-surface-border rounded-xl p-4 space-y-3">
      <h3 className="text-white font-semibold text-sm">Novo Plano</h3>
      <Input name="name" label="Nome *" placeholder="Ex: Plano 2x Semana" required />
      <Input name="description" label="Descrição" placeholder="Opcional" />
      <div className="grid grid-cols-2 gap-3">
        <Input name="classes_per_week" label="Aulas/semana" type="number" required min="1" defaultValue="2" />
        <Input name="credits_per_month" label="Créditos/mês" type="number" required min="1" defaultValue="8" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input name="price_monthly" label="Mensal (R$)" type="number" required min="0" step="0.01" defaultValue="0" />
        <Input name="price_quarterly" label="Trimestral (R$)" type="number" required min="0" step="0.01" defaultValue="0" />
        <Input name="price_annual" label="Anual (R$)" type="number" required min="0" step="0.01" defaultValue="0" />
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>{isPending ? 'Criando...' : 'Criar Plano'}</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
```

E inclua `<CreatePlanForm />` no JSX do `PlansManager` logo acima ou abaixo da lista de planos existentes.

> Certifique-se de adicionar `import { createPlan } from './adminActions'`, `import { useRouter } from 'next/navigation'` e `import { useTransition, useState } from 'react'` ao `PlansManager.tsx`.

- [ ] **Step 4: Testar**

1. `npm run dev`
2. Acesse `/admin/financeiro`
3. Clique "+ Novo Plano"
4. Preencha os campos e clique "Criar Plano"
5. O novo plano deve aparecer na lista sem reload manual

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/financeiro/adminActions.ts" "app/(admin)/admin/financeiro/PlansManager.tsx"
git commit -m "feat: criar novos planos de assinatura via admin"
```

---

## Self-Review: Checklist de Spec Coverage

| Issue | Task | Coberto? |
|-------|------|----------|
| #1 Editar turma | Task 2 | ✓ |
| #2 Day Use sem tag grátis | Task 7 | ✓ |
| #3 Dependentes pelo responsável | Task 9 | ✓ |
| #4 Iniciar aula com chamada | Task 5 | ✓ |
| #5 Remover nome de aula | Task 4 | ✓ |
| #6 Mobile sem menu | Task 3 | ✓ |
| #7 Assinatura não calcula créditos | Task 6 | ✓ |
| #8 Layout datas sobrepostas | Task 2 | ✓ |
| #9 Day use ilimitado | Task 7 | ✓ |
| #10 Aulas do aluno sem atualização | Task 8 | ✓ |
| #11 Aula de hoje não aparece | Task 1 | ✓ |
| #12 Experimental sem turmas | Task 1 | ✓ |
| #13 Aluno não se vincula a aula | Task 1 | ✓ |
| #14 Plano para dependentes | Task 9 | ✓ |
| #15 CRUD de planos | Task 10 | ✓ |

**Ordem de execução recomendada:** Task 1 (crítico) → Task 8 → Task 6 → Task 7 → Task 4 → Task 2 → Task 5 → Task 6 → Task 9 → Task 10 → Task 3

> Task 1 desbloqueia #11, #12 e #13 de uma vez — executar primeiro.
