# Cadastro de Academia + Entrada de Alunos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um professor crie sua própria academia (self-service, vira dono/admin na hora), capte alunos só por link de convite, e crie contas de professores com acesso restrito (só Aulas + Alunos).

**Architecture:** Reaproveita a fundação multi-tenant do Plano 1 (RLS por `organization_id`, trigger `handle_new_user` que liga perfil→org via `org_invite_code`). Staff = `role='admin'`; o dono é marcado por `organizations.owner_id`; professor = admin que não é dono. Criação de academia/professor via Server Action com service role (`createAdminClient`). Gating das telas owner-only na aplicação.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (`@supabase/ssr`), Vitest, lib `qrcode`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260616010000_org_signup.sql` | Adiciona `owner_id` + `description` em `organizations`; backfill Hudson; bucket de logos |
| `types/index.ts` | `Organization` ganha `owner_id`, `description` |
| `lib/org/identifiers.ts` (+`.test.ts`) | `slugify`, `generateInviteCode`, geração com unicidade |
| `lib/org/permissions.ts` (+`.test.ts`) | `canAccessArea(area, isOwner)` puro |
| `lib/supabase/server.ts` | `getStaffContext()`, `requireOwner()` |
| `features/organizations/actions.ts` | `createAcademy`, `resolveInviteCode`, `createProfessor`, `removeProfessor` |
| `app/(auth)/criar-academia/page.tsx` | Form público de criação de academia |
| `app/(auth)/cadastro/page.tsx` | Lê `?convite`, resolve org, bloqueia sem código |
| `app/(auth)/login/page.tsx` | Link "É professor? Crie sua academia" |
| `app/(admin)/admin/equipe/page.tsx` | Owner-only: lista + cria + remove professor |
| `app/(admin)/admin/equipe/EquipeManager.tsx` | Client: form criar/remover professor |
| `app/(admin)/admin/equipe/InviteCard.tsx` | Client: link + copiar + QR code |
| `app/(admin)/layout.tsx` | Calcula `isOwner`, esconde menus owner-only |
| `app/(admin)/admin/financeiro/page.tsx` | `requireOwner()` no topo |
| `app/(admin)/admin/configuracoes/page.tsx` | `requireOwner()` no topo |

---

## Task 1: Migration — owner_id, description, backfill

**Files:**
- Create: `supabase/migrations/20260616010000_org_signup.sql`
- Modify: `types/index.ts` (interface `Organization`)

- [ ] **Step 1: Escrever a migration**

Create `supabase/migrations/20260616010000_org_signup.sql`:

```sql
-- Plano 2 — cadastro self-service de academia + entrada de alunos
-- Adiciona dono (owner_id) e descrição às organizations. O dono é o admin master:
-- pode gerir financeiro/configurações/equipe. Professores são admins SEM owner_id match.

alter table organizations add column if not exists owner_id uuid references profiles(id);
alter table organizations add column if not exists description text;

-- Backfill: define o dono da(s) academia(s) existente(s) como o admin mais antigo dela.
-- Idempotente: só preenche quando ainda está nulo.
update organizations o
set owner_id = (
  select p.id from profiles p
  where p.organization_id = o.id and p.role = 'admin'
  order by p.created_at asc
  limit 1
)
where o.owner_id is null;
```

> O bucket de logos (`org-logos`) é opcional e será criado no Dashboard do Supabase quando o upload de logo for implementado. Não bloqueia este plano (branding é opcional na criação).

- [ ] **Step 2: Atualizar o tipo Organization**

In `types/index.ts`, modifique a interface `Organization`:

```typescript
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
  created_at: string
}
```

- [ ] **Step 3: Verificar build de tipos**

Run: `npm run build`
Expected: compila sem erro de tipo (a migration é aplicada manualmente pelo usuário depois).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260616010000_org_signup.sql types/index.ts
git commit -m "feat: migration owner_id/description em organizations + tipo"
```

---

## Task 2: Helper de identificadores (slug + invite_code) — TDD

**Files:**
- Create: `lib/org/identifiers.ts`
- Test: `lib/org/identifiers.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Create `lib/org/identifiers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { slugify, generateInviteCode } from './identifiers'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Arena Beach Tennis')).toBe('arena-beach-tennis')
  })
  it('removes accents', () => {
    expect(slugify('Acadêmia São João')).toBe('academia-sao-joao')
  })
  it('strips special chars and collapses hyphens', () => {
    expect(slugify('  Quadra #1 -- Top!! ')).toBe('quadra-1-top')
  })
  it('returns empty string for only-symbols input', () => {
    expect(slugify('@#$%')).toBe('')
  })
})

describe('generateInviteCode', () => {
  it('returns 8 uppercase alphanumeric chars', () => {
    const code = generateInviteCode()
    expect(code).toMatch(/^[A-Z0-9]{8}$/)
  })
  it('returns different codes across calls (high probability)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInviteCode()))
    expect(codes.size).toBeGreaterThan(45)
  })
})
```

- [ ] **Step 2: Rodar os testes pra ver falhar**

Run: `npm run test:run -- lib/org/identifiers.test.ts`
Expected: FAIL — "Cannot find module './identifiers'".

- [ ] **Step 3: Implementar o helper**

Create `lib/org/identifiers.ts`:

```typescript
// lib/org/identifiers.ts
// Gera slug e invite_code para novas academias. As versões "*Unique" garantem
// unicidade contra o banco (a coluna é UNIQUE; isso evita colisão antes do insert).
import type { SupabaseClient } from '@supabase/supabase-js'

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '') // tira hífens das pontas
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateInviteCode(length = 8): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

async function slugTaken(db: SupabaseClient, slug: string): Promise<boolean> {
  const { data } = await db.from('organizations').select('id').eq('slug', slug).maybeSingle()
  return !!data
}

async function codeTaken(db: SupabaseClient, code: string): Promise<boolean> {
  const { data } = await db.from('organizations').select('id').eq('invite_code', code).maybeSingle()
  return !!data
}

// Slug único: usa o slugify; se tomado, adiciona sufixo aleatório curto.
export async function generateUniqueSlug(db: SupabaseClient, name: string): Promise<string> {
  const base = slugify(name) || 'academia'
  if (!(await slugTaken(db, base))) return base
  for (let i = 0; i < 10; i++) {
    const candidate = `${base}-${generateInviteCode(4).toLowerCase()}`
    if (!(await slugTaken(db, candidate))) return candidate
  }
  return `${base}-${Date.now()}`
}

// invite_code único: tenta gerar; em colisão (raríssima) tenta de novo.
export async function generateUniqueInviteCode(db: SupabaseClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode()
    if (!(await codeTaken(db, code))) return code
  }
  throw new Error('Não foi possível gerar um código de convite único.')
}
```

- [ ] **Step 4: Rodar os testes pra ver passar**

Run: `npm run test:run -- lib/org/identifiers.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/org/identifiers.ts lib/org/identifiers.test.ts
git commit -m "feat: helper de slug/invite_code com unicidade"
```

---

## Task 3: Permissões puras (canAccessArea) — TDD

**Files:**
- Create: `lib/org/permissions.ts`
- Test: `lib/org/permissions.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Create `lib/org/permissions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { canAccessArea } from './permissions'

describe('canAccessArea', () => {
  it('owner can access owner-only areas', () => {
    expect(canAccessArea('financeiro', true)).toBe(true)
    expect(canAccessArea('configuracoes', true)).toBe(true)
    expect(canAccessArea('equipe', true)).toBe(true)
  })
  it('professor cannot access owner-only areas', () => {
    expect(canAccessArea('financeiro', false)).toBe(false)
    expect(canAccessArea('configuracoes', false)).toBe(false)
    expect(canAccessArea('equipe', false)).toBe(false)
  })
  it('professor can access operational areas', () => {
    expect(canAccessArea('aulas', false)).toBe(true)
    expect(canAccessArea('alunos', false)).toBe(true)
    expect(canAccessArea('dashboard', false)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npm run test:run -- lib/org/permissions.test.ts`
Expected: FAIL — "Cannot find module './permissions'".

- [ ] **Step 3: Implementar**

Create `lib/org/permissions.ts`:

```typescript
// lib/org/permissions.ts
// Áreas do painel admin e regra de acesso por papel de staff.
// Dono (owner) acessa tudo; professor NÃO acessa financeiro/configurações/equipe.
export type AdminArea =
  | 'dashboard' | 'aulas' | 'alunos' | 'notificacoes' | 'torneios'
  | 'financeiro' | 'configuracoes' | 'equipe'

const OWNER_ONLY: AdminArea[] = ['financeiro', 'configuracoes', 'equipe']

export function canAccessArea(area: AdminArea, isOwner: boolean): boolean {
  return isOwner || !OWNER_ONLY.includes(area)
}
```

- [ ] **Step 4: Rodar pra ver passar**

Run: `npm run test:run -- lib/org/permissions.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/org/permissions.ts lib/org/permissions.test.ts
git commit -m "feat: regra pura de acesso por área (owner vs professor)"
```

---

## Task 4: Helpers de contexto de staff no servidor

**Files:**
- Modify: `lib/supabase/server.ts` (adicionar ao final)

- [ ] **Step 1: Adicionar getStaffContext e requireOwner**

Append to `lib/supabase/server.ts`:

```typescript
import { redirect } from 'next/navigation'

export interface StaffContext {
  userId: string
  organizationId: string
  isOwner: boolean
}

// Contexto de staff do admin logado. isOwner = é o dono (owner_id) da academia.
// Retorna null se não houver usuário ou perfil/org.
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id) return null

  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', profile.organization_id)
    .single()

  return {
    userId: user.id,
    organizationId: profile.organization_id,
    isOwner: org?.owner_id === user.id,
  }
}

// Guard para páginas owner-only. Redireciona professor para o dashboard.
export async function requireOwner(): Promise<StaffContext> {
  const ctx = await getStaffContext()
  if (!ctx) redirect('/login')
  if (!ctx.isOwner) redirect('/admin/dashboard')
  return ctx
}
```

> `redirect` precisa ser importado no topo do arquivo junto aos outros imports — mova o `import { redirect } from 'next/navigation'` para junto de `import { cookies } from 'next/headers'`.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/server.ts
git commit -m "feat: getStaffContext + requireOwner (gating owner)"
```

---

## Task 5: Server Actions — createAcademy + resolveInviteCode

**Files:**
- Create: `features/organizations/actions.ts`

- [ ] **Step 1: Implementar as actions**

Create `features/organizations/actions.ts`:

```typescript
'use server'
// features/organizations/actions.ts
import { createAdminClient } from '@/lib/supabase/server'
import { generateUniqueSlug, generateUniqueInviteCode } from '@/lib/org/identifiers'

export interface CreateAcademyInput {
  academyName: string
  fullName: string
  email: string
  password: string
  phone?: string
  description?: string
  brandColor?: string
}

export interface CreateAcademyResult {
  error?: string
  inviteCode?: string
}

// Cria a academia e o usuário dono (admin master), de forma quase-atômica.
// Abordagem A: tudo em TS via service role. Rollback da org se o usuário falhar.
export async function createAcademy(input: CreateAcademyInput): Promise<CreateAcademyResult> {
  const admin = createAdminClient()
  const name = input.academyName.trim()
  if (!name) return { error: 'Informe o nome da academia.' }
  if (!input.email.trim() || !input.password) return { error: 'Email e senha são obrigatórios.' }

  const slug = await generateUniqueSlug(admin, name)
  const inviteCode = await generateUniqueInviteCode(admin)

  // 1. Cria a organização (sem owner ainda).
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({
      name,
      slug,
      invite_code: inviteCode,
      status: 'active',
      is_default: false,
      description: input.description?.trim() || null,
      brand_color: input.brandColor?.trim() || null,
    })
    .select('id')
    .single()
  if (orgErr || !org) return { error: 'Não foi possível criar a academia. Tente outro nome.' }

  // 2. Cria o usuário no Auth. O trigger handle_new_user lê org_invite_code e
  // liga o perfil a esta org. email_confirm:true permite login imediato.
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || undefined,
      org_invite_code: inviteCode,
    },
  })

  if (userErr || !created?.user) {
    // Rollback: apaga a org órfã.
    await admin.from('organizations').delete().eq('id', org.id)
    const msg = userErr?.message?.toLowerCase().includes('already')
      ? 'Já existe uma conta com esse email.'
      : 'Não foi possível criar o usuário. Tente novamente.'
    return { error: msg }
  }

  // 3. Promove o perfil a admin e marca como dono da org.
  await admin.from('profiles').update({ role: 'admin' }).eq('id', created.user.id)
  await admin.from('organizations').update({ owner_id: created.user.id }).eq('id', org.id)

  return { inviteCode }
}

// Resolve um código de convite para o nome da academia (uso público no cadastro).
// Retorna só dados não-sensíveis (nome). null se inválido/inativo.
export async function resolveInviteCode(
  code: string,
): Promise<{ orgId: string; orgName: string } | null> {
  const c = code.trim().toUpperCase()
  if (!c) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('organizations')
    .select('id, name, status')
    .eq('invite_code', c)
    .maybeSingle()
  if (!data || data.status !== 'active') return null
  return { orgId: data.id, orgName: data.name }
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add features/organizations/actions.ts
git commit -m "feat: createAcademy + resolveInviteCode server actions"
```

---

## Task 6: Página pública /criar-academia

**Files:**
- Create: `app/(auth)/criar-academia/page.tsx`

- [ ] **Step 1: Implementar a página**

Create `app/(auth)/criar-academia/page.tsx`:

```tsx
// app/(auth)/criar-academia/page.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createAcademy } from '@/features/organizations/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function CriarAcademiaPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    academyName: '', fullName: '', email: '', password: '', phone: '',
    description: '', brandColor: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await createAcademy(form)
    if (res.error) {
      setError(res.error)
      setLoading(false)
      return
    }

    // Auto-login com as credenciais recém-criadas → vai pro painel admin.
    const supabase = createClient()
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    })
    if (signErr) {
      // Conta criada, mas auto-login falhou: manda pro login.
      router.push('/login')
      return
    }
    router.push('/admin/dashboard')
    router.refresh()
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Crie sua academia</h2>
      <p className="text-slate-400 text-sm mb-6">Comece a gerenciar suas aulas em minutos.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Nome da academia" value={form.academyName} onChange={set('academyName')} required />
        <Input label="Seu nome" value={form.fullName} onChange={set('fullName')} required />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
        <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
        <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />

        <details className="text-sm text-slate-300">
          <summary className="cursor-pointer text-slate-400 hover:text-white">Personalização (opcional)</summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="text-sm text-slate-300">
              Descrição
              <textarea
                value={form.description}
                onChange={set('description')}
                rows={2}
                className="mt-1 block w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              />
            </label>
            <label className="text-sm text-slate-300">
              Cor da marca
              <input
                type="color"
                value={form.brandColor || '#f97316'}
                onChange={set('brandColor')}
                className="mt-1 block h-9 w-16 bg-surface-card border border-surface-border rounded-lg"
              />
            </label>
          </div>
        </details>

        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Criar academia
        </Button>
      </form>
      <div className="mt-4 text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-brand-400">Já tem conta? Entrar</Link>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: rota `/criar-academia` aparece na lista de rotas, sem erro.

- [ ] **Step 3: Commit**

```bash
git add "app/(auth)/criar-academia/page.tsx"
git commit -m "feat: página pública de criação de academia"
```

---

## Task 7: Cadastro de aluno por convite + bloqueio

**Files:**
- Modify: `app/(auth)/cadastro/page.tsx`

- [ ] **Step 1: Reescrever o cadastro para exigir código de convite**

Replace the entire content of `app/(auth)/cadastro/page.tsx` with:

```tsx
// app/(auth)/cadastro/page.tsx
'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveInviteCode } from '@/features/organizations/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

function CadastroInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteCode = (searchParams.get('convite') ?? '').trim()

  const [resolving, setResolving] = useState(true)
  const [orgName, setOrgName] = useState<string | null>(null)

  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '' })
  const [partner, setPartner] = useState<'none' | 'wellhub' | 'totalpass'>('none')
  const [partnerId, setPartnerId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)

  // Resolve o código de convite → nome da academia. Sem código válido = bloqueia.
  useEffect(() => {
    let active = true
    if (!inviteCode) { setResolving(false); return }
    resolveInviteCode(inviteCode).then((res) => {
      if (!active) return
      setOrgName(res?.orgName ?? null)
      setResolving(false)
    })
    return () => { active = false }
  }, [inviteCode])

  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault()
    if (partner !== 'none' && !partnerId.trim()) {
      setError('Informe o ID do seu Gympass/TotalPass.')
      return
    }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const meta: Record<string, string> = { full_name: form.full_name, org_invite_code: inviteCode }
    if (form.phone.trim()) meta.phone = form.phone.trim()
    if (partner !== 'none') {
      meta.pending_partner = partner
      meta.partner_id = partnerId.trim()
    }
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: meta },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    if (data.session) {
      router.push('/home')
      router.refresh()
      return
    }
    setConfirmEmail(true)
    setLoading(false)
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  if (resolving) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <p className="text-slate-400 text-sm text-center py-6">Carregando...</p>
      </Card>
    )
  }

  // BLOQUEIO: sem código de convite válido não é possível cadastrar aluno.
  if (!orgName) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <div className="text-center py-4">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-lg font-semibold text-white mb-2">Convite necessário</h2>
          <p className="text-slate-400 text-sm mb-6">
            Para se cadastrar como aluno, use o <span className="text-brand-400">link de convite</span> da sua academia.
            Peça o link ao seu professor.
          </p>
          <Link href="/criar-academia" className="text-brand-400 text-sm hover:text-brand-300">
            É professor? Crie sua academia →
          </Link>
          <div className="mt-3">
            <Link href="/login" className="text-slate-500 text-sm hover:text-slate-300">Já tem conta? Entrar</Link>
          </div>
        </div>
      </Card>
    )
  }

  if (confirmEmail) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <div className="text-center py-4">
          <div className="text-4xl mb-4">📧</div>
          <h2 className="text-lg font-semibold text-white mb-2">Confirme seu email</h2>
          <p className="text-slate-400 text-sm mb-4">
            Enviamos um link de confirmação para <span className="text-brand-400">{form.email}</span>.
            Clique no link para ativar sua conta.
          </p>
          <p className="text-slate-500 text-xs mb-6">Não recebeu? Verifique sua pasta de spam.</p>
          <Link href="/login" className="text-brand-400 text-sm hover:text-brand-300">Ir para o login →</Link>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Criar conta</h2>
      <p className="text-slate-400 text-sm mb-6">
        Você está se cadastrando na <span className="text-brand-400">{orgName}</span>.
      </p>
      <form onSubmit={handleCadastro} className="flex flex-col gap-4">
        <Input label="Nome completo" value={form.full_name} onChange={set('full_name')} required />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
        <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
        <label className="text-sm text-slate-300">
          Você usa Gympass ou TotalPass?
          <select
            value={partner}
            onChange={(e) => setPartner(e.target.value as 'none' | 'wellhub' | 'totalpass')}
            className="mt-1 block w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="none">Não uso</option>
            <option value="wellhub">Gympass (Wellhub)</option>
            <option value="totalpass">TotalPass</option>
          </select>
        </label>
        {partner !== 'none' && (
          <Input label="ID do Gympass/TotalPass" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required />
        )}
        <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">Criar conta</Button>
      </form>
      <div className="mt-4 text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-brand-400">Já tem conta? Entrar</Link>
      </div>
    </Card>
  )
}

export default function CadastroPage() {
  return (
    <Suspense fallback={null}>
      <CadastroInner />
    </Suspense>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila (o `Suspense` evita o erro de `useSearchParams` sem boundary).

- [ ] **Step 3: Commit**

```bash
git add "app/(auth)/cadastro/page.tsx"
git commit -m "feat: cadastro de aluno exige link de convite (bloqueia sem código)"
```

---

## Task 8: Link "Crie sua academia" no login

**Files:**
- Modify: `app/(auth)/login/page.tsx`

- [ ] **Step 1: Encontrar o rodapé de links do login**

Run: `npm run test:run -- --version` (apenas garante ambiente) e abra `app/(auth)/login/page.tsx`. Procure o bloco final com `<Link href="/cadastro"` ou `href="/recuperar-senha"`.

- [ ] **Step 2: Adicionar o link**

No rodapé de links do `LoginPage` (logo após o link de cadastro existente), adicione:

```tsx
<div className="mt-2 text-center">
  <Link href="/criar-academia" className="text-sm text-brand-400 hover:text-brand-300">
    É professor? Crie sua academia
  </Link>
</div>
```

> `Link` já está importado em `login/page.tsx`. Se o link de cadastro já estiver dentro de um container centralizado, basta inserir esta linha junto.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)/login/page.tsx"
git commit -m "feat: link 'Crie sua academia' na tela de login"
```

---

## Task 9: Server Actions — createProfessor + removeProfessor

**Files:**
- Modify: `features/organizations/actions.ts`

- [ ] **Step 1: Adicionar as actions de equipe**

Append to `features/organizations/actions.ts`:

```typescript
import { getStaffContext } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface CreateProfessorInput {
  fullName: string
  email: string
  password: string
  phone?: string
}

// Cria um professor na academia do dono logado. Owner-only.
export async function createProfessor(input: CreateProfessorInput): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Apenas o dono pode adicionar professores.' }

  const admin = createAdminClient()
  // Busca o invite_code da academia para o trigger ligar o novo perfil à org.
  const { data: org } = await admin
    .from('organizations')
    .select('invite_code')
    .eq('id', ctx.organizationId)
    .single()
  if (!org) return { error: 'Academia não encontrada.' }

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || undefined,
      org_invite_code: org.invite_code,
    },
  })
  if (userErr || !created?.user) {
    const msg = userErr?.message?.toLowerCase().includes('already')
      ? 'Já existe uma conta com esse email.'
      : 'Não foi possível criar o professor.'
    return { error: msg }
  }

  // Promove a admin. owner_id continua o dono → o novo entra como professor.
  await admin.from('profiles').update({ role: 'admin' }).eq('id', created.user.id)
  revalidatePath('/admin/equipe')
  return {}
}

// Remove um professor da academia do dono. Owner-only. Não permite remover o dono.
export async function removeProfessor(profileId: string): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Apenas o dono pode remover professores.' }
  if (profileId === ctx.userId) return { error: 'O dono não pode se remover.' }

  const admin = createAdminClient()
  // Garante que o alvo pertence à mesma academia (evita remover de outra org).
  const { data: target } = await admin
    .from('profiles')
    .select('id, organization_id')
    .eq('id', profileId)
    .single()
  if (!target || target.organization_id !== ctx.organizationId) {
    return { error: 'Professor não encontrado nesta academia.' }
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(profileId)
  if (delErr) return { error: 'Não foi possível remover o professor.' }
  revalidatePath('/admin/equipe')
  return {}
}
```

> Os imports `getStaffContext` e `revalidatePath` devem ficar no topo do arquivo, junto aos imports já existentes (não no meio).

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add features/organizations/actions.ts
git commit -m "feat: createProfessor + removeProfessor (owner-only)"
```

---

## Task 10: Instalar qrcode + InviteCard

**Files:**
- Create: `app/(admin)/admin/equipe/InviteCard.tsx`
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Instalar a lib**

Run: `npm install qrcode && npm install -D @types/qrcode`
Expected: pacotes adicionados ao `package.json`.

- [ ] **Step 2: Implementar o InviteCard**

Create `app/(admin)/admin/equipe/InviteCard.tsx`:

```tsx
// app/(admin)/admin/equipe/InviteCard.tsx
'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function InviteCard({ inviteUrl }: { inviteUrl: string }) {
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    QRCode.toDataURL(inviteUrl, { width: 200, margin: 1 }).then(setQr).catch(() => setQr(''))
  }, [inviteUrl])

  async function copy() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <h2 className="text-white font-semibold mb-1">Convidar alunos</h2>
      <p className="text-slate-400 text-sm mb-4">
        Compartilhe este link (ou o QR code) para os alunos entrarem na sua academia.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="flex-1 w-full">
          <div className="bg-surface border border-surface-border rounded-xl px-3 py-2 text-sm text-slate-300 break-all">
            {inviteUrl}
          </div>
          <Button onClick={copy} size="sm" className="mt-3">
            {copied ? 'Copiado!' : 'Copiar link'}
          </Button>
        </div>
        {qr && (
          <img src={qr} alt="QR code de convite" className="rounded-xl border border-surface-border bg-white p-1" width={140} height={140} />
        )}
      </div>
    </Card>
  )
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila sem erro (o `InviteCard` ainda não é usado; será na Task 11).

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/admin/equipe/InviteCard.tsx package.json package-lock.json
git commit -m "feat: InviteCard (link + copiar + QR code) + dep qrcode"
```

---

## Task 11: Página /admin/equipe (owner-only) + EquipeManager

**Files:**
- Create: `app/(admin)/admin/equipe/EquipeManager.tsx`
- Create: `app/(admin)/admin/equipe/page.tsx`

- [ ] **Step 1: Implementar o EquipeManager (client)**

Create `app/(admin)/admin/equipe/EquipeManager.tsx`:

```tsx
// app/(admin)/admin/equipe/EquipeManager.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProfessor, removeProfessor } from '@/features/organizations/actions'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export interface ProfessorRow {
  id: string
  full_name: string
}

export function EquipeManager({ professors }: { professors: ProfessorRow[] }) {
  const router = useRouter()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await createProfessor(form)
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setForm({ fullName: '', email: '', password: '', phone: '' })
    router.refresh()
  }

  async function handleRemove(id: string) {
    if (!confirm('Remover este professor? A conta dele será excluída.')) return
    const res = await removeProfessor(id)
    if (res.error) { alert(res.error); return }
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-white font-semibold mb-4">Adicionar professor</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Input label="Nome" value={form.fullName} onChange={set('fullName')} required />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
          <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
          <Input label="Senha provisória" type="password" value={form.password} onChange={set('password')} required minLength={6} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} className="w-fit">Adicionar</Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-white font-semibold mb-4">Professores</h2>
        {professors.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum professor adicionado ainda.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {professors.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3">
                <span className="text-white text-sm">{p.full_name}</span>
                <button
                  onClick={() => handleRemove(p.id)}
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Implementar a página (server, owner-only)**

Create `app/(admin)/admin/equipe/page.tsx`:

```tsx
// app/(admin)/admin/equipe/page.tsx
import { createAdminClient, requireOwner } from '@/lib/supabase/server'
import { InviteCard } from './InviteCard'
import { EquipeManager, type ProfessorRow } from './EquipeManager'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const ctx = await requireOwner() // redireciona professor → dashboard

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('invite_code, owner_id')
    .eq('id', ctx.organizationId)
    .single()

  // Professores = admins da org que NÃO são o dono.
  const { data: staff } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('organization_id', ctx.organizationId)
    .eq('role', 'admin')
    .order('full_name', { ascending: true })

  const professors = ((staff ?? []) as ProfessorRow[]).filter((p) => p.id !== org?.owner_id)

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://beach-tennis-app-pi.vercel.app'
  const inviteUrl = `${baseUrl}/cadastro?convite=${org?.invite_code ?? ''}`

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Equipe</h1>
        <p className="text-slate-400 text-sm mt-1">Convide alunos e gerencie seus professores.</p>
      </div>
      <InviteCard inviteUrl={inviteUrl} />
      <EquipeManager professors={professors} />
    </div>
  )
}
```

> Se `NEXT_PUBLIC_SITE_URL` não existir no `.env`, o fallback usa o domínio de produção atual. Opcional: adicionar `NEXT_PUBLIC_SITE_URL` no `.env.local` e na Vercel.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: rota `/admin/equipe` aparece, sem erro.

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/admin/equipe/page.tsx app/(admin)/admin/equipe/EquipeManager.tsx
git commit -m "feat: página /admin/equipe (convite + gestão de professores)"
```

---

## Task 12: Gating no layout admin + guards owner-only

**Files:**
- Modify: `app/(admin)/layout.tsx`
- Modify: `app/(admin)/admin/financeiro/page.tsx`
- Modify: `app/(admin)/admin/configuracoes/page.tsx`

- [ ] **Step 1: Calcular isOwner e filtrar o menu no layout (via canAccessArea)**

In `app/(admin)/layout.tsx`, importe `canAccessArea` e `AdminArea`, remova a constante `navLinks` do topo do módulo (linhas 9-16) e construa o menu dentro do componente filtrando por `canAccessArea` (fonte única da regra owner-only).

Adicione ao import do topo:

```tsx
import { canAccessArea, type AdminArea } from '@/lib/org/permissions'
```

Dentro de `AdminLayout`, após obter `profile` e validar o role, calcule `isOwner` e o menu:

```tsx
  if (profile?.role !== 'admin') redirect('/home')

  const { data: profileOrg } = await adminClient
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  const { data: org } = profileOrg?.organization_id
    ? await adminClient
        .from('organizations')
        .select('owner_id')
        .eq('id', profileOrg.organization_id)
        .single()
    : { data: null }

  const isOwner = org?.owner_id === user.id

  // area = chave usada por canAccessArea pra decidir se professor vê o item.
  const allNav: { href: string; label: string; area: AdminArea }[] = [
    { href: '/admin/dashboard', label: 'Dashboard', area: 'dashboard' },
    { href: '/admin/alunos', label: 'Alunos', area: 'alunos' },
    { href: '/admin/grade', label: 'Grade de Aulas', area: 'aulas' },
    { href: '/admin/financeiro', label: 'Financeiro', area: 'financeiro' },
    { href: '/admin/notificacoes', label: 'Notificações', area: 'notificacoes' },
    { href: '/admin/torneios', label: 'Torneios', area: 'torneios' },
    { href: '/admin/configuracoes', label: 'Configurações', area: 'configuracoes' },
    { href: '/admin/equipe', label: 'Equipe', area: 'equipe' },
  ]
  const navLinks = allNav.filter((l) => canAccessArea(l.area, isOwner))
```

O resto do JSX que usa `navLinks` (sidebar e `AdminMobileNav`) permanece igual.

- [ ] **Step 2: Guard no Financeiro**

In `app/(admin)/admin/financeiro/page.tsx`, importe e chame `requireOwner` no início do componente. Modifique o import da linha 2 e o começo da função:

```tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
// ...
export default async function FinanceiroPage() {
  await requireOwner() // professor → redirecionado para /admin/dashboard
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  // ...resto inalterado
```

- [ ] **Step 3: Guard nas Configurações**

In `app/(admin)/admin/configuracoes/page.tsx`, mesma alteração:

```tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
// ...
export default async function ConfiguracoesPage() {
  await requireOwner()
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  // ...resto inalterado
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/layout.tsx" "app/(admin)/admin/financeiro/page.tsx" "app/(admin)/admin/configuracoes/page.tsx"
git commit -m "feat: gating owner-only (menu + guards financeiro/configurações)"
```

---

## Task 13: Verificação final

- [ ] **Step 1: Rodar testes unitários do projeto**

Run: `npx vitest run lib/ features/ app/`
Expected: testes passam (inclui os novos de `identifiers` e `permissions`). As falhas do projeto aninhado `octogent/` são esperadas e não relacionadas.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: todas as rotas compilam, incluindo `/criar-academia` e `/admin/equipe`.

- [ ] **Step 3: Aplicar a migration em produção**

O usuário aplica `supabase/migrations/20260616010000_org_signup.sql` via SQL Editor / Management API (padrão do projeto). Verificar: `select column_name from information_schema.columns where table_name='organizations' and column_name in ('owner_id','description')` retorna 2 linhas; `select count(*) from organizations where owner_id is null` retorna 0.

- [ ] **Step 4: Roteiro manual ponta a ponta (produção/preview)**

  1. `/criar-academia` → criar "Academia Demo" → cair logado em `/admin/dashboard` como dono.
  2. `/admin/equipe` → copiar o link de convite (+ QR aparece).
  3. Abrir o link `/cadastro?convite=CODIGO` em aba anônima → ver "Você está se cadastrando na Academia Demo" → cadastrar aluno → confirmar que ele entra na Demo (e não vê dados da Hudson/Arena Teste).
  4. `/cadastro` sem `?convite` → ver tela de bloqueio "Convite necessário".
  5. Como dono, criar um professor em `/admin/equipe` → logar como professor → confirmar: vê Dashboard/Alunos/Grade; **não** vê Financeiro/Configurações/Equipe no menu; acessar `/admin/financeiro` direto → redireciona pro dashboard.
  6. Logar como dono da Hudson → confirmar que tudo segue idêntico (owner_id backfillado; Financeiro/Configurações acessíveis).

- [ ] **Step 5: Commit final (se houver ajustes) + atualizar memória**

Atualizar `memory/project-status.md` marcando o Plano 2 como implementado e registrar quaisquer gotchas.

---

## Notas de implementação

- **Auto-confirm de email** está ativo em produção, então `createUser({ email_confirm: true })` e `signUp` retornam sessão imediata; o auto-login no `/criar-academia` funciona.
- **Trade-off de segurança (decidido):** professor é `role='admin'`, então a RLS permite leitura das tabelas financeiras via API direta. O gating é só na aplicação (v1). Hardening por RLS é follow-up.
- **`NEXT_PUBLIC_SITE_URL`**: usado para montar o link de convite. Sem ele, usa o domínio de produção como fallback.
- **Fallback Hudson no trigger** continua existindo (cadastro sem código cai na default), mas a UI bloqueia o caminho — defesa em profundidade, não regressão.
