# Onboarding pós-cadastro com CEP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Após criar a academia, bloquear o painel até o dono preencher uma tela de endereço (CEP com auto-preenchimento via ViaCEP, número obrigatório ou "sem número") + vitrine + personalização.

**Architecture:** Nova rota `/onboarding` (fora do grupo `(admin)`, owner-only) renderiza uma página única. O `(admin)/layout.tsx` redireciona para lá enquanto `organizations.onboarding_completed = false`. Helpers puros de CEP/endereço em `lib/arenas/` (testáveis sem rede); o `fetch` ao ViaCEP roda no client. A action `completeOnboarding` grava tudo e marca `onboarding_completed = true`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (@supabase/ssr), Vitest, Tailwind. ViaCEP (`https://viacep.com.br/ws/{cep}/json/`).

**Spec:** `docs/superpowers/specs/2026-06-18-onboarding-cep-pos-cadastro-design.md`

**Branch:** `develop` (NUNCA `main` — produção). Migrations são aplicadas manualmente pelo usuário no SQL Editor; não rodar `supabase db push` aqui.

---

## File Structure

- `supabase/migrations/20260619000000_org_onboarding_fields.sql` — **criar**: colunas novas + backfill.
- `types/index.ts` — **modificar**: `Organization` ganha 4 campos.
- `lib/arenas/cep.ts` + `lib/arenas/cep.test.ts` — **criar**: helpers de CEP (puros) + fetch ViaCEP.
- `lib/arenas/formatAddress.ts` + `lib/arenas/formatAddress.test.ts` — **criar**: compõe endereço para exibição.
- `features/organizations/actions.ts` — **modificar**: nova `completeOnboarding`.
- `app/onboarding/page.tsx` + `app/onboarding/OnboardingForm.tsx` — **criar**: tela de onboarding.
- `app/(admin)/layout.tsx` — **modificar**: gate de redirect.
- `app/(auth)/criar-academia/page.tsx` — **modificar**: redirect → `/onboarding`, remover Personalização.
- `features/financeiro/actions.ts` — **modificar**: `updateOrgListing` aceita cep/address_number/no_number.
- `app/(admin)/admin/configuracoes/page.tsx` + `VitrineForm.tsx` — **modificar**: campos CEP/número.
- `app/arenas/[slug]/page.tsx` — **modificar**: exibir endereço via `formatAddress`.

---

## Task 1: Migration de colunas + tipo Organization

**Files:**
- Create: `supabase/migrations/20260619000000_org_onboarding_fields.sql`
- Modify: `types/index.ts:23-42`

- [ ] **Step 1: Escrever a migration**

Create `supabase/migrations/20260619000000_org_onboarding_fields.sql`:

```sql
-- Onboarding pós-cadastro: endereço (CEP/número) + flag de conclusão.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cep text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_number text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS no_number boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Backfill: orgs já existentes (Academia Hudson Barros / org #1 e orgs de teste)
-- não devem ser barradas pelo gate. Roda depois de criar a coluna (default false).
-- Orgs criadas a partir daqui nascem com onboarding_completed = false.
UPDATE organizations SET onboarding_completed = true;
```

- [ ] **Step 2: Atualizar o tipo Organization**

Em `types/index.ts`, dentro de `interface Organization`, adicionar os 4 campos logo após `whatsapp: string | null` (linha 40) e antes de `created_at`:

```ts
  whatsapp: string | null
  cep: string | null
  address_number: string | null
  no_number: boolean
  onboarding_completed: boolean
  created_at: string
```

- [ ] **Step 3: Verificar tipos compilam**

Run: `npm run build`
Expected: build passa (sem erro de tipo). Pode aparecer o warning pré-existente de `<img>` em `InviteCard.tsx` — ignorar.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619000000_org_onboarding_fields.sql types/index.ts
git commit -m "feat: colunas de onboarding/endereço em organizations + tipo"
```

---

## Task 2: Helpers de CEP (`lib/arenas/cep.ts`) — TDD

**Files:**
- Create: `lib/arenas/cep.ts`
- Test: `lib/arenas/cep.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Create `lib/arenas/cep.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatCep, isCompleteCep, mapViaCep } from './cep'

describe('formatCep', () => {
  it('aplica máscara 00000-000', () => {
    expect(formatCep('01001000')).toBe('01001-000')
  })
  it('não passa de 8 dígitos', () => {
    expect(formatCep('010010001234')).toBe('01001-000')
  })
  it('remove não-dígitos', () => {
    expect(formatCep('01001-000abc')).toBe('01001-000')
  })
  it('parcial não insere hífen antes de 6 dígitos', () => {
    expect(formatCep('0100')).toBe('0100')
  })
})

describe('isCompleteCep', () => {
  it('true com 8 dígitos', () => {
    expect(isCompleteCep('01001-000')).toBe(true)
  })
  it('false com menos de 8', () => {
    expect(isCompleteCep('0100100')).toBe(false)
  })
})

describe('mapViaCep', () => {
  it('mapeia uf/localidade/bairro/logradouro', () => {
    expect(
      mapViaCep({ uf: 'SP', localidade: 'São Paulo', bairro: 'Sé', logradouro: 'Praça da Sé' }),
    ).toEqual({ state: 'SP', city: 'São Paulo', neighborhood: 'Sé', addressLine: 'Praça da Sé' })
  })
  it('campos ausentes viram string vazia', () => {
    expect(mapViaCep({})).toEqual({ state: '', city: '', neighborhood: '', addressLine: '' })
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm run test:run -- lib/arenas/cep.test.ts`
Expected: FAIL — `Failed to resolve import "./cep"`.

- [ ] **Step 3: Implementar `cep.ts`**

Create `lib/arenas/cep.ts`:

```ts
// lib/arenas/cep.ts
// Helpers de CEP. As funções puras (formatCep/isCompleteCep/mapViaCep) são testadas
// sem rede. fetchAddressByCep faz o fetch ViaCEP no client (não é coberto por teste).

export function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export function isCompleteCep(raw: string): boolean {
  return raw.replace(/\D/g, '').length === 8
}

export interface ViaCepPayload {
  uf?: string
  localidade?: string
  bairro?: string
  logradouro?: string
  erro?: boolean
}

export interface MappedAddress {
  state: string
  city: string
  neighborhood: string
  addressLine: string
}

export function mapViaCep(payload: ViaCepPayload): MappedAddress {
  return {
    state: payload.uf ?? '',
    city: payload.localidade ?? '',
    neighborhood: payload.bairro ?? '',
    addressLine: payload.logradouro ?? '',
  }
}

// Busca endereço no ViaCEP. Retorna null se CEP inválido, não encontrado ou erro de rede.
export async function fetchAddressByCep(raw: string): Promise<MappedAddress | null> {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const payload = (await res.json()) as ViaCepPayload
    if (payload.erro) return null
    return mapViaCep(payload)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm run test:run -- lib/arenas/cep.test.ts`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
git add lib/arenas/cep.ts lib/arenas/cep.test.ts
git commit -m "feat: helpers de CEP (formatCep/isCompleteCep/mapViaCep/fetchAddressByCep)"
```

---

## Task 3: Helper `formatAddress` — TDD

**Files:**
- Create: `lib/arenas/formatAddress.ts`
- Test: `lib/arenas/formatAddress.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Create `lib/arenas/formatAddress.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatAddress } from './formatAddress'

describe('formatAddress', () => {
  it('rua + número', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: '123', no_number: false })).toBe('Rua X, 123')
  })
  it('sem número → s/n', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: null, no_number: true })).toBe('Rua X, s/n')
  })
  it('sem número e sem flag → só a rua', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: '', no_number: false })).toBe('Rua X')
  })
  it('sem rua → string vazia', () => {
    expect(formatAddress({ address_line: null, address_number: '123', no_number: false })).toBe('')
  })
  it('no_number tem prioridade sobre número preenchido', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: '123', no_number: true })).toBe('Rua X, s/n')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm run test:run -- lib/arenas/formatAddress.test.ts`
Expected: FAIL — `Failed to resolve import "./formatAddress"`.

- [ ] **Step 3: Implementar `formatAddress.ts`**

Create `lib/arenas/formatAddress.ts`:

```ts
// lib/arenas/formatAddress.ts
// Compõe a linha de endereço (logradouro + número) para exibição pública.

export function formatAddress(input: {
  address_line: string | null
  address_number: string | null
  no_number: boolean
}): string {
  const line = (input.address_line ?? '').trim()
  if (!line) return ''
  if (input.no_number) return `${line}, s/n`
  const num = (input.address_number ?? '').trim()
  return num ? `${line}, ${num}` : line
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm run test:run -- lib/arenas/formatAddress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/arenas/formatAddress.ts lib/arenas/formatAddress.test.ts
git commit -m "feat: helper formatAddress (logradouro + número / s/n)"
```

---

## Task 4: Action `completeOnboarding`

**Files:**
- Modify: `features/organizations/actions.ts:1-5` (imports) e final do arquivo.

- [ ] **Step 1: Adicionar import de `normalizeSports`**

Em `features/organizations/actions.ts`, logo após a linha `import { generateUniqueSlug, generateUniqueInviteCode } from '@/lib/org/identifiers'` (linha 5), adicionar:

```ts
import { normalizeSports } from '@/lib/arenas/sports'
```

- [ ] **Step 2: Adicionar a action no final do arquivo**

Anexar ao fim de `features/organizations/actions.ts`:

```ts
// ---------------------------------------------------------------------------
// completeOnboarding (owner only) — tela obrigatória pós-cadastro.
// Grava endereço + vitrine + personalização e marca onboarding_completed.
// ---------------------------------------------------------------------------

export interface CompleteOnboardingInput {
  cep: string
  state: string
  city: string
  neighborhood: string
  address_line: string
  address_number: string
  no_number: boolean
  sports: string[]
  whatsapp: string
  is_listed: boolean
  description: string
  brand_color: string
}

export async function completeOnboarding(
  input: CompleteOnboardingInput,
): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Apenas o dono pode concluir o cadastro da academia.' }

  if (!input.cep.trim()) return { error: 'Informe o CEP.' }
  if (!input.city.trim()) return { error: 'Informe a cidade.' }
  if (!input.no_number && !input.address_number.trim()) {
    return { error: 'Informe o número ou marque "Sem número".' }
  }

  const admin = createAdminClient()
  const { error: updErr } = await admin
    .from('organizations')
    .update({
      cep: input.cep.trim() || null,
      state: input.state.trim().toUpperCase() || null,
      city: input.city.trim() || null,
      neighborhood: input.neighborhood.trim() || null,
      address_line: input.address_line.trim() || null,
      address_number: input.no_number ? null : input.address_number.trim() || null,
      no_number: input.no_number,
      sports: normalizeSports(input.sports),
      whatsapp: input.whatsapp.trim() || null,
      is_listed: input.is_listed,
      description: input.description.trim() || null,
      brand_color: input.brand_color.trim() || null,
      onboarding_completed: true,
    })
    .eq('id', ctx.organizationId)
  if (updErr) return { error: 'Erro ao salvar. Tente novamente.' }

  revalidatePath('/arenas')
  revalidatePath('/admin/configuracoes')
  return {}
}
```

> Nota: `getStaffContext` e `createAdminClient` já estão importados no topo do arquivo (linha 4), e `revalidatePath` já é importado estaticamente no topo (linha 3 — `import { revalidatePath } from 'next/cache'`). Use-o diretamente, como acima; não criar import dinâmico.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 4: Commit**

```bash
git add features/organizations/actions.ts
git commit -m "feat: action completeOnboarding (owner-only, valida número/sem-número)"
```

---

## Task 5: Tela `/onboarding` (page + form)

**Files:**
- Create: `app/onboarding/page.tsx`
- Create: `app/onboarding/OnboardingForm.tsx`

- [ ] **Step 1: Criar a page (Server Component)**

Create `app/onboarding/page.tsx`:

```tsx
// app/onboarding/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireOwner, getCurrentOrg } from '@/lib/supabase/server'
import { OnboardingForm } from './OnboardingForm'

export default async function OnboardingPage() {
  await requireOwner() // não-autenticado → /login; professor → /admin/dashboard
  const org = await getCurrentOrg()
  if (!org) redirect('/login')
  if (org.onboarding_completed) redirect('/admin/dashboard')

  return (
    <div className="min-h-screen bg-surface text-white flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <OnboardingForm
          initial={{
            cep: org.cep ?? '',
            state: org.state ?? '',
            city: org.city ?? '',
            neighborhood: org.neighborhood ?? '',
            address_line: org.address_line ?? '',
            address_number: org.address_number ?? '',
            no_number: org.no_number ?? false,
            sports: org.sports ?? [],
            whatsapp: org.whatsapp ?? '',
            is_listed: org.is_listed ?? true,
            description: org.description ?? '',
            brand_color: org.brand_color ?? '',
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar o form (Client Component)**

Create `app/onboarding/OnboardingForm.tsx`:

```tsx
'use client'
// app/onboarding/OnboardingForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SPORTS } from '@/lib/arenas/sports'
import { formatCep, isCompleteCep, fetchAddressByCep } from '@/lib/arenas/cep'
import { completeOnboarding } from '@/features/organizations/actions'

interface OnboardingInitial {
  cep: string
  state: string
  city: string
  neighborhood: string
  address_line: string
  address_number: string
  no_number: boolean
  sports: string[]
  whatsapp: string
  is_listed: boolean
  description: string
  brand_color: string
}

export function OnboardingForm({ initial }: { initial: OnboardingInitial }) {
  const router = useRouter()
  const [cep, setCep] = useState(initial.cep)
  const [state, setState] = useState(initial.state)
  const [city, setCity] = useState(initial.city)
  const [neighborhood, setNeighborhood] = useState(initial.neighborhood)
  const [addressLine, setAddressLine] = useState(initial.address_line)
  const [addressNumber, setAddressNumber] = useState(initial.address_number)
  const [noNumber, setNoNumber] = useState(initial.no_number)
  const [sports, setSports] = useState<string[]>(initial.sports)
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp)
  const [isListed, setIsListed] = useState(initial.is_listed)
  const [description, setDescription] = useState(initial.description)
  const [brandColor, setBrandColor] = useState(initial.brand_color)

  const [cepStatus, setCepStatus] = useState<'idle' | 'loading' | 'notfound'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggleSport(slug: string) {
    setSports((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]))
  }

  async function handleCepChange(raw: string) {
    const masked = formatCep(raw)
    setCep(masked)
    setCepStatus('idle')
    if (isCompleteCep(masked)) {
      setCepStatus('loading')
      const addr = await fetchAddressByCep(masked)
      if (addr) {
        setState(addr.state)
        setCity(addr.city)
        setNeighborhood(addr.neighborhood)
        setAddressLine(addr.addressLine)
        setCepStatus('idle')
      } else {
        setCepStatus('notfound')
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await completeOnboarding({
        cep,
        state,
        city,
        neighborhood,
        address_line: addressLine,
        address_number: addressNumber,
        no_number: noNumber,
        sports,
        whatsapp,
        is_listed: isListed,
        description,
        brand_color: brandColor,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push('/admin/dashboard')
      router.refresh()
    })
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h1 className="text-lg font-semibold text-white mb-1">Onde fica sua academia?</h1>
      <p className="text-slate-400 text-sm mb-6">
        Preencha o endereço para sua arena aparecer no diretório e receber alunos.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div>
          <Input
            label="CEP"
            placeholder="00000-000"
            value={cep}
            onChange={(e) => handleCepChange(e.target.value)}
            inputMode="numeric"
          />
          {cepStatus === 'loading' && <p className="text-xs text-slate-400 mt-1">Buscando endereço…</p>}
          {cepStatus === 'notfound' && (
            <p className="text-xs text-yellow-400 mt-1">CEP não encontrado — preencha manualmente.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Estado (UF)" placeholder="SP" maxLength={2} value={state} onChange={(e) => setState(e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Cidade" placeholder="São Paulo" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>

        <Input label="Bairro" placeholder="Pinheiros" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
        <Input label="Rua / logradouro" placeholder="Rua das Quadras" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />

        {!noNumber && (
          <Input
            label="Número"
            placeholder="123"
            value={addressNumber}
            onChange={(e) => setAddressNumber(e.target.value)}
          />
        )}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={noNumber}
            onChange={(e) => setNoNumber(e.target.checked)}
            className="w-4 h-4 accent-brand-500"
          />
          <span className="text-sm text-slate-200">Sem número</span>
        </label>

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

        <Input label="WhatsApp" placeholder="(11) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isListed}
            onChange={(e) => setIsListed(e.target.checked)}
            className="w-4 h-4 accent-brand-500"
          />
          <span className="text-sm text-slate-200">Aparecer no diretório público de arenas</span>
        </label>

        <div className="border-t border-surface-border pt-4 mt-1">
          <h2 className="text-sm font-semibold text-white mb-3">Personalização (opcional)</h2>
          <div className="flex flex-col gap-3">
            <label className="text-sm text-slate-300">
              Descrição
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="mt-1 block w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              />
            </label>
            <label className="text-sm text-slate-300">
              Cor da marca
              <input
                type="color"
                value={brandColor || '#f97316'}
                onChange={(e) => setBrandColor(e.target.value)}
                className="mt-1 block h-9 w-16 bg-surface-card border border-surface-border rounded-lg"
              />
            </label>
          </div>
        </div>

        <Button type="submit" loading={pending} size="lg" className="w-full">
          Concluir e ir para o painel
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa; rota `/onboarding` aparece na listagem.

- [ ] **Step 4: Commit**

```bash
git add app/onboarding/page.tsx app/onboarding/OnboardingForm.tsx
git commit -m "feat: tela /onboarding (CEP autofill + número/sem-número + vitrine + personalização)"
```

---

## Task 6: Gate no layout admin + redirect do cadastro

**Files:**
- Modify: `app/(admin)/layout.tsx:31-39`
- Modify: `app/(auth)/criar-academia/page.tsx`

- [ ] **Step 1: Adicionar `onboarding_completed` ao select da org e o gate**

Em `app/(admin)/layout.tsx`, alterar o bloco de busca da org (linhas 31-39). Trocar:

```tsx
  const { data: org } = profileOrg?.organization_id
    ? await adminClient
        .from('organizations')
        .select('owner_id, name')
        .eq('id', profileOrg.organization_id)
        .single()
    : { data: null as { owner_id: string; name: string } | null }

  const isOwner = org?.owner_id === user.id
```

por:

```tsx
  const { data: org } = profileOrg?.organization_id
    ? await adminClient
        .from('organizations')
        .select('owner_id, name, onboarding_completed')
        .eq('id', profileOrg.organization_id)
        .single()
    : { data: null as { owner_id: string; name: string; onboarding_completed: boolean } | null }

  // Gate: academia sem onboarding concluído não acessa o painel.
  if (org && org.onboarding_completed === false) redirect('/onboarding')

  const isOwner = org?.owner_id === user.id
```

- [ ] **Step 2: Redirecionar o cadastro para /onboarding e remover Personalização**

Em `app/(auth)/criar-academia/page.tsx`:

(a) No `useState` do form (linhas 14-17), remover `description` e `brandColor`:

```tsx
  const [form, setForm] = useState({
    academyName: '', fullName: '', email: '', password: '', phone: '',
  })
```

(b) Trocar `router.push('/admin/dashboard')` (linha 47) por:

```tsx
    router.push('/onboarding')
```

(c) Remover por completo o bloco `<details>` "Personalização (opcional)" (linhas 63-85), incluindo a tag `</details>`.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa, sem erro de tipo (o `set('description')`/`set('brandColor')` foram removidos junto com o bloco).

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/layout.tsx" "app/(auth)/criar-academia/page.tsx"
git commit -m "feat: gate de onboarding no layout admin + cadastro redireciona p/ /onboarding"
```

---

## Task 7: Edição posterior do CEP/número em Configurações

**Files:**
- Modify: `features/financeiro/actions.ts:415-462`
- Modify: `app/(admin)/admin/configuracoes/page.tsx:27-51`
- Modify: `app/(admin)/admin/configuracoes/VitrineForm.tsx`

- [ ] **Step 1: `updateOrgListing` aceita cep/address_number/no_number**

Em `features/financeiro/actions.ts`, alterar a assinatura de `updateOrgListing` (linhas 415-423) para incluir os 3 campos:

```ts
export async function updateOrgListing(input: {
  is_listed: boolean
  cep: string
  state: string
  city: string
  neighborhood: string
  address_line: string
  address_number: string
  no_number: boolean
  sports: string[]
  whatsapp: string
}): Promise<{ error?: string }> {
```

E no `.update({...})` (linhas 451-458), adicionar os 3 campos:

```ts
    .update({
      is_listed: input.is_listed,
      cep: input.cep.trim() || null,
      state: input.state.trim().toUpperCase() || null,
      city: input.city.trim() || null,
      neighborhood: input.neighborhood.trim() || null,
      address_line: input.address_line.trim() || null,
      address_number: input.no_number ? null : input.address_number.trim() || null,
      no_number: input.no_number,
      sports: normalizeSports(input.sports),
      whatsapp: input.whatsapp.trim() || null,
    })
```

- [ ] **Step 2: Passar os campos no listing da page**

Em `app/(admin)/admin/configuracoes/page.tsx`:

(a) No select da org (linha 29), trocar para incluir os campos:

```tsx
    .select('is_listed, cep, state, city, neighborhood, address_line, address_number, no_number, sports, whatsapp')
```

(b) No type `org` (linhas 33-41), adicionar `cep?`, `address_number?`, `no_number?`:

```tsx
  const org = (orgRow ?? {}) as {
    is_listed?: boolean
    cep?: string | null
    state?: string | null
    city?: string | null
    neighborhood?: string | null
    address_line?: string | null
    address_number?: string | null
    no_number?: boolean
    sports?: string[] | null
    whatsapp?: string | null
  }
```

(c) No objeto `listing` (linhas 43-51), adicionar:

```tsx
  const listing = {
    is_listed: org.is_listed ?? true,
    cep: org.cep ?? '',
    state: org.state ?? '',
    city: org.city ?? '',
    neighborhood: org.neighborhood ?? '',
    address_line: org.address_line ?? '',
    address_number: org.address_number ?? '',
    no_number: org.no_number ?? false,
    sports: org.sports ?? [],
    whatsapp: org.whatsapp ?? '',
  }
```

- [ ] **Step 3: Adicionar campos CEP/número ao VitrineForm**

Em `app/(admin)/admin/configuracoes/VitrineForm.tsx`:

(a) Trocar o import de cep e ampliar a interface `VitrineFormProps.listing`. Após `import { SPORTS } from '@/lib/arenas/sports'` (linha 7), adicionar:

```tsx
import { formatCep, isCompleteCep, fetchAddressByCep } from '@/lib/arenas/cep'
```

(b) Ampliar a interface `listing` (linhas 11-20):

```tsx
  listing: {
    is_listed: boolean
    cep: string
    state: string
    city: string
    neighborhood: string
    address_line: string
    address_number: string
    no_number: boolean
    sports: string[]
    whatsapp: string
  }
```

(c) Adicionar os estados novos junto dos demais `useState` (após linha 23):

```tsx
  const [cep, setCep] = useState(listing.cep)
  const [addressNumber, setAddressNumber] = useState(listing.address_number)
  const [noNumber, setNoNumber] = useState(listing.no_number)
  const [cepStatus, setCepStatus] = useState<'idle' | 'loading' | 'notfound'>('idle')
```

(d) Adicionar o handler de CEP (antes de `handleSubmit`):

```tsx
  async function handleCepChange(raw: string) {
    const masked = formatCep(raw)
    setCep(masked)
    setCepStatus('idle')
    if (isCompleteCep(masked)) {
      setCepStatus('loading')
      const addr = await fetchAddressByCep(masked)
      if (addr) {
        setState(addr.state)
        setCity(addr.city)
        setNeighborhood(addr.neighborhood)
        setAddressLine(addr.addressLine)
        setCepStatus('idle')
      } else {
        setCepStatus('notfound')
      }
    }
  }
```

(e) Passar os campos novos no `updateOrgListing` dentro de `handleSubmit`:

```tsx
      const result = await updateOrgListing({
        is_listed: isListed,
        cep,
        state,
        city,
        neighborhood,
        address_line: addressLine,
        address_number: addressNumber,
        no_number: noNumber,
        sports,
        whatsapp,
      })
```

(f) Adicionar os inputs de CEP e Número no JSX, logo antes do input "Estado (UF)" (linha 89, o `<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">`):

```tsx
        <div>
          <Input label="CEP" placeholder="00000-000" value={cep} onChange={(e) => handleCepChange(e.target.value)} inputMode="numeric" />
          {cepStatus === 'loading' && <p className="text-xs text-slate-400 mt-1">Buscando endereço…</p>}
          {cepStatus === 'notfound' && <p className="text-xs text-yellow-400 mt-1">CEP não encontrado — preencha manualmente.</p>}
        </div>
```

E logo após o input "Endereço / referência" (linha 97), adicionar Número + checkbox:

```tsx
        {!noNumber && (
          <Input label="Número" placeholder="123" value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} />
        )}
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={noNumber} onChange={(e) => setNoNumber(e.target.checked)} className="w-4 h-4 accent-brand-500" />
          <span className="text-sm text-slate-200">Sem número</span>
        </label>
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 5: Commit**

```bash
git add "features/financeiro/actions.ts" "app/(admin)/admin/configuracoes/page.tsx" "app/(admin)/admin/configuracoes/VitrineForm.tsx"
git commit -m "feat: editar CEP/número (sem-número) na vitrine de Configurações"
```

---

## Task 8: Exibir endereço com número em `/arenas/[slug]`

**Files:**
- Modify: `app/arenas/[slug]/page.tsx:11-23,32-34,52`

- [ ] **Step 1: Importar `formatAddress` e ampliar a query/interface**

Em `app/arenas/[slug]/page.tsx`:

(a) Após `import { SPORT_BY_SLUG } from '@/lib/arenas/sports'` (linha 7), adicionar:

```tsx
import { formatAddress } from '@/lib/arenas/formatAddress'
```

(b) Na interface `ArenaRow` (linhas 11-23), adicionar `address_number` e `no_number`:

```tsx
  address_line: string | null
  address_number: string | null
  no_number: boolean
  sports: string[]
```

(c) No `.select(...)` (linha 34), incluir os 2 campos:

```tsx
    .select('id, name, slug, status, is_listed, city, state, neighborhood, address_line, address_number, no_number, sports, whatsapp')
```

(d) Na linha do endereço (linha 52), trocar `org.address_line` por `formatAddress(org)`:

```tsx
            {[formatAddress(org), org.neighborhood, org.city, org.state].filter(Boolean).join(' · ')}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 3: Commit**

```bash
git add "app/arenas/[slug]/page.tsx"
git commit -m "feat: exibir número do endereço (ou s/n) na página da arena"
```

---

## Task 9: Verificação final

**Files:** nenhum (validação).

- [ ] **Step 1: Rodar a suíte de testes**

Run: `npm run test:run`
Expected: testes do beach-tennis-app verdes, incluindo `lib/arenas/cep.test.ts` e `lib/arenas/formatAddress.test.ts`. (Falhas dentro de `octogent/` são de outro projeto e não contam.)

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build passa; rotas `/onboarding`, `/arenas/[slug]`, `/admin/configuracoes` presentes. Único warning aceitável: `<img>` em `InviteCard.tsx` (pré-existente).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros novos (só o warning pré-existente de `<img>`).

- [ ] **Step 4: Roteiro manual (anotar para o usuário executar)**

Confirmar, após o usuário aplicar a migration `20260619000000_org_onboarding_fields.sql` no SQL Editor:
1. Criar academia de teste → cai em `/onboarding` (não no dashboard).
2. Digitar CEP válido (ex.: `01001-000`) → UF/cidade/bairro/rua auto-preenchem.
3. Tentar "Concluir" sem número e sem marcar "Sem número" → bloqueado com a mensagem `Informe o número ou marque "Sem número".`
4. Marcar "Sem número" → conclui e redireciona ao `/admin/dashboard`.
5. A arena aparece em `/arenas` e a página `/arenas/{slug}` mostra o endereço com `, 123` ou `, s/n`.
6. Logar como Academia Hudson Barros (org existente, backfill `onboarding_completed = true`) → vai direto ao dashboard, sem passar pelo onboarding.

- [ ] **Step 5: Push da branch**

```bash
git push origin develop
```

---

## Notas de execução

- **Migration:** NÃO rodar `supabase db push`. O usuário aplica `20260619000000_org_onboarding_fields.sql` manualmente no SQL Editor (padrão do projeto). O código tolera as colunas ausentes só no sentido de tipos; em runtime, o gate depende da coluna existir — combine com o usuário para aplicar a migration antes de testar o fluxo logado.
- **Secrets:** nunca commitar `.env*`; usar `git add` por arquivo (já feito nos steps).
- **Branch:** trabalhar e dar push em `develop`. Nunca `main`.
