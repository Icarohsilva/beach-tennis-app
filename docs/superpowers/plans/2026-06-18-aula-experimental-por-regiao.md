# Aula Experimental por Região — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public arena directory (`/arenas`) with city/sport filtering and a per-academy page (`/arenas/[slug]`) where a visitor books a free trial class — all data correctly scoped per `organization_id`.

**Architecture:** Server Components (`force-dynamic`) read via `createAdminClient()` (service role) with an **explicit** `organization_id` / `status` / `is_listed` filter on every query — the same pattern the current `/experimental` page uses, now fixed to not leak across academies. Pure logic (sport normalization, query-param parsing) lives in small, unit-tested helpers under `lib/arenas/`. The academy owner controls listing from `/admin/configuracoes`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase (`@supabase/ssr`), Vitest.

**Branch:** Work on `develop` (current branch). Do NOT merge to `main` — production auto-deploys from `main`; `develop` is the integration branch.

**Spec:** `docs/superpowers/specs/2026-06-18-aula-experimental-por-regiao-design.md`

---

## File Structure

**New files**
- `supabase/migrations/20260618000000_org_listing_fields.sql` — vitrine columns on `organizations`.
- `lib/arenas/sports.ts` — `SPORTS` constant, `SPORT_BY_SLUG` lookup, `normalizeSports()`. Pure.
- `lib/arenas/sports.test.ts` — unit tests for `normalizeSports`.
- `lib/arenas/filters.ts` — `buildDirectoryFilter()`. Pure (depends on `sports.ts`).
- `lib/arenas/filters.test.ts` — unit tests for `buildDirectoryFilter`.
- `lib/arenas/sessions.ts` — `getOpenTrialSessions(orgId)`, org-scoped session query.
- `app/arenas/page.tsx` — directory (Server Component).
- `app/arenas/ArenaFilters.tsx` — city/sport GET form (Server Component, plain HTML form).
- `app/arenas/[slug]/page.tsx` — per-academy page (Server Component).
- `app/arenas/[slug]/TrialBookingForm.tsx` — moved from `app/experimental/`, now takes `organizationId`.
- `app/arenas/[slug]/actions.ts` — `createTrialBooking`, moved and org-scoped.
- `app/(admin)/admin/configuracoes/VitrineForm.tsx` — owner form for listing fields.

**Modified files**
- `types/index.ts` — new fields on `Organization`.
- `features/financeiro/actions.ts` — add `updateOrgListing` server action. (Co-located with other admin/org settings actions; follows the `updateSystemSettings` pattern already there.)
- `app/(admin)/admin/configuracoes/page.tsx` — load org listing fields + render `VitrineForm`.
- `app/page.tsx` — landing CTA "Encontrar uma arena" → `/arenas`.
- `app/experimental/page.tsx` — becomes `redirect('/arenas')`.

**Deleted files**
- `app/experimental/actions.ts` — logic moved to `app/arenas/[slug]/actions.ts`.
- `app/experimental/TrialBookingForm.tsx` — moved to `app/arenas/[slug]/TrialBookingForm.tsx`.

---

## Task 1: Migration — vitrine columns + Organization type

**Files:**
- Create: `supabase/migrations/20260618000000_org_listing_fields.sql`
- Modify: `types/index.ts` (the `Organization` interface, currently lines 23-35)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618000000_org_listing_fields.sql`:

```sql
-- Aula Experimental por Região — campos de vitrine pública na organização.
-- Idempotente (add column if not exists), padrão do projeto. Sem backfill obrigatório:
-- is_listed = true por default (opt-in ligado), mas a org só aparece no diretório
-- quando city estiver preenchida (ver índice e regra de listagem na app).

alter table organizations add column if not exists is_listed     boolean not null default true;
alter table organizations add column if not exists state         text;
alter table organizations add column if not exists city          text;
alter table organizations add column if not exists neighborhood  text;
alter table organizations add column if not exists address_line  text;
alter table organizations add column if not exists sports        text[] not null default '{}';
alter table organizations add column if not exists whatsapp      text;

-- Índice parcial para o diretório público (filtra status/is_listed e ordena por cidade).
create index if not exists organizations_directory_idx
  on organizations (city)
  where status = 'active' and is_listed;
```

- [ ] **Step 2: Update the Organization type**

In `types/index.ts`, replace the `Organization` interface (currently lines 23-35) with:

```ts
export interface Organization {
  id: string
  name: string
  slug: string
  invite_code: string
  logo_url: string | null
  brand_color: string | null
  description: string | null
  status: OrganizationStatus
  is_default: boolean
  owner_id: string | null
  is_listed: boolean
  state: string | null
  city: string | null
  neighborhood: string | null
  address_line: string | null
  sports: string[]
  whatsapp: string | null
  created_at: string
}
```

- [ ] **Step 3: Verify the build typechecks**

Run: `npm run build`
Expected: build succeeds (no usages of the new fields yet, so this only confirms the type edit is valid TypeScript).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618000000_org_listing_fields.sql types/index.ts
git commit -m "feat(arenas): add vitrine columns to organizations + Organization type"
```

---

## Task 2: `lib/arenas/sports.ts` — sports constant + normalizer (TDD)

**Files:**
- Create: `lib/arenas/sports.ts`
- Test: `lib/arenas/sports.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/arenas/sports.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SPORTS, SPORT_BY_SLUG, normalizeSports } from './sports'

describe('SPORTS', () => {
  it('has unique slugs', () => {
    const slugs = SPORTS.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('SPORT_BY_SLUG resolves a known sport', () => {
    expect(SPORT_BY_SLUG.get('beach_tennis')?.label).toBe('Beach Tennis')
    expect(SPORT_BY_SLUG.get('inexistente')).toBeUndefined()
  })
})

describe('normalizeSports', () => {
  it('keeps valid slugs', () => {
    expect(normalizeSports(['beach_tennis', 'padel'])).toEqual(['beach_tennis', 'padel'])
  })

  it('drops invalid slugs', () => {
    expect(normalizeSports(['beach_tennis', 'xadrez'])).toEqual(['beach_tennis'])
  })

  it('deduplicates', () => {
    expect(normalizeSports(['padel', 'padel'])).toEqual(['padel'])
  })

  it('trims whitespace before validating', () => {
    expect(normalizeSports([' padel '])).toEqual(['padel'])
  })

  it('returns empty array for empty input', () => {
    expect(normalizeSports([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- lib/arenas/sports.test.ts`
Expected: FAIL — `Failed to resolve import './sports'` / module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/arenas/sports.ts`:

```ts
// lib/arenas/sports.ts
// Lista fixa de esportes usada no diretório /arenas e no formulário da vitrine.
// Não há tabela: esporte é só metadado (tag) da organização para busca.

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
]

export const SPORT_BY_SLUG = new Map<string, Sport>(SPORTS.map((s) => [s.slug, s]))

// Filtra a entrada do usuário contra a lista válida; remove duplicados e inválidos.
export function normalizeSports(input: string[]): string[] {
  const out: string[] = []
  for (const raw of input) {
    const slug = String(raw).trim()
    if (SPORT_BY_SLUG.has(slug) && !out.includes(slug)) {
      out.push(slug)
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- lib/arenas/sports.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add lib/arenas/sports.ts lib/arenas/sports.test.ts
git commit -m "feat(arenas): SPORTS constant + normalizeSports helper"
```

---

## Task 3: `lib/arenas/filters.ts` — directory query parser (TDD)

**Files:**
- Create: `lib/arenas/filters.ts`
- Test: `lib/arenas/filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/arenas/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDirectoryFilter } from './filters'

describe('buildDirectoryFilter', () => {
  it('returns empty filter with no params', () => {
    expect(buildDirectoryFilter({})).toEqual({})
  })

  it('keeps a trimmed city', () => {
    expect(buildDirectoryFilter({ cidade: 'São Paulo' })).toEqual({ city: 'São Paulo' })
  })

  it('ignores blank city', () => {
    expect(buildDirectoryFilter({ cidade: '   ' })).toEqual({})
  })

  it('keeps a valid sport', () => {
    expect(buildDirectoryFilter({ cidade: 'Recife', esporte: 'padel' })).toEqual({
      city: 'Recife',
      sport: 'padel',
    })
  })

  it('drops an invalid sport', () => {
    expect(buildDirectoryFilter({ esporte: 'xadrez' })).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- lib/arenas/filters.test.ts`
Expected: FAIL — `Failed to resolve import './filters'`.

- [ ] **Step 3: Write the implementation**

Create `lib/arenas/filters.ts`:

```ts
// lib/arenas/filters.ts
// Traduz os parâmetros da query string (?cidade=&esporte=) em critérios de filtro
// aplicados na consulta do diretório. Função pura, sem acesso a banco.

import { SPORT_BY_SLUG } from './sports'

export interface DirectoryQuery {
  cidade?: string
  esporte?: string
}

export interface DirectoryFilter {
  city?: string
  sport?: string
}

export function buildDirectoryFilter(q: DirectoryQuery): DirectoryFilter {
  const filter: DirectoryFilter = {}

  const city = q.cidade?.trim()
  if (city) filter.city = city

  const sport = q.esporte?.trim()
  if (sport && SPORT_BY_SLUG.has(sport)) filter.sport = sport

  return filter
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- lib/arenas/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/arenas/filters.ts lib/arenas/filters.test.ts
git commit -m "feat(arenas): buildDirectoryFilter query parser"
```

---

## Task 4: `lib/arenas/sessions.ts` — org-scoped trial session query

**Files:**
- Create: `lib/arenas/sessions.ts`

This extracts the session-listing logic currently inline in `app/experimental/page.tsx` and **scopes every query by `organization_id`** — the core fix for the cross-academy leak. No unit test (it hits Supabase); verified via build + manual roteiro.

- [ ] **Step 1: Write the implementation**

Create `lib/arenas/sessions.ts`:

```ts
// lib/arenas/sessions.ts
// Lista as sessões dos próximos 30 dias de UMA academia, abertas para aula
// experimental: status 'scheduled', turma ativa, adulto (type != 'kids'), com vaga.
// TODA query é escopada por organization_id (service role ignora RLS).

import { createAdminClient } from '@/lib/supabase/server'
import type { ClassSession, Class } from '@/types'

export interface TrialSessionOption {
  id: string
  session_date: string
  class_name: string
  start_time: string
  end_time: string
  level: string
  spots_left: number
}

export async function getOpenTrialSessions(orgId: string): Promise<TrialSessionOption[]> {
  const admin = createAdminClient()

  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: sessions } = await admin
    .from('class_sessions')
    .select(
      'id, session_date, status, class:classes(id, name, level, type, start_time, end_time, max_students, is_active)',
    )
    .eq('organization_id', orgId)
    .eq('status', 'scheduled')
    .gte('session_date', today)
    .lte('session_date', in30)
    .order('session_date', { ascending: true })
    .order('class(start_time)', { ascending: true })

  type RawSession = ClassSession & { class: Class | Class[] }
  const rawSessions = (sessions ?? []) as RawSession[]
  const sessionIds = rawSessions.map((s) => s.id)
  if (sessionIds.length === 0) return []

  const { data: bookingCountsRaw } = await admin
    .from('session_bookings')
    .select('session_id')
    .eq('organization_id', orgId)
    .in('session_id', sessionIds)
    .eq('status', 'confirmed')

  const bookingCountMap = new Map<string, number>()
  for (const b of (bookingCountsRaw ?? []) as { session_id: string }[]) {
    bookingCountMap.set(b.session_id, (bookingCountMap.get(b.session_id) ?? 0) + 1)
  }

  const { data: trialCountsRaw } = await admin
    .from('trial_bookings')
    .select('session_id')
    .eq('organization_id', orgId)
    .in('session_id', sessionIds)
    .in('status', ['pending', 'attended'])

  const trialCountMap = new Map<string, number>()
  for (const t of (trialCountsRaw ?? []) as { session_id: string }[]) {
    trialCountMap.set(t.session_id, (trialCountMap.get(t.session_id) ?? 0) + 1)
  }

  const options: TrialSessionOption[] = []
  for (const s of rawSessions) {
    const cls = Array.isArray(s.class) ? s.class[0] : s.class
    if (!cls || !cls.is_active || cls.type === 'kids') continue
    const occupied = (bookingCountMap.get(s.id) ?? 0) + (trialCountMap.get(s.id) ?? 0)
    const spotsLeft = cls.max_students - occupied
    if (spotsLeft <= 0) continue
    options.push({
      id: s.id,
      session_date: s.session_date,
      class_name: cls.name,
      start_time: cls.start_time,
      end_time: cls.end_time,
      level: cls.level,
      spots_left: spotsLeft,
    })
  }
  return options
}
```

- [ ] **Step 2: Verify the build typechecks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/arenas/sessions.ts
git commit -m "feat(arenas): getOpenTrialSessions org-scoped session query"
```

---

## Task 5: Booking action + form, org-scoped (move from /experimental)

**Files:**
- Create: `app/arenas/[slug]/actions.ts`
- Create: `app/arenas/[slug]/TrialBookingForm.tsx`
- Delete: `app/experimental/actions.ts`, `app/experimental/TrialBookingForm.tsx`

- [ ] **Step 1: Create the org-scoped action**

Create `app/arenas/[slug]/actions.ts`:

```ts
'use server'
// app/arenas/[slug]/actions.ts
// Agendamento de aula experimental, escopado por organization_id para isolar
// academias. Movido de app/experimental/actions.ts.

import { createAdminClient } from '@/lib/supabase/server'

export async function createTrialBooking(
  organizationId: string,
  sessionId: string,
  name: string,
  email: string,
  phone: string,
): Promise<{ error?: string; success?: boolean }> {
  if (!name.trim() || !email.trim() || !phone.trim()) {
    return { error: 'Preencha todos os campos.' }
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return { error: 'E-mail inválido.' }
  }

  const adminClient = createAdminClient()

  // Sessão precisa existir E pertencer a esta academia.
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, session_date, status, class:classes(id, name, max_students, type, is_active)')
    .eq('id', sessionId)
    .eq('organization_id', organizationId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta sessão não está disponível.' }

  const cls = Array.isArray(session.class) ? session.class[0] : session.class
  if (!cls?.is_active) return { error: 'Turma inativa.' }
  if (cls?.type === 'kids') return { error: 'Aula experimental disponível apenas para adultos.' }

  // Duplicidade por e-mail na sessão (dentro da org).
  const { count: dupCount } = await adminClient
    .from('trial_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .eq('email', email.trim().toLowerCase())
    .in('status', ['pending', 'attended'])

  if ((dupCount ?? 0) > 0) {
    return { error: 'Já existe um agendamento experimental com este e-mail para esta sessão.' }
  }

  // Capacidade (reservas confirmadas + trials) dentro da org.
  const { count: bookingsCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  const { count: trialsCount } = await adminClient
    .from('trial_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .in('status', ['pending', 'attended'])

  const occupied = (bookingsCount ?? 0) + (trialsCount ?? 0)
  if (occupied >= cls.max_students) {
    return { error: 'Esta sessão está lotada.' }
  }

  const { error: insertErr } = await adminClient.from('trial_bookings').insert({
    organization_id: organizationId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    session_id: sessionId,
    status: 'pending',
    must_pay_next: false,
  })

  if (insertErr) {
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }

  return { success: true }
}
```

- [ ] **Step 2: Create the form (with organizationId prop)**

Create `app/arenas/[slug]/TrialBookingForm.tsx`:

```tsx
'use client'
// app/arenas/[slug]/TrialBookingForm.tsx

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { createTrialBooking } from './actions'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type { TrialSessionOption } from '@/lib/arenas/sessions'

interface TrialBookingFormProps {
  organizationId: string
  sessions: TrialSessionOption[]
}

export function TrialBookingForm({ organizationId, sessions }: TrialBookingFormProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessions[0]?.id ?? '')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedSessionId) {
      setError('Selecione uma sessão.')
      return
    }

    startTransition(async () => {
      const result = await createTrialBooking(organizationId, selectedSessionId, name, email, phone)
      if (result.error) {
        setError(result.error)
        return
      }
      setSuccess(true)
    })
  }

  if (success) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="text-4xl">🎾</div>
        <h2 className="text-white font-bold text-lg">Agendamento confirmado!</h2>
        <p className="text-slate-400 text-sm">
          Enviamos as instruções para o seu e-mail. Nos vemos na quadra!
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Escolha uma sessão</label>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedSessionId(s.id)}
              className={[
                'w-full text-left px-4 py-3 rounded-xl border transition-colors',
                selectedSessionId === s.id
                  ? 'border-brand-500 bg-brand-500/10'
                  : 'border-surface-border bg-surface-card hover:border-slate-500',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-white text-sm font-medium">{s.class_name}</p>
                  <p className="text-slate-400 text-xs mt-0.5">
                    {formatDate(s.session_date)} · {formatTime(s.start_time)}–{formatTime(s.end_time)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="level">{s.level.toUpperCase()}</Badge>
                  <span className="text-xs text-slate-500">{s.spots_left} vagas</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Input
          label="Nome completo"
          placeholder="Seu nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="E-mail"
          type="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Telefone / WhatsApp"
          type="tel"
          placeholder="(11) 99999-9999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Button type="submit" variant="primary" size="lg" loading={isPending} className="w-full">
        Agendar aula gratuita
      </Button>

      <p className="text-xs text-slate-500 text-center">
        Ao agendar você concorda com os termos de uso. Primeira aula gratuita.
      </p>
    </form>
  )
}
```

- [ ] **Step 3: Delete the old /experimental action and form**

```bash
git rm app/experimental/actions.ts app/experimental/TrialBookingForm.tsx
```

(Note: `app/experimental/page.tsx` still imports these — the build will break until Task 8 rewrites it as a redirect. That is expected; Tasks 6–8 land together before the next full build gate. If you need a green build now, do Task 8 immediately after this step.)

- [ ] **Step 4: Commit**

```bash
git add app/arenas/[slug]/actions.ts app/arenas/[slug]/TrialBookingForm.tsx
git commit -m "feat(arenas): org-scoped trial booking action + form (moved from /experimental)"
```

---

## Task 6: `/arenas` directory page + filters

**Files:**
- Create: `app/arenas/page.tsx`
- Create: `app/arenas/ArenaFilters.tsx`

- [ ] **Step 1: Create the filter form**

Create `app/arenas/ArenaFilters.tsx`:

```tsx
// app/arenas/ArenaFilters.tsx
// Form GET puro (sem JS): submete cidade/esporte como query string e recarrega
// o diretório no servidor.

import { SPORTS } from '@/lib/arenas/sports'

interface ArenaFiltersProps {
  cities: string[]
  selectedCity?: string
  selectedSport?: string
}

export function ArenaFilters({ cities, selectedCity, selectedSport }: ArenaFiltersProps) {
  const selectClass =
    'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <form method="get" className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 mb-6">
      <select name="cidade" defaultValue={selectedCity ?? ''} className={selectClass}>
        <option value="">Todas as cidades</option>
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select name="esporte" defaultValue={selectedSport ?? ''} className={selectClass}>
        <option value="">Todos os esportes</option>
        {SPORTS.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.emoji} {s.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="rounded-lg bg-brand-500 text-surface font-semibold px-5 py-2 hover:bg-brand-400 transition-colors"
      >
        Filtrar
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Create the directory page**

Create `app/arenas/page.tsx`:

```tsx
// app/arenas/page.tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { buildDirectoryFilter } from '@/lib/arenas/filters'
import { SPORT_BY_SLUG } from '@/lib/arenas/sports'
import { ArenaFilters } from './ArenaFilters'

interface DirectoryArena {
  id: string
  name: string
  slug: string
  city: string | null
  neighborhood: string | null
  state: string | null
  sports: string[]
}

interface PageProps {
  searchParams: { cidade?: string; esporte?: string }
}

export default async function ArenasPage({ searchParams }: PageProps) {
  const admin = createAdminClient()
  const filter = buildDirectoryFilter(searchParams)

  let query = admin
    .from('organizations')
    .select('id, name, slug, city, neighborhood, state, sports')
    .eq('status', 'active')
    .eq('is_listed', true)
    .not('city', 'is', null)
    .order('city', { ascending: true })
    .order('name', { ascending: true })

  if (filter.city) query = query.eq('city', filter.city)
  if (filter.sport) query = query.contains('sports', [filter.sport])

  const { data } = await query
  const arenas = (data ?? []) as DirectoryArena[]

  // Lista de cidades para o seletor (todas as orgs listadas, independente do filtro atual).
  const { data: cityRows } = await admin
    .from('organizations')
    .select('city')
    .eq('status', 'active')
    .eq('is_listed', true)
    .not('city', 'is', null)
    .order('city', { ascending: true })

  const cities = Array.from(
    new Set((cityRows ?? []).map((r: { city: string }) => r.city)),
  )

  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Encontre uma arena</h1>
          <p className="text-slate-400 text-sm">
            Descubra arenas perto de você e agende uma aula experimental gratuita.
          </p>
        </div>

        <ArenaFilters
          cities={cities}
          selectedCity={filter.city}
          selectedSport={filter.sport}
        />

        {arenas.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-400">Nenhuma arena encontrada nessa região.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {arenas.map((a) => (
              <Link
                key={a.id}
                href={`/arenas/${a.slug}`}
                className="block rounded-xl border border-surface-border bg-surface-card p-5 hover:border-brand-500/60 transition-colors"
              >
                <h2 className="text-white font-bold text-lg">{a.name}</h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  {[a.neighborhood, a.city, a.state].filter(Boolean).join(' · ')}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {a.sports.map((slug) => {
                    const sport = SPORT_BY_SLUG.get(slug)
                    if (!sport) return null
                    return (
                      <span
                        key={slug}
                        className="text-xs text-slate-300 bg-surface-border rounded-full px-2.5 py-1"
                      >
                        {sport.emoji} {sport.label}
                      </span>
                    )
                  })}
                </div>
                <span className="inline-block mt-4 text-brand-500 text-sm font-semibold">
                  Ver horários →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/arenas/page.tsx app/arenas/ArenaFilters.tsx
git commit -m "feat(arenas): public directory page with city/sport filters"
```

---

## Task 7: `/arenas/[slug]` per-academy page

**Files:**
- Create: `app/arenas/[slug]/page.tsx`

- [ ] **Step 1: Create the per-academy page**

Create `app/arenas/[slug]/page.tsx`:

```tsx
// app/arenas/[slug]/page.tsx
export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getOpenTrialSessions } from '@/lib/arenas/sessions'
import { SPORT_BY_SLUG } from '@/lib/arenas/sports'
import { Card } from '@/components/ui/Card'
import { TrialBookingForm } from './TrialBookingForm'

interface ArenaRow {
  id: string
  name: string
  slug: string
  status: string
  is_listed: boolean
  city: string | null
  state: string | null
  neighborhood: string | null
  address_line: string | null
  sports: string[]
  whatsapp: string | null
}

interface PageProps {
  params: { slug: string }
}

export default async function ArenaPage({ params }: PageProps) {
  const admin = createAdminClient()

  const { data } = await admin
    .from('organizations')
    .select('id, name, slug, status, is_listed, city, state, neighborhood, address_line, sports, whatsapp')
    .eq('slug', params.slug)
    .single()

  const org = data as ArenaRow | null
  if (!org || org.status !== 'active' || !org.is_listed || !org.city) {
    notFound()
  }

  const sessions = await getOpenTrialSessions(org.id)
  const whatsappDigits = org.whatsapp?.replace(/\D/g, '') ?? ''

  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">{org.name}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {[org.address_line, org.neighborhood, org.city, org.state].filter(Boolean).join(' · ')}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {org.sports.map((slug) => {
              const sport = SPORT_BY_SLUG.get(slug)
              if (!sport) return null
              return (
                <span
                  key={slug}
                  className="text-xs text-slate-300 bg-surface-border rounded-full px-2.5 py-1"
                >
                  {sport.emoji} {sport.label}
                </span>
              )
            })}
          </div>
          {whatsappDigits && (
            <a
              href={`https://wa.me/${whatsappDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-4 text-sm text-emerald-400 font-medium"
            >
              💬 Falar no WhatsApp
            </a>
          )}
        </div>

        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white mb-1">Aula Experimental</h2>
          <p className="text-slate-400 text-sm">Gratuita na primeira vez. Sem precisar criar conta.</p>
        </div>

        <Card>
          {sessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm mb-2">
                Nenhuma sessão disponível nos próximos 30 dias.
              </p>
              <p className="text-slate-500 text-xs">Entre em contato para mais informações.</p>
            </div>
          ) : (
            <TrialBookingForm organizationId={org.id} sessions={sessions} />
          )}
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/arenas/[slug]/page.tsx
git commit -m "feat(arenas): per-academy page with trial booking"
```

---

## Task 8: Retire `/experimental` + point landing CTA to `/arenas`

**Files:**
- Modify: `app/experimental/page.tsx` (replace entire file)
- Modify: `app/page.tsx:160-166` (the "Encontrar uma arena" `Link`)

- [ ] **Step 1: Replace the /experimental page with a redirect**

Replace the entire contents of `app/experimental/page.tsx` with:

```tsx
// app/experimental/page.tsx
// Rota legada: a descoberta de aulas experimentais agora vive em /arenas (por região).
// Mantém links externos antigos funcionando.
import { redirect } from 'next/navigation'

export default function ExperimentalPage() {
  redirect('/arenas')
}
```

- [ ] **Step 2: Update the landing CTA**

In `app/page.tsx`, find the student-split CTA (currently around line 160):

```tsx
              <Link
                className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`}
                href="/experimental"
                style={{ marginTop: 18 }}
              >
                Encontrar uma arena
              </Link>
```

Change `href="/experimental"` to `href="/arenas"`:

```tsx
              <Link
                className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`}
                href="/arenas"
                style={{ marginTop: 18 }}
              >
                Encontrar uma arena
              </Link>
```

- [ ] **Step 3: Verify the build (full app now compiles)**

Run: `npm run build`
Expected: build succeeds — `app/experimental/page.tsx` no longer imports the deleted form/action; `/arenas` and `/arenas/[slug]` appear in the route list.

- [ ] **Step 4: Commit**

```bash
git add app/experimental/page.tsx app/page.tsx
git commit -m "feat(arenas): redirect /experimental to /arenas + update landing CTA"
```

---

## Task 9: Admin vitrine config (`/admin/configuracoes`)

**Files:**
- Create: `app/(admin)/admin/configuracoes/VitrineForm.tsx`
- Modify: `features/financeiro/actions.ts` (append `updateOrgListing`)
- Modify: `app/(admin)/admin/configuracoes/page.tsx`

- [ ] **Step 1: Add the `updateOrgListing` server action**

Append to `features/financeiro/actions.ts` (this file already imports `createClient` and `createAdminClient` at the top, and follows a pattern of dynamically importing `revalidatePath` inside each action via `const { revalidatePath } = await import('next/cache')` — match that). Add:

```ts
export async function updateOrgListing(input: {
  is_listed: boolean
  state: string
  city: string
  neighborhood: string
  address_line: string
  sports: string[]
  whatsapp: string
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Só o dono da academia edita a vitrine.
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'admin') return { error: 'Sem permissão.' }
  const orgId = (callerProfile as { organization_id: string }).organization_id

  const { data: org } = await adminClient
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .single()
  if ((org as { owner_id: string | null } | null)?.owner_id !== user.id) {
    return { error: 'Sem permissão.' }
  }

  const { error: updateErr } = await adminClient
    .from('organizations')
    .update({
      is_listed: input.is_listed,
      state: input.state.trim().toUpperCase() || null,
      city: input.city.trim() || null,
      neighborhood: input.neighborhood.trim() || null,
      address_line: input.address_line.trim() || null,
      sports: normalizeSports(input.sports),
      whatsapp: input.whatsapp.trim() || null,
    })
    .eq('id', orgId)

  if (updateErr) return { error: 'Erro ao salvar a vitrine.' }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/admin/configuracoes')
  revalidatePath('/arenas')
  return {}
}
```

At the top of `features/financeiro/actions.ts`, add this import alongside the existing imports (line 4-7):

```ts
import { normalizeSports } from '@/lib/arenas/sports'
```

- [ ] **Step 2: Create the VitrineForm**

Create `app/(admin)/admin/configuracoes/VitrineForm.tsx`:

```tsx
'use client'
// app/(admin)/admin/configuracoes/VitrineForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SPORTS } from '@/lib/arenas/sports'
import { updateOrgListing } from '@/features/financeiro/actions'

interface VitrineFormProps {
  listing: {
    is_listed: boolean
    state: string
    city: string
    neighborhood: string
    address_line: string
    sports: string[]
    whatsapp: string
  }
}

export function VitrineForm({ listing }: VitrineFormProps) {
  const [isListed, setIsListed] = useState(listing.is_listed)
  const [state, setState] = useState(listing.state)
  const [city, setCity] = useState(listing.city)
  const [neighborhood, setNeighborhood] = useState(listing.neighborhood)
  const [addressLine, setAddressLine] = useState(listing.address_line)
  const [sports, setSports] = useState<string[]>(listing.sports)
  const [whatsapp, setWhatsapp] = useState(listing.whatsapp)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggleSport(slug: string) {
    setSports((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await updateOrgListing({
        is_listed: isListed,
        state,
        city,
        neighborhood,
        address_line: addressLine,
        sports,
        whatsapp,
      })
      if (result.error) setError(result.error)
      else setSuccess('Vitrine salva com sucesso.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isListed}
            onChange={(e) => setIsListed(e.target.checked)}
            className="w-4 h-4 accent-brand-500"
          />
          <span className="text-sm text-slate-200 font-medium">
            Aparecer no diretório público de arenas
          </span>
        </label>

        {isListed && !city.trim() && (
          <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
            Preencha a cidade para a arena aparecer no diretório.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Estado (UF)" placeholder="SP" maxLength={2} value={state} onChange={(e) => setState(e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Cidade" placeholder="São Paulo" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>

        <Input label="Bairro" placeholder="Pinheiros" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
        <Input label="Endereço / referência" placeholder="Rua das Quadras, 123" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
        <Input label="WhatsApp" placeholder="(11) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />

        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Esportes oferecidos</label>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((sport) => {
              const active = sports.includes(sport.slug)
              return (
                <button
                  key={sport.slug}
                  type="button"
                  onClick={() => toggleSport(sport.slug)}
                  className={[
                    'text-sm rounded-full px-3 py-1.5 border transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-500/15 text-white'
                      : 'border-surface-border bg-surface-card text-slate-400 hover:border-slate-500',
                  ].join(' ')}
                >
                  {sport.emoji} {sport.label}
                </button>
              )
            })}
          </div>
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar vitrine
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 3: Wire the form into the config page**

Replace the entire contents of `app/(admin)/admin/configuracoes/page.tsx` with:

```tsx
// app/(admin)/configuracoes/page.tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { SystemSettingsForm } from './SystemSettingsForm'
import { VitrineForm } from './VitrineForm'

interface SystemSettings {
  credit_expiry_days: number
  cancellation_window_hours: number
}

export default async function ConfiguracoesPage() {
  await requireOwner()
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const { data: rows } = await adminClient
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)

  const map = new Map((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))

  const defaults: SystemSettings = {
    credit_expiry_days: Number(map.get('credit_expiry_days') ?? 30),
    cancellation_window_hours: Number(map.get('cancellation_window_hours') ?? 5),
  }

  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('is_listed, state, city, neighborhood, address_line, sports, whatsapp')
    .eq('id', orgId)
    .single()

  const org = (orgRow ?? {}) as {
    is_listed?: boolean
    state?: string | null
    city?: string | null
    neighborhood?: string | null
    address_line?: string | null
    sports?: string[] | null
    whatsapp?: string | null
  }

  const listing = {
    is_listed: org.is_listed ?? true,
    state: org.state ?? '',
    city: org.city ?? '',
    neighborhood: org.neighborhood ?? '',
    address_line: org.address_line ?? '',
    sports: org.sports ?? [],
    whatsapp: org.whatsapp ?? '',
  }

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
        <p className="text-slate-400 text-sm mt-1">Parâmetros globais do sistema</p>
      </div>
      <SystemSettingsForm settings={defaults} />

      <div>
        <h2 className="text-lg font-bold text-white">Vitrine pública</h2>
        <p className="text-slate-400 text-sm mt-1">
          Como sua arena aparece no diretório público para novos alunos.
        </p>
      </div>
      <VitrineForm listing={listing} />
    </div>
  )
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds; `/admin/configuracoes` still renders.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/configuracoes/VitrineForm.tsx" "app/(admin)/admin/configuracoes/page.tsx" features/financeiro/actions.ts
git commit -m "feat(arenas): vitrine config (listing fields) in admin settings"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: the beach-tennis-app suites pass, including the two new files (`lib/arenas/sports.test.ts`, `lib/arenas/filters.test.ts`). (Pre-existing unrelated failures in the nested `octogent/` project are not part of this app and can be ignored.)

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: success. Route list includes `/arenas` and `/arenas/[slug]`; `/experimental` is present (as a redirect).

- [ ] **Step 3: Brand/leak grep**

Run: `npm run lint`
Expected: no new lint errors in the files created/modified by this plan.

- [ ] **Step 4: Manual roteiro (requires the migration applied to a dev DB + `npm run dev`)**

Apply the migration first (via `supabase db push` or the SQL Editor — migrations are applied manually in this project), then:

1. As the owner of arena A: open `/admin/configuracoes`, enable "Aparecer no diretório", fill **city** + pick sports, save. → A appears at `/arenas`.
2. Filter `/arenas` by that city and by a sport → only matching arenas show.
3. Open `/arenas/<slug-A>` → shows **only** A's upcoming adult sessions with spots. Book a trial with name/email/phone → success message. Confirm the `trial_bookings` row has A's `organization_id` and does **not** appear for arena B.
4. Set arena A's `is_listed = false` (or clear its city) → A no longer appears at `/arenas`, and `/arenas/<slug-A>` returns 404.
5. Visit `/experimental` → redirects to `/arenas`.
6. Confirm the Academia Hudson Barros (org #1) app still works (login, grade, agendamento) after the migration.

- [ ] **Step 5: Push the branch**

```bash
git push origin develop
```

---

## Verification Summary

- **Unit tests:** `normalizeSports` and `buildDirectoryFilter` (pure logic).
- **Build:** typechecks the new pages, helpers, and the `Organization` type changes.
- **Manual isolation roteiro:** the critical check — a visitor on arena A never sees or books arena B's sessions, listing opt-out hides the arena, and the legacy `/experimental` redirects.
- **Regression:** org #1 (Hudson) keeps working after the migration.
