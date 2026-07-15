-- supabase/migrations/20260715000100_push_subscriptions.sql

-- Inscrições Web Push (uma por dispositivo/navegador). O dispatch central
-- (createAdminClient / service_role) lê para enviar; cada usuário gerencia só
-- as próprias via RLS. organization_id dá escopo multi-tenant ao broadcast.
create table if not exists push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_org on push_subscriptions(organization_id);

alter table push_subscriptions enable row level security;

-- Usuário lê as próprias inscrições.
drop policy if exists "push_subscriptions_select_own" on push_subscriptions;
create policy "push_subscriptions_select_own" on push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

-- Usuário insere a própria inscrição.
drop policy if exists "push_subscriptions_insert_own" on push_subscriptions;
create policy "push_subscriptions_insert_own" on push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

-- Usuário atualiza a própria inscrição. Necessário para o upsert
-- (onConflict = endpoint): sem policy de UPDATE, o ramo DO UPDATE do upsert
-- é negado pela RLS e re-salvar a mesma inscrição falha.
drop policy if exists "push_subscriptions_update_own" on push_subscriptions;
create policy "push_subscriptions_update_own" on push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Usuário apaga as próprias inscrições.
drop policy if exists "push_subscriptions_delete_own" on push_subscriptions;
create policy "push_subscriptions_delete_own" on push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());
