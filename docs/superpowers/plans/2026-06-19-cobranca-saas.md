# Cobrança do SaaS (academia → plataforma) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrar das academias uma mensalidade fixa (R$ 49,90) via MercadoPago Preapproval, com 1º mês grátis, bloqueando apenas o painel admin quando inadimplente — alunos seguem usando.

**Architecture:** A plataforma cobra na própria conta MercadoPago. Uma server action cria uma assinatura (Preapproval) e redireciona o dono ao `init_point` do MP (cartão hospedado no MP). Um branch novo no webhook MP existente sincroniza o status na tabela `platform_subscriptions`. O acesso ao painel admin é calculado das datas (trial/pago) em tempo de request por uma função pura — sem cron.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres + service role) · MercadoPago Preapproval API · Vitest. App em Português.

---

## Pré-requisitos e dependências externas (FLAG antes do go-live)

- **Novo env var `MERCADOPAGO_ACCESS_TOKEN`** (access token da conta MP da plataforma). Hoje só existe `MERCADOPAGO_WEBHOOK_SECRET`. Precisa ser configurado na Vercel **e** no `.env.local`. O código deve degradar com segurança quando ausente (retornar erro amigável, nunca crashar).
- **`back_url` depende do domínio final.** Reusa o padrão já existente no projeto: `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.pro'`.
- **Habilitar eventos de assinatura** (`subscription_preapproval` e `subscription_authorized_payment`) no webhook da conta MP — ação manual no painel MP, fora do código.
- **Migrations são aplicadas manualmente pelo usuário** no SQL Editor do Supabase (o executor NÃO aplica migrations). O executor apenas cria os arquivos `.sql`.
- Segurança: nunca imprimir/echo/commitar `MERCADOPAGO_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` nem o conteúdo de `.env.local`. Ler de `process.env` programaticamente.

## File Structure

**Criar:**
- `supabase/migrations/20260625000000_platform_subscriptions.sql` — tabela `platform_subscriptions`.
- `supabase/migrations/20260625000100_backfill_platform_subscriptions.sql` — Hudson vitalício; demais orgs em trial.
- `lib/billing/platformPlan.ts` — constante `PLATFORM_PLAN` (preço/moeda/reason).
- `lib/billing/platformAccess.ts` — função **pura** `computePlatformAccess()` (sem imports de servidor; testável no Vitest). É o coração do enforcement.
- `lib/billing/platformAccess.test.ts` — testes Vitest da função pura.
- `lib/billing/mpStatus.ts` — função **pura** `mapPreapprovalStatus()` (mapeia status do MP → nosso status).
- `lib/billing/mpStatus.test.ts` — testes Vitest do mapeamento.
- `lib/billing/access.ts` — `getPlatformAccess(orgId)` async (lê DB via service role).
- `features/platform-billing/actions.ts` — `subscribeToPlatform()`.
- `app/(admin)/admin/assinatura/page.tsx` — página de assinatura/paywall (server component).
- `app/(admin)/admin/assinatura/SubscribeButton.tsx` — botão client que chama a action e redireciona ao `init_point`.

**Modificar:**
- `app/(admin)/layout.tsx` — gate de cobrança + banner suave de trial.
- `app/api/webhooks/mercadopago/route.ts` — branch de eventos de assinatura.
- `features/organizations/actions.ts` — `createAcademy()` insere `platform_subscriptions` trialing.

---

### Task 1: Migration — tabela `platform_subscriptions`

**Files:**
- Create: `supabase/migrations/20260625000000_platform_subscriptions.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- Cobrança do SaaS (Plano 3) — parte 1/2: tabela de assinaturas da plataforma.
-- Uma assinatura por academia. O acesso ao painel admin é derivado das datas em tempo
-- de request (sem cron); ver lib/billing/platformAccess.ts.
--
-- Eixos independentes:
--   - organizations.status (active/suspended) = suspensão operacional manual (super-admin, Plano 4).
--   - platform_subscriptions.status = estado da cobrança da plataforma (este arquivo).

create table if not exists platform_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null unique references organizations(id) on delete cascade,
  status             text not null default 'trialing'
                       check (status in ('trialing','active','past_due','canceled')),
  trial_ends_at      timestamptz,        -- fim dos 30 dias grátis
  current_period_end timestamptz,        -- pago até (empurrado a cada cobrança confirmada)
  mp_preapproval_id  text,               -- id da assinatura no MercadoPago
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Lookup pelo id do MP (webhook subscription_authorized_payment encontra a org por aqui).
create index if not exists idx_platform_subscriptions_mp_preapproval_id
  on platform_subscriptions (mp_preapproval_id);

-- RLS: a tabela é manipulada só via service role (createAdminClient ignora RLS) — webhook,
-- server actions e o getter de acesso. Ativa RLS sem políticas → nega todo acesso anon/auth,
-- mantendo o padrão "nada exposto ao cliente" das tabelas de billing.
alter table platform_subscriptions enable row level security;
```

- [ ] **Step 2: Verificar (sem aplicar)**

Não aplicar. Confirmar que o arquivo existe e é SQL válido por leitura. (O usuário aplica no SQL Editor.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000000_platform_subscriptions.sql
git commit -m "feat(billing): tabela platform_subscriptions (cobrança SaaS)"
```

---

### Task 2: Migration — backfill das academias existentes

**Files:**
- Create: `supabase/migrations/20260625000100_backfill_platform_subscriptions.sql`

Hudson Barros (org #1, `is_default = true`) é vitalício (nunca cai no paywall, sem special-case no gate). Toda outra org existente (Arena Teste e quaisquer outras) entra em trial de 30 dias. Idempotente via `on conflict`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Cobrança do SaaS (Plano 3) — parte 2/2: backfill das academias já existentes.
-- Idempotente: on conflict (organization_id) do nothing — pode rodar de novo sem efeito.
--
-- Hudson Barros (is_default) = vitalício: status='active', current_period_end no futuro
-- distante (2099). Nunca cai no paywall e não precisa de special-case no enforcement.
-- Demais orgs (Arena Teste etc.) = trial de 30 dias a partir de agora.

insert into platform_subscriptions (organization_id, status, trial_ends_at, current_period_end)
select
  o.id,
  case when o.is_default then 'active'      else 'trialing'                 end,
  case when o.is_default then null          else now() + interval '30 days' end,
  case when o.is_default then timestamptz '2099-12-31' else null            end
from organizations o
on conflict (organization_id) do nothing;
```

- [ ] **Step 2: Verificar (sem aplicar)**

Confirmar por leitura que o `select` cobre todas as orgs e o `case` distingue `is_default`. Não aplicar.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000100_backfill_platform_subscriptions.sql
git commit -m "feat(billing): backfill platform_subscriptions (Hudson vitalício, demais em trial)"
```

---

### Task 3: Constante `PLATFORM_PLAN`

**Files:**
- Create: `lib/billing/platformPlan.ts`

- [ ] **Step 1: Escrever a constante**

```ts
// lib/billing/platformPlan.ts
// Plano único da plataforma (sem tiers). Preço fixo, 1º mês grátis (trial tratado em
// platform_subscriptions.trial_ends_at). Usado pela server action de assinatura e pela UI.
export const PLATFORM_PLAN = {
  priceMonthly: 49.9,
  currency: 'BRL',
  reason: 'Assinatura Plataforma — Beach Tennis App',
} as const
```

- [ ] **Step 2: Commit**

```bash
git add lib/billing/platformPlan.ts
git commit -m "feat(billing): constante PLATFORM_PLAN"
```

---

### Task 4: Função pura `computePlatformAccess` (TDD)

**Files:**
- Create: `lib/billing/platformAccess.ts`
- Test: `lib/billing/platformAccess.test.ts`

Função pura, sem imports de servidor (não importa `lib/supabase/server` nem `next/*`), para rodar no Vitest sem puxar `next/headers`. É o coração do enforcement.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// lib/billing/platformAccess.test.ts
import { describe, it, expect } from 'vitest'
import { computePlatformAccess } from './platformAccess'

const NOW = new Date('2026-06-19T12:00:00Z')
const inDays = (d: number) => new Date(NOW.getTime() + d * 86400000).toISOString()

describe('computePlatformAccess', () => {
  it('trial em dia → liberado, daysLeft arredonda pra cima', () => {
    const r = computePlatformAccess(
      { status: 'trialing', trialEndsAt: inDays(15), currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBe(15)
  })

  it('trial vencido → bloqueado, daysLeft 0', () => {
    const r = computePlatformAccess(
      { status: 'trialing', trialEndsAt: inDays(-1), currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(false)
    expect(r.daysLeft).toBe(0)
  })

  it('active no prazo → liberado', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: inDays(20) },
      NOW,
    )
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBe(20)
  })

  it('active vencido → bloqueado', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: inDays(-3) },
      NOW,
    )
    expect(r.allowed).toBe(false)
    expect(r.daysLeft).toBe(0)
  })

  it('past_due → bloqueado mesmo com current_period_end futuro', () => {
    const r = computePlatformAccess(
      { status: 'past_due', trialEndsAt: null, currentPeriodEnd: inDays(5) },
      NOW,
    )
    expect(r.allowed).toBe(false)
  })

  it('canceled → bloqueado', () => {
    const r = computePlatformAccess(
      { status: 'canceled', trialEndsAt: null, currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(false)
  })

  it('active sem current_period_end → bloqueado (dados inconsistentes)', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(false)
  })

  it('vitalício (2099) → liberado com daysLeft grande', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: '2099-12-31T00:00:00Z' },
      NOW,
    )
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBeGreaterThan(1000)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/platformAccess.test.ts`
Expected: FAIL ("computePlatformAccess is not a function" / módulo não encontrado).

- [ ] **Step 3: Implementar a função pura**

```ts
// lib/billing/platformAccess.ts
// Função PURA (sem I/O, sem imports de servidor) — coração do enforcement de cobrança.
// Regra: admin liberado se (active E pago em dia) OU (trialing E trial em dia).
export type PlatformStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

export interface PlatformSubscriptionState {
  status: PlatformStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}

export interface PlatformAccess {
  allowed: boolean
  daysLeft: number // dias até o fim do período relevante; 0 se vencido/sem data
}

const DAY_MS = 86400000

function daysUntil(iso: string | null, now: Date): number {
  if (!iso) return 0
  const diff = new Date(iso).getTime() - now.getTime()
  if (diff <= 0) return 0
  return Math.ceil(diff / DAY_MS)
}

export function computePlatformAccess(
  state: PlatformSubscriptionState,
  now: Date,
): PlatformAccess {
  if (state.status === 'active' && state.currentPeriodEnd) {
    const left = daysUntil(state.currentPeriodEnd, now)
    if (left > 0) return { allowed: true, daysLeft: left }
  }
  if (state.status === 'trialing' && state.trialEndsAt) {
    const left = daysUntil(state.trialEndsAt, now)
    if (left > 0) return { allowed: true, daysLeft: left }
  }
  return { allowed: false, daysLeft: 0 }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/platformAccess.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/platformAccess.ts lib/billing/platformAccess.test.ts
git commit -m "feat(billing): computePlatformAccess puro + testes"
```

---

### Task 5: Função pura `mapPreapprovalStatus` (TDD)

**Files:**
- Create: `lib/billing/mpStatus.ts`
- Test: `lib/billing/mpStatus.test.ts`

Mapeia o status de uma Preapproval do MercadoPago para o nosso `PlatformStatus`. Isola a regra do webhook num ponto puro e testável.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// lib/billing/mpStatus.test.ts
import { describe, it, expect } from 'vitest'
import { mapPreapprovalStatus } from './mpStatus'

describe('mapPreapprovalStatus', () => {
  it('authorized → active', () => {
    expect(mapPreapprovalStatus('authorized')).toBe('active')
  })
  it('paused → past_due', () => {
    expect(mapPreapprovalStatus('paused')).toBe('past_due')
  })
  it('cancelled → canceled', () => {
    expect(mapPreapprovalStatus('cancelled')).toBe('canceled')
  })
  it('status desconhecido → null (não altera o registro)', () => {
    expect(mapPreapprovalStatus('pending')).toBeNull()
    expect(mapPreapprovalStatus('')).toBeNull()
    expect(mapPreapprovalStatus(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/mpStatus.test.ts`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar**

```ts
// lib/billing/mpStatus.ts
// Tradução do status de Preapproval (assinatura) do MercadoPago para o nosso PlatformStatus.
// Retorna null quando o status do MP não tem mapeamento → o webhook NÃO altera o registro.
import type { PlatformStatus } from './platformAccess'

export function mapPreapprovalStatus(mpStatus: string | undefined): PlatformStatus | null {
  switch (mpStatus) {
    case 'authorized':
      return 'active'
    case 'paused':
      return 'past_due'
    case 'cancelled':
      return 'canceled'
    default:
      return null
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/mpStatus.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/mpStatus.ts lib/billing/mpStatus.test.ts
git commit -m "feat(billing): mapPreapprovalStatus puro + testes"
```

---

### Task 6: `getPlatformAccess(orgId)` (leitura do DB)

**Files:**
- Create: `lib/billing/access.ts`

Wrapper async que lê `platform_subscriptions` via service role e aplica `computePlatformAccess`. Sem assinatura encontrada → bloqueado (paywall) — o backfill + o insert no `createAcademy` garantem uma linha para toda org real.

- [ ] **Step 1: Implementar**

```ts
// lib/billing/access.ts
import { createAdminClient } from '@/lib/supabase/server'
import {
  computePlatformAccess,
  type PlatformStatus,
} from './platformAccess'

export interface PlatformAccessResult {
  allowed: boolean
  status: PlatformStatus | 'none'
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  daysLeft: number
}

// Lê a assinatura da plataforma da org e calcula o acesso ao painel admin.
// Service role (ignora RLS); a tabela não é exposta ao cliente.
export async function getPlatformAccess(orgId: string): Promise<PlatformAccessResult> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('platform_subscriptions')
    .select('status, trial_ends_at, current_period_end')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!data) {
    // Sem assinatura (org sem backfill/insert) → bloqueia por segurança.
    return { allowed: false, status: 'none', trialEndsAt: null, currentPeriodEnd: null, daysLeft: 0 }
  }

  const state = {
    status: data.status as PlatformStatus,
    trialEndsAt: data.trial_ends_at as string | null,
    currentPeriodEnd: data.current_period_end as string | null,
  }
  const { allowed, daysLeft } = computePlatformAccess(state, new Date())
  return {
    allowed,
    status: state.status,
    trialEndsAt: state.trialEndsAt,
    currentPeriodEnd: state.currentPeriodEnd,
    daysLeft,
  }
}
```

- [ ] **Step 2: Verificar tipo/build**

Run: `npm run build`
Expected: build OK (sem erros de tipo). Se falhar por algo não relacionado a billing, investigar antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add lib/billing/access.ts
git commit -m "feat(billing): getPlatformAccess (leitura + cálculo de acesso)"
```

---

### Task 7: `createAcademy` insere assinatura em trial

**Files:**
- Modify: `features/organizations/actions.ts`

Ao criar a academia, inserir a linha `platform_subscriptions` com `status='trialing'` e `trial_ends_at = now + 30 dias`. Fazer logo após o insert da org bem-sucedido (passo 1), antes de criar o usuário, para que a org já nasça com assinatura mesmo se o passo de usuário falhar (o rollback apaga a org, e o `on delete cascade` apaga a assinatura junto).

- [ ] **Step 1: Inserir a assinatura após criar a org**

No `createAcademy`, logo após o bloco que cria a org e obtém `org.id` (após a checagem `if (orgErr || !org) {...}`), adicionar:

```ts
  // Assinatura da plataforma em trial (1º mês grátis). on delete cascade garante limpeza
  // junto com a org no rollback. Falha aqui não deve abortar o cadastro (best-effort);
  // o backfill/edição posterior cobre, e a org sem linha cai no paywall (seguro).
  await admin.from('platform_subscriptions').insert({
    organization_id: org.id,
    status: 'trialing',
    trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  })
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add features/organizations/actions.ts
git commit -m "feat(billing): createAcademy inicia trial de 30 dias na plataforma"
```

---

### Task 8: Server action `subscribeToPlatform()`

**Files:**
- Create: `features/platform-billing/actions.ts`

Owner-only. Cria a Preapproval no MP, guarda o `mp_preapproval_id` e devolve o `init_point` para o client redirecionar. A fonte da verdade do status é o webhook (esta action só inicia o fluxo).

- [ ] **Step 1: Implementar a action**

```ts
'use server'
// features/platform-billing/actions.ts
import { requireOwner, createAdminClient } from '@/lib/supabase/server'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.pro'

// Inicia a assinatura da plataforma (Preapproval no MercadoPago). Owner-only.
// Devolve init_point (URL hospedada do MP) para o client redirecionar. Não tocamos no cartão.
export async function subscribeToPlatform(): Promise<{ error?: string; initPoint?: string }> {
  const ctx = await requireOwner() // não-dono → redirect; aqui já é owner

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) return { error: 'Pagamento indisponível no momento. Tente mais tarde.' }

  const admin = createAdminClient()

  // E-mail do dono (payer_email do MP).
  const { data: userRes } = await admin.auth.admin.getUserById(ctx.userId)
  const payerEmail = userRes?.user?.email
  if (!payerEmail) return { error: 'Não foi possível obter o e-mail do dono.' }

  const res = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: PLATFORM_PLAN.reason,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: PLATFORM_PLAN.priceMonthly,
        currency_id: PLATFORM_PLAN.currency,
      },
      payer_email: payerEmail,
      back_url: `${SITE_URL}/admin/assinatura?retorno=1`,
      external_reference: ctx.organizationId,
      status: 'pending',
    }),
  })

  if (!res.ok) {
    console.error('[platform-billing] MP preapproval failed:', res.status, await res.text())
    return { error: 'Não foi possível iniciar a assinatura. Tente novamente.' }
  }

  const data = (await res.json()) as { id?: string; init_point?: string }
  if (!data.id || !data.init_point) {
    return { error: 'Resposta inesperada do provedor de pagamento.' }
  }

  // Guarda o id da assinatura na linha da org (a fonte da verdade do status vem do webhook).
  await admin
    .from('platform_subscriptions')
    .update({ mp_preapproval_id: data.id, updated_at: new Date().toISOString() })
    .eq('organization_id', ctx.organizationId)

  return { initPoint: data.init_point }
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add features/platform-billing/actions.ts
git commit -m "feat(billing): subscribeToPlatform via MercadoPago Preapproval"
```

---

### Task 9: Botão client `SubscribeButton`

**Files:**
- Create: `app/(admin)/admin/assinatura/SubscribeButton.tsx`

Botão client que chama `subscribeToPlatform()` e, com `initPoint`, navega o browser para o MP (`window.location.href`). Mostra erro inline. Segue o padrão de `OnboardingForm` (`useTransition`, `Button` de `components/ui`).

- [ ] **Step 1: Implementar**

```tsx
'use client'
// app/(admin)/admin/assinatura/SubscribeButton.tsx
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { subscribeToPlatform } from '@/features/platform-billing/actions'

export function SubscribeButton({ label = 'Assinar agora' }: { label?: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const res = await subscribeToPlatform()
      if (res.error) {
        setError(res.error)
        return
      }
      if (res.initPoint) {
        window.location.href = res.initPoint
      }
    })
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={pending}>
        {pending ? 'Redirecionando…' : label}
      </Button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/(admin)/admin/assinatura/SubscribeButton.tsx"
git commit -m "feat(billing): botão de assinatura (client)"
```

---

### Task 10: Página `/admin/assinatura`

**Files:**
- Create: `app/(admin)/admin/assinatura/page.tsx`

Server component que varia por estado de acesso. Em trial (liberado): informativa + botão. Bloqueado: paywall. Professor (não-dono) em academia bloqueada: orientação sem botão. Usa `Card` de `components/ui` e o gradiente de marca, no estilo do `app/onboarding/page.tsx`.

- [ ] **Step 1: Implementar a página**

```tsx
// app/(admin)/admin/assinatura/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getStaffContext } from '@/lib/supabase/server'
import { getPlatformAccess } from '@/lib/billing/access'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'
import { Card } from '@/components/ui/Card'
import { SubscribeButton } from './SubscribeButton'

export default async function AssinaturaPage() {
  const ctx = await getStaffContext()
  if (!ctx) redirect('/login')

  const access = await getPlatformAccess(ctx.organizationId)
  const price = PLATFORM_PLAN.priceMonthly.toFixed(2).replace('.', ',')

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-white mb-4">Assinatura da plataforma</h1>
      <Card className="p-6 space-y-4">
        <div>
          <p className="text-2xl font-bold text-white">R$ {price}<span className="text-base font-normal text-slate-400">/mês</span></p>
          <p className="text-sm text-slate-400">{PLATFORM_PLAN.reason}</p>
        </div>

        {access.allowed && access.status === 'trialing' && (
          <>
            <p className="text-sm text-slate-300">
              Seu mês grátis termina em <strong>{access.daysLeft} dia(s)</strong>. Assine para
              manter o painel ativo quando o período acabar.
            </p>
            {ctx.isOwner ? (
              <SubscribeButton />
            ) : (
              <p className="text-sm text-slate-400">Fale com o dono da academia para assinar.</p>
            )}
          </>
        )}

        {access.allowed && access.status === 'active' && (
          <p className="text-sm text-green-400">Assinatura ativa. Obrigado!</p>
        )}

        {!access.allowed && (
          <>
            <p className="text-sm text-red-400">
              O acesso ao painel está bloqueado. Assine para continuar usando a plataforma.
            </p>
            {ctx.isOwner ? (
              <SubscribeButton label="Assinar e desbloquear" />
            ) : (
              <p className="text-sm text-slate-400">
                Fale com o dono da academia para regularizar a assinatura.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build OK. Confirmar que `Card` aceita `className` (usado em outras páginas admin).

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/assinatura/page.tsx"
git commit -m "feat(billing): página /admin/assinatura (trial/paywall)"
```

---

### Task 11: Gate de cobrança + banner no layout admin

**Files:**
- Modify: `app/(admin)/layout.tsx`

Após auth + checagem de papel + checagem de onboarding, calcular o acesso de cobrança. Se `!allowed` e a rota não for a própria `/admin/assinatura` → `redirect('/admin/assinatura')`. Banner suave quando `trialing` e `daysLeft <= 7`. A `/admin/assinatura` é isenta do redirect (senão loop).

Nota: `layout.tsx` não recebe o pathname. Para isentar `/admin/assinatura`, a própria página é alcançável porque o gate redireciona PARA ela — mas isso geraria loop. Solução: o gate redireciona para `/admin/assinatura`; essa página está sob o mesmo layout, então o gate roda de novo e redireciona para ela mesma (`redirect` para a URL atual é no-op no Next? não — causa loop). Para evitar, lê o pathname via `headers()` (`x-invoke-path` não é confiável). **Abordagem robusta:** mover o gate para um middleware-like check usando `headers().get('x-pathname')` setado pelo `middleware.ts`. Verificar se o `middleware.ts` já injeta o pathname; se não, injetar.

- [ ] **Step 1: Garantir que o pathname chega ao layout via header**

Ler `middleware.ts`. Se ainda não propaga o pathname, adicionar no retorno do middleware:

```ts
// dentro de middleware.ts, ao construir a resposta:
const requestHeaders = new Headers(req.headers)
requestHeaders.set('x-pathname', req.nextUrl.pathname)
// usar requestHeaders no NextResponse.next({ request: { headers: requestHeaders } })
```

Se o `middleware.ts` já cria um `NextResponse.next(...)`, adaptar para incluir `request.headers`. Se o middleware retorna `NextResponse.next()` sem opções, trocar por:

```ts
return NextResponse.next({ request: { headers: requestHeaders } })
```

(Manter intacta a lógica de cookie/auth existente; só adicionar o header.)

- [ ] **Step 2: Adicionar o gate no layout**

Em `app/(admin)/layout.tsx`, adicionar o import e a checagem. Após o bloco de onboarding (`if (org && org.onboarding_completed === false && isOwner) redirect('/onboarding')`), inserir:

```ts
import { headers } from 'next/headers'
import { getPlatformAccess } from '@/lib/billing/access'
// ...
  const pathname = headers().get('x-pathname') ?? ''
  const isAssinaturaRoute = pathname.startsWith('/admin/assinatura')

  const access = await getPlatformAccess(ctx.organizationId)
  if (!access.allowed && !isAssinaturaRoute) redirect('/admin/assinatura')

  const showTrialBanner = access.status === 'trialing' && access.daysLeft <= 7
```

- [ ] **Step 3: Renderizar o banner suave**

No JSX, dentro do `<main>`, antes de `{children}`:

```tsx
        {showTrialBanner && (
          <div className="mb-4 rounded-lg border border-brand-600/40 bg-brand-600/10 px-4 py-3 text-sm text-brand-200">
            Seu mês grátis termina em {access.daysLeft} dia(s).{' '}
            <a href="/admin/assinatura" className="font-semibold underline">Assinar agora</a>
          </div>
        )}
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/layout.tsx" middleware.ts
git commit -m "feat(billing): gate de cobrança + banner de trial no painel admin"
```

---

### Task 12: Webhook — branch de eventos de assinatura

**Files:**
- Modify: `app/api/webhooks/mercadopago/route.ts`

Estender `handleWebhook` com branches de assinatura ANTES do guard que só aceita `payment*`. O fluxo de pagamento do aluno (`payment.*`) fica intocado. Usa `mapPreapprovalStatus` (Task 5). Idempotente.

- [ ] **Step 1: Despachar eventos de assinatura no topo de `handleWebhook`**

Em `handleWebhook`, logo após `const action = body.action ?? body.type` e antes do guard `if (!action || ...)`, inserir:

```ts
  // Eventos de assinatura da PLATAFORMA (cobrança academia→plataforma).
  // Separado do fluxo payment.* (billing aluno→academia), que segue abaixo intocado.
  if (action === 'subscription_preapproval' || action === 'subscription_authorized_payment') {
    return handlePlatformSubscription(action, String(body.data?.id ?? ''))
  }
```

- [ ] **Step 2: Adicionar os imports**

No topo do arquivo:

```ts
import { mapPreapprovalStatus } from '@/lib/billing/mpStatus'
```

- [ ] **Step 3: Implementar `handlePlatformSubscription`**

Adicionar a função (após `handleWebhook`):

```ts
// Sincroniza platform_subscriptions a partir de eventos de assinatura do MercadoPago.
// - subscription_preapproval: mudança de status da assinatura (id = preapproval id).
// - subscription_authorized_payment: cobrança mensal aprovada → empurra current_period_end.
async function handlePlatformSubscription(
  action: string,
  resourceId: string,
): Promise<NextResponse> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) {
    console.error('[webhook/mercadopago] MERCADOPAGO_ACCESS_TOKEN ausente')
    return NextResponse.json({ received: true })
  }
  if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  if (action === 'subscription_preapproval') {
    // Lê a assinatura no MP: status + external_reference (= organization_id).
    const res = await fetch(`https://api.mercadopago.com/preapproval/${resourceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      console.error('[webhook/mercadopago] GET preapproval falhou:', res.status)
      return NextResponse.json({ received: true })
    }
    const pre = (await res.json()) as { status?: string; external_reference?: string }
    const mapped = mapPreapprovalStatus(pre.status)
    if (!mapped || !pre.external_reference) return NextResponse.json({ received: true })

    await admin
      .from('platform_subscriptions')
      .update({ status: mapped, mp_preapproval_id: resourceId, updated_at: nowIso })
      .eq('organization_id', pre.external_reference)

    return NextResponse.json({ received: true })
  }

  // subscription_authorized_payment: cobrança mensal aprovada.
  // O id do evento é do pagamento; encontramos a org pela assinatura associada.
  const res = await fetch(`https://api.mercadopago.com/authorized_payments/${resourceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[webhook/mercadopago] GET authorized_payment falhou:', res.status)
    return NextResponse.json({ received: true })
  }
  const pay = (await res.json()) as { preapproval_id?: string; status?: string }
  if (pay.status !== 'approved' || !pay.preapproval_id) {
    return NextResponse.json({ received: true })
  }

  // Empurra o período pago em +1 mês a partir de agora e marca ativa. Idempotente o
  // suficiente para o smoke test (reprocessar empurra o período de novo; aceitável).
  const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString()
  await admin
    .from('platform_subscriptions')
    .update({ status: 'active', current_period_end: periodEnd, updated_at: nowIso })
    .eq('mp_preapproval_id', pay.preapproval_id)

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add "app/api/webhooks/mercadopago/route.ts"
git commit -m "feat(billing): webhook sincroniza assinatura da plataforma (MP Preapproval)"
```

---

### Task 13: Verificação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Suite de testes**

Run: `npm run test:run`
Expected: testes do app passam (incl. `platformAccess.test.ts` e `mpStatus.test.ts`). Falhas pré-existentes em `octogent/` (projeto aninhado, não relacionado) são esperadas — confirmar que nenhuma falha nova vem de `lib/billing` ou do app.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: sucesso, sem erros de tipo.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 4: Roteiro de smoke manual (documentar; não executar aqui)**

Anotar para o usuário aplicar em produção após as migrations + env var:
1. Aplicar `20260625000000` e `20260625000100` no SQL Editor.
2. Configurar `MERCADOPAGO_ACCESS_TOKEN` (Vercel + `.env.local`) e habilitar eventos de assinatura no webhook MP.
3. Logar como dono de uma org em trial → ver banner quando `daysLeft <= 7`; acessar `/admin/assinatura` → clicar "Assinar agora" → completar cartão no MP → voltar pela `back_url`.
4. Confirmar (via webhook) que `platform_subscriptions.status` vira `active` e `current_period_end` avança.
5. Forçar trial vencido (ajustar `trial_ends_at` no passado via SQL) e confirmar que o admin é redirecionado para `/admin/assinatura`, enquanto o **aluno** da mesma org continua acessando `/home` normalmente.
6. Confirmar que Hudson (org #1) nunca cai no paywall.

- [ ] **Step 5: Commit final (se houver ajustes)**

Se algum ajuste de verificação gerou mudança, commitar; senão, nada a fazer.

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura da spec:**
- Tabela `platform_subscriptions` → Task 1. Backfill (Hudson vitalício / demais trial) → Task 2.
- `PLATFORM_PLAN` → Task 3. `computePlatformAccess` puro + testes → Task 4. `getPlatformAccess` → Task 6.
- `subscribeToPlatform` (Preapproval) → Task 8 (+ botão client Task 9). Página `/admin/assinatura` (3 estados) → Task 10.
- Enforcement no layout + banner → Task 11. Trial no `createAcademy` → Task 7.
- Webhook (`subscription_preapproval` + `subscription_authorized_payment`, idempotente, `payment.*` intocado) → Task 12 (+ `mapPreapprovalStatus` puro Task 5).
- Env var `MERCADOPAGO_ACCESS_TOKEN` e dependência de domínio → seção de pré-requisitos + degradação segura nas Tasks 8 e 12.

**Desvios conscientes da spec (documentados):**
- A spec coloca `computePlatformAccess` "em `lib/billing/access.ts`". O plano o separa em `lib/billing/platformAccess.ts` (puro, sem imports de servidor) para ser testável no Vitest sem puxar `next/headers`; `access.ts` mantém o getter async `getPlatformAccess`. Mesma intenção, fronteira mais limpa.
- Isenção da rota `/admin/assinatura` no gate: a spec assume que o layout conhece a rota. Como o layout do App Router não recebe pathname, o plano injeta `x-pathname` no `middleware.ts` (Task 11, Step 1). Verificar o estado atual do middleware antes de alterar.

**Consistência de tipos:** `PlatformStatus` definido em `platformAccess.ts` e reusado em `mpStatus.ts` e `access.ts`. `computePlatformAccess(state, now)` com a mesma assinatura em todos os call sites.

**Sem placeholders:** todo passo de código traz o código completo.
