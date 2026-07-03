-- supabase/migrations/20260704000100_financeiro_gateways.sql
-- Financeiro das academias: conta MP por academia (OAuth), periodicidades por
-- plano, solicitações de gateway, indicações de plano, day use pago.
-- Spec: docs/superpowers/specs/2026-07-03-financeiro-academias-mercadopago-design.md
-- ATENÇÃO (sequenciamento): esta migration DROPA subscription_plans.price_* .
-- Aplicar junto do deploy do código desta feature (o código antigo lê essas
-- colunas). Janela de incompatibilidade documentada no plano (seção Riscos).

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
  for select using (organization_id in (select auth_org_ids()));

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
  for select using (student_id = auth.uid() and organization_id in (select auth_org_ids()));

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

-- Único caminho de INSERT é a RPC (service role): a policy de insert direto
-- permitia burlar o lock de capacidade via PostgREST.
drop policy if exists dayuse_bookings_insert_own on dayuse_bookings;

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
