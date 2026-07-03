# Financeiro das Academias — Mercado Pago por Academia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada academia conecta a própria conta Mercado Pago (OAuth marketplace); alunos assinam planos com recorrência automática no cartão (periodicidades mensal→anual) e compram aula avulsa/day use via Checkout Pro; admin configura tudo em `/admin/financeiro`.

**Architecture:** Camada `lib/billing/` isola cripto de tokens, OAuth state, cliente HTTP do MP e regras de periodicidade (tudo com testes). Server actions criam preapprovals/preferências com o token da academia; o webhook único (`/api/webhooks/mercadopago`) resolve multi-tenant (assinatura do aluno → academia → plataforma) e é a ÚNICA fonte de efeitos (créditos/confirmações). Schema novo: `org_gateway_accounts`, `plan_billing_options`, `gateway_integration_requests`, `plan_recommendations`.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (service role + RLS) · Mercado Pago (OAuth, Preapproval, Checkout Pro) · Vitest · Vercel Cron

**Spec:** `docs/superpowers/specs/2026-07-03-financeiro-academias-mercadopago-design.md`

---

## Setup manual (usuário — fora do código)

Estas etapas são do usuário, não do executor. O código deve degradar com mensagem amigável enquanto não existirem:

1. Criar aplicação no painel dev do Mercado Pago (modelo marketplace) com redirect URI `https://arenahub.website/api/integrations/mercadopago/callback`.
2. Envs novas na Vercel (Production + Development): `MP_APP_ID`, `MP_APP_SECRET`, `GATEWAY_TOKEN_KEY` (gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. Aplicar as migrations novas (SQL Editor ou `supabase db push`) — ver memória `reference-supabase-cli-auth`: migrations são aplicadas pelo usuário.
4. Configurar o webhook da aplicação MP para `https://arenahub.website/api/webhooks/mercadopago` (mesmo endpoint atual; `MERCADOPAGO_WEBHOOK_SECRET` já existe).

## Regras do repo que TODO task respeita

- Nunca importar `@supabase/supabase-js` direto — usar `@/lib/supabase/server` (`createClient`, `createAdminClient`, `getActiveOrgId`, `requireOwner`).
- Toda query com `createAdminClient()` (bypassa RLS) leva `.eq('organization_id', orgId)` ou escopo transitivo.
- UI usa primitives de `components/ui/` (`Button`, `Card`, `Badge`, `Input`) e tokens do tema (`bg-surface-card`, `border-surface-border`, `text-brand-500`).
- Testes: Vitest co-locado (`foo.test.ts` ao lado de `foo.ts`). Rodar um arquivo: `npm run test:run -- lib/billing/foo.test.ts`.
- Textos de UI em pt-BR.
- ATENÇÃO: `npm run test:run` sem filtro inclui o projeto aninhado `octogent/` com 15 falhas pré-existentes SEM relação. Gate real: `npx vitest run lib features app`.

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260704000000_financeiro_enums.sql` | SÓ os `alter type ... add value` (precisam de statement isolado) |
| `supabase/migrations/20260704000100_financeiro_gateways.sql` | Tabelas novas, colunas, backfill de preços, RPC day use v2, RLS |
| `lib/billing/periodicity.ts` (+`.test.ts`) | Meses/labels por periodicidade, soma de meses com clamp, "assinatura em dia" |
| `lib/billing/tokenCrypto.ts` (+`.test.ts`) | AES-256-GCM de tokens com `GATEWAY_TOKEN_KEY` |
| `lib/billing/oauthState.ts` (+`.test.ts`) | `state` HMAC do OAuth (10 min TTL) |
| `lib/billing/fees.ts` (+`.test.ts`) | `computeMarketplaceFee(amount, pct)` |
| `lib/billing/mpClient.ts` (+`.test.ts`) | Todas as chamadas HTTP à API do MP (único `fetch` p/ api.mercadopago.com) |
| `lib/billing/gatewayAccounts.ts` | Load/save da conta MP da academia (decripta; wrapper fino, sem teste) |
| `lib/billing/studentSubscriptionStatus.ts` (+`.test.ts`) | Map status preapproval MP → status da assinatura do aluno |
| `lib/utils/siteUrl.ts` (+`.test.ts`) | `getSiteUrl()` compartilhado (extraído de platform-billing) |
| `features/financeiro/gatewayActions.ts` | OAuth connect/disconnect + solicitação de outros gateways (owner-only) |
| `features/financeiro/checkoutActions.ts` | `subscribeToPlanCheckout`, `buySingleClassCredits` |
| `features/financeiro/recommendationActions.ts` | Indicar plano (admin) + dispensar (aluno) |
| `features/financeiro/PlanStorefront.tsx` | Vitrine de planos do aluno (client) |
| `features/financeiro/BuyCreditsCard.tsx` | Compra de aula avulsa (client) |
| `features/financeiro/CancelPlanButton.tsx` | Cancelar assinatura (client) |
| `features/financeiro/CheckoutReturnBanner.tsx` | Aviso pós-checkout com polling leve (client) |
| `features/financeiro/RecommendationBanner.tsx` | Banner "a academia indicou o plano X" (client) |
| `app/api/integrations/mercadopago/callback/route.ts` | Callback do OAuth |
| `app/api/cron/mp-token-refresh/route.ts` | Renovação semanal de tokens OAuth |
| `app/api/webhooks/mercadopago/studentHandlers.ts` | Handlers billing aluno→academia (preapproval + cobrança recorrente) |
| `app/api/webhooks/mercadopago/checkoutHandlers.ts` | Handler pagamentos Checkout Pro (`?org=`): per_class e day_use |
| `app/(dashboard)/financeiro/page.tsx` | Página financeiro do aluno |
| `app/(dashboard)/retorno-pagamento/page.tsx` | Roteia o retorno do MP (raiz) para a tela certa |
| `app/(admin)/admin/financeiro/FinanceiroSubnav.tsx` | Sub-navegação Visão geral / Planos / Integrações |
| `app/(admin)/admin/financeiro/planos/page.tsx` | Página de gestão de planos |
| `app/(admin)/admin/financeiro/planos/SalesSettingsCard.tsx` | Preço/toggle de aula avulsa e day use |
| `app/(admin)/admin/financeiro/integracoes/page.tsx` | Página de integrações |
| `app/(admin)/admin/financeiro/integracoes/MpConnectCard.tsx` | Card conectar/status MP (client) |
| `app/(admin)/admin/financeiro/integracoes/GatewayRequestCard.tsx` | Formulário "outro banco/gateway" (client) |
| `app/(admin)/admin/alunos/[id]/RecommendPlanCard.tsx` | Indicar plano + status da assinatura MP (client) |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `types/index.ts` | Novos unions/interfaces; remover `price_*` de `SubscriptionPlan` (Task 11) |
| `features/financeiro/SubscriptionCard.tsx` | Labels p/ novos status + periodicidade/preço snapshot |
| `features/financeiro/PaymentHistory.tsx` | Label p/ `day_use` |
| `features/financeiro/actions.ts` | `cancelSubscription`/`adminCancelStudentPlan` cancelam no MP primeiro |
| `features/platform-billing/actions.ts` | Usa `getSiteUrl()` compartilhado |
| `features/aulas/creditReconciliation.ts` | Gate "em dia" p/ assinaturas mercadopago |
| `features/dayuse/actions.ts` | `bookDayUse` com caminho pago (pending_payment + preferência) |
| `app/api/webhooks/mercadopago/route.ts` | Dispatch multi-tenant (aluno → checkout ?org → plataforma) |
| `app/(admin)/admin/financeiro/page.tsx` | KPIs + card integração + inadimplentes vencidos + reembolsos day use; remove PlansManager (vai p/ /planos) |
| `app/(admin)/admin/financeiro/adminActions.ts` | CRUD c/ billing options + settings de venda avulsa |
| `app/(admin)/admin/financeiro/PlansManager.tsx` | Editor de periodicidades |
| `app/(admin)/admin/alunos/[id]/page.tsx` | Sem `price_monthly`; passa options; monta RecommendPlanCard |
| `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx` | Sem `price_monthly` no label do select |
| `app/(dashboard)/perfil/page.tsx` | Link para `/financeiro` |
| `app/(dashboard)/agendar/dayuse/page.tsx` | Redirect p/ initPoint quando day use é pago; badge pendente |
| `app/(dashboard)/agendar/page.tsx` | CTA "Comprar aula avulsa" com saldo 0 |
| `app/(dashboard)/home/page.tsx` | Banner de indicação de plano |
| `middleware.ts` | Retorno do MP na raiz → `/retorno-pagamento` |
| `vercel.json` | Cron `mp-token-refresh` |

---

### Task 1: Migrations (enums isolados + schema)

**Files:**
- Create: `supabase/migrations/20260704000000_financeiro_enums.sql`
- Create: `supabase/migrations/20260704000100_financeiro_gateways.sql`

- [ ] **Step 1: Criar migration de enums (arquivo separado — `ADD VALUE` não pode ser usado na mesma transação que o consome)**

```sql
-- supabase/migrations/20260704000000_financeiro_enums.sql
-- SOMENTE alter type: novos valores de enum precisam de statement isolado
-- (não podem ser usados na mesma transação em que foram criados).
alter type subscription_status add value if not exists 'pending_payment';
alter type subscription_status add value if not exists 'past_due';
alter type payment_transaction_type add value if not exists 'day_use';
alter type credit_transaction_type add value if not exists 'purchased';
```

- [ ] **Step 2: Criar migration principal**

```sql
-- supabase/migrations/20260704000100_financeiro_gateways.sql
-- Financeiro das academias: conta MP por academia (OAuth), periodicidades por
-- plano, solicitações de gateway, indicações de plano, day use pago.
-- Spec: docs/superpowers/specs/2026-07-03-financeiro-academias-mercadopago-design.md

-- ── 1. Conta de gateway por academia (tokens criptografados no app) ─────────
create table if not exists org_gateway_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  gateway text not null default 'mercadopago',
  status text not null default 'connected'
    check (status in ('connected','disconnected','expired')),
  mp_user_id text,
  access_token_enc text not null,
  refresh_token_enc text not null,
  public_key text,
  token_expires_at timestamptz,
  connected_by uuid references profiles(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, gateway)
);
-- Deny-all: RLS ligada SEM policies → só o service role acessa (tokens nunca
-- chegam ao client).
alter table org_gateway_accounts enable row level security;

-- ── 2. Periodicidades por plano ──────────────────────────────────────────────
create table if not exists plan_billing_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid not null references subscription_plans(id) on delete cascade,
  periodicity text not null
    check (periodicity in ('monthly','bimonthly','quarterly','semiannual','annual')),
  price numeric(10,2) not null check (price >= 0),
  is_enabled boolean not null default true,
  unique (plan_id, periodicity)
);
alter table plan_billing_options enable row level security;
create policy plan_billing_options_select on plan_billing_options
  for select using (organization_id = auth_org_id());

-- Backfill: preços fixos atuais viram opções (só os > 0).
insert into plan_billing_options (organization_id, plan_id, periodicity, price, is_enabled)
select organization_id, id, 'monthly', price_monthly, true
  from subscription_plans where price_monthly > 0
on conflict (plan_id, periodicity) do nothing;
insert into plan_billing_options (organization_id, plan_id, periodicity, price, is_enabled)
select organization_id, id, 'quarterly', price_quarterly, true
  from subscription_plans where price_quarterly > 0
on conflict (plan_id, periodicity) do nothing;
insert into plan_billing_options (organization_id, plan_id, periodicity, price, is_enabled)
select organization_id, id, 'annual', price_annual, true
  from subscription_plans where price_annual > 0
on conflict (plan_id, periodicity) do nothing;

alter table subscription_plans
  drop column if exists price_monthly,
  drop column if exists price_quarterly,
  drop column if exists price_annual;

-- ── 3. Solicitações de outros gateways ───────────────────────────────────────
create table if not exists gateway_integration_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  requested_by uuid not null references profiles(id),
  gateway_name text not null,
  notes text,
  status text not null default 'pending' check (status in ('pending','reviewed')),
  created_at timestamptz not null default now()
);
alter table gateway_integration_requests enable row level security; -- deny-all

-- ── 4. Indicação de plano pelo admin ─────────────────────────────────────────
create table if not exists plan_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null references subscription_plans(id) on delete cascade,
  billing_option_id uuid not null references plan_billing_options(id) on delete cascade,
  created_by uuid not null references profiles(id),
  status text not null default 'pending' check (status in ('pending','completed','dismissed')),
  created_at timestamptz not null default now()
);
alter table plan_recommendations enable row level security;
create policy plan_recommendations_select_own on plan_recommendations
  for select using (student_id = auth.uid() and organization_id = auth_org_id());

-- ── 5. student_subscriptions: snapshot + ciclo de vida gateway ───────────────
alter table student_subscriptions
  add column if not exists billing_option_id uuid references plan_billing_options(id) on delete set null,
  add column if not exists periodicity text
    check (periodicity in ('monthly','bimonthly','quarterly','semiannual','annual')),
  add column if not exists price numeric(10,2),
  add column if not exists current_period_end timestamptz,
  add column if not exists gateway text not null default 'manual'
    check (gateway in ('manual','mercadopago'));
create index if not exists idx_student_subs_gateway_sub_id
  on student_subscriptions (gateway_subscription_id)
  where gateway_subscription_id is not null;

-- ── 6. payments: day use + idempotência ──────────────────────────────────────
alter table payments
  add column if not exists dayuse_booking_id uuid references dayuse_bookings(id) on delete set null,
  add column if not exists credits_qty int;
-- Idempotência de webhook: uma cobrança do gateway só entra uma vez.
create unique index if not exists payments_gateway_payment_unique
  on payments (gateway, gateway_payment_id)
  where gateway_payment_id is not null;

-- ── 7. Comissão da plataforma (0 = desligada) ────────────────────────────────
alter table organizations
  add column if not exists platform_fee_pct numeric(5,2) not null default 0;

-- ── 8. Day use pago: pending_payment com prazo de 30 min ────────────────────
alter table dayuse_bookings drop constraint if exists dayuse_bookings_status_check;
alter table dayuse_bookings add constraint dayuse_bookings_status_check
  check (status in ('confirmed','cancelled','pending_payment'));

-- Substitui a RPC (drop explícito: overload de 2-args + default de 3-args
-- deixaria a chamada PostgREST ambígua).
drop function if exists public.book_dayuse_atomic(uuid, uuid);

create or replace function public.book_dayuse_atomic(
  p_student_id uuid,
  p_slot_id uuid,
  p_status text default 'confirmed'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_org uuid;
  v_count int;
  v_booking_id uuid;
begin
  if p_status not in ('confirmed', 'pending_payment') then
    raise exception 'INVALID_STATUS';
  end if;

  perform pg_advisory_xact_lock(hashtext('dayuse:' || p_slot_id::text));

  select capacity, organization_id into v_capacity, v_org
  from dayuse_slots
  where id = p_slot_id and is_active = true;

  if v_capacity is null then
    raise exception 'SLOT_NOT_FOUND';
  end if;

  -- Já tem reserva confirmada OU pendente dentro do prazo?
  perform 1 from dayuse_bookings
  where slot_id = p_slot_id and student_id = p_student_id
    and (status = 'confirmed'
         or (status = 'pending_payment' and booked_at > now() - interval '30 minutes'));
  if found then
    raise exception 'ALREADY_BOOKED';
  end if;

  -- Vagas ocupadas = confirmadas + pendentes de pagamento dentro do prazo.
  select count(*) into v_count
  from dayuse_bookings
  where slot_id = p_slot_id
    and (status = 'confirmed'
         or (status = 'pending_payment' and booked_at > now() - interval '30 minutes'));

  if v_count >= v_capacity then
    raise exception 'SLOT_FULL';
  end if;

  insert into dayuse_bookings (slot_id, student_id, organization_id, status)
  values (p_slot_id, p_student_id, v_org, p_status)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.book_dayuse_atomic(uuid, uuid, text) from public, anon, authenticated;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260704000000_financeiro_enums.sql supabase/migrations/20260704000100_financeiro_gateways.sql
git commit -m "feat(financeiro): migrations — gateway por academia, periodicidades, day use pago"
```

---

### Task 2: Tipos novos + labels de UI compatíveis

Extensões **aditivas** em `types/index.ts` (a remoção de `price_*` fica para a Task 11, junto do rework do PlansManager). Os `Record<Status, string>` de labels quebram o build quando o union cresce — corrigir no mesmo commit.

**Files:**
- Modify: `types/index.ts`
- Modify: `features/financeiro/SubscriptionCard.tsx`
- Modify: `features/financeiro/PaymentHistory.tsx`

- [ ] **Step 1: Estender types/index.ts**

Substituir as linhas dos unions existentes (54–57):

```ts
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'pending_payment' | 'past_due'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type PaymentTransactionType = 'subscription' | 'per_class' | 'trial' | 'day_use'
export type CreditTransactionType = 'renewed' | 'used' | 'refunded' | 'expired' | 'purchased'
export type Periodicity = 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual'
export type SubscriptionGateway = 'manual' | 'mercadopago'
```

Em `StudentSubscription`, adicionar os campos novos (depois de `gateway_subscription_id`):

```ts
export interface StudentSubscription {
  id: string
  organization_id: string
  student_id: string
  payer_id: string
  plan_id: string
  status: SubscriptionStatus
  starts_at: string
  ends_at: string | null
  next_billing_at: string
  discount_pct: number
  gateway_subscription_id: string | null
  billing_option_id: string | null
  periodicity: Periodicity | null
  price: number | null
  current_period_end: string | null
  gateway: SubscriptionGateway
}
```

Em `Payment`, adicionar após `gateway`:

```ts
  dayuse_booking_id: string | null
  credits_qty: number | null
```

Adicionar as interfaces novas (depois de `SubscriptionPlan`):

```ts
export interface PlanBillingOption {
  id: string
  organization_id: string
  plan_id: string
  periodicity: Periodicity
  price: number
  is_enabled: boolean
}

export interface GatewayIntegrationRequest {
  id: string
  organization_id: string
  requested_by: string
  gateway_name: string
  notes: string | null
  status: 'pending' | 'reviewed'
  created_at: string
}

export interface PlanRecommendation {
  id: string
  organization_id: string
  student_id: string
  plan_id: string
  billing_option_id: string
  created_by: string
  status: 'pending' | 'completed' | 'dismissed'
  created_at: string
}
```

- [ ] **Step 2: Atualizar labels em SubscriptionCard.tsx**

```ts
function statusLabel(status: SubscriptionStatus): string {
  const labels: Record<SubscriptionStatus, string> = {
    active: 'Ativo',
    paused: 'Pausado',
    cancelled: 'Cancelado',
    pending_payment: 'Aguardando pagamento',
    past_due: 'Pagamento vencido',
  }
  return labels[status] ?? status
}

function statusVariant(status: SubscriptionStatus): 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success'
  if (status === 'paused' || status === 'pending_payment') return 'warning'
  return 'danger'
}
```

- [ ] **Step 3: Atualizar labels em PaymentHistory.tsx**

```ts
function typeLabel(type: PaymentTransactionType): string {
  const labels: Record<PaymentTransactionType, string> = {
    subscription: 'Assinatura',
    per_class: 'Avulso',
    trial: 'Aula Trial',
    day_use: 'Day Use',
  }
  return labels[type] ?? type
}
```

- [ ] **Step 4: Verificar build e commit**

Run: `npm run build`
Expected: sucesso (sem erros de TS)

```bash
git add types/index.ts features/financeiro/SubscriptionCard.tsx features/financeiro/PaymentHistory.tsx
git commit -m "feat(financeiro): tipos de periodicidade/gateway e labels dos novos status"
```

---

### Task 3: lib/billing/periodicity.ts (TDD)

**Files:**
- Create: `lib/billing/periodicity.test.ts`
- Create: `lib/billing/periodicity.ts`

- [ ] **Step 1: Escrever os testes**

```ts
// lib/billing/periodicity.test.ts
import { describe, it, expect } from 'vitest'
import {
  PERIODICITIES,
  PERIODICITY_MONTHS,
  PERIODICITY_LABELS,
  addMonthsClamped,
  addPeriod,
  isSubscriptionCurrent,
} from './periodicity'

describe('periodicity', () => {
  it('mapeia meses por periodicidade', () => {
    expect(PERIODICITY_MONTHS.monthly).toBe(1)
    expect(PERIODICITY_MONTHS.bimonthly).toBe(2)
    expect(PERIODICITY_MONTHS.quarterly).toBe(3)
    expect(PERIODICITY_MONTHS.semiannual).toBe(6)
    expect(PERIODICITY_MONTHS.annual).toBe(12)
  })

  it('tem label pt-BR para toda periodicidade', () => {
    for (const p of PERIODICITIES) {
      expect(PERIODICITY_LABELS[p]).toBeTruthy()
    }
    expect(PERIODICITY_LABELS.bimonthly).toBe('Bimestral')
  })

  it('addMonthsClamped soma meses clampando o dia (31/jan + 1m → 28/fev)', () => {
    const d = addMonthsClamped(new Date(2026, 0, 31), 1) // 31/jan/2026
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(1) // fevereiro
    expect(d.getDate()).toBe(28)
  })

  it('addMonthsClamped preserva o dia quando cabe', () => {
    const d = addMonthsClamped(new Date(2026, 3, 15), 3) // 15/abr + 3m
    expect(d.getMonth()).toBe(6) // julho
    expect(d.getDate()).toBe(15)
  })

  it('addPeriod usa os meses da periodicidade', () => {
    const d = addPeriod(new Date(2026, 0, 10), 'annual')
    expect(d.getFullYear()).toBe(2027)
    expect(d.getMonth()).toBe(0)
  })

  it('isSubscriptionCurrent: manual sempre em dia', () => {
    expect(isSubscriptionCurrent({ gateway: 'manual', current_period_end: null })).toBe(true)
  })

  it('isSubscriptionCurrent: mercadopago exige current_period_end no futuro', () => {
    const now = new Date('2026-07-03T12:00:00Z')
    expect(isSubscriptionCurrent(
      { gateway: 'mercadopago', current_period_end: '2026-08-01T00:00:00Z' }, now,
    )).toBe(true)
    expect(isSubscriptionCurrent(
      { gateway: 'mercadopago', current_period_end: '2026-07-01T00:00:00Z' }, now,
    )).toBe(false)
    expect(isSubscriptionCurrent(
      { gateway: 'mercadopago', current_period_end: null }, now,
    )).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/periodicity.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar**

```ts
// lib/billing/periodicity.ts
// Regras de periodicidade dos planos (mensal→anual). Fonte única para meses,
// labels pt-BR, avanço de período e "assinatura em dia".
import type { Periodicity } from '@/types'

export const PERIODICITIES: readonly Periodicity[] = [
  'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual',
]

export const PERIODICITY_MONTHS: Record<Periodicity, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
  monthly: 'Mensal',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

// Soma meses clampando o dia ao último dia do mês destino (31/jan+1m → 28/fev).
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

export function addPeriod(date: Date, periodicity: Periodicity): Date {
  return addMonthsClamped(date, PERIODICITY_MONTHS[periodicity])
}

// Assinatura "em dia": manual é gerida por fora (sempre em dia); mercadopago
// exige período pago vigente. Gate usado pela reconciliação de créditos e
// pela lista de inadimplentes.
export function isSubscriptionCurrent(
  sub: { gateway: string; current_period_end: string | null },
  now: Date = new Date(),
): boolean {
  if (sub.gateway !== 'mercadopago') return true
  if (!sub.current_period_end) return false
  return new Date(sub.current_period_end) >= now
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/periodicity.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/billing/periodicity.ts lib/billing/periodicity.test.ts
git commit -m "feat(billing): regras de periodicidade (meses, labels, avanço de período)"
```

---

### Task 4: lib/billing/tokenCrypto.ts (TDD)

**Files:**
- Create: `lib/billing/tokenCrypto.test.ts`
- Create: `lib/billing/tokenCrypto.ts`

- [ ] **Step 1: Escrever os testes**

```ts
// lib/billing/tokenCrypto.test.ts
import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret } from './tokenCrypto'

// 32 bytes em hex (64 chars) — chave só de teste.
const KEY = 'a'.repeat(64)

describe('tokenCrypto', () => {
  it('roundtrip encrypt → decrypt', () => {
    const enc = encryptSecret('APP_USR-token-secreto', KEY)
    expect(decryptSecret(enc, KEY)).toBe('APP_USR-token-secreto')
  })

  it('gera ciphertexts diferentes a cada chamada (IV aleatório)', () => {
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY))
  })

  it('payload adulterado → lança (auth tag GCM)', () => {
    const enc = encryptSecret('segredo', KEY)
    const [iv, tag, data] = enc.split('.')
    const tampered = [iv, tag, data.slice(0, -4) + 'AAAA'].join('.')
    expect(() => decryptSecret(tampered, KEY)).toThrow()
  })

  it('chave errada → lança', () => {
    const enc = encryptSecret('segredo', KEY)
    expect(() => decryptSecret(enc, 'b'.repeat(64))).toThrow()
  })

  it('chave malformada → lança com mensagem clara', () => {
    expect(() => encryptSecret('x', 'curta')).toThrow(/GATEWAY_TOKEN_KEY/)
  })

  it('payload malformado → lança', () => {
    expect(() => decryptSecret('nao-tem-pontos', KEY)).toThrow(/malformado/)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/tokenCrypto.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar**

```ts
// lib/billing/tokenCrypto.ts
// Criptografia dos tokens OAuth das academias (AES-256-GCM). A chave vem de
// GATEWAY_TOKEN_KEY (64 chars hex = 32 bytes). Tokens NUNCA ficam em texto
// puro no banco nem chegam ao client.
import crypto from 'crypto'

function getKey(explicit?: string): Buffer {
  const hex = explicit ?? process.env.GATEWAY_TOKEN_KEY
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('GATEWAY_TOKEN_KEY ausente ou inválida (esperado: 64 chars hex = 32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

// Formato do payload: base64(iv).base64(authTag).base64(ciphertext)
export function encryptSecret(plain: string, key?: string): string {
  const k = getKey(key)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

export function decryptSecret(payload: string, key?: string): string {
  const k = getKey(key)
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Payload criptografado malformado')
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/tokenCrypto.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/billing/tokenCrypto.ts lib/billing/tokenCrypto.test.ts
git commit -m "feat(billing): cripto AES-256-GCM para tokens de gateway das academias"
```

---

### Task 5: lib/billing/oauthState.ts (TDD)

**Files:**
- Create: `lib/billing/oauthState.test.ts`
- Create: `lib/billing/oauthState.ts`

- [ ] **Step 1: Escrever os testes**

```ts
// lib/billing/oauthState.test.ts
import { describe, it, expect } from 'vitest'
import { createOAuthState, verifyOAuthState } from './oauthState'

const SECRET = 'app-secret-de-teste'
const NOW = 1_800_000_000_000

describe('oauthState', () => {
  it('roundtrip create → verify', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    expect(verifyOAuthState(state, SECRET, NOW + 1000)).toEqual({ orgId: 'org-1', userId: 'user-1' })
  })

  it('expira após 10 minutos', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    expect(verifyOAuthState(state, SECRET, NOW + 10 * 60 * 1000 + 1)).toBeNull()
  })

  it('assinatura adulterada → null', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    const [body] = state.split('.')
    expect(verifyOAuthState(`${body}.assinatura-falsa`, SECRET, NOW)).toBeNull()
  })

  it('secret diferente → null', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    expect(verifyOAuthState(state, 'outro-secret', NOW)).toBeNull()
  })

  it('malformado/vazio → null', () => {
    expect(verifyOAuthState('lixo', SECRET, NOW)).toBeNull()
    expect(verifyOAuthState(null, SECRET, NOW)).toBeNull()
    expect(verifyOAuthState(undefined, SECRET, NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/oauthState.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar**

```ts
// lib/billing/oauthState.ts
// `state` assinado do fluxo OAuth do Mercado Pago (anti-CSRF). Carrega orgId +
// userId com expiração de 10 min; HMAC-SHA256 com MP_APP_SECRET.
import crypto from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000

interface OAuthStatePayload {
  orgId: string
  userId: string
  exp: number
}

export function createOAuthState(
  input: { orgId: string; userId: string },
  secret: string,
  now: number = Date.now(),
): string {
  const payload: OAuthStatePayload = { ...input, exp: now + STATE_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyOAuthState(
  state: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): { orgId: string; userId: string } | null {
  if (!state) return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload
    if (typeof payload.exp !== 'number' || payload.exp < now) return null
    if (!payload.orgId || !payload.userId) return null
    return { orgId: payload.orgId, userId: payload.userId }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/oauthState.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/billing/oauthState.ts lib/billing/oauthState.test.ts
git commit -m "feat(billing): state assinado do OAuth Mercado Pago (anti-CSRF, TTL 10min)"
```

---

### Task 6: lib/utils/siteUrl.ts compartilhado (TDD) + refactor platform-billing

A lógica de normalizar `NEXT_PUBLIC_SITE_URL` já existe privada em `features/platform-billing/actions.ts:10-14` — extrair para reuso (checkout do aluno também precisa).

**Files:**
- Create: `lib/utils/siteUrl.test.ts`
- Create: `lib/utils/siteUrl.ts`
- Modify: `features/platform-billing/actions.ts`

- [ ] **Step 1: Escrever os testes**

```ts
// lib/utils/siteUrl.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { getSiteUrl } from './siteUrl'

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
})

describe('getSiteUrl', () => {
  it('usa o default quando a env está ausente', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(getSiteUrl()).toBe('https://arenahub.website')
  })

  it('força https:// quando a env vem sem esquema', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'www.arenahub.website'
    expect(getSiteUrl()).toBe('https://www.arenahub.website')
  })

  it('remove barras finais', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://arenahub.website//'
    expect(getSiteUrl()).toBe('https://arenahub.website')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/utils/siteUrl.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar (mover o código de platform-billing, sem mudar comportamento)**

```ts
// lib/utils/siteUrl.ts
// Base URL do site para back_url/notification_url/redirect_uri do MercadoPago.
// Normaliza para URL absoluta válida: força https:// (se a env vier sem
// esquema, ex. "www.arenahub.website") e remove barra(s) final(is). Sem o
// https://, o MP recusa com "Invalid value for back_url, must be a valid URL".
export function getSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website').trim()
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}
```

- [ ] **Step 4: Refatorar platform-billing para importar**

Em `features/platform-billing/actions.ts`: remover a função local `getSiteUrl` (linhas 6–14, incluindo o comentário) e adicionar o import:

```ts
import { getSiteUrl } from '@/lib/utils/siteUrl'
```

- [ ] **Step 5: Rodar testes + build e commit**

Run: `npm run test:run -- lib/utils/siteUrl.test.ts` → PASS (3 testes)
Run: `npm run build` → sucesso

```bash
git add lib/utils/siteUrl.ts lib/utils/siteUrl.test.ts features/platform-billing/actions.ts
git commit -m "refactor: extrai getSiteUrl compartilhado (platform-billing + checkout)"
```

---

### Task 7: lib/billing/mpClient.ts (TDD, fetch mockado)

Único módulo com `fetch` para `api.mercadopago.com`. Todas as funções recebem o token explicitamente (academia OU plataforma) — quem decide o token é o caller.

**Files:**
- Create: `lib/billing/mpClient.test.ts`
- Create: `lib/billing/mpClient.ts`

- [ ] **Step 1: Escrever os testes**

```ts
// lib/billing/mpClient.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mpExchangeOAuthCode,
  mpRefreshOAuthToken,
  mpCreatePreapproval,
  mpGetPreapproval,
  mpCancelPreapproval,
  mpGetAuthorizedPayment,
  mpCreatePreference,
  mpGetPayment,
} from './mpClient'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  process.env.MP_APP_ID = 'app-id-test'
  process.env.MP_APP_SECRET = 'app-secret-test'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mpExchangeOAuthCode', () => {
  it('troca code por tokens e converte expires_in em expiresAt', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: 'APP_USR-abc',
      refresh_token: 'TG-def',
      user_id: 12345,
      public_key: 'pk-test',
      expires_in: 15552000,
    }))
    const tokens = await mpExchangeOAuthCode('code-1', 'https://site/callback')
    expect(tokens.accessToken).toBe('APP_USR-abc')
    expect(tokens.refreshToken).toBe('TG-def')
    expect(tokens.mpUserId).toBe('12345')
    expect(tokens.publicKey).toBe('pk-test')
    expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/oauth/token')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.grant_type).toBe('authorization_code')
    expect(body.client_id).toBe('app-id-test')
    expect(body.code).toBe('code-1')
    expect(body.redirect_uri).toBe('https://site/callback')
  })

  it('resposta não-ok → lança com status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'invalid_grant' }, 400))
    await expect(mpExchangeOAuthCode('code-x', 'https://site/cb')).rejects.toThrow(/400/)
  })
})

describe('mpRefreshOAuthToken', () => {
  it('usa grant_type refresh_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: 'novo', refresh_token: 'novo-rt', user_id: 9, expires_in: 100,
    }))
    const tokens = await mpRefreshOAuthToken('rt-antigo')
    expect(tokens.accessToken).toBe('novo')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('rt-antigo')
  })
})

describe('preapproval', () => {
  it('mpCreatePreapproval envia Authorization do vendedor e retorna id/init_point', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pre-1', init_point: 'https://mp/checkout' }))
    const res = await mpCreatePreapproval('seller-token', {
      reason: 'Plano 2x — Mensal',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 199.9, currency_id: 'BRL' },
      payer_email: 'aluno@x.com',
      back_url: 'https://site',
      external_reference: 'sub-1',
      status: 'pending',
    })
    expect(res).toEqual({ id: 'pre-1', init_point: 'https://mp/checkout' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/preapproval')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer seller-token' })
  })

  it('mpGetPreapproval faz GET no id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pre-1', status: 'authorized' }))
    const pre = await mpGetPreapproval('tok', 'pre-1')
    expect(pre.status).toBe('authorized')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/preapproval/pre-1')
  })

  it('mpCancelPreapproval faz PUT status cancelled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pre-1', status: 'cancelled' }))
    await mpCancelPreapproval('tok', 'pre-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/preapproval/pre-1')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: 'cancelled' })
  })
})

describe('pagamentos', () => {
  it('mpGetAuthorizedPayment faz GET no recurso', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      preapproval_id: 'pre-1', status: 'processed', payment: { id: 77, status: 'approved' },
    }))
    const ap = await mpGetAuthorizedPayment('tok', '55')
    expect(ap.preapproval_id).toBe('pre-1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/authorized_payments/55')
  })

  it('mpGetPayment faz GET /v1/payments/:id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 99, status: 'approved', external_reference: 'pay-row-1', transaction_amount: 50,
    }))
    const pay = await mpGetPayment('tok', '99')
    expect(pay.external_reference).toBe('pay-row-1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/v1/payments/99')
  })

  it('mpCreatePreference retorna id/init_point', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pref-1', init_point: 'https://mp/pref' }))
    const res = await mpCreatePreference('tok', {
      items: [{ title: 'Aula avulsa (2x)', quantity: 2, unit_price: 40, currency_id: 'BRL' }],
      external_reference: 'pay-row-1',
      notification_url: 'https://site/api/webhooks/mercadopago?org=o1',
      back_urls: { success: 'https://site', pending: 'https://site', failure: 'https://site' },
      marketplace_fee: 0,
    })
    expect(res).toEqual({ id: 'pref-1', init_point: 'https://mp/pref' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/checkout/preferences')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/mpClient.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar**

```ts
// lib/billing/mpClient.ts
// Cliente HTTP da API do Mercado Pago. ÚNICO lugar do app com fetch para
// api.mercadopago.com. Todas as funções recebem o token do CALLER — pode ser
// o token OAuth de uma academia (billing aluno→academia) ou o da plataforma
// (billing SaaS). Erros HTTP viram Error com status + corpo truncado; quem
// decide retry/mensagem amigável é o caller.
const MP_BASE = 'https://api.mercadopago.com'

async function mpFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${MP_BASE}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`MP ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// ── OAuth (marketplace) ──────────────────────────────────────────────────────

export interface MpOAuthTokens {
  accessToken: string
  refreshToken: string
  mpUserId: string
  publicKey: string | null
  expiresAt: string
}

interface RawOAuthResponse {
  access_token: string
  refresh_token: string
  user_id: number | string
  public_key?: string
  expires_in: number
}

function toTokens(raw: RawOAuthResponse, now = Date.now()): MpOAuthTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    mpUserId: String(raw.user_id),
    publicKey: raw.public_key ?? null,
    expiresAt: new Date(now + raw.expires_in * 1000).toISOString(),
  }
}

export async function mpExchangeOAuthCode(code: string, redirectUri: string): Promise<MpOAuthTokens> {
  const raw = await mpFetch<RawOAuthResponse>('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.MP_APP_ID,
      client_secret: process.env.MP_APP_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  })
  return toTokens(raw)
}

export async function mpRefreshOAuthToken(refreshToken: string): Promise<MpOAuthTokens> {
  const raw = await mpFetch<RawOAuthResponse>('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.MP_APP_ID,
      client_secret: process.env.MP_APP_SECRET,
      refresh_token: refreshToken,
    }),
  })
  return toTokens(raw)
}

// ── Assinaturas (preapproval) ────────────────────────────────────────────────

export interface MpPreapprovalCreate {
  reason: string
  auto_recurring: {
    frequency: number
    frequency_type: 'months'
    transaction_amount: number
    currency_id: 'BRL'
  }
  payer_email: string
  back_url: string
  external_reference: string
  notification_url?: string
  status: 'pending'
}

export interface MpPreapproval {
  id: string
  status?: string
  external_reference?: string
  init_point?: string
}

export async function mpCreatePreapproval(
  token: string,
  body: MpPreapprovalCreate,
): Promise<{ id: string; init_point: string }> {
  const data = await mpFetch<MpPreapproval>('/preapproval', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!data.id || !data.init_point) throw new Error('MP preapproval sem id/init_point')
  return { id: data.id, init_point: data.init_point }
}

export async function mpGetPreapproval(token: string, id: string): Promise<MpPreapproval> {
  return mpFetch<MpPreapproval>(`/preapproval/${id}`, { headers: authHeaders(token) })
}

export async function mpCancelPreapproval(token: string, id: string): Promise<void> {
  await mpFetch<MpPreapproval>(`/preapproval/${id}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ status: 'cancelled' }),
  })
}

// ── Cobranças recorrentes (authorized_payments) ─────────────────────────────

export interface MpAuthorizedPayment {
  preapproval_id?: string
  status?: string
  payment?: { id?: number; status?: string }
}

export async function mpGetAuthorizedPayment(token: string, id: string): Promise<MpAuthorizedPayment> {
  return mpFetch<MpAuthorizedPayment>(`/authorized_payments/${id}`, { headers: authHeaders(token) })
}

// ── Checkout Pro (avulso / day use) ──────────────────────────────────────────

export interface MpPreferenceCreate {
  items: Array<{ title: string; quantity: number; unit_price: number; currency_id: 'BRL' }>
  external_reference: string
  notification_url: string
  back_urls: { success: string; pending: string; failure: string }
  marketplace_fee?: number
}

export async function mpCreatePreference(
  token: string,
  body: MpPreferenceCreate,
): Promise<{ id: string; init_point: string }> {
  const data = await mpFetch<{ id?: string; init_point?: string }>('/checkout/preferences', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!data.id || !data.init_point) throw new Error('MP preference sem id/init_point')
  return { id: data.id, init_point: data.init_point }
}

export interface MpPayment {
  id: number
  status?: string
  external_reference?: string
  transaction_amount?: number
}

export async function mpGetPayment(token: string, id: string): Promise<MpPayment> {
  return mpFetch<MpPayment>(`/v1/payments/${id}`, { headers: authHeaders(token) })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/mpClient.test.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/billing/mpClient.ts lib/billing/mpClient.test.ts
git commit -m "feat(billing): cliente HTTP do Mercado Pago (oauth, preapproval, preferences, payments)"
```

---

### Task 8: lib/billing/fees.ts (TDD)

**Files:**
- Create: `lib/billing/fees.test.ts`
- Create: `lib/billing/fees.ts`

- [ ] **Step 1: Escrever os testes**

```ts
// lib/billing/fees.test.ts
import { describe, it, expect } from 'vitest'
import { computeMarketplaceFee } from './fees'

describe('computeMarketplaceFee', () => {
  it('pct 0 → fee 0 (comissão desligada no lançamento)', () => {
    expect(computeMarketplaceFee(199.9, 0)).toBe(0)
  })

  it('calcula percentual com 2 casas', () => {
    expect(computeMarketplaceFee(100, 2)).toBe(2)
    expect(computeMarketplaceFee(199.9, 1.5)).toBe(3)   // 2.9985 → 3.00
    expect(computeMarketplaceFee(33.33, 10)).toBe(3.33) // 3.333 → 3.33
  })

  it('entradas inválidas → 0 (nunca cobrar fee por engano)', () => {
    expect(computeMarketplaceFee(100, -1)).toBe(0)
    expect(computeMarketplaceFee(100, NaN)).toBe(0)
    expect(computeMarketplaceFee(-10, 5)).toBe(0)
    expect(computeMarketplaceFee(100, 101)).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/fees.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar**

```ts
// lib/billing/fees.ts
// Comissão da plataforma sobre pagamentos das academias (marketplace_fee do
// MP). organizations.platform_fee_pct = 0 no lançamento; qualquer entrada
// inválida resulta em 0 — na dúvida, NÃO cobrar comissão.
export function computeMarketplaceFee(amount: number, feePct: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(feePct)) return 0
  if (amount <= 0 || feePct <= 0 || feePct > 100) return 0
  return Math.round(amount * feePct) / 100
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/fees.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/billing/fees.ts lib/billing/fees.test.ts
git commit -m "feat(billing): computeMarketplaceFee (comissão preparada, 0% no lançamento)"
```

---

### Task 9: gatewayAccounts.ts + studentSubscriptionStatus.ts (TDD do mapper)

**Files:**
- Create: `lib/billing/studentSubscriptionStatus.test.ts`
- Create: `lib/billing/studentSubscriptionStatus.ts`
- Create: `lib/billing/gatewayAccounts.ts` (wrapper fino de DB — sem teste unitário, padrão do repo)

- [ ] **Step 1: Escrever os testes do mapper**

```ts
// lib/billing/studentSubscriptionStatus.test.ts
import { describe, it, expect } from 'vitest'
import { mapStudentPreapprovalStatus } from './studentSubscriptionStatus'

describe('mapStudentPreapprovalStatus', () => {
  it('authorized → active', () => {
    expect(mapStudentPreapprovalStatus('authorized')).toBe('active')
  })
  it('paused → past_due', () => {
    expect(mapStudentPreapprovalStatus('paused')).toBe('past_due')
  })
  it('cancelled → cancelled', () => {
    expect(mapStudentPreapprovalStatus('cancelled')).toBe('cancelled')
  })
  it('pending → pending_payment', () => {
    expect(mapStudentPreapprovalStatus('pending')).toBe('pending_payment')
  })
  it('desconhecido/undefined → null (webhook não altera nada)', () => {
    expect(mapStudentPreapprovalStatus('whatever')).toBeNull()
    expect(mapStudentPreapprovalStatus(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/billing/studentSubscriptionStatus.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o mapper**

```ts
// lib/billing/studentSubscriptionStatus.ts
// Tradução do status de Preapproval do MP para o status da assinatura do
// ALUNO (student_subscriptions). Análogo ao mpStatus.ts (que é do billing
// SaaS academia→plataforma — enums diferentes, não misturar).
// null = sem mapeamento → o webhook NÃO altera o registro.
import type { SubscriptionStatus } from '@/types'

export function mapStudentPreapprovalStatus(
  mpStatus: string | undefined,
): SubscriptionStatus | null {
  switch (mpStatus) {
    case 'authorized':
      return 'active'
    case 'paused':
      return 'past_due'
    case 'cancelled':
      return 'cancelled'
    case 'pending':
      return 'pending_payment'
    default:
      return null
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/billing/studentSubscriptionStatus.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Criar gatewayAccounts.ts**

```ts
// lib/billing/gatewayAccounts.ts
// Load/save da conta Mercado Pago de cada academia (org_gateway_accounts).
// Tokens são decriptados AQUI e nunca saem de server actions/route handlers.
import { createAdminClient } from '@/lib/supabase/server'
import { decryptSecret, encryptSecret } from './tokenCrypto'
import type { MpOAuthTokens } from './mpClient'

export type GatewayAccountStatus = 'connected' | 'disconnected' | 'expired'

export interface MpAccount {
  organizationId: string
  status: GatewayAccountStatus
  accessToken: string
  refreshToken: string
  mpUserId: string | null
  publicKey: string | null
  tokenExpiresAt: string | null
}

interface AccountRow {
  status: GatewayAccountStatus
  mp_user_id: string | null
  access_token_enc: string
  refresh_token_enc: string
  public_key: string | null
  token_expires_at: string | null
}

export async function getMpAccount(orgId: string): Promise<MpAccount | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('org_gateway_accounts')
    .select('status, mp_user_id, access_token_enc, refresh_token_enc, public_key, token_expires_at')
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()
  if (!data) return null
  const row = data as AccountRow
  return {
    organizationId: orgId,
    status: row.status,
    accessToken: decryptSecret(row.access_token_enc),
    refreshToken: decryptSecret(row.refresh_token_enc),
    mpUserId: row.mp_user_id,
    publicKey: row.public_key,
    tokenExpiresAt: row.token_expires_at,
  }
}

// Token pronto para uso em checkout — null quando não conectado/expirado
// (caller mostra "pagamento online indisponível").
export async function getConnectedMpToken(orgId: string): Promise<string | null> {
  const acc = await getMpAccount(orgId)
  return acc && acc.status === 'connected' ? acc.accessToken : null
}

export async function saveMpAccount(
  orgId: string,
  tokens: MpOAuthTokens,
  connectedBy: string | null,
): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { error } = await admin.from('org_gateway_accounts').upsert(
    {
      organization_id: orgId,
      gateway: 'mercadopago',
      status: 'connected',
      mp_user_id: tokens.mpUserId,
      access_token_enc: encryptSecret(tokens.accessToken),
      refresh_token_enc: encryptSecret(tokens.refreshToken),
      public_key: tokens.publicKey,
      token_expires_at: tokens.expiresAt,
      ...(connectedBy ? { connected_by: connectedBy } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,gateway' },
  )
  if (error) {
    console.error('[gatewayAccounts] upsert falhou', { orgId, error: error.message })
    return { error: 'Erro ao salvar a conexão.' }
  }
  return {}
}

export async function setMpAccountStatus(
  orgId: string,
  status: GatewayAccountStatus,
): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from('org_gateway_accounts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
}
```

- [ ] **Step 6: Build e commit**

Run: `npm run build` → sucesso

```bash
git add lib/billing/studentSubscriptionStatus.ts lib/billing/studentSubscriptionStatus.test.ts lib/billing/gatewayAccounts.ts
git commit -m "feat(billing): conta MP por academia + mapper de status da assinatura do aluno"
```

---

### Task 10: OAuth connect (actions + callback + cron de renovação)

**Files:**
- Create: `features/financeiro/gatewayActions.ts`
- Create: `app/api/integrations/mercadopago/callback/route.ts`
- Create: `app/api/cron/mp-token-refresh/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Criar gatewayActions.ts**

```ts
'use server'
// features/financeiro/gatewayActions.ts
// Conexão OAuth do Mercado Pago da academia + solicitações de outros gateways.
// Tudo owner-only (financeiro é área do dono).
import { revalidatePath } from 'next/cache'
import { requireOwner, createAdminClient } from '@/lib/supabase/server'
import { createOAuthState } from '@/lib/billing/oauthState'
import { setMpAccountStatus } from '@/lib/billing/gatewayAccounts'
import { getSiteUrl } from '@/lib/utils/siteUrl'

// URL de autorização do MP para o dono conectar a conta da academia.
// O client faz window.location.href = url (redirect não funciona em action
// chamada de componente client com startTransition).
export async function getMercadoPagoAuthUrl(): Promise<{ url?: string; error?: string }> {
  const ctx = await requireOwner()
  const appId = process.env.MP_APP_ID
  const secret = process.env.MP_APP_SECRET
  if (!appId || !secret) {
    return { error: 'Integração indisponível no momento. Tente mais tarde.' }
  }
  const state = createOAuthState({ orgId: ctx.organizationId, userId: ctx.userId }, secret)
  const redirectUri = `${getSiteUrl()}/api/integrations/mercadopago/callback`
  const params = new URLSearchParams({
    client_id: appId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri,
  })
  return { url: `https://auth.mercadopago.com.br/authorization?${params.toString()}` }
}

// Desconecta: novos checkouts bloqueados; assinaturas MP existentes seguem
// sendo processadas pelo webhook (spec §2 item 5).
export async function disconnectMercadoPago(): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  await setMpAccountStatus(ctx.organizationId, 'disconnected')
  revalidatePath('/admin/financeiro/integracoes')
  return {}
}

export async function requestGatewayIntegration(
  gatewayName: string,
  notes: string,
): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  const name = gatewayName.trim()
  if (!name) return { error: 'Informe o nome do banco/gateway.' }
  if (name.length > 80) return { error: 'Nome muito longo.' }

  const admin = createAdminClient()
  const { error } = await admin.from('gateway_integration_requests').insert({
    organization_id: ctx.organizationId,
    requested_by: ctx.userId,
    gateway_name: name,
    notes: notes.trim() || null,
  })
  if (error) return { error: 'Erro ao registrar a solicitação.' }
  revalidatePath('/admin/financeiro/integracoes')
  return {}
}
```

- [ ] **Step 2: Criar o callback OAuth**

```ts
// app/api/integrations/mercadopago/callback/route.ts
// Callback do OAuth marketplace: valida o state assinado, confirma que o
// usuário do state é o DONO da org, troca o code por tokens e salva
// criptografado. Qualquer falha → redirect com código de erro, nada persiste
// pela metade.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyOAuthState } from '@/lib/billing/oauthState'
import { mpExchangeOAuthCode } from '@/lib/billing/mpClient'
import { saveMpAccount } from '@/lib/billing/gatewayAccounts'
import { getSiteUrl } from '@/lib/utils/siteUrl'

export async function GET(req: NextRequest) {
  const backTo = `${getSiteUrl()}/admin/financeiro/integracoes`
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')

  const secret = process.env.MP_APP_SECRET
  if (!secret) {
    console.error('[mp-oauth] MP_APP_SECRET ausente')
    return NextResponse.redirect(`${backTo}?mp=error`)
  }

  const parsed = verifyOAuthState(state, secret)
  if (!parsed || !code) return NextResponse.redirect(`${backTo}?mp=invalid`)

  // Defesa extra: o userId do state precisa ser o dono da org HOJE.
  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', parsed.orgId)
    .single()
  if ((org as { owner_id: string | null } | null)?.owner_id !== parsed.userId) {
    return NextResponse.redirect(`${backTo}?mp=forbidden`)
  }

  try {
    const redirectUri = `${getSiteUrl()}/api/integrations/mercadopago/callback`
    const tokens = await mpExchangeOAuthCode(code, redirectUri)
    const { error } = await saveMpAccount(parsed.orgId, tokens, parsed.userId)
    if (error) return NextResponse.redirect(`${backTo}?mp=error`)
  } catch (e) {
    console.error('[mp-oauth] troca de code falhou', e)
    return NextResponse.redirect(`${backTo}?mp=error`)
  }

  return NextResponse.redirect(`${backTo}?mp=connected`)
}
```

- [ ] **Step 3: Criar o cron de renovação de tokens**

```ts
// app/api/cron/mp-token-refresh/route.ts
// Tokens OAuth do MP valem ~6 meses. Semanalmente renovamos os que vencem em
// <30 dias via refresh_token. Falha → status 'expired' (UI mostra
// "Reconectar" e checkouts novos ficam bloqueados).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/utils/cronAuth'
import { decryptSecret } from '@/lib/billing/tokenCrypto'
import { mpRefreshOAuthToken } from '@/lib/billing/mpClient'
import { saveMpAccount, setMpAccountStatus } from '@/lib/billing/gatewayAccounts'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const threshold = new Date(Date.now() + 30 * 86400000).toISOString()
  const { data: rows } = await admin
    .from('org_gateway_accounts')
    .select('organization_id, refresh_token_enc')
    .eq('gateway', 'mercadopago')
    .eq('status', 'connected')
    .lt('token_expires_at', threshold)

  let refreshed = 0
  let failed = 0
  for (const row of (rows ?? []) as { organization_id: string; refresh_token_enc: string }[]) {
    try {
      const tokens = await mpRefreshOAuthToken(decryptSecret(row.refresh_token_enc))
      await saveMpAccount(row.organization_id, tokens, null)
      refreshed++
    } catch (e) {
      console.error('[mp-token-refresh] falhou', { org: row.organization_id, e })
      await setMpAccountStatus(row.organization_id, 'expired')
      failed++
    }
  }

  return NextResponse.json({ refreshed, failed })
}
```

- [ ] **Step 4: Adicionar o cron ao vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/waitlist-notifications",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/monthly-credit-renewal",
      "schedule": "0 1 1 * *"
    },
    {
      "path": "/api/cron/mp-token-refresh",
      "schedule": "0 4 * * 1"
    }
  ]
}
```

- [ ] **Step 5: Build e commit**

Run: `npm run build` → sucesso (novas rotas `/api/integrations/mercadopago/callback` e `/api/cron/mp-token-refresh` listadas)

```bash
git add features/financeiro/gatewayActions.ts app/api/integrations/mercadopago/callback/route.ts app/api/cron/mp-token-refresh/route.ts vercel.json
git commit -m "feat(financeiro): OAuth Mercado Pago por academia (connect, callback, renovação semanal)"
```

---

### Task 11: Admin — planos com periodicidades flexíveis

Remove os 3 preços fixos e introduz o editor de periodicidades. Tudo num task só porque a remoção de `price_*` do tipo quebra o build de todos os consumidores — eles precisam mudar juntos.

**Files:**
- Modify: `types/index.ts` (remover `price_monthly/quarterly/annual` de `SubscriptionPlan`)
- Modify: `app/(admin)/admin/financeiro/adminActions.ts`
- Modify: `app/(admin)/admin/financeiro/PlansManager.tsx` (rewrite)
- Create: `app/(admin)/admin/financeiro/FinanceiroSubnav.tsx`
- Create: `app/(admin)/admin/financeiro/planos/page.tsx`
- Create: `app/(admin)/admin/financeiro/planos/SalesSettingsCard.tsx`
- Modify: `app/(admin)/admin/financeiro/page.tsx` (tira PlansManager, adiciona subnav)
- Modify: `app/(admin)/admin/alunos/[id]/page.tsx` e `StudentProfileClient.tsx` (sem `price_monthly`)

- [ ] **Step 1: types/index.ts — SubscriptionPlan sem preços fixos**

```ts
export interface SubscriptionPlan {
  id: string
  organization_id: string
  name: string
  description: string | null
  classes_per_week: number
  credits_per_month: number
  is_active: boolean
}
```

- [ ] **Step 2: adminActions.ts — substituir `updatePlanPrice` por `saveBillingOption` + settings de venda**

Manter `assertAdmin`, `togglePlanActive` e `applyDiscountAdmin` como estão. Substituir `CreatePlanData`/`createPlan` e **remover** `updatePlanPrice`. Adicionar:

```ts
export interface CreatePlanData {
  name: string
  description?: string
  classes_per_week: number
  credits_per_month: number
}

export async function createPlan(data: CreatePlanData): Promise<{ error?: string; planId?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (!data.name.trim()) return { error: 'Nome é obrigatório.' }
    if (data.credits_per_month < 1) return { error: 'Créditos por mês deve ser ≥ 1.' }

    const { data: plan, error } = await adminClient
      .from('subscription_plans')
      .insert({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        classes_per_week: data.classes_per_week,
        credits_per_month: data.credits_per_month,
        is_active: true,
        organization_id: orgId,
      })
      .select('id')
      .single()

    if (error || !plan) return { error: error?.message ?? 'Erro ao criar plano.' }
    revalidatePath('/admin/financeiro/planos')
    return { planId: plan.id as string }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// Liga/desliga e precifica uma periodicidade do plano (upsert por plan+periodicity).
export async function saveBillingOption(
  planId: string,
  periodicity: Periodicity,
  price: number,
  isEnabled: boolean,
): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (!PERIODICITIES.includes(periodicity)) return { error: 'Periodicidade inválida.' }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return { error: 'Preço inválido.' }
    }
    if (isEnabled && price <= 0) return { error: 'Defina um preço para habilitar a periodicidade.' }

    // Plano precisa ser da academia ativa (adminClient bypassa RLS).
    const { data: plan } = await adminClient
      .from('subscription_plans')
      .select('id')
      .eq('id', planId)
      .eq('organization_id', orgId)
      .single()
    if (!plan) return { error: 'Plano não encontrado.' }

    const { error } = await adminClient.from('plan_billing_options').upsert(
      {
        organization_id: orgId,
        plan_id: planId,
        periodicity,
        price,
        is_enabled: isEnabled,
      },
      { onConflict: 'plan_id,periodicity' },
    )
    if (error) return { error: 'Erro ao salvar a periodicidade.' }
    revalidatePath('/admin/financeiro/planos')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// Preço/toggle de aula avulsa e day use (system_settings key/value por academia).
export interface SalesSettingsData {
  single_class_price: number
  single_class_sale_enabled: boolean
  day_use_price: number
  day_use_sale_enabled: boolean
}

export async function updateSalesSettings(data: SalesSettingsData): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (data.single_class_price < 0 || data.day_use_price < 0) return { error: 'Preço inválido.' }
    if (data.single_class_sale_enabled && data.single_class_price <= 0) {
      return { error: 'Defina o preço da aula avulsa para ativar a venda.' }
    }
    if (data.day_use_sale_enabled && data.day_use_price <= 0) {
      return { error: 'Defina o preço do day use para ativar a venda.' }
    }

    const rows = [
      { organization_id: orgId, key: 'single_class_price', value: String(data.single_class_price) },
      { organization_id: orgId, key: 'single_class_sale_enabled', value: String(data.single_class_sale_enabled) },
      { organization_id: orgId, key: 'day_use_price', value: String(data.day_use_price) },
      { organization_id: orgId, key: 'day_use_sale_enabled', value: String(data.day_use_sale_enabled) },
    ]
    const { error } = await adminClient
      .from('system_settings')
      .upsert(rows, { onConflict: 'organization_id,key' })
    if (error) return { error: 'Erro ao salvar configurações de venda.' }
    revalidatePath('/admin/financeiro/planos')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
```

Imports novos no topo do arquivo:

```ts
import { PERIODICITIES } from '@/lib/billing/periodicity'
import type { Periodicity } from '@/types'
```

- [ ] **Step 3: Criar FinanceiroSubnav.tsx**

```tsx
'use client'
// app/(admin)/admin/financeiro/FinanceiroSubnav.tsx
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

const tabs = [
  { href: '/admin/financeiro', label: 'Visão geral' },
  { href: '/admin/financeiro/planos', label: 'Planos e preços' },
  { href: '/admin/financeiro/integracoes', label: 'Integrações' },
]

export function FinanceiroSubnav() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 border-b border-surface-border overflow-x-auto">
      {tabs.map((tab) => {
        const active =
          tab.href === '/admin/financeiro'
            ? pathname === tab.href
            : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              active
                ? 'border-brand-500 text-brand-500'
                : 'border-transparent text-slate-400 hover:text-white',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Reescrever PlansManager.tsx (editor de periodicidades)**

```tsx
'use client'
// app/(admin)/admin/financeiro/PlansManager.tsx
// Planos + editor de periodicidades: cada plano tem até 5 opções de cobrança
// (mensal→anual), cada uma com preço próprio e toggle.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { togglePlanActive, createPlan, saveBillingOption } from './adminActions'
import type { CreatePlanData } from './adminActions'
import { PERIODICITIES, PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import type { SubscriptionPlan, PlanBillingOption, Periodicity } from '@/types'

interface PlansManagerProps {
  plans: SubscriptionPlan[]
  options: PlanBillingOption[]
}

const emptyCreateForm: CreatePlanData = {
  name: '',
  description: '',
  classes_per_week: 2,
  credits_per_month: 8,
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function PlansManager({ plans, options }: PlansManagerProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreatePlanData>(emptyCreateForm)

  // Edição por (planId, periodicity): preço em texto + habilitado.
  const [editing, setEditing] = useState<{
    planId: string
    periodicity: Periodicity
    price: string
    enabled: boolean
  } | null>(null)

  function optionFor(planId: string, periodicity: Periodicity): PlanBillingOption | undefined {
    return options.find((o) => o.plan_id === planId && o.periodicity === periodicity)
  }

  function handleToggle(planId: string, current: boolean) {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await togglePlanActive(planId, !current)
      if (result.error) setError(result.error)
      else {
        setSuccess(`Plano ${!current ? 'ativado' : 'desativado'} com sucesso.`)
        router.refresh()
      }
    })
  }

  function handleCreatePlan() {
    setError(null)
    startTransition(async () => {
      const result = await createPlan(createForm)
      if (result.error) setError(result.error)
      else {
        setShowCreateForm(false)
        setCreateForm(emptyCreateForm)
        setSuccess('Plano criado. Agora habilite as periodicidades e preços.')
        router.refresh()
      }
    })
  }

  function handleSaveOption() {
    if (!editing) return
    const price = parseFloat(editing.price)
    if (isNaN(price)) {
      setError('Preço inválido.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await saveBillingOption(editing.planId, editing.periodicity, price, editing.enabled)
      if (result.error) setError(result.error)
      else {
        setEditing(null)
        setSuccess('Periodicidade salva.')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      {!showCreateForm && (
        <div>
          <Button size="sm" variant="primary" onClick={() => setShowCreateForm(true)}>
            + Novo Plano
          </Button>
        </div>
      )}

      {showCreateForm && (
        <Card>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">Novo Plano</p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Nome *</label>
                <Input
                  type="text"
                  placeholder="Ex: Plano 2x/semana"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Descrição (opcional)</label>
                <Input
                  type="text"
                  placeholder="Breve descrição"
                  value={createForm.description ?? ''}
                  onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Aulas/semana</label>
                <Input
                  type="number" min="1" step="1"
                  value={createForm.classes_per_week}
                  onChange={(e) => setCreateForm((f) => ({ ...f, classes_per_week: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Créditos/mês</label>
                <Input
                  type="number" min="1" step="1"
                  value={createForm.credits_per_month}
                  onChange={(e) => setCreateForm((f) => ({ ...f, credits_per_month: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={pending} onClick={handleCreatePlan}>
                Criar Plano
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setShowCreateForm(false); setCreateForm(emptyCreateForm) }}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
      )}

      {plans.map((plan) => (
        <Card key={plan.id}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
                <Badge variant={plan.is_active ? 'success' : 'danger'}>
                  {plan.is_active ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              {plan.description && <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>}
              <p className="text-xs text-slate-400 mt-1">
                {plan.classes_per_week}x/semana · {plan.credits_per_month} créditos/mês
              </p>
            </div>
            <Button
              size="sm"
              variant={plan.is_active ? 'danger' : 'secondary'}
              loading={pending}
              onClick={() => handleToggle(plan.id, plan.is_active)}
            >
              {plan.is_active ? 'Desativar' : 'Ativar'}
            </Button>
          </div>

          {/* Periodicidades */}
          <div className="space-y-2 pt-3 border-t border-surface-border">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Periodicidades</p>
            {PERIODICITIES.map((periodicity) => {
              const opt = optionFor(plan.id, periodicity)
              const isEditing = editing?.planId === plan.id && editing?.periodicity === periodicity
              return (
                <div key={periodicity} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-white w-24 shrink-0">{PERIODICITY_LABELS[periodicity]}</span>
                  {isEditing ? (
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <div className="max-w-[110px]">
                        <Input
                          type="number" min="0" step="0.01"
                          value={editing.price}
                          onChange={(e) => setEditing((s) => (s ? { ...s, price: e.target.value } : s))}
                        />
                      </div>
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={editing.enabled}
                          onChange={(e) => setEditing((s) => (s ? { ...s, enabled: e.target.checked } : s))}
                        />
                        À venda
                      </label>
                      <Button size="sm" variant="primary" loading={pending} onClick={handleSaveOption}>
                        Salvar
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {opt ? (
                        <>
                          <span className="text-white font-medium">{formatCurrency(opt.price)}</span>
                          <Badge variant={opt.is_enabled ? 'success' : 'default'}>
                            {opt.is_enabled ? 'À venda' : 'Oculto'}
                          </Badge>
                        </>
                      ) : (
                        <span className="text-slate-500 text-xs">Não configurado</span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditing({
                            planId: plan.id,
                            periodicity,
                            price: opt ? String(opt.price) : '',
                            enabled: opt ? opt.is_enabled : true,
                          })
                        }
                      >
                        Editar
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      ))}

      {plans.length === 0 && !showCreateForm && (
        <p className="text-sm text-slate-400">Nenhum plano cadastrado.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Criar planos/page.tsx**

```tsx
// app/(admin)/admin/financeiro/planos/page.tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { PlansManager } from '../PlansManager'
import { FinanceiroSubnav } from '../FinanceiroSubnav'
import { SalesSettingsCard } from './SalesSettingsCard'
import type { SubscriptionPlan, PlanBillingOption } from '@/types'

export default async function PlanosPage() {
  await requireOwner()
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const { data: plansRaw } = await adminClient
    .from('subscription_plans')
    .select('*')
    .eq('organization_id', orgId)
    .order('classes_per_week', { ascending: true })
  const plans: SubscriptionPlan[] = plansRaw ?? []

  const { data: optionsRaw } = await adminClient
    .from('plan_billing_options')
    .select('*')
    .eq('organization_id', orgId)
  const options: PlanBillingOption[] = optionsRaw ?? []

  // Settings de venda avulsa/day use (key/value por academia).
  const { data: settingsRaw } = await adminClient
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price', 'single_class_sale_enabled', 'day_use_price', 'day_use_sale_enabled'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Planos e preços</h1>
        <p className="text-slate-400 text-sm mt-1">Periodicidades, aula avulsa e day use</p>
      </div>
      <FinanceiroSubnav />

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Planos</h2>
        <PlansManager plans={plans} options={options} />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Venda avulsa</h2>
        <SalesSettingsCard
          initial={{
            single_class_price: parseFloat(settings.single_class_price ?? '0') || 0,
            single_class_sale_enabled: settings.single_class_sale_enabled === 'true',
            day_use_price: parseFloat(settings.day_use_price ?? '0') || 0,
            day_use_sale_enabled: settings.day_use_sale_enabled === 'true',
          }}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Criar SalesSettingsCard.tsx**

```tsx
'use client'
// app/(admin)/admin/financeiro/planos/SalesSettingsCard.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSalesSettings } from '../adminActions'
import type { SalesSettingsData } from '../adminActions'

export function SalesSettingsCard({ initial }: { initial: SalesSettingsData }) {
  const [form, setForm] = useState<SalesSettingsData>(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSave() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await updateSalesSettings(form)
      if (result.error) setError(result.error)
      else setSuccess('Configurações salvas.')
    })
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Aula avulsa (R$ por crédito)</label>
            <Input
              type="number" min="0" step="0.01"
              value={form.single_class_price}
              onChange={(e) => setForm((f) => ({ ...f, single_class_price: parseFloat(e.target.value) || 0 }))}
            />
            <label className="flex items-center gap-2 mt-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={form.single_class_sale_enabled}
                onChange={(e) => setForm((f) => ({ ...f, single_class_sale_enabled: e.target.checked }))}
              />
              Vender aula avulsa pelo app
            </label>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Day use (R$)</label>
            <Input
              type="number" min="0" step="0.01"
              value={form.day_use_price}
              onChange={(e) => setForm((f) => ({ ...f, day_use_price: parseFloat(e.target.value) || 0 }))}
            />
            <label className="flex items-center gap-2 mt-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={form.day_use_sale_enabled}
                onChange={(e) => setForm((f) => ({ ...f, day_use_sale_enabled: e.target.checked }))}
              />
              Cobrar day use pelo app
            </label>
          </div>
        </div>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}
        <Button size="sm" variant="primary" loading={pending} onClick={handleSave}>
          Salvar
        </Button>
      </div>
    </Card>
  )
}
```

- [ ] **Step 7: Ajustar a visão geral (`app/(admin)/admin/financeiro/page.tsx`)**

1. Remover o import e a seção `<PlansManager .../>` (a query de `plans` sai também).
2. Adicionar `import { FinanceiroSubnav } from './FinanceiroSubnav'` e renderizar `<FinanceiroSubnav />` logo abaixo do header (`<div>` do h1).

- [ ] **Step 8: Ajustar alunos/[id]**

Em `app/(admin)/admin/alunos/[id]/page.tsx:153`, trocar o select:

```ts
.select('id, name, classes_per_week, credits_per_month, is_active')
```

e remover `price_monthly: number` da interface local (linha 163). Em `StudentProfileClient.tsx`: remover `price_monthly: number` da interface (linha 46) e trocar o label do option (linha 676) por:

```tsx
{p.name} — {p.classes_per_week}x/sem · {p.credits_per_month} créditos/mês
```

- [ ] **Step 9: Build, testes e commit**

Run: `npx vitest run lib features app` → PASS
Run: `npm run build` → sucesso (rota `/admin/financeiro/planos` listada)

```bash
git add types/index.ts app/(admin)/admin/financeiro app/(admin)/admin/alunos
git commit -m "feat(admin): planos com periodicidades flexíveis + settings de venda avulsa"
```

---

### Task 12: Admin — página de integrações

**Files:**
- Create: `app/(admin)/admin/financeiro/integracoes/page.tsx`
- Create: `app/(admin)/admin/financeiro/integracoes/MpConnectCard.tsx`
- Create: `app/(admin)/admin/financeiro/integracoes/GatewayRequestCard.tsx`

- [ ] **Step 1: Criar a página**

```tsx
// app/(admin)/admin/financeiro/integracoes/page.tsx
import { createAdminClient, requireOwner } from '@/lib/supabase/server'
import { FinanceiroSubnav } from '../FinanceiroSubnav'
import { MpConnectCard } from './MpConnectCard'
import { GatewayRequestCard } from './GatewayRequestCard'
import type { GatewayIntegrationRequest } from '@/types'

export default async function IntegracoesPage() {
  const ctx = await requireOwner()
  const adminClient = createAdminClient()

  // Status da conexão SEM tokens (nunca mandar tokens ao client).
  const { data: account } = await adminClient
    .from('org_gateway_accounts')
    .select('status, mp_user_id, token_expires_at')
    .eq('organization_id', ctx.organizationId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()

  const { data: requestsRaw } = await adminClient
    .from('gateway_integration_requests')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false })
  const requests: GatewayIntegrationRequest[] = requestsRaw ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Integrações</h1>
        <p className="text-slate-400 text-sm mt-1">
          Conecte o gateway de pagamento da academia para receber dos alunos pelo app
        </p>
      </div>
      <FinanceiroSubnav />

      <MpConnectCard
        account={
          account
            ? {
                status: account.status as 'connected' | 'disconnected' | 'expired',
                mpUserId: (account.mp_user_id as string | null) ?? null,
                tokenExpiresAt: (account.token_expires_at as string | null) ?? null,
              }
            : null
        }
      />

      <GatewayRequestCard requests={requests} />
    </div>
  )
}
```

- [ ] **Step 2: Criar MpConnectCard.tsx**

```tsx
'use client'
// app/(admin)/admin/financeiro/integracoes/MpConnectCard.tsx
import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { getMercadoPagoAuthUrl, disconnectMercadoPago } from '@/features/financeiro/gatewayActions'

interface MpConnectCardProps {
  account: {
    status: 'connected' | 'disconnected' | 'expired'
    mpUserId: string | null
    tokenExpiresAt: string | null
  } | null
}

const CALLBACK_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'Mercado Pago conectado com sucesso!', ok: true },
  invalid: { text: 'Link de autorização inválido ou expirado. Tente de novo.', ok: false },
  forbidden: { text: 'Apenas o dono da academia pode conectar o Mercado Pago.', ok: false },
  error: { text: 'Não foi possível concluir a conexão. Tente novamente.', ok: false },
}

export function MpConnectCard({ account }: MpConnectCardProps) {
  const searchParams = useSearchParams()
  const feedback = CALLBACK_MESSAGES[searchParams.get('mp') ?? '']
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const connected = account?.status === 'connected'
  const expired = account?.status === 'expired'

  function handleConnect() {
    setError(null)
    startTransition(async () => {
      const result = await getMercadoPagoAuthUrl()
      if (result.error || !result.url) setError(result.error ?? 'Erro inesperado.')
      else window.location.href = result.url
    })
  }

  function handleDisconnect() {
    if (!confirm('Desconectar o Mercado Pago? Novos pagamentos pelo app ficarão indisponíveis.')) return
    setError(null)
    startTransition(async () => {
      const result = await disconnectMercadoPago()
      if (result.error) setError(result.error)
      else window.location.href = '/admin/financeiro/integracoes'
    })
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-white font-semibold">Mercado Pago</h3>
            {connected && <Badge variant="success">Conectado</Badge>}
            {expired && <Badge variant="danger">Conexão expirada</Badge>}
            {!account || account.status === 'disconnected' ? (
              <Badge variant="default">Não conectado</Badge>
            ) : null}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {connected
              ? `Conta MP ${account?.mpUserId ?? ''} — os pagamentos dos alunos caem direto nela.`
              : 'Conecte a conta Mercado Pago da academia para vender planos, aula avulsa e day use pelo app.'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {connected ? (
            <Button size="sm" variant="ghost" loading={pending} onClick={handleDisconnect}>
              Desconectar
            </Button>
          ) : (
            <Button size="sm" variant="primary" loading={pending} onClick={handleConnect}>
              {expired ? 'Reconectar' : 'Conectar Mercado Pago'}
            </Button>
          )}
        </div>
      </div>
      {feedback && (
        <p
          className={
            feedback.ok
              ? 'mt-3 text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2'
              : 'mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2'
          }
        >
          {feedback.text}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </Card>
  )
}
```

Nota: a página que usa `useSearchParams` precisa de `<Suspense>` no App Router quando pré-renderizada — como `integracoes/page.tsx` é dinâmica (usa cookies via `requireOwner`), não é necessário; se o build reclamar, envolver `<MpConnectCard>` em `<Suspense fallback={null}>`.

- [ ] **Step 3: Criar GatewayRequestCard.tsx**

```tsx
'use client'
// app/(admin)/admin/financeiro/integracoes/GatewayRequestCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { requestGatewayIntegration } from '@/features/financeiro/gatewayActions'
import type { GatewayIntegrationRequest } from '@/types'

export function GatewayRequestCard({ requests }: { requests: GatewayIntegrationRequest[] }) {
  const router = useRouter()
  const [gatewayName, setGatewayName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await requestGatewayIntegration(gatewayName, notes)
      if (result.error) setError(result.error)
      else {
        setGatewayName('')
        setNotes('')
        setSuccess('Solicitação registrada! Vamos avaliar a integração.')
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <h3 className="text-white font-semibold">Usa outro banco ou gateway?</h3>
      <p className="text-xs text-slate-400 mt-1 mb-3">
        Conte qual gateway a academia usa (Pagar.me, Asaas, Stripe, PagSeguro…) e avaliaremos a integração.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Banco/gateway *</label>
          <Input
            type="text"
            placeholder="Ex: Asaas"
            value={gatewayName}
            onChange={(e) => setGatewayName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Observações (opcional)</label>
          <Input
            type="text"
            placeholder="Ex: já uso cobrança recorrente por lá"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}
        <Button size="sm" variant="primary" loading={pending} onClick={handleSubmit}>
          Enviar solicitação
        </Button>
      </div>

      {requests.length > 0 && (
        <div className="mt-4 pt-3 border-t border-surface-border space-y-2">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Solicitações enviadas</p>
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span className="text-white">{r.gateway_name}</span>
              <Badge variant={r.status === 'reviewed' ? 'success' : 'warning'}>
                {r.status === 'reviewed' ? 'Avaliada' : 'Em análise'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Card de status da integração na visão geral (spec §4.1)**

Em `app/(admin)/admin/financeiro/page.tsx`, adicionar a query do status (sem tokens):

```ts
  const { data: mpAccount } = await adminClient
    .from('org_gateway_accounts')
    .select('status, mp_user_id')
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()
```

e um card logo abaixo dos KPIs:

```tsx
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Mercado Pago</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {mpAccount?.status === 'connected'
                ? `Conectado (conta ${mpAccount.mp_user_id ?? ''}) — alunos podem pagar pelo app.`
                : mpAccount?.status === 'expired'
                  ? 'Conexão expirada — reconecte para voltar a receber pelo app.'
                  : 'Conecte a conta da academia para receber planos, aula avulsa e day use pelo app.'}
            </p>
          </div>
          <Link
            href="/admin/financeiro/integracoes"
            className="shrink-0 text-sm font-medium text-brand-500"
          >
            {mpAccount?.status === 'connected' ? 'Gerenciar →' : 'Conectar →'}
          </Link>
        </div>
      </Card>
```

Import: `import Link from 'next/link'`.

- [ ] **Step 5: Build e commit**

Run: `npm run build` → sucesso (rota `/admin/financeiro/integracoes` listada)

```bash
git add app/(admin)/admin/financeiro
git commit -m "feat(admin): página de integrações — conectar Mercado Pago + solicitar outros gateways"
```

---

### Task 13: Aluno — página /financeiro + assinar plano (preapproval)

**Files:**
- Create: `features/financeiro/checkoutActions.ts` (só `subscribeToPlanCheckout` neste task; `buySingleClassCredits` entra no Task 15)
- Create: `features/financeiro/PlanStorefront.tsx`
- Create: `features/financeiro/CancelPlanButton.tsx`
- Create: `app/(dashboard)/financeiro/page.tsx`
- Create: `app/(dashboard)/retorno-pagamento/page.tsx`
- Modify: `middleware.ts`
- Modify: `features/financeiro/actions.ts` (cancelamentos MP-first)
- Modify: `app/(dashboard)/perfil/page.tsx` (link para /financeiro)

- [ ] **Step 1: Criar checkoutActions.ts com subscribeToPlanCheckout**

```ts
'use server'
// features/financeiro/checkoutActions.ts
// Checkouts do aluno com o token MP da ACADEMIA (OAuth marketplace).
// Nenhum efeito de crédito/ativação acontece aqui — só o webhook confirma.
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { mpCreatePreapproval } from '@/lib/billing/mpClient'
import { addPeriod, PERIODICITY_MONTHS, PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import type { PaymentType, Periodicity } from '@/types'

interface CheckoutResult {
  initPoint?: string
  error?: string
}

// Assina um plano com recorrência automática (MP Assinaturas).
// forStudentId: responsável assinando para um dependente (pagador = logado).
export async function subscribeToPlanCheckout(
  planId: string,
  billingOptionId: string,
  forStudentId?: string,
): Promise<CheckoutResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const admin = createAdminClient()
  const studentId = forStudentId ?? user.id

  // Assinar para outro aluno: só responsável → dependente.
  if (forStudentId && forStudentId !== user.id) {
    const { data: dep } = await admin
      .from('memberships')
      .select('is_dependent, parent_id')
      .eq('user_id', forStudentId)
      .eq('organization_id', orgId)
      .single()
    if (!dep?.is_dependent || dep.parent_id !== user.id) return { error: 'Sem permissão.' }
  }

  // Wellhub/TotalPass não assinam plano no app.
  const { data: studentMembership } = await admin
    .from('memberships')
    .select('payment_type')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .single()
  if (!studentMembership) return { error: 'Aluno não encontrado.' }
  const paymentType = studentMembership.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }

  const token = await getConnectedMpToken(orgId)
  if (!token) return { error: 'Pagamento online indisponível. Fale com a academia.' }

  // Opção de cobrança: precisa ser do plano informado, habilitada e da academia.
  const { data: option } = await admin
    .from('plan_billing_options')
    .select('id, plan_id, periodicity, price, is_enabled')
    .eq('id', billingOptionId)
    .eq('organization_id', orgId)
    .single()
  if (!option || !option.is_enabled || option.plan_id !== planId || option.price <= 0) {
    return { error: 'Opção de plano indisponível.' }
  }
  const periodicity = option.periodicity as Periodicity

  const { data: plan } = await admin
    .from('subscription_plans')
    .select('id, name, is_active')
    .eq('id', planId)
    .eq('organization_id', orgId)
    .single()
  if (!plan?.is_active) return { error: 'Este plano não está disponível.' }

  // Plano vigente bloqueia; pendências antigas são limpas (lazy, spec §3.1).
  const { data: existing } = await admin
    .from('student_subscriptions')
    .select('id, status')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due'])
    .maybeSingle()
  if (existing) return { error: 'Já existe um plano ativo. Cancele antes de trocar.' }

  await admin
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'pending_payment')

  // E-mail do PAGADOR (payer do MP é quem cadastra o cartão).
  const { data: payerUser } = await admin.auth.admin.getUserById(user.id)
  const payerEmail = payerUser?.user?.email
  if (!payerEmail) return { error: 'Não foi possível obter seu e-mail.' }

  const now = new Date()
  const { data: sub, error: insErr } = await admin
    .from('student_subscriptions')
    .insert({
      organization_id: orgId,
      student_id: studentId,
      payer_id: user.id,
      plan_id: planId,
      billing_option_id: option.id,
      periodicity,
      price: option.price,
      status: 'pending_payment',
      gateway: 'mercadopago',
      starts_at: now.toISOString(),
      ends_at: null,
      next_billing_at: addPeriod(now, periodicity).toISOString(),
      discount_pct: 0,
      gateway_subscription_id: null,
    })
    .select('id')
    .single()
  if (insErr || !sub) return { error: 'Erro ao iniciar assinatura. Tente novamente.' }

  try {
    const pre = await mpCreatePreapproval(token, {
      reason: `${plan.name} — ${PERIODICITY_LABELS[periodicity]}`,
      auto_recurring: {
        frequency: PERIODICITY_MONTHS[periodicity],
        frequency_type: 'months',
        transaction_amount: option.price,
        currency_id: 'BRL',
      },
      payer_email: payerEmail,
      // Bug do validador do MP com TLD .website: back_url NÃO pode ter path.
      // O retorno cai na raiz com ?preapproval_id=... e o middleware manda
      // para /retorno-pagamento, que roteia para a tela certa.
      back_url: getSiteUrl(),
      external_reference: sub.id,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      status: 'pending',
    })
    await admin
      .from('student_subscriptions')
      .update({ gateway_subscription_id: pre.id })
      .eq('id', sub.id)
    return { initPoint: pre.init_point }
  } catch (e) {
    console.error('[checkout] preapproval falhou', e)
    await admin.from('student_subscriptions').update({ status: 'cancelled' }).eq('id', sub.id)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}
```

- [ ] **Step 2: Cancelamentos MP-first em features/financeiro/actions.ts**

Em `cancelSubscription()`: o select da assinatura passa a incluir os campos do gateway e, ANTES do update local, cancela no MP. Trocar o bloco "Find active subscription" + "Cancel subscription" por:

```ts
  // Find active subscription (na academia ativa)
  const { data: sub, error: subErr } = await adminClient
    .from('student_subscriptions')
    .select('id, organization_id, gateway, gateway_subscription_id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due'])
    .maybeSingle()

  if (subErr || !sub) return { error: 'Nenhuma assinatura ativa encontrada.' }

  // MP primeiro: nunca deixar o MP cobrando um plano morto. Falhou → aborta.
  if (sub.gateway === 'mercadopago' && sub.gateway_subscription_id) {
    const account = await getMpAccount(sub.organization_id)
    if (!account) return { error: 'Não foi possível cancelar no Mercado Pago. Fale com a academia.' }
    try {
      await mpCancelPreapproval(account.accessToken, sub.gateway_subscription_id)
    } catch (e) {
      console.error('[cancelSubscription] MP cancel falhou', e)
      return { error: 'Não foi possível cancelar no Mercado Pago. Tente novamente.' }
    }
  }

  // Cancel subscription
  const { error: cancelErr } = await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', sub.id)
```

Mesma mudança em `adminCancelStudentPlan()`: o select vira

```ts
    .select('id, organization_id, gateway, gateway_subscription_id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due'])
    .maybeSingle()
```

e o mesmo bloco "MP primeiro" entra antes do update local. Imports novos no topo:

```ts
import { getMpAccount } from '@/lib/billing/gatewayAccounts'
import { mpCancelPreapproval } from '@/lib/billing/mpClient'
```

Nota: `.in('status', [...])` em vez de `.eq('status', 'active')` — assinatura vencida (past_due) também precisa ser cancelável.

- [ ] **Step 3: Criar PlanStorefront.tsx**

```tsx
'use client'
// features/financeiro/PlanStorefront.tsx
// Vitrine de planos do aluno: escolhe periodicidade e assina (redirect ao MP).
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { subscribeToPlanCheckout } from './checkoutActions'
import { PERIODICITY_LABELS, PERIODICITY_MONTHS } from '@/lib/billing/periodicity'
import type { SubscriptionPlan, PlanBillingOption } from '@/types'

interface PlanStorefrontProps {
  plans: SubscriptionPlan[]
  options: PlanBillingOption[]
  mpConnected: boolean
  hasActivePlan: boolean
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function PlanStorefront({ plans, options, mpConnected, hasActivePlan }: PlanStorefrontProps) {
  const [selected, setSelected] = useState<Record<string, string>>({}) // planId → optionId
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const plansWithOptions = plans
    .map((plan) => ({
      plan,
      opts: options
        .filter((o) => o.plan_id === plan.id && o.is_enabled && o.price > 0)
        .sort((a, b) => PERIODICITY_MONTHS[a.periodicity] - PERIODICITY_MONTHS[b.periodicity]),
    }))
    .filter(({ opts }) => opts.length > 0)

  if (plansWithOptions.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-400">Nenhum plano disponível no momento.</p>
      </Card>
    )
  }

  function handleSubscribe(planId: string, optionId: string) {
    setError(null)
    startTransition(async () => {
      const result = await subscribeToPlanCheckout(planId, optionId)
      if (result.error || !result.initPoint) setError(result.error ?? 'Erro inesperado.')
      else window.location.href = result.initPoint
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}
      {plansWithOptions.map(({ plan, opts }) => {
        const selectedId = selected[plan.id] ?? opts[0].id
        const selectedOpt = opts.find((o) => o.id === selectedId) ?? opts[0]
        return (
          <Card key={plan.id}>
            <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
            {plan.description && <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>}
            <p className="text-xs text-slate-400 mt-1">
              {plan.classes_per_week}x/semana · {plan.credits_per_month} créditos/mês
            </p>

            <div className="flex flex-wrap gap-2 mt-3">
              {opts.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelected((s) => ({ ...s, [plan.id]: opt.id }))}
                  className={
                    opt.id === selectedOpt.id
                      ? 'px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/20 border border-brand-500 text-brand-500'
                      : 'px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-surface-border text-slate-400'
                  }
                >
                  {PERIODICITY_LABELS[opt.periodicity]} · {formatCurrency(opt.price)}
                </button>
              ))}
            </div>

            <div className="mt-3">
              {mpConnected ? (
                <Button
                  size="sm"
                  variant="primary"
                  loading={pending}
                  disabled={hasActivePlan}
                  onClick={() => handleSubscribe(plan.id, selectedOpt.id)}
                >
                  {hasActivePlan ? 'Você já tem um plano ativo' : 'Assinar'}
                </Button>
              ) : (
                <p className="text-xs text-slate-400">
                  Pagamento online indisponível — fale com a academia para contratar.
                </p>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Criar CancelPlanButton.tsx**

```tsx
'use client'
// features/financeiro/CancelPlanButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelSubscription } from './actions'

export function CancelPlanButton() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleCancel() {
    if (!confirm('Cancelar seu plano? Os créditos restantes serão expirados.')) return
    setError(null)
    startTransition(async () => {
      const result = await cancelSubscription()
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div>
      <Button size="sm" variant="ghost" loading={pending} onClick={handleCancel}>
        Cancelar plano
      </Button>
      {error && (
        <p className="mt-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5a: Criar CheckoutReturnBanner.tsx (polling leve, spec §4.2)**

```tsx
'use client'
// features/financeiro/CheckoutReturnBanner.tsx
// Aviso pós-retorno do checkout. O retorno é só informativo (efeitos vêm do
// webhook); aqui fazemos polling LEVE: router.refresh() a cada 5s por até 30s
// para a página refletir a ativação sem o aluno recarregar na mão.
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'

export function CheckoutReturnBanner({ message }: { message: string }) {
  const router = useRouter()
  const ticks = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      ticks.current += 1
      if (ticks.current > 6) {
        clearInterval(interval)
        return
      }
      router.refresh()
    }, 5000)
    return () => clearInterval(interval)
  }, [router])

  return (
    <Card>
      <p className="text-sm text-white">{message}</p>
    </Card>
  )
}
```

- [ ] **Step 5b: Criar app/(dashboard)/financeiro/page.tsx**

```tsx
// app/(dashboard)/financeiro/page.tsx
// Financeiro do aluno: meu plano, vitrine de planos, histórico.
// (Compra de aula avulsa entra no Task 15; banner de indicação no Task 17.)
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { SubscriptionCard } from '@/features/financeiro/SubscriptionCard'
import { PaymentHistory } from '@/features/financeiro/PaymentHistory'
import { PlanStorefront } from '@/features/financeiro/PlanStorefront'
import { CancelPlanButton } from '@/features/financeiro/CancelPlanButton'
import { CheckoutReturnBanner } from '@/features/financeiro/CheckoutReturnBanner'
import type { Payment, PlanBillingOption, StudentSubscription, SubscriptionPlan } from '@/types'

export default async function FinanceiroAlunoPage({
  searchParams,
}: {
  searchParams: { retorno?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  if (!orgId) redirect('/selecionar-academia')

  const admin = createAdminClient()
  const membership = await getActiveMembership()

  // Limpeza lazy de pendências velhas (spec §3.1: >24h sem autorizar → cancelada).
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  await admin
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'pending_payment')
    .lt('starts_at', dayAgo)

  const { data: subRaw } = await admin
    .from('student_subscriptions')
    .select('*')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due', 'pending_payment'])
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const subscription = subRaw as StudentSubscription | null

  let plan: SubscriptionPlan | null = null
  if (subscription) {
    const { data: planRaw } = await admin
      .from('subscription_plans')
      .select('*')
      .eq('id', subscription.plan_id)
      .single()
    plan = planRaw as SubscriptionPlan | null
  }

  const { data: plansRaw } = await admin
    .from('subscription_plans')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('classes_per_week', { ascending: true })
  const plans: SubscriptionPlan[] = plansRaw ?? []

  const { data: optionsRaw } = await admin
    .from('plan_billing_options')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_enabled', true)
  const options: PlanBillingOption[] = optionsRaw ?? []

  const { data: mpAccount } = await admin
    .from('org_gateway_accounts')
    .select('status')
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()
  const mpConnected = mpAccount?.status === 'connected'

  const { data: paymentsRaw } = await admin
    .from('payments')
    .select('*')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)
  const payments: Payment[] = paymentsRaw ?? []

  const hasActivePlan = subscription?.status === 'active' || subscription?.status === 'past_due'

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-white">Financeiro</h1>
        <p className="text-slate-400 text-sm mt-1">Seu plano, pagamentos e contratação</p>
      </div>

      {searchParams.retorno === 'assinatura' && (
        <CheckoutReturnBanner message="Recebemos seu retorno do Mercado Pago. Assim que o pagamento for confirmado, seu plano é ativado automaticamente — isso costuma levar alguns segundos." />
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Meu plano</h2>
        <SubscriptionCard
          subscription={subscription}
          plan={plan}
          creditsBalance={(membership?.credits_balance as number | undefined) ?? 0}
        />
        {hasActivePlan && <div className="mt-2"><CancelPlanButton /></div>}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Planos disponíveis</h2>
        <PlanStorefront
          plans={plans}
          options={options}
          mpConnected={mpConnected}
          hasActivePlan={hasActivePlan}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Histórico de pagamentos</h2>
        <PaymentHistory payments={payments} />
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Criar /retorno-pagamento (roteador do retorno do MP)**

```tsx
// app/(dashboard)/retorno-pagamento/page.tsx
// O MP devolve o usuário na RAIZ (bug do validador com o TLD .website — ver
// features/platform-billing/actions.ts). O middleware manda para cá; esta
// página descobre de QUEM é o retorno e redireciona. Nunca aplica efeitos —
// isso é papel do webhook.
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'

export default async function RetornoPagamentoPage({
  searchParams,
}: {
  searchParams: { preapproval_id?: string; external_reference?: string }
}) {
  const admin = createAdminClient()

  const preapprovalId = searchParams.preapproval_id
  if (preapprovalId) {
    // Assinatura de aluno?
    const { data: studentSub } = await admin
      .from('student_subscriptions')
      .select('id')
      .eq('gateway_subscription_id', preapprovalId)
      .maybeSingle()
    if (studentSub) redirect('/financeiro?retorno=assinatura')
    // Senão: assinatura SaaS da academia (fluxo existente).
    redirect('/admin/assinatura')
  }

  const externalRef = searchParams.external_reference
  if (externalRef) {
    const { data: payment } = await admin
      .from('payments')
      .select('id, type')
      .eq('id', externalRef)
      .maybeSingle()
    if (payment?.type === 'day_use') redirect('/agendar/dayuse?retorno=1')
    if (payment) redirect('/financeiro?retorno=avulso')
  }

  redirect('/home')
}
```

- [ ] **Step 7: Middleware — retorno do MP na raiz vai para /retorno-pagamento**

Em `middleware.ts`, substituir o bloco das linhas 10–18 por:

```ts
  // Retorno de checkout do MercadoPago. O validador do MP recusa back_url com
  // path no TLD .website, então TODO checkout usa back_url na RAIZ; ao voltar,
  // o MP anexa ?preapproval_id=... (assinaturas) ou ?external_reference=...
  // (Checkout Pro). /retorno-pagamento identifica o dono e redireciona.
  if (
    pathname === '/' &&
    (searchParams.has('preapproval_id') || searchParams.has('external_reference'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/retorno-pagamento'
    return NextResponse.redirect(url)
  }
```

(O fluxo antigo continua funcionando: `/retorno-pagamento` manda assinatura SaaS para `/admin/assinatura`.)

- [ ] **Step 8: Link no perfil**

Em `app/(dashboard)/perfil/page.tsx`, acima da seção que renderiza `<SubscriptionCard ...>` (linha ~213), adicionar um link para a página nova:

```tsx
import Link from 'next/link'
```

```tsx
<Link
  href="/financeiro"
  className="block text-sm text-brand-500 font-medium mb-3"
>
  Ver financeiro completo (planos, pagamentos) →
</Link>
```

- [ ] **Step 9: Build e commit**

Run: `npm run build` → sucesso (rotas `/financeiro` e `/retorno-pagamento` listadas)

```bash
git add features/financeiro app/(dashboard)/financeiro app/(dashboard)/retorno-pagamento middleware.ts app/(dashboard)/perfil/page.tsx
git commit -m "feat(aluno): página financeiro com vitrine de planos e assinatura via Mercado Pago"
```

---

### Task 14: Webhook — assinaturas do aluno + gate de créditos + inadimplentes

**Files:**
- Create: `app/api/webhooks/mercadopago/studentHandlers.ts`
- Modify: `app/api/webhooks/mercadopago/route.ts`
- Modify: `features/aulas/creditReconciliation.ts`
- Modify: `app/(admin)/admin/financeiro/page.tsx` (inadimplentes vencidos)

- [ ] **Step 1: Criar studentHandlers.ts**

```ts
// app/api/webhooks/mercadopago/studentHandlers.ts
// Billing aluno→academia. Regra de ouro: NADA é creditado/ativado com base no
// corpo do webhook — sempre re-consultamos a API do MP com o token da academia
// dona. Erros lançados aqui viram 500 no route → o MP reentrega o evento.
import { createAdminClient } from '@/lib/supabase/server'
import { getMpAccount } from '@/lib/billing/gatewayAccounts'
import { mpGetPreapproval, mpGetAuthorizedPayment } from '@/lib/billing/mpClient'
import { mapStudentPreapprovalStatus } from '@/lib/billing/studentSubscriptionStatus'
import { addPeriod } from '@/lib/billing/periodicity'
import {
  reconcileEnrollmentCredits,
  getRemainingMonthWindow,
} from '@/features/aulas/creditReconciliation'
import type { Periodicity } from '@/types'

interface StudentSubRow {
  id: string
  organization_id: string
  student_id: string
  plan_id: string
  status: string
  periodicity: string | null
  price: number | null
  current_period_end: string | null
}

async function findStudentSubByPreapproval(preapprovalId: string): Promise<StudentSubRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('student_subscriptions')
    .select('id, organization_id, student_id, plan_id, status, periodicity, price, current_period_end')
    .eq('gateway_subscription_id', preapprovalId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()
  return (data as StudentSubRow) ?? null
}

// Créditos iniciais da ativação: reconcilia matrículas ativas no restante do
// mês (mesma regra do fluxo manual adminSubscribeStudentToPlan).
async function grantInitialCredits(sub: StudentSubRow): Promise<void> {
  const admin = createAdminClient()
  const { data: enrolls } = await admin
    .from('enrollments')
    .select('class_id')
    .eq('student_id', sub.student_id)
    .eq('organization_id', sub.organization_id)
    .eq('is_active', true)
  const { from, to } = getRemainingMonthWindow(new Date())
  for (const e of (enrolls ?? []) as { class_id: string }[]) {
    await reconcileEnrollmentCredits(sub.student_id, e.class_id, from, to)
  }
}

// subscription_preapproval de assinatura de ALUNO. 'not_found' → o route tenta
// o fluxo de plataforma (SaaS).
export async function handleStudentPreapprovalEvent(
  preapprovalId: string,
): Promise<'handled' | 'not_found'> {
  const sub = await findStudentSubByPreapproval(preapprovalId)
  if (!sub) return 'not_found'

  const account = await getMpAccount(sub.organization_id)
  if (!account) {
    console.error('[webhook/mp] academia sem conta MP para assinatura', { sub: sub.id })
    return 'handled'
  }

  const pre = await mpGetPreapproval(account.accessToken, preapprovalId)
  const mapped = mapStudentPreapprovalStatus(pre.status)
  if (!mapped || mapped === sub.status) return 'handled'

  const admin = createAdminClient()
  if (mapped === 'active') {
    const firstActivation = sub.status === 'pending_payment'
    const periodicity = (sub.periodicity ?? 'monthly') as Periodicity
    await admin
      .from('student_subscriptions')
      .update({
        status: 'active',
        current_period_end:
          sub.current_period_end ?? addPeriod(new Date(), periodicity).toISOString(),
      })
      .eq('id', sub.id)

    if (firstActivation) {
      await grantInitialCredits(sub)
      // Indicação do admin atendida.
      await admin
        .from('plan_recommendations')
        .update({ status: 'completed' })
        .eq('student_id', sub.student_id)
        .eq('organization_id', sub.organization_id)
        .eq('plan_id', sub.plan_id)
        .eq('status', 'pending')
    }
  } else if (mapped === 'past_due' || mapped === 'cancelled') {
    await admin.from('student_subscriptions').update({ status: mapped }).eq('id', sub.id)
  }
  // pending_payment: estado inicial, nada a fazer.

  return 'handled'
}

// subscription_authorized_payment (cobrança do período aprovada) para
// assinaturas de aluno. Exige orgId (vem do ?org= da notification_url).
export async function handleStudentRecurringPayment(
  resourceId: string,
  orgId: string,
): Promise<void> {
  const account = await getMpAccount(orgId)
  if (!account) {
    console.error('[webhook/mp] cobrança recorrente sem conta MP', { orgId })
    return
  }

  const ap = await mpGetAuthorizedPayment(account.accessToken, resourceId)
  const approved = ap.payment?.status === 'approved' || ap.status === 'approved'
  if (!approved || !ap.preapproval_id) return

  const sub = await findStudentSubByPreapproval(ap.preapproval_id)
  if (!sub || sub.organization_id !== orgId) return

  const admin = createAdminClient()
  const gatewayPaymentId = String(ap.payment?.id ?? resourceId)

  // Idempotência: unique (gateway, gateway_payment_id). 23505 = reentrega.
  const { error: insErr } = await admin.from('payments').insert({
    organization_id: orgId,
    student_id: sub.student_id,
    subscription_id: sub.id,
    amount: sub.price ?? 0,
    currency: 'BRL',
    status: 'paid',
    type: 'subscription',
    gateway: 'mercadopago',
    gateway_payment_id: gatewayPaymentId,
    paid_at: new Date().toISOString(),
  })
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return
    throw new Error(`[webhook/mp] insert payment falhou: ${insErr.message}`)
  }

  // Avança o período pago: a partir do fim vigente (se futuro) ou de agora.
  const periodicity = (sub.periodicity ?? 'monthly') as Periodicity
  const base =
    sub.current_period_end && new Date(sub.current_period_end) > new Date()
      ? new Date(sub.current_period_end)
      : new Date()
  const nextEnd = addPeriod(base, periodicity).toISOString()
  await admin
    .from('student_subscriptions')
    .update({ status: 'active', current_period_end: nextEnd, next_billing_at: nextEnd })
    .eq('id', sub.id)
}
```

- [ ] **Step 2: Refatorar o dispatch do route.ts**

Em `app/api/webhooks/mercadopago/route.ts`:

1. Imports novos:

```ts
import {
  handleStudentPreapprovalEvent,
  handleStudentRecurringPayment,
} from './studentHandlers'
```

2. No `POST`, capturar o `?org=` e relaxar a assinatura APENAS para esse caso (gatilho não confiável — tudo é re-confirmado na API com o token da academia):

```ts
  const orgParam = req.nextUrl.searchParams.get('org')
  const signatureOk = isValidSignature({ xSignature, requestId: xRequestId, dataId, secret })
  if (!signatureOk && !orgParam) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  if (!signatureOk && orgParam) {
    console.warn('[webhook/mercadopago] notificação ?org= sem assinatura válida — seguindo como gatilho não confiável')
  }
```

3. Passar `orgParam` para `handleWebhook(body as WebhookPayload, orgParam)` e mudar a assinatura da função:

```ts
async function handleWebhook(body: WebhookPayload, orgParam: string | null): Promise<NextResponse> {
  const action = body.action ?? body.type
  const resourceId = String(body.data?.id ?? '')

  try {
    // Assinaturas: primeiro tenta ALUNO (lookup por preapproval id); se não
    // for, cai no fluxo de PLATAFORMA (SaaS) existente.
    if (action === 'subscription_preapproval') {
      if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
      const result = await handleStudentPreapprovalEvent(resourceId)
      if (result === 'handled') return NextResponse.json({ received: true })
      return handlePlatformSubscription(action, resourceId)
    }

    if (action === 'subscription_authorized_payment') {
      if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
      if (orgParam) {
        await handleStudentRecurringPayment(resourceId, orgParam)
        return NextResponse.json({ received: true })
      }
      return handlePlatformSubscription(action, resourceId)
    }
  } catch (e) {
    // Falha transitória (API MP fora, DB): 500 → MP reentrega o evento.
    console.error('[webhook/mercadopago] handler falhou', e)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  // ... fluxo payment.* existente continua abaixo, inalterado neste task ...
```

O fluxo `payment.*` legado (busca por `gateway_payment_id`) permanece como está; o Task 15 adiciona o ramo `?org=`.

- [ ] **Step 3: Gate "em dia" na reconciliação mensal**

Em `features/aulas/creditReconciliation.ts`, função `reconcileAllActiveEnrollments` (linhas ~201–213): o select de assinaturas ativas passa a trazer o ciclo de vida e o Set só inclui quem está em dia:

```ts
  // Alunos com assinatura ativa E em dia (por-academia). Assinatura MP com
  // período vencido NÃO renova créditos (spec §3.3) — volta a renovar quando
  // o webhook confirmar a cobrança do período.
  let subsQuery = adminClient
    .from('student_subscriptions')
    .select('student_id, organization_id, gateway, current_period_end')
    .eq('status', 'active')
  if (orgId) subsQuery = subsQuery.eq('organization_id', orgId)
  const { data: subsRaw } = await subsQuery
  const now = new Date()
  const activeSubStudents = new Set(
    ((subsRaw ?? []) as {
      student_id: string
      organization_id: string
      gateway: string
      current_period_end: string | null
    }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => `${s.student_id}:${s.organization_id}`),
  )
```

Import novo no topo:

```ts
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
```

- [ ] **Step 4: Inadimplentes vencidos na visão geral**

Em `app/(admin)/admin/financeiro/page.tsx`, o critério atual (último pagamento `failed`) ganha um segundo: assinatura MP com período vencido ou `past_due`. Substituir a query de `inadimplentesRaw` por:

```ts
  const { data: inadimplentesRaw } = await adminClient
    .from('student_subscriptions')
    .select('student_id, status, gateway, current_period_end, profiles:profiles!student_subscriptions_student_id_fkey(full_name)')
    .in('status', ['active', 'past_due'])
    .eq('organization_id', orgId)
```

e no loop de filtragem, incluir também quem está vencido (mantendo o critério existente):

```ts
  const now = new Date()
  const inadimplentes: InadimplentRow[] = []
  if (inadimplentesRaw) {
    for (const sub of inadimplentesRaw as unknown as (InadimplentRow & {
      status: string
      gateway: string
      current_period_end: string | null
    })[]) {
      if (sub.status === 'past_due' || !isSubscriptionCurrent(sub, now)) {
        inadimplentes.push(sub)
        continue
      }
      const { data: lastPayment } = await adminClient
        .from('payments')
        .select('status')
        .eq('student_id', sub.student_id)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastPayment?.status === 'failed') inadimplentes.push(sub)
    }
  }
```

Import novo:

```ts
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
```

- [ ] **Step 5: Testes, build e commit**

Run: `npx vitest run lib features app` → PASS
Run: `npm run build` → sucesso

```bash
git add app/api/webhooks/mercadopago features/aulas/creditReconciliation.ts app/(admin)/admin/financeiro/page.tsx
git commit -m "feat(webhook): assinaturas de aluno multi-tenant + gate de créditos por período pago"
```

---

### Task 15: Aula avulsa (compra de créditos via Checkout Pro)

**Files:**
- Modify: `features/financeiro/checkoutActions.ts` (adicionar `buySingleClassCredits`)
- Create: `app/api/webhooks/mercadopago/checkoutHandlers.ts`
- Modify: `app/api/webhooks/mercadopago/route.ts` (ramo `payment.*` com `?org=`)
- Create: `features/financeiro/BuyCreditsCard.tsx`
- Modify: `app/(dashboard)/financeiro/page.tsx` (monta o card)
- Modify: `app/(dashboard)/agendar/page.tsx` (CTA com saldo 0)

- [ ] **Step 1: Adicionar buySingleClassCredits em checkoutActions.ts**

Imports adicionais no topo do arquivo:

```ts
import { mpCreatePreference } from '@/lib/billing/mpClient'
import { computeMarketplaceFee } from '@/lib/billing/fees'
```

Função nova (no fim do arquivo):

```ts
// Compra N créditos de aula avulsa (Checkout Pro: PIX/cartão). O crédito só
// entra no saldo quando o webhook confirmar o pagamento aprovado.
export async function buySingleClassCredits(qty: number): Promise<CheckoutResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
    return { error: 'Quantidade inválida (1 a 20).' }
  }

  const admin = createAdminClient()

  // Venda habilitada + preço (system_settings key/value por academia).
  const { data: settingsRaw } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price', 'single_class_sale_enabled'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const price = parseFloat(settings.single_class_price ?? '0') || 0
  if (settings.single_class_sale_enabled !== 'true' || price <= 0) {
    return { error: 'Venda de aula avulsa indisponível. Fale com a academia.' }
  }

  const token = await getConnectedMpToken(orgId)
  if (!token) return { error: 'Pagamento online indisponível. Fale com a academia.' }

  const amount = Math.round(qty * price * 100) / 100

  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      organization_id: orgId,
      student_id: user.id,
      subscription_id: null,
      session_id: null,
      amount,
      currency: 'BRL',
      status: 'pending',
      type: 'per_class',
      gateway: 'mercadopago',
      gateway_payment_id: null,
      credits_qty: qty,
    })
    .select('id')
    .single()
  if (payErr || !payment) return { error: 'Erro ao iniciar a compra. Tente novamente.' }

  const { data: org } = await admin
    .from('organizations')
    .select('platform_fee_pct')
    .eq('id', orgId)
    .single()
  const feePct = Number((org as { platform_fee_pct?: number } | null)?.platform_fee_pct ?? 0)

  try {
    const pref = await mpCreatePreference(token, {
      items: [
        { title: `Aula avulsa (${qty}x)`, quantity: qty, unit_price: price, currency_id: 'BRL' },
      ],
      external_reference: payment.id as string,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      // Mesmo bug de back_url do TLD .website: sempre a raiz (o MP anexa
      // ?external_reference=... e /retorno-pagamento roteia).
      back_urls: { success: getSiteUrl(), pending: getSiteUrl(), failure: getSiteUrl() },
      marketplace_fee: computeMarketplaceFee(amount, feePct),
    })
    return { initPoint: pref.init_point }
  } catch (e) {
    console.error('[checkout] preference avulsa falhou', e)
    await admin.from('payments').update({ status: 'failed' }).eq('id', payment.id)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}
```

- [ ] **Step 2: Criar checkoutHandlers.ts (webhook de Checkout Pro)**

```ts
// app/api/webhooks/mercadopago/checkoutHandlers.ts
// Pagamentos de Checkout Pro (aula avulsa / day use) das academias. A
// notificação chega com ?org=<id> (notification_url da preferência) e é
// tratada como GATILHO NÃO CONFIÁVEL: nada acontece sem re-consultar o
// pagamento na API do MP com o token da academia. O external_reference do
// pagamento aponta para a NOSSA linha de payments (criada pending no checkout).
import { createAdminClient } from '@/lib/supabase/server'
import { getMpAccount } from '@/lib/billing/gatewayAccounts'
import { mpGetPayment } from '@/lib/billing/mpClient'

interface PaymentRow {
  id: string
  organization_id: string
  student_id: string
  status: string
  type: string
  amount: number
  credits_qty: number | null
  dayuse_booking_id: string | null
}

export async function handleOrgCheckoutPayment(
  mpPaymentId: string,
  orgId: string,
): Promise<void> {
  const account = await getMpAccount(orgId)
  if (!account) {
    console.error('[webhook/mp] checkout sem conta MP', { orgId })
    return
  }

  const mpPay = await mpGetPayment(account.accessToken, mpPaymentId)
  if (mpPay.status !== 'approved') return
  const ref = mpPay.external_reference
  if (!ref) return

  const admin = createAdminClient()
  const { data: payRaw } = await admin
    .from('payments')
    .select('id, organization_id, student_id, status, type, amount, credits_qty, dayuse_booking_id')
    .eq('id', ref)
    .eq('organization_id', orgId)
    .maybeSingle()
  const pay = payRaw as PaymentRow | null
  if (!pay || pay.status === 'paid') return

  // Valor precisa bater com o cobrado (defesa contra ref reaproveitada).
  if (
    mpPay.transaction_amount != null &&
    Math.abs(Number(mpPay.transaction_amount) - Number(pay.amount)) > 0.01
  ) {
    console.error('[webhook/mp] valor divergente', {
      payment: pay.id, esperado: pay.amount, recebido: mpPay.transaction_amount,
    })
    return
  }

  // Marca paid condicionado a ainda estar pending (corrida entre reentregas:
  // só quem atualizar a linha aplica os efeitos).
  const { data: updated } = await admin
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      gateway_payment_id: String(mpPay.id),
    })
    .eq('id', pay.id)
    .eq('status', 'pending')
    .select('id')
  if (!updated || updated.length === 0) return

  if (pay.type === 'per_class' && pay.credits_qty && pay.credits_qty > 0) {
    // Crédito comprado não expira (spec §3.4).
    const { error: creditErr } = await admin.rpc('adjust_credits', {
      p_student_id: pay.student_id,
      p_org: orgId,
      p_delta: pay.credits_qty,
      p_type: 'purchased',
      p_reason: `Compra de aula avulsa (${pay.credits_qty}x) — pagamento ${mpPay.id}`,
    })
    if (creditErr) {
      // Pagamento já está paid; falha de crédito precisa de intervenção manual.
      console.error('[webhook/mp] adjust_credits da compra falhou', {
        payment: pay.id, error: creditErr.message,
      })
    }
    return
  }

  if (pay.type === 'day_use' && pay.dayuse_booking_id) {
    await confirmDayUseBooking(pay.dayuse_booking_id)
  }
}

// Confirma o booking de day use SE ainda estiver pendente dentro do prazo de
// 30 min. Fora do prazo: booking fica/vira cancelado e o pagamento pago
// aparece como "reembolso pendente" no financeiro do admin (spec §3.5).
async function confirmDayUseBooking(bookingId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: booking } = await admin
    .from('dayuse_bookings')
    .select('id, status, booked_at')
    .eq('id', bookingId)
    .maybeSingle()
  if (!booking) return

  const freshLimit = Date.now() - 30 * 60 * 1000
  const isFreshPending =
    booking.status === 'pending_payment' &&
    new Date(booking.booked_at as string).getTime() > freshLimit

  if (isFreshPending) {
    await admin
      .from('dayuse_bookings')
      .update({ status: 'confirmed' })
      .eq('id', bookingId)
      .eq('status', 'pending_payment')
  } else if (booking.status === 'pending_payment') {
    // Pagou tarde demais: a vaga já pode ter sido retomada.
    await admin
      .from('dayuse_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('status', 'pending_payment')
  }
}
```

- [ ] **Step 3: Ramo payment.* com ?org= no route.ts**

No `handleWebhook`, logo depois dos blocos de assinatura (Task 14) e ANTES do fluxo `payment.*` legado, adicionar (dentro do mesmo `try`):

```ts
    // Checkout Pro das academias (aula avulsa / day use): notificação com ?org=.
    if (orgParam && action && action.startsWith('payment')) {
      if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
      await handleOrgCheckoutPayment(resourceId, orgParam)
      return NextResponse.json({ received: true })
    }
```

Import novo:

```ts
import { handleOrgCheckoutPayment } from './checkoutHandlers'
```

O fluxo legado `payment.*` (sem `?org=`, busca por `gateway_payment_id`) permanece intocado abaixo.

- [ ] **Step 4: Criar BuyCreditsCard.tsx**

```tsx
'use client'
// features/financeiro/BuyCreditsCard.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { buySingleClassCredits } from './checkoutActions'

interface BuyCreditsCardProps {
  unitPrice: number
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function BuyCreditsCard({ unitPrice }: BuyCreditsCardProps) {
  const [qty, setQty] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleBuy() {
    setError(null)
    startTransition(async () => {
      const result = await buySingleClassCredits(qty)
      if (result.error || !result.initPoint) setError(result.error ?? 'Erro inesperado.')
      else window.location.href = result.initPoint
    })
  }

  return (
    <Card>
      <h3 className="text-white font-semibold text-sm">Comprar aula avulsa</h3>
      <p className="text-xs text-slate-400 mt-1">
        {formatCurrency(unitPrice)} por aula · pague com PIX ou cartão e o crédito cai na hora da confirmação.
      </p>
      <div className="flex items-center gap-3 mt-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={qty <= 1 || pending} onClick={() => setQty((q) => q - 1)}>
            −
          </Button>
          <span className="text-white font-medium w-6 text-center">{qty}</span>
          <Button size="sm" variant="ghost" disabled={qty >= 20 || pending} onClick={() => setQty((q) => q + 1)}>
            +
          </Button>
        </div>
        <Button size="sm" variant="primary" loading={pending} onClick={handleBuy}>
          Pagar {formatCurrency(qty * unitPrice)}
        </Button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </Card>
  )
}
```

- [ ] **Step 5: Montar o card em app/(dashboard)/financeiro/page.tsx**

Na page do Task 13, adicionar a leitura das settings de avulso (junto das outras queries):

```ts
  const { data: salesRaw } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price', 'single_class_sale_enabled'])
  const sales = Object.fromEntries(
    ((salesRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const singleClassPrice = parseFloat(sales.single_class_price ?? '0') || 0
  const singleClassEnabled =
    sales.single_class_sale_enabled === 'true' && singleClassPrice > 0 && mpConnected
```

e a seção (entre "Planos disponíveis" e "Histórico"):

```tsx
      {singleClassEnabled && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Aula avulsa</h2>
          <BuyCreditsCard unitPrice={singleClassPrice} />
        </section>
      )}
```

Import: `import { BuyCreditsCard } from '@/features/financeiro/BuyCreditsCard'`. Se `searchParams.retorno === 'avulso'`, renderizar `<CheckoutReturnBanner message="Recebemos seu pagamento. Os créditos entram no seu saldo assim que o Mercado Pago confirmar — normalmente em segundos." />` no topo (mesmo componente do Task 13).

- [ ] **Step 6: CTA na tela de agendar**

Em `app/(dashboard)/agendar/page.tsx`: localizar onde o saldo de créditos do aluno é exibido/carregado (buscar por `credits_balance` no arquivo). Adicionar, quando o saldo for 0:

```tsx
<Link href="/financeiro" className="text-sm text-brand-500 font-medium">
  Sem créditos? Compre uma aula avulsa →
</Link>
```

(Import `Link` de `next/link` se ainda não houver. Renderizar perto do indicador de saldo — seguir o layout existente da página.)

- [ ] **Step 7: Testes, build e commit**

Run: `npx vitest run lib features app` → PASS
Run: `npm run build` → sucesso

```bash
git add features/financeiro app/api/webhooks/mercadopago app/(dashboard)/financeiro/page.tsx app/(dashboard)/agendar/page.tsx
git commit -m "feat(financeiro): compra de aula avulsa via Checkout Pro (PIX/cartão)"
```

---

### Task 16: Day use pago

A RPC v2 (Task 1) já conta `pending_payment` fresco como vaga ocupada e aceita `p_status`. Aqui: caminho pago no `bookDayUse`, UI de redirect, contagem/expiração lazy na listagem e card de reembolsos pendentes no admin.

**Files:**
- Modify: `features/dayuse/actions.ts`
- Modify: `app/(dashboard)/agendar/dayuse/page.tsx`
- Modify: `app/(admin)/admin/financeiro/page.tsx` (reembolsos pendentes)
- Modify: `types/index.ts` (status do DayUseBooking)

- [ ] **Step 1: types — DayUseBooking com pending_payment**

```ts
export interface DayUseBooking {
  id: string
  organization_id: string
  slot_id: string
  student_id: string
  status: 'confirmed' | 'cancelled' | 'pending_payment'
  booked_at: string
  cancelled_at: string | null
}
```

- [ ] **Step 2: bookDayUse com caminho pago**

Em `features/dayuse/actions.ts`, substituir `bookDayUse` por:

```ts
export async function bookDayUse(slotId: string): Promise<{ error?: string; initPoint?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const adminClient = createAdminClient()

  // Org do slot (day use pago é configuração por academia).
  const { data: slot } = await adminClient
    .from('dayuse_slots')
    .select('organization_id')
    .eq('id', slotId)
    .eq('is_active', true)
    .maybeSingle()
  if (!slot) return { error: 'Slot não encontrado' }
  const orgId = slot.organization_id as string

  const { data: settingsRaw } = await adminClient
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['day_use_price', 'day_use_sale_enabled'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const price = parseFloat(settings.day_use_price ?? '0') || 0
  const token = settings.day_use_sale_enabled === 'true' && price > 0
    ? await getConnectedMpToken(orgId)
    : null
  const isPaid = Boolean(token)

  // Capacidade + insert atômicos via RPC (advisory lock por slot). Caminho
  // pago reserva como pending_payment: ocupa a vaga por 30 min (a RPC conta
  // pendentes frescos) até o webhook confirmar.
  const { data: bookingId, error } = await adminClient.rpc('book_dayuse_atomic', {
    p_student_id: user.id,
    p_slot_id: slotId,
    p_status: isPaid ? 'pending_payment' : 'confirmed',
  })

  if (error) {
    if (error.message.includes('SLOT_FULL')) return { error: 'Este horário está lotado.' }
    if (error.message.includes('ALREADY_BOOKED')) return { error: 'Você já tem uma reserva neste horário' }
    if (error.message.includes('SLOT_NOT_FOUND')) return { error: 'Slot não encontrado' }
    return { error: 'Erro ao reservar. Tente novamente.' }
  }

  if (!isPaid) {
    revalidatePath('/agendar/dayuse')
    revalidatePath('/home')
    return {}
  }

  // Caminho pago: payment pending + preferência de checkout.
  const { data: payment, error: payErr } = await adminClient
    .from('payments')
    .insert({
      organization_id: orgId,
      student_id: user.id,
      subscription_id: null,
      session_id: null,
      amount: price,
      currency: 'BRL',
      status: 'pending',
      type: 'day_use',
      gateway: 'mercadopago',
      gateway_payment_id: null,
      dayuse_booking_id: bookingId as string,
    })
    .select('id')
    .single()

  if (payErr || !payment) {
    await adminClient
      .from('dayuse_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId as string)
    return { error: 'Erro ao iniciar o pagamento. Tente novamente.' }
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('platform_fee_pct')
    .eq('id', orgId)
    .single()
  const feePct = Number((org as { platform_fee_pct?: number } | null)?.platform_fee_pct ?? 0)

  try {
    const pref = await mpCreatePreference(token as string, {
      items: [{ title: 'Day Use', quantity: 1, unit_price: price, currency_id: 'BRL' }],
      external_reference: payment.id as string,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      back_urls: { success: getSiteUrl(), pending: getSiteUrl(), failure: getSiteUrl() },
      marketplace_fee: computeMarketplaceFee(price, feePct),
    })
    revalidatePath('/agendar/dayuse')
    return { initPoint: pref.init_point }
  } catch (e) {
    console.error('[dayuse] preference falhou', e)
    await adminClient
      .from('dayuse_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId as string)
    await adminClient.from('payments').update({ status: 'failed' }).eq('id', payment.id)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}
```

Imports novos no topo:

```ts
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { mpCreatePreference } from '@/lib/billing/mpClient'
import { computeMarketplaceFee } from '@/lib/billing/fees'
import { getSiteUrl } from '@/lib/utils/siteUrl'
```

- [ ] **Step 3: Expiração lazy + contagem na página de day use**

Em `app/(dashboard)/agendar/dayuse/page.tsx`:

1. Onde a página conta reservas por slot (buscar por `dayuse_bookings` e `status`), a contagem de ocupadas passa a incluir pendentes frescos — mesmo critério da RPC:

```ts
const freshLimit = new Date(Date.now() - 30 * 60 * 1000).toISOString()
// ocupadas = confirmadas + pendentes de pagamento dentro do prazo
// (query com .or): .or(`status.eq.confirmed,and(status.eq.pending_payment,booked_at.gt.${freshLimit})`)
```

2. Expiração lazy no início do carregamento (server component, antes das queries de listagem):

```ts
// Reservas pendentes vencidas (>30min sem pagamento) são canceladas ao listar.
await adminClient
  .from('dayuse_bookings')
  .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
  .eq('status', 'pending_payment')
  .lt('booked_at', freshLimit)
```

3. No client que chama `bookDayUse` (buscar o `onClick`/handler que usa `bookDayUse` — pode estar na própria page ou em componente da pasta `features/dayuse/`): tratar o retorno novo

```ts
const result = await bookDayUse(slotId)
if (result.error) { /* fluxo de erro existente */ }
else if (result.initPoint) window.location.href = result.initPoint
else { /* fluxo de sucesso existente */ }
```

4. Se `searchParams.retorno === '1'`, mostrar aviso no topo: "Pagamento em processamento — sua reserva será confirmada em instantes."

5. A reserva do próprio aluno com `status === 'pending_payment'` mostra badge `<Badge variant="warning">Aguardando pagamento</Badge>` em vez de confirmada.

- [ ] **Step 4: Card de reembolsos pendentes no admin**

Em `app/(admin)/admin/financeiro/page.tsx`, adicionar query (junto das outras):

```ts
  // Day use pago fora do prazo: pagamento entrou mas a reserva expirou →
  // estornar manualmente no painel do MP (spec §3.5).
  const { data: refundsRaw } = await adminClient
    .from('payments')
    .select('id, amount, created_at, profiles:profiles!payments_student_id_fkey(full_name), dayuse_bookings!payments_dayuse_booking_id_fkey!inner(status)')
    .eq('organization_id', orgId)
    .eq('type', 'day_use')
    .eq('status', 'paid')
    .eq('dayuse_bookings.status', 'cancelled')

  interface RefundRow {
    id: string
    amount: number
    created_at: string
    profiles: { full_name: string } | null
  }
  const pendingRefunds = (refundsRaw as unknown as RefundRow[]) ?? []
```

e a seção (depois de "Pagamentos Pendentes"):

```tsx
      {pendingRefunds.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Reembolsos pendentes (day use)
          </h2>
          <div className="space-y-2">
            {pendingRefunds.map((r) => (
              <Card key={r.id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-white">{r.profiles?.full_name ?? r.id}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Pagou o day use, mas a reserva expirou — estorne no painel do Mercado Pago.
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-white">{formatCurrency(r.amount)}</span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 5: Testes, build e commit**

Run: `npx vitest run lib features app` → PASS
Run: `npm run build` → sucesso

```bash
git add features/dayuse/actions.ts app/(dashboard)/agendar/dayuse/page.tsx app/(admin)/admin/financeiro/page.tsx types/index.ts
git commit -m "feat(dayuse): pagamento online com reserva-com-prazo de 30min e reembolsos pendentes"
```

---

### Task 17: Indicação de plano pelo admin

**Files:**
- Create: `features/financeiro/recommendationActions.ts`
- Create: `features/financeiro/RecommendationBanner.tsx`
- Create: `app/(admin)/admin/alunos/[id]/RecommendPlanCard.tsx`
- Modify: `app/(admin)/admin/alunos/[id]/page.tsx` (dados + montagem do card)
- Modify: `app/(dashboard)/financeiro/page.tsx` e `app/(dashboard)/home/page.tsx` (banner)

- [ ] **Step 1: Criar recommendationActions.ts**

```ts
'use server'
// features/financeiro/recommendationActions.ts
// Admin indica um plano+periodicidade; o aluno vê banner no /home e no
// /financeiro. Ao assinar, o webhook marca completed (Task 14).
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'

async function getAdminContext(): Promise<
  { adminClient: ReturnType<typeof createAdminClient>; orgId: string; userId: string } | { error: string }
> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  return { adminClient, orgId, userId: user.id }
}

export async function recommendPlanToStudent(
  studentId: string,
  planId: string,
  billingOptionId: string,
): Promise<{ error?: string }> {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { adminClient, orgId, userId } = ctx

  // Opção precisa ser do plano e da academia, e estar à venda.
  const { data: option } = await adminClient
    .from('plan_billing_options')
    .select('id, plan_id, is_enabled')
    .eq('id', billingOptionId)
    .eq('organization_id', orgId)
    .single()
  if (!option || option.plan_id !== planId || !option.is_enabled) {
    return { error: 'Opção de plano inválida.' }
  }

  // Uma indicação pendente por aluno: as antigas são dispensadas.
  await adminClient
    .from('plan_recommendations')
    .update({ status: 'dismissed' })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')

  const { error } = await adminClient.from('plan_recommendations').insert({
    organization_id: orgId,
    student_id: studentId,
    plan_id: planId,
    billing_option_id: billingOptionId,
    created_by: userId,
  })
  if (error) return { error: 'Erro ao registrar a indicação.' }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

// Aluno dispensa o banner.
export async function dismissPlanRecommendation(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('plan_recommendations')
    .update({ status: 'dismissed' })
    .eq('id', id)
    .eq('student_id', user.id)
    .eq('status', 'pending')
  if (error) return { error: 'Erro ao dispensar.' }

  revalidatePath('/financeiro')
  revalidatePath('/home')
  return {}
}
```

- [ ] **Step 2: Criar RecommendationBanner.tsx**

```tsx
'use client'
// features/financeiro/RecommendationBanner.tsx
import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { dismissPlanRecommendation } from './recommendationActions'

interface RecommendationBannerProps {
  recommendationId: string
  planName: string
  periodicityLabel: string
  price: number
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function RecommendationBanner({
  recommendationId,
  planName,
  periodicityLabel,
  price,
}: RecommendationBannerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleDismiss() {
    startTransition(async () => {
      await dismissPlanRecommendation(recommendationId)
      router.refresh()
    })
  }

  return (
    <div className="rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 p-4">
      <p className="text-white text-sm font-semibold">A academia indicou um plano para você</p>
      <p className="text-white/80 text-xs mt-1">
        {planName} · {periodicityLabel} · {formatCurrency(price)}
      </p>
      <div className="flex gap-2 mt-3">
        <Link
          href="/financeiro"
          className="inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-700"
        >
          Ver e assinar
        </Link>
        <Button size="sm" variant="ghost" loading={pending} onClick={handleDismiss}>
          Agora não
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Criar RecommendPlanCard.tsx (admin, perfil do aluno)**

```tsx
'use client'
// app/(admin)/admin/alunos/[id]/RecommendPlanCard.tsx
// Indicar plano + status da assinatura MP do aluno. Complementa (não substitui)
// o "Atribuir plano" manual do StudentProfileClient.
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { recommendPlanToStudent } from '@/features/financeiro/recommendationActions'
import { PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import type { PlanBillingOption } from '@/types'

interface RecommendPlanCardProps {
  studentId: string
  plans: { id: string; name: string }[]
  options: PlanBillingOption[]
  mpSubscription: {
    status: string
    gateway: string
    current_period_end: string | null
  } | null
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function mpStatusBadge(sub: RecommendPlanCardProps['mpSubscription']) {
  if (!sub || sub.gateway !== 'mercadopago') return null
  if (sub.status === 'pending_payment') return <Badge variant="warning">MP: aguardando pagamento</Badge>
  if (sub.status === 'past_due') return <Badge variant="danger">MP: pagamento vencido</Badge>
  const current = sub.current_period_end && new Date(sub.current_period_end) >= new Date()
  return current
    ? <Badge variant="success">MP: em dia</Badge>
    : <Badge variant="danger">MP: período vencido</Badge>
}

export function RecommendPlanCard({ studentId, plans, options, mpSubscription }: RecommendPlanCardProps) {
  const [planId, setPlanId] = useState('')
  const [optionId, setOptionId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const planOptions = options.filter((o) => o.plan_id === planId && o.is_enabled)

  function handleRecommend() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await recommendPlanToStudent(studentId, planId, optionId)
      if (result.error) setError(result.error)
      else setSuccess('Indicação enviada! O aluno verá o convite no app.')
    })
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h3 className="text-white font-semibold text-sm">Indicar plano</h3>
        {mpStatusBadge(mpSubscription)}
      </div>
      <p className="text-xs text-slate-400 mt-1 mb-3">
        O aluno recebe um convite no app para assinar e pagar pelo Mercado Pago.
      </p>
      <div className="space-y-3">
        <select
          className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm text-white"
          value={planId}
          onChange={(e) => { setPlanId(e.target.value); setOptionId('') }}
        >
          <option value="">Selecione um plano...</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm text-white"
          value={optionId}
          onChange={(e) => setOptionId(e.target.value)}
          disabled={!planId}
        >
          <option value="">Selecione a periodicidade...</option>
          {planOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {PERIODICITY_LABELS[o.periodicity]} · {formatCurrency(o.price)}
            </option>
          ))}
        </select>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}
        <Button size="sm" variant="primary" loading={pending} disabled={!planId || !optionId} onClick={handleRecommend}>
          Enviar indicação
        </Button>
      </div>
    </Card>
  )
}
```

- [ ] **Step 4: Montar no perfil do aluno (admin)**

Em `app/(admin)/admin/alunos/[id]/page.tsx`:

1. Query nova (junto das outras):

```ts
  const { data: billingOptionsRaw } = await adminClient
    .from('plan_billing_options')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_enabled', true)
```

2. A query da assinatura atual do aluno (buscar por `student_subscriptions` no arquivo) passa a selecionar também `gateway, current_period_end, status`.
3. Renderizar `<RecommendPlanCard>` logo após o `<StudentProfileClient ...>`:

```tsx
<RecommendPlanCard
  studentId={params.id}
  plans={(plans ?? []).map((p) => ({ id: p.id, name: p.name }))}
  options={(billingOptionsRaw ?? []) as PlanBillingOption[]}
  mpSubscription={currentSubscription
    ? {
        status: currentSubscription.status,
        gateway: currentSubscription.gateway,
        current_period_end: currentSubscription.current_period_end,
      }
    : null}
/>
```

(ajustar nomes às variáveis reais do arquivo — `plans` é a lista `availablePlans` que a página já busca; `currentSubscription` é a assinatura ativa que a página já busca; imports de `RecommendPlanCard` e `PlanBillingOption`.)

- [ ] **Step 5: Banner no /financeiro e no /home**

Em `app/(dashboard)/financeiro/page.tsx`, adicionar a query da indicação pendente e o banner no topo (antes de "Meu plano"):

```ts
  const { data: recRaw } = await admin
    .from('plan_recommendations')
    .select('id, plan_id, billing_option_id, subscription_plans(name), plan_billing_options(periodicity, price)')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .maybeSingle()
```

```tsx
      {recRaw && (
        <RecommendationBanner
          recommendationId={recRaw.id as string}
          planName={(recRaw.subscription_plans as { name: string } | null)?.name ?? 'Plano'}
          periodicityLabel={
            PERIODICITY_LABELS[
              ((recRaw.plan_billing_options as { periodicity: Periodicity } | null)?.periodicity ?? 'monthly')
            ]
          }
          price={(recRaw.plan_billing_options as { price: number } | null)?.price ?? 0}
        />
      )}
```

Imports: `RecommendationBanner`, `PERIODICITY_LABELS`, tipo `Periodicity`. Nota: relacionamentos embed do Supabase podem vir como array — se o TS reclamar, aplicar o padrão do repo `Array.isArray(x) ? x[0] : x`.

Em `app/(dashboard)/home/page.tsx`: mesma query (usuário + org ativos já disponíveis na page) e o mesmo `<RecommendationBanner>` no topo do conteúdo.

- [ ] **Step 6: Testes, build e commit**

Run: `npx vitest run lib features app` → PASS
Run: `npm run build` → sucesso

```bash
git add features/financeiro app/(admin)/admin/alunos app/(dashboard)/financeiro/page.tsx app/(dashboard)/home/page.tsx
git commit -m "feat(financeiro): admin indica plano; aluno recebe convite para assinar"
```

---

### Task 18: Verificação final

- [ ] **Step 1: Suite completa + build + lint**

Run: `npx vitest run lib features app`
Expected: PASS (as 15 falhas de `octogent/` só aparecem em `npm run test:run` sem filtro — não são deste trabalho)

Run: `npm run build`
Expected: sucesso, com as rotas novas: `/financeiro`, `/retorno-pagamento`, `/admin/financeiro/planos`, `/admin/financeiro/integracoes`, `/api/integrations/mercadopago/callback`, `/api/cron/mp-token-refresh`

Run: `npm run lint`
Expected: sem erros novos

- [ ] **Step 2: Revisão de segurança rápida (checklist)**

- `org_gateway_accounts` sem policies RLS (deny-all) e nenhuma server action retornando tokens.
- Toda action nova valida admin/owner + escopo `organization_id`.
- Webhook: efeitos só após re-consulta na API do MP; idempotência por unique index.
- `?org=` sem assinatura só LOGA e segue como gatilho — nunca confia no corpo.

- [ ] **Step 3: Commit final e smoke manual (usuário)**

```bash
git add -A
git commit -m "chore(financeiro): ajustes finais da fase Mercado Pago por academia"
```

Roteiro de smoke em sandbox MP (manual, pós-deploy — documentar resultado):
1. Conectar conta MP de teste via `/admin/financeiro/integracoes` (OAuth).
2. Criar plano com periodicidade mensal + preço; conferir vitrine no `/financeiro` do aluno.
3. Assinar com cartão de teste → conferir webhook ativando a assinatura e créditos iniciais.
4. Comprar 1 aula avulsa com PIX de teste → crédito `purchased` no saldo.
5. Ativar day use pago → reservar → pagar → booking confirmado; deixar expirar um pendente e conferir liberação da vaga.
6. Indicar plano no perfil de um aluno → banner aparece no /home do aluno.
7. Cancelar a assinatura → preapproval cancelada no painel MP + créditos expirados.

---

## Riscos e decisões registradas

- **Split em assinaturas (preapproval)**: `marketplace_fee` só é enviado nas preferências (avulso/day use). Comissão em recorrência depende de suporte do MP — reavaliar quando `platform_fee_pct` for ativado (spec §3.6).
- **`?org=` sem assinatura**: aceito como gatilho não confiável — a segurança vem da re-consulta com o token da academia (spec §3.2). Pior caso de abuso: requisições inócuas (rate limit já existe em `lib/utils/rateLimit.ts` se precisar endurecer).
- **Migração destrutiva**: `subscription_plans.price_*` são REMOVIDAS após backfill em `plan_billing_options`. Aplicar a migration ANTES do deploy do código novo (código antigo lê colunas dropadas → erro; janela curta aceitável, igual ao cutover multi-tenant).
- **Enum `ADD VALUE`**: arquivo de migration separado e aplicado antes do principal.
- **Testes dos handlers do webhook**: a spec (§6) pedia handlers como funções puras testadas com mock de fetch/DB. Decisão de execução: a LÓGICA está toda em libs testadas (`periodicity`, `studentSubscriptionStatus`, `fees`, `mpClient`, `tokenCrypto`, `oauthState`); os handlers ficam como orquestração fina sobre elas, sem teste unitário — mesmo padrão do webhook existente do repo. A cobertura de ponta a ponta fica no smoke de sandbox (Task 18). Se o executor preferir fidelidade total à spec, injetar as dependências dos handlers e testá-las é uma extensão bem-vinda, não um requisito.
- **Unique index em `payments(gateway, gateway_payment_id)`**: se a migration falhar por duplicata legada em prod, deduplicar antes (manter a linha mais antiga): `delete from payments a using payments b where a.gateway_payment_id = b.gateway_payment_id and a.gateway = b.gateway and a.created_at > b.created_at;` — e reaplicar.






