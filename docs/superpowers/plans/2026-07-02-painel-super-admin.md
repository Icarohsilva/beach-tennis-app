# Painel Super-Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o painel de plataforma (`/super-admin`) para o dono da ArenaHub ver e gerenciar todas as academias e suas assinaturas, e dar dente à suspensão (bloquear acesso de academia suspensa).

**Architecture:** Novo route group `app/(super-admin)/` gateado por uma flag global `profiles.is_platform_admin` (checada via `createAdminClient()`, service role, ground-truth). Server Actions em `features/super-admin/actions.ts` re-checam a flag (defesa em profundidade) e leem **cross-org** de propósito (único lugar onde isso é intencional). Suspensão passa a bloquear os layouts autenticados (aluno + admin) via um componente terminal reutilizável.

**Tech Stack:** Next.js 14 App Router (Server + Client Components), TypeScript, Supabase (Postgres + service role), Tailwind, Vitest.

**Convenções do projeto (obrigatórias):**
- Migrations são aplicadas **manualmente** pelo usuário no Supabase SQL Editor. NUNCA rodar `supabase db push`. Cada task de migration entrega o SQL e para; o usuário aplica.
- `createAdminClient()` ignora RLS. Em TODO o resto do app, queries com ele são escopadas por `organization_id`. **Exceção deliberada deste projeto:** `listOrganizations`/`getOrganizationDetail` são cross-org por design (é o ponto do painel de plataforma). Isso é seguro porque toda chamada é gateada por `is_platform_admin`.
- Nunca `git add -A`/`git add .` — sempre arquivos específicos.
- Padrão de retorno de actions: `{ error?: string }` (ou dados + `error?`).

---

## File Structure

**Novos arquivos:**
- `supabase/migrations/20260702120000_platform_admin.sql` — coluna `profiles.is_platform_admin`.
- `lib/superAdmin/filterOrgs.ts` — função pura de busca por nome (accent/case-insensitive) + tipo `OrgListRow`.
- `lib/superAdmin/filterOrgs.test.ts` — testes da função pura.
- `features/super-admin/actions.ts` — `requirePlatformAdmin`, `listOrganizations`, `getOrganizationDetail`, `suspendOrganization`, `reactivateOrganization`.
- `components/ui/SuspendedNotice.tsx` — tela terminal "Academia suspensa" (reutilizável nos 2 layouts).
- `app/(super-admin)/layout.tsx` — gate de acesso do painel de plataforma.
- `app/(super-admin)/super-admin/page.tsx` — lista (server) que chama `listOrganizations`.
- `app/(super-admin)/super-admin/OrgList.tsx` — lista + busca (client).
- `app/(super-admin)/super-admin/[id]/page.tsx` — detalhe (server).
- `app/(super-admin)/super-admin/[id]/SuspendToggle.tsx` — botão suspender/reativar (client).

**Arquivos modificados:**
- `types/index.ts` — `Profile.is_platform_admin: boolean`.
- `app/(dashboard)/layout.tsx` — bloqueio se `org.status === 'suspended'`.
- `app/(admin)/layout.tsx` — `status` no select + bloqueio se suspensa.

---

## Task 1: Migration + tipo — `profiles.is_platform_admin`

**Files:**
- Create: `supabase/migrations/20260702120000_platform_admin.sql`
- Modify: `types/index.ts:118-126` (interface `Profile`)

- [ ] **Step 1: Criar a migration**

Create `supabase/migrations/20260702120000_platform_admin.sql`:

```sql
-- Painel Super-Admin: flag de identidade GLOBAL de dono-da-plataforma.
-- Mora em profiles (1 por pessoa), não em memberships (por-academia). Não mexe
-- no enum user_role nem na RLS existente. Só é setada por SQL (service role).
alter table profiles
  add column if not exists is_platform_admin boolean not null default false;
```

- [ ] **Step 2: Adicionar o campo ao tipo `Profile`**

In `types/index.ts`, the `Profile` interface (lines 118-126) currently ends with `created_at: string`. Add the flag:

```typescript
// profiles = identidade compartilhada (1 por pessoa). Tudo que é por-academia mora
// em Membership. NÃO adicione campos por-academia aqui.
export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  phone: string | null
  gender: Gender | null
  city: string | null
  is_platform_admin: boolean
  created_at: string
}
```

- [ ] **Step 3: Verificar build de tipos**

Run: `npm run build`
Expected: build passa (sem erro de tipo). Se algum lugar construir um `Profile` literal sem `is_platform_admin`, o build acusa — corrija adicionando o campo lá.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260702120000_platform_admin.sql types/index.ts
git commit -m "feat(super-admin): coluna profiles.is_platform_admin + tipo"
```

- [ ] **Step 5: PARAR — o usuário aplica a migration + promove o super-admin base**

Entregar ao usuário este bloco para rodar no **Supabase SQL Editor** (nesta ordem):

```sql
-- 1) Cria a coluna
alter table profiles
  add column if not exists is_platform_admin boolean not null default false;

-- 2) Promove a conta base do dono da plataforma
update profiles set is_platform_admin = true
where id = (select id from auth.users where email = 'icaro.silva@eteg.com.br');
```

Não prosseguir para a próxima task de comportamento até confirmar que o usuário rodou o SQL (o painel exige a coluna existir). Tasks de código puro (2) podem prosseguir em paralelo.

---

## Task 2: Função pura de busca — `filterOrganizations` (TDD)

**Files:**
- Create: `lib/superAdmin/filterOrgs.ts`
- Test: `lib/superAdmin/filterOrgs.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `lib/superAdmin/filterOrgs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { filterOrganizations, type OrgListRow } from './filterOrgs'

function row(name: string): OrgListRow {
  return {
    id: name,
    name,
    city: null,
    state: null,
    owner_name: null,
    org_status: 'active',
    sub_status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('filterOrganizations', () => {
  it('retorna todas as linhas quando a busca está vazia', () => {
    const rows = [row('Hudson'), row('Arena X')]
    expect(filterOrganizations(rows, '')).toHaveLength(2)
    expect(filterOrganizations(rows, '   ')).toHaveLength(2)
  })

  it('filtra por nome ignorando maiúsculas/minúsculas', () => {
    const rows = [row('Hudson Barros'), row('Arena X')]
    const out = filterOrganizations(rows, 'hudson')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Hudson Barros')
  })

  it('filtra ignorando acentos (São → sao)', () => {
    const rows = [row('São Paulo BT'), row('Arena X')]
    const out = filterOrganizations(rows, 'sao')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('São Paulo BT')
  })

  it('retorna vazio quando nada casa', () => {
    const rows = [row('Hudson'), row('Arena X')]
    expect(filterOrganizations(rows, 'zzz')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npm run test:run -- lib/superAdmin/filterOrgs.test.ts`
Expected: FAIL — "Failed to resolve import './filterOrgs'".

- [ ] **Step 3: Implementar a função pura + tipo**

Create `lib/superAdmin/filterOrgs.ts`:

```typescript
// lib/superAdmin/filterOrgs.ts
// Linha da lista de academias do painel super-admin (serializável para o client).
export interface OrgListRow {
  id: string
  name: string
  city: string | null
  state: string | null
  owner_name: string | null
  org_status: 'active' | 'suspended'
  sub_status: string
  created_at: string
}

// Remove acentos e normaliza caixa para busca tolerante (nomes BR têm acento).
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Filtra academias por substring do nome, ignorando caixa e acentos.
export function filterOrganizations(rows: OrgListRow[], query: string): OrgListRow[] {
  const q = normalize(query)
  if (!q) return rows
  return rows.filter((r) => normalize(r.name).includes(q))
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `npm run test:run -- lib/superAdmin/filterOrgs.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/superAdmin/filterOrgs.ts lib/superAdmin/filterOrgs.test.ts
git commit -m "feat(super-admin): filterOrganizations (busca por nome, TDD)"
```

---

## Task 3: Componente terminal `SuspendedNotice`

**Files:**
- Create: `components/ui/SuspendedNotice.tsx`

- [ ] **Step 1: Criar o componente**

Create `components/ui/SuspendedNotice.tsx`. É um Server Component que renderiza o `LogoutButton` (client). Sem redirect, sem navegação — tela terminal.

```tsx
// components/ui/SuspendedNotice.tsx
import { LogoutButton } from './LogoutButton'

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'suporte@arenahub.website'

// Tela terminal exibida quando a academia do usuário está suspensa. Bloqueia o
// conteúdo autenticado (aluno e admin) sem redirect (evita loop). Reutilizada
// pelos layouts (dashboard) e (admin).
export function SuspendedNotice() {
  return (
    <div className="min-h-screen bg-surface text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-surface-border bg-surface-card p-6 text-center">
        <h1 className="text-xl font-bold">Academia suspensa</h1>
        <p className="text-sm text-slate-400">
          O acesso a esta academia está temporariamente suspenso. Para regularizar a
          situação, entre em contato com o suporte:{' '}
          <a className="text-brand-400 hover:text-brand-300" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <LogoutButton className="inline-flex items-center justify-center rounded-lg bg-surface-border px-4 py-2 text-sm font-semibold text-white hover:bg-surface-border/70">
          Sair
        </LogoutButton>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build passa (componente compila; ainda não é usado — sem regressão).

- [ ] **Step 3: Commit**

```bash
git add components/ui/SuspendedNotice.tsx
git commit -m "feat(super-admin): SuspendedNotice (tela terminal de academia suspensa)"
```

---

## Task 4: Bloqueio no layout do aluno `(dashboard)`

**Files:**
- Modify: `app/(dashboard)/layout.tsx:23` (após `getCurrentOrg()`)

`getCurrentOrg()` faz `select('*')`, então `org.status` já vem carregado — custo zero de query extra.

- [ ] **Step 1: Importar o componente**

In `app/(dashboard)/layout.tsx`, add to the imports (after line 9 `import { PoweredBy } ...`):

```tsx
import { SuspendedNotice } from '@/components/ui/SuspendedNotice'
```

- [ ] **Step 2: Adicionar o bloqueio após buscar a org**

In `app/(dashboard)/layout.tsx`, the block around line 23 is:

```tsx
  const org = await getCurrentOrg()
  const memberships = await getMemberships()
  const activeOrgId = await getActiveOrgId()
```

Change it to insert the suspension gate immediately after `getCurrentOrg()`:

```tsx
  const org = await getCurrentOrg()
  // Academia suspensa: bloqueia o acesso do aluno (tela terminal, sem navegação).
  if (org?.status === 'suspended') return <SuspendedNotice />
  const memberships = await getMemberships()
  const activeOrgId = await getActiveOrgId()
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "feat(super-admin): bloquear aluno de academia suspensa"
```

---

## Task 5: Bloqueio no layout do admin `(admin)`

**Files:**
- Modify: `app/(admin)/layout.tsx:37-42` (select da org) e após ele

- [ ] **Step 1: Importar o componente**

In `app/(admin)/layout.tsx`, add to imports (after line 13 `import { PoweredBy } ...`):

```tsx
import { SuspendedNotice } from '@/components/ui/SuspendedNotice'
```

- [ ] **Step 2: Adicionar `status` ao select existente e o gate**

In `app/(admin)/layout.tsx`, the current org fetch (lines 37-42) is:

```tsx
  const { data: org } = await adminClient
    .from('organizations')
    .select('owner_id, name, onboarding_completed, brand_color, logo_url')
    .eq('id', ctx.organizationId)
    .single()

  const isOwner = ctx.isOwner
```

Change it to add `status` to the select and gate immediately (suspensão tem precedência sobre onboarding/cobrança):

```tsx
  const { data: org } = await adminClient
    .from('organizations')
    .select('owner_id, name, onboarding_completed, brand_color, logo_url, status')
    .eq('id', ctx.organizationId)
    .single()

  // Academia suspensa: bloqueia o painel admin (precede gates de onboarding/cobrança).
  if (org?.status === 'suspended') return <SuspendedNotice />

  const isOwner = ctx.isOwner
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/layout.tsx"
git commit -m "feat(super-admin): bloquear admin de academia suspensa"
```

---

## Task 6: Server Actions — `features/super-admin/actions.ts`

**Files:**
- Create: `features/super-admin/actions.ts`

Todas as actions re-checam `is_platform_admin` (defesa em profundidade) e usam `createAdminClient()`. Leitura cross-org é intencional aqui.

- [ ] **Step 1: Criar o arquivo com o gate + as 4 actions**

Create `features/super-admin/actions.ts`:

```tsx
'use server'
// features/super-admin/actions.ts
// Painel de PLATAFORMA. Todas as actions re-checam is_platform_admin (defesa em
// profundidade — não confiam só no gate do layout) e usam service role. Leitura
// CROSS-ORG é intencional aqui (é o ponto do painel); seguro porque gateado.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { OrgListRow } from '@/lib/superAdmin/filterOrgs'

// Lê o usuário logado + is_platform_admin. Retorna { userId } ou { error }.
export async function requirePlatformAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) return { error: 'Acesso negado.' }
  return { userId: user.id }
}

// Lista todas as academias com dono (nome) + status da assinatura. Batch para
// evitar N+1 (nomes de donos e assinaturas resolvidos em 2 queries agregadas).
export async function listOrganizations(): Promise<{ rows?: OrgListRow[]; error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()

  const { data: orgsRaw } = await admin
    .from('organizations')
    .select('id, name, city, state, owner_id, status, created_at')
    .order('created_at', { ascending: false })
  const orgs = (orgsRaw ?? []) as Array<{
    id: string
    name: string
    city: string | null
    state: string | null
    owner_id: string | null
    status: 'active' | 'suspended'
    created_at: string
  }>

  const ownerIds = [...new Set(orgs.map((o) => o.owner_id).filter(Boolean))] as string[]
  const { data: owners } = ownerIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', ownerIds)
    : { data: [] }
  const ownerName = new Map(
    ((owners ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]),
  )

  const orgIds = orgs.map((o) => o.id)
  const { data: subs } = orgIds.length
    ? await admin.from('platform_subscriptions').select('organization_id, status').in('organization_id', orgIds)
    : { data: [] }
  const subStatus = new Map(
    ((subs ?? []) as Array<{ organization_id: string; status: string }>).map((s) => [
      s.organization_id,
      s.status,
    ]),
  )

  const rows: OrgListRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    city: o.city,
    state: o.state,
    owner_name: o.owner_id ? ownerName.get(o.owner_id) ?? null : null,
    org_status: o.status,
    sub_status: subStatus.get(o.id) ?? 'none',
    created_at: o.created_at,
  }))
  return { rows }
}

export interface OrgDetail {
  id: string
  name: string
  slug: string
  city: string | null
  state: string | null
  description: string | null
  status: 'active' | 'suspended'
  created_at: string
  owner_name: string | null
  owner_email: string | null
  sub_status: string
  trial_ends_at: string | null
  current_period_end: string | null
  students: number
  admins: number
  tournaments: number
}

// Detalhe de uma academia: dados + dono (nome + e-mail via auth.users) +
// assinatura + 3 contadores (count exact/head, escopados por organization_id).
export async function getOrganizationDetail(
  orgId: string,
): Promise<{ detail?: OrgDetail; error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()

  const { data: org } = await admin
    .from('organizations')
    .select('id, name, slug, city, state, description, status, created_at, owner_id')
    .eq('id', orgId)
    .single()
  if (!org) return { error: 'Academia não encontrada.' }

  let owner_name: string | null = null
  let owner_email: string | null = null
  if (org.owner_id) {
    const { data: prof } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', org.owner_id)
      .single()
    owner_name = prof?.full_name ?? null
    const { data: authUser } = await admin.auth.admin.getUserById(org.owner_id)
    owner_email = authUser?.user?.email ?? null
  }

  const { data: sub } = await admin
    .from('platform_subscriptions')
    .select('status, trial_ends_at, current_period_end')
    .eq('organization_id', orgId)
    .maybeSingle()

  const [studentsRes, adminsRes, tournamentsRes] = await Promise.all([
    admin
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('role', 'student'),
    admin
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('role', 'admin'),
    admin
      .from('tournaments')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId),
  ])

  return {
    detail: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      city: org.city,
      state: org.state,
      description: org.description,
      status: org.status,
      created_at: org.created_at,
      owner_name,
      owner_email,
      sub_status: sub?.status ?? 'none',
      trial_ends_at: sub?.trial_ends_at ?? null,
      current_period_end: sub?.current_period_end ?? null,
      students: studentsRes.count ?? 0,
      admins: adminsRes.count ?? 0,
      tournaments: tournamentsRes.count ?? 0,
    },
  }
}

export async function suspendOrganization(orgId: string): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ status: 'suspended' }).eq('id', orgId)
  if (error) return { error: 'Não foi possível suspender a academia.' }
  revalidatePath('/super-admin')
  revalidatePath(`/super-admin/${orgId}`)
  return {}
}

export async function reactivateOrganization(orgId: string): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ status: 'active' }).eq('id', orgId)
  if (error) return { error: 'Não foi possível reativar a academia.' }
  revalidatePath('/super-admin')
  revalidatePath(`/super-admin/${orgId}`)
  return {}
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build passa (tipos batem; actions ainda não referenciadas por páginas — sem regressão).

- [ ] **Step 3: Commit**

```bash
git add features/super-admin/actions.ts
git commit -m "feat(super-admin): actions (gate + list/detail/suspend/reactivate)"
```

---

## Task 7: Layout do route group `(super-admin)`

**Files:**
- Create: `app/(super-admin)/layout.tsx`

Gate: sem usuário → `/login`; sem `is_platform_admin` → `/home` (silencioso, não revela a rota). Não chama `getActiveOrgId()`/`getStaffContext()` (super-admin não é membro de academia).

- [ ] **Step 1: Criar o layout**

Create `app/(super-admin)/layout.tsx`:

```tsx
// app/(super-admin)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/ui/LogoutButton'

// Gate do painel de PLATAFORMA. Independe de academia ativa/membership. Papel
// verificado via service role (ground-truth, ignora RLS).
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) redirect('/home')

  return (
    <div className="min-h-screen bg-surface text-white">
      <header className="flex h-14 items-center justify-between border-b border-surface-border px-4">
        <span className="text-sm font-bold">ArenaHub · Plataforma</span>
        <LogoutButton className="text-sm font-semibold text-red-400 hover:text-red-300">
          Sair
        </LogoutButton>
      </header>
      <main className="mx-auto max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build passa. (O route group precisa de ao menos uma página para gerar rota; a página vem na Task 8. O build pode avisar que `(super-admin)` não tem página ainda — isso é resolvido na próxima task. Se o build falhar por falta de página, prossiga para a Task 8 e verifique o build lá.)

- [ ] **Step 3: Commit**

```bash
git add "app/(super-admin)/layout.tsx"
git commit -m "feat(super-admin): layout com gate is_platform_admin"
```

---

## Task 8: Página de lista + componente de busca

**Files:**
- Create: `app/(super-admin)/super-admin/page.tsx`
- Create: `app/(super-admin)/super-admin/OrgList.tsx`

- [ ] **Step 1: Criar o componente de lista (client)**

Create `app/(super-admin)/super-admin/OrgList.tsx`:

```tsx
'use client'
// app/(super-admin)/super-admin/OrgList.tsx
import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { filterOrganizations, type OrgListRow } from '@/lib/superAdmin/filterOrgs'

// Cor do badge por status da assinatura SaaS.
function subVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'past_due') return 'warning'
  if (status === 'canceled') return 'danger'
  return 'default' // trialing / none
}

export function OrgList({ rows }: { rows: OrgListRow[] }) {
  const [q, setQ] = useState('')
  const filtered = filterOrganizations(rows, q)
  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nome…"
        aria-label="Buscar academia por nome"
        className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <div className="overflow-hidden rounded-xl border border-surface-border">
        {filtered.map((r) => (
          <Link
            key={r.id}
            href={`/super-admin/${r.id}`}
            className="flex items-center gap-3 border-b border-surface-border px-3 py-3 last:border-b-0 hover:bg-surface-card"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{r.name}</p>
              <p className="truncate text-xs text-slate-500">
                {[r.city, r.state].filter(Boolean).join('/') || 'Sem localização'} ·{' '}
                {r.owner_name ?? 'Sem dono'}
              </p>
            </div>
            {r.org_status === 'suspended' && <Badge variant="danger">Suspensa</Badge>}
            <Badge variant={subVariant(r.sub_status)}>{r.sub_status}</Badge>
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            Nenhuma academia encontrada.
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar a página (server)**

Create `app/(super-admin)/super-admin/page.tsx`:

```tsx
// app/(super-admin)/super-admin/page.tsx
import { listOrganizations } from '@/features/super-admin/actions'
import { OrgList } from './OrgList'

export default async function SuperAdminHome() {
  const { rows, error } = await listOrganizations()
  if (error) return <p className="text-sm text-red-400">{error}</p>
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Academias</h1>
        <p className="text-sm text-slate-400">{rows?.length ?? 0} cadastradas</p>
      </div>
      <OrgList rows={rows ?? []} />
    </div>
  )
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa; a rota `/super-admin` aparece na listagem de rotas do Next.

- [ ] **Step 4: Commit**

```bash
git add "app/(super-admin)/super-admin/page.tsx" "app/(super-admin)/super-admin/OrgList.tsx"
git commit -m "feat(super-admin): página de lista de academias + busca"
```

---

## Task 9: Página de detalhe + botão suspender/reativar

**Files:**
- Create: `app/(super-admin)/super-admin/[id]/SuspendToggle.tsx`
- Create: `app/(super-admin)/super-admin/[id]/page.tsx`

- [ ] **Step 1: Criar o botão suspender/reativar (client)**

Create `app/(super-admin)/super-admin/[id]/SuspendToggle.tsx`:

```tsx
'use client'
// app/(super-admin)/super-admin/[id]/SuspendToggle.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { suspendOrganization, reactivateOrganization } from '@/features/super-admin/actions'

export function SuspendToggle({
  orgId,
  status,
}: {
  orgId: string
  status: 'active' | 'suspended'
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const suspended = status === 'suspended'

  function act() {
    setError(null)
    startTransition(async () => {
      const res = suspended
        ? await reactivateOrganization(orgId)
        : await suspendOrganization(orgId)
      if (res.error) setError(res.error)
      else {
        setConfirming(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-300">
            {suspended
              ? 'Reativar esta academia? Os usuários voltam a ter acesso.'
              : 'Suspender esta academia? Todos os usuários dela perdem acesso.'}
          </span>
          <Button size="sm" loading={isPending} onClick={act}>
            Confirmar
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant={suspended ? 'secondary' : 'danger'}
          onClick={() => setConfirming(true)}
        >
          {suspended ? 'Reativar academia' : 'Suspender academia'}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Confirmar as variantes do Button**

Run: `npm run test:run -- --silent 2>&1 | head -1` (opcional) — em vez disso, abra `components/ui/Button.tsx` e confirme que aceita `variant='secondary' | 'ghost' | 'danger'` e as props `size`, `loading`, `disabled`. Se `'danger'` não existir, use `variant='secondary'` no botão de suspender e mantenha o texto "Suspender academia". Ajuste antes de prosseguir.

- [ ] **Step 3: Criar a página de detalhe (server)**

Create `app/(super-admin)/super-admin/[id]/page.tsx`:

```tsx
// app/(super-admin)/super-admin/[id]/page.tsx
import Link from 'next/link'
import { getOrganizationDetail } from '@/features/super-admin/actions'
import { Badge } from '@/components/ui/Badge'
import { SuspendToggle } from './SuspendToggle'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

export default async function OrgDetailPage({ params }: { params: { id: string } }) {
  const { detail, error } = await getOrganizationDetail(params.id)
  if (error || !detail) {
    return <p className="text-sm text-red-400">{error ?? 'Academia não encontrada.'}</p>
  }

  return (
    <div className="space-y-5">
      <Link href="/super-admin" className="text-sm text-brand-400 hover:text-brand-300">
        ← Voltar
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{detail.name}</h1>
        <Badge variant={detail.status === 'suspended' ? 'danger' : 'success'}>
          {detail.status === 'suspended' ? 'Suspensa' : 'Ativa'}
        </Badge>
      </div>

      {/* Dados da academia */}
      <div className="space-y-1.5 rounded-xl border border-surface-border bg-surface-card p-4 text-sm">
        <p><span className="text-slate-500">Slug:</span> {detail.slug}</p>
        <p>
          <span className="text-slate-500">Local:</span>{' '}
          {[detail.city, detail.state].filter(Boolean).join('/') || '—'}
        </p>
        <p><span className="text-slate-500">Dono:</span> {detail.owner_name ?? '—'}</p>
        <p><span className="text-slate-500">E-mail:</span> {detail.owner_email ?? '—'}</p>
        <p><span className="text-slate-500">Descrição:</span> {detail.description ?? '—'}</p>
        <p><span className="text-slate-500">Criada em:</span> {fmtDate(detail.created_at)}</p>
      </div>

      {/* Assinatura SaaS */}
      <div className="space-y-1.5 rounded-xl border border-surface-border bg-surface-card p-4 text-sm">
        <h2 className="mb-1 font-bold">Assinatura</h2>
        <p><span className="text-slate-500">Status:</span> {detail.sub_status}</p>
        <p><span className="text-slate-500">Fim do trial:</span> {fmtDate(detail.trial_ends_at)}</p>
        <p>
          <span className="text-slate-500">Fim do período atual:</span>{' '}
          {fmtDate(detail.current_period_end)}
        </p>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-center">
          <p className="text-2xl font-bold">{detail.students}</p>
          <p className="text-xs text-slate-500">Alunos</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-center">
          <p className="text-2xl font-bold">{detail.admins}</p>
          <p className="text-xs text-slate-500">Professores/Admins</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-center">
          <p className="text-2xl font-bold">{detail.tournaments}</p>
          <p className="text-xs text-slate-500">Torneios</p>
        </div>
      </div>

      {/* Ação */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-4">
        <SuspendToggle orgId={detail.id} status={detail.status} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build passa; rota `/super-admin/[id]` aparece na listagem.

- [ ] **Step 5: Commit**

```bash
git add "app/(super-admin)/super-admin/[id]/page.tsx" "app/(super-admin)/super-admin/[id]/SuspendToggle.tsx"
git commit -m "feat(super-admin): detalhe da academia + suspender/reativar"
```

---

## Task 10: Verificação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar a suíte de testes completa**

Run: `npm run test:run`
Expected: PASS — todos os testes existentes + os 4 novos de `filterOrgs`. Zero regressões.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build limpo. Confirmar na listagem de rotas que aparecem `/super-admin` e `/super-admin/[id]`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 4: Roteiro manual de isolamento (o mais importante)**

Pré-requisito: o usuário já rodou o SQL da Task 1 (coluna + promoção de `icaro.silva@eteg.com.br`).

1. Logar como `icaro.silva@eteg.com.br` → acessar `/super-admin` → ver a lista de academias. Buscar por nome funciona.
2. Clicar numa academia → detalhe mostra dono (nome + e-mail), assinatura e os 3 contadores.
3. Clicar **Suspender academia** → confirmar. Badge vira "Suspensa".
4. Em outra sessão/navegador, logar como **aluno** dessa academia → deve ver a tela "Academia suspensa" (bloqueado). Logar como **admin** dessa academia → mesma tela.
5. Confirmar que aluno/admin de **outra** academia (não suspensa) seguem normais.
6. Voltar ao `/super-admin`, abrir a academia suspensa → **Reativar academia** → confirmar. Aluno e admin voltam a acessar.
7. Logar como um usuário comum (sem `is_platform_admin`) e tentar `/super-admin` → deve ser redirecionado para `/home` (rota não revelada).

- [ ] **Step 5: Deploy (só após o usuário aprovar)**

O deploy é `git push origin main` (Vercel auto-deploy). Confirmar com o usuário antes de fazer push.

---

## Self-Review (feito na escrita do plano)

**Cobertura da spec:**
- Modelo de dados (`is_platform_admin` + tipo) → Task 1. ✅
- Concessão manual do super-admin base → Task 1, Step 5 (SQL de promoção de `icaro.silva@eteg.com.br`). ✅
- Bloqueio de academia suspensa (dashboard + admin + componente DRY) → Tasks 3, 4, 5. ✅
- Route group + layout gate → Task 7. ✅
- Lista (nome, cidade/UF, dono nome, status org, status assinatura, busca client-side) → Task 8. ✅
- Detalhe (dados + dono nome+email, card assinatura, 3 contadores count/head, suspender/reativar) → Task 9. ✅
- Actions (requirePlatformAdmin, list, detail, suspend, reactivate, revalidatePath, defesa em profundidade) → Task 6. ✅
- Middleware sem alteração → confirmado na spec, nenhuma task o toca. ✅
- Verificação (build + test:run + roteiro manual) → Task 10. ✅

**Consistência de tipos:** `OrgListRow` definido na Task 2 e usado nas Tasks 6 e 8; `OrgDetail` definido na Task 6 e usado na Task 9; `SuspendToggle`/`OrgList` props batem com o que as páginas passam. ✅

**Sem placeholders:** todo passo de código tem o código completo. A única ramificação condicional (variante `'danger'` do Button na Task 9, Step 2) tem instrução explícita de fallback. ✅
