# Generalizar app multi-modalidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover a fixação em beach tennis/arena de areia para que o app sirva qualquer academia/escola esportiva (crossfit, pilates, futebol etc.).

**Architecture:** Quatro frentes independentes — (1) modalidades com lista ampliada + "Outro" texto livre; (2) remoção do gating de nível; (3) esconder badges/seletores de nível; (4) termo "Quadra"→"Espaço" e copy da landing/metadados genéricos, mantendo a marca ArenaHub. Nenhuma migração de banco: colunas `level` ficam dormentes.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind · Supabase · Vitest.

**Spec:** [docs/superpowers/specs/2026-07-09-generalizar-multi-modalidade-design.md](../specs/2026-07-09-generalizar-multi-modalidade-design.md)

---

## File Structure

**Criar:**
- `components/ui/SportsPicker.tsx` — componente compartilhado de seleção de modalidades (chips fixos + "Outro" texto livre). Usado por Onboarding e Vitrine (DRY).

**Modificar (modalidades):**
- `lib/arenas/sports.ts` — lista ampliada + helpers de custom (`custom:`)
- `lib/arenas/sports.test.ts` — cobre lista nova e custom
- `app/onboarding/OnboardingForm.tsx` — usa `SportsPicker`
- `app/(admin)/admin/configuracoes/VitrineForm.tsx` — usa `SportsPicker`
- `app/(public)/t/[id]/page.tsx` — mapa de labels de esporte (expandir/fallback)

**Modificar (níveis — gating):**
- `features/aulas/actions.ts`, `features/aulas/waitlistActions.ts`, `features/torneios/actions.ts`, `app/(dashboard)/home/page.tsx`, `app/(dashboard)/agendar/page.tsx`, `features/aulas/BookingForm.tsx`
- **Remover:** `lib/utils/levelAccess.ts`, `lib/utils/levelAccess.test.ts`

**Modificar (níveis — UI):**
- `features/aulas/ClassForm.tsx`, `features/aulas/EditClassForm.tsx`, `features/aulas/class-form-actions.ts`, `features/aulas/ClassCard.tsx`, `app/(dashboard)/perfil/page.tsx`, `app/(dashboard)/home/page.tsx`, `app/(admin)/admin/torneios/CreateTournamentForm.tsx`

**Modificar (terminologia + landing):**
- `features/aulas/ClassForm.tsx`, `features/aulas/EditClassForm.tsx`, `features/dayuse/CreateDayUseForm.tsx`, `features/dayuse/DayUseSlotCard.tsx`, `features/dayuse/DayUseBookingCard.tsx`, `app/(dashboard)/home/page.tsx`, `app/arenas/[slug]/TrialBookingForm.tsx`, `app/(dashboard)/perfil/page.tsx`, `app/(dashboard)/agendar/page.tsx`, `app/(dashboard)/agendar/dayuse/page.tsx`, `app/page.tsx`, `app/layout.tsx`, `app/_landing/LiveDemo.tsx`, `lib/billing/platformPlan.ts`

---

## Phase 1 — Camada de dados de modalidades

### Task 1: Ampliar lista de esportes + helpers de custom (TDD)

**Files:**
- Modify: `lib/arenas/sports.ts`
- Test: `lib/arenas/sports.test.ts`

- [ ] **Step 1: Escrever os testes novos**

Adicionar ao final do `describe` existente em `lib/arenas/sports.test.ts` (mantendo os testes atuais):

```typescript
import { SPORTS, SPORT_BY_SLUG, normalizeSports, sanitizeCustomSport, sportLabel } from './sports'

describe('modalidades ampliadas', () => {
  it('inclui novas modalidades além das de areia', () => {
    expect(SPORT_BY_SLUG.get('crossfit')?.label).toBe('CrossFit')
    expect(SPORT_BY_SLUG.get('pilates')?.label).toBe('Pilates')
    expect(SPORT_BY_SLUG.get('futebol')?.label).toBe('Futebol')
  })
})

describe('sanitizeCustomSport', () => {
  it('prefixa e normaliza texto livre', () => {
    expect(sanitizeCustomSport('  Jiu Jitsu ')).toBe('custom:Jiu Jitsu')
  })
  it('rejeita vazio', () => {
    expect(sanitizeCustomSport('   ')).toBeNull()
  })
  it('limita o tamanho a 40 caracteres', () => {
    const long = 'a'.repeat(60)
    expect(sanitizeCustomSport(long)).toBe('custom:' + 'a'.repeat(40))
  })
})

describe('normalizeSports com custom', () => {
  it('mantém slugs conhecidos e entradas custom, remove inválidos', () => {
    expect(normalizeSports(['crossfit', 'custom:Jiu Jitsu', 'xadrez'])).toEqual([
      'crossfit',
      'custom:Jiu Jitsu',
    ])
  })
  it('remove duplicados custom', () => {
    expect(normalizeSports(['custom:Yoga', 'custom:Yoga'])).toEqual(['custom:Yoga'])
  })
})

describe('sportLabel', () => {
  it('resolve slug conhecido para label', () => {
    expect(sportLabel('padel')).toBe('Padel')
  })
  it('resolve custom para o texto puro', () => {
    expect(sportLabel('custom:Jiu Jitsu')).toBe('Jiu Jitsu')
  })
})
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm run test:run -- lib/arenas/sports.test.ts`
Expected: FAIL (`sanitizeCustomSport`/`sportLabel` não existem; `crossfit` ausente).

- [ ] **Step 3: Reescrever `lib/arenas/sports.ts`**

```typescript
// lib/arenas/sports.ts
// Lista curada de modalidades usada no diretório /arenas e nos formulários de vitrine.
// Não há tabela: modalidade é metadado (tag) da organização para busca.
// Entradas "Outro" (texto livre) são prefixadas com "custom:" e não entram nas facetas.

export interface Sport {
  slug: string
  label: string
  emoji: string
}

export const SPORTS: Sport[] = [
  { slug: 'beach_tennis', label: 'Beach Tennis', emoji: '🎾' },
  { slug: 'padel', label: 'Padel', emoji: '🟢' },
  { slug: 'futevolei', label: 'Futevôlei', emoji: '⚽' },
  { slug: 'volei_praia', label: 'Vôlei de Praia', emoji: '🏐' },
  { slug: 'tenis', label: 'Tênis', emoji: '🎾' },
  { slug: 'futebol', label: 'Futebol', emoji: '⚽' },
  { slug: 'crossfit', label: 'CrossFit', emoji: '🏋️' },
  { slug: 'funcional', label: 'Funcional', emoji: '🤸' },
  { slug: 'pilates', label: 'Pilates', emoji: '🧘' },
  { slug: 'yoga', label: 'Yoga', emoji: '🧘' },
  { slug: 'muay_thai', label: 'Muay Thai / Luta', emoji: '🥊' },
  { slug: 'natacao', label: 'Natação', emoji: '🏊' },
  { slug: 'volei_quadra', label: 'Vôlei de Quadra', emoji: '🏐' },
  { slug: 'basquete', label: 'Basquete', emoji: '🏀' },
  { slug: 'danca', label: 'Dança', emoji: '💃' },
]

export const SPORT_BY_SLUG = new Map<string, Sport>(SPORTS.map((s) => [s.slug, s]))

const CUSTOM_PREFIX = 'custom:'
const MAX_CUSTOM_SPORT_LEN = 40

export function isCustomSport(slug: string): boolean {
  return slug.startsWith(CUSTOM_PREFIX)
}

// Normaliza texto livre "Outro" em uma tag "custom:<texto>". Retorna null se vazio.
export function sanitizeCustomSport(raw: string): string | null {
  const text = String(raw).trim().replace(/\s+/g, ' ').slice(0, MAX_CUSTOM_SPORT_LEN)
  if (!text) return null
  return CUSTOM_PREFIX + text
}

// Filtra a entrada contra a lista válida + entradas custom; remove duplicados e inválidos.
export function normalizeSports(input: string[]): string[] {
  const out: string[] = []
  for (const raw of input) {
    const slug = String(raw).trim()
    if (isCustomSport(slug)) {
      const clean = sanitizeCustomSport(slug.slice(CUSTOM_PREFIX.length))
      if (clean && !out.includes(clean)) out.push(clean)
    } else if (SPORT_BY_SLUG.has(slug) && !out.includes(slug)) {
      out.push(slug)
    }
  }
  return out
}

// Rótulo de exibição para uma tag: slug conhecido → label; custom → texto puro.
export function sportLabel(slug: string): string {
  if (isCustomSport(slug)) return slug.slice(CUSTOM_PREFIX.length)
  return SPORT_BY_SLUG.get(slug)?.label ?? slug
}
```

- [ ] **Step 4: Rodar até passar**

Run: `npm run test:run -- lib/arenas/sports.test.ts`
Expected: PASS (todos, incluindo os testes antigos).

- [ ] **Step 5: Commit**

```bash
git add lib/arenas/sports.ts lib/arenas/sports.test.ts
git commit -m "feat(sports): ampliar modalidades e suportar 'Outro' (texto livre)"
```

---

## Phase 2 — UI de modalidades

### Task 2: Componente `SportsPicker` compartilhado

**Files:**
- Create: `components/ui/SportsPicker.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client'
// components/ui/SportsPicker.tsx
import { useState } from 'react'
import { SPORTS, isCustomSport, sanitizeCustomSport, sportLabel } from '@/lib/arenas/sports'

interface SportsPickerProps {
  value: string[]
  onChange: (next: string[]) => void
}

const chipBase = 'text-sm rounded-full px-3 py-1.5 border transition-colors'
const chipOn = 'border-brand-500 bg-brand-500/15 text-white'
const chipOff = 'border-surface-border bg-surface-card text-slate-400 hover:border-slate-500'

export function SportsPicker({ value, onChange }: SportsPickerProps) {
  const [custom, setCustom] = useState('')

  function toggle(slug: string) {
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug])
  }

  function addCustom() {
    const clean = sanitizeCustomSport(custom)
    if (clean && !value.includes(clean)) onChange([...value, clean])
    setCustom('')
  }

  const customTags = value.filter(isCustomSport)

  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-300 font-medium">Modalidades oferecidas</label>
      <div className="flex flex-wrap gap-2">
        {SPORTS.map((sport) => (
          <button
            key={sport.slug}
            type="button"
            onClick={() => toggle(sport.slug)}
            className={[chipBase, value.includes(sport.slug) ? chipOn : chipOff].join(' ')}
          >
            {sport.emoji} {sport.label}
          </button>
        ))}
        {customTags.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => toggle(slug)}
            className={[chipBase, chipOn].join(' ')}
          >
            {sportLabel(slug)} ✕
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
          placeholder="Outro (ex.: Jiu Jitsu)"
          className="flex-1 bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-brand-500"
        />
        <button
          type="button"
          onClick={addCustom}
          className="text-sm rounded-lg px-3 py-1.5 border border-surface-border bg-surface-card text-slate-200 hover:border-brand-500"
        >
          Adicionar
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar typecheck/lint**

Run: `npm run lint`
Expected: sem erros novos em `components/ui/SportsPicker.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/SportsPicker.tsx
git commit -m "feat(ui): SportsPicker com chips fixos + Outro texto livre"
```

### Task 3: Usar `SportsPicker` no Onboarding

**Files:**
- Modify: `app/onboarding/OnboardingForm.tsx`

- [ ] **Step 1: Trocar import**

Substituir a linha 8:

```tsx
import { SPORTS } from '@/lib/arenas/sports'
```

por:

```tsx
import { SportsPicker } from '@/components/ui/SportsPicker'
```

- [ ] **Step 2: Remover `toggleSport` (linhas 46-48)**

Apagar:

```tsx
  function toggleSport(slug: string) {
    setSports((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]))
  }
```

- [ ] **Step 3: Substituir o bloco de chips (linhas 153-175)**

Substituir todo o bloco `<div className="space-y-2"> ... </div>` dos esportes por:

```tsx
        <SportsPicker value={sports} onChange={setSports} />
```

- [ ] **Step 4: Verificar**

Run: `npm run lint`
Expected: sem erros; sem referência órfã a `SPORTS`/`toggleSport`.

- [ ] **Step 5: Commit**

```bash
git add app/onboarding/OnboardingForm.tsx
git commit -m "refactor(onboarding): usar SportsPicker"
```

### Task 4: Usar `SportsPicker` na Vitrine

**Files:**
- Modify: `app/(admin)/admin/configuracoes/VitrineForm.tsx`

- [ ] **Step 1: Trocar import (linha 7)**

De `import { SPORTS } from '@/lib/arenas/sports'` para `import { SportsPicker } from '@/components/ui/SportsPicker'`.

- [ ] **Step 2: Remover `toggleSport` (linhas 42-44)**

Apagar a função `toggleSport`.

- [ ] **Step 3: Substituir o bloco de chips (linhas 143-165)**

Substituir o `<div className="space-y-2"> ... </div>` dos esportes por:

```tsx
        <SportsPicker value={sports} onChange={setSports} />
```

- [ ] **Step 4: Verificar**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/configuracoes/VitrineForm.tsx"
git commit -m "refactor(vitrine): usar SportsPicker"
```

### Task 5: Fallback de label no mapa de esportes de torneios públicos

**Files:**
- Modify: `app/(public)/t/[id]/page.tsx:157`

- [ ] **Step 1: Ler o contexto do mapa**

Abrir `app/(public)/t/[id]/page.tsx` na linha ~157. O código atual é um objeto literal:

```tsx
    beach_tennis: '🎾 Beach Tennis', beach_volei: '🏐 Beach Vôlei', padel: '🏓 Padel',
```

- [ ] **Step 2: Garantir fallback genérico**

Onde esse mapa é consumido (ex.: `MAP[sport] ?? sport`), trocar o fallback para usar `sportLabel`:

Adicionar import no topo do arquivo:

```tsx
import { sportLabel } from '@/lib/arenas/sports'
```

E onde hoje há algo como `SPORT_LABELS[t.sport] ?? t.sport`, trocar por `SPORT_LABELS[t.sport] ?? sportLabel(t.sport)`. Isso cobre slugs novos e `custom:` sem quebrar.

- [ ] **Step 3: Verificar**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/t/[id]/page.tsx"
git commit -m "fix(torneios-publico): fallback de label via sportLabel"
```

---

## Phase 3 — Remover o gating de nível

### Task 6: Remover checagens de nível no booking e fila (TDD-guardado por testes existentes)

**Files:**
- Modify: `features/aulas/actions.ts:146-150`, `features/aulas/waitlistActions.ts:97-100`

- [ ] **Step 1: `features/aulas/actions.ts` — remover o bloco de nível**

Apagar as linhas 146-150:

```tsx
  // 3. Level check (Wellhub/TotalPass entram em qualquer turma)
  const skipsLevel = profile.payment_type === 'wellhub' || profile.payment_type === 'totalpass'
  if (!skipsLevel && !canStudentAttendLevel(profile.level as StudentLevel, cls.level)) {
    return { error: `Seu nível (${profile.level}) não permite participar desta turma (${cls.level}).` }
  }
```

Remover também o import `canStudentAttendLevel` (linha 6) e, se `StudentLevel` ficar sem uso, removê-lo do import de tipos. Manter o comentário do cabeçalho da função coerente (remover a menção "3. Level check" na docstring, linha 98).

- [ ] **Step 2: `features/aulas/waitlistActions.ts` — remover o bloco de nível**

Apagar as linhas 97-100:

```tsx
  const skipsLevel = joinProfile.payment_type === 'wellhub' || joinProfile.payment_type === 'totalpass'
  if (!skipsLevel && !canStudentAttendLevel(joinProfile.level as StudentLevel, clsInfo.level)) {
    return { error: `Seu nível (${joinProfile.level}) não permite participar desta turma (${clsInfo.level}).` }
  }
```

Remover o import `canStudentAttendLevel` (linha 6). Em `clsInfo`, o campo `level` pode ser mantido no select sem uso ou removido — remover `level: StudentLevel` do tipo local se não for mais lido.

- [ ] **Step 3: Verificar build**

Run: `npm run lint`
Expected: sem "unused import"; sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add features/aulas/actions.ts features/aulas/waitlistActions.ts
git commit -m "feat(aulas): remover gating de nível no booking e fila"
```

### Task 7: Remover gating de nível em torneios

**Files:**
- Modify: `features/torneios/actions.ts:224-228`

- [ ] **Step 1: Remover o bloco**

Apagar as linhas 224-228:

```tsx
  if (!canStudentAttendLevel(membership.level as StudentLevel, tournament.level as StudentLevel)) {
    return {
      error: `Seu nível (${membership.level}) não permite participar deste torneio (${tournament.level}).`,
    }
  }
```

Remover o import `canStudentAttendLevel` (linha 6). Se `StudentLevel` ficar órfão, removê-lo.

- [ ] **Step 2: Verificar**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(torneios): remover gating de nível na inscrição"
```

### Task 8: Remover filtro de nível na home e no agendar

**Files:**
- Modify: `app/(dashboard)/home/page.tsx:153-161`, `app/(dashboard)/agendar/page.tsx:21,34-39`

- [ ] **Step 1: `home/page.tsx` — simplificar o filtro**

Substituir as linhas 153-161:

```tsx
  // Filter today's classes by student level
  const allTodayClasses = (todayClassesData ?? []) as Class[]
  const todayClasses = membership
    ? allTodayClasses.filter((c) => {
        const levelOk = canStudentAttendLevel(membership.level, c.level)
        const kidsOk = c.type !== 'kids' || membership.is_dependent
        return levelOk && kidsOk
      })
    : []
```

por:

```tsx
  // Filtra as turmas de hoje apenas por kids (nível não bloqueia mais).
  const allTodayClasses = (todayClassesData ?? []) as Class[]
  const todayClasses = membership
    ? allTodayClasses.filter((c) => c.type !== 'kids' || membership.is_dependent)
    : []
```

Remover o import `canStudentAttendLevel` (linha 10).

- [ ] **Step 2: `agendar/page.tsx` — simplificar o filtro**

Remover a linha 21 (`const { canStudentAttendLevel } = await import(...)`). Substituir as linhas 34-39:

```tsx
  // Filter by level + kids
  const availableClasses = allClasses.filter((c) => {
    const levelOk = canStudentAttendLevel(studentProfile.level, c.level)
    const kidsOk = c.type !== 'kids' || studentProfile.is_dependent
    return levelOk && kidsOk
  })
```

por:

```tsx
  // Filtra apenas por kids (nível não bloqueia mais).
  const availableClasses = allClasses.filter(
    (c) => c.type !== 'kids' || studentProfile.is_dependent,
  )
```

Ajustar a mensagem de vazio (linha ~58): trocar `"Não há turmas ativas compatíveis com seu nível."` por `"Não há turmas ativas no momento."`.

- [ ] **Step 3: Verificar**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/home/page.tsx" "app/(dashboard)/agendar/page.tsx"
git commit -m "feat(aulas): remover filtro de nível na home e agendar"
```

### Task 9: Remover gating do `BookingForm` e apagar `levelAccess`

**Files:**
- Modify: `features/aulas/BookingForm.tsx:8,36,39,69-84`
- Delete: `lib/utils/levelAccess.ts`, `lib/utils/levelAccess.test.ts`

- [ ] **Step 1: `BookingForm.tsx` — remover pré-validação de nível**

- Remover o import (linha 8): `import { canStudentAttendLevel } from '@/lib/utils/levelAccess'`.
- Substituir as linhas 35-39:

```tsx
  // Client-side pre-validation
  const levelOk = canStudentAttendLevel(studentLevel, c.level)
  const kidsOk = c.type !== 'kids' || isDependent

  const canBook = levelOk && kidsOk
```

por:

```tsx
  // Client-side pre-validation (nível não bloqueia mais).
  const canBook = c.type !== 'kids' || isDependent
```

- Substituir o bloco `if (!canBook)` (linhas 69-84) por:

```tsx
  if (!canBook) {
    return (
      <div className="mt-3">
        <p className="text-xs text-red-400">
          Esta turma é exclusiva para dependentes (kids).
        </p>
      </div>
    )
  }
```

- A prop `studentLevel` fica sem uso: removê-la da interface `BookingFormProps` e da desestruturação.

- [ ] **Step 2: Buscar e limpar call sites de `BookingForm`**

Com Grep, buscar `<BookingForm` (e `studentLevel=`) nos arquivos que renderizam o componente (ex.: `app/(dashboard)/aulas/page.tsx`) e remover a prop `studentLevel={...}` de cada um.

- [ ] **Step 3: Apagar `levelAccess`**

```bash
git rm lib/utils/levelAccess.ts lib/utils/levelAccess.test.ts
```

- [ ] **Step 4: Verificar que nada mais importa `levelAccess`**

Run: `npm run lint`
Expected: sem erros; nenhum import pendente de `levelAccess`.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm run test:run`
Expected: PASS (a suíte de `levelAccess` deixou de existir; demais verdes).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(aulas): remover pré-validação de nível e apagar levelAccess"
```

---

## Phase 4 — Esconder badges e seletores de nível

### Task 10: Remover seletor de nível dos formulários de turma

**Files:**
- Modify: `features/aulas/ClassForm.tsx`, `features/aulas/EditClassForm.tsx`, `features/aulas/class-form-actions.ts`

- [ ] **Step 1: `class-form-actions.ts` — nível vira default constante**

Em `ClassFormData` (linhas 9-19), remover o campo `level: StudentLevel`. Em `createClass`, trocar o insert (linha 31):

```tsx
    .insert({ ...data, is_active: true, organization_id: orgId })
```

por:

```tsx
    .insert({ ...data, level: 'iniciante', is_active: true, organization_id: orgId })
```

Isso satisfaz a coluna `classes.level` (dormente) sem seletor. Remover `StudentLevel` do import se ficar órfão (verificar `updateClass`, que usa `Partial<ClassFormData>` — não referencia `level` diretamente).

- [ ] **Step 2: `ClassForm.tsx` — remover o seletor de nível**

- Remover `const LEVELS: StudentLevel[] = [...]` (linha 10).
- Remover `level: fd.get('level') as StudentLevel,` do payload (linha 27).
- Remover `StudentLevel` do import de tipos (linha 8) se ficar órfão — manter `ClassType`.
- Substituir a grid de 2 colunas Nível/Tipo (linhas 51-65) por uma coluna só de Tipo:

```tsx
      <div>
        <label className="text-sm text-slate-400 block mb-1">Tipo</label>
        <select name="type" required className={SELECT_CLS}>
          <option value="adult">Adulto</option>
          <option value="kids">Kids</option>
        </select>
      </div>
```

- [ ] **Step 3: `EditClassForm.tsx` — remover o seletor de nível**

- Remover `const LEVELS` (linha 10) e `level: fd.get('level') as StudentLevel,` (linha 31).
- Remover `StudentLevel` do import (linha 8) se órfão.
- Substituir a grid Nível/Tipo (linhas 55-69) por apenas o Tipo:

```tsx
      <div>
        <label className="text-sm text-slate-400 block mb-1">Tipo</label>
        <select name="type" required className={SELECT_CLS} defaultValue={c.type}>
          <option value="adult">Adulto</option>
          <option value="kids">Kids</option>
        </select>
      </div>
```

- [ ] **Step 4: Verificar**

Run: `npm run lint`
Expected: sem erros; sem `LEVELS`/`StudentLevel` órfãos.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/ClassForm.tsx features/aulas/EditClassForm.tsx features/aulas/class-form-actions.ts
git commit -m "feat(aulas): remover seletor de nível; nível default dormente"
```

### Task 11: Remover badges de nível na UI

**Files:**
- Modify: `features/aulas/ClassCard.tsx:28`, `app/(dashboard)/perfil/page.tsx:198`, `app/(dashboard)/home/page.tsx:345,474,526`

- [ ] **Step 1: `ClassCard.tsx` — remover badge de nível (linha 28)**

Apagar:

```tsx
            <Badge variant="level">Nível {c.level.toUpperCase()}</Badge>
```

- [ ] **Step 2: `perfil/page.tsx` — remover StatCard de nível (linha 198)**

Apagar a linha:

```tsx
          <StatCard label="Nível" value={(profile?.level ?? '—').toUpperCase()} />
```

Ajustar o comentário linha 194 `{/* Stats: Créditos + Nível */}` → `{/* Stats: Créditos */}`. Se o grid ficar com uma coluna só, ajustar classes de layout se necessário (ex.: `grid-cols-2` → `grid-cols-1`).

- [ ] **Step 3: `home/page.tsx` — remover exibições de nível**

- Linha 345: remover a entrada `{ label: 'Nível', value: (membership?.level ?? '—').toUpperCase() },` do array de stats.
- Linha 474: remover `: <Badge variant="level">{cls.level.toUpperCase()}</Badge>` — reavaliar o ternário onde ela aparece; se era `cond ? <X/> : <Badge.../>`, manter só o ramo verdadeiro ou remover o badge sem quebrar o JSX (ler o contexto das linhas 470-478).
- Linha 526: remover `<Badge variant="level">Nível {tournament.level.toUpperCase()}</Badge>`.

- [ ] **Step 4: Verificar**

Run: `npm run lint`
Expected: sem erros de JSX; sem variável órfã.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/ClassCard.tsx "app/(dashboard)/perfil/page.tsx" "app/(dashboard)/home/page.tsx"
git commit -m "feat(ui): esconder badges de nível de turmas/perfil/home"
```

### Task 12: Remover seletor de nível na criação de torneio

**Files:**
- Modify: `app/(admin)/admin/torneios/CreateTournamentForm.tsx:45,106,172-176`

- [ ] **Step 1: Fixar nível como constante e remover UI**

- Linha 45: remover `const [level, setLevel] = useState<StudentLevel>('C')`.
- Linha 106: no payload, trocar `level,` por `level: 'iniciante',` (mantém a coluna preenchida).
- Linhas 172-176: remover o bloco do `<label>Nível</label>` + `<select>` inteiro.
- Remover `StudentLevel` do import se ficar órfão. Ajustar o placeholder da linha 136 `"Ex: Americano Nível C Junho"` → `"Ex: Americano de Sábado"`.

- [ ] **Step 2: Verificar**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/torneios/CreateTournamentForm.tsx"
git commit -m "feat(torneios): remover seletor de nível na criação"
```

---

## Phase 5 — Terminologia "Quadra" → "Espaço"

### Task 13: Trocar "Quadra" por "Espaço" em formulários e cards

**Files:**
- Modify: `features/aulas/ClassForm.tsx:74-78`, `features/aulas/EditClassForm.tsx:78-82`, `features/dayuse/CreateDayUseForm.tsx:42-45`, `features/dayuse/DayUseSlotCard.tsx:31`, `features/dayuse/DayUseBookingCard.tsx:68`, `app/(dashboard)/home/page.tsx:434`

- [ ] **Step 1: Formulários de turma**

Em `ClassForm.tsx` (74-78) e `EditClassForm.tsx` (78-82), trocar:

```tsx
          <label className="text-sm text-slate-400 block mb-1">Quadra</label>
          <select name="court" required className={SELECT_CLS}>
            <option value="1">Quadra 1</option>
            <option value="2">Quadra 2</option>
```

por (mantendo o `defaultValue={c.court}` no EditClassForm):

```tsx
          <label className="text-sm text-slate-400 block mb-1">Espaço</label>
          <select name="court" required className={SELECT_CLS}>
            <option value="1">Espaço 1</option>
            <option value="2">Espaço 2</option>
```

- [ ] **Step 2: Day use**

Em `CreateDayUseForm.tsx` (42-45): `Quadra` → `Espaço`, `Quadra 1/2` → `Espaço 1/2`.
Em `DayUseSlotCard.tsx:31` e `DayUseBookingCard.tsx:68`: `Quadra {slot.court}` → `Espaço {slot.court}`.
Em `home/page.tsx:434`: `Quadra {slot.court}` → `Espaço {slot.court}`.

- [ ] **Step 3: Verificar que não sobrou "Quadra" na UI**

Com Grep, buscar `Quadra` em `app/`, `features/`, `components/`.
Expected: nenhuma ocorrência de rótulo "Quadra" (placeholder "Rua das Quadras" é endereço — deixar).

- [ ] **Step 4: Commit**

```bash
git add features/aulas/ClassForm.tsx features/aulas/EditClassForm.tsx features/dayuse "app/(dashboard)/home/page.tsx"
git commit -m "refactor(ui): renomear 'Quadra' para 'Espaço'"
```

### Task 14: Ajustar frases com "quadra"/"areia"

**Files:**
- Modify: `app/arenas/[slug]/TrialBookingForm.tsx:51`, `app/(dashboard)/perfil/page.tsx:313`, `app/(dashboard)/agendar/page.tsx:264`, `app/(dashboard)/agendar/dayuse/page.tsx:94`

- [ ] **Step 1: Trocar as frases**

- `TrialBookingForm.tsx:51`: `Nos vemos na quadra!` → `Nos vemos por aí!`
- `perfil/page.tsx:313`: `Informações de saúde para uso em caso de emergência na quadra.` → `...em caso de emergência durante a aula.`
- `agendar/page.tsx:264`: `Reserve uma quadra avulsa →` → `Reserve um espaço avulso →`
- `agendar/dayuse/page.tsx:94`: `Reserva de quadra sem usar créditos` → `Reserva de espaço sem usar créditos`

- [ ] **Step 2: Verificar**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "app/arenas/[slug]/TrialBookingForm.tsx" "app/(dashboard)/perfil/page.tsx" "app/(dashboard)/agendar/page.tsx" "app/(dashboard)/agendar/dayuse/page.tsx"
git commit -m "refactor(copy): remover 'quadra'/'areia' de frases da UI"
```

---

## Phase 6 — Landing e metadados (marca ArenaHub mantida)

### Task 15: Generalizar copy da landing

**Files:**
- Modify: `app/page.tsx` (linhas 67, 74-75, 115-116, 126, 148, 194, 222, 379, 395-396, 407)

- [ ] **Step 1: Hero e eyebrow**

- Linha 67: `Plataforma para arenas de esporte de areia` → `Plataforma de gestão para academias e escolas esportivas`.
- Linhas 74-75: trocar `Sua arena lotada no automático...` por `Sua agenda cheia no automático e seus alunos felizes sem precisar te mandar mensagem.`

- [ ] **Step 2: Cards demo do hero (linhas 115-126)**

- Linha 115: `Beach Tennis · Avançado` → `Funcional · Turma da manhã`.
- Linha 116: `19:00 — 20:00 · Quadra 1` → `19:00 — 20:00 · Espaço 1`.
- Linha 126: `20:15 — 21:00 · Quadra 2` → `20:15 — 21:00 · Espaço 2`.

- [ ] **Step 3: Chips de modalidade (linha 148)**

Trocar o único chip `🎾 Beach Tennis` por uma variedade representando o público amplo, por exemplo:

```tsx
              <span className={s.chip}>🎾 Beach Tennis</span>
              <span className={s.chip}>🏋️ CrossFit</span>
              <span className={s.chip}>🧘 Pilates</span>
              <span className={s.chip}>⚽ Futebol</span>
```

(Se houver outros chips irmãos já listados nas linhas seguintes, integrar sem duplicar.)

- [ ] **Step 4: Textos de seções (linhas 194, 222, 407)**

- Linha 194: `Não é ERP genérico adaptado. É construído pra quem vive de quadra cheia.` → `...É construído pra quem vive de agenda cheia.`
- Linha 222: `...movimenta a quadra no fim de semana.` → `...movimenta a academia no fim de semana.`
- Linha 407: `...é só ver a quadra encher.` → `...é só ver a agenda encher.`

- [ ] **Step 5: FAQ (linhas 379, 395-396)**

- Linha 379: `Funciona pra outros esportes além de beach tennis?` → `Funciona pra qualquer modalidade?` e ajustar a resposta (próxima linha) para: `Sim. Beach tennis, padel, futevôlei, crossfit, pilates, funcional, futebol, luta e mais — qualquer academia ou escola que dá aulas e tem alunos.`
- Linhas 395-396: `Funciona sem internet boa na quadra?` → `Funciona sem internet boa no local?`; na resposta, `Mesmo com sinal fraco na areia` → `Mesmo com sinal fraco no local`.

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: build OK (a landing é estática/SSG).

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "refactor(landing): copy genérico multi-modalidade"
```

### Task 16: Metadados, LiveDemo e nome do plano

**Files:**
- Modify: `app/layout.tsx:15,25,37`, `app/_landing/LiveDemo.tsx:53-65`, `lib/billing/platformPlan.ts:7`

- [ ] **Step 1: `app/layout.tsx` — descrições**

Nas 3 ocorrências (linhas 15, 25, 37), trocar:

```
Aulas, turmas, créditos, check-in e pagamentos para arenas de beach tennis, padel, futevôlei e mais. 1º mês grátis.
```

por:

```
Aulas, turmas, créditos, check-in e pagamentos para academias, escolas esportivas e estúdios. 1º mês grátis.
```

- [ ] **Step 2: `LiveDemo.tsx` — cards demo (linhas 53-65)**

- Linha 53: `Beach Tennis · Nível B` → `Funcional · Turma A`.
- Linha 54: `Ter 19:00 — 20:00 · Quadra 1` → `Ter 19:00 — 20:00 · Espaço 1`.
- Linha 64: `Beach Tennis · Avançado` → `Pilates · Intermediário`.
- Linha 65: `Ter 19:00 · Quadra 1 · resta 1 vaga` → `Ter 19:00 · Espaço 1 · resta 1 vaga`.

- [ ] **Step 3: `platformPlan.ts` — nome do plano (linha 7)**

`reason: 'Assinatura Plataforma — Beach Tennis App',` → `reason: 'ArenaHub — Assinatura Plataforma',`.

- [ ] **Step 4: Verificar**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/_landing/LiveDemo.tsx lib/billing/platformPlan.ts
git commit -m "refactor(marca): metadados e LiveDemo genéricos; nome do plano"
```

---

## Verificação final

- [ ] **Rodar toda a suíte de testes**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Lint**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Build de produção**

Run: `npm run build`
Expected: build OK.

- [ ] **Checagem manual de resíduos**

Buscar por `beach`, `areia`, `Quadra` (rótulo), `variant="level"`, `canStudentAttendLevel`, `LEVEL_HIERARCHY` em `app/`, `features/`, `components/`, `lib/`.
Expected: só sobram usos legítimos (slug `beach_tennis` na lista de esportes; placeholder de endereço "Rua das Quadras"; coluna `level` no banco). Nenhum gating ou badge de nível.

- [ ] **Atualizar docs de FAQ (instrução permanente do projeto)**

Conforme `feedback-faq-sync`: revisar `docs/faq/aluno.md` (remover a menção a `canStudentAttendLevel` na linha ~115 e ao bloqueio por nível) e `docs/faq/academia.md` (modalidades ampliadas, "Espaço" no lugar de "Quadra"). Regravar prints se o fluxo visual mudou (`docs/faq/capture.mjs`).

- [ ] **Atualizar `CLAUDE.md`**

Remover/ajustar a linha da tabela que descreve `lib/utils/levelAccess.ts` (arquivo apagado) e a frase "iniciante < D < C < B < A" para refletir que o gating de nível foi removido.
```
